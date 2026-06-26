/* ══════════════════════════════════════════════════════════════════
   PokéVault app.js  v17
   Requires: Supabase JS v2, Chart.js v4, loaded in index.html
══════════════════════════════════════════════════════════════════ */

/* ── Supabase ────────────────────────────────────────────────────── */
const SUPABASE_URL      = 'https://jqzwvcjkekvdyimhryha.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impxend2Y2prZWt2ZHlpbWhyeWhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NzU5OTYsImV4cCI6MjA5NjE1MTk5Nn0.waU_KSWUuB0W_0Zu7tizbraAxmSpXyEVnKWCQnruXjs';
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window._sb = _sb;

/* ── Result store (avoids JSON-in-onclick attribute bugs) ────────── */
// Cards are stored here keyed by index; onclick handlers reference the index only.
const _resultStore = {};
let   _resultStoreIdx = 0;
function storeResult(r) {
  const key = `r${_resultStoreIdx++}`;
  _resultStore[key] = r;
  return key;
}
function getResult(key) { return _resultStore[key] || null; }

/* ── App state ───────────────────────────────────────────────────── */
let _user         = null;
let _fxRate       = 1.35;
let _portfolio    = [];       // active holdings
let _soldItems    = [];       // sold items
let _searchLang   = 'english';
let _searchType   = 'cards';
let _pfSearchLang = 'english';
let _pfSearchType = 'cards';
let _viewMode     = 'grid';
let _pfDebounce   = null;
let _searchDebounce = null;
let _portfolioChart = null;

// Trade analyser state
let _trade = { my: [], their: [] };
let _tradeLang = 'english';
let _tradeType = 'cards';
let _tradeSide = 'my';
let _tradeDebounce = null;
let _tradePending = null;

/* ── Toast ───────────────────────────────────────────────────────── */
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ── FX rate ─────────────────────────────────────────────────────── */
async function fetchFxRate() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const d = await r.json();
    if (d?.rates?.SGD) {
      _fxRate = d.rates.SGD;
      window._fxRate = _fxRate;
      const el = document.getElementById('fx-rate');
      if (el) el.textContent = `USD/SGD: ${_fxRate.toFixed(4)}`;
    }
  } catch (_) {}
}

