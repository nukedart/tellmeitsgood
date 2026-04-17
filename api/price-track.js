// =============================================================
// /api/price-track.js  —  Vercel Serverless Function
// =============================================================
// Fetches a product URL, extracts the current price using
// Claude Haiku, and saves the result to price_history.
// =============================================================

import { rateLimit } from './_rateLimit.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  const limited = rateLimit(req, res, {
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many price checks. Please try again in an hour.',
  });
  if (limited) return;

  if (req.method !== 'POST') return res.status(405).end();

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

  // ── 1. Fetch the product page ──────────────────────────────
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

    // Page title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    pageTitle = titleMatch ? titleMatch[1].trim().slice(0, 200) : '';

    // JSON-LD structured data (most reliable price source)
    const jsonLdChunks = [];
    const jsonLdRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = jsonLdRe.exec(html)) !== null) {
      jsonLdChunks.push(m[1].slice(0, 2000));
      if (jsonLdChunks.length >= 5) break;
    }

    // Strip tags for readable text content
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

  // ── 2. Extract price with Claude Haiku ────────────────────
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

  // ── 3. Save to price_history ───────────────────────────────
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const checkedAt = new Date().toISOString();

  const productName = (priceData.product_name || pageTitle || 'Unknown product').slice(0, 300);
  const priceText = (priceData.price_text || 'Price not found').slice(0, 50);
  const priceCents = typeof priceData.price_cents === 'number' ? Math.round(priceData.price_cents) : null;
  const currency = (priceData.currency || 'USD').slice(0, 10);

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
    // Non-fatal — still return result to user
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
