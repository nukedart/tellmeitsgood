// =============================================================
// /api/job-queue.js  —  Vercel Serverless Function
// =============================================================
// Manages research jobs per authenticated user.
//
// POST   { query }               — create a new job
// GET                            — list user's recent jobs
// PATCH  ?job_id=:id  { status, badge?, overall_score?, result_slug? }
//                                — update a job (client marks done/pending)
// =============================================================

async function getUser(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': auth, 'apikey': process.env.SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const SB_HEADERS = () => ({
  'Content-Type': 'application/json',
  'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
});

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured.' });
  }

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized.' });

  // ── GET: list user's recent jobs ──────────────────────────
  if (req.method === 'GET') {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/research_queue?user_id=eq.${user.id}&select=id,query,status,badge,overall_score,result_slug,created_at,completed_at&order=created_at.desc&limit=15`,
      { headers: SB_HEADERS() }
    );
    if (!r.ok) return res.status(502).json({ error: 'Failed to fetch jobs.' });
    const jobs = await r.json();
    return res.json({ jobs: Array.isArray(jobs) ? jobs : [] });
  }

  // ── PATCH: update a job ───────────────────────────────────
  if (req.method === 'PATCH') {
    const { job_id } = req.query;
    if (!job_id) return res.status(400).json({ error: 'job_id required.' });

    // Verify ownership before updating
    const checkR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/research_queue?id=eq.${job_id}&user_id=eq.${user.id}&select=id`,
      { headers: SB_HEADERS() }
    );
    const rows = await checkR.json().catch(() => []);
    if (!rows?.length) return res.status(404).json({ error: 'Job not found.' });

    const { status, badge, overall_score, result_slug } = req.body || {};
    const patch = {};
    if (status)       patch.status = status;
    if (badge)        patch.badge = badge;
    if (overall_score != null) patch.overall_score = overall_score;
    if (result_slug)  patch.result_slug = result_slug;
    if (status === 'done') patch.completed_at = new Date().toISOString();

    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/research_queue?id=eq.${job_id}`, {
      method: 'PATCH',
      headers: SB_HEADERS(),
      body: JSON.stringify(patch),
    });
    if (!r.ok) return res.status(502).json({ error: 'Update failed.' });
    return res.json({ ok: true });
  }

  // ── POST: create a new job ────────────────────────────────
  if (req.method === 'POST') {
    const { query } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query required.' });
    }

    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/research_queue`, {
      method: 'POST',
      headers: { ...SB_HEADERS(), 'Prefer': 'return=representation' },
      body: JSON.stringify({
        user_id:    user.id,
        query:      query.toLowerCase().trim(),
        status:     'pending',
        created_at: new Date().toISOString(),
      }),
    });
    if (!r.ok) return res.status(502).json({ error: 'Failed to create job.' });
    const [job] = await r.json();
    return res.json({ ok: true, job_id: job?.id });
  }

  return res.status(405).end();
}
