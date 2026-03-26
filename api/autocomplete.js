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
    const url =
      `${SUPABASE_URL}/rest/v1/products` +
      `?query=ilike.*${encodeURIComponent(safe)}*` +
      `&is_public=eq.true` +
      `&select=query,slug,badge,overall_score` +
      `&order=overall_score.desc.nullslast` +
      `&limit=6`;

    const response = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!response.ok) return res.json([]);

    const rows = await response.json();
    return res.json(Array.isArray(rows) ? rows : []);

  } catch {
    return res.json([]);
  }
}
