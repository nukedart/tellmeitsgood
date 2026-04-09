// =============================================================
// /api/research.js  —  Vercel Serverless Function
// =============================================================
// The Triple Filter scoring engine. Accepts either scraped product
// text (from /api/scrape) OR a plain product name/search query.
// Uses Claude with web_search to find authoritative sources and
// score all 15 criteria across the three gates.
// =============================================================

import { rateLimit } from './_rateLimit.js';

// Shared system prompt — used by both the POST handler and processQueue cron
const RESEARCH_SYSTEM_PROMPT = `You are the research engine AND writer for tellmeitsgood.com — a trusted product curation site that only lists products passing a strict Triple Filter: genuine quality, clean/safe ingredients, and ethical company practices.

Your job is to deeply research a product, score it across 15 criteria, then write a human-voiced listing post — all in one response.

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

POST NARRATIVE VOICE RULES (for post_narrative field):
- Write like the smartest, most honest friend they have: direct, warm, specific.
- Be specific — reference actual scores and evidence. Never be vague.
- Be honest about weaknesses. Trust is built by admitting what a product doesn't do well.
- Never use: "comprehensive", "seamlessly", "robust", "leverage", "game-changer", "revolutionary".

CRITICAL OUTPUT RULES:
- Your ENTIRE response must be a single valid JSON object.
- Do NOT write any text before the opening brace.
- Do NOT write any text after the closing brace.
- Do NOT say Based on my research or Here is or anything outside the JSON.
- Do NOT use markdown code fences or backticks.
- Start your response with { and end with }

Return this exact JSON structure (all fields required, no extras):

{
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
      "ingredient_safety": { "label": "Ingredient safety",          "score": int, "evidence": string, "source_url": string|null },
      "transparency":      { "label": "Full ingredient disclosure",  "score": int, "evidence": string, "source_url": string|null },
      "greenwashing":      { "label": "No greenwashing",            "score": int, "evidence": string, "source_url": string|null },
      "children_pets":     { "label": "Safe around kids & pets",    "score": int, "evidence": string, "source_url": string|null },
      "packaging":         { "label": "Packaging honesty",          "score": int, "evidence": string, "source_url": string|null }
    }
  },
  "gate3": {
    "name": "Ethical Company", "average": number, "passes": bool, "disqualified": bool, "disqualifier_reason": string|null,
    "criteria": {
      "sourcing":        { "label": "Supply chain transparency",    "score": int, "evidence": string, "source_url": string|null },
      "labor":           { "label": "No major labor violations",    "score": int, "evidence": string, "source_url": string|null },
      "reviews":         { "label": "Honest review practices",      "score": int, "evidence": string, "source_url": string|null },
      "marketing":       { "label": "No manipulative marketing",    "score": int, "evidence": string, "source_url": string|null },
      "accountability":  { "label": "Accountability track record",  "score": int, "evidence": string, "source_url": string|null }
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
    "hook": "one sentence, max 25 words, fact with opinion baked in — no fluff",
    "verdict_paragraph": "2-3 sentences on why this badge was earned or not. Reference gate scores specifically.",
    "gate_summaries": {
      "gate1": "1-2 sentences on quality/value findings — specific, not generic",
      "gate2": "1-2 sentences on clean/safe findings — reference actual ingredients or certifications",
      "gate3": "1-2 sentences on ethics findings — reference specific company behaviour"
    },
    "who_its_for": "one sentence describing the exact right buyer",
    "who_its_not_for": "one sentence describing who should skip it",
    "bottom_line": "the single most honest thing you can say — one sentence"
  }
}`;

