// Ingredientes, receitas (fichas técnicas), fotos do cardápio e exportação dos dados de uma conta.
import { checkFicha, checkItem, Invalid, LIMITS, normSettings } from '../public/js/shared/schema.js';
import { accountView, isPro, usage } from './auth.js';
import { allow, bump, loadWorkspace, orderRow, parseJson } from './store.js';
import { HttpError, json, randomId, readBytes, readJson } from './util.js';

const ID = '[23456789abcdefghjkmnpqrstuvwxyz]{10}';
const ITEM_PATH = new RegExp(`^/api/insumos/(${ID})$`);
const FICHA_PATH = new RegExp(`^/api/fichas/(${ID})$`);
const PHOTO_PATH = new RegExp(`^/api/fichas/(${ID})/foto$`);

function invalid(e) {
  if (e instanceof Invalid) return new HttpError(422, e.message, { field: e.field });
  return e;
}

/** Último e penúltimo preço de cada ingrediente, para mostrar quanto subiu ou desceu. */
async function priceChanges(env, accountId) {
  const { results } = await env.DB.prepare(
    `SELECT item_id, pkg_qty, pkg_price, at FROM (
       SELECT item_id, pkg_qty, pkg_price, at, ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY at DESC, id DESC) AS rn
       FROM price_log WHERE account_id = ?1
     ) WHERE rn <= 2 ORDER BY item_id, at DESC`,
  )
    .bind(accountId)
    .all();
  const out = {};
  for (const r of results) {
    const e = (out[r.item_id] ??= { last: null, prev: null });
    const v = { unit: r.pkg_qty > 0 ? r.pkg_price / r.pkg_qty : 0, at: r.at };
    if (!e.last) e.last = v;
    else if (!e.prev) e.prev = v;
  }
  return out;
}

/** Procura uso de um ingrediente ou receita dentro das receitas (o identificador é único e aleatório). */
async function usedBy(env, accountId, t, id, exceptId = '') {
  const { results } = await env.DB.prepare('SELECT id, data FROM fichas WHERE account_id = ?1 AND id <> ?2 AND instr(data, ?3) > 0')
    .bind(accountId, exceptId, `"t":"${t}","id":"${id}"`)
    .all();
  return results.map((r) => parseJson(r.data).name || 'Receita');
}

