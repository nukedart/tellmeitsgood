// =============================================================
// /api/sitemap.js  —  Vercel Serverless Function
// =============================================================
// Generates sitemap.xml for SEO — includes static pages and
// every public product verdict page. Cached for 1 hour at the
// CDN edge so it stays fast without hammering Supabase.
// =============================================================

const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://idypfzpfrgvtkypasqhl.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_SNwAYSpiLmXrZYdK-0P7uA_mrDiF8wb';

export default async function handler(req, res) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/products?is_public=eq.true&select=slug,researched_at&order=researched_at.desc&limit=5000`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const products = r.ok ? await r.json() : [];

    const staticUrls = [
      { loc: 'https://tellmeitsgood.com/',          priority: '1.0', freq: 'daily'   },
      { loc: 'https://tellmeitsgood.com/directory', priority: '0.9', freq: 'daily'   },
      { loc: 'https://tellmeitsgood.com/compare',   priority: '0.6', freq: 'monthly' },
    ].map(({ loc, priority, freq }) =>
      `  <url><loc>${loc}</loc><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`
    ).join('\n');

    const productUrls = (Array.isArray(products) ? products : []).map(p => {
      const lastmod = (p.researched_at || '').slice(0, 10);
      return `  <url><loc>https://tellmeitsgood.com/p/${p.slug}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>monthly</changefreq><priority>0.7</priority></url>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/0.9/sitemap">
${staticUrls}
${productUrls}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(xml);
  } catch (err) {
    console.error('Sitemap error:', err);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/0.9/sitemap"></urlset>');
  }
}
