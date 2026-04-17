// =============================================================
// /api/price-history.js  —  Vercel Serverless Function
// =============================================================
// Returns the price check history for a given product URL.
// GET /api/price-history?url=https://...
// =============================================================

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required.' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured.' });
  }

  try {
    const params = new URLSearchParams({
      product_url: `eq.${url}`,
      select:       'price_text,price_cents,currency,checked_at,product_name',
      order:        'checked_at.desc',
      limit:        '20',
    });

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/price_history?${params}`,
      {
        headers: {
          'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('price_history fetch error:', response.status, err);
      return res.status(502).json({ error: 'Failed to fetch history.' });
    }

    const rows = await response.json();
    return res.json({ rows: Array.isArray(rows) ? rows : [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
