# Changelog — tellmeitsgood.com

All notable changes to this project are documented here.
Format: Version · Date · What changed · Why

---

## v1.9.7 — 2026-04-17

### Feature: Price Tracker

- **Price Tracker panel** — collapsible section at the bottom of the main page. Paste any product URL → Claude Haiku scrapes the page and extracts the current price → stored in a new `price_history` Supabase table.
- **Trend indicator** — compares the latest check to the previous one and shows ▲/▼/— with a percentage change.
- **Price history list** — shows all past checks for the same URL (most recent first), so you can see how the price has moved over time.
- **`/api/price-track.js`** — POST endpoint. Fetches the page via plain HTTP (no Firecrawl), extracts JSON-LD structured data + visible text, asks Claude Haiku for `product_name`, `price_text`, `price_cents`, `currency`. Rate limited 10/IP/hour.
- **`/api/price-history.js`** — GET endpoint. Returns up to 20 price checks for a given URL from `price_history`.
- Works without auth (anonymous tracking via hashed IP). Dark mode supported throughout.

### Supabase table required
```sql
CREATE TABLE IF NOT EXISTS price_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_url  text NOT NULL,
  product_name text,
  price_text   text,
  price_cents  int,
  currency     text DEFAULT 'USD',
  checked_at   timestamptz DEFAULT now(),
  ip_hash      text
);
CREATE INDEX IF NOT EXISTS price_history_url_idx ON price_history (product_url, checked_at DESC);
```

---

## v1.9.6 — 2026-04-15

### Improvements: research validation, autocomplete ranking, NOT_LISTED tracking

- **Research JSON validation** — after extracting Claude's JSON, validate all required fields (gates, criteria, post_narrative) before returning or caching. Incomplete responses return a retryable 502 instead of silently producing broken cards.
- **Autocomplete relevance ranking** — fetch 20 candidates and re-rank by query match quality (exact → starts with → all words → any word) before returning 6. Previously sorted only by overall_score, which buried obvious matches.
- **NOT_LISTED reason tracking** — `research.js` now derives `not_listed_reason` (`gate1_low` | `gate2_disqualified` | `gate3_disqualified` | `other`) and saves it to `products.not_listed_reason`. Requires a `not_listed_reason text` column in Supabase.

---

## v1.9.5 — 2026-04-13

### Feature: landing page copy for cold visitors

- **Headline** rewritten to "Is it actually good? We'll tell you." — direct, punchy, answers the question every visitor has
- **Subheadline** rewritten to lead with the three-gate value prop (quality · ingredients · ethics) and call out "no ads, no sponsored results"
- **How it works** — 3-step pill strip below the subheadline (Type → Research → Verdict) gives first-time visitors an instant mental model
- **Trust strip** — 3 proof chips below the search chips (no affiliate influence · sources cited · re-researched every 30 days); hidden automatically when results load since it lives inside `inputSection`

---

## v1.9.4 — 2026-04-09

### Cost: slim research_queue fetch — drop select=*

- `processQueue()` now fetches only `id,query,user_email,user_id` instead of `select=*` — avoids pulling `full_result` and other large columns on every cron tick

---

## v1.9.3 — 2026-04-09

### Fix: admin account now inherits Pro access automatically

- `checkAdminStatus()` sets `currentUserPro = true` when the admin ping succeeds — admin always has full Pro access without needing a Stripe subscription
- After admin check resolves, both `updateAuthBar()` and `updatePaywall()` are called so the "Go Pro" button and search limit gate rerender correctly

---

## v1.9.2 — 2026-04-09

### Security: hardened headers + env var validation + prompt injection defense

- **vercel.json:** added `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy` headers on all routes — prevents clickjacking, MIME-sniffing, and silent referrer leakage
- **api/research.js:** env var guard at handler startup — returns 500 with a list of missing vars instead of silently failing mid-request
- **api/research.js:** scraped product page content wrapped in `<product_page_content>` XML delimiters — prevents injected instructions in a product page from hijacking the research prompt
- **api/admin.js:** PostgREST wildcard chars (`*` `%`) stripped from search query param to prevent ilike injection
- **api/admin.js:** rate limiter (120 req/hr per IP) applied to admin GET endpoint

---

## v1.9.1 — 2026-04-09

### Fix: instant sign-out — no more UI lag

