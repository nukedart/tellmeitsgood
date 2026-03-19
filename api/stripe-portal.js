// =============================================================
// /api/stripe-portal.js  —  Vercel Serverless Function
// =============================================================
// Creates a Stripe Customer Portal session for a logged-in Pro
// user so they can manage or cancel their subscription without
// having to email support.
//
// Flow:
//   Browser → POST /api/stripe-portal (Authorization: Bearer <supabase_jwt>)
//               ↓
//   Verify Supabase JWT → get user ID
//               ↓
//   Fetch stripe_customer_id from profiles table
//               ↓
//   POST to Stripe billing portal API
//               ↓
//   Return { url } → browser redirects
// =============================================================

const SUPABASE_URL     = process.env.SUPABASE_URL     || 'https://idypfzpfrgvtkypasqhl.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_SNwAYSpiLmXrZYdK-0P7uA_mrDiF8wb';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── 1. Verify the user's Supabase session ─────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const token = authHeader.slice(7);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!userRes.ok) {
    return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
  }
  const user = await userRes.json();

  // ── 2. Get their Stripe customer ID from profiles ─────────
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=stripe_customer_id,is_pro`,
    {
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  const profiles = await profileRes.json();
  const customerId = profiles?.[0]?.stripe_customer_id;

  if (!customerId) {
    return res.status(404).json({
      error: 'No subscription found for this account. Email hello@tellmeitsgood.com if you believe this is an error.',
    });
  }

  // ── 3. Create Stripe Customer Portal session ──────────────
  const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization':  `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type':   'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      customer:   customerId,
      return_url: 'https://tellmeitsgood.com',
    }),
  });

  if (!portalRes.ok) {
    const errData = await portalRes.json().catch(() => ({}));
    console.error('Stripe portal error:', portalRes.status, errData);
    return res.status(502).json({
      error: errData.error?.message || 'Could not open subscription portal. Please try again.',
    });
  }

  const portal = await portalRes.json();
  return res.status(200).json({ url: portal.url });
}
