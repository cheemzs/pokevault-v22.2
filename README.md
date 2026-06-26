# PokéVault 22.2

Pokémon card & sealed product portfolio tracker with live TCG prices, price history chart, P/L dashboard, and trade analyser. Fully mobile-responsive.

---

## What's in this version

| Feature | Notes |
|---|---|
| Live prices | PokémonPriceTracker API (USD → SGD) |
| Price history chart | Anchors at account-creation − 10 days, grows forever |
| Supabase price cache | Each card's daily price stored in `price_history_cache` — no repeat API calls |
| Manual refresh | "↻ Refresh values" button on portfolio tab |
| P/L Dashboard | Unrealised P/L, top movers, sold transactions |
| Trade Analyser | Compare trade values side-by-side |
| Mobile support | Full responsive layout, bottom-sheet modals, iOS zoom fix |
| **No paid services** | Runs entirely on Vercel Hobby (free) + Supabase free tier |

---

## Prerequisites

| Service | Free tier needed | What for |
|---|---|---|
| [Vercel](https://vercel.com) | Hobby (free) | Hosting + serverless API functions |
| [Supabase](https://supabase.com) | Free tier | Database + auth |
| [PokémonPriceTracker API](https://www.pokemonpricetracker.com) | Paid API key | Live card prices |
| [GitHub](https://github.com) | Free | Source repo (needed for Vercel deploy) |

---



## Price history chart behaviour

The chart is anchored to **your account creation date minus 10 days** and grows forward forever:

- Sign up on Jun 26 → chart starts Jun 16, ends today
- Use the app until Aug 16 → chart shows Jun 16 – Aug 16
- The start date never moves; only the right edge extends as you use the app

To record price history: click **↻ Refresh values** on the portfolio tab. Each refresh writes one row per card per day. Refreshing multiple times the same day uses the cached price (no extra API calls).

---

## Price cache behaviour

Each time you hit Refresh:
1. App checks `price_history_cache` for today's price for each card
2. If found → uses cached USD price, no API call made
3. If not found → calls PokémonPriceTracker API, writes result to cache

This means you can refresh as many times as you like on the same day without burning API quota. The cache is keyed by `(item_id, type, language, date)`.

---

## Local development

```bash
# Install Vercel CLI globally (one-time)
npm install -g vercel

# In the project folder:
vercel dev
```

Create a `.env.local` file (never commit this):
```
POKEPRICE_API_KEY=your_key_here
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key_here
```

Then open `http://localhost:3000`.

---

## File structure

```
pokevault/
├── api/
│   ├── auth.js          # Signup/signin proxy (uses Supabase admin API)
│   ├── pokeprice.js     # Price lookup proxy (PokémonPriceTracker API)
│   └── search.js        # Search proxy
├── public/
│   ├── css/style.css    # All styles (dark theme, fully responsive)
│   ├── js/app.js        # All frontend logic
│   ├── index.html       # Main app
│   ├── login.html       # Auth page
│   └── logo.jpeg
├── supabase_schema_v17.sql   # Run this once in Supabase SQL Editor
├── vercel.json          # Routing config
├── package.json
└── README.md
```

---

## Cost breakdown

| Service | Plan | Cost |
|---|---|---|
| Vercel | Hobby | **Free** |
| Supabase | Free tier (500 MB DB, 50k MAU) | **Free** |
| PokémonPriceTracker API | Paid (your existing key) | Your current plan |

No cron jobs, no background workers, no paid add-ons required.