- `handleSignOut()` clears all state and closes the modal synchronously before the network call, so the UI responds instantly
- `supabaseClient.auth.signOut()` now fires in the background (fire-and-forget) to invalidate the server-side refresh token
- `SIGNED_OUT` handler short-circuits with an early return when `currentUser` is already null — skips the expensive `getSession()` re-verification that was adding another round-trip on every explicit sign-out

---

## v1.9.0 — 2026-04-09

### Fix: search button communicates login requirement

- Submit button now reads "Sign in to search →" for logged-out visitors and "Research this product →" once signed in — no more surprise auth modal with no warning

---

## v1.8.9 — 2026-04-09

### Polish: Go Pro screen redesign — pricing cards + annual default

- **Pro modal:** replaced pill billing toggle with two side-by-side pricing cards (Monthly $14/mo · Annual $10/mo); Annual card shows "Best value" badge and is selected by default
- **CTA button** updates dynamically — "Get Pro — $10/month →" or "Get Pro — $14/month →" based on selected card
- **Paywall banner:** cleaner copy mentioning "from $10/month on the annual plan"; CTA now opens the modal so users see both options
- **Settings modal** upgrade button now opens the Pro modal instead of going straight to checkout
- Default billing cycle changed from monthly → annual

---

## v1.8.8 — 2026-04-09

### Fix: Brave session timeout + instant auth on page load

- **Root cause:** Brave Shields blocks `navigator.locks` — Supabase's token refresh hangs indefinitely waiting for a lock that never acquires, making the session appear timed out on every navigation
- **Custom lock:** wraps `navigator.locks.request()` with a catch; on any error (`SecurityError`, `NotSupportedError`, `AbortError`) falls back to an in-memory promise queue — token refresh works in all browsers
- **Instant session pre-read:** reads the auth token from storage *synchronously* before the Supabase client initialises; sets `currentUser` on first paint so the auth bar is correct immediately — no logged-out flash while `INITIAL_SESSION` resolves
- **Explicit `storageKey`:** `sb-idypfzpfrgvtkypasqhl-auth-token` — shared identically across index.html and admin.html so sessions are never double-stored or misread
- Same lock + storageKey applied to admin.html

---

## v1.8.7 — 2026-04-09

### Feature: batch import — multiple products from one Perplexity paste

- **admin-import.js:** Claude now returns a JSON array; saves one DB row per product found — one paste can import 3, 5, or 10 products at once
- **Normalisation:** if Claude returns a single object instead of array, it's auto-wrapped so single-product imports still work
- **max_tokens** raised to 16,000 to accommodate multiple full schemas in one response
- **Admin import UI:** product name field replaced with optional "Research topic" hint; result panel lists all imported products with badge, score, slug, and TL;DR
- **Perplexity prompt template** updated to show multi-product batch format

---

## v1.8.6 — 2026-04-09

### Admin: side nav layout + import fix

- **Admin panel revamp:** replaced horizontal tab nav with a persistent sidebar — Overview / Products / Users / Searches / Cost under "Dashboard", Import under "Tools"; collapses to horizontal scroll strip on mobile
- **Import fix:** switched from Haiku to Claude Sonnet 4.6 for better JSON compliance; bumped max_tokens to 6,000; strip markdown code fences before parsing; improved error message shows hint and response preview when parse fails
- Page titles added to each section; cleaner form styling with shared CSS classes; dark mode updated throughout

---

## v1.8.5 — 2026-04-09

### Feature: require login to search + auth-aware rate limits

- **Login gate:** `handleSubmit()` now checks `currentUser` first — unauthenticated visitors see the sign-in modal instead of consuming a search slot
- **Auth-aware rate limiting:** `research.js` verifies the user's Bearer token via Supabase; authenticated users bypass the 5/hour IP cap (free users are still subject to the 3/day `check-limit.js` quota; Pro users have no quota)
- **Dead code removal:** removed `incrementUsage()` calls from cache hit and fresh research paths — anonymous usage tracking is no longer needed
- Auth token is now forwarded from `runResearch()` to `/api/research` via `Authorization` header

---

## v1.8.3 — 2026-04-08

### Fix: admin→root logout + admin toggle button

