# PokéVault

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

## Step 1 — Set up Supabase

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Choose a name, region closest to you (e.g. Singapore), and a strong database password. Save the password somewhere safe.
3. Wait for the project to provision (~1 min).

### Run the schema

4. In your Supabase dashboard, go to **SQL Editor → New Query**
5. Paste the entire contents of `supabase_schema_v17.sql` and click **Run**
6. You should see "Success. No rows returned." — that's correct.

### Get your Supabase credentials

7. Go to **Project Settings → API**
8. Copy:
   - **Project URL** — looks like `https://xxxxxxxxxxxx.supabase.co`
   - **anon / public key** — the long `eyJ...` string under "Project API keys"
   - **service_role key** — click "Reveal" on the service_role row (keep this secret!)

### Paste credentials into the code

You need to update two files with your Supabase project URL and anon key:

**`public/js/app.js`** — find these two lines near the top and replace:
```js
const SUPABASE_URL      = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

**`public/login.html`** — find these two lines inside the `<script>` block and replace:
```js
const SUPABASE_URL      = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

> The anon key is safe to put in frontend code — it's public by design.
> The service_role key is **only** used server-side via Vercel environment variables (never in frontend code).

### Disable email confirmation (important)

9. In Supabase dashboard: **Authentication → Providers → Email**
10. Turn **"Confirm email"** OFF — PokéVault uses username-only auth via the admin API and doesn't send confirmation emails.

---

## Step 2 — Push to GitHub

```bash
# In the folder containing this README:
git init
git add .
git commit -m "PokéVault initial commit"

# Create a new GitHub repo (using GitHub CLI):
gh repo create pokevault --public --push --source .

# Or manually: go to github.com/new, create the repo, then:
git remote add origin https://github.com/YOUR_USERNAME/pokevault.git
git branch -M main
git push -u origin main
```

---

## Step 3 — Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **"Import Git Repository"** and select your `pokevault` repo
3. Leave all build settings as default (no framework, no build command)
4. **Before clicking Deploy**, click **"Environment Variables"** and add:

| Variable name | Value |
|---|---|
| `POKEPRICE_API_KEY` | Your PokémonPriceTracker API bearer token |
| `SUPABASE_URL` | Your Supabase project URL (`https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Your Supabase **service_role** key (not the anon key) |

5. Click **Deploy** — it will be live in ~30 seconds.
6. Your app URL will be something like `https://pokevault-xyz.vercel.app`

### Custom domain (optional)

In your Vercel project: **Settings → Domains → Add** your domain, then update your DNS records as instructed.

---

## Step 4 — Create your first account

1. Visit your Vercel URL
2. You'll be redirected to `/login` automatically
3. Click **Sign Up**, choose a username (letters/numbers/underscores, 3–30 chars) and password
4. You're in — start adding cards to your portfolio!

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
