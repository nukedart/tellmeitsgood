// =============================================================
// /api/admin-import.js  —  Vercel Serverless Function
// =============================================================
// Admin-only endpoint. Takes a product name + pasted Perplexity
// deep research text and uses Claude (no web search) to convert
// it into the exact tellmeitsgood JSON schema, then saves to the
// products table.
//
// Flow:
//   Admin panel → POST /api/admin-import { productName, researchText, accessToken }
//                   ↓
//   Verify admin session → Claude formats → save to products → return slug
// =============================================================

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Extracts the outermost JSON array or object from a Claude response.
// Returns the parsed value (may be an array or an object).
function extractJson(text) {
  // Strip markdown code fences
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // First try a straight parse in case the response is clean
  try { return JSON.parse(cleaned); } catch {}

  // Find the first [ or { and balance-match to the end
  const firstBracket = cleaned.indexOf('[');
  const firstBrace   = cleaned.indexOf('{');
  let start;
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    start = firstBracket;
  } else if (firstBrace !== -1) {
    start = firstBrace;
  } else {
    return null;
  }

  let depth = 0, inString = false, escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (!inString) {
      if (c === '[' || c === '{') depth++;
      if (c === ']' || c === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_EMAIL   = process.env.ADMIN_EMAIL;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  // ── Auth: verify admin session ────────────────────────────
  const { researchTopic, researchText, accessToken } = req.body || {};

  if (!accessToken) return res.status(401).json({ error: 'Unauthorized' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${accessToken}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const user = await userRes.json();
  if (user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

  // ── Validate inputs ───────────────────────────────────────
  if (!researchText || typeof researchText !== 'string' || researchText.trim().length < 100) {
    return res.status(400).json({ error: 'researchText too short (need at least 100 chars)' });
  }

  // ── Claude: convert Perplexity text → our JSON schema ────
  const systemPrompt = `You are a data formatter for tellmeitsgood.com. You receive raw product research text (from Perplexity deep research) and convert it into a specific JSON schema. You do NOT do your own research — you only format what you are given.

SCORING RULES when interpreting findings:
- 1-3: Fails badly. Clear evidence of problems.
- 4-5: Below average. Concerning signals but not disqualifying.
- 6-7: Acceptable. Passes the gate but not a standout.
- 8-9: Strong. Clear evidence above the norm.
- 10: Exceptional. Best-in-class, rare.

AUTO-DISQUALIFIERS:
- Gate 2: Any ingredient rated 7-10 hazard on EWG Skin Deep, OR proven false clean/natural claim → set disqualified: true
- Gate 3: Verified active labor violation, OR documented review fraud/FTC action → set disqualified: true

BADGE LOGIC:
- TELL_ME_ITS_GOOD: all three gate averages >= 6, no disqualifiers
- CLEAN_PICK: gate1_avg >= 6 AND gate2_avg >= 6, gate3 < 6 or unverified
- ETHICAL_PICK: gate1_avg >= 6 AND gate3_avg >= 6, gate2 < 6 or N/A
- QUALITY_PICK: gate1_avg >= 6 only
- NOT_LISTED: gate1_avg < 6 OR any disqualifier triggered

POST NARRATIVE VOICE:
- Write like the smartest, most honest friend: direct, warm, specific.
- Reference actual scores and evidence. Be honest about weaknesses.
- Never use: "comprehensive", "seamlessly", "robust", "game-changer", "revolutionary".

CRITICAL OUTPUT RULES:
- Your ENTIRE response must be a valid JSON array — even if there is only one product.
- Start with [ and end with ]
- Do NOT write any text before [ or after ]
- Do NOT use markdown code fences.

Return a JSON array where each element follows this exact schema (one element per distinct product found in the research):

[{
  "productName": string,
  "brand": string,
  "price": "$XX.XX or Price not found",
  "productUrl": string|null,
  "badge": "TELL_ME_ITS_GOOD|CLEAN_PICK|ETHICAL_PICK|QUALITY_PICK|NOT_LISTED",
  "category": "Personal Care|Cleaning & Home|Food & Drink|Baby & Kids|Clothing & Footwear|Supplements & Health|Pet Care|Electronics|Other",
  "overallScore": number,
  "gate1": {
    "name": "Value & Quality", "average": number, "passes": bool,
    "criteria": {
      "performance":    { "label": "Core performance",          "score": int, "evidence": string, "source_url": string|null },
      "durability":     { "label": "Build quality & longevity", "score": int, "evidence": string, "source_url": string|null },
      "value":          { "label": "Price-to-quality ratio",    "score": int, "evidence": string, "source_url": string|null },
      "honest_claims":  { "label": "Honest product claims",     "score": int, "evidence": string, "source_url": string|null },
      "usability":      { "label": "Usability & experience",    "score": int, "evidence": string, "source_url": string|null }
    }
  },
  "gate2": {
    "name": "Clean & Safe", "average": number, "passes": bool, "disqualified": bool, "disqualifier_reason": string|null,
    "criteria": {
      "ingredient_safety": { "label": "Ingredient safety",         "score": int, "evidence": string, "source_url": string|null },
      "transparency":      { "label": "Full ingredient disclosure", "score": int, "evidence": string, "source_url": string|null },
      "greenwashing":      { "label": "No greenwashing",           "score": int, "evidence": string, "source_url": string|null },
      "children_pets":     { "label": "Safe around kids & pets",   "score": int, "evidence": string, "source_url": string|null },
      "packaging":         { "label": "Packaging honesty",         "score": int, "evidence": string, "source_url": string|null }
    }
  },
  "gate3": {
    "name": "Ethical Company", "average": number, "passes": bool, "disqualified": bool, "disqualifier_reason": string|null,
    "criteria": {
      "sourcing":       { "label": "Supply chain transparency", "score": int, "evidence": string, "source_url": string|null },
      "labor":          { "label": "No major labor violations", "score": int, "evidence": string, "source_url": string|null },
      "reviews":        { "label": "Honest review practices",   "score": int, "evidence": string, "source_url": string|null },
      "marketing":      { "label": "No manipulative marketing", "score": int, "evidence": string, "source_url": string|null },
      "accountability": { "label": "Accountability track record","score": int, "evidence": string, "source_url": string|null }
    }
  },
  "summary": {
    "tldr": "one punchy sentence max 20 words",
    "brandTax": "specific dollar and % estimate with named alternative",
    "bestTimeToBuy": "specific actionable advice",
    "realTalk": "honest owner-experience summary vs marketing claims",
    "pros": [string, string, string],
    "cons": [string, string, string],
    "alternatives": [
      { "name": string, "reason": string },
      { "name": string, "reason": string }
    ]
  },
  "post_narrative": {
    "hook": "one sentence, max 25 words, fact with opinion baked in",
    "verdict_paragraph": "2-3 sentences on why this badge was earned. Reference gate scores.",
    "gate_summaries": {
      "gate1": "1-2 sentences on quality/value findings",
      "gate2": "1-2 sentences on clean/safe findings",
      "gate3": "1-2 sentences on ethics findings"
    },
    "who_its_for": "one sentence describing the exact right buyer",
    "who_its_not_for": "one sentence describing who should skip it",
    "bottom_line": "the single most honest thing you can say"
  }
}]`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `${researchTopic ? `Research topic: ${researchTopic}\n\n` : ''}Perplexity research findings:\n\n${researchText.trim()}`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || `Claude ${claudeRes.status}` });
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.find(b => b.type === 'text')?.text || '';
    const parsed = extractJson(rawText);

    if (!parsed) {
      console.error('JSON parse failed. Raw (first 800):', rawText.slice(0, 800));
      return res.status(502).json({
        error: 'Could not parse Claude response as JSON.',
        hint: 'The research text may be too complex or ambiguous. Try shortening it or breaking it into sections.',
        raw_preview: rawText.slice(0, 300),
      });
    }

    // Normalise to array — Claude may return a single object if research covers one product
    const items = Array.isArray(parsed) ? parsed : [parsed];

    // ── Save each product to the products table ───────────────
    const now = new Date().toISOString();
    const saved = [];

    for (const research of items) {
      if (!research || typeof research !== 'object') continue;
      const slug = slugify(research.productName || 'unknown-product');
      const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          slug,
          query:          (research.productName || '').toLowerCase().trim(),
          product_name:   research.productName   || null,
          brand:          research.brand          || null,
          badge:          research.badge          || null,
          category:       research.category       || null,
          overall_score:  research.overallScore   || null,
          full_result:    research,
          post_narrative: research.post_narrative || null,
          researched_at:  now,
          is_public:      true,
        }),
      });

      if (!saveRes.ok) {
        const err = await saveRes.text();
        console.error('Supabase save error for', slug, ':', saveRes.status, err);
        saved.push({ slug, error: 'Failed to save to database' });
      } else {
        saved.push({
          slug,
          productName:  research.productName,
          badge:        research.badge,
          overallScore: research.overallScore,
          tldr:         research.summary?.tldr || null,
        });
      }
    }

    return res.json({ ok: true, count: saved.length, products: saved });

  } catch (err) {
    console.error('admin-import error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