- **Bug fix:** admin.html now uses the same `_authStorage` adapter as index.html, preventing session key mismatch that caused apparent sign-out on navigation back to root
- **Bug fix:** `stopAutoRefresh()` called on `beforeunload` in admin.html so index.html's Supabase client can acquire the navigator.locks lock cleanly
- Admin toggle button: after visiting `/admin`, an "Admin" link appears in the index.html auth bar (stored in sessionStorage, no extra network call needed); cleared on sign-out
- Upgraded admin top bar "Home" link to a prominent "← View site" button

---

## v1.8.2 — 2026-04-08

### Claude optimization + Perplexity admin import

- Merged research + post into a single Claude call — `post_narrative` now embedded in `research.js` JSON output, eliminating the separate `/api/post` call entirely (~40% API cost reduction)
- Extracted `RESEARCH_SYSTEM_PROMPT` constant shared by POST handler and cron processQueue
- Admin Import tab: paste Perplexity deep research → Claude formats to Triple Filter schema → saves to products DB; no web search cost
- New `/api/admin-import.js` serverless endpoint (admin-gated)
- Perplexity prompt template built into the Import tab (copy button included)

---

## v1.8.1 — 2026-04-08

### UI cleanup: remove URL tab, dynamic recent chips

- Removed "Paste a link" URL tab, URL panel, fallback textarea, and all scraping-path JS — name search is the only input mode now
- Example chips below the search box now show a logged-in user's last 5 searches; guests see rotating static examples
- Chips refresh automatically after sign-in/sign-out and after each new search is saved

---

## v1.8.0 — 2026-04-07

### Phase 2: True Async Research Queue
- **Vercel Cron processor** — every 5 minutes, `GET /api/research` picks up one `pending` queue item, runs full Claude research, saves to products cache, emails the user, marks `done`. `maxDuration: 60s` set on research.js so cron calls don't timeout.
- **Queue write via save-search.js** — `{ queueRequest, query, accessToken }` route writes to `research_queue`, deduplicates pending/processing items for same user+query.
- **product.html "Request fresh research"** — button appears at 30 days (was 60). Requires auth (prompts sign-in if logged out). Calls queue write → shows "Queued — we'll email you when ready". Added Supabase client to product.html for session access.
- **CRON_SECRET env var required** — add to Vercel dashboard to authenticate cron invocations.

### Manual action required
Add `CRON_SECRET` to Vercel environment variables (any long random string). The cron won't fire without it.

---

## v1.7.0 — 2026-04-03

### Phase 2: Animated Progress + Notify-Me Email
- **Animated step progress indicator** — loading state now shows three steps (Searching the web → Scoring 15 criteria → Writing your verdict) with active/done states. Steps advance on timing (step 2 after ~10.5s of research messages) and on real events (step 3 when post generation starts). URL mode advances to step 2 immediately after scraping completes.
- **Notify-me email on research completion** — "Email me when research is ready" checkbox now sends a research-complete email via Resend. Email shows badge, overall score, product name, and a deep link to the product page. Auth-verified (requires valid Supabase session token) before sending.
- **`sendNotifyEmail` helper** — captured at submit time, fires after `saveToCache` resolves (so the slug is available for the product page link). Handles both name-search (has slug) and URL/paste paths (no slug, links to home).

---

## v1.6.0 — 2026-04-07

### Phase 1: Monetization Foundation
- **Gate criteria breakdown behind Pro** — free users see badge, scores, gate pass/fail, verdict narrative, and buy button. The 15-criterion accordion (individual scores + evidence + sources) is now Pro-only, replaced by a blurred teaser with "Unlock with Pro" CTA. Zero extra API calls — data is fetched, display is gated client-side.
- **Pricing updated to $14/month** — all UI references updated (pro modal, paywall banner, settings upgrade button). Yearly plan added at $120/year ($10/mo effective, "2 months free"). Monthly/yearly toggle added to pro modal.
- **Stripe constants refactored** — `STRIPE_MONTHLY` and `STRIPE_YEARLY` constants in `handleProCheckout()`. `switchBilling()` function toggles price display and checkout destination.
- **Notify-me toggle** — "Email me when research is ready" checkbox added below submit button, visible to logged-in users only. Wired to `_notifyMe` flag for Phase 2 async queue.
- **Pricing page** — new `/pricing` route (`pricing.html`) with 3-tier comparison (Free / Pro / Power), full feature table, billing toggle, and FAQ section. Power tier shown as "Coming soon".

