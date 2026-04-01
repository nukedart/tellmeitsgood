// =============================================================
// /api/admin.js  —  Vercel Serverless Function
// =============================================================
// GET  → admin stats dashboard (requires ADMIN_EMAIL session)
// POST → request product refresh (rate-limited, public)
// =============================================================

import { rateLimit } from './_rateLimit.js';

// ── In-process rate limit for refresh requests ────────────────
const refreshRequested = new Map();

export default async function handler(req, res) {

  // ── POST: request product refresh ────────────────────────────
  if (req.method === 'POST') {
    const { slug } = req.body || {};
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ error: 'slug required' });
    }

    const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const key = `${ip}:${slug}`;
    const now = Date.now();
    if (now - (refreshRequested.get(key) || 0) < 60 * 60 * 1000) {
      return res.status(429).json({ error: 'Already requested recently' });
    }
    refreshRequested.set(key, now);

    if (refreshRequested.size > 5000) {
      const cutoff = now - 2 * 60 * 60 * 1000;
      for (const [k, v] of refreshRequested) {
        if (v < cutoff) refreshRequested.delete(k);
      }
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
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
        const rows = await fetch(
          `${SUPABASE_URL}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}&select=refresh_requests`,
          { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
        ).then(r => r.json());
        const current = rows?.[0]?.refresh_requests || 0;
        await fetch(`${SUPABASE_URL}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ refresh_requests: current + 1 }),
        });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error('request-refresh error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // ── GET: admin stats ──────────────────────────────────────────
  if (req.method === 'GET') {
    const SUPABASE_URL         = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ADMIN_EMAIL          = process.env.ADMIN_EMAIL;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ADMIN_EMAIL) {
      return res.status(500).json({ error: 'Server misconfigured' });
    }

    const auth  = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${token}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });

    const user = await userRes.json();
    if (user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    const h = {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
    };

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      totalProductsRes, recentProductsRes, categoryRes, badgeRes,
      bookmarkCountRes, topBookmarkedRes, newUsersRes,
    ] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/products?select=count`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      fetch(`${SUPABASE_URL}/rest/v1/products?select=product_name,badge,overall_score,category,researched_at&order=researched_at.desc&limit=10`, { headers: h }),
      fetch(`${SUPABASE_URL}/rest/v1/products?select=category&category=not.is.null`, { headers: h }),
      fetch(`${SUPABASE_URL}/rest/v1/products?select=badge&badge=not.is.null`, { headers: h }),
      fetch(`${SUPABASE_URL}/rest/v1/bookmarks?select=count`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      fetch(`${SUPABASE_URL}/rest/v1/bookmarks?select=slug,product_name&order=slug`, { headers: h }),
      fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }),
    ]);

    const totalProducts  = parseInt(totalProductsRes.headers.get('content-range')?.split('/')[1] || '0');
    const recentProducts = await recentProductsRes.json();

    const categoryRows      = await categoryRes.json();
    const categoryBreakdown = {};
    (Array.isArray(categoryRows) ? categoryRows : []).forEach(r => {
      const cat = r.category || 'Other';
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
    });

    const badgeRows      = await badgeRes.json();
    const badgeBreakdown = {};
    (Array.isArray(badgeRows) ? badgeRows : []).forEach(r => {
      const b = r.badge || 'UNKNOWN';
      badgeBreakdown[b] = (badgeBreakdown[b] || 0) + 1;
    });

    const totalBookmarks = parseInt(bookmarkCountRes.headers.get('content-range')?.split('/')[1] || '0');

    const bookmarkRows = await topBookmarkedRes.json();
    const bookmarkMap  = {};
    (Array.isArray(bookmarkRows) ? bookmarkRows : []).forEach(r => {
      if (!bookmarkMap[r.slug]) bookmarkMap[r.slug] = { slug: r.slug, product_name: r.product_name, count: 0 };
      bookmarkMap[r.slug].count++;
    });
    const topBookmarked = Object.values(bookmarkMap).sort((a, b) => b.count - a.count).slice(0, 5);

    let newUsersCount = 0, totalUsers = 0;
    if (newUsersRes.ok) {
      const usersData = await newUsersRes.json();
      const users     = usersData.users || [];
      totalUsers      = users.length;
      newUsersCount   = users.filter(u => u.created_at >= sevenDaysAgo).length;
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ totalProducts, totalUsers, newUsersCount, totalBookmarks, recentProducts: Array.isArray(recentProducts) ? recentProducts : [], categoryBreakdown, badgeBreakdown, topBookmarked });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
