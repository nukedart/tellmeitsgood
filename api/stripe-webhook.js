// =============================================================
// /api/stripe-webhook.js  —  Vercel Serverless Function
// =============================================================
// Receives Stripe webhook events, verifies they're genuine,
// and flips profiles.is_pro = true for the paying user.
//
// Flow:
//   Stripe → POST /api/stripe-webhook
//     ↓
//   Verify signature (HMAC-SHA256) using STRIPE_WEBHOOK_SECRET
//     ↓
//   On checkout.session.completed:
//     - Read client_reference_id (= Supabase user ID, set by handleProCheckout)
//     - PATCH profiles table → is_pro = true
// =============================================================

import crypto from 'crypto';

// Tell Vercel NOT to parse the body — we need the raw bytes to
// verify Stripe's signature. If Vercel parses it first, the
// signature check will always fail.
export const config = {
  api: { bodyParser: false },
};

// ── Read raw request body from stream ────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  ()    => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Verify Stripe webhook signature ──────────────────────────
// Stripe signs webhooks with HMAC-SHA256.
// Signature header format: t=timestamp,v1=sig1,v1=sig2,...
// We recompute the expected sig and compare with timingSafeEqual.
function verifyStripeSignature(rawBody, signatureHeader, secret) {
  let timestamp = null;
  const v1Sigs  = [];

  for (const part of signatureHeader.split(',')) {
    const eqIdx = part.indexOf('=');
    const k = part.slice(0, eqIdx);
    const v = part.slice(eqIdx + 1);
    if (k === 't')  timestamp = v;
    if (k === 'v1') v1Sigs.push(v);
  }

  if (!timestamp || v1Sigs.length === 0) return false;

  const payload  = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const expBuf   = Buffer.from(expected, 'hex');

  // Accept if any v1 signature matches (Stripe can send multiple)
  return v1Sigs.some(sig => {
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      return sigBuf.length === expBuf.length && crypto.timingSafeEqual(expBuf, sigBuf);
    } catch { return false; }
  });
}

// ── Set user pro in Supabase ──────────────────────────────────
// Uses upsert (POST + merge-duplicates) so it works whether or not
// the profiles row exists yet (e.g. users who signed up before the
// trigger was added won't have a row, and PATCH would silently do nothing).
// Also stores the Stripe customer ID so we can open the Customer Portal later.
async function setUserPro(userId, customerId) {
  const body = { id: userId, is_pro: true };
  if (customerId) body.stripe_customer_id = customerId;

  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/profiles`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error('Supabase upsert error:', res.status, err);
  } else {
    console.log('Set is_pro=true for user:', userId, customerId ? `(customer: ${customerId})` : '');
  }
}

// ── Main handler ──────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const rawBody = await getRawBody(req);
  const sigHeader = req.headers['stripe-signature'];
  const secret    = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sigHeader || !secret) {
    return res.status(400).json({ error: 'Missing signature or secret.' });
  }

  if (!verifyStripeSignature(rawBody.toString(), sigHeader, secret)) {
    console.error('Stripe signature verification failed');
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON.' });
  }

  // ── Handle events ───────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session    = event.data.object;
    const userId     = session.client_reference_id; // set by handleProCheckout()
    const customerId = session.customer;             // Stripe customer ID for portal access

    if (userId) {
      await setUserPro(userId, customerId);
    } else {
      // Fallback: log so you can manually upgrade the user if needed
      console.warn('checkout.session.completed with no client_reference_id. Customer email:', session.customer_details?.email);
    }
  }

  return res.status(200).json({ received: true });
}