### Stripe action required
After updating Stripe: replace `STRIPE_MONTHLY` and `STRIPE_YEARLY` constants in `index.html` (~line 1752) and `pricing.html` with your new $14/mo and $120/yr payment link URLs.

---

## v1.5.3 — 2026-04-06

### Fix
- **Admin "Server misconfigured" error** — `api/admin.js` now returns the specific missing env var names (e.g. `["ADMIN_EMAIL"]`) instead of a generic message. `admin.html` detects the 500 and renders a setup guide listing exactly which Vercel env vars need to be added, instead of showing raw JSON.

---

## v1.5.2 — 2026-04-06

### Fix
- **Brave browser session loss** — Supabase defaulted to `localStorage` with no fallback. Brave's "Aggressive" shields and "Block cross-site cookies" modes throw `SecurityError` on `localStorage` access, silently preventing session persistence. Added a three-tier storage adapter: probes `localStorage` first → falls back to `sessionStorage` (survives refresh, lost on tab close) → falls back to in-memory Map (survives page load only). Passed as `storage:` option to `createClient`.

---

## v1.5.1 — 2026-04-06

### Security
- **Lock down admin POST endpoint** — `/api/admin` POST (product refresh) previously had no auth — only IP-based rate limiting. Now requires a valid Supabase session matching `ADMIN_EMAIL`, same as the GET endpoints. Any unauthenticated or non-admin POST now returns 401/403.
- **Document `ADMIN_EMAIL` env var** — added to `CLAUDE.md` required env vars list.

---

## v1.5.0 — 2026-04-06

### Feature: Admin Portal
- **Full tab-based admin dashboard** at `/admin` — Overview, Products, Users, Searches, Cost
- **Overview tab** — stat cards now include Pro user count, conversion rate, searches 7d/30d alongside existing product/user/bookmark counts; category and badge breakdowns unchanged
- **Products tab** — browse and search all products in the DB (50/page, paginated); live search with debounce; "Refresh" button per product flags it for re-research
- **Users tab** — full user list with email, join date, last active, Free/Pro status; Pro conversion rate card
- **Searches tab** — 14-day search volume sparkline chart, top searched products with badge labels; note: tracks logged-in searches only
- **Cost tab** — token cost breakdown per call (research + post), monthly cost estimates at scale, break-even calculation for Pro plan
- **api/admin.js** — added `?view=products`, `?view=users`, `?view=searches` endpoints; overview now returns `proUsers`, `searches7d`, `searches30d`
- **Bug fix** — removed stale custom lock from admin.html (was the broken v1.3.3 lock, already fixed in index.html at v1.3.4)

---

## v1.4.0 — 2026-04-03

### Cost
- **Prompt caching on research.js system prompt** — the ~1,500-token Triple Filter system prompt (scoring rules, badge logic, full JSON schema) is now cached with `cache_control: {type:"ephemeral"}`. Added `prompt-caching-2024-07-31` to the `anthropic-beta` header alongside the existing web-search beta. Cache hits save ~90% of system prompt input tokens (~$0.00045/hit at Haiku pricing). The cache is shared across all requests within a 5-minute window, so concurrent users benefit too.

---

## v1.3.9 — 2026-04-01

### Legal
- **Privacy policy page** — added `/privacy` route (`privacy.html`) covering: data collected (email, search history, hashed IP for rate limiting), third-party services (Supabase, Stripe, Anthropic, Amazon Associates, Vercel), cookie/localStorage usage, data deletion process, and contact info. Linked from footer on `index.html`. Matches full Calm Design OS with dark mode support.

---

## v1.3.8 — 2026-04-01

### Cost
- **post.js: slim research input to Claude** — was passing the full research JSON (15 criteria × `{label, score, evidence, source_url}`) pretty-printed with 2-space indentation. `label` and `source_url` are UI-only fields Claude doesn't use for narrative writing. Now strips those fields and uses compact JSON before serializing for the Claude call. Saves ~30–40% of input tokens on every post generation call.

---

## v1.3.7 — 2026-03-31

### Bug Fix
- **Fix session loss on return to root URL** — removed the explicit `getSession()` IIFE that ran concurrently with Supabase's internal `initialize()`. When the access token was expired, both called refresh simultaneously; the second "already used" refresh token response triggered a `SIGNED_OUT` event and logged the user out. Now `INITIAL_SESSION` from `onAuthStateChange` is the sole init path — no concurrent refresh, no race.

