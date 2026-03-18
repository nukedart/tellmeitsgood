// =============================================================
// /api/_rateLimit.js  —  Shared rate limiting utility
// =============================================================
// Protects all API routes from abuse and runaway API costs.
//
// HOW IT WORKS:
// We keep a simple in-memory Map: { ipAddress -> [timestamps] }
// When a request comes in, we check how many times that IP has
// called this endpoint in the last windowMs milliseconds.
// If it exceeds the limit, we return 429 (Too Many Requests).
//
// LIMITATIONS:
// - In-memory means the counter resets when the serverless function
//   cold-starts. That's acceptable — it still blocks rapid abuse.
// - Each serverless function has its own memory, so limits are
//   per-function, not globally across all your API routes.
// - For a proper global rate limiter you'd use Vercel KV or Redis,
//   but that's overkill until you have real traffic problems.
//
// USAGE in any API route:
//   import { rateLimit } from './_rateLimit.js';
//
//   const limited = rateLimit(req, res, {
//     windowMs: 60 * 60 * 1000,  // 1 hour window
//     max: 10,                    // max 10 requests per IP per hour
//     message: 'Too many requests. Try again in an hour.',
//   });
//   if (limited) return; // rateLimit already sent the 429 response
//
// =============================================================

// Each key is an IP address.
// Each value is an array of timestamps (ms) for recent requests.
const requestLog = new Map();

// Clean up old entries every 15 minutes so memory doesn't grow forever.
// We remove IPs whose most recent request was more than 2 hours ago.
setInterval(() => {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const [ip, timestamps] of requestLog.entries()) {
    if (Math.max(...timestamps) < twoHoursAgo) {
      requestLog.delete(ip);
    }
  }
}, 15 * 60 * 1000);

// =============================================================
// rateLimit(req, res, options)
// =============================================================
// @param {object} req        — Vercel request object
// @param {object} res        — Vercel response object
// @param {object} options
//   windowMs  {number}  — time window in milliseconds (default: 1 hour)
//   max       {number}  — max requests per window (default: 20)
//   message   {string}  — error message to return (optional)
//
// @returns {boolean} — true if the request was rate-limited (caller should return)
//                      false if the request is allowed through
//
export function rateLimit(req, res, options = {}) {
  const {
    windowMs = 60 * 60 * 1000,  // default: 1 hour
    max = 20,                    // default: 20 requests per window
    message = 'Too many requests. Please try again later.',
  } = options;

  // Get the requester's IP address.
  // x-forwarded-for is set by Vercel's edge network for real client IPs.
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const now = Date.now();
  const windowStart = now - windowMs;

  // Get existing timestamps for this IP, filtered to the current window
  const existing = (requestLog.get(ip) || []).filter(t => t > windowStart);

  if (existing.length >= max) {
    // Calculate when their oldest request will expire so we can tell them
    const resetMs = existing[0] + windowMs - now;
    const resetMins = Math.ceil(resetMs / 60000);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('Retry-After', Math.ceil(resetMs / 1000));

    res.status(429).json({
      error: message,
      retryAfterMinutes: resetMins,
    });

    return true; // request was blocked
  }

  // Record this request and allow it through
  existing.push(now);
  requestLog.set(ip, existing);

  // Set informational headers so the client can see their limit status
  res.setHeader('X-RateLimit-Limit', max);
  res.setHeader('X-RateLimit-Remaining', max - existing.length);

  return false; // request is allowed
}