// Shared slugify (mirrors cache-save.js)
function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default async function handler(req, res) {

  // ── Cron: process one pending queue item (GET, Vercel sends Authorization: Bearer CRON_SECRET) ──
  if (req.method === 'GET') {
    const CRON_SECRET = process.env.CRON_SECRET;
    const auth = req.headers.authorization || '';
    if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return processQueue(res);
  }

  // ── 0. Rate limiting ───────────────────────────────────────
  // Authenticated users (valid Supabase token) bypass IP rate limit —
  // their daily quota is enforced by check-limit.js instead.
  // Unauthenticated API calls (bots, direct abuse) still get capped.
  const userAuth = req.headers.authorization || '';
  let isAuthenticated = false;
  if (userAuth.startsWith('Bearer ')) {
    try {
      const verifyRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': userAuth,
        },
      });
      isAuthenticated = verifyRes.ok;
    } catch { /* treat as unauthenticated */ }
  }

  if (!isAuthenticated) {
    const limited = rateLimit(req, res, {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 5,
      message: 'You have made too many research requests. Please try again in an hour.',
    });
    if (limited) return;
  }

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
        'anthropic-beta': 'prompt-caching-2024-07-31,web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',

        // Combined research + post_narrative in one call.
        // ~1200 tokens for 15-criteria JSON + ~500 for post narrative = ~1700 output.
        // 4500 gives comfortable headroom for complex products.
        max_tokens: 4500,

        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 5,
          },
        ],

        system: [
          { type: 'text', text: RESEARCH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],

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

// =============================================================
// processQueue — called by Vercel Cron (GET /api/research)
// Picks up one pending research_queue item, runs research,
// saves to products cache, emails the user, marks done.
// =============================================================
async function processQueue(res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_KEY   = process.env.RESEND_API_KEY;
  const FROM_EMAIL   = process.env.FROM_EMAIL || "Tell Me It's Good <hello@tellmeitsgood.com>";

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const sbHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Fetch one pending queue item
    const qRes = await fetch(
      `${SUPABASE_URL}/rest/v1/research_queue?status=eq.pending&order=created_at.asc&limit=1&select=*`,
      { headers: sbHeaders }
    );
    const items = await qRes.json();
    if (!items?.length) return res.json({ ok: true, processed: 0 });

    const item = items[0];

    // 2. Mark processing (prevent double-pickup)
    await fetch(`${SUPABASE_URL}/rest/v1/research_queue?id=eq.${item.id}`, {
      method: 'PATCH', headers: sbHeaders,
      body: JSON.stringify({ status: 'processing' }),
    });

    // 3. Run Claude research
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31,web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        system: [{ type: 'text', cache_control: { type: 'ephemeral' }, text: RESEARCH_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: `Research and score this product using the Triple Filter: "${item.query}"` }],
      }),
    });

    if (!claudeRes.ok) throw new Error(`Claude API ${claudeRes.status}`);

    const claudeData = await claudeRes.json();
    const textBlocks = claudeData.content?.filter(b => b.type === 'text') || [];
    if (!textBlocks.length) throw new Error('Claude returned no text');
    const research = extractOutermostJson(textBlocks[textBlocks.length - 1].text);
    if (!research) throw new Error('Could not parse research JSON');

    // 4. Save to products cache
    const slug = slugify(research.productName || item.query);
    const cacheRes = await fetch(`${SUPABASE_URL}/rest/v1/products`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        slug,
        query:          item.query.toLowerCase().trim(),
        product_name:   research.productName  || item.query,
        brand:          research.brand         || null,
        badge:          research.badge         || null,
        category:       research.category      || null,
        overall_score:  research.overallScore  || null,
        full_result:    research,
        post_narrative: research.post_narrative || null,
        researched_at:  new Date().toISOString(),
        is_public:      true,
      }),
    });
    const resultSlug = cacheRes.ok ? slug : null;

    // 5. Mark queue item done
    await fetch(`${SUPABASE_URL}/rest/v1/research_queue?id=eq.${item.id}`, {
      method: 'PATCH', headers: sbHeaders,
      body: JSON.stringify({
        status: 'done',
        completed_at: new Date().toISOString(),
        result_slug: resultSlug,
      }),
    });

    // 6. Get user email from Supabase auth admin API
    let userEmail = item.user_email || null;
    if (!userEmail) {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${item.user_id}`, {
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
      });
      userEmail = (await userRes.json().catch(() => null))?.email;
    }

    // 7. Email the user
    if (RESEND_KEY && userEmail) {
      const BADGE_LABELS = {
        TELL_ME_ITS_GOOD: { label: "Tell Me It's Good ✓", color: '#3A9E6F' },
        CLEAN_PICK:       { label: 'Clean Pick',           color: '#2F6FED' },
        ETHICAL_PICK:     { label: 'Ethical Pick',         color: '#2F6FED' },
        QUALITY_PICK:     { label: 'Quality Pick',         color: '#2F6FED' },
        NOT_LISTED:       { label: 'Not Listed',           color: '#D94F4F' },
      };
      const b = BADGE_LABELS[research.badge] || { label: research.badge || 'Verdict in', color: '#2F6FED' };
      const productLink = resultSlug ? `https://tellmeitsgood.com/p/${resultSlug}` : 'https://tellmeitsgood.com';
      const scoreStr = research.overallScore ? ` (${research.overallScore}/10)` : '';
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#FAF8F5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;padding:40px 0;"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #DDD9D2;overflow:hidden;"><tr><td style="background:${b.color};padding:28px 36px;"><p style="margin:0;font-size:13px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:.06em;text-transform:uppercase;">tellmeitsgood.com</p><h1 style="margin:8px 0 0;font-family:Georgia,serif;font-size:26px;color:#ffffff;line-height:1.2;">Your research is ready.</h1></td></tr><tr><td style="padding:32px 36px;"><p style="margin:0 0 8px;font-size:14px;color:#6B6560;">You asked us to research:</p><p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#1C1917;">${research.productName || item.query}</p><table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="padding:16px 20px;background:#F3F0EB;border-radius:10px;border-left:4px solid ${b.color};"><p style="margin:0;font-size:12px;font-weight:700;color:#A09891;letter-spacing:.06em;text-transform:uppercase;">Verdict${scoreStr}</p><p style="margin:6px 0 0;font-size:20px;font-weight:700;color:${b.color};">${b.label}</p></td></tr></table><table cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="background:#2F6FED;border-radius:10px;padding:14px 28px;"><a href="${productLink}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">See the full breakdown →</a></td></tr></table><hr style="border:none;border-top:1px solid #EAE6DF;margin:0 0 24px;"/><p style="margin:0;font-size:13px;color:#A09891;">You requested fresh research on tellmeitsgood.com.<br/>Questions? <a href="mailto:hello@tellmeitsgood.com" style="color:#6B6560;">hello@tellmeitsgood.com</a></p></td></tr></table></td></tr></table></body></html>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: [userEmail], subject: `Research ready: ${research.productName || item.query}`, html }),
      }).catch(err => console.error('Resend error:', err.message));
    }

    return res.json({ ok: true, processed: 1, slug: resultSlug, badge: research.badge });

  } catch (err) {
    console.error('processQueue error:', err.message);
    // Best-effort: mark the item failed if we have its id
    return res.status(500).json({ error: err.message });
  }
}
