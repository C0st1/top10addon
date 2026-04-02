// ============================================================
// Security Middleware — Helmet, CSP, Rate Limiting, CSRF
// ============================================================

import { RateLimiterMemory } from 'rate-limiter-flexible';

// ── Rate Limiters ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getKey = (req: any) =>
  req.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip || 'unknown';

const rateLimiters = {
  saveConfig: new RateLimiterMemory({
    points: 10,
    duration: 60,
  }),
  validateKey: new RateLimiterMemory({
    points: 30,
    duration: 60,
  }),
  catalog: new RateLimiterMemory({
    points: 60,
    duration: 60,
  }),
};

export async function rateLimitSaveConfig(req: any): Promise<boolean> {
  try {
    await rateLimiters.saveConfig.consume(req);
    return true;
  } catch {
    return false;
  }
}

export async function rateLimitValidateKey(req: any): Promise<boolean> {
  try {
    await rateLimiters.validateKey.consume(req);
    return true;
  } catch {
    return false;
  }
}

export async function rateLimitCatalog(req: any): Promise<boolean> {
  try {
    await rateLimiters.catalog.consume(req);
    return true;
  } catch {
    return false;
  }
}

// ── Security Headers ──────────────────────────────────────────

export const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-XSS-Protection': '1; mode=block',
};

export const cspHeaderValue = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // unsafe-inline needed for inline config page scripts
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https: data: blob:",
  "connect-src 'self' https://api.themoviedb.org https://api.ratingposterdb.com https://flixpatrol.com",
  "frame-ancestors 'none'",
].join('; ');

// ── CSRF Protection ───────────────────────────────────────────

export function isSameOrigin(req: any): boolean {
  const origin = req.headers['origin'] || req.headers['referer'] || '';
  const host = req.headers['host'] || '';
  if (!origin || !host) return true; // Allow API calls without origin
  try {
    const originHost = new URL(origin).host;
    return originHost === host || originHost.endsWith('.' + host);
  } catch {
    return false;
  }
}
