# Changelog — tellmeitsgood.com

All notable changes to this project are documented here.
Format: Version · Date · What changed · Why

---

## v0.4.0 — 2026-03-18

### Added
- Supabase magic link authentication — Layer 1.
- Auth header bar at top of every page:
  - Logged out: "Sign in to save searches" link (subtle, non-intrusive)
  - Logged in: user email + Sign out button
- Magic link modal with email input, send state, and success confirmation.
- `onAuthStateChange` listener — UI updates automatically when auth state changes.
- `initAuth()` on page load — restores session from localStorage so users
  stay logged in across page refreshes and tab closes.
- Supabase JS client loaded via CDN (no npm/build tools needed).
- Keyboard support: Enter submits modal email form, Escape closes modal.
- Backdrop click closes modal.
- All auth JS heavily commented for learning.

### Setup required (one-time)
- Create free Supabase project at supabase.com
- Enable Email provider in Authentication → Providers
- Set Site URL + Redirect URL to https://tellmeitsgood.vercel.app
- Replace SUPABASE_URL and SUPABASE_ANON_KEY placeholders in index.html
- (No Vercel env vars needed — anon key is safe to expose in frontend JS)

### Not built yet (next session)
- Search history table in Supabase
- Saving verdicts to user account
- Viewing past searches

---

## v0.3.0 — 2026-03-18

### Added
- `api/research.js` — Triple Filter scoring engine. Replaces verdict.js as the
  core AI analysis route. Scores 15 criteria across three gates (Value & Quality,
  Clean & Safe, Ethical Company) using Claude with web search enabled. Returns
  cited sources for every score.
- `api/post.js` — Listing post generator. Takes scored research JSON and produces
  a human-voiced product write-up: hook, verdict paragraph, gate summaries, who
  it's for, who it's not, bottom line.
- Name search input — users can now type a product name instead of pasting a URL.
  Goes straight to research.js with a `query` param, no scraping needed.
- Triple Filter results UI — overall TMIG score, three gate cards with pass/fail
  status, expandable criteria accordions with per-criterion scores and source links.
- Badge system — products earn TELL_ME_ITS_GOOD, CLEAN_PICK, ETHICAL_PICK,
  QUALITY_PICK, or NOT_LISTED based on which gates they pass.
- Auto-generated listing post — after scores load, post.js is called automatically
  and the written verdict fades in below.
- Resilient JSON parsing — regex extraction of JSON from Claude responses so
  accidental prose preambles don't break the parser.

### Changed
- `index.html` — full rebuild. New headline "Buy less. Buy better.", tab switcher
  for URL vs name input, results section rebuilt around Triple Filter output.
- verdict.js flow replaced by research.js throughout the UI.

### Removed
- Direct dependency on verdict.js for main analysis flow. File kept in repo but
  no longer called from index.html.

---

## v0.2.0 — 2026-02-01

### Added
- `api/verdict.js` — first Claude integration.
- `api/scrape.js` — Firecrawl integration.
- Two-stage loading states, fallback textarea, score bar animations.
- Brand tax callout box. Vercel Analytics script tag.

### Changed
- Migrated from GitHub Pages to Vercel for serverless function support.
- API keys moved to Vercel environment variables.

---

## v0.1.0 — 2026-01-15

### Added
- Initial build. Single index.html, vanilla JS, no frameworks.
- Calm Design OS tokens, light + dark mode, demo mode, example chips, reset flow.

---

## Upcoming

- Save search history to Supabase (requires auth — now built)
- Directory UI — curated product listings that passed the Triple Filter
- Email capture via Tally.so
- DNS pointed correctly at Vercel

---

## v0.4.1 — 2026-03-18

### Fixed
- research.js: `max_tokens` raised from 3000 → 6000. The 15-criteria JSON
  response with web search results frequently exceeded 3000 tokens, causing
  truncated responses that failed JSON parsing.
- research.js: Replaced regex JSON extraction with `extractOutermostJson()` —
  a brace-depth-tracking parser that correctly finds the outermost { } block
  even when Claude prepends prose like "Based on my research..." despite
  being instructed not to.
- index.html: Error messages now show clean, user-friendly text instead of
  raw JSON parse errors. Rate limit errors show retry time.

### Added
- api/_rateLimit.js: Shared in-memory rate limiting utility.
- Rate limits applied to all three API routes:
  - /api/research: 5 requests per IP per hour (most expensive — Claude + web search)
  - /api/post: 10 requests per IP per hour
  - /api/scrape: 20 requests per IP per hour
- Rate limit headers on all responses: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After

---

## v0.5.0 — 2026-03-18

### Added — Pro tier infrastructure

**Search history (logged-in users)**
- api/save-search.js — new serverless function. Verifies user session
  server-side, writes result to Supabase searches table.
- After every successful research, saves full JSON to Supabase automatically.
- "Saved to your history" confirmation strip fades in on results page.
- History modal — shows last 50 searches, sorted newest first. Click any
  row to re-display that result instantly without a new API call.
- History button in auth bar, visible only when logged in.

**Usage tracking & paywall**
- Free tier: 3 searches/day tracked in localStorage (resets at midnight).
- Usage pill in auth bar shows searches remaining. Turns amber at 1, red at 0.
- Paywall banner appears when free limit is reached: "You've used your 3 free searches".
- Input card dimmed and submit button disabled when paywalled.
- Paywall shows "Go Pro" and "Sign in if you have an account" CTAs.

**Pro upgrade modal**
- Lists Pro features: 25 searches/day, full history, priority access.
- Price: $9/month.
- Pro CTA button — currently shows contact message. Replace with Stripe
  Checkout link when ready: window.location.href = 'https://buy.stripe.com/...'

**Auth bar refresh**
- Left side: usage pill (logged out) or History button (logged in).
- Right side: Pro badge / Go Pro button + email + Sign out (logged in),
  or Sign in link (logged out).
- Pro badge shown if profiles.is_pro = true in Supabase.

### Supabase tables required
Run this SQL in Supabase → SQL Editor before deploying:

  CREATE TABLE searches (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    product_name text NOT NULL,
    brand        text,
    price        text,
    badge        text,
    overall_score numeric(4,1),
    full_result  jsonb NOT NULL,
    created_at   timestamptz DEFAULT now() NOT NULL
  );

  ALTER TABLE searches ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Users can read own searches"
    ON searches FOR SELECT
    USING (auth.uid() = user_id);

  CREATE TABLE profiles (
    id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    is_pro   boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now()
  );

  ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Users can read own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

  CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger AS $$
  BEGIN
    INSERT INTO public.profiles (id) VALUES (new.id);
    RETURN new;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

### New Vercel env var required
  SUPABASE_SERVICE_ROLE_KEY — from Supabase → Settings → API → service_role key
  (This is SECRET — never put it in frontend JS)

### TODO: Stripe integration
  In index.html handleProCheckout(), replace the alert with:
  window.location.href = 'https://buy.stripe.com/YOUR_LINK';
  After payment, use a Stripe webhook to set profiles.is_pro = true.
