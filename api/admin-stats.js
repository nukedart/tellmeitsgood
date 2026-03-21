// =============================================================
// /api/admin-stats.js  —  Vercel Serverless Function
// =============================================================
// Returns aggregate stats for the admin dashboard.
// Protected: caller must supply a valid Supabase session token
// belonging to the email set in ADMIN_EMAIL env var.
// =============================================================

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_EMAIL          = process.env.ADMIN_EMAIL;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ADMIN_EMAIL) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // ── 1. Verify caller is the admin ───────────────────────────
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });

  const user = await userRes.json();
  if (user.email !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const h = {
    'apikey':        SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type':  'application/json',
  };

  // ── 2. Run queries in parallel ───────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    totalProductsRes,
    recentProductsRes,
    categoryRes,
    badgeRes,
    bookmarkCountRes,
    topBookmarkedRes,
    newUsersRes,
  ] = await Promise.all([
    // Total products
    fetch(`${SUPABASE_URL}/rest/v1/products?select=count`, {
      headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' },
    }),
    // Recent 10 products
    fetch(`${SUPABASE_URL}/rest/v1/products?select=product_name,badge,overall_score,category,researched_at&order=researched_at.desc&limit=10`, {
      headers: h,
    }),
    // Category breakdown
    fetch(`${SUPABASE_URL}/rest/v1/products?select=category&category=not.is.null`, {
      headers: h,
    }),
    // Badge breakdown
    fetch(`${SUPABASE_URL}/rest/v1/products?select=badge&badge=not.is.null`, {
      headers: h,
    }),
    // Total bookmarks
    fetch(`${SUPABASE_URL}/rest/v1/bookmarks?select=count`, {
      headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' },
    }),
    // Top bookmarked products (slug + count)
    fetch(`${SUPABASE_URL}/rest/v1/bookmarks?select=slug,product_name&order=slug`, {
      headers: h,
    }),
    // New users in last 7 days (requires service role via auth admin API)
    fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
    }),
  ]);

  // ── 3. Parse results ─────────────────────────────────────────
  const totalProducts = parseInt(totalProductsRes.headers.get('content-range')?.split('/')[1] || '0');
  const recentProducts = await recentProductsRes.json();

  const categoryRows = await categoryRes.json();
  const categoryBreakdown = {};
  (Array.isArray(categoryRows) ? categoryRows : []).forEach(row => {
    const cat = row.category || 'Other';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
  });

  const badgeRows = await badgeRes.json();
  const badgeBreakdown = {};
  (Array.isArray(badgeRows) ? badgeRows : []).forEach(row => {
    const b = row.badge || 'UNKNOWN';
    badgeBreakdown[b] = (badgeBreakdown[b] || 0) + 1;
  });

  const totalBookmarks = parseInt(bookmarkCountRes.headers.get('content-range')?.split('/')[1] || '0');

  const bookmarkRows = await topBookmarkedRes.json();
  const bookmarkMap = {};
  (Array.isArray(bookmarkRows) ? bookmarkRows : []).forEach(row => {
    if (!bookmarkMap[row.slug]) bookmarkMap[row.slug] = { slug: row.slug, product_name: row.product_name, count: 0 };
    bookmarkMap[row.slug].count++;
  });
  const topBookmarked = Object.values(bookmarkMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  let newUsersCount = 0;
  let totalUsers = 0;
  if (newUsersRes.ok) {
    const usersData = await newUsersRes.json();
    const users = usersData.users || [];
    totalUsers = users.length;
    newUsersCount = users.filter(u => u.created_at >= sevenDaysAgo).length;
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    totalProducts,
    totalUsers,
    newUsersCount,
    totalBookmarks,
    recentProducts: Array.isArray(recentProducts) ? recentProducts : [],
    categoryBreakdown,
    badgeBreakdown,
    topBookmarked,
  });
}
