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

  // ── 1. Only accept POST requests ──────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ── 2. Read the URL from the request body ─────────────────
  const { url } = req.body;

  if (!url || url.trim().length === 0) {
    return res.status(400).json({ error: 'No URL provided.' });
  }

  const trimmedUrl = url.trim();

  // Must start with http:// or https://
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    return res.status(400).json({
      error: 'INVALID_URL',
      message: 'Paste a full product link starting with https://',
    });
  }

  // ── 3. Call the Firecrawl API ──────────────────────────────
  // Firecrawl scrapes the page and returns clean markdown text.
  // FIRECRAWL_API_KEY is stored in Vercel env vars — never sent to browser.
  try {
    const firecrawlRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url: trimmedUrl,
        formats: ['markdown'],  // Text only — no screenshots needed
      }),
    });

    // ── 4. Handle Firecrawl errors ─────────────────────────
    if (!firecrawlRes.ok) {
      const errData = await firecrawlRes.json().catch(() => ({}));
      console.error('Firecrawl API error:', firecrawlRes.status, errData);

      // 402 = out of Firecrawl credits
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

    // ── 5. Parse Firecrawl's response ──────────────────────
    // Firecrawl returns: { success: true, data: { markdown: "...", metadata: {...} } }
    const firecrawlData = await firecrawlRes.json();
    const markdown = firecrawlData?.data?.markdown;

    if (!markdown || markdown.trim().length === 0) {
      return res.status(422).json({
        error: 'SCRAPE_FAILED',
        message: 'This site blocked us. Try copying the product name and price instead.',
      });
    }

    // ── 6. Trim content so we don't blow up Claude's context ──
    // 12,000 chars covers all product details while cutting nav/footer noise
    const trimmedMarkdown = markdown.slice(0, 12000);

    // ── 7. Send the scraped text back to the browser ───────
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
