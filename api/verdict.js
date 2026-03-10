// =============================================================
// /api/verdict.js  —  Vercel Serverless Function
// =============================================================
// This file runs on Vercel's servers, NOT in the user's browser.
// That means your ANTHROPIC_API_KEY stays 100% private.
//
// How it works:
//   Browser → POST /api/verdict { purchaseText: "..." }
//                ↓
//   This function → Claude API (using secret key)
//                ↓
//   This function → sends verdict JSON back to browser
// =============================================================

export default async function handler(req, res) {

  // ── 1. Only accept POST requests ──────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ── 2. Read the user's purchase text from the request body ─
  const { purchaseText } = req.body;

  if (!purchaseText || purchaseText.trim().length === 0) {
    return res.status(400).json({ error: 'No purchaseText provided.' });
  }

  // ── 3. Call the Claude API ─────────────────────────────────
  // process.env.ANTHROPIC_API_KEY is set in your Vercel dashboard.
  // It is never visible to the browser.
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
        max_tokens: 1000,
        system: `You are a sharp, honest financial advisor friend.
Someone is about to buy something. Give them a real, direct verdict.
No fluff. Be genuinely helpful — sometimes that means saying don't buy it.

Return ONLY valid JSON with no extra text, no markdown, no explanation:
{
  "verdict": "good" | "think_twice" | "dont",
  "score": <number 1-10>,
  "reasons": ["<reason 1>", "<reason 2>", "<reason 3>"],
  "questions": ["<question 1>", "<question 2>", "<question 3>"],
  "alternative": "<one honest alternative suggestion or null>"
}`,
        messages: [
          {
            role: 'user',
            content: `Purchase they're considering: ${purchaseText}`,
          },
        ],
      }),
    });

    // ── 4. Handle errors from Claude ────────────────────────
    if (!claudeRes.ok) {
      const errData = await claudeRes.json().catch(() => ({}));
      const message = errData.error?.message || `Claude API error ${claudeRes.status}`;
      return res.status(502).json({ error: message });
    }

    // ── 5. Parse Claude's response ──────────────────────────
    const claudeData = await claudeRes.json();
    const rawText = claudeData.content[0].text;

    // Strip any accidental markdown fences just in case
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const verdict = JSON.parse(cleaned);

    // ── 6. Send the verdict back to the browser ─────────────
    return res.status(200).json(verdict);

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Something went wrong on the server: ' + err.message });
  }
}
