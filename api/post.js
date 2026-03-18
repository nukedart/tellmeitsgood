// =============================================================
// /api/post.js  —  Vercel Serverless Function
// =============================================================
// Takes the scored JSON output from /api/research and generates
// a persuasive, human-voiced product listing post for the
// tellmeitsgood.com directory.
//
// Flow:
//   Browser → POST /api/post { research: { ...scored JSON... } }
//                ↓
//   This function → Claude API
//                ↓
//   Returns structured post JSON ready to render in the UI
// =============================================================

export default async function handler(req, res) {

  // ── 1. Only accept POST requests ──────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ── 2. Read the research JSON from the request body ───────
  const { research } = req.body;

  if (!research || typeof research !== 'object') {
    return res.status(400).json({ error: 'No research data provided.' });
  }

  // ── 3. Call Claude to write the listing post ───────────────
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
        max_tokens: 1500,

        system: `You are the voice of tellmeitsgood.com — a trusted product curation site for people who want to buy less but buy better. You write like the smartest, most honest friend they have: direct, warm, specific, and never corporate.

You've been given a fully scored product research report. Your job is to turn that data into a compelling, honest product listing post that helps real people make real decisions.

VOICE RULES:
- Write like a smart friend who actually researched this, not a product reviewer.
- Be specific. Use the actual scores and evidence from the research. Never be vague.
- Be honest about weaknesses. Trust is built by admitting what a product doesn't do well.
- Be direct. No "this product may be suitable for some users." Say "this is for X, not Y."
- Never use: "comprehensive", "seamlessly", "robust", "leverage", "game-changer", "revolutionary", "innovative", "best-in-class" (unless quoting a score).

STRUCTURE RULES:
- hook: One sentence that captures the product's core identity. Not a slogan — a fact with an opinion baked in. Max 25 words.
- verdict_paragraph: 2-3 sentences expanding on why this product earned (or didn't earn) its badge. Reference the gate scores specifically. Be direct about the overall verdict.
- gate_summaries: For each of the three gates, write 1-2 sentences summarising what the research found. Be specific — reference actual findings, not just scores.
- who_its_for: One sentence describing the exact person who should buy this. Be specific about lifestyle/values.
- who_its_not_for: One sentence describing who should skip it. Be equally specific.
- bottom_line: The most honest thing you can say about this product in one sentence. This is what you'd say to a friend who asked "should I buy it?" Can be positive, negative, or nuanced — just true.

Return ONLY valid JSON. No markdown, no backticks, no explanation outside the JSON:

{
  "hook": "one sentence, max 25 words, fact with opinion baked in",
  "verdict_paragraph": "2-3 sentences on why this badge was earned or not. Reference gate scores.",
  "gate_summaries": {
    "gate1": "1-2 sentences on quality/value findings — specific, not generic",
    "gate2": "1-2 sentences on clean/safe findings — reference actual ingredients or certifications if found",
    "gate3": "1-2 sentences on ethics findings — reference specific company behaviour"
  },
  "who_its_for": "one sentence describing the exact right buyer",
  "who_its_not_for": "one sentence describing who should skip it",
  "bottom_line": "the single most honest thing you can say — one sentence"
}`,

        messages: [
          {
            role: 'user',
            content: `Write a product listing post for this research report:\n\n${JSON.stringify(research, null, 2)}`,
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

    // Strip any accidental markdown fences
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const post = JSON.parse(cleaned);

    // ── 6. Return the post combined with key research fields ─
    // Merge so the browser has everything it needs in one response
    return res.status(200).json({
      post,
      productName: research.productName,
      brand: research.brand,
      price: research.price,
      badge: research.badge,
      overallScore: research.overallScore,
      gate1: research.gate1,
      gate2: research.gate2,
      gate3: research.gate3,
      summary: research.summary,
    });

  } catch (err) {
    console.error('Server error in /api/post:', err);
    return res.status(500).json({
      error: 'Something went wrong on the server: ' + err.message,
    });
  }
}
