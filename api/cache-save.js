// =============================================================
// /api/cache-save.js  —  Vercel Serverless Function
// =============================================================
// Saves a completed research result to the public products cache.
// Uses service role key for write access.
// Upserts on slug conflict so refreshes overwrite stale data.
// =============================================================

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { query, researchData, postData } = req.body;

  if (!query || !researchData || typeof researchData !== 'object') {
    return res.status(400).json({ error: 'Missing query or researchData.' });
  }

  // Slug derived from productName (more canonical than raw query)
  const slug          = slugify(researchData.productName || query);
  const normalizedQuery = query.toLowerCase().trim();

  try {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/products`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer':        'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          slug,
          query:         normalizedQuery,
          product_name:  researchData.productName || query,
          brand:         researchData.brand        || null,
          badge:         researchData.badge        || null,
          overall_score: researchData.overallScore || null,
          full_result:    researchData,
          post_narrative: postData || null,
          researched_at:  new Date().toISOString(),
          is_public:      true,
        }),
      }
    );

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
