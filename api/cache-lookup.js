// =============================================================
// /api/cache-lookup.js  —  Vercel Serverless Function
// =============================================================
// Checks if a product has been researched before and is still
// fresh (< 30 days old). Returns the cached result if found.
// Falls through gracefully on any error so the app always
// falls back to running a fresh Claude research.
// =============================================================

// Public values — safe to have in server code
const SUPABASE_URL     = process.env.SUPABASE_URL     || 'https://idypfzpfrgvtkypasqhl.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_SNwAYSpiLmXrZYdK-0P7uA_mrDiF8wb';

const CACHE_DAYS = 30;

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.json({ hit: false });
  }

  const slug          = slugify(query);
  const normalizedQuery = query.toLowerCase().trim();

  try {
    // Check by slug OR exact query match so minor name variations still hit cache
    const url = `${SUPABASE_URL}/rest/v1/products` +
      `?or=(slug.eq.${encodeURIComponent(slug)},query.eq.${encodeURIComponent(normalizedQuery)})` +
      `&is_public=eq.true&select=*&limit=1`;

    const response = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!response.ok) throw new Error(`Supabase ${response.status}`);

    const rows    = await response.json();
    const product = rows?.[0];

    if (!product) return res.json({ hit: false });

    const ageMs   = Date.now() - new Date(product.researched_at).getTime();
    const daysOld = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const fresh   = daysOld < CACHE_DAYS;

    return res.json({
      hit:     true,
      fresh,
      daysOld,
      slug:    product.slug,
      data:    product.full_result,
    });

  } catch (err) {
    // Always fail gracefully — app falls back to fresh research
    console.error('Cache lookup error:', err.message);
    return res.json({ hit: false });
  }
}
