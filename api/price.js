// Merged from price-track.js + price-history.js + price-alert.js + email-onboard.js
//
// GET  ?url=...          → price history
// GET  ?cron=alerts      → alert check cron (CRON_SECRET auth)
// GET  ?cron=onboard     → email onboard cron (CRON_SECRET auth)
// POST body.email        → save alert
// POST else              → track price
//
// Rewrites in vercel.json point old paths here.

import { rateLimit } from './_rateLimit.js';
import crypto from 'crypto';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = process.env.FROM_EMAIL || "Tell Me It's Good <hello@tellmeitsgood.com>";

// ── price-history ─────────────────────────────────────────────

async function handleHistory(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required.' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured.' });
  }

  try {
    const params = new URLSearchParams({
      product_url: `eq.${url}`,
      select:       'price_text,price_cents,currency,checked_at,product_name',
      order:        'checked_at.desc',
      limit:        '20',
    });

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/price_history?${params}`,
      {
        headers: {
          'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('price_history fetch error:', response.status, err);
      return res.status(502).json({ error: 'Failed to fetch history.' });
    }

    const rows = await response.json();
    return res.json({ rows: Array.isArray(rows) ? rows : [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── price-track ───────────────────────────────────────────────

async function handleTrack(req, res) {
  const limited = rateLimit(req, res, {
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many price checks. Please try again in an hour.',
  });
  if (limited) return;

  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL required.' });
  }

  const trimmedUrl = url.trim();
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Paste a full URL starting with https://' });
  }

  if (!process.env.ANTHROPIC_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured.' });
  }

  if (!req.body.force) {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const cacheParams = new URLSearchParams({
        product_url: `eq.${trimmedUrl}`,
        'checked_at': `gte.${oneHourAgo}`,
        select: 'product_name,price_text,price_cents,currency,checked_at',
        order: 'checked_at.desc',
        limit: '1',
      });
      const cacheRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/price_history?${cacheParams}`,
        { headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
      );
      if (cacheRes.ok) {
        const rows = await cacheRes.json();
        if (rows.length > 0) {
          const c = rows[0];
          return res.json({ product_name: c.product_name, price_text: c.price_text, price_cents: c.price_cents, currency: c.currency, checked_at: c.checked_at, url: trimmedUrl, cached: true });
        }
      }
    } catch { /* non-fatal — proceed with fresh check */ }
  }

  let pageContent = '';
  let pageTitle = '';
  try {
    const pageRes = await fetch(trimmedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!pageRes.ok) {
      return res.status(422).json({ error: 'Could not load that URL. The site may be blocking requests.' });
    }

    const html = await pageRes.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    pageTitle = titleMatch ? titleMatch[1].trim().slice(0, 200) : '';

    const jsonLdChunks = [];
    const jsonLdRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = jsonLdRe.exec(html)) !== null) {
      jsonLdChunks.push(m[1].slice(0, 2000));
      if (jsonLdChunks.length >= 5) break;
    }

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 7000);

    pageContent = (jsonLdChunks.join('\n') + '\n\n' + text).slice(0, 10000);
  } catch (err) {
    return res.status(422).json({ error: 'Could not load that URL. The site may be blocking requests.' });
  }

  let priceData;
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: `Extract the current sale price of the product on this page.
Return ONLY a single valid JSON object with these fields:
{ "product_name": string, "price_text": string, "price_cents": number|null, "currency": string }
Rules:
- price_text: exactly as shown on page, e.g. "$24.99" or "£19.50"
- price_cents: integer in smallest unit (2499 for $24.99), null if unparseable
- currency: "USD", "GBP", "EUR", or ISO code
- If multiple prices (sale vs regular), use the current/sale price
- If no price found: price_text = "Price not found", price_cents = null
Return ONLY the JSON object. No other text, no markdown, no code fences.`,
        messages: [{
          role: 'user',
          content: `URL: ${trimmedUrl}\nTitle: ${pageTitle}\n\n<page_content>\n${pageContent}\n</page_content>`,
        }],
      }),
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');
    priceData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    return res.status(502).json({ error: 'Failed to extract price from that page.' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const checkedAt = new Date().toISOString();

  const productName = (priceData.product_name || pageTitle || 'Unknown product').slice(0, 300);
  const priceText   = (priceData.price_text || 'Price not found').slice(0, 50);
  const priceCents  = typeof priceData.price_cents === 'number' ? Math.round(priceData.price_cents) : null;
  const currency    = (priceData.currency || 'USD').slice(0, 10);

  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/price_history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        product_url:  trimmedUrl,
        product_name: productName,
        price_text:   priceText,
        price_cents:  priceCents,
        currency,
        checked_at:   checkedAt,
        ip_hash:      ipHash,
      }),
    });
  } catch (err) {
    console.error('price_history save failed:', err.message);
  }

  return res.json({
    product_name: productName,
    price_text:   priceText,
    price_cents:  priceCents,
    currency,
    checked_at:   checkedAt,
    url:          trimmedUrl,
  });
}

