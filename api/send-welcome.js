// =============================================================
// /api/send-welcome.js  —  Vercel Serverless Function
// =============================================================
// Sends a welcome email to a new user after sign-up.
// Uses Resend (resend.com) — set RESEND_API_KEY in Vercel env vars.
//
// Required env vars:
//   RESEND_API_KEY   — from resend.com/api-keys
//   FROM_EMAIL       — e.g. "Tell Me It's Good <hello@tellmeitsgood.com>"
//                      (domain must be verified in Resend)
// =============================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = process.env.FROM_EMAIL || "Tell Me It's Good <hello@tellmeitsgood.com>";

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  if (!RESEND_API_KEY) {
    // Silently succeed in dev / before key is set — don't break signup
    console.warn('send-welcome: RESEND_API_KEY not set, skipping email.');
    return res.json({ ok: true, skipped: true });
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#FAF8F5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #DDD9D2;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#2F6FED;padding:28px 36px;">
              <p style="margin:0;font-size:13px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:.06em;text-transform:uppercase;">tellmeitsgood.com</p>
              <h1 style="margin:8px 0 0;font-family:Georgia,serif;font-size:26px;color:#ffffff;line-height:1.2;">Welcome. Let's find you something worth buying.</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 36px;">
              <p style="margin:0 0 20px;font-size:15px;color:#1C1917;line-height:1.6;">
                You now have <strong>3 free research credits per day</strong> — enough to check the products you're actually considering before you buy.
              </p>
              <p style="margin:0 0 20px;font-size:15px;color:#1C1917;line-height:1.6;">
                Every verdict covers three things that actually matter:
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:10px 14px;background:#F3F0EB;border-radius:8px;margin-bottom:8px;">
                    <strong style="color:#1C1917;font-size:14px;">🔬 Quality</strong>
                    <span style="color:#6B6560;font-size:14px;"> — Does it actually work? What do real customers say?</span>
                  </td>
                </tr>
                <tr><td style="height:6px;"></td></tr>
                <tr>
                  <td style="padding:10px 14px;background:#F3F0EB;border-radius:8px;">
                    <strong style="color:#1C1917;font-size:14px;">🛡 Safety</strong>
                    <span style="color:#6B6560;font-size:14px;"> — No harmful ingredients, no red-flag materials.</span>
                  </td>
                </tr>
                <tr><td style="height:6px;"></td></tr>
                <tr>
                  <td style="padding:10px 14px;background:#F3F0EB;border-radius:8px;">
                    <strong style="color:#1C1917;font-size:14px;">⚖️ Ethics</strong>
                    <span style="color:#6B6560;font-size:14px;"> — Transparent company, fair labour, honest practices.</span>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 28px;font-size:15px;color:#1C1917;line-height:1.6;">
                Start by searching any product — cleaning supplies, clothes, supplements, electronics. If it's been researched before, you'll get an instant result from the database.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#2F6FED;border-radius:10px;padding:14px 28px;">
                    <a href="https://tellmeitsgood.com" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Research a product →</a>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #EAE6DF;margin:0 0 24px;" />

              <p style="margin:0;font-size:13px;color:#A09891;line-height:1.6;">
                Need more than 3 searches a day? <a href="https://tellmeitsgood.com/?pro=1" style="color:#2F6FED;text-decoration:none;">Go Pro for $9/month</a> — 25 searches a day and your full history saved.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px;background:#F3F0EB;border-top:1px solid #DDD9D2;">
              <p style="margin:0;font-size:12px;color:#A09891;line-height:1.5;">
                You're receiving this because you created an account at tellmeitsgood.com.<br />
                Questions? Reply to this email or contact <a href="mailto:hello@tellmeitsgood.com" style="color:#6B6560;">hello@tellmeitsgood.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    FROM_EMAIL,
        to:      [email],
        subject: "Welcome to Tell Me It's Good",
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('Resend error:', response.status, body);
      // Don't fail the signup flow — email is non-critical
      return res.json({ ok: false, error: `Resend ${response.status}` });
    }

    return res.json({ ok: true });

  } catch (err) {
    console.error('send-welcome error:', err.message);
    return res.json({ ok: false, error: err.message });
  }
}
