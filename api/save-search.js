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

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
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