// ── price-alert: save ─────────────────────────────────────────

async function handleAlertSave(req, res) {
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

// ── price-alert: cron check ───────────────────────────────────

async function runAlertCheck(res) {
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
    try {
      const ph = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/price_history?product_url=eq.${encodeURIComponent(alert.product_url)}&select=price_cents,price_text,checked_at&order=checked_at.desc&limit=1`,
        { headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
      );
      if (!ph.ok) continue;
      const rows = await ph.json();
      if (!rows.length || !rows[0].price_cents) continue;

      const { price_cents, price_text } = rows[0];

      if (price_cents <= alert.threshold_cents) {
        triggered++;

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

// ── email-onboard: cron ───────────────────────────────────────

async function runEmailOnboard(res) {
  if (!RESEND_API_KEY) return res.json({ ok: true, skipped: true });

  const SB      = process.env.SUPABASE_URL;
  const KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey':        KEY,
    'Authorization': `Bearer ${KEY}`,
  };

  let day3count = 0, day7count = 0, errors = 0;

  try {
    const r3 = await fetch(
      `${SB}/rest/v1/profiles?onboard_sent=eq.0&created_at=lte.${encodeURIComponent(new Date(Date.now() - 3 * 86400000).toISOString())}&select=id&limit=50`,
      { headers: sbHeaders }
    );
    const day3users = r3.ok ? await r3.json() : [];

    for (const user of day3users) {
      try {
        const email = await getUserEmail(SB, KEY, user.id);
        if (!email) { errors++; continue; }
        await sendEmail(RESEND_API_KEY, FROM_EMAIL, email, 'What does a 9.2/10 product look like inside?', buildDay3Html());
        await patchProfile(SB, KEY, user.id, 3);
        day3count++;
      } catch { errors++; }
    }
  } catch { errors++; }

  try {
    const r7 = await fetch(
      `${SB}/rest/v1/profiles?onboard_sent=eq.3&created_at=lte.${encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString())}&select=id&limit=50`,
      { headers: sbHeaders }
    );
    const day7users = r7.ok ? await r7.json() : [];

    for (const user of day7users) {
      try {
        const email = await getUserEmail(SB, KEY, user.id);
        if (!email) { errors++; continue; }
        await sendEmail(RESEND_API_KEY, FROM_EMAIL, email, '25 family researches a day, for $10/month', buildDay7Html());
        await patchProfile(SB, KEY, user.id, 7);
        day7count++;
      } catch { errors++; }
    }
  } catch { errors++; }

  return res.json({ ok: true, day3: day3count, day7: day7count, errors });
}

async function getUserEmail(SB, KEY, userId) {
  const r = await fetch(`${SB}/auth/v1/admin/users/${userId}`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}` },
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data.email || null;
}

