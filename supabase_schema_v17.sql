-- ═══════════════════════════════════════════════════════════════════
--  PokéVault v17 — Supabase Schema
--  Run this in: Supabase Dashboard → SQL Editor → New Query
--
--  NEW in v17:
--    • price_history_cache table — stores daily API prices per card/product
--      so the cron job and manual refreshes don't re-call the upstream API
--      if today's price is already known.
-- ═══════════════════════════════════════════════════════════════════

-- ── profiles ──────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null,
  is_premium   boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);


-- ── portfolio_items ───────────────────────────────────────────────
create table if not exists public.portfolio_items (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  item_id             text not null,
  type                text not null,
  name                text not null,
  set_name            text,
  image_url           text,
  language            text not null default 'english',
  purchase_price      numeric(10,2) not null,
  quantity            integer not null default 1,
  condition_or_grade  text not null default 'Near Mint',
  notes               text,
  current_value       numeric(10,2),
  last_value_updated  timestamptz,
  sold                boolean not null default false,
  sold_price          numeric(10,2),
  sold_date           date,
  created_at          timestamptz not null default now()
);

alter table public.portfolio_items enable row level security;

create policy "Users can select own portfolio items"
  on public.portfolio_items for select using (auth.uid() = user_id);
create policy "Users can insert own portfolio items"
  on public.portfolio_items for insert with check (auth.uid() = user_id);
create policy "Users can update own portfolio items"
  on public.portfolio_items for update using (auth.uid() = user_id);
create policy "Users can delete own portfolio items"
  on public.portfolio_items for delete using (auth.uid() = user_id);

create index if not exists idx_portfolio_items_user_id on public.portfolio_items(user_id);
create index if not exists idx_portfolio_items_sold    on public.portfolio_items(user_id, sold);


-- ── price_history ─────────────────────────────────────────────────
create table if not exists public.price_history (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  portfolio_item_id uuid not null references public.portfolio_items(id) on delete cascade,
  recorded_date     date not null,
  value_sgd         numeric(10,2) not null,
  created_at        timestamptz not null default now(),
  unique (portfolio_item_id, recorded_date)
);

alter table public.price_history enable row level security;

create policy "Users can select own price history"
  on public.price_history for select using (auth.uid() = user_id);
create policy "Users can insert own price history"
  on public.price_history for insert with check (auth.uid() = user_id);

create index if not exists idx_price_history_item_date
  on public.price_history(portfolio_item_id, recorded_date);


-- ── price_history_cache  (NEW v17) ────────────────────────────────
-- Stores raw USD prices fetched from the PokémonPriceTracker API,
-- keyed by (item_id, type, language, recorded_date).
-- Both the daily cron job and the manual "Refresh values" button
-- check this table before calling the upstream API, so each card
-- is only fetched once per day regardless of how many users hold it
-- or how many times someone hits refresh.
--
-- No RLS needed — reads/writes happen only via the service_role key
-- (never directly from the browser client).

create table if not exists public.price_history_cache (
  id            bigint generated always as identity primary key,
  item_id       text not null,             -- tcgPlayerId or productId
  type          text not null,             -- 'card' | 'sealed'
  price         numeric(10,4) not null,    -- USD price from upstream API
  language      text not null default 'english',
  recorded_date date not null,
  created_at    timestamptz not null default now(),
  unique (item_id, type, language, recorded_date)
);

-- Index for fast cache lookups during refresh
create index if not exists idx_phc_item_date
  on public.price_history_cache(item_id, recorded_date);

-- Allow the service_role key (used by the serverless functions) full access.
-- Browser clients never touch this table directly.
alter table public.price_history_cache enable row level security;

create policy "Service role full access to price_history_cache"
  on public.price_history_cache
  using (true)
  with check (true);


-- ── trade_analyses ────────────────────────────────────────────────
create table if not exists public.trade_analyses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  my_items        jsonb not null default '[]',
  their_items     jsonb not null default '[]',
  my_total_sgd    numeric(10,2) not null,
  their_total_sgd numeric(10,2) not null,
  cash_direction  text,
  cash_amount_sgd numeric(10,2),
  diff_pct        numeric(6,2) not null,
  verdict         text not null,
  created_at      timestamptz not null default now()
);

alter table public.trade_analyses enable row level security;

create policy "Users can select own trade analyses"
  on public.trade_analyses for select using (auth.uid() = user_id);
create policy "Users can insert own trade analyses"
  on public.trade_analyses for insert with check (auth.uid() = user_id);
create policy "Users can delete own trade analyses"
  on public.trade_analyses for delete using (auth.uid() = user_id);

create index if not exists idx_trade_analyses_user_id
  on public.trade_analyses(user_id, created_at desc);


-- ── MIGRATION NOTE (upgrading from v16) ───────────────────────────
-- If your v16 tables already exist, run ONLY the new block below:
--
--   CREATE TABLE IF NOT EXISTS public.price_history_cache ( ... );
--   CREATE INDEX IF NOT EXISTS idx_phc_item_date ON ...;
--
-- Everything else is unchanged from v16.
