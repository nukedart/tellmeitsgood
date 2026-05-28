// =============================================================
// /api/autocomplete.js  —  Vercel Serverless Function
// =============================================================
// Returns up to 6 cached products whose query/name contains the
// search term. Powers the typeahead dropdown on the main search
// input. Intentionally lightweight — no auth, no rate limiting.
// =============================================================

const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://idypfzpfrgvtkypasqhl.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_SNwAYSpiLmXrZYdK-0P7uA_mrDiF8wb';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const q = ((req.query.q || '')).trim().toLowerCase();
  if (q.length < 2) return res.json([]);

  // Sanitise: strip any PostgREST operator characters before interpolating
  const safe = q.replace(/[*%(),]/g, '');
  if (!safe) return res.json([]);

  try {
    // PostgREST ilike uses * as the wildcard character
    // Fetch 20 candidates so we can re-rank by query relevance before returning 6
    const category = ((req.query.category || '')).trim();
    let url =
      `${SUPABASE_URL}/rest/v1/products` +
      `?query=ilike.*${encodeURIComponent(safe)}*` +
      `&is_public=eq.true` +
      `&select=query,slug,product_name,brand,badge,overall_score` +
      `&order=overall_score.desc.nullslast` +
      `&limit=20`;
    if (category) url += `&category=eq.${encodeURIComponent(category)}`;

    const response = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!response.ok) return res.json([]);

    const rows = await response.json();
    if (!Array.isArray(rows)) return res.json([]);

    // Re-rank by relevance to the typed query, then by score within each tier.
    // Tier 0: exact match · Tier 1: starts with query · Tier 2: all words present · Tier 3: any word present
    const terms = safe.split(/\s+/).filter(Boolean);
    const ranked = rows
      .map(row => {
        const name = (row.query || '').toLowerCase();
        let tier = 3;
        if (name === safe)                          tier = 0;
        else if (name.startsWith(safe))             tier = 1;
        else if (terms.every(t => name.includes(t))) tier = 2;
        return { ...row, _tier: tier };
      })
      .sort((a, b) => a._tier - b._tier || (b.overall_score || 0) - (a.overall_score || 0))
      .slice(0, 6)
      .map(({ _tier, ...row }) => row);

    return res.json(ranked);

  } catch {
    return res.json([]);
  }
}
