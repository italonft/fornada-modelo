// Contas: criar, entrar, sair, recuperar a senha, trocar a senha e apagar tudo.
import { starterData } from '../public/js/shared/catalog.js';
import { checkSettings, Invalid, newId, normSettings, SEGMENTS } from '../public/js/shared/schema.js';
import { hashPassword, hmacHex, normRecovery, randomToken, readCookie, recoveryCode, sha256Hex, USER_COOKIE, USER_SESSION_MS, userCookie, verifyPassword, clientKey } from './security.js';
import { allow, bump, multiInsert } from './store.js';
import { HttpError, cleanRef, dayOf, json, readJson } from './util.js';

const DAY = 86400000;
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const RESERVED = new Set(['app', 'api', 'c', 'p', 'f', 'entrar', 'comecar', 'recuperar', 'nova-senha', 'dono', 'termos', 'privacidade', 'admin', 'fornada', 'www', 'suporte', 'ajuda', 'cardapio', 'pedido']);
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export function slugify(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export const isReservedSlug = (s) => RESERVED.has(s);

async function freeSlug(env, base) {
  let s = slugify(base);
  if (s.length < 3) s = `loja-${s || newId(4)}`.slice(0, 40);
  if (RESERVED.has(s)) s = `${s}-doces`;
  for (let i = 0; i < 6; i++) {
    const cand = i === 0 ? s : `${s.slice(0, 34)}-${newId(4)}`;
    const row = await env.DB.prepare('SELECT 1 FROM accounts WHERE slug = ?1').bind(cand).first();
    if (!row) return cand;
  }
  return `loja-${newId(8)}`;
}

function checkPassword(p) {
  const s = String(p ?? '');
  if (s.length < 8) throw new HttpError(422, 'A senha precisa ter pelo menos 8 caracteres.', { field: 'password' });
  if (s.length > 200) throw new HttpError(422, 'Senha longa demais.', { field: 'password' });
  return s;
}

const recoveryHash = (c, code) => hmacHex(c.pepper || 'sem-tempero', `recuperacao:${normRecovery(code)}`);

async function limit(env, req, scope, max, windowMs) {
  if (!(await allow(env, `${scope}:${await clientKey(req, scope)}`, max, windowMs))) throw new HttpError(429, 'Muitas tentativas. Espere alguns minutos e tente de novo.');
}

/** Abre uma sessão nova e devolve o cabeçalho do cookie. */
async function openSession(env, accountId, url, now = Date.now()) {
  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO sessions (id, account_id, created_at, expires_at, seen_at) VALUES (?1, ?2, ?3, ?4, ?3)')
    .bind(await sha256Hex(token), accountId, now, now + USER_SESSION_MS)
    .run();
  return userCookie(token, USER_SESSION_MS / 1000, url.protocol === 'https:');
}

/** Conta da sessão atual, ou null. Renova a sessão uma vez por dia. */
export async function currentAccount(env, req, url, now = Date.now()) {
  const token = readCookie(req, USER_COOKIE);
  if (!token || token.length > 100) return { account: null };
  const sid = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT a.*, s.seen_at AS s_seen FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.id = ?1 AND s.expires_at > ?2')
    .bind(sid, now)
    .first();
  if (!row) return { account: null };
  let cookie = '';
  if (now - row.s_seen > DAY) {
    await env.DB.batch([
      env.DB.prepare('UPDATE sessions SET seen_at = ?2, expires_at = ?3 WHERE id = ?1').bind(sid, now, now + USER_SESSION_MS),
      env.DB.prepare('UPDATE accounts SET seen_at = ?2 WHERE id = ?1').bind(row.id, now),
    ]);
    cookie = userCookie(token, USER_SESSION_MS / 1000, url.protocol === 'https:');
  }
  return { account: row, sid, cookie };
}

export const isPro = (a, now = Date.now()) => a.pro_until > now;

export async function usage(env, a, now = Date.now()) {
  const month = dayOf(now).slice(0, 7);
  const [p, o] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM fichas WHERE account_id = ?1 AND sell = 1').bind(a.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE account_id = ?1 AND month = ?2 AND origin = 'app'").bind(a.id, month),
  ]);
  return { products: p.results[0]?.n ?? 0, ordersMonth: o.results[0]?.n ?? 0 };
}

