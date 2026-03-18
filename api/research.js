// =============================================================
// /api/research.js  —  Vercel Serverless Function
// =============================================================
// The Triple Filter scoring engine. Accepts either scraped product
// text (from /api/scrape) OR a plain product name/search query.
// Uses Claude with web_search to find authoritative sources and
// score all 15 criteria across the three gates.
// =============================================================

import { rateLimit } from './_rateLimit.js';

export default async function handler(req, res) {

  // ── 0. Rate limiting ───────────────────────────────────────
  // Research is the most expensive call (Claude + web search).
  // 5 requests per IP per hour is generous for real use and
  // prevents a single person or bot from running up your bill.
  const limited = rateLimit(req, res, {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: 'You have made too many research requests. Please try again in an hour.',
  });
  if (limited) return;

  // ── 1. Only accept POST requests ──────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ── 2. Accept either scraped productData or a text query ──
  const { productData, sourceUrl, query } = req.body;

  const hasProductData = productData && productData.trim().length > 0;
  const hasQuery = query && query.trim().length > 0;

  if (!hasProductData && !hasQuery) {
    return res.status(400).json({ error: 'Provide either productData or query.' });
  }

  const userMessage = hasProductData
    ? `Research and score this product using the Triple Filter. Here is the scraped product page content:\n\n${productData}\n\nSource URL: ${sourceUrl || 'not provided'}`
    : `Research and score this product using the Triple Filter: "${query.trim()}"`;

  // ── 3. Call Claude with web_search enabled ─────────────────
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',

        // 3000 was too low — the 15-criteria JSON with web search results
        // can easily exceed that, causing truncated/broken JSON responses.
        // 6000 gives enough headroom for a complete, valid response.
        max_tokens: 6000,

        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
          },
        ],

        system: `You are the research engine for tellmeitsgood.com — a trusted product curation site that only lists products passing a strict Triple Filter: genuine quality, clean/safe ingredients, and ethical company practices.

Your job is to deeply research a product and score it across 15 criteria organised into three gates. Use your web_search tool to find authoritative, specific sources for each score. Do not guess or rely on general knowledge alone — search for real evidence.

SEARCH STRATEGY:
- Gate 1 (Quality): Search for professional reviews, owner complaints, durability reports, price comparisons with alternatives. Good sources: Wirecutter, Consumer Reports, RTINGS, Reddit threads, professional review sites.
- Gate 2 (Clean/Safe): Search for ingredient lists, EWG Skin Deep ratings, third-party safety certifications (NSF, EPA Safer Choice, MADE SAFE). Good sources: ewg.org/skindeep, product's own ingredient page, third-party certification databases.
- Gate 3 (Ethics): Search for company news, labor practices, BBB complaints, greenwashing investigations, review manipulation. Good sources: BBB, news sources, Good On You, Glassdoor for culture signals, FTC actions.

SCORING RULES — commit to real scores, no hedging:
- 1-3: Fails badly. Clear evidence of poor quality, harmful ingredients, or ethical violations.
- 4-5: Below average. Concerning signals but not disqualifying.
- 6-7: Acceptable. Passes the gate but not a standout.
- 8-9: Strong. Clear evidence of quality/safety/ethics above the norm.
- 10: Exceptional. Best-in-class, rare.
- Never default to 5 or 6 just because you are uncertain. Search more, then commit.

AUTO-DISQUALIFIERS (set disqualified: true and stop scoring that gate):
- Gate 2: Any ingredient rated 7-10 hazard on EWG Skin Deep, OR proven false clean/natural claim
- Gate 3: Verified active labor violation, OR documented review fraud/FTC action

BADGE LOGIC (apply after scoring):
- TELL_ME_ITS_GOOD: all three gate averages >= 6, no disqualifiers
- CLEAN_PICK: gate1_avg >= 6 AND gate2_avg >= 6, gate3 < 6 or unverified
- ETHICAL_PICK: gate1_avg >= 6 AND gate3_avg >= 6, gate2 < 6 or N/A
- QUALITY_PICK: gate1_avg >= 6 only
- NOT_LISTED: gate1_avg < 6 OR any disqualifier triggered

CRITICAL OUTPUT RULES:
- Your ENTIRE response must be a single valid JSON object.
- Do NOT write any text before the opening brace.
- Do NOT write any text after the closing brace.
- Do NOT say Based on my research or Here is or anything outside the JSON.
- Do NOT use markdown code fences or backticks.
- Start your response with { and end with }

Return this exact JSON structure:

{
  "productName": "full product name",
  "brand": "brand name",
  "price": "$XX.XX or Price not found",
  "productUrl": "canonical product URL or null",
  "badge": "TELL_ME_ITS_GOOD",
  "overallScore": 7.2,
  "gate1": {
    "name": "Value & Quality",
    "average": 7.4,
    "passes": true,
    "criteria": {
      "performance": { "label": "Core performance", "score": 8, "evidence": "one specific sentence", "source_url": "https://..." },
      "durability": { "label": "Build quality & longevity", "score": 7, "evidence": "one specific sentence", "source_url": "https://..." },
      "value": { "label": "Price-to-quality ratio", "score": 7, "evidence": "one specific sentence with dollar comparison", "source_url": "https://..." },
      "honest_claims": { "label": "Honest product claims", "score": 8, "evidence": "one specific sentence", "source_url": "https://..." },
      "usability": { "label": "Usability & experience", "score": 7, "evidence": "one specific sentence", "source_url": "https://..." }
    }
  },
  "gate2": {
    "name": "Clean & Safe",
    "average": 7.0,
    "passes": true,
    "disqualified": false,
    "disqualifier_reason": null,
    "criteria": {
      "ingredient_safety": { "label": "Ingredient safety", "score": 7, "evidence": "specific finding with ingredient names or EWG ratings", "source_url": "https://..." },
      "transparency": { "label": "Full ingredient disclosure", "score": 7, "evidence": "one specific sentence", "source_url": "https://..." },
      "greenwashing": { "label": "No greenwashing", "score": 7, "evidence": "one specific sentence", "source_url": "https://..." },
      "children_pets": { "label": "Safe around kids & pets", "score": 7, "evidence": "one specific sentence or Not applicable", "source_url": null },
      "packaging": { "label": "Packaging honesty", "score": 7, "evidence": "one specific sentence", "source_url": "https://..." }
    }
  },
  "gate3": {
    "name": "Ethical Company",
    "average": 7.0,
    "passes": true,
    "disqualified": false,
    "disqualifier_reason": null,
    "criteria": {
      "sourcing": { "label": "Supply chain transparency", "score": 7, "evidence": "one specific sentence", "source_url": "https://..." },
      "labor": { "label": "No major labor violations", "score": 7, "evidence": "one specific sentence", "source_url": "https://..." },
      "reviews": { "label": "Honest review practices", "score": 7, "evidence": "one specific sentence", "source_url": "https://..." },
      "marketing": { "label": "No manipulative marketing", "score": 7, "evidence": "one specific sentence", "source_url": "https://..." },
      "accountability": { "label": "Accountability track record", "score": 7, "evidence": "one specific sentence", "source_url": "https://..." }
    }
  },
  "summary": {
    "tldr": "one punchy sentence max 20 words",
    "brandTax": "specific dollar and % estimate with named alternative",
    "bestTimeToBuy": "specific actionable advice",
    "realTalk": "honest summary of owner experience vs marketing claims",
    "pros": ["pro 1", "pro 2", "pro 3"],
    "cons": ["con 1", "con 2", "con 3"],
    "alternatives": [
      { "name": "alternative product/brand", "reason": "why worth considering" },
      { "name": "alternative product/brand", "reason": "why worth considering" }
    ]
  }
}`,

        messages: [
          {
            role: 'user',
            content: userMessage,
          },
        ],
      }),
    });

    // ── 4. Handle Claude API errors ────────────────────────
    if (!claudeRes.ok) {
      const errData = await claudeRes.json().catch(() => ({}));
      const message = errData.error?.message || `Claude API error ${claudeRes.status}`;
      console.error('Claude API error:', claudeRes.status, errData);
      return res.status(502).json({ error: message });
    }

    // ── 5. Parse Claude's response ──────────────────────────
    // Claude returns multiple content blocks when using web_search.
    // We want the LAST text block — that's the final answer after all searches.
    const claudeData = await claudeRes.json();

    console.log('Response blocks:', claudeData.content?.map(b => b.type).join(', '));

    const textBlocks = claudeData.content?.filter(b => b.type === 'text') || [];

    if (textBlocks.length === 0) {
      return res.status(502).json({ error: 'Claude returned no text content.' });
    }

    const rawText = textBlocks[textBlocks.length - 1].text;
    console.log('Raw text preview:', rawText.slice(0, 200));

    // ── 6. Extract JSON robustly ────────────────────────────
    // Claude sometimes prepends prose like "Based on my research..."
    // even when instructed not to. extractOutermostJson() handles this
    // by scanning for the first { and tracking brace depth to find its
    // matching }, rather than using a greedy regex that can grab wrong content.
    const research = extractOutermostJson(rawText);

    if (!research) {
      console.error('JSON extraction failed. Raw text:', rawText.slice(0, 500));
      return res.status(502).json({
        error: 'Could not parse the research response. Please try again.',
      });
    }

    return res.status(200).json(research);

  } catch (err) {
    console.error('Server error in /api/research:', err);
    return res.status(500).json({
      error: 'Something went wrong on the server: ' + err.message,
    });
  }
}

// =============================================================
// extractOutermostJson(text)
// =============================================================
// Finds the outermost { ... } in a string, correctly handling
// nested objects and string values that contain braces.
//
// Why not regex /\{[\s\S]*\}/ ?
// That grabs from the first { to the LAST } in the string.
// If Claude adds any text after the JSON, the match is broken.
// This function tracks brace depth so it always finds the exact
// matching closing brace for the first opening brace.
//
function extractOutermostJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escape) { escape = false; continue; }
    if (char === '\\' && inString) { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }

    if (!inString) {
      if (char === '{') depth++;
      if (char === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch (e) {
            console.error('JSON.parse failed:', e.message);
            return null;
          }
        }
      }
    }
  }

  return null;
}
