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

  const headers = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  };
  const base = `${SUPABASE_URL}/rest/v1/products` +
    `?or=(slug.eq.${encodeURIComponent(slug)},query.eq.${encodeURIComponent(normalizedQuery)})` +
    `&is_public=eq.true&limit=1`;

  try {
    // Phase 1: fetch only metadata — skip full_result (30–100 KB) until we know it's fresh
    const metaRes = await fetch(base + `&select=slug,researched_at,post_narrative`, { headers });
    if (!metaRes.ok) throw new Error(`Supabase ${metaRes.status}`);

    const rows    = await metaRes.json();
    const product = rows?.[0];
    if (!product) return res.json({ hit: false });

    const ageMs   = Date.now() - new Date(product.researched_at).getTime();
    const daysOld = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const fresh   = daysOld < CACHE_DAYS;

    // Phase 2: only fetch the heavy blob when the cache is actually fresh
    let full_result = null;
    if (fresh) {
      const dataRes = await fetch(base + `&select=full_result`, { headers });
      if (dataRes.ok) {
        const dataRows = await dataRes.json();
        full_result = dataRows?.[0]?.full_result ?? null;
      }
    }

    return res.json({
      hit:            true,
      fresh,
      daysOld,
      slug:           product.slug,
      data:           full_result,
      post_narrative: product.post_narrative || null,
    });

  } catch (err) {
    // Always fail gracefully — app falls back to fresh research
    console.error('Cache lookup error:', err.message);
    return res.json({ hit: false });
  }
}