function usdToSgd(usd) { return usd != null ? parseFloat(usd) * _fxRate : null; }
function fmtSgd(v)     { return v != null ? `SGD $${parseFloat(v).toFixed(2)}` : '—'; }
function fmtPct(v)     { return v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—'; }

/* ── Auth ────────────────────────────────────────────────────────── */
async function initAuth() {
  const { data: { session } } = await _sb.auth.getSession();
  if (!session) { window.location.href = '/login'; return; }
  _user = session.user;
  window._fxRate = _fxRate;

  // Show username
  const meta = _user.user_metadata || {};
  const uname = meta.username || _user.email?.split('@')[0] || 'Trainer';
  const el = document.getElementById('username-display');
  if (el) el.textContent = uname;

  // Show search tab only on first login (never again after that)
  const visitedKey = `pv_visited_${_user.id}`;
  const searchNav  = document.getElementById('nav-search');
  if (!localStorage.getItem(visitedKey)) {
    // First login — show search tab and mark as visited
    if (searchNav) searchNav.style.display = '';
    localStorage.setItem(visitedKey, '1');
    toast('Welcome! Use the Search tab to find cards and add them to your portfolio.', 'success');
  } else {
    // Subsequent logins — keep search tab hidden
    if (searchNav) searchNav.style.display = 'none';
  }

  // Check premium
  try {
    const { data: profile } = await _sb.from('profiles').select('is_premium').eq('id', _user.id).single();
    if (profile?.is_premium) {
      const badge = document.getElementById('premium-badge');
      if (badge) badge.style.display = '';
    }
  } catch (_) {}

  await fetchFxRate();
  await loadPortfolio();
}

async function logout() {
  await _sb.auth.signOut();
  window.location.href = '/login';
}
window.logout = logout;

/* ── Tab switching ───────────────────────────────────────────────── */
function switchMainTab(tab) {
  ['portfolio', 'search'].forEach(t => {
    const btn   = document.getElementById(`nav-${t}`);
    const panel = document.getElementById(`tab-${t}`);
    if (btn)   btn.classList.toggle('active', t === tab);
    if (panel) { panel.classList.toggle('active', t === tab); panel.style.display = t === tab ? 'block' : 'none'; }
  });
}
window.switchMainTab = switchMainTab;

/* ── Portfolio — load & render ───────────────────────────────────── */
async function loadPortfolio() {
  if (!_user) return;
  const { data, error } = await _sb
    .from('portfolio_items')
    .select('*')
    .eq('user_id', _user.id)
    .order('created_at', { ascending: false });

  if (error) { toast('Failed to load portfolio', 'error'); return; }

  _portfolio  = (data || []).filter(i => !i.sold);
  _soldItems  = (data || []).filter(i =>  i.sold);
  renderPortfolioTable();
  renderPortfolioMetrics();
  updateHistoryDaysDisplay();
}

function renderPortfolioTable() {
  const tbody = document.getElementById('portfolio-table');
  if (!tbody) return;

  if (!_portfolio.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No items yet — search for a card above and click <strong>+ Portfolio</strong></div></td></tr>`;
    return;
  }

  tbody.innerHTML = _portfolio.map(item => {
    const cost  = parseFloat(item.purchase_price || 0) * (item.quantity || 1);
    const value = item.current_value != null ? parseFloat(item.current_value) * (item.quantity || 1) : null;
    const pl    = value != null ? value - cost : null;
    const plPct = cost > 0 && pl != null ? (pl / cost) * 100 : null;
    const plClass = pl == null ? '' : pl >= 0 ? 'td-pos' : 'td-neg';
    const sign    = pl == null ? '' : pl >= 0 ? '+' : '';

    const cond = (item.condition_or_grade || '').toUpperCase();
    const isPsa = cond.startsWith('PSA') || cond.startsWith('CGC') || cond.startsWith('BGS');
    const condBadge = `<span class="cond-badge${isPsa ? ' cond-psa' : ''}">${item.condition_or_grade || 'NM'}</span>`;

    const imgTag = item.image_url
      ? `<img class="td-thumb" src="${item.image_url}" alt="${esc(item.name)}" loading="lazy" />`
      : `<span style="font-size:22px;width:32px;text-align:center;">🃏</span>`;

    const langFlag = item.language === 'japanese' ? ' 🇯🇵' : '';

    return `<tr class="data-row" onclick="rowClick('${item.id}')">
      <td>
        <div class="td-card">
          ${imgTag}
          <div>
            <div class="td-name">${esc(item.name)}${langFlag}</div>
            ${item.notes ? `<div class="td-sub">${esc(item.notes)}</div>` : ''}
          </div>
        </div>
      </td>
      <td class="muted" style="font-size:12px;">${esc(item.set_name || '—')}</td>
      <td>${condBadge}</td>
      <td class="td-mono">${item.quantity || 1}</td>
      <td class="td-mono">${fmtSgd(cost)}</td>
      <td class="td-mono accent" style="color:var(--accent);">${value != null ? fmtSgd(value) : '—'}</td>
      <td class="${plClass}">
        ${pl != null ? `${sign}${fmtSgd(pl)}` : '—'}
        ${plPct != null ? `<div style="font-size:10px;opacity:.7;">${fmtPct(plPct)}</div>` : ''}
      </td>
      <td>
        <div class="td-actions" onclick="event.stopPropagation()">
          <button class="btn-sell-sm" onclick="openSellModal('${item.id}')">$ Sell</button>
          <button class="btn-remove"  onclick="removePortfolioItem('${item.id}')">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderPortfolioMetrics() {
  const items = _portfolio;
  const totalCost  = items.reduce((s, i) => s + parseFloat(i.purchase_price || 0) * (i.quantity || 1), 0);
  const totalValue = items.reduce((s, i) => {
    const v = i.current_value != null ? parseFloat(i.current_value) * (i.quantity || 1) : null;
    return v != null ? s + v : s;
  }, 0);
  const hasValue = items.some(i => i.current_value != null);
  const pl    = hasValue ? totalValue - totalCost : null;
  const plPct = totalCost > 0 && pl != null ? (pl / totalCost) * 100 : null;

  setText('pf-metric-cost',  fmtSgd(totalCost));
  setText('pf-metric-value', hasValue ? fmtSgd(totalValue) : '—');

  const plEl = document.getElementById('pf-metric-pl');
  if (plEl) {
    plEl.textContent = pl != null ? `${pl >= 0 ? '+' : ''}${fmtSgd(pl)}` : '—';
    plEl.style.color = pl == null ? '' : pl >= 0 ? 'var(--accent)' : 'var(--red)';
  }
  const roiEl = document.getElementById('pf-metric-roi');
  if (roiEl) {
    roiEl.textContent = plPct != null ? fmtPct(plPct) : '—';
    roiEl.style.color = plPct == null ? '' : plPct >= 0 ? 'var(--accent)' : 'var(--red)';
  }

  // Lifetime metric (realised)
  const lifeEl = document.getElementById('pf-metric-lifetime');
  if (lifeEl) {
    if (_soldItems.length) {
      const realisedPL = _soldItems.reduce((s, i) => {
        const cost  = parseFloat(i.purchase_price || 0) * (i.quantity || 1);
        const sold  = parseFloat(i.sold_price || 0);
        return s + (sold - cost);
      }, 0);
      lifeEl.textContent = `${realisedPL >= 0 ? '+' : ''}${fmtSgd(realisedPL)} realised`;
      lifeEl.style.color = realisedPL >= 0 ? 'var(--accent)' : 'var(--red)';
    } else {
      lifeEl.textContent = 'No sales yet';
      lifeEl.style.color = '';
    }
  }
}

function updateHistoryDaysDisplay() {
  const el = document.getElementById('history-days-display');
  if (!el) return;
  // Show fixed range: (account creation − 10 days) → today
  // We derive this from the oldest last_value_updated as a proxy if profile not loaded yet
  const oldest = _portfolio
    .filter(i => i.last_value_updated)
    .map(i => new Date(i.last_value_updated))
    .sort((a, b) => a - b)[0];
  if (oldest) {
    const today = new Date();
    const totalDays = Math.round((today.getTime() - oldest.getTime()) / 86400000);
    el.textContent = `${totalDays}d of history`;
    el.style.fontSize = '12px';
  } else {
    el.textContent = 'Tap to view chart';
    el.style.fontSize = '12px';
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Portfolio row click → card detail modal ─────────────────────── */
function rowClick(id) {
  const item = _portfolio.find(i => i.id === id);
  if (!item) return;
  openCardDetailModal(item, null);
}
window.rowClick = rowClick;

/* ── Refresh portfolio values ────────────────────────────────────── */
async function refreshPortfolioValues(silent = false) {
  if (!_portfolio.length) { if (!silent) toast('No items in portfolio', 'info'); return; }
  if (!silent) toast('Refreshing values…', 'info');

  const today = new Date().toISOString().split('T')[0];
  let updated = 0;

  for (const item of _portfolio) {
    try {
      // Call the server-side proxy — it writes to price_history_cache automatically
      const action = item.type === 'sealed' ? 'sealed' : 'search';
      const params = new URLSearchParams({ action, name: item.name, language: item.language || 'english', limit: '5' });
      if (item.set_name) params.set('set', item.set_name);

      const resp = await fetch(`/api/pokeprice?${params}`);
      if (!resp.ok) continue;
      const { results } = await resp.json();
      if (!results?.length) continue;

      const match = results.find(r => String(r.tcgPlayerId || r.id || r.productId) === String(item.item_id)) || results[0];
      const priceUsd = extractPrice(match);
      if (priceUsd == null) continue;

      const valueSgd = parseFloat((priceUsd * _fxRate).toFixed(2));
      const now = new Date().toISOString();

      await _sb.from('portfolio_items')
        .update({ current_value: valueSgd, last_value_updated: now })
        .eq('id', item.id);

      // Write price history (one row per item per day)
      await _sb.from('price_history').upsert({
        user_id:           _user.id,
        portfolio_item_id: item.id,
        recorded_date:     today,
        value_sgd:         valueSgd,
      }, { onConflict: 'portfolio_item_id,recorded_date' });

      item.current_value      = valueSgd;
      item.last_value_updated = now;
      updated++;
    } catch (_) {}
  }

  renderPortfolioTable();
  renderPortfolioMetrics();
  updateHistoryDaysDisplay();
  if (!silent) toast(`Updated ${updated} of ${_portfolio.length} items`, updated ? 'success' : 'info');
}
window.refreshPortfolioValues = refreshPortfolioValues;

function extractPrice(r) {
  if (!r) return null;
  return r.prices?.market ?? r.prices?.lowPrice ?? r.prices?.midPrice
      ?? r.japanesePrice ?? r.averagePrice ?? r.marketPrice ?? r.unopenedPrice
      ?? r.price ?? null;
}

/* ── Portfolio search (add items) ────────────────────────────────── */
function pfSearchDebounce() {
  clearTimeout(_pfDebounce);
  _pfDebounce = setTimeout(pfSearch, 400);
}
window.pfSearchDebounce = pfSearchDebounce;

function pfSetSearchLang(lang) {
  _pfSearchLang = lang;
  document.querySelectorAll('.pf-lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}
window.pfSetSearchLang = pfSetSearchLang;

function pfSetSearchType(type) {
  _pfSearchType = type;
  document.getElementById('pf-type-cards' )?.classList.toggle('active', type === 'cards');
  document.getElementById('pf-type-sealed')?.classList.toggle('active', type === 'sealed');
}
window.pfSetSearchType = pfSetSearchType;

async function pfSearch() {
  const q    = document.getElementById('pf-search-input')?.value?.trim();
  const set  = document.getElementById('pf-set-input')?.value?.trim();
  const box  = document.getElementById('pf-search-results');
  if (!q || !box) return;

  box.style.display = 'block';
  box.innerHTML = `<div style="padding:14px;color:var(--text3);font-size:13px;display:flex;align-items:center;gap:8px;"><div class="spinner" style="width:18px;height:18px;margin:0;"></div> Searching…</div>`;

  try {
    const action = _pfSearchType === 'sealed' ? 'sealed' : 'search';
    const params = new URLSearchParams({ action, name: q, language: _pfSearchLang, limit: '20' });
    if (set) params.set('set', set);

    const resp = await fetch(`/api/pokeprice?${params}`);
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const { results } = await resp.json();

    if (!results?.length) {
      box.innerHTML = `<div style="padding:14px;color:var(--text3);font-size:13px;">No results found.</div>`;
      return;
    }

    box.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;padding-top:14px;">
      ${results.slice(0, 12).map(r => pfResultCard(r)).join('')}
    </div>`;
  } catch (err) {
    box.innerHTML = `<div style="padding:14px;color:var(--red);font-size:13px;">Search failed: ${esc(err.message)}</div>`;
  }
}
window.pfSearch = pfSearch;

function pfResultCard(r) {
  const priceUsd = extractPrice(r);
  const priceSgd = priceUsd != null ? (priceUsd * _fxRate).toFixed(2) : null;
  const name = r.name || r.cardName || r.productName || 'Unknown';
  const setN = r.setName || r.set?.name || '';
  const img  = r.imageUrl || r.image || '';
  const key  = storeResult(r);

  return `<div class="result-card" style="cursor:default;">
    <div class="card-img-wrap" style="min-height:100px;padding:10px;">
      ${img ? `<img src="${esc(img)}" style="max-height:100px;object-fit:contain;border-radius:4px;" loading="lazy" />` : '<span style="font-size:28px;">🃏</span>'}
    </div>
    <div class="card-info">
      <div class="card-name">${esc(name)}</div>
      ${setN ? `<div class="card-set">${esc(setN)}</div>` : ''}
      <div class="card-price">${priceSgd ? `SGD $${priceSgd}` : '—'}</div>
    </div>
    <div class="card-actions">
      <button class="btn-add-pf" onclick="openPortfolioAddModal(getResult('${key}'))">+ Portfolio</button>
    </div>
  </div>`;
}

/* ── Portfolio add modal ─────────────────────────────────────────── */
let _addModalItem = null;

function openPortfolioAddModal(r) {
  _addModalItem = r;
  const name = r.name || r.cardName || r.productName || 'Unknown';
  const setN = r.setName || r.set?.name || '';
  const img  = r.imageUrl || r.image || '';
  const type = _pfSearchType;

  // Pre-fill price
  const priceUsd = extractPrice(r);
  const priceSgd = priceUsd != null ? (priceUsd * _fxRate).toFixed(2) : '';

  document.getElementById('pf-item-name').textContent  = name;
  document.getElementById('pf-item-set').textContent   = setN;
  document.getElementById('pf-item-type').textContent  = type === 'sealed' ? '📦 Sealed product' : '🃏 Card';
  const imgEl = document.getElementById('pf-item-img');
  if (imgEl) { imgEl.src = img; imgEl.style.display = img ? '' : 'none'; }

  document.getElementById('pf-purchase-price').value = priceSgd;
  document.getElementById('pf-quantity').value = '1';
  document.getElementById('pf-notes').value    = '';

  // Populate condition options
  const condSelect = document.getElementById('pf-condition');
  if (condSelect) {
    const grades = ['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged',
                    'PSA 10','PSA 9','PSA 8','PSA 7','CGC 10','CGC 9.5','CGC 9','BGS 10','BGS 9.5'];
    condSelect.innerHTML = grades.map(g => `<option value="${g}">${g}</option>`).join('');
  }

  showOverlay('portfolio-add-overlay');
}
window.openPortfolioAddModal = openPortfolioAddModal;

async function savePortfolioItem() {
  const r         = _addModalItem;
  if (!r || !_user) return;

  const purchasePrice = parseFloat(document.getElementById('pf-purchase-price').value);
  const qty           = parseInt(document.getElementById('pf-quantity').value, 10) || 1;
  const condition     = document.getElementById('pf-condition').value || 'Near Mint';
  const notes         = document.getElementById('pf-notes').value.trim();

  if (isNaN(purchasePrice) || purchasePrice < 0) { toast('Enter a valid purchase price', 'error'); return; }

  const name    = r.name || r.cardName || r.productName || 'Unknown';
  const setName = r.setName || r.set?.name || '';
  const img     = r.imageUrl || r.image || '';
  const itemId  = String(r.tcgPlayerId || r.id || r.productId || Date.now());
  const type    = _pfSearchType === 'sealed' ? 'sealed' : 'card';

  const { error } = await _sb.from('portfolio_items').insert({
    user_id:            _user.id,
    item_id:            itemId,
    type,
    name,
    set_name:           setName,
    image_url:          img,
    language:           _pfSearchLang,
    purchase_price:     purchasePrice,
    quantity:           qty,
    condition_or_grade: condition,
    notes:              notes || null,
  });

  if (error) { toast('Failed to add item', 'error'); return; }

  closeOverlay('portfolio-add-overlay');
  document.getElementById('pf-search-results').style.display = 'none';
  document.getElementById('pf-search-input').value = '';
  toast(`Added ${name} to portfolio`, 'success');
  await loadPortfolio();
}
window.savePortfolioItem = savePortfolioItem;

function closePortfolioAddModal() { closeOverlay('portfolio-add-overlay'); }
window.closePortfolioAddModal = closePortfolioAddModal;

/* ── Remove portfolio item ───────────────────────────────────────── */
async function removePortfolioItem(id) {
  const item = _portfolio.find(i => i.id === id);
  const confirmed = await confirm_(`Remove ${item?.name || 'item'} from portfolio?`);
  if (!confirmed) return;

  const { error } = await _sb.from('portfolio_items').delete().eq('id', id);
  if (error) { toast('Failed to remove item', 'error'); return; }
  toast('Item removed', 'success');
  await loadPortfolio();
}
window.removePortfolioItem = removePortfolioItem;

/* ── Sell modal ──────────────────────────────────────────────────── */
let _sellItemId = null;

function openSellModal(id) {
  const item = _portfolio.find(i => i.id === id);
  if (!item) return;
  _sellItemId = id;

  document.getElementById('sell-item-name').textContent = item.name || '—';
  document.getElementById('sell-item-meta').textContent =
    `${item.set_name || ''} · ${item.condition_or_grade || 'NM'} · qty ${item.quantity || 1}`;
  document.getElementById('sell-cost-hint').textContent =
    `Purchase price: ${fmtSgd(parseFloat(item.purchase_price || 0) * (item.quantity || 1))}`;

  const img = document.getElementById('sell-item-img');
  const ico = document.getElementById('sell-item-icon');
  if (item.image_url) {
    img.src = item.image_url; img.style.display = '';
    if (ico) ico.style.display = 'none';
  } else {
    img.style.display = 'none';
    if (ico) { ico.textContent = '🃏'; ico.style.display = ''; }
  }

  document.getElementById('sell-price').value = item.current_value || '';
  document.getElementById('sell-date').value  = new Date().toISOString().split('T')[0];

  showOverlay('sell-overlay');
}
window.openSellModal = openSellModal;

async function confirmSellItem() {
  const price = parseFloat(document.getElementById('sell-price').value);
  const date  = document.getElementById('sell-date').value;
  if (isNaN(price) || price < 0) { toast('Enter a valid sale price', 'error'); return; }
  if (!date) { toast('Select a date', 'error'); return; }

  const { error } = await _sb.from('portfolio_items')
    .update({ sold: true, sold_price: price, sold_date: date })
    .eq('id', _sellItemId);

  if (error) { toast('Failed to record sale', 'error'); return; }
  closeSellModal();
  toast('Sale recorded', 'success');
  await loadPortfolio();
}
window.confirmSellItem = confirmSellItem;

function closeSellModal() { closeOverlay('sell-overlay'); }
window.closeSellModal = closeSellModal;

/* ── Main search (search tab) ────────────────────────────────────── */
function initSearch() {
  const searchBtn  = document.getElementById('search-btn');
  const searchInp  = document.getElementById('search-input');

  if (searchBtn)  searchBtn.addEventListener('click', doSearch);
  if (searchInp)  searchInp.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  if (searchInp)  searchInp.addEventListener('input', () => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(doSearch, 500);
  });

  // Language toggle
  document.querySelectorAll('.lang-btn:not(.pf-lang-btn)').forEach(btn => {
    btn.addEventListener('click', () => {
      _searchLang = btn.dataset.lang;
      document.querySelectorAll('.lang-btn:not(.pf-lang-btn)').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Type toggle
  document.querySelectorAll('.search-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _searchType = btn.dataset.type;
      document.querySelectorAll('.search-type-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // View toggle
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _viewMode = btn.dataset.view;
      document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b === btn));
      const grid = document.getElementById('results-grid');
      if (grid) grid.classList.toggle('list-view', _viewMode === 'list');
    });
  });

  // Hint chips
  document.querySelectorAll('.hint-chip, .example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q    = chip.dataset.query;
      const lang = chip.dataset.lang;
      if (q) {
        const inp = document.getElementById('search-input');
        if (inp) inp.value = q;
        if (lang) {
          _searchLang = lang;
          document.querySelectorAll('.lang-btn:not(.pf-lang-btn)').forEach(b =>
            b.classList.toggle('active', b.dataset.lang === lang));
        }
        doSearch();
      }
    });
  });
}

function showState(id) {
  ['welcome-state','loading','empty-state','error-state'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? 'block' : 'none';
  });
  const grid = document.getElementById('results-grid');
  const bar  = document.getElementById('status-bar');
  if (grid) grid.classList.add('hidden');
  if (bar)  bar.classList.add('hidden');
}

async function doSearch() {
  const q   = document.getElementById('search-input')?.value?.trim();
  const set = document.getElementById('set-input')?.value?.trim();
  if (!q) { showState('welcome-state'); return; }

  showState('loading');
  try {
    const action = _searchType === 'sealed' ? 'sealed' : 'search';
    const params = new URLSearchParams({ action, name: q, language: _searchLang, limit: '40' });
    if (set) params.set('set', set);

    const resp = await fetch(`/api/pokeprice?${params}`);
    if (!resp.ok) throw new Error(`API error ${resp.status}`);
    const { results } = await resp.json();

    if (!results?.length) { showState('empty-state'); return; }

    const grid    = document.getElementById('results-grid');
    const bar     = document.getElementById('status-bar');
    const countEl = document.getElementById('result-count');

    grid.innerHTML = results.map(r => buildResultCard(r)).join('');
    grid.classList.remove('hidden');
    grid.classList.toggle('list-view', _viewMode === 'list');
    if (countEl) countEl.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;
    if (bar)  bar.classList.remove('hidden');

    ['welcome-state','loading','empty-state','error-state'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  } catch (err) {
    const errEl = document.getElementById('error-msg');
    if (errEl) errEl.textContent = err.message;
    showState('error-state');
  }
}

function buildResultCard(r) {
  const priceUsd = extractPrice(r);
  const priceSgd = priceUsd != null ? (priceUsd * _fxRate).toFixed(2) : null;
  const name = r.name || r.cardName || r.productName || 'Unknown';
  const setN = r.setName || r.set?.name || '';
  const img  = r.imageUrl || r.image || '';
  const num  = r.cardNumber ? `#${r.cardNumber}` : '';
  const key  = storeResult(r);

  if (_viewMode === 'list') {
    return `<div class="result-card list-item" onclick="openSearchDetail('${key}')">
      <div class="card-img-wrap">
        ${img ? `<img src="${esc(img)}" loading="lazy" />` : '<span style="font-size:22px;">🃏</span>'}
      </div>
      <div class="card-info" style="flex-direction:row;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="flex:2;min-width:140px;">
          <div class="card-name">${esc(name)}</div>
          <div class="card-set">${esc(setN)}${num ? ' · ' + num : ''}</div>
        </div>
        <div class="card-price" style="margin-top:0;">${priceSgd ? `SGD $${priceSgd}` : '—'}</div>
      </div>
      <div class="card-actions" onclick="event.stopPropagation()">
        <button class="btn-add-pf" onclick="switchMainTab('portfolio');openPortfolioAddModal(getResult('${key}'))">+ Portfolio</button>
      </div>
    </div>`;
  }

  return `<div class="result-card" onclick="openSearchDetail('${key}')">
    <div class="card-img-wrap">
      ${img ? `<img src="${esc(img)}" loading="lazy" />` : '<span style="font-size:28px;">🃏</span>'}
    </div>
    <div class="card-info">
      <div class="card-name">${esc(name)}</div>
      ${setN ? `<div class="card-set">${esc(setN)}${num ? ' · ' + num : ''}</div>` : ''}
      <div class="card-price">${priceSgd ? `SGD $${priceSgd}` : '—'}</div>
      ${r.prices?.lowPrice  ? `<div class="card-price-sub">Low: SGD $${(r.prices.lowPrice  * _fxRate).toFixed(2)}</div>` : ''}
      ${r.prices?.highPrice ? `<div class="card-price-sub">High: SGD $${(r.prices.highPrice * _fxRate).toFixed(2)}</div>` : ''}
    </div>
    <div class="card-actions" onclick="event.stopPropagation()">
      <button class="btn-add-pf" onclick="switchMainTab('portfolio');openPortfolioAddModal(getResult('${key}'))">+ Portfolio</button>
      <button class="btn-detail" onclick="openSearchDetail('${key}')">Detail</button>
    </div>
  </div>`;
}

/* ── Search detail modal ─────────────────────────────────────────── */
function openSearchDetail(keyOrObj) {
  const r = typeof keyOrObj === 'string' ? getResult(keyOrObj) : keyOrObj;
  if (!r) return;
  const key = typeof keyOrObj === 'string' ? keyOrObj : storeResult(r);
  const priceUsd = extractPrice(r);
  const priceSgd = priceUsd != null ? (priceUsd * _fxRate).toFixed(2) : null;
  const name = r.name || r.cardName || r.productName || 'Unknown';
  const setN = r.setName || r.set?.name || '';
  const img  = r.imageUrl || r.image || '';
  const num  = r.cardNumber ? `#${r.cardNumber}` : '';

  const content = document.getElementById('modal-content');
  if (!content) return;

  content.innerHTML = `
    <div style="padding:24px;">
      <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:20px;">
        ${img ? `<img src="${esc(img)}" style="width:80px;height:110px;object-fit:contain;border-radius:8px;background:var(--bg3);flex-shrink:0;" loading="lazy" />` : ''}
        <div style="flex:1;">
          <div style="font-family:var(--font-display);font-size:17px;font-weight:800;color:var(--text);margin-bottom:4px;">${esc(name)}</div>
          ${setN ? `<div style="font-family:var(--font-mono);font-size:12px;color:var(--text3);">${esc(setN)}${num ? ' · ' + num : ''}</div>` : ''}
          ${priceSgd ? `<div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--accent);margin-top:10px;">SGD $${priceSgd}</div>` : ''}
        </div>
      </div>
      ${(r.prices?.lowPrice || r.prices?.midPrice || r.prices?.highPrice) ? `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px;">
        ${r.prices?.lowPrice  ? `<div class="cdm-price-cell"><div class="cdm-price-label">Low</div><div class="cdm-price-val">$${(r.prices.lowPrice  * _fxRate).toFixed(2)}</div></div>` : ''}
        ${r.prices?.midPrice  ? `<div class="cdm-price-cell"><div class="cdm-price-label">Mid</div><div class="cdm-price-val">$${(r.prices.midPrice  * _fxRate).toFixed(2)}</div></div>` : ''}
        ${r.prices?.highPrice ? `<div class="cdm-price-cell"><div class="cdm-price-label">High</div><div class="cdm-price-val">$${(r.prices.highPrice * _fxRate).toFixed(2)}</div></div>` : ''}
      </div>` : ''}
      <button class="btn-search" style="width:100%;" onclick="switchMainTab('portfolio');openPortfolioAddModal(getResult('` + key + `'));_destroyModal()">+ Add to Portfolio</button>
    </div>`;

  showOverlay('modal-overlay');
}
window.openSearchDetail = openSearchDetail;

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  _destroyModal();
}
function _destroyModal() { closeOverlay('modal-overlay'); }
window.closeModal  = closeModal;
window._destroyModal = _destroyModal;

/* ── P/L Dashboard ───────────────────────────────────────────────── */
function openPLDashboard() {
  renderPLDashboard();
  showOverlay('pl-overlay');
}
window.openPLDashboard = openPLDashboard;

function closePLDashboard(e) {
  if (e && e.target !== document.getElementById('pl-overlay')) return;
  closeOverlay('pl-overlay');
}
window.closePLDashboard = closePLDashboard;

function switchPLTab(tab) {
  ['current','history'].forEach(t => {
    document.getElementById(`pl-nav-${t}`)?.classList.toggle('active', t === tab);
    document.getElementById(`pl-panel-${t}`)?.classList.toggle('active', t === tab);
  });
}
window.switchPLTab = switchPLTab;

function renderPLDashboard() {
  // Current holdings summary
  const totalCost  = _portfolio.reduce((s,i) => s + parseFloat(i.purchase_price||0) * (i.quantity||1), 0);
  const totalValue = _portfolio.reduce((s,i) => {
    const v = i.current_value != null ? parseFloat(i.current_value) * (i.quantity||1) : null;
    return v != null ? s + v : s;
  }, 0);
  const pl = totalValue - totalCost;

  setText('pl-current-total', `${pl >= 0 ? '+' : ''}${fmtSgd(pl)}`);
  setText('pl-current-cost',  fmtSgd(totalCost));
  setText('pl-current-value', fmtSgd(totalValue));

  const plEl = document.getElementById('pl-current-total');
  if (plEl) plEl.style.color = pl >= 0 ? 'var(--accent)' : 'var(--red)';

  // Top movers
  const moversEl = document.getElementById('pl-movers-content');
  if (moversEl) {
    const ranked = _portfolio
      .filter(i => i.current_value != null)
      .map(i => {
        const cost  = parseFloat(i.purchase_price||0) * (i.quantity||1);
        const value = parseFloat(i.current_value) * (i.quantity||1);
        const pl    = value - cost;
        const pct   = cost > 0 ? (pl / cost) * 100 : 0;
        return { ...i, pl, pct, value };
      })
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

    if (!ranked.length) {
      moversEl.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:16px 0;">Refresh values to see movers.</div>`;
    } else {
      const maxAbs = Math.max(...ranked.map(i => Math.abs(i.pct)), 1);
      moversEl.innerHTML = `<div class="movers-section-label">Top Movers by % change</div>` +
        ranked.slice(0, 8).map((item, idx) => `
          <div class="mover-row">
            <div class="mover-rank">#${idx + 1}</div>
            ${item.image_url ? `<img src="${esc(item.image_url)}" style="width:28px;height:40px;object-fit:contain;border-radius:3px;flex-shrink:0;" loading="lazy">` : ''}
            <div class="mover-info">
              <div class="mover-name">${esc(item.name)}</div>
              <div class="mover-meta">${esc(item.set_name || '—')}</div>
              <div class="mover-bar-wrap">
                <div class="mover-bar" style="width:${Math.min(Math.abs(item.pct)/maxAbs*100,100)}%;background:${item.pl >= 0 ? 'var(--accent)' : 'var(--red)'};"></div>
              </div>
            </div>
            <div class="mover-stats">
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:${item.pl >= 0 ? 'var(--accent)' : 'var(--red)'};">
                ${item.pl >= 0 ? '+' : ''}${fmtPct(item.pct)}
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px;">${item.pl >= 0 ? '+' : ''}${fmtSgd(item.pl)}</div>
            </div>
          </div>`).join('');
    }
  }

  // Sold transactions
  const lifeCost = _soldItems.reduce((s,i) => s + parseFloat(i.purchase_price||0) * (i.quantity||1), 0);
  const lifeRev  = _soldItems.reduce((s,i) => s + parseFloat(i.sold_price||0), 0);
  const lifePL   = lifeRev - lifeCost;
  setText('pl-lifetime-total',   `${lifePL >= 0 ? '+' : ''}${fmtSgd(lifePL)}`);
  setText('pl-lifetime-cost',    fmtSgd(lifeCost));
  setText('pl-lifetime-revenue', fmtSgd(lifeRev));
  const ltEl = document.getElementById('pl-lifetime-total');
  if (ltEl) ltEl.style.color = lifePL >= 0 ? 'var(--accent)' : 'var(--red)';

  const histTbody = document.getElementById('pl-history-table');
  if (histTbody) {
    if (!_soldItems.length) {
      histTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text3);">No sold items yet.</td></tr>`;
    } else {
      histTbody.innerHTML = _soldItems.map(item => {
        const cost    = parseFloat(item.purchase_price||0) * (item.quantity||1);
        const sold    = parseFloat(item.sold_price||0);
        const pl      = sold - cost;
        const roi     = cost > 0 ? (pl / cost) * 100 : 0;
        const plClass = pl >= 0 ? 'td-pos' : 'td-neg';
        return `<tr>
          <td><div style="font-weight:600;font-size:13px;">${esc(item.name)}</div><div style="font-size:11px;color:var(--text3);">${esc(item.set_name||'')}</div></td>
          <td class="td-mono">${item.quantity||1}</td>
          <td class="td-mono">${fmtSgd(cost)}</td>
          <td class="td-mono">${fmtSgd(sold)}</td>
          <td style="font-size:12px;color:var(--text3);">${item.sold_date || '—'}</td>
          <td class="${plClass}">${pl >= 0 ? '+' : ''}${fmtSgd(pl)}</td>
          <td class="${plClass}">${fmtPct(roi)}</td>
        </tr>`;
      }).join('');
    }
  }
}

/* ── Portfolio chart modal ───────────────────────────────────────── */
function openPortfolioChartModal() {
  showOverlay('portfolio-chart-overlay');
  loadPortfolioChart();
}
window.openPortfolioChartModal = openPortfolioChartModal;

function closePortfolioChartModal(e) {
  if (e && e.target !== document.getElementById('portfolio-chart-overlay')) return;
  closeOverlay('portfolio-chart-overlay');
}
window.closePortfolioChartModal = closePortfolioChartModal;

async function loadPortfolioChart() {
  const loading  = document.getElementById('portfolio-chart-loading');
  const canvas   = document.getElementById('portfolio-chart-canvas');
  const errorEl  = document.getElementById('portfolio-chart-error');
  if (!canvas) return;
  if (loading)  loading.style.display = 'flex';
  if (canvas)   canvas.style.display  = 'none';
  if (errorEl)  errorEl.style.display = 'none';

  try {
    // Chart anchors at (account creation date − 10 days) → today.
    // This is a fixed start point: it never rolls forward as time passes.
    // e.g. account created Jun 26 → chart always starts Jun 16, grows to the right each day.

    // Fetch account creation date from profiles table
    let accountCreatedAt = null;
    try {
      const { data: profile } = await _sb
        .from('profiles')
        .select('created_at')
        .eq('id', _user.id)
        .single();
      if (profile?.created_at) accountCreatedAt = new Date(profile.created_at);
    } catch (_) {}

    // Fallback: use the user's auth created_at if profiles row missing
    if (!accountCreatedAt && _user?.created_at) {
      accountCreatedAt = new Date(_user.created_at);
    }
    if (!accountCreatedAt) accountCreatedAt = new Date();

    // Anchor: 10 days before account creation (fixed forever)
    const windowStart = new Date(accountCreatedAt);
    windowStart.setDate(windowStart.getDate() - 10);
    const windowEnd = new Date(); // always today

    const startStr = windowStart.toISOString().split('T')[0];
    const endStr   = windowEnd.toISOString().split('T')[0];

    const { data, error } = await _sb
      .from('price_history')
      .select('recorded_date, value_sgd, portfolio_item_id')
      .eq('user_id', _user.id)
      .gte('recorded_date', startStr)
      .lte('recorded_date', endStr)
      .order('recorded_date', { ascending: true });

    if (error || !data?.length) throw new Error('No history data');

    // Aggregate by date — sum all item values per day
    const byDate = {};
    data.forEach(row => {
      if (!byDate[row.recorded_date]) byDate[row.recorded_date] = 0;
      byDate[row.recorded_date] += parseFloat(row.value_sgd);
    });

    // Build full date range from anchor → today, filling gaps with null
    const allDates = [];
    for (let d = new Date(windowStart); d <= windowEnd; d.setDate(d.getDate() + 1)) {
      allDates.push(d.toISOString().split('T')[0]);
    }

    // Format labels as "Jun 16" style
    const fmt = dt => {
      const [, m, day] = dt.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(m, 10) - 1]} ${parseInt(day, 10)}`;
    };

    const labels = allDates.map(fmt);
    const values = allDates.map(d => byDate[d] ?? null);

    if (loading) loading.style.display = 'none';
    canvas.style.display = 'block';

    if (_portfolioChart) _portfolioChart.destroy();
    _portfolioChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Portfolio Value (SGD)',
          data: values,
          borderColor: '#00e5cc',
          backgroundColor: 'rgba(0,229,204,0.08)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#00e5cc',
          fill: true,
          tension: 0.3,
          spanGaps: true,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#8c95ad', font: { family: 'JetBrains Mono', size: 11 } } },
          tooltip: {
            backgroundColor: '#13161f',
            borderColor: 'rgba(255,255,255,.07)',
            borderWidth: 1,
            titleColor: '#e2e6f0',
            bodyColor: '#00e5cc',
            callbacks: {
              label: ctx => `SGD $${ctx.parsed.y.toFixed(2)}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#4e566b', maxTicksLimit: 8, font: { size: 11 } }, grid: { color: 'rgba(255,255,255,.04)' } },
          y: { ticks: { color: '#4e566b', callback: v => `$${v.toFixed(0)}`, font: { size: 11 } }, grid: { color: 'rgba(255,255,255,.04)' } },
        },
      },
    });
  } catch (err) {
    if (loading) loading.style.display = 'none';
    if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = 'No history data available yet. Try refreshing your portfolio values first.'; }
  }
}

