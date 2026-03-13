// =============================================================
// /api/verdict.js  —  Vercel Serverless Function
// =============================================================
// Receives scraped product text from the browser, sends it to
// Claude for value analysis, returns structured JSON verdict.
//
// Flow:
//   Browser → POST /api/verdict { productData: "scraped text..." }
//                ↓
//   This function → Claude API (using secret key)
//                ↓
//   This function → sends full analysis JSON back to browser
// =============================================================

export default async function handler(req, res) {

  // ── 1. Only accept POST requests ──────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ── 2. Read the scraped product text from the request body ─
  const { productData } = req.body;

  if (!productData || productData.trim().length === 0) {
    return res.status(400).json({ error: 'No productData provided.' });
  }

  // ── 3. Call the Claude API ─────────────────────────────────
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,

        system: `You are a sharp, no-BS product analyst and consumer advocate.
You've been given raw text scraped from a product page.
Your job: extract the key facts and give an honest value verdict.

Rules:
- Be direct and useful. No marketing language, no fluff.
- Extract the actual product name and price from the text. If you can't find a price, write "Price not found".
- Brand tax is real — call it out when a brand charges more than the product is worth.
- "Real Talk" = what actual customers say vs what the marketing says. Be honest.
- Alternatives should be real competitor product categories (not brand names you might hallucinate).
- bestTimeToBuy: is there a better time to buy this (Black Friday, end of model cycle, etc.)? Be specific.

Return ONLY valid JSON. No markdown, no backticks, no explanation outside the JSON:
{
  "productName": "extracted product name from the page",
  "price": "extracted price as a string e.g. '$249.99' or 'Price not found'",
  "valueVerdict": "great_deal" | "fair_price" | "overpriced",
  "valueScore": <number 1-10, how good the value is>,
  "qualityScore": <number 1-10, how good the product quality/build is>,
  "brandTax": "e.g. 'You're paying ~30% for the brand name' or 'No significant brand premium here'",
  "tldr": "one punchy, honest sentence — max 20 words",
  "pros": ["pro 1", "pro 2", "pro 3"],
  "cons": ["con 1", "con 2", "con 3"],
  "bestTimeToBuy": "specific advice: buy now, wait for X, or check Y",
  "alternatives": [
    { "name": "alternative product type 1", "reason": "why it's worth considering" },
    { "name": "alternative product type 2", "reason": "why it's worth considering" }
  ],
  "realTalk": "what reviewers actually say vs what the marketing claims — be honest and specific"
}`,

        messages: [
          {
            role: 'user',
            // We pass the scraped page content straight in
            content: `Analyse this product page content and return your verdict:\n\n${productData}`,
          },
        ],
      }),
    });

    // ── 4. Handle Claude API errors ────────────────────────
    if (!claudeRes.ok) {
      const errData = await claudeRes.json().catch(() => ({}));
      const message = errData.error?.message || `Claude API error ${claudeRes.status}`;
      return res.status(502).json({ error: message });
    }

    // ── 5. Parse Claude's response ──────────────────────────
    const claudeData = await claudeRes.json();
    const rawText = claudeData.content[0].text;

    // Strip any accidental markdown fences Claude adds
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const verdict = JSON.parse(cleaned);

    // ── 6. Send the verdict back to the browser ─────────────
    return res.status(200).json(verdict);

  } catch (err) {
    console.error('Server error in /api/verdict:', err);
    return res.status(500).json({
      error: 'Something went wrong on the server: ' + err.message,
    });
  }
}