---

## v1.3.6 — 2026-04-01

### Infrastructure
- **Consolidated serverless functions from 15 → 12** to stay within Vercel Hobby plan limit. No functionality removed, no frontend or Stripe dashboard changes required.
  - `stripe-webhook.js` + `stripe-portal.js` → `api/stripe.js` (routes by `stripe-signature` header)
  - `admin-stats.js` + `request-refresh.js` → `api/admin.js` (routes by HTTP method)
  - `send-welcome.js` absorbed into `api/save-search.js` (detects by request body shape)
  - Old URLs (`/api/stripe-webhook`, `/api/stripe-portal`, `/api/admin-stats`, `/api/request-refresh`, `/api/send-welcome`) preserved via `vercel.json` rewrites

---

## v1.3.5 — 2026-03-31

### Performance
- **cache-lookup: skip full_result on stale cache hits** — `select=*` was fetching the full research JSON blob (30–100 KB) on every cache check, even for stale records that get thrown away. Now uses a two-phase fetch: phase 1 fetches only `slug, researched_at, post_narrative` (tiny); phase 2 fetches `full_result` only when the record is confirmed fresh. Stale checks now transfer ~100 bytes instead of up to 100 KB.

---

## v1.3.4 — 2026-03-31

### Fixed
- **Session lost on navigation (take 2)** — removed the custom lock entirely. The v1.3.3 `navigator.locks` implementation ignored the `acquireTimeout` parameter that Supabase passes. If a ghost lock from a previous page instance was never released, `getSession()` would hang indefinitely — making the user appear logged out on every navigation back to the root URL. Supabase's built-in lock handler uses `AbortController` to respect the timeout and unblock correctly.
- **Reverted Supabase version pin** — `2.49.4` may have predated the storage key format used to create existing user sessions, causing `getSession()` to find nothing. Back to `@2` (latest stable v2).
- **Restored SIGNED_OUT guard** — without a custom lock, rapid-reload lock races can still produce spurious `SIGNED_OUT` events; the `getSession()` re-verification prevents those from incorrectly clearing the session.

---

## v1.3.3 — 2026-03-31

### Fixed
- **Session lost on navigation** — replaced the in-memory custom lock with native `navigator.locks`. The old mutex couldn't survive a mid-refresh page navigation: if the user navigated away while a token refresh was in-flight, the new tokens were never stored and the refresh token was left invalid. The browser's Web Locks API releases locks correctly on page teardown, preventing the stale-token SIGNED_OUT cycle.
- **Login flash on page load** — added an explicit `supabaseClient.auth.getSession()` call that fires immediately on page load, independent of the `INITIAL_SESSION` event. This eliminates the brief "logged out" state that could appear while waiting for the auth event loop.
- **Pinned Supabase CDN** — locked to `@supabase/supabase-js@2.49.4` (was `@2` — unversioned). Auto-updates to new minor versions were silently changing internal auth behaviour.
- **Simplified SIGNED_OUT handler** — removed the `getSession()` re-verification guard (which existed to catch spurious events from the old mutex). Native locks + `broadcastAuthEvents: false` make this unnecessary.

---

## v1.3.2 — 2026-03-31

### Affiliate
- **Amazon search fallback** — buy button now appears on every researched product, not just those where Claude returns a direct product URL. For name-only searches, falls back to an Amazon search link with affiliate tag (`productName + brand`). Previously the button was hidden for ~60–70% of results.
- **FTC disclosure** — added required "As an Amazon Associate I earn from qualifying purchases" disclosure beneath the buy button on both `index.html` and `product.html`.
- **Footer copy fix** — removed "No sponsored listings" (contradicted affiliate links). Now reads "Affiliate links help fund our research."

---

## v1.3.1 — 2026-03-25