export function accountView(c, a, use, now = Date.now()) {
  const pro = isPro(a, now);
  return {
    id: a.id,
    email: a.email,
    business: a.business,
    slug: a.slug,
    settings: normSettings(JSON.parse(a.settings || '{}')),
    plan: { pro, proUntil: a.pro_until || 0, trial: pro && a.trial_until >= a.pro_until, trialUntil: a.trial_until || 0 },
    limits: { products: pro ? c.proProducts : c.freeProducts, ordersMonth: pro ? null : c.freeOrders },
    usage: use,
    createdAt: a.created_at,
  };
}

async function deleteAccountData(env, id) {
  const tables = ['sessions', 'resets', 'items', 'price_log', 'fichas', 'photos', 'orders'];
  await env.DB.batch([...tables.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE account_id = ?1`).bind(id)), env.DB.prepare('DELETE FROM accounts WHERE id = ?1').bind(id)]);
}

export async function auth(req, env, c, url, p, m) {
  const now = Date.now();

  if (p === '/api/conta/criar' && m === 'POST') {
    await limit(env, req, 'criar', 10, 3600000);
    const body = await readJson(req, 4096);
    if (body.site) return json({ ok: true }, 201);
    const business = String(body.business ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (business.length < 2) throw new HttpError(422, 'Digite o nome do seu negócio.', { field: 'business' });
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(422, 'Digite um e-mail válido.', { field: 'email' });
    const password = checkPassword(body.password);
    if (await env.DB.prepare('SELECT 1 FROM accounts WHERE email = ?1').bind(email).first()) {
      throw new HttpError(409, 'Já existe uma conta com esse e-mail. Entre ou recupere a senha.', { field: 'email' });
    }
    const segment = SEGMENTS.includes(body.segment) ? body.segment : 'confeitaria';
    const id = newId(12);
    const code = recoveryCode();
    const slug = await freeSlug(env, business);
    const trialUntil = c.trialDays > 0 ? now + c.trialDays * DAY : 0;
    const ref = cleanRef(body.ref);
    const settings = normSettings({ segment });
    await env.DB.prepare(
      'INSERT INTO accounts (id, email, pass, recovery, business, slug, settings, pro_until, trial_until, ref, created_at, updated_at, seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?10, ?10)',
    )
      .bind(id, email, await hashPassword(password, c.pepper), await recoveryHash(c, code), business, slug, JSON.stringify(settings), trialUntil, ref, now)
      .run();
    const start = starterData(segment, () => newId());
    const stmts = [
      ...multiInsert(env, 'INSERT INTO items (account_id, id, data, updated_at)', 4, start.items.map(({ id: iid, ...data }) => [id, iid, JSON.stringify(data), now])),
      ...multiInsert(env, 'INSERT INTO fichas (account_id, id, data, sell, menu, created_at, updated_at)', 7, start.fichas.map(({ id: fid, ...data }) => [id, fid, JSON.stringify(data), data.sell.on ? 1 : 0, data.menu.on ? 1 : 0, now, now])),
    ];
    if (stmts.length) await env.DB.batch(stmts);
    await bump(env, 'conta_criada', ref, now);
    const cookie = await openSession(env, id, url, now);
    const a = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?1').bind(id).first();
    return json({ ok: true, recoveryCode: code, account: accountView(c, a, { products: start.fichas.length, ordersMonth: 0 }, now) }, 201, { 'set-cookie': cookie });
  }

  if (p === '/api/conta/entrar' && m === 'POST') {
    await limit(env, req, 'entrar', 20, 15 * 60000);
    const body = await readJson(req, 2048);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(422, 'Digite o e-mail da sua conta.', { field: 'email' });
    if (!(await allow(env, `entrar-email:${await sha256Hex(email)}`, 10, 15 * 60000))) throw new HttpError(429, 'Muitas tentativas nesta conta. Espere 15 minutos ou recupere a senha.');
    const a = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?1').bind(email).first();
    const v = a ? await verifyPassword(String(body.password ?? ''), a.pass, c.pepper) : { ok: false };
    if (!a || !v.ok) throw new HttpError(401, 'E-mail ou senha incorretos.', { field: 'password' });
    if (v.rehash) await env.DB.prepare('UPDATE accounts SET pass = ?2 WHERE id = ?1').bind(a.id, await hashPassword(String(body.password), c.pepper)).run();
    await env.DB.prepare('UPDATE accounts SET seen_at = ?2 WHERE id = ?1').bind(a.id, now).run();
    return json({ ok: true }, 200, { 'set-cookie': await openSession(env, a.id, url, now) });
  }

  if (p === '/api/conta/sair' && m === 'POST') {
    const token = readCookie(req, USER_COOKIE);
    if (token && token.length <= 100) await env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(await sha256Hex(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': userCookie('', 0, url.protocol === 'https:') });
  }

  if (p === '/api/conta/recuperar' && m === 'POST') {
    await limit(env, req, 'recuperar', 10, 3600000);
    const body = await readJson(req, 2048);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(422, 'Digite o e-mail da sua conta.', { field: 'email' });
    if (!(await allow(env, `recuperar-email:${await sha256Hex(email)}`, 5, 3600000))) throw new HttpError(429, 'Muitas tentativas nesta conta. Espere uma hora.');
    const password = checkPassword(body.password);
    const a = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?1').bind(email).first();
    if (!a || normRecovery(body.code).length !== 12 || (await recoveryHash(c, body.code)) !== a.recovery) {
      throw new HttpError(401, 'E-mail ou código de recuperação incorretos.', { field: 'code' });
    }
    return await resetAndLogin(env, c, url, a, password, now);
  }

  if (p === '/api/conta/nova-senha' && m === 'POST') {
    await limit(env, req, 'nova-senha', 10, 3600000);
    const body = await readJson(req, 2048);
    const token = String(body.token ?? '');
    const password = checkPassword(body.password);
    if (!token || token.length > 100) throw new HttpError(401, 'Link inválido ou vencido. Peça outro ao suporte.');
    const r = await env.DB.prepare('SELECT * FROM resets WHERE id = ?1 AND expires_at > ?2').bind(await sha256Hex(token), now).first();
    if (!r) throw new HttpError(401, 'Link inválido ou vencido. Peça outro ao suporte.');
    const a = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?1').bind(r.account_id).first();
    if (!a) throw new HttpError(401, 'Link inválido ou vencido. Peça outro ao suporte.');
    await env.DB.prepare('DELETE FROM resets WHERE account_id = ?1').bind(a.id).run();
    return await resetAndLogin(env, c, url, a, password, now);
  }

  return null;
}

async function resetAndLogin(env, c, url, a, password, now) {
  const code = recoveryCode();
  await env.DB.batch([
    env.DB.prepare('UPDATE accounts SET pass = ?2, recovery = ?3, updated_at = ?4 WHERE id = ?1').bind(a.id, await hashPassword(password, c.pepper), await recoveryHash(c, code), now),
    env.DB.prepare('DELETE FROM sessions WHERE account_id = ?1').bind(a.id),
  ]);
  return json({ ok: true, recoveryCode: code }, 200, { 'set-cookie': await openSession(env, a.id, url, now) });
}

/** Rotas da conta que exigem estar logado. */
export async function accountRoutes(req, env, c, url, p, m, a, sid) {
  const now = Date.now();
  if (p === '/api/conta' && m === 'GET') return json({ account: accountView(c, a, await usage(env, a, now), now) });

  if (p === '/api/conta' && m === 'PATCH') {
    const body = await readJson(req, 16384);
    const sets = [];
    const binds = [];
    if (body.business !== undefined) {
      const business = String(body.business ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (business.length < 2) throw new HttpError(422, 'Digite o nome do seu negócio.', { field: 'business' });
      sets.push('business');
      binds.push(business);
    }
    if (body.slug !== undefined && body.slug !== a.slug) {
      const slug = String(body.slug ?? '').trim().toLowerCase();
      if (!SLUG_RE.test(slug) || slug.includes('--')) throw new HttpError(422, 'Endereço do cardápio: use de 3 a 40 letras sem acento, números e hífen.', { field: 'slug' });
      if (RESERVED.has(slug)) throw new HttpError(422, 'Esse endereço é reservado. Escolha outro.', { field: 'slug' });
      if (await env.DB.prepare('SELECT 1 FROM accounts WHERE slug = ?1 AND id <> ?2').bind(slug, a.id).first()) throw new HttpError(409, 'Esse endereço já está em uso. Escolha outro.', { field: 'slug' });
      sets.push('slug');
      binds.push(slug);
    }
    if (body.settings !== undefined) {
      let s;
      try {
        s = checkSettings({ ...normSettings(JSON.parse(a.settings || '{}')), ...body.settings });
      } catch (e) {
        if (e instanceof Invalid) throw new HttpError(422, e.message, { field: e.field });
        throw e;
      }
      sets.push('settings');
      binds.push(JSON.stringify(s));
    }
    if (sets.length) {
      const sql = `UPDATE accounts SET ${sets.map((k, i) => `${k} = ?${i + 2}`).join(', ')}, updated_at = ?${sets.length + 2} WHERE id = ?1`;
      await env.DB.prepare(sql).bind(a.id, ...binds, now).run();
    }
    const fresh = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?1').bind(a.id).first();
    return json({ account: accountView(c, fresh, await usage(env, fresh, now), now) });
  }

  if (p === '/api/conta/senha' && m === 'POST') {
    const body = await readJson(req, 2048);
    if (!(await allow(env, `senha:${a.id}`, 10, 3600000))) throw new HttpError(429, 'Muitas tentativas. Espere uma hora.');
    const v = await verifyPassword(String(body.current ?? ''), a.pass, c.pepper);
    if (!v.ok) throw new HttpError(401, 'A senha atual não confere.', { field: 'current' });
    const password = checkPassword(body.password);
    await env.DB.batch([
      env.DB.prepare('UPDATE accounts SET pass = ?2, updated_at = ?3 WHERE id = ?1').bind(a.id, await hashPassword(password, c.pepper), now),
      env.DB.prepare('DELETE FROM sessions WHERE account_id = ?1 AND id <> ?2').bind(a.id, sid),
    ]);
    return json({ ok: true });
  }

  if (p === '/api/conta/codigo' && m === 'POST') {
    const body = await readJson(req, 2048);
    if (!(await allow(env, `senha:${a.id}`, 10, 3600000))) throw new HttpError(429, 'Muitas tentativas. Espere uma hora.');
    const v = await verifyPassword(String(body.password ?? ''), a.pass, c.pepper);
    if (!v.ok) throw new HttpError(401, 'Senha incorreta.', { field: 'password' });
    const code = recoveryCode();
    await env.DB.prepare('UPDATE accounts SET recovery = ?2, updated_at = ?3 WHERE id = ?1').bind(a.id, await recoveryHash(c, code), now).run();
    return json({ ok: true, recoveryCode: code });
  }

  if (p === '/api/conta/excluir' && m === 'POST') {
    const body = await readJson(req, 2048);
    if (!(await allow(env, `senha:${a.id}`, 10, 3600000))) throw new HttpError(429, 'Muitas tentativas. Espere uma hora.');
    const v = await verifyPassword(String(body.password ?? ''), a.pass, c.pepper);
    if (!v.ok) throw new HttpError(401, 'Senha incorreta.', { field: 'password' });
    await deleteAccountData(env, a.id);
    await bump(env, 'conta_excluida', '', now);
    return json({ ok: true }, 200, { 'set-cookie': userCookie('', 0, url.protocol === 'https:') });
  }

  return null;
}

export { deleteAccountData };
