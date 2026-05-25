// =============================================================
// /api/admin.js  —  Vercel Serverless Function
// =============================================================
// GET  → admin stats dashboard (requires ADMIN_EMAIL session)
// POST → request product refresh (rate-limited, public)
// =============================================================

import { rateLimit } from './_rateLimit.js';

const ADMIN_RATE = { windowMs: 60 * 60 * 1000, max: 120 };

const refreshRequested = new Map();

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractJson(text) {
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}
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

  // ── POST: admin-import or product refresh ────────────────────
  if (req.method === 'POST') {
    const SUPABASE_URL         = process.env.SUPABASE_URL;
    const SERVICE_KEY          = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ADMIN_EMAIL          = process.env.ADMIN_EMAIL;

    const postAuth  = req.headers.authorization || '';
    const postToken = postAuth.startsWith('Bearer ') ? postAuth.slice(7) : null;
    if (!postToken) return res.status(401).json({ error: 'Unauthorized' });

    const postUserRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${postToken}` },
    });
    if (!postUserRes.ok) return res.status(401).json({ error: 'Invalid session' });
    const postUser = await postUserRes.json();
    if (postUser.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    // ── admin-import: convert Perplexity research → JSON → save ──
    if (req.query.action === 'import') {
      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
      const { researchTopic, researchText } = req.body || {};
      if (!researchText || typeof researchText !== 'string' || researchText.trim().length < 100) {
        return res.status(400).json({ error: 'researchText too short (need at least 100 chars)' });
      }
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
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 16000,
            system: systemPrompt,
            messages: [{ role: 'user', content: `${researchTopic ? `Research topic: ${researchTopic}\n\n` : ''}Perplexity research findings:\n\n${researchText.trim()}` }],
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
          return res.status(502).json({ error: 'Could not parse Claude response as JSON.', raw_preview: rawText.slice(0, 300) });
        }
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const now = new Date().toISOString();
        const saved = [];
        for (const research of items) {
          if (!research || typeof research !== 'object') continue;
          const slug = slugify(research.productName || 'unknown-product');
          const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Prefer': 'resolution=merge-duplicates' },
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
            saved.push({ slug, productName: research.productName, badge: research.badge, overallScore: research.overallScore, tldr: research.summary?.tldr || null });
          }
        }
        return res.json({ ok: true, count: saved.length, products: saved });
      } catch (err) {
        console.error('admin-import error:', err.message);
        return res.status(500).json({ error: err.message });
      }
    }

    const { slug } = req.body || {};
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ error: 'slug required' });
    }

    const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const key = `${ip}:${slug}`;
    const now = Date.now();
    if (now - (refreshRequested.get(key) || 0) < 60 * 60 * 1000) {
      return res.status(429).json({ error: 'Already requested recently' });
    }
    refreshRequested.set(key, now);

    if (refreshRequested.size > 5000) {
      const cutoff = now - 2 * 60 * 60 * 1000;
      for (const [k, v] of refreshRequested) {
        if (v < cutoff) refreshRequested.delete(k);
      }
    }

    try {
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_refresh_requests`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ p_slug: slug }),
      });

      if (!rpcRes.ok) {
        const rows = await fetch(
          `${SUPABASE_URL}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}&select=refresh_requests`,
          { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
        ).then(r => r.json());
        const current = rows?.[0]?.refresh_requests || 0;
        await fetch(`${SUPABASE_URL}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ refresh_requests: current + 1 }),
        });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error('request-refresh error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // ── GET: admin stats ──────────────────────────────────────────
  if (req.method === 'GET') {
    const limited = rateLimit(req, res, ADMIN_RATE);
    if (limited) return;

    const SUPABASE_URL         = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ADMIN_EMAIL          = process.env.ADMIN_EMAIL;

    const missing = [!SUPABASE_URL && 'SUPABASE_URL', !SUPABASE_SERVICE_KEY && 'SUPABASE_SERVICE_ROLE_KEY', !ADMIN_EMAIL && 'ADMIN_EMAIL'].filter(Boolean);
    if (missing.length) {
      return res.status(500).json({ error: 'Server misconfigured', missing });
    }

    const auth  = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${token}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });

    const user = await userRes.json();
    if (user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    const h = {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
    };

    const view = req.query?.view;

    // ── PING — lightweight admin check (no Supabase queries) ──
    if (view === 'ping') {
      return res.json({ ok: true });
    }

    // ── PRODUCTS view ──────────────────────────────────────────
    if (view === 'products') {
      const page   = Math.max(0, parseInt(req.query?.page || '0'));
      const q      = (req.query?.q || '').trim().replace(/[*%]/g, ''); // strip PostgREST wildcards
      const limit  = 50;
      const offset = page * limit;
      const filter = q ? `&product_name=ilike.*${encodeURIComponent(q)}*` : '';

      const [listRes, countRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/products?select=slug,product_name,badge,overall_score,category,researched_at,refresh_requests&order=researched_at.desc&limit=${limit}&offset=${offset}${filter}`, { headers: h }),
        fetch(`${SUPABASE_URL}/rest/v1/products?select=count${filter}`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      ]);
      const products = await listRes.json();
      const total    = parseInt(countRes.headers.get('content-range')?.split('/')[1] || '0');
      return res.json({ products: Array.isArray(products) ? products : [], total, page, limit });
    }

    // ── USERS view ─────────────────────────────────────────────
    if (view === 'users') {
      const [usersRes, profilesRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
        }),
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,is_pro`, { headers: h }),
      ]);
      const usersData  = usersRes.ok ? await usersRes.json() : { users: [] };
      const profiles   = profilesRes.ok ? await profilesRes.json() : [];
      const profileMap = {};
      (Array.isArray(profiles) ? profiles : []).forEach(p => { profileMap[p.id] = p; });

      const users = (usersData.users || [])
        .map(u => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, is_pro: profileMap[u.id]?.is_pro || false }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      return res.json({ users, total: users.length, pro: users.filter(u => u.is_pro).length });
    }

    // ── SEARCHES view ──────────────────────────────────────────
    if (view === 'searches') {
      const searchesRes = await fetch(
        `${SUPABASE_URL}/rest/v1/searches?select=product_name,badge,created_at&order=created_at.desc&limit=500`,
        { headers: h }
      );
      const searches = searchesRes.ok ? (await searchesRes.json()) : [];
      const rows     = Array.isArray(searches) ? searches : [];

      const byDay = {};
      for (let i = 13; i >= 0; i--) {
        byDay[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] = 0;
      }
      rows.forEach(s => { const d = s.created_at?.slice(0, 10); if (d && byDay[d] !== undefined) byDay[d]++; });

      const productCount = {};
      rows.forEach(s => {
        if (!s.product_name) return;
        if (!productCount[s.product_name]) productCount[s.product_name] = { count: 0, badge: s.badge };
        productCount[s.product_name].count++;
      });
      const topProducts = Object.entries(productCount)
        .sort((a, b) => b[1].count - a[1].count).slice(0, 15)
        .map(([name, v]) => ({ name, count: v.count, badge: v.badge }));

      return res.json({ total: rows.length, byDay, topProducts });
    }

    // ── OVERVIEW (default) ─────────────────────────────────────
    const sevenDaysAgo  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      totalProductsRes, recentProductsRes, categoryRes, badgeRes,
      bookmarkCountRes, topBookmarkedRes, newUsersRes, proCountRes,
      searches7dRes, searches30dRes,
    ] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/products?select=count`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      fetch(`${SUPABASE_URL}/rest/v1/products?select=slug,product_name,badge,overall_score,category,researched_at&order=researched_at.desc&limit=10`, { headers: h }),
      fetch(`${SUPABASE_URL}/rest/v1/products?select=category&category=not.is.null`, { headers: h }),
      fetch(`${SUPABASE_URL}/rest/v1/products?select=badge&badge=not.is.null`, { headers: h }),
      fetch(`${SUPABASE_URL}/rest/v1/bookmarks?select=count`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      fetch(`${SUPABASE_URL}/rest/v1/bookmarks?select=slug,product_name&order=slug`, { headers: h }),
      fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }),
      fetch(`${SUPABASE_URL}/rest/v1/profiles?select=count&is_pro=eq.true`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      fetch(`${SUPABASE_URL}/rest/v1/searches?select=count&created_at=gte.${sevenDaysAgo}`,  { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      fetch(`${SUPABASE_URL}/rest/v1/searches?select=count&created_at=gte.${thirtyDaysAgo}`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
    ]);

    const totalProducts  = parseInt(totalProductsRes.headers.get('content-range')?.split('/')[1] || '0');
    const recentProducts = await recentProductsRes.json();

    const categoryRows      = await categoryRes.json();
    const categoryBreakdown = {};
    (Array.isArray(categoryRows) ? categoryRows : []).forEach(r => {
      categoryBreakdown[r.category || 'Other'] = (categoryBreakdown[r.category || 'Other'] || 0) + 1;
    });

    const badgeRows      = await badgeRes.json();
    const badgeBreakdown = {};
    (Array.isArray(badgeRows) ? badgeRows : []).forEach(r => {
      badgeBreakdown[r.badge || 'UNKNOWN'] = (badgeBreakdown[r.badge || 'UNKNOWN'] || 0) + 1;
    });

    const totalBookmarks = parseInt(bookmarkCountRes.headers.get('content-range')?.split('/')[1] || '0');
    const bookmarkRows   = await topBookmarkedRes.json();
    const bookmarkMap    = {};
    (Array.isArray(bookmarkRows) ? bookmarkRows : []).forEach(r => {
      if (!bookmarkMap[r.slug]) bookmarkMap[r.slug] = { slug: r.slug, product_name: r.product_name, count: 0 };
      bookmarkMap[r.slug].count++;
    });
    const topBookmarked = Object.values(bookmarkMap).sort((a, b) => b.count - a.count).slice(0, 5);

    let newUsersCount = 0, totalUsers = 0;
    if (newUsersRes.ok) {
      const usersData = await newUsersRes.json();
      const users     = usersData.users || [];
      totalUsers      = users.length;
      newUsersCount   = users.filter(u => u.created_at >= sevenDaysAgo).length;
    }

    const proUsers    = parseInt(proCountRes.headers.get('content-range')?.split('/')[1] || '0');
    const searches7d  = parseInt(searches7dRes.headers.get('content-range')?.split('/')[1]  || '0');
    const searches30d = parseInt(searches30dRes.headers.get('content-range')?.split('/')[1] || '0');

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      totalProducts, totalUsers, newUsersCount, proUsers, totalBookmarks,
      searches7d, searches30d,
      recentProducts: Array.isArray(recentProducts) ? recentProducts : [],
      categoryBreakdown, badgeBreakdown, topBookmarked,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
