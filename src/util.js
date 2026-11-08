// Respostas HTTP, cabeçalhos de segurança, leitura de corpo e identificadores.

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(h = new Headers()) {
  h.set('Content-Security-Policy', CSP);
  h.set('X-Content-Type-Options', 'nosniff');
  if (!h.has('Referrer-Policy')) h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  h.set('Strict-Transport-Security', 'max-age=31536000');
  return h;
}

export function json(data, status = 200, extra = {}) {
  const h = securityHeaders(new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }));
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function html(body, status = 200, extra = {}) {
  const h = securityHeaders(new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', ...extra }));
  return new Response(body, { status, headers: h });
}

export function text(body, status = 200, extra = {}) {
  const h = securityHeaders(new Headers({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra }));
  return new Response(body, { status, headers: h });
}

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Lê o corpo como bytes, com limite de tamanho. */
export async function readBytes(req, maxBytes) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'Arquivo grande demais.');
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new HttpError(413, 'Arquivo grande demais.');
  return buf;
}

/** Lê JSON com limite de tamanho. */
export async function readJson(req, maxBytes = 8192) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'Dados grandes demais.');
  const raw = await req.text();
  if (raw.length > maxBytes) throw new HttpError(413, 'Dados grandes demais.');
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    throw new HttpError(400, 'Dados inválidos.');
  }
}

const ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';

/** Identificador curto e sem letras parecidas (sem 0, o, 1, l, i). */
export function randomId(len = 8) {
  const out = [];
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < 248 && out.length < len) out.push(ALPHA[b % 31]);
    }
  }
  return out.join('');
}

export const ORDER_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{16}$/;

/** Dia no horário de Brasília (AAAA-MM-DD). */
export function dayOf(ms, tzOffsetMin = -180) {
  return new Date(ms + tzOffsetMin * 60000).toISOString().slice(0, 10);
}

export function cleanRef(v) {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
}

export function isBot(req) {
  return /bot|crawl|spider|facebookexternalhit|whatsapp|telegram|slack|discord|preview/i.test(req.headers.get('user-agent') || '');
}
