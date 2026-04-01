// =============================================================
// /api/save-search.js  —  Vercel Serverless Function
// =============================================================
// Saves a completed research result to the Supabase `searches`
// table for the authenticated user.
//
// This runs SERVER-SIDE using the Supabase service role key,
// which bypasses Row Level Security and can write to any row.
// The service role key MUST stay secret — never in frontend JS.
//
// Flow:
//   Browser → POST /api/save-search { researchJson, accessToken }
//                ↓
//   This function verifies the token → writes to Supabase
//                ↓
//   Returns { success: true, id: "..." }
// =============================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = process.env.FROM_EMAIL || "Tell Me It's Good <hello@tellmeitsgood.com>";

// Absorbed from /api/send-welcome — routed here via vercel.json rewrite
async function handleWelcomeEmail(email, res) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (!RESEND_API_KEY) {
    console.warn('send-welcome: RESEND_API_KEY not set, skipping.');
    return res.json({ ok: true, skipped: true });
  }
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head><body style="margin:0;padding:0;background:#FAF8F5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;padding:40px 0;"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #DDD9D2;overflow:hidden;"><tr><td style="background:#2F6FED;padding:28px 36px;"><p style="margin:0;font-size:13px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:.06em;text-transform:uppercase;">tellmeitsgood.com</p><h1 style="margin:8px 0 0;font-family:Georgia,serif;font-size:26px;color:#ffffff;line-height:1.2;">Welcome. Let's find you something worth buying.</h1></td></tr><tr><td style="padding:32px 36px;"><p style="margin:0 0 20px;font-size:15px;color:#1C1917;line-height:1.6;">You now have <strong>3 free research credits per day</strong> — enough to check the products you're actually considering before you buy.</p><p style="margin:0 0 20px;font-size:15px;color:#1C1917;line-height:1.6;">Every verdict covers three things that actually matter:</p><table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="padding:10px 14px;background:#F3F0EB;border-radius:8px;"><strong style="color:#1C1917;font-size:14px;">🔬 Quality</strong><span style="color:#6B6560;font-size:14px;"> — Does it actually work?</span></td></tr><tr><td style="height:6px;"></td></tr><tr><td style="padding:10px 14px;background:#F3F0EB;border-radius:8px;"><strong style="color:#1C1917;font-size:14px;">🛡 Safety</strong><span style="color:#6B6560;font-size:14px;"> — No harmful ingredients.</span></td></tr><tr><td style="height:6px;"></td></tr><tr><td style="padding:10px 14px;background:#F3F0EB;border-radius:8px;"><strong style="color:#1C1917;font-size:14px;">⚖️ Ethics</strong><span style="color:#6B6560;font-size:14px;"> — Transparent company, honest practices.</span></td></tr></table><table cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="background:#2F6FED;border-radius:10px;padding:14px 28px;"><a href="https://tellmeitsgood.com" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Research a product →</a></td></tr></table><hr style="border:none;border-top:1px solid #EAE6DF;margin:0 0 24px;"/><p style="margin:0;font-size:13px;color:#A09891;line-height:1.6;">Need more? <a href="https://tellmeitsgood.com/?pro=1" style="color:#2F6FED;text-decoration:none;">Go Pro for $9/month</a> — 25 searches/day + full history.</p></td></tr><tr><td style="padding:20px 36px;background:#F3F0EB;border-top:1px solid #DDD9D2;"><p style="margin:0;font-size:12px;color:#A09891;">You're receiving this because you created an account at tellmeitsgood.com.<br/>Questions? <a href="mailto:hello@tellmeitsgood.com" style="color:#6B6560;">hello@tellmeitsgood.com</a></p></td></tr></table></td></tr></table></body></html>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: "Welcome to Tell Me It's Good", html }),
    });
    if (!r.ok) {
      console.error('Resend error:', r.status, await r.text());
      return res.json({ ok: false, error: `Resend ${r.status}` });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('send-welcome error:', err.message);
    return res.json({ ok: false, error: err.message });
  }
}

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // Welcome email route (absorbed from /api/send-welcome via vercel.json rewrite)
  if (req.body?.email && !req.body?.researchJson) {
    return handleWelcomeEmail(req.body.email, res);
  }

  const { researchJson, accessToken } = req.body;

  // ── Validate inputs ────────────────────────────────────────
  if (!researchJson || typeof researchJson !== 'object') {
    return res.status(400).json({ error: 'No research data provided.' });
  }

  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  // ── Verify the user's session token with Supabase ──────────
  // We call Supabase's auth API to get the user from their access token.
  // This confirms the token is valid and tells us their user ID.
  // We use the anon key here (just for auth verification — that's fine).
  try {
    const userRes = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey': process.env.SUPABASE_ANON_KEY,
        },
      }
    );

    if (!userRes.ok) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }

    const user = await userRes.json();
    const userId = user.id;

    // ── Write to the searches table ────────────────────────────
    // We use the service role key here so we can write regardless of RLS.
    // The service role key is a SECRET — it only exists in Vercel env vars.
    const insertRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/searches`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'return=representation', // return the inserted row
        },
        body: JSON.stringify({
          user_id:      userId,
          product_name: researchJson.productName || 'Unknown product',
          brand:        researchJson.brand || null,
          price:        researchJson.price || null,
          badge:        researchJson.badge || null,
          overall_score: researchJson.overallScore || null,
          full_result:  researchJson, // store the whole JSON for re-display
        }),
      }
    );

    if (!insertRes.ok) {
      const errData = await insertRes.json().catch(() => ({}));
      console.error('Supabase insert error:', insertRes.status, errData);
      return res.status(502).json({ error: 'Failed to save search.' });
    }

    const inserted = await insertRes.json();
    const savedId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;

    return res.status(200).json({ success: true, id: savedId });

  } catch (err) {
    console.error('Server error in /api/save-search:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
