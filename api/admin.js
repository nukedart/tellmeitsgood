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

  // ── POST: request product refresh (admin only) ───────────────
  if (req.method === 'POST') {
    const SUPABASE_URL         = process.env.SUPABASE_URL;
    const SERVICE_KEY          = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ADMIN_EMAIL          = process.env.ADMIN_EMAIL;

    // Require admin session — same check as GET
    const postAuth  = req.headers.authorization || '';
    const postToken = postAuth.startsWith('Bearer ') ? postAuth.slice(7) : null;
    if (!postToken) return res.status(401).json({ error: 'Unauthorized' });

    const postUserRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${postToken}` },
    });
    if (!postUserRes.ok) return res.status(401).json({ error: 'Invalid session' });
    const postUser = await postUserRes.json();
    if (postUser.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

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

    const missing = [!SUPABASE_URL && 'SUPABASE_URL', !SUPABASE_SERVICE_KEY && 'SUPABASE_SERVICE_ROLE_KEY', !ADMIN_EMAIL && 'ADMIN_EMAIL'].filter(Boolean);
    if (missing.length) {
      return res.status(500).json({ error: 'Server misconfigured', missing });
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

    const view = req.query?.view;

    // ── PRODUCTS view ──────────────────────────────────────────
    if (view === 'products') {
      const page   = Math.max(0, parseInt(req.query?.page || '0'));
      const q      = (req.query?.q || '').trim();
      const limit  = 50;
      const offset = page * limit;
      const filter = q ? `&product_name=ilike.*${encodeURIComponent(q)}*` : '';

      const [listRes, countRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/products?select=slug,product_name,badge,overall_score,category,researched_at,refresh_requests&order=researched_at.desc&limit=${limit}&offset=${offset}${filter}`, { headers: h }),
        fetch(`${SUPABASE_URL}/rest/v1/products?select=count${filter}`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      ]);
      const products = await listRes.json();
      const total    = parseInt(countRes.headers.get('content-range')?.split('/')[1] || '0');
      return res.json({ products: Array.isArray(products) ? products : [], total, page, limit });
    }

    // ── USERS view ─────────────────────────────────────────────
    if (view === 'users') {
      const [usersRes, profilesRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
        }),
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,is_pro`, { headers: h }),
      ]);
      const usersData  = usersRes.ok ? await usersRes.json() : { users: [] };
      const profiles   = profilesRes.ok ? await profilesRes.json() : [];
      const profileMap = {};
      (Array.isArray(profiles) ? profiles : []).forEach(p => { profileMap[p.id] = p; });

      const users = (usersData.users || [])
        .map(u => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, is_pro: profileMap[u.id]?.is_pro || false }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      return res.json({ users, total: users.length, pro: users.filter(u => u.is_pro).length });
    }

    // ── SEARCHES view ──────────────────────────────────────────
    if (view === 'searches') {
      const searchesRes = await fetch(
        `${SUPABASE_URL}/rest/v1/searches?select=product_name,badge,created_at&order=created_at.desc&limit=500`,
        { headers: h }
      );
      const searches = searchesRes.ok ? (await searchesRes.json()) : [];
      const rows     = Array.isArray(searches) ? searches : [];

      const byDay = {};
      for (let i = 13; i >= 0; i--) {
        byDay[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] = 0;
      }
      rows.forEach(s => { const d = s.created_at?.slice(0, 10); if (d && byDay[d] !== undefined) byDay[d]++; });

      const productCount = {};
      rows.forEach(s => {
        if (!s.product_name) return;
        if (!productCount[s.product_name]) productCount[s.product_name] = { count: 0, badge: s.badge };
        productCount[s.product_name].count++;
      });
      const topProducts = Object.entries(productCount)
        .sort((a, b) => b[1].count - a[1].count).slice(0, 15)
        .map(([name, v]) => ({ name, count: v.count, badge: v.badge }));

      return res.json({ total: rows.length, byDay, topProducts });
    }

    // ── OVERVIEW (default) ─────────────────────────────────────
    const sevenDaysAgo  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      totalProductsRes, recentProductsRes, categoryRes, badgeRes,
      bookmarkCountRes, topBookmarkedRes, newUsersRes, proCountRes,
      searches7dRes, searches30dRes,
    ] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/products?select=count`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      fetch(`${SUPABASE_URL}/rest/v1/products?select=slug,product_name,badge,overall_score,category,researched_at&order=researched_at.desc&limit=10`, { headers: h }),
      fetch(`${SUPABASE_URL}/rest/v1/products?select=category&category=not.is.null`, { headers: h }),
      fetch(`${SUPABASE_URL}/rest/v1/products?select=badge&badge=not.is.null`, { headers: h }),
      fetch(`${SUPABASE_URL}/rest/v1/bookmarks?select=count`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      fetch(`${SUPABASE_URL}/rest/v1/bookmarks?select=slug,product_name&order=slug`, { headers: h }),
      fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }),
      fetch(`${SUPABASE_URL}/rest/v1/profiles?select=count&is_pro=eq.true`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      fetch(`${SUPABASE_URL}/rest/v1/searches?select=count&created_at=gte.${sevenDaysAgo}`,  { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      fetch(`${SUPABASE_URL}/rest/v1/searches?select=count&created_at=gte.${thirtyDaysAgo}`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
    ]);

    const totalProducts  = parseInt(totalProductsRes.headers.get('content-range')?.split('/')[1] || '0');
    const recentProducts = await recentProductsRes.json();

    const categoryRows      = await categoryRes.json();
    const categoryBreakdown = {};
    (Array.isArray(categoryRows) ? categoryRows : []).forEach(r => {
      categoryBreakdown[r.category || 'Other'] = (categoryBreakdown[r.category || 'Other'] || 0) + 1;
    });

    const badgeRows      = await badgeRes.json();
    const badgeBreakdown = {};
    (Array.isArray(badgeRows) ? badgeRows : []).forEach(r => {
      badgeBreakdown[r.badge || 'UNKNOWN'] = (badgeBreakdown[r.badge || 'UNKNOWN'] || 0) + 1;
    });

    const totalBookmarks = parseInt(bookmarkCountRes.headers.get('content-range')?.split('/')[1] || '0');
    const bookmarkRows   = await topBookmarkedRes.json();
    const bookmarkMap    = {};
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

    const proUsers    = parseInt(proCountRes.headers.get('content-range')?.split('/')[1] || '0');
    const searches7d  = parseInt(searches7dRes.headers.get('content-range')?.split('/')[1]  || '0');
    const searches30d = parseInt(searches30dRes.headers.get('content-range')?.split('/')[1] || '0');

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      totalProducts, totalUsers, newUsersCount, proUsers, totalBookmarks,
      searches7d, searches30d,
      recentProducts: Array.isArray(recentProducts) ? recentProducts : [],
      categoryBreakdown, badgeBreakdown, topBookmarked,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
