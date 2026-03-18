// =============================================================
// /api/check-limit.js  —  Vercel Serverless Function
// =============================================================
// Server-side daily search limit for free (non-Pro) users.
// Tracks by hashed IP so clearing localStorage doesn't bypass it.
// Fails open — if Supabase is down, users are not blocked.
// =============================================================

import { createHash } from 'crypto';

const FREE_LIMIT = 3;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const ip = (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
  const ipHash = createHash('sha256').update(ip).digest('hex');
  const today  = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  try {
    // ── 1. Read current count ──────────────────────────────────
    const selectRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/free_searches` +
      `?ip_hash=eq.${encodeURIComponent(ipHash)}&date=eq.${today}&select=count`,
      {
        headers: {
          'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    const rows    = await selectRes.json();
    const current = rows?.[0]?.count ?? 0;

    if (current >= FREE_LIMIT) {
      return res.json({ allowed: false, remaining: 0 });
    }

    // ── 2. Increment (upsert) ──────────────────────────────────
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/free_searches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify({ ip_hash: ipHash, date: today, count: current + 1 }),
    });

    return res.json({ allowed: true, remaining: FREE_LIMIT - (current + 1) });

  } catch (err) {
    // Fail open — never block users due to a Supabase outage
    console.error('check-limit error:', err.message);
    return res.json({ allowed: true, remaining: 1 });
  }
}