function hasCycle(fichas, startId) {
  const byId = new Map(fichas.map((f) => [f.id, f]));
  const seen = new Set();
  const walk = (id, depth) => {
    if (depth > 20) return true;
    const f = byId.get(id);
    if (!f) return false;
    for (const p of f.parts || []) {
      if (p.t !== 'f') continue;
      if (p.id === startId) return true;
      const key = `${id}>${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (walk(p.id, depth + 1)) return true;
    }
    return false;
  };
  return walk(startId, 0);
}

function sniffImage(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}

export async function dataRoutes(req, env, c, url, p, m, a) {
  const now = Date.now();

  if (p === '/api/dados' && m === 'GET') {
    const ws = await loadWorkspace(env, a);
    const [changes, use, fresh] = await Promise.all([
      priceChanges(env, a.id),
      usage(env, a, now),
      env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE account_id = ?1 AND origin = 'cardapio' AND seen = 0").bind(a.id).first(),
    ]);
    return json({ account: accountView(c, a, use, now), items: ws.items, fichas: ws.fichas, priceChanges: changes, newOrders: fresh?.n ?? 0 });
  }

  let mm = p.match(ITEM_PATH);
  if (mm && m === 'PUT') {
    const body = await readJson(req, 4096);
    let item;
    try {
      item = checkItem({ ...body, id: mm[1] });
    } catch (e) {
      throw invalid(e);
    }
    const old = await env.DB.prepare('SELECT data FROM items WHERE account_id = ?1 AND id = ?2').bind(a.id, item.id).first();
    if (!old) {
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE account_id = ?1').bind(a.id).first();
      if ((n?.n ?? 0) >= LIMITS.items) throw new HttpError(422, `Você chegou ao limite de ${LIMITS.items} ingredientes e embalagens.`);
    }
    const prev = old ? parseJson(old.data) : null;
    const { id, ...data } = item;
    const stmts = [env.DB.prepare('INSERT INTO items (account_id, id, data, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(account_id, id) DO UPDATE SET data = ?3, updated_at = ?4').bind(a.id, id, JSON.stringify(data), now)];
    const priceChanged = prev ? prev.pkgPrice !== item.pkgPrice || prev.pkgQty !== item.pkgQty : item.pkgPrice > 0;
    if (priceChanged && item.pkgPrice > 0) {
      if (prev && !(await env.DB.prepare('SELECT 1 FROM price_log WHERE account_id = ?1 AND item_id = ?2 LIMIT 1').bind(a.id, id).first()) && prev.pkgPrice > 0) {
        stmts.push(env.DB.prepare('INSERT INTO price_log (account_id, item_id, pkg_qty, pkg_price, at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(a.id, id, prev.pkgQty, prev.pkgPrice, now - 1));
      }
      stmts.push(env.DB.prepare('INSERT INTO price_log (account_id, item_id, pkg_qty, pkg_price, at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(a.id, id, item.pkgQty, item.pkgPrice, now));
    }
    await env.DB.batch(stmts);
    return json({ item: { ...item, updatedAt: now }, priceChange: (await priceChanges(env, a.id))[id] || null }, old ? 200 : 201);
  }
  if (mm && m === 'DELETE') {
    const users = await usedBy(env, a.id, 'i', mm[1]);
    if (users.length) throw new HttpError(409, `Este item está em ${users.length === 1 ? 'uma receita' : `${users.length} receitas`}: ${users.slice(0, 5).join(', ')}. Tire dessas receitas antes de apagar.`);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM items WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1]),
      env.DB.prepare('DELETE FROM price_log WHERE account_id = ?1 AND item_id = ?2').bind(a.id, mm[1]),
    ]);
    return json({ ok: true });
  }

  mm = p.match(FICHA_PATH);
  if (mm && m === 'PUT') {
    const body = await readJson(req, 32768);
    const settings = normSettings(parseJson(a.settings));
    let ficha;
    try {
      ficha = checkFicha({ ...body, id: mm[1] }, settings.channels.map((ch) => ch.id));
    } catch (e) {
      throw invalid(e);
    }
    const ws = await loadWorkspace(env, a);
    const old = ws.fichas.find((f) => f.id === ficha.id);
    if (!old && ws.fichas.length >= LIMITS.fichas) throw new HttpError(422, `Você chegou ao limite de ${LIMITS.fichas} receitas.`);
    const itemIds = new Set(ws.items.map((i) => i.id));
    const fichaIds = new Set(ws.fichas.map((f) => f.id));
    for (const [i, part] of ficha.parts.entries()) {
      if (part.t === 'i' && !itemIds.has(part.id)) throw new HttpError(422, `Item ${i + 1}: esse ingrediente não existe mais. Escolha outro.`, { field: `parts.${i}` });
      if (part.t === 'f' && !fichaIds.has(part.id)) throw new HttpError(422, `Item ${i + 1}: essa receita não existe mais. Escolha outra.`, { field: `parts.${i}` });
    }
    const next = [...ws.fichas.filter((f) => f.id !== ficha.id), ficha];
    if (hasCycle(next, ficha.id)) throw new HttpError(422, 'Essa receita acabaria usando ela mesma, por dentro de outra receita. Tire a receita que fecha o círculo.', { field: 'parts' });
    if (ficha.sell.on && !old?.sell?.on) {
      const selling = ws.fichas.filter((f) => f.sell?.on).length;
      const max = isPro(a, now) ? c.proProducts : c.freeProducts;
      if (selling >= max) {
        throw new HttpError(402, isPro(a, now) ? `Você chegou ao limite de ${max} produtos à venda.` : `No plano grátis você vende até ${max} produtos. Assine o Pro para ter produtos sem limite.`, { code: 'limite_produtos' });
      }
    }
    if (ficha.menu.photo && ficha.menu.photo !== old?.menu?.photo) ficha.menu.photo = old?.menu?.photo || '';
    if (!ficha.menu.photo && old?.menu?.photo) {
      await env.DB.prepare('DELETE FROM photos WHERE id = ?1 AND account_id = ?2').bind(old.menu.photo, a.id).run();
    }
    const { id, ...data } = ficha;
    await env.DB.prepare(
      'INSERT INTO fichas (account_id, id, data, sell, menu, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ON CONFLICT(account_id, id) DO UPDATE SET data = ?3, sell = ?4, menu = ?5, updated_at = ?6',
    )
      .bind(a.id, id, JSON.stringify(data), ficha.sell.on ? 1 : 0, ficha.menu.on && ficha.sell.on ? 1 : 0, now)
      .run();
    if (!old) await bump(env, 'ficha_criada', '', now);
    return json({ ficha: { ...ficha, createdAt: old?.createdAt ?? now, updatedAt: now } }, old ? 200 : 201);
  }
  if (mm && m === 'DELETE') {
    const users = await usedBy(env, a.id, 'f', mm[1], mm[1]);
    if (users.length) throw new HttpError(409, `Esta receita é usada em: ${users.slice(0, 5).join(', ')}. Tire de lá antes de apagar.`);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM fichas WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1]),
      env.DB.prepare('DELETE FROM photos WHERE account_id = ?1 AND ficha_id = ?2').bind(a.id, mm[1]),
    ]);
    return json({ ok: true });
  }

  mm = p.match(PHOTO_PATH);
  if (mm && m === 'PUT') {
    if (!(await allow(env, `foto:${a.id}`, 40, 3600000))) throw new HttpError(429, 'Muitas fotos enviadas. Espere uma hora.');
    const row = await env.DB.prepare('SELECT data FROM fichas WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1]).first();
    if (!row) throw new HttpError(404, 'Salve a receita antes de colocar a foto.');
    const bytes = await readBytes(req, c.photoMaxBytes);
    const mime = sniffImage(bytes);
    if (!mime) throw new HttpError(415, 'Envie uma foto em JPG, PNG ou WebP.');
    const data = parseJson(row.data);
    const photoId = randomId(16);
    const stmts = [
      env.DB.prepare('DELETE FROM photos WHERE account_id = ?1 AND ficha_id = ?2').bind(a.id, mm[1]),
      env.DB.prepare('INSERT INTO photos (id, account_id, ficha_id, mime, bytes, size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)').bind(photoId, a.id, mm[1], mime, bytes, bytes.byteLength, now),
    ];
    data.menu = { ...(data.menu || {}), photo: photoId };
    stmts.push(env.DB.prepare('UPDATE fichas SET data = ?3, updated_at = ?4 WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1], JSON.stringify(data), now));
    await env.DB.batch(stmts);
    return json({ photo: photoId });
  }
  if (mm && m === 'DELETE') {
    const row = await env.DB.prepare('SELECT data FROM fichas WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1]).first();
    if (!row) throw new HttpError(404, 'Receita não encontrada.');
    const data = parseJson(row.data);
    data.menu = { ...(data.menu || {}), photo: '' };
    await env.DB.batch([
      env.DB.prepare('DELETE FROM photos WHERE account_id = ?1 AND ficha_id = ?2').bind(a.id, mm[1]),
      env.DB.prepare('UPDATE fichas SET data = ?3, updated_at = ?4 WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1], JSON.stringify(data), now),
    ]);
    return json({ ok: true });
  }

  if (p === '/api/conta/exportar' && m === 'GET') {
    const ws = await loadWorkspace(env, a);
    const { results: orders } = await env.DB.prepare('SELECT * FROM orders WHERE account_id = ?1 ORDER BY due_date DESC').bind(a.id).all();
    const { results: pays } = await env.DB.prepare("SELECT id, plan_days, amount_cents, status, created_at, paid_at, refunded_at FROM payments WHERE account_id = ?1 AND status IN ('paid', 'refunded') ORDER BY created_at").bind(a.id).all();
    const out = {
      exportadoEm: new Date(now).toISOString(),
      conta: { email: a.email, negocio: a.business, cardapio: a.slug, criadaEm: new Date(a.created_at).toISOString(), proAte: a.pro_until ? new Date(a.pro_until).toISOString() : null },
      configuracoes: normSettings(parseJson(a.settings)),
      ingredientes: ws.items,
      receitas: ws.fichas,
      pedidos: orders.map(orderRow),
      pagamentos: pays,
    };
    return new Response(JSON.stringify(out, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="fornada-${a.slug}.json"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  }

  return null;
}
