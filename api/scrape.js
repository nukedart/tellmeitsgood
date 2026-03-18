// =============================================================
// /api/scrape.js  —  Vercel Serverless Function
// =============================================================
// Receives a product URL from the browser, calls Firecrawl to
// scrape the page content, and returns the markdown text back.
//
// Flow:
//   Browser → POST /api/scrape { url: "https://..." }
//                ↓
//   This function → Firecrawl API (using secret key)
//                ↓
//   This function → sends scraped markdown back to browser
// =============================================================

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { url } = req.body;

  if (!url || url.trim().length === 0) {
    return res.status(400).json({ error: 'No URL provided.' });
  }

  const trimmedUrl = url.trim();

  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    return res.status(400).json({
      error: 'INVALID_URL',
      message: 'Paste a full product link starting with https://',
    });
  }

  try {
    const firecrawlRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url: trimmedUrl,
        formats: ['markdown'],
      }),
    });

    if (!firecrawlRes.ok) {
      const errData = await firecrawlRes.json().catch(() => ({}));
      console.error('Firecrawl API error:', firecrawlRes.status, errData);

      if (firecrawlRes.status === 402) {
        return res.status(402).json({
          error: 'SCRAPE_FAILED',
          message: 'Firecrawl credits exhausted. Check your Firecrawl plan.',
        });
      }

      return res.status(502).json({
        error: 'SCRAPE_FAILED',
        message: 'This site blocked us. Try copying the product name and price instead.',
      });
    }

    const firecrawlData = await firecrawlRes.json();
    const markdown = firecrawlData?.data?.markdown;

    if (!markdown || markdown.trim().length === 0) {
      return res.status(422).json({
        error: 'SCRAPE_FAILED',
        message: 'This site blocked us. Try copying the product name and price instead.',
      });
    }

    const trimmedMarkdown = markdown.slice(0, 12000);

    return res.status(200).json({
      success: true,
      productData: trimmedMarkdown,
      sourceUrl: firecrawlData?.data?.metadata?.sourceURL || trimmedUrl,
      pageTitle: firecrawlData?.data?.metadata?.title || '',
    });

  } catch (err) {
    console.error('Server error in /api/scrape:', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Something went wrong on the server: ' + err.message,
    });
  }
}
