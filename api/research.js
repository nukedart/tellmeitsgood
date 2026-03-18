// =============================================================
// /api/research.js  —  Vercel Serverless Function
// =============================================================
// The Triple Filter scoring engine. Accepts either scraped product
// text (from /api/scrape) OR a plain product name/search query.
// Uses Claude with web_search to find authoritative sources and
// score all 15 criteria across the three gates.
//
// Flow (URL path):
//   Browser → POST /api/research { productData: "...", sourceUrl: "..." }
//                ↓
//   This function → Claude API with web_search tool
//                ↓
//   Returns scored JSON with 15 criteria + badge + cited sources
//
// Flow (name search path):
//   Browser → POST /api/research { query: "Seventh Generation dish soap" }
//                ↓
//   This function → Claude API with web_search tool (finds product + researches it)
//                ↓
//   Returns same scored JSON
// =============================================================

export default async function handler(req, res) {

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

  // Build the user message depending on which path we're on
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
        max_tokens: 3000,

        // ── Web search tool ──────────────────────────────────
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
- Never default to 5 or 6 just because you're uncertain. Search more, then commit.

AUTO-DISQUALIFIERS (set disqualified: true and stop scoring that gate):
- Gate 2: Any ingredient rated 7-10 hazard on EWG Skin Deep, OR proven false "clean/natural" claim
- Gate 3: Verified active labor violation, OR documented review fraud/FTC action

BADGE LOGIC (apply after scoring):
- "TELL_ME_ITS_GOOD": all three gate averages >= 6, no disqualifiers
- "CLEAN_PICK": gate1_avg >= 6 AND gate2_avg >= 6, gate3 < 6 or unverified
- "ETHICAL_PICK": gate1_avg >= 6 AND gate3_avg >= 6, gate2 < 6 or N/A
- "QUALITY_PICK": gate1_avg >= 6 only
- "NOT_LISTED": gate1_avg < 6 OR any disqualifier triggered

For each criterion score, provide:
- score: 1-10 integer
- evidence: one specific sentence explaining why (not generic)
- source_url: the actual URL you found this evidence at (use web_search)

Return ONLY valid JSON. No markdown, no backticks, no explanation outside the JSON:

{
  "productName": "full product name extracted or found",
  "brand": "brand name",
  "price": "price as string e.g. '$24.99' or 'Price not found'",
  "productUrl": "canonical product URL",
  "badge": "TELL_ME_ITS_GOOD" | "CLEAN_PICK" | "ETHICAL_PICK" | "QUALITY_PICK" | "NOT_LISTED",
  "overallScore": <weighted average of all three gate averages, 1 decimal>,
  "gate1": {
    "name": "Value & Quality",
    "average": <average of 5 criteria scores, 1 decimal>,
    "passes": true | false,
    "criteria": {
      "performance": {
        "label": "Core performance",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      },
      "durability": {
        "label": "Build quality & longevity",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      },
      "value": {
        "label": "Price-to-quality ratio",
        "score": <1-10>,
        "evidence": "specific one-sentence finding with dollar comparison",
        "source_url": "https://..."
      },
      "honest_claims": {
        "label": "Honest product claims",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      },
      "usability": {
        "label": "Usability & experience",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      }
    }
  },
  "gate2": {
    "name": "Clean & Safe",
    "average": <average of 5 criteria scores, 1 decimal>,
    "passes": true | false,
    "disqualified": false,
    "disqualifier_reason": null,
    "criteria": {
      "ingredient_safety": {
        "label": "Ingredient safety",
        "score": <1-10>,
        "evidence": "specific finding referencing actual ingredient names or EWG ratings",
        "source_url": "https://..."
      },
      "transparency": {
        "label": "Full ingredient disclosure",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      },
      "greenwashing": {
        "label": "No greenwashing",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      },
      "children_pets": {
        "label": "Safe around kids & pets",
        "score": <1-10>,
        "evidence": "specific one-sentence finding, or 'Not applicable for this product category' if irrelevant",
        "source_url": "https://... or null"
      },
      "packaging": {
        "label": "Packaging honesty",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      }
    }
  },
  "gate3": {
    "name": "Ethical Company",
    "average": <average of 5 criteria scores, 1 decimal>,
    "passes": true | false,
    "disqualified": false,
    "disqualifier_reason": null,
    "criteria": {
      "sourcing": {
        "label": "Supply chain transparency",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      },
      "labor": {
        "label": "No major labor violations",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      },
      "reviews": {
        "label": "Honest review practices",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      },
      "marketing": {
        "label": "No manipulative marketing",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      },
      "accountability": {
        "label": "Accountability track record",
        "score": <1-10>,
        "evidence": "specific one-sentence finding",
        "source_url": "https://..."
      }
    }
  },
  "summary": {
    "tldr": "one punchy sentence a friend would text — max 20 words, no corporate language",
    "brandTax": "specific dollar and % estimate with named alternative, or 'No significant brand tax' with reason",
    "bestTimeToBuy": "specific actionable advice — name the sale event, timing, or alternative purchase path",
    "realTalk": "what reviewers and owners actually say vs what the marketing claims — be honest and specific",
    "pros": ["pro 1", "pro 2", "pro 3"],
    "cons": ["con 1", "con 2", "con 3"],
    "alternatives": [
      { "name": "alternative product/brand", "reason": "why it's worth considering" },
      { "name": "alternative product/brand", "reason": "why it's worth considering" }
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
      return res.status(502).json({ error: message });
    }

    // ── 5. Parse Claude's response ──────────────────────────
    // Claude may return multiple content blocks when using tools
    // (web_search blocks + final text block). We want the last text block.
    const claudeData = await claudeRes.json();
    const textBlock = claudeData.content
      .filter(block => block.type === 'text')
      .pop();

    if (!textBlock) {
      return res.status(502).json({ error: 'Claude returned no text content.' });
    }

    // Strip any accidental markdown fences
    const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
    const research = JSON.parse(cleaned);

    // ── 6. Send the research result back to the browser ─────
    return res.status(200).json(research);

  } catch (err) {
    console.error('Server error in /api/research:', err);
    return res.status(500).json({
      error: 'Something went wrong on the server: ' + err.message,
    });
  }
}
