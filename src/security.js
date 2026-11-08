// Senhas, sessões e resumos. Só Web Crypto, que roda na Cloudflare.
const enc = new TextEncoder();

export function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s) {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 24) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(s) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(String(s))));
}

async function hmacRaw(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(String(message))));
}

export async function hmacHex(secret, message) {
  return hex(await hmacRaw(secret, message));
}

/** Compara sem revelar, pelo tempo, onde as duas palavras diferem. */
export function safeEqual(a, b) {
  const x = typeof a === 'string' ? enc.encode(a) : a;
  const y = typeof b === 'string' ? enc.encode(b) : b;
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---------- Senhas das contas ----------
// PBKDF2-SHA256 com sal por conta e um "tempero" secreto do servidor (PASSWORD_PEPPER).
// O plano grátis da Cloudflare limita o processamento por acesso, então as iterações ficam moderadas;
// o tempero faz um vazamento só do banco não bastar para testar senhas. Se mudar ITERATIONS,
// as senhas antigas continuam valendo e são refeitas no próximo login.
export const ITERATIONS = 20000;

async function pbkdf2(password, salt, iterations, pepper) {
  const material = await hmacRaw(pepper || 'sem-tempero', `senha:${password}`);
  const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password, pepper, iterations = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await pbkdf2(password, salt, iterations, pepper);
  return `pbkdf2$${iterations}$${base64url(salt)}$${base64url(h)}`;
}

/** Confere a senha. `rehash` avisa quando vale guardar de novo com as iterações atuais. */
export async function verifyPassword(password, stored, pepper) {
  const [alg, it, saltB, hashB] = String(stored || '').split('$');
  const iterations = Number(it);
  if (alg !== 'pbkdf2' || !Number.isInteger(iterations) || iterations < 1000 || iterations > 100000 || !saltB || !hashB) return { ok: false, rehash: false };
  const h = await pbkdf2(password, fromBase64url(saltB), iterations, pepper);
  return { ok: safeEqual(h, fromBase64url(hashB)), rehash: iterations !== ITERATIONS };
}

/** Código de recuperação: 12 letras e números fáceis de copiar, em 3 grupos. */
export function recoveryCode() {
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const out = [];
  while (out.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(24))) if (b < 248 && out.length < 12) out.push(A[b % 31]);
  }
  return `${out.slice(0, 4).join('')}-${out.slice(4, 8).join('')}-${out.slice(8).join('')}`;
}

export const normRecovery = (s) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

// ---------- Sessão das contas ----------
export const USER_COOKIE = 'sessao';
export const USER_SESSION_MS = 60 * 86400000;

export function userCookie(value, maxAgeSec, secure) {
  return `${USER_COOKIE}=${value}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${maxAgeSec}`;
}

// ---------- Sessão do dono do site ----------
export async function passwordMatches(given, expected) {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256Hex(`senha:${given}`), sha256Hex(`senha:${expected}`)]);
  return safeEqual(a, b);
}

export const SESSION_COOKIE = 'dono';
export const SESSION_MS = 12 * 3600 * 1000;

export async function makeSession(secret, now = Date.now()) {
  const exp = now + SESSION_MS;
  return `${exp}.${await hmacHex(secret, `dono:${exp}`)}`;
}

export async function checkSession(secret, value, now = Date.now()) {
  if (!secret || !value) return false;
  const [expRaw, sig] = String(value).split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < now || !sig) return false;
  return safeEqual(sig, await hmacHex(secret, `dono:${exp}`));
}

export function readCookie(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export function sessionCookie(value, maxAgeSec, secure = true) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict; Max-Age=${maxAgeSec}`;
}

/** Endereço de quem pediu, resumido: serve para limitar abusos sem guardar o IP. */
export async function clientKey(req, salt) {
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
  return (await sha256Hex(`${salt}|${ip}`)).slice(0, 24);
}
