# Changelog — tellmeitsgood.com

All notable changes to this project are documented here.
Format: Version · Date · What changed · Why

---

## v0.6.6 — 2026-03-18

### Fixed
- Session wiped after Stripe redirect. Two bad ideas removed:
  1. `storageKey: 'tmig-auth'` — custom key caused Supabase to look
     in a different localStorage slot than where the session was saved,
     making every returning visit appear logged out.
  2. `refreshSession()` fallback — when called with no valid session,
     Supabase internally calls signOut() which actively clears localStorage,
     making things worse instead of better.
- Reverted to plain `supabase.createClient()` with no extra auth options.
  Supabase's defaults handle persistence and token refresh correctly.

---

## v0.6.5 — 2026-03-18

### Fixed
- Nav bar slow to appear on Brave and privacy-focused browsers.
  `updateAuthBar()` previously only ran after the full async chain
  (getSession → checkProStatus network call). Now renders immediately
  with logged-out defaults, then silently updates once auth resolves.
  Nav is visible instantly on every browser.

---

## v0.6.4 — 2026-03-18

### Fixed
- Pro upgrade not activating after payment. Root cause: `setUserPro()` in
  `api/stripe-webhook.js` used PATCH which silently does nothing if the
  profiles row doesn't exist (users who signed up before the trigger was
  added have no row). Switched to POST with `Prefer: resolution=merge-duplicates`
  (Supabase upsert) — creates the row if missing, updates it if present.

---

## v0.6.3 — 2026-03-18

### Fixed
- Session lost after returning from Stripe checkout. Two fixes:
  1. Explicit Supabase auth options: `persistSession`, `autoRefreshToken`,
     `detectSessionInUrl`, and a fixed `storageKey: 'tmig-auth'` so the
     storage key never varies between environments.
  2. `initAuth()` now calls `refreshSession()` as a fallback if `getSession()`
     returns null (happens when the Web Lock is broken by the AbortError).

### Added
- Post-payment banner — when Stripe redirects back with `?upgraded=1`:
  - Shows a purple "Payment received!" strip for 8 seconds.
  - Signed-in users: told to refresh if Pro hasn't activated yet.
  - Signed-out users: told to sign in to activate Pro.
  - URL param is cleaned immediately so refreshing doesn't retrigger it.

### Setup required
- In Stripe → Payment Link → Edit → After payment → Redirect URL:
  change to `https://tellmeitsgood.com?upgraded=1`

---

## v0.6.2 — 2026-03-18

### Added
- Settings gear icon (⚙) in auth bar for all logged-in users.
  Rotates 30deg on hover. Replaces inline email + sign-out clutter.
- Settings modal — opens from gear icon. Shows:
  - Account section: email address, hint to change via re-sign-in
  - Subscription section: plan status with clear Free vs Pro label
  - Free users: "Upgrade to Pro — $9/month" button
  - Pro users: "⭐ Pro — 25 searches/day" + Manage subscription button
  - Sign out button at the bottom

### Changed
- Auth bar right side: replaced email + sign-out + Pro badge with
  a single gear icon. Cleaner and scales better on mobile.
- Sign out moved from auth bar into the settings modal.

---

## v0.6.1 — 2026-03-18

### Fixed
- Vercel build failure: `.claude/worktrees/` was accidentally tracked
  by git as a submodule, causing `git clone` to fail during Vercel build.
  Removed from git index and added `.gitignore`.

### Added
- `.gitignore` — excludes `.claude/`, `.DS_Store`, `node_modules/`, `*.zip`.

### Changed
- History gated to Pro users only. Free logged-in users see
  "⭐ Upgrade for history" button instead of the History button.
  Searches are still saved for all logged-in users — visible on upgrade.

---

## v0.6.0 — 2026-03-18

### Added — Stripe subscription integration

- `api/stripe-webhook.js` — serverless webhook handler.
  Verifies Stripe HMAC-SHA256 signature without the Stripe SDK (no package.json needed).
  On `checkout.session.completed`, reads `client_reference_id` (Supabase user ID)
  and sets `profiles.is_pro = true` via service role key.
  Uses `bodyParser: false` config so Vercel doesn't pre-parse the raw body.
- `handleProCheckout()` — redirects to Stripe Payment Link with
  `client_reference_id` (user ID) and `prefilled_email` as query params
  so the webhook can identify the paying user without a separate lookup.

### New Vercel env var required
  `STRIPE_WEBHOOK_SECRET` — from Stripe → Developers → Webhooks → signing secret

### Stripe setup (one-time)
- Create product: "Tell Me It's Good Pro", $1/month (test), $9/month (live)
- Create Payment Link for that product
- Add webhook endpoint: `https://tellmeitsgood.com/api/stripe-webhook`
- Listen for: `checkout.session.completed`
- In Payment Link settings → After payment → Redirect to `https://tellmeitsgood.com`

---

## v0.5.3 — 2026-03-18