### Performance
- **History loads ~10× faster** — removed `full_result` from the initial history list query. The full research JSON (often 30–100 KB per item, up to 50 for Pro) was being fetched for all items just to render a name/score list. Now only lightweight metadata is fetched; the full result is loaded on-demand when you click an item (one `select('full_result').eq('id', ...)` call, cached in memory after first load).
- **History and saved modals are instant on re-open** — results are now cached in memory. Re-opening the history or saved tab skips the network fetch entirely. Caches are invalidated automatically when a new search is saved or a bookmark is toggled.
- **Name search is ~200ms faster** — for non-Pro users, the server-side limit check and cache lookup now run in parallel (`Promise.all`) instead of sequentially. Previously two full round-trips happened before any result was shown; now they happen simultaneously.

---

## v1.3.0 — 2026-03-25

### Added
- **Search autocomplete** — typing 2+ characters in the name search box now shows a typeahead dropdown of matching products already in the database. Results show product name, badge label, and score. Keyboard-navigable (↑↓ arrows, Enter to select, Esc to close). Powered by new `/api/autocomplete.js` endpoint — uses PostgREST `ilike` pattern search on the `products.query` column, ordered by score descending. Selecting a suggestion fills the input and immediately runs `handleSubmit()`.
- **Welcome email on sign-up** — new users receive a welcome email immediately after account creation. Sent via Resend. New `/api/send-welcome.js` serverless function — fires non-blocking (`fetch` without `await`) from `handleSignUp()` so it never blocks or fails the signup flow. Gracefully skips if `RESEND_API_KEY` env var is not set.
  - **Required:** Add `RESEND_API_KEY` and `FROM_EMAIL` env vars in Vercel. Verify your sending domain in Resend.

### Fixed
- **Session management — spurious sign-outs on refresh/reopen** — `SIGNED_OUT` can fire during a token refresh race even when the session is still valid. The handler now calls `getSession()` to verify the session is genuinely gone before clearing state; if a live session is found, it restores auth state instead of signing out.
- **Cross-tab SIGNED_OUT cascade** — added `broadcastAuthEvents: false` to the Supabase client config. Previously, a failed token refresh in one open tab would broadcast `SIGNED_OUT` to all other tabs, signing the user out everywhere. Now each tab manages its own session independently.
- **`TOKEN_REFRESHED` event unhandled** — added explicit handler to sync `currentUser` state when Supabase silently refreshes the access token.

---

## v1.2.0 — 2026-03-21

### Added
- **OG social cards** — `/api/og?slug=...` edge function generates 1200×630 PNG preview images for all product verdict pages. Shows product name, badge pill, score, and branded bottom strip. Referenced via `og:image` + `twitter:card` meta tags in `product.html`. Requires `package.json` with `@vercel/og ^0.6.2` (added).
- **Score filter in directory** — new filter bar with "All scores / 7+ Good / 8+ Great / 9+ Exceptional" buttons. Combines with existing badge and category filters.
- **Re-research request button** — appears on verdict pages older than 60 days. Calls `/api/request-refresh` which increments `refresh_requests` counter on the product row. Rate-limited to 1 per IP per product per hour.
  - **Supabase migration required:** see below.
- **History for all logged-in users** — free users can now see their last 5 searches (previously Pro-only). History button shown to all signed-in users with an upgrade prompt at the bottom for free tier.

### Supabase migrations required
```sql
-- Add refresh request tracking to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS refresh_requests int DEFAULT 0;

-- Optional: atomic increment RPC (more efficient than read-write)
CREATE OR REPLACE FUNCTION increment_refresh_requests(p_slug text)
RETURNS void LANGUAGE sql AS $$
  UPDATE products SET refresh_requests = COALESCE(refresh_requests, 0) + 1 WHERE slug = p_slug;
$$;
```

---

## v1.1.1 — 2026-03-21

### Fixed
- **Session management** — replaced no-op auth lock with an in-memory mutex. The previous no-op let concurrent token refreshes race, each invalidating the other's refresh token and causing silent logouts. The mutex serialises requests per lock name without touching the browser's Web Locks API (which threw "Lock broken" errors).
- **`SIGNED_OUT` event not handled** — `onAuthStateChange` now explicitly handles `SIGNED_OUT` to clean up `currentUser` and `currentUserPro` state when Supabase fires it (e.g. after a failed token refresh or server-side revocation).
- **Double-init race removed** — `initAuth` no longer calls `getSession()` and sets `currentUser` separately from `onAuthStateChange`. The listener's `INITIAL_SESSION` event is now the single source of truth; `initAuth` only renders logged-out defaults instantly and handles the Stripe redirect param.
- **`console.log` removed** from auth state listener.

