// api/pokeprice.js
// Vercel serverless proxy for PokémonPriceTracker API v2.
//
// Required env vars (set in Vercel dashboard):
//   POKEPRICE_API_KEY      — PokémonPriceTracker API bearer token
//   SUPABASE_URL           — your Supabase project URL
//   SUPABASE_SERVICE_KEY   — Supabase service_role key (never sent to client)

const BASE = 'https://www.pokemonpricetracker.com/api/v2';

// Exhaustive list of parameters the upstream API actually accepts.
// Any key NOT in this set is silently dropped before the request is sent.
const ALLOWED_UPSTREAM_PARAMS = new Set([
  'tcgPlayerId',
  'search',
  'setId',
  'setName',
  'set',
  'minPrice',
  'maxPrice',
  'limit',
  'offset',
  'sortBy',
  'sortOrder',
  'includeHistory',
  'days',
  'fetchAllInSet',
  'language',
]);

// ── Limit cap logic ───────────────────────────────────────────────────────────
// Standard:                     max 200
// includeHistory=true:          max 100
// (no eBay param — it was not in the allowed list; graded data is unavailable
//  via this endpoint per the error response the API returns)
function resolvedLimit(raw, wantHistory) {
  const requested = parseInt(raw, 10) || 20;
  if (wantHistory) return Math.min(requested, 100);
  return Math.min(requested, 200);
}

// ── Safe URLSearchParams builder ──────────────────────────────────────────────
// Accepts an object of candidate key/value pairs, drops any key not in
// ALLOWED_UPSTREAM_PARAMS, then returns a URLSearchParams instance.
function safeParams(candidates) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(candidates)) {
    if (v == null || v === '') continue;
    if (!ALLOWED_UPSTREAM_PARAMS.has(k)) {
      console.warn(`[pokeprice proxy] Dropping disallowed param: ${k}`);
      continue;
    }
    p.set(k, String(v));
  }
  return p;
}

