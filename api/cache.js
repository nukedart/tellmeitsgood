// Merged from cache-lookup.js + cache-save.js
// POST with researchData in body → save; POST without → lookup
// Rewrites: /api/cache-lookup → /api/cache, /api/cache-save → /api/cache

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

async function handleLookup(req, res) {
  const { query } = req.body;
  if (!query || typeof query !== 'string') return res.json({ hit: false });

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
    const metaRes = await fetch(base + `&select=slug,researched_at,post_narrative`, { headers });
    if (!metaRes.ok) throw new Error(`Supabase ${metaRes.status}`);

    const rows    = await metaRes.json();
    const product = rows?.[0];
    if (!product) return res.json({ hit: false });

    const ageMs   = Date.now() - new Date(product.researched_at).getTime();
    const daysOld = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const fresh   = daysOld < CACHE_DAYS;

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
    console.error('Cache lookup error:', err.message);
    return res.json({ hit: false });
  }
}

async function handleSave(req, res) {
  const { query, researchData, postData } = req.body;

  if (!query || !researchData || typeof researchData !== 'object') {
    return res.status(400).json({ error: 'Missing query or researchData.' });
  }

  const slug          = slugify(researchData.productName || query);
  const normalizedQuery = query.toLowerCase().trim();

  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        slug,
        query:              normalizedQuery,
        product_name:       researchData.productName       || query,
        brand:              researchData.brand             || null,
        badge:              researchData.badge             || null,
        category:           researchData.category          || null,
        overall_score:      researchData.overallScore      || null,
        not_listed_reason:  researchData.not_listed_reason || null,
        full_result:        researchData,
        post_narrative:     postData                       || null,
        researched_at:      new Date().toISOString(),
        is_public:          true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Cache save error:', response.status, err);
      return res.status(502).json({ error: 'Failed to save to cache.' });
    }

    return res.json({ success: true, slug });
  } catch (err) {
    console.error('Cache save error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.body?.researchData !== undefined) return handleSave(req, res);
  return handleLookup(req, res);
}