---

## v1.1.0 — 2026-03-21

### Added
- **Admin dashboard** at `/admin` — live stats for total products, users, bookmarks, category/badge breakdown, top bookmarked products, and recent research activity. Protected by `ADMIN_EMAIL` env var; served by `api/admin-stats.js` using service role key.
  - **Required:** Add `ADMIN_EMAIL` env var in Vercel (your sign-in email).
- **Buy button on verdict pages** (`/p/[slug]`) — shows product URL with Amazon affiliate tag applied when applicable. Button text adapts to badge (earned badge / had concerns / generic).
- **Amazon affiliate tag** — applied to Amazon URLs on both the main search result and static verdict pages. Update `AFFILIATE_TAG` constant in `index.html` and `product.html` once you have your real Associates tag.

---

## v1.0.0 — 2026-03-20

### Added
- **Sitemap.xml** — dynamic sitemap at `/sitemap.xml` generated by `api/sitemap.js`. Includes all public product verdict pages with `<lastmod>` dates. Cached 1 hour at CDN edge. Submit to Google Search Console.
- **Product categories** — research engine now classifies every product into one of: Personal Care, Cleaning & Home, Food & Drink, Baby & Kids, Clothing & Footwear, Supplements & Health, Pet Care, Electronics, Other. Category shown as a chip on product verdict pages and filterable in the directory.
  - **Supabase migration required:** `ALTER TABLE products ADD COLUMN IF NOT EXISTS category text;`
- **Directory category filter** — second filter row below badge filters. Combines with badge + text search filters.
- **Bookmarks** — logged-in users can save any researched product via ♡ button in the cache strip. Saved products appear in the new "Saved" tab in the history modal. Uses Supabase `bookmarks` table with RLS.
  - **Supabase table required:** see migration below.
- **Smart alternatives linking** — "Consider Instead" alternatives are now linked to their verdict pages if they exist in the cache. Async lookup after result renders — no delay on the main result.
- **Compare page** at `/compare` — side-by-side Triple Filter comparison between two products. Entry via "Compare →" link in cache strip. Shows scores, gates, pros/cons, and highlights the winner.
- **Compare link** in cache strip — appears alongside Share on every result.

