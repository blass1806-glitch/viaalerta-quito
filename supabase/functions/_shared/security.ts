
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(x => x.trim()).filter(Boolean);

export function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = allowedOrigins.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

export function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export function requirePublicKey(req: Request) {
  const expected = Deno.env.get('SUPABASE_ANON_KEY');
  return Boolean(expected && req.headers.get('apikey') === expected);
}

export function backend() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Server configuration unavailable');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function normalizeText(s: string) {
  return s.normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasProfanity(s: string) {
  const n = s.toLowerCase().normalize('NFKC').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[013457@$]/g, c => ({
      '0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s'
    }[c] ?? c))
    .replace(/[^a-z0-9]+/g, ' ');
  const words = [
    'puta','puto','mierda','pendejo','pendeja','idiota',
    'imbecil','hijueputa','malparido','malparida','maricon',
    'gonorrea','estupido','estupida'
  ];
  return words.some(w => new RegExp(`(^|\\s)${w}(?=\\s|$)`).test(n));
}

export async function verifyTurnstile(token: string, req: Request) {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret || !token || token.length > 2048) return false;
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token);
  const remote = req.headers.get('cf-connecting-ip');
  if (remote) form.set('remoteip', remote);
  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body: form }
  );
  if (!response.ok) return false;
  const result = await response.json();
  const expectedHost = Deno.env.get('TURNSTILE_EXPECTED_HOSTNAME');
  return result.success === true &&
    (!expectedHost || result.hostname === expectedHost);
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(bytes)]
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

export async function rateLimit(
  db: ReturnType<typeof backend>,
  req: Request,
  action: 'report'|'comment'
) {
  const pepper = Deno.env.get('RATE_LIMIT_PEPPER');
  if (!pepper) throw new Error('Rate limit configuration unavailable');
  const forwarded = req.headers.get('x-forwarded-for')
    ?.split(',')[0]?.trim();
  const ip = req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-real-ip')
    ?? forwarded
    ?? 'unknown';
  const keyHash = await sha256(`${pepper}:${ip}`);
  const limits = action === 'report'
    ? { count: 3, seconds: 3600 }
    : { count: 12, seconds: 3600 };
  const { data, error } = await db.rpc('consume_rate_limit', {
    p_key_hash: keyHash,
    p_action: action,
    p_limit: limits.count,
    p_window_seconds: limits.seconds,
  });
  if (error) throw new Error('Rate limit service unavailable');
  return data === true;
}

export function validImage(bytes: Uint8Array, mime: string) {
  if (mime === 'image/jpeg')
    return bytes.length > 3 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png')
    return bytes.length > 8 &&
      [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  if (mime === 'image/webp')
    return bytes.length > 12 &&
      String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  return false;
}

export function validCoords(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -0.6 && lat <= 0.2 &&
    lng >= -79.2 && lng <= -78.0;
}