### Fixed
- History modal broken — items did nothing when clicked. Root cause: double
  JSON.stringify in the onclick handler created a string-of-a-string that
  JSON.parse couldn't handle. Fixed by storing full_result objects in
  window._historyCache keyed by row ID. onclick now just passes the ID.

### Added
- Animated loading messages — cycles every 3.5s through 7 entertaining
  stages: "Checking quality reviews..." → "Sniffing out the ingredients..."
  → "Investigating the company..." → "Crunching the scores..." etc.
  URL mode starts with scrape messages, switches to research messages after ~6s.
- Buy Now button — appears below verdict when Claude returns a productUrl.
  Green + "✓ Buy this — it earned the badge →" for TELL_ME_ITS_GOOD products.
  Grey "View product page →" for others. Amazon URLs auto-get affiliate tag
  appended: ?tag=tellmeitsgood-20 (replace with real Associates tag).
- Sign-up nudge — shown to logged-out users below verdict:
  "Like this verdict? Sign up free to save your searches." Hidden when logged in.
- Rotating example chips — pool of 14 mission-aligned products, 5 shown at
  random on each page load and after each search completes.
- Mobile-first layout — gates grid is 1-column on mobile, 3-column on 520px+.
  Page padding tightened (32px mobile, 60px desktop). Headline scales down.
  Input card padding reduced on mobile.

### Changed
- Headline: "The trusted place to discover products worth buying."
- Subheadline: "High quality. Non-toxic. From honest companies. AI-researched
  so it stays current — not sponsored, not curated by ads."
- Footer: "Quality · Non-toxic · Honest companies · Powered by AI · No ads"

---

## v0.5.2 — 2026-03-18

### Fixed
- Supabase "Failed to fetch" on sign-in — placeholders were never replaced.
  Real credentials now hardcoded in index.html.
- Supabase redirect sending to localhost — fix: set Site URL to
  https://tellmeitsgood.com in Supabase → Authentication → URL Configuration.

### Changed
- Auth bar: taller (60px), white background, stronger border + shadow.
  Usage pill: 13px bold, high-contrast warning colours.
  Sign-in: solid blue button ("Sign in / Sign up") instead of dim underlined link.
- Submit button: full width, centered, taller (48px).
- Tab order: "Search by name" is now first/default tab.
- Paywall banner: moved to below input card and example chips.

---

## v0.5.1 — 2026-03-18

### Changed
- Example chips updated to mission-aligned products.
- Tab order: "Search by name" first. activeTab default changed to 'name'.
- Paywall banner moved below input card.
- resetApp() resets to 'name' tab.

---

## v0.5.0 — 2026-03-18

### Added — Pro tier infrastructure

- `api/save-search.js` — saves full research JSON to Supabase after every search.
- History modal — last 50 searches, click to re-display instantly.
- Free tier: 3 searches/day in localStorage. Usage pill in auth bar.
- Paywall banner + dimmed input card when limit reached.
- Pro upgrade modal: $9/month, lists features.

### Supabase tables required
```sql
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
CREATE POLICY "Users can read own searches" ON searches FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE profiles (
  id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_pro   boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$ BEGIN INSERT INTO public.profiles (id) VALUES (new.id); RETURN new; END; $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

### Vercel env vars required
- `SUPABASE_SERVICE_ROLE_KEY`

---

## v0.4.1 — 2026-03-18

### Fixed
- research.js: `max_tokens` raised from 3000 → 6000.
- research.js: Replaced regex JSON extraction with `extractOutermostJson()`.
- index.html: User-friendly error messages, rate limit retry time shown.

### Added
- `api/_rateLimit.js`: Shared in-memory rate limiting.
  - /api/research: 5 req/IP/hour
  - /api/post: 10 req/IP/hour
  - /api/scrape: 20 req/IP/hour

---

## v0.4.0 — 2026-03-18

### Added
- Supabase magic link authentication.
- Auth header bar: sign in / sign out, session restored on reload.
- Magic link modal with email input and success state.

---

## v0.3.0 — 2026-03-18

### Added
- `api/research.js` — Triple Filter scoring engine (15 criteria, 3 gates).
- `api/post.js` — listing post generator.
- Name search tab, Triple Filter results UI, badge system.
- Resilient JSON parsing with `extractOutermostJson()`.

---

## v0.2.0 — 2026-02-01

### Added
- `api/verdict.js` — first Claude integration.
- `api/scrape.js` — Firecrawl integration.
- Migrated from GitHub Pages to Vercel.

---

## v0.1.0 — 2026-01-15

### Added
- Initial build. Single index.html, vanilla JS, Calm Design OS tokens,
  light + dark mode, demo mode.

---

## Upcoming

- Fix Pro webhook: confirm `client_reference_id` is passed through Stripe Payment Link
- Directory UI — curated product listings that passed the Triple Filter
- Amazon affiliate tag (replace `tellmeitsgood-20` placeholder)
- Stripe live mode switch (remove `test_` from payment link)