### Supabase migrations required
```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS category text;

CREATE TABLE IF NOT EXISTS bookmarks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slug          text NOT NULL,
  product_name  text,
  badge         text,
  overall_score numeric(4,1),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, slug)
);
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own bookmarks" ON bookmarks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

---

## v0.9.1 — 2026-03-19

### Changed
- **Replaced magic link auth with email/password** — magic links were unreliable (inconsistent sessions, email delivery issues). Auth modal now has:
  - **Sign in** — email + password with Enter key support
  - **Create account** — email + password (min. 8 chars), handles email confirmation flow if enabled in Supabase
  - **Forgot password** — sends a reset link via Supabase; on return the modal auto-opens to "Set new password"
  - **PASSWORD_RECOVERY** event handled in `onAuthStateChange` so the reset form appears automatically when users click their reset link
- Existing magic-link users: "Forgot password" flow lets them set a password the first time
- `supabase.auth.signInWithOtp` removed; replaced with `signInWithPassword`, `signUp`, `resetPasswordForEmail`, `updateUser`

### Note
- In Supabase → Auth → Settings: you can disable "Confirm email" if you want users signed in immediately on signup (simpler UX). If left on, users get a confirmation email first.

---

## v0.9.0 — 2026-03-19

### Fixed
- **`/p/[slug]` verdict pages were rendering empty** — `product.html` was reading `r.gates[]` (array) and `r.gateNames`, but the actual research JSON uses `r.gate1`/`r.gate2`/`r.gate3` (named keys) and gate names are stored inside each gate object. Gate scores were using `gate.score` instead of `gate.average`. Similarly, `r.tldr`, `r.pros`, `r.cons`, and `r.realTalk` are nested under `r.summary.*`. All field references corrected. Verdict pages now display correctly.
- **`VERSION` file** was stuck at `0.5.4` — updated to `0.9.0`.

### Added
- **Cached post narratives** — the listing post (from `/api/post`) is now saved alongside the research in the `products` cache table (`post_narrative` column). Cache hits display the post instantly without a second Claude call. Saves ~$0.003 per repeat visit and removes the 5–10s post-generation delay for cached products.
  - `api/cache-save.js` accepts optional `postData` in request body.
  - `api/cache-lookup.js` returns `post_narrative` alongside `data`.
  - `index.html`: `runPost()` now returns the post; `saveToCache()` accepts `postData`; cache hits check for `post_narrative` before calling `/api/post`.
  - **Supabase migration required:** `ALTER TABLE products ADD COLUMN IF NOT EXISTS post_narrative jsonb;`

- **Stripe Customer Portal** — "Manage subscription" in settings now opens the real Stripe billing portal instead of showing an alert to email support. Users can update payment methods, view invoices, and cancel directly.
  - New `api/stripe-portal.js` — verifies Supabase JWT, reads `stripe_customer_id` from profiles, creates a Stripe billing portal session, returns redirect URL.
  - `api/stripe-webhook.js` now saves `session.customer` (Stripe customer ID) to `profiles.stripe_customer_id` on `checkout.session.completed`.
  - **Supabase migration required:** `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id text;`
  - **Stripe setup required:** Enable Customer Portal at stripe.com/billing/portal → Settings → activate.
  - **New Vercel env var required:** `STRIPE_SECRET_KEY` (from Stripe → Developers → API keys → Secret key).

- **Badge embed widget** — each `/p/[slug]` verdict page now shows an "Embed this verdict" section at the bottom with a one-click copy HTML snippet. Brands and bloggers can embed the badge to link back to the verdict.

- **Directory text search** — added a search input above the filter bar in the directory. Searches product names and brands via Supabase `ilike` query with 350ms debounce. Works alongside badge filters.

### Upcoming
- Bookmarks — saved products for logged-in users (`bookmarks` Supabase table)
- Compare two products — side-by-side Triple Filter comparison
- Email onboarding sequence for new signups and upgrades
- Amazon Associates affiliate tag (replace `tellmeitsgood-20` placeholder)

---

## v0.8.0 — 2026-03-18

### Added
- **Directory page** at `/directory` — public, browsable catalog of all researched products. Filter by badge type (Tell Me It's Good, Clean Pick, Ethical Pick, Quality Pick, Not Listed). Cards show badge, score, product name, brand, TL;DR snippet, and age. Paginated at 24 per page with load-more. Affiliate-ready: each card links to `/p/[slug]` verdict page.
- **Directory link** in auth bar for all users (logged in and out) — links to `/directory`.
- **Server-side free tier enforcement** via `/api/check-limit.js` — tracks daily search counts by hashed IP in Supabase `free_searches` table. Cannot be bypassed by clearing localStorage. Fails open (Supabase outage won't block users).
- Free limit now applies to logged-in free users too (previously any logged-in user had unlimited searches regardless of Pro status).

---

## v0.7.1 — 2026-03-18

### Optimized
- Capped web searches at 5 per research call (`max_uses: 5` on web_search tool). Previously uncapped — Claude would run 8–12 searches per request, inflating both search API costs and input token counts from large result payloads.
- Reduced `max_tokens` from 6000 → 4000. The fixed JSON output structure rarely needs more than 3000 tokens; 4000 is safe headroom at ~33% lower output cost.
- Compressed system prompt JSON schema example by ~40%. Replaced verbose placeholder-score example (repeated `7`s across 15 criteria) with a compact type-annotated schema. Same structural guidance to Claude, fewer input tokens per call.

---

## v0.7.0 — 2026-03-18

### Added
- Product caching system — research results saved to Supabase `products` table after every successful analysis.
- Cache lookup on every name-tab search — returns instantly if a fresh result (< 30 days) exists, skipping Claude entirely.
- Cache strip UI — shown below results with age, share link, and "↻ Refresh research" button for users who want fresh data.
- Public shareable verdict pages at `/p/[slug]` — fully rendered product page with badge, scores, pros/cons, and SEO meta tags. Fetches directly from Supabase (no extra API hop).
- `/api/cache-lookup.js` — checks `products` table by slug or exact query, returns hit/miss with freshness metadata.
- `/api/cache-save.js` — upserts research result to `products` table using service role key; overwrites stale data on slug conflict.
- `vercel.json` rewrite: `/p/:slug` → `product.html`.
- Supabase `products` table with RLS policy: public rows readable by anyone, writes restricted to service role.

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
