// =============================================================
// /api/stripe.js  —  Vercel Serverless Function
// =============================================================
// Handles both Stripe webhook events and Customer Portal sessions.
// Route detection: stripe-signature header present → webhook
//                  no stripe-signature header       → portal
//
// bodyParser disabled globally — raw body needed for HMAC
// verification; portal payload parsed manually below.
// =============================================================

import crypto from 'crypto';

export const config = {
  api: { bodyParser: false },
};

const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://idypfzpfrgvtkypasqhl.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_SNwAYSpiLmXrZYdK-0P7uA_mrDiF8wb';

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  ()    => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

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
  return v1Sigs.some(sig => {
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      return sigBuf.length === expBuf.length && crypto.timingSafeEqual(expBuf, sigBuf);
    } catch { return false; }
  });
}

async function setUserPro(userId, customerId) {
  const body = { id: userId, is_pro: true };
  if (customerId) body.stripe_customer_id = customerId;
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('Supabase upsert error:', res.status, await res.text());
  } else {
    console.log('Set is_pro=true for user:', userId);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const rawBody = await getRawBody(req);

  // ── Webhook path ──────────────────────────────────────────────
  if (req.headers['stripe-signature']) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return res.status(400).json({ error: 'Missing webhook secret.' });

    if (!verifyStripeSignature(rawBody.toString(), req.headers['stripe-signature'], secret)) {
      console.error('Stripe signature verification failed');
      return res.status(400).json({ error: 'Invalid signature.' });
    }

    let event;
    try { event = JSON.parse(rawBody.toString()); }
    catch { return res.status(400).json({ error: 'Invalid JSON.' }); }

    if (event.type === 'checkout.session.completed') {
      const session    = event.data.object;
      const userId     = session.client_reference_id;
      const customerId = session.customer;
      if (userId) {
        await setUserPro(userId, customerId);
      } else {
        console.warn('checkout.session.completed with no client_reference_id:', session.customer_details?.email);
      }
    }

    return res.status(200).json({ received: true });
  }

  // ── Portal path ───────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const token = authHeader.slice(7);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
  const user = await userRes.json();

  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=stripe_customer_id`,
    {
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  const profiles   = await profileRes.json();
  const customerId = profiles?.[0]?.stripe_customer_id;

  if (!customerId) {
    return res.status(404).json({ error: 'No subscription found. Email hello@tellmeitsgood.com if you believe this is an error.' });
  }

  const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ customer: customerId, return_url: 'https://tellmeitsgood.com' }),
  });

  if (!portalRes.ok) {
    const errData = await portalRes.json().catch(() => ({}));
    return res.status(502).json({ error: errData.error?.message || 'Could not open subscription portal.' });
  }

  const portal = await portalRes.json();
  return res.status(200).json({ url: portal.url });
}