/* ── Trade Analyser ──────────────────────────────────────────────── */
function openTradeAnalyser() {
  _trade = { my: [], their: [] };
  updateTradeUI();
  showOverlay('trade-overlay');
}
window.openTradeAnalyser = openTradeAnalyser;

function closeTradeAnalyser(e) {
  if (e && e.target !== document.getElementById('trade-overlay')) return;
  closeOverlay('trade-overlay');
}
window.closeTradeAnalyser = closeTradeAnalyser;

function openTradeSearch(side) {
  _tradeSide = side;
  document.getElementById('trade-search-side-label').textContent = side === 'my' ? 'Your side' : 'Their side';
  document.getElementById('trade-search-input').value = '';
  document.getElementById('trade-search-results-box').innerHTML = '';
  document.getElementById('trade-custom-panel').style.display = 'none';
  showOverlay('trade-search-overlay');
}
window.openTradeSearch = openTradeSearch;

function closeTradeSearch() { closeOverlay('trade-search-overlay'); }
window.closeTradeSearch = closeTradeSearch;

function setTradeLang(lang) {
  _tradeLang = lang;
  document.querySelectorAll('.trade-lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}
function setTradeType(type) {
  _tradeType = type;
  document.querySelectorAll('.trade-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
}
window.setTradeLang = setTradeLang;
window.setTradeType = setTradeType;

function tradeSearchDebounce() {
  clearTimeout(_tradeDebounce);
  _tradeDebounce = setTimeout(doTradeSearch, 400);
}
window.tradeSearchDebounce = tradeSearchDebounce;

async function doTradeSearch() {
  const q   = document.getElementById('trade-search-input')?.value?.trim();
  const box = document.getElementById('trade-search-results-box');
  if (!q || !box) return;

  box.innerHTML = `<div style="padding:10px;color:var(--text3);font-size:12px;display:flex;gap:8px;align-items:center;"><div class="spinner" style="width:16px;height:16px;margin:0;"></div>Searching…</div>`;

  try {
    const action = _tradeType === 'sealed' ? 'sealed' : 'search';
    const params = new URLSearchParams({ action, name: q, language: _tradeLang, limit: '10' });
    const resp = await fetch(`/api/pokeprice?${params}`);
    if (!resp.ok) throw new Error('API error');
    const { results } = await resp.json();

    if (!results?.length) { box.innerHTML = `<div style="padding:10px;color:var(--text3);font-size:12px;">No results.</div>`; return; }

    box.innerHTML = results.slice(0, 8).map(r => {
      const priceUsd = extractPrice(r);
      const priceSgd = priceUsd != null ? (priceUsd * _fxRate).toFixed(2) : null;
      const name = r.name || r.cardName || r.productName || 'Unknown';
      const key  = storeResult(r);
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer;" onclick="selectTradeResult('${key}')">
        ${r.imageUrl || r.image ? `<img src="${esc(r.imageUrl || r.image)}" style="width:24px;height:34px;object-fit:contain;border-radius:3px;flex-shrink:0;" loading="lazy">` : '<span style="font-size:18px;width:24px;text-align:center;">🃏</span>'}
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(name)}</div>
          <div style="font-size:10px;color:var(--text3);">${esc(r.setName || r.set?.name || '')}</div>
        </div>
        <div style="font-family:var(--font-mono);font-size:12px;color:var(--accent);flex-shrink:0;">${priceSgd ? `$${priceSgd}` : '—'}</div>
      </div>`;
    }).join('');
  } catch (err) {
    box.innerHTML = `<div style="padding:10px;color:var(--red);font-size:12px;">Search failed.</div>`;
  }
}
window.doTradeSearch = doTradeSearch;

function selectTradeResult(keyOrObj) {
  const r = typeof keyOrObj === 'string' ? getResult(keyOrObj) : keyOrObj;
  if (!r) return;
  _tradePending = r;
  const priceUsd = extractPrice(r);
  const priceSgd = priceUsd != null ? (priceUsd * _fxRate).toFixed(2) : '';
  const name = r.name || r.cardName || r.productName || 'Unknown';

  document.getElementById('trade-custom-name').textContent = name;
  document.getElementById('trade-custom-price').value = priceSgd;
  document.getElementById('trade-custom-panel').style.display = 'block';
  document.getElementById('trade-search-results-box').innerHTML = '';
}
window.selectTradeResult = selectTradeResult;

function confirmTradeItem() {
  const r = _tradePending;
  if (!r) return;
  const name     = r.name || r.cardName || r.productName || 'Unknown';
  const img      = r.imageUrl || r.image || '';
  const valueSgd = parseFloat(document.getElementById('trade-custom-price').value);
  if (isNaN(valueSgd) || valueSgd < 0) { toast('Enter a valid value', 'error'); return; }

  _trade[_tradeSide].push({ name, img, valueSgd });
  updateTradeUI();
  closeTradeSearch();
}
window.confirmTradeItem = confirmTradeItem;

function removeTradeItem(side, idx) {
  _trade[side].splice(idx, 1);
  updateTradeUI();
}
window.removeTradeItem = removeTradeItem;

function addFromPortfolioToTrade(side) {
  _tradeSide = side;
  const picker = document.getElementById('trade-portfolio-picker');
  if (!picker) return;

  const list = document.getElementById('trade-portfolio-picker-list');
  if (!list) return;

  if (!_portfolio.length) {
    list.innerHTML = `<div style="padding:14px;font-size:12px;color:var(--text3);">No portfolio items.</div>`;
  } else {
    list.innerHTML = _portfolio.map((item, idx) => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer;"
           onclick="addPortfolioItemToTrade(${idx})">
        ${item.image_url ? `<img src="${esc(item.image_url)}" style="width:24px;height:34px;object-fit:contain;border-radius:3px;flex-shrink:0;">` : '<span style="font-size:18px;width:24px;text-align:center;">🃏</span>'}
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item.name)}</div>
          <div style="font-size:10px;color:var(--text3);">${fmtSgd(item.current_value)}</div>
        </div>
      </div>`).join('');
  }
  picker.style.display = picker.style.display === 'block' ? 'none' : 'block';
}
window.addFromPortfolioToTrade = addFromPortfolioToTrade;

function addPortfolioItemToTrade(idx) {
  const item = _portfolio[idx];
  if (!item) return;
  const valueSgd = item.current_value != null ? parseFloat(item.current_value) * (item.quantity||1) : 0;
  _trade[_tradeSide].push({ name: item.name, img: item.image_url || '', valueSgd });
  document.getElementById('trade-portfolio-picker').style.display = 'none';
  updateTradeUI();
}
window.addPortfolioItemToTrade = addPortfolioItemToTrade;

function closePortfolioPicker() {
  const p = document.getElementById('trade-portfolio-picker');
  if (p) p.style.display = 'none';
}
window.closePortfolioPicker = closePortfolioPicker;

function updateTradeUI() {
  renderTradeSide('my');
  renderTradeSide('their');
  updateTradeVerdict();
}

function renderTradeSide(side) {
  const items    = _trade[side];
  const totalSgd = items.reduce((s, i) => s + (i.valueSgd || 0), 0);
  const totalEl  = document.getElementById(`trade-${side}-total`);
  const effEl    = document.getElementById(`trade-${side}-effective`);
  const listEl   = document.getElementById(`trade-${side}-items`);

  if (totalEl) totalEl.textContent = fmtSgd(totalSgd);

  // Effective (with cash)
  const cashDir    = document.getElementById('trade-cash-dir')?.value || 'none';
  const cashAmount = parseFloat(document.getElementById('trade-cash-amount')?.value || 0) || 0;
  let eff = totalSgd;
  if (cashDir === 'i_pay'    && side === 'my')    eff += cashAmount;
  if (cashDir === 'they_pay' && side === 'their') eff += cashAmount;
  if (effEl && cashAmount > 0 && cashDir !== 'none') {
    effEl.textContent = `Effective: ${fmtSgd(eff)}`;
  } else if (effEl) { effEl.textContent = ''; }

  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML = `<div class="trade-empty-side">Add items</div>`;
    return;
  }
  listEl.innerHTML = items.map((item, idx) => `
    <div class="trade-item-row">
      ${item.img ? `<img class="trade-item-thumb" src="${esc(item.img)}" loading="lazy">` : '<span class="trade-item-emoji">🃏</span>'}
      <div class="trade-item-info">
        <div class="trade-item-name">${esc(item.name)}</div>
        <div class="trade-item-val">${fmtSgd(item.valueSgd)}</div>
      </div>
      <button class="trade-remove-btn" onclick="removeTradeItem('${side}',${idx})">✕</button>
    </div>`).join('');
}

function updateTradeVerdict() {
  renderTradeSide('my');
  renderTradeSide('their');

  const myTotal    = _trade.my.reduce((s, i)    => s + (i.valueSgd || 0), 0);
  const theirTotal = _trade.their.reduce((s, i) => s + (i.valueSgd || 0), 0);
  const cashDir    = document.getElementById('trade-cash-dir')?.value || 'none';
  const cashAmt    = parseFloat(document.getElementById('trade-cash-amount')?.value || 0) || 0;

  let myEff    = myTotal;
  let theirEff = theirTotal;
  if (cashDir === 'i_pay')    myEff    += cashAmt;
  if (cashDir === 'they_pay') theirEff += cashAmt;

  const verdictEl = document.getElementById('trade-verdict');
  if (!verdictEl) return;

  if (!_trade.my.length && !_trade.their.length) {
    verdictEl.innerHTML = `<div class="trade-verdict-placeholder">Add items to both sides to analyse the trade.</div>`;
    return;
  }
  if (!myEff && !theirEff) { verdictEl.innerHTML = `<div class="trade-verdict-placeholder">Add items to both sides.</div>`; return; }

  const diff    = myEff - theirEff;
  const diffPct = theirEff > 0 ? (diff / theirEff) * 100 : 0;
  const absPct  = Math.abs(diffPct);

  let cls, emoji, title, advice;
  if (absPct <= 5) {
    cls = 'verdict-fair'; emoji = '✅'; title = 'Fair Deal';
    advice = `Values are within ${absPct.toFixed(1)}% of each other — this is a fair trade.`;
  } else if (absPct <= 15) {
    cls = 'verdict-warn'; emoji = '⚠️'; title = diff > 0 ? 'Slightly Unfavourable' : 'Slightly Favourable';
    advice = diff > 0
      ? `You're giving ${absPct.toFixed(1)}% more in value. Negotiate or ask for a small cash top-up.`
      : `You're getting ${absPct.toFixed(1)}% more in value — a slight win for you.`;
  } else {
    cls = 'verdict-bad'; emoji = diff > 0 ? '❌' : '🎯'; title = diff > 0 ? 'Bad Deal for You' : 'Great Deal for You';
    advice = diff > 0
      ? `You're giving ${absPct.toFixed(1)}% more in value — this trade heavily favours them.`
      : `You're getting ${absPct.toFixed(1)}% more in value — this is a very good deal for you.`;
  }

  verdictEl.innerHTML = `<div class="trade-verdict-card ${cls}">
    <div class="trade-verdict-emoji">${emoji}</div>
    <div class="trade-verdict-title">${title}</div>
    <div class="trade-verdict-advice">${advice}</div>
    <div class="trade-verdict-breakdown">
      <div class="trade-breakdown-row"><span>Your side</span><span style="font-family:var(--font-mono);">${fmtSgd(myEff)}</span></div>
      <div class="trade-breakdown-row"><span>Their side</span><span style="font-family:var(--font-mono);">${fmtSgd(theirEff)}</span></div>
      ${cashAmt > 0 ? `<div class="trade-breakdown-row" style="color:var(--text3);font-size:12px;"><span>Cash (${cashDir === 'i_pay' ? 'you pay' : 'they pay'})</span><span style="font-family:var(--font-mono);">${fmtSgd(cashAmt)}</span></div>` : ''}
      <div class="trade-breakdown-row" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border);">
        <span style="font-weight:700;">Difference</span>
        <span style="font-family:var(--font-mono);color:${Math.abs(diff) < 1 ? 'var(--text)' : diff > 0 ? 'var(--red)' : 'var(--accent)'};">
          ${diff >= 0 ? '+' : ''}${fmtSgd(diff)} (${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%)
        </span>
      </div>
    </div>
  </div>`;
}
window.updateTradeVerdict = updateTradeVerdict;

/* ── Confirm dialog ──────────────────────────────────────────────── */
function confirm_(msg) {
  return new Promise(resolve => {
    const overlay  = document.getElementById('confirm-overlay');
    const msgEl    = document.getElementById('confirm-message');
    const okBtn    = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    if (!overlay) { resolve(window.confirm(msg)); return; }

    msgEl.textContent = msg;
    showOverlay('confirm-overlay');

    const cleanup = () => closeOverlay('confirm-overlay');
    okBtn.onclick = () => { cleanup(); resolve(true); };
    cancelBtn.onclick = () => { cleanup(); resolve(false); };
  });
}

/* ── Overlay helpers ─────────────────────────────────────────────── */
function showOverlay(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); el.style.display = 'flex'; }
}
function closeOverlay(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('open'); el.style.display = 'none'; }
}

/* ── Card detail modal (exposed for inline script in index.html) ──── */
// The openCardDetailModal / switchCardDetailTab / closeCardDetailModal
// functions are defined in the inline <script> block inside index.html.
// They rely on _fxRate being set globally (done in initAuth above).

/* ── Keyboard shortcuts ──────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['modal-overlay','card-detail-overlay','portfolio-chart-overlay',
     'pl-overlay','sell-overlay','portfolio-add-overlay',
     'trade-overlay','trade-search-overlay','confirm-overlay'].forEach(closeOverlay);
  }
  // Cmd/Ctrl+K → focus search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    switchMainTab('search');
    setTimeout(() => document.getElementById('search-input')?.focus(), 50);
  }
});

/* ── Init ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Show portfolio tab by default
  document.getElementById('tab-portfolio')?.classList.add('active');
  document.getElementById('tab-portfolio').style.display = 'block';
  document.getElementById('tab-search').style.display    = 'none';

  initSearch();
  initAuth();
});
