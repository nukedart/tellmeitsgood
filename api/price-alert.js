// =============================================================
// /api/price-alert.js  —  Vercel Serverless Function
// =============================================================
// POST: save a price drop alert (url, email, threshold_cents)
// GET:  cron job — check all active alerts, email when price
//       drops at or below threshold. Authenticated with CRON_SECRET.
// =============================================================

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured.' });
  }

  // ── GET: cron check ───────────────────────────────────────
  if (req.method === 'GET') {
    const auth = req.headers.authorization || '';
    const CRON_SECRET = process.env.CRON_SECRET;
    if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return runAlertCheck(res);
  }

  // ── POST: save a new alert ────────────────────────────────
  if (req.method !== 'POST') return res.status(405).end();

  const { url, email, threshold_cents, currency, product_name } = req.body || {};

  if (!url || !email || !threshold_cents) {
    return res.status(400).json({ error: 'url, email, and threshold_cents required.' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required.' });
  }
  if (typeof threshold_cents !== 'number' || threshold_cents <= 0) {
    return res.status(400).json({ error: 'threshold_cents must be a positive number.' });
  }

  // Upsert: one active alert per url+email pair
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/price_alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        product_url:     url.trim(),
        product_name:    (product_name || '').slice(0, 300),
        email:           email.trim().toLowerCase(),
        threshold_cents: Math.round(threshold_cents),
        currency:        (currency || 'USD').slice(0, 10),
        active:          true,
        created_at:      new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('price_alerts save error:', response.status, err);
      return res.status(502).json({ error: 'Failed to save alert.' });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// =============================================================
// runAlertCheck — called by Vercel Cron (GET /api/price-alert)
// =============================================================
async function runAlertCheck(res) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.FROM_EMAIL || 'Tell Me It\'s Good <hello@tellmeitsgood.com>';

  // Fetch all active alerts
  let alerts;
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/price_alerts?active=eq.true&select=id,product_url,product_name,email,threshold_cents,currency`,
      { headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    if (!r.ok) throw new Error(`DB fetch failed: ${r.status}`);
    alerts = await r.json();
  } catch (err) {
    console.error('price-alert cron: fetch alerts failed:', err.message);
    return res.status(500).json({ error: err.message });
  }

  if (!alerts.length) return res.json({ checked: 0, triggered: 0 });

  let triggered = 0;

  for (const alert of alerts) {
    // Fetch latest price for this URL from price_history
    try {
      const ph = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/price_history?product_url=eq.${encodeURIComponent(alert.product_url)}&select=price_cents,price_text,checked_at&order=checked_at.desc&limit=1`,
        { headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
      );
      if (!ph.ok) continue;
      const rows = await ph.json();
      if (!rows.length || !rows[0].price_cents) continue;

      const { price_cents, price_text } = rows[0];

      // Trigger if price is at or below threshold
      if (price_cents <= alert.threshold_cents) {
        triggered++;

        // Send alert email
        if (RESEND_API_KEY) {
          const thresholdFormatted = formatPrice(alert.threshold_cents, alert.currency);
          const html = buildAlertEmail(alert.product_name || alert.product_url, price_text, thresholdFormatted, alert.product_url);
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: FROM_EMAIL,
              to: [alert.email],
              subject: `Price alert: ${alert.product_name || 'Product'} dropped to ${price_text}`,
              html,
            }),
          }).catch(e => console.error('Resend error:', e.message));
        }

        // Deactivate alert so it only fires once
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/price_alerts?id=eq.${alert.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ active: false, alerted_at: new Date().toISOString() }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error(`price-alert: error checking ${alert.product_url}:`, err.message);
    }
  }

  return res.json({ checked: alerts.length, triggered });
}

function formatPrice(cents, currency = 'USD') {
  const symbols = { USD: '$', GBP: '£', EUR: '€' };
  const sym = symbols[currency] || currency + ' ';
  return sym + (cents / 100).toFixed(2);
}

function buildAlertEmail(productName, currentPrice, threshold, productUrl) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#FAF8F5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;padding:40px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #DDD9D2;overflow:hidden;">
<tr><td style="background:#2F6FED;padding:28px 36px;">
  <p style="margin:0;font-size:13px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:.06em;text-transform:uppercase;">tellmeitsgood.com</p>
  <h1 style="margin:8px 0 0;font-family:Georgia,serif;font-size:26px;color:#ffffff;line-height:1.2;">Price alert triggered</h1>
</td></tr>
<tr><td style="padding:32px 36px;">
  <p style="margin:0 0 8px;font-size:14px;color:#6B6560;">A price you were tracking just dropped:</p>
  <p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#1C1917;">${escapeHtml(productName)}</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
    <tr><td style="padding:16px 20px;background:#ECFDF5;border-radius:10px;border-left:4px solid #3A9E6F;">
      <p style="margin:0;font-size:12px;font-weight:700;color:#A09891;letter-spacing:.06em;text-transform:uppercase;">Current price</p>
      <p style="margin:6px 0 0;font-size:28px;font-weight:700;color:#3A9E6F;">${escapeHtml(currentPrice)}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#6B6560;">Your alert threshold was ${escapeHtml(threshold)}</p>
    </td></tr>
  </table>
  <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
    <tr><td style="background:#2F6FED;border-radius:10px;padding:14px 28px;">
      <a href="${escapeHtml(productUrl)}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">View product →</a>
    </td></tr>
  </table>
  <hr style="border:none;border-top:1px solid #EAE6DF;margin:0 0 24px;"/>
  <p style="margin:0;font-size:13px;color:#A09891;">This alert has been deactivated. Set a new one anytime at tellmeitsgood.com</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