// ── Supabase cache writer (fire-and-forget, never blocks the response) ────────
async function sbInsertCacheRows(rows) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !rows.length) return;
  try {
    await fetch(`${url}/rest/v1/price_history_cache`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates',
      },
      body: JSON.stringify(rows),
    });
  } catch (e) {
    console.warn('Supabase cache write failed (non-fatal):', e.message);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS — allows the browser to call /api/pokeprice from the same Vercel domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.POKEPRICE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'POKEPRICE_API_KEY is not set in Vercel environment variables.',
    });
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json',
  };

  // Destructure only params we actually intend to use internally.
  // Any others that arrive from the client are simply ignored.
  const {
    action,
    name,
    set,
    id,
    language,
    days,
    includeHistory,
    limit: clientLimit,
    offset,
    sortBy,
    sortOrder,
  } = req.query;

  const lang        = language === 'japanese' ? 'japanese' : 'english';
  const historyDays = parseInt(days, 10) || 0;
  const wantHistory = includeHistory === 'true' && historyDays > 0;

  const today = new Date().toISOString().split('T')[0];

  // Normalise API response shape to a flat results array
  function toResults(data) {
    return Array.isArray(data.data) ? data.data
         : (data.data ? [data.data] : []);
  }

  // Extract the best available market price from a result object
  function extractPrice(r) {
    return r.prices?.market
        ?? r.prices?.lowPrice
        ?? r.prices?.midPrice
        ?? r.japanesePrice
        ?? r.averagePrice
        ?? r.marketPrice
        ?? r.price
        ?? null;
  }

  // Write standard price snapshots to Supabase cache
  function cacheResults(results, type) {
    const priceRows = results
      .map(r => {
        const price  = type === 'sealed'
          ? (r.unopenedPrice ?? r.marketPrice ?? null)
          : extractPrice(r);
        const itemId = String(r.tcgPlayerId || r.id || r.productId || '').trim();
        if (price == null || !itemId) return null;
        return {
          item_id:       itemId,
          type,
          price:         Number(price),
          language:      lang,
          recorded_date: today,
        };
      })
      .filter(Boolean);

    if (priceRows.length) sbInsertCacheRows(priceRows);
  }

  // ── action=search  (card name / set search) ───────────────────────────────
  if (action === 'search') {
    if (!name) return res.status(400).json({ error: 'Missing param: name' });

    const searchStr = set ? `${name.trim()} ${set.trim()}` : name.trim();
    const lim       = resolvedLimit(clientLimit || 20, wantHistory);

    const candidates = {
      language:      lang,
      search:        searchStr,
      limit:         lim,
    };
    if (wantHistory) {
      candidates.includeHistory = 'true';
      candidates.days           = String(historyDays);
    }
    if (offset)    candidates.offset    = offset;
    if (sortBy)    candidates.sortBy    = sortBy;
    if (sortOrder) candidates.sortOrder = sortOrder;

    const params = safeParams(candidates);

    try {
      const upstream = await fetch(`${BASE}/cards?${params}`, { headers });
      const body     = await upstream.text();
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: 'Upstream error', detail: body });
      }
      const data    = JSON.parse(body);
      const results = toResults(data);
      cacheResults(results, 'card');
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
      return res.status(200).json({ results, metadata: data.metadata ?? {} });
    } catch (err) {
      return res.status(500).json({ error: 'Fetch failed', detail: err.message });
    }
  }

  // ── action=bynumber  (exact card number, e.g. 199/165) ───────────────────
  if (action === 'bynumber') {
    if (!name) return res.status(400).json({ error: 'Missing param: name (card number)' });

    const lim = resolvedLimit(clientLimit || 30, wantHistory);

    const candidates = {
      language: lang,
      search:   name.trim(),
      limit:    lim,
    };
    if (set)         candidates.set           = set.trim();
    if (wantHistory) {
      candidates.includeHistory = 'true';
      candidates.days           = String(historyDays);
    }

    const params = safeParams(candidates);

    try {
      const upstream = await fetch(`${BASE}/cards?${params}`, { headers });
      const body     = await upstream.text();
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: 'Upstream error', detail: body });
      }
      const data = JSON.parse(body);
      const all  = toResults(data);
      const num  = name.trim().toLowerCase();

      const matched = all.filter(r => {
        const cn   = (r.cardNumber || '').toLowerCase();
        const full = `${cn}/${r.totalSetNumber || ''}`.toLowerCase();
        return cn === num || full === num || full.startsWith(num + '/');
      });
      const results = matched.length ? matched : all;
      cacheResults(results, 'card');
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
      return res.status(200).json({ results, metadata: data.metadata ?? {} });
    } catch (err) {
      return res.status(500).json({ error: 'Fetch failed', detail: err.message });
    }
  }

  // ── action=sealed  (sealed products — MUST use /sealed-products endpoint) ─
  if (action === 'sealed') {
    const lim = resolvedLimit(clientLimit || 20, false); // history not supported for sealed

    const candidates = {
      language: lang,
      limit:    lim,
    };
    if (name) candidates.search = name.trim();
    if (set)  candidates.set    = set.trim();

    const params = safeParams(candidates);

    try {
      const upstream = await fetch(`${BASE}/sealed-products?${params}`, { headers });
      const body     = await upstream.text();
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: 'Upstream error', detail: body });
      }
      const data    = JSON.parse(body);
      const results = toResults(data);
      cacheResults(results, 'sealed');
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
      return res.status(200).json({ results, metadata: data.metadata ?? {} });
    } catch (err) {
      return res.status(500).json({ error: 'Fetch failed', detail: err.message });
    }
  }

  // ── action=card  (single card by TCGPlayer ID) ────────────────────────────
  if (action === 'card') {
    if (!id) return res.status(400).json({ error: 'Missing param: id' });

    const lim = resolvedLimit(1, wantHistory);

    const candidates = {
      language:    lang,
      tcgPlayerId: id.trim(),
      limit:       lim,
    };
    if (wantHistory) {
      candidates.includeHistory = 'true';
      candidates.days           = String(historyDays);
    }

    const params = safeParams(candidates);

    try {
      const upstream = await fetch(`${BASE}/cards?${params}`, { headers });
      const body     = await upstream.text();
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: 'Upstream error', detail: body });
      }
      const data    = JSON.parse(body);
      const results = toResults(data);
      cacheResults(results, 'card');
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
      return res.status(200).json({ results, metadata: data.metadata ?? {} });
    } catch (err) {
      return res.status(500).json({ error: 'Fetch failed', detail: err.message });
    }
  }

  return res.status(400).json({
    error: 'Invalid action. Valid values: search | bynumber | sealed | card',
  });
};