async function sendEmail(resendKey, from, to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

async function patchProfile(SB, KEY, userId, value) {
  await fetch(`${SB}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        KEY,
      'Authorization': `Bearer ${KEY}`,
    },
    body: JSON.stringify({ onboard_sent: value }),
  });
}

function shell(inner) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#FAF8F5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;padding:40px 16px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:14px;border:1px solid #DDD9D2;overflow:hidden;">
${inner}
<tr><td style="padding:24px 36px;border-top:1px solid #EAE6DF;">
  <p style="margin:0;font-size:12px;color:#A09891;line-height:1.6;">You're receiving this because you signed up at <a href="https://tellmeitsgood.com" style="color:#2F6FED;text-decoration:none;">tellmeitsgood.com</a>.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

function buildDay3Html() {
  return shell(`
<tr><td style="background:#2F6FED;padding:28px 36px;">
  <p style="margin:0;font-size:12px;font-weight:700;color:rgba(255,255,255,.65);letter-spacing:.07em;text-transform:uppercase;">tellmeitsgood.com</p>
  <h1 style="margin:10px 0 0;font-family:Georgia,serif;font-size:26px;color:#ffffff;line-height:1.25;font-weight:normal;">What does a 9.2/10 product look like inside?</h1>
</td></tr>
<tr><td style="padding:32px 36px 28px;">
  <p style="margin:0 0 18px;font-size:15px;color:#3D3631;line-height:1.65;">Every score you see is the average of <strong>15 separate checks</strong> — ingredient safety, manufacturing standards, recall history, ethical sourcing, and more.</p>
  <p style="margin:0 0 18px;font-size:15px;color:#3D3631;line-height:1.65;">Right now, the full criterion-by-criterion breakdown is blurred for free accounts. Here's a glimpse of what's inside:</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
    <tr><td style="background:#F5F3F0;border-radius:10px;padding:20px 24px;">
      <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#A09891;letter-spacing:.07em;text-transform:uppercase;">Sample criteria (Pro unlock)</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:10px 0;border-bottom:1px solid #EAE6DF;">
          <p style="margin:0;font-size:14px;color:#1C1917;"><strong style="color:#2F6FED;">Ingredient safety</strong> — EWG hazard score checked against the full database</p>
        </td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #EAE6DF;">
          <p style="margin:0;font-size:14px;color:#1C1917;"><strong style="color:#2F6FED;">CPSC recall history</strong> — active recalls auto-disqualify, no exceptions</p>
        </td></tr>
        <tr><td style="padding:10px 0;">
          <p style="margin:0;font-size:14px;color:#1C1917;"><strong style="color:#2F6FED;">Manufacturing standards</strong> — third-party certifications verified, not just claimed</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  <p style="margin:0 0 28px;font-size:15px;color:#3D3631;line-height:1.65;">Knowing <em>why</em> a product scored 9.2 (or 4.1) makes the decision easy — especially when you're buying for the family.</p>
  <table cellpadding="0" cellspacing="0">
    <tr><td style="background:#2F6FED;border-radius:10px;padding:14px 30px;">
      <a href="https://tellmeitsgood.com" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">See the full breakdown →</a>
    </td></tr>
  </table>
</td></tr>`);
}

function buildDay7Html() {
  return shell(`
<tr><td style="background:#2F6FED;padding:28px 36px;">
  <p style="margin:0;font-size:12px;font-weight:700;color:rgba(255,255,255,.65);letter-spacing:.07em;text-transform:uppercase;">tellmeitsgood.com</p>
  <h1 style="margin:10px 0 0;font-family:Georgia,serif;font-size:26px;color:#ffffff;line-height:1.25;font-weight:normal;">25 family researches a day, for $10/month</h1>
</td></tr>
<tr><td style="padding:32px 36px 28px;">
  <p style="margin:0 0 18px;font-size:15px;color:#3D3631;line-height:1.65;">You've been using Tell Me It's Good this week — here's what Pro unlocks:</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
    <tr><td style="background:#F5F3F0;border-radius:10px;padding:20px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:10px 0;border-bottom:1px solid #EAE6DF;">
          <p style="margin:0;font-size:14px;color:#1C1917;"><strong>25 researches/day</strong> <span style="color:#A09891;">vs 3 on free</span></p>
        </td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #EAE6DF;">
          <p style="margin:0;font-size:14px;color:#1C1917;"><strong>Full 15-criterion breakdown</strong> <span style="color:#A09891;">with sources and evidence</span></p>
        </td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #EAE6DF;">
          <p style="margin:0;font-size:14px;color:#1C1917;"><strong>Complete search history</strong> <span style="color:#A09891;">across all your devices</span></p>
        </td></tr>
        <tr><td style="padding:10px 0;">
          <p style="margin:0;font-size:14px;color:#1C1917;"><strong>Price drop alerts</strong> <span style="color:#A09891;">on products you've researched</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
    <tr><td style="background:#FFFBEB;border-radius:10px;border-left:4px solid #F59E0B;padding:16px 20px;">
      <p style="margin:0;font-size:14px;color:#92400E;line-height:1.6;"><strong>$10/month on the annual plan</strong> — that's $120/year, less than the cost of one bad purchase you'd have avoided with a 60-second check.</p>
    </td></tr>
  </table>
  <table cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
    <tr><td style="background:#2F6FED;border-radius:10px;padding:14px 30px;">
      <a href="https://tellmeitsgood.com/?pro=1" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Try Pro →</a>
    </td></tr>
  </table>
  <p style="margin:16px 0 0;font-size:13px;color:#A09891;">Cancel anytime. No tricks.</p>
</td></tr>`);
}

// ── Main handler ──────────────────────────────────────────────

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured.' });
  }

  const { cron } = req.query;

  if (req.method === 'GET') {
    if (req.query.url) return handleHistory(req, res);

    // Cron endpoints — authenticated with CRON_SECRET
    const auth = req.headers.authorization || '';
    const CRON_SECRET = process.env.CRON_SECRET;
    if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (cron === 'alerts')  return runAlertCheck(res);
    if (cron === 'onboard') return runEmailOnboard(res);
    return res.status(404).end();
  }

  if (req.method === 'POST') {
    if (req.body?.email) return handleAlertSave(req, res);
    return handleTrack(req, res);
  }

  return res.status(405).end();
}
