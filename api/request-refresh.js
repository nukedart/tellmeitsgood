// =============================================================
// /api/request-refresh.js  —  Vercel Serverless Function
// =============================================================
// Increments refresh_requests counter on a product row so the
// owner can see which stale products users want re-researched.
// Rate-limited to 1 request per IP per product per hour.
// =============================================================

import { rateLimit } from './_rateLimit.js';

const refreshRequested = new Map(); // ip:slug → timestamp

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.body || {};
  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ error: 'slug required' });
  }

  // Simple in-process rate limit: 1 per IP per slug per hour
  const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const key = `${ip}:${slug}`;
  const now = Date.now();
  const last = refreshRequested.get(key) || 0;
  if (now - last < 60 * 60 * 1000) {
    return res.status(429).json({ error: 'Already requested recently' });
  }
  refreshRequested.set(key, now);

  // Clean up old entries to prevent memory leak
  if (refreshRequested.size > 5000) {
    const cutoff = now - 2 * 60 * 60 * 1000;
    for (const [k, v] of refreshRequested) {
      if (v < cutoff) refreshRequested.delete(k);
    }
  }

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Increment refresh_requests counter using Supabase RPC
  // Falls back to a simple read-increment-write if RPC unavailable
  try {
    // Use PostgREST to do an atomic increment via a raw SQL RPC call
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_refresh_requests`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_slug: slug }),
    });

    if (!rpcRes.ok) {
      // RPC function may not exist yet — fall back to PATCH
      await fetch(
        `${SUPABASE_URL}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}`,
        {
          method:  'GET',
          headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'select': 'refresh_requests' },
        }
      ).then(async r => {
        const rows = await r.json();
        const current = rows?.[0]?.refresh_requests || 0;
        return fetch(`${SUPABASE_URL}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ refresh_requests: current + 1 }),
        });
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('request-refresh error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
