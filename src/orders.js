// Pedidos (encomendas e vendas): criar, editar, mudar a situação e apagar.
import { itemSnapshot, makeEngine, OPEN_STATUSES } from '../public/js/shared/calc.js';
import { checkOrder, Invalid, normSettings, validDate } from '../public/js/shared/schema.js';
import { isPro } from './auth.js';
import { randomToken } from './security.js';
import { bump, loadWorkspace, orderRow, parseJson } from './store.js';
import { HttpError, dayOf, json, readJson } from './util.js';

const ID = '[23456789abcdefghjkmnpqrstuvwxyz]{10}';
const ORDER_PATH = new RegExp(`^/api/pedidos/(${ID})$`);
const STATUS_PATH = new RegExp(`^/api/pedidos/(${ID})/(situacao|visto)$`);

/** Próximo número de pedido da conta (#1, #2...), sem repetir mesmo com dois pedidos ao mesmo tempo. */
export async function nextNumber(env, accountId) {
  const r = await env.DB.prepare('UPDATE accounts SET order_seq = order_seq + 1 WHERE id = ?1 RETURNING order_seq').bind(accountId).first();
  return r.order_seq;
}

/** Recalcula custo e tempo de cada item pelas receitas atuais e guarda a taxa do canal no pedido. */
export function priceOrder(order, ws) {
  const eng = makeEngine(ws);
  const settings = normSettings(ws.settings);
  const ch = settings.channels.find((x) => x.id === order.channel) || settings.channels[0];
  const items = order.items.map((it) => {
    if (it.f && eng.fichas.has(it.f)) return { ...it, ...itemSnapshot(eng, it.f) };
    return { ...it, f: '' };
  });
  return { ...order, items, feePct: ch.feePct, taxPct: settings.taxPct };
}

export async function ordersRoutes(req, env, c, url, p, m, a) {
  const now = Date.now();

  if (p === '/api/pedidos' && m === 'GET') {
    const q = url.searchParams;
    let rows;
    if (q.get('abertos')) {
      ({ results: rows } = await env.DB.prepare(`SELECT * FROM orders WHERE account_id = ?1 AND status IN (${OPEN_STATUSES.map((s) => `'${s}'`).join(', ')}) ORDER BY due_date, num LIMIT 600`)
        .bind(a.id)
        .all());
    } else {
      const from = q.get('de') || '';
      const to = q.get('ate') || '';
      if (!validDate(from) || !validDate(to) || from > to) throw new HttpError(422, 'Período inválido.');
      ({ results: rows } = await env.DB.prepare('SELECT * FROM orders WHERE account_id = ?1 AND due_date >= ?2 AND due_date <= ?3 ORDER BY due_date, num LIMIT 3000').bind(a.id, from, to).all());
    }
    return json({ orders: rows.map(orderRow) });
  }

  let mm = p.match(ORDER_PATH);
  if (mm && m === 'GET') {
    const r = await env.DB.prepare('SELECT * FROM orders WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1]).first();
    if (!r) throw new HttpError(404, 'Pedido não encontrado.');
    return json({ order: orderRow(r) });
  }

  if (mm && m === 'PUT') {
    const body = await readJson(req, 65536);
    const ws = await loadWorkspace(env, a);
    const settings = normSettings(ws.settings);
    let order;
    try {
      order = checkOrder({ ...body, id: mm[1] }, settings.channels.map((ch) => ch.id));
    } catch (e) {
      if (e instanceof Invalid) throw new HttpError(422, e.message, { field: e.field });
      throw e;
    }
    order = priceOrder(order, ws);
    const old = await env.DB.prepare('SELECT * FROM orders WHERE account_id = ?1 AND id = ?2').bind(a.id, order.id).first();
    const { id, status, dueDate, ...data } = order;
    if (old) {
      await env.DB.prepare('UPDATE orders SET status = ?3, due_date = ?4, data = ?5, seen = 1, updated_at = ?6 WHERE account_id = ?1 AND id = ?2')
        .bind(a.id, id, status, dueDate, JSON.stringify(data), now)
        .run();
    } else {
      const month = dayOf(now).slice(0, 7);
      if (!isPro(a, now)) {
        const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE account_id = ?1 AND month = ?2 AND origin = 'app'").bind(a.id, month).first();
        if ((n?.n ?? 0) >= c.freeOrders) {
          throw new HttpError(402, `No plano grátis você lança até ${c.freeOrders} pedidos por mês. Assine o Pro para lançar sem limite. Pedidos que chegam pelo cardápio continuam entrando.`, { code: 'limite_pedidos' });
        }
      }
      const num = await nextNumber(env, a.id);
      await env.DB.prepare(
        "INSERT INTO orders (account_id, id, num, token, status, due_date, origin, seen, month, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'app', 1, ?7, ?8, ?9, ?9)",
      )
        .bind(a.id, id, num, randomToken(18), status, dueDate, month, JSON.stringify(data), now)
        .run();
      await bump(env, 'pedido_criado', '', now);
    }
    const r = await env.DB.prepare('SELECT * FROM orders WHERE account_id = ?1 AND id = ?2').bind(a.id, id).first();
    return json({ order: orderRow(r) }, old ? 200 : 201);
  }

  if (mm && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM orders WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1]).run();
    return json({ ok: true });
  }

  mm = p.match(STATUS_PATH);
  if (mm && m === 'POST') {
    const r = await env.DB.prepare('SELECT * FROM orders WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1]).first();
    if (!r) throw new HttpError(404, 'Pedido não encontrado.');
    if (mm[2] === 'visto') {
      await env.DB.prepare('UPDATE orders SET seen = 1 WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1]).run();
      return json({ ok: true });
    }
    const body = await readJson(req, 1024);
    const status = String(body.status ?? '');
    if (!['orcamento', 'confirmado', 'pronto', 'entregue', 'cancelado'].includes(status)) throw new HttpError(422, 'Situação inválida.');
    const data = parseJson(r.data);
    if (body.paid !== undefined) {
      const paid = Math.round(Number(body.paid));
      if (!Number.isFinite(paid) || paid < 0 || paid > 1000000000) throw new HttpError(422, 'Valor recebido inválido.');
      data.paid = paid;
    }
    await env.DB.prepare('UPDATE orders SET status = ?3, data = ?4, seen = 1, updated_at = ?5 WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1], status, JSON.stringify(data), now).run();
    const fresh = await env.DB.prepare('SELECT * FROM orders WHERE account_id = ?1 AND id = ?2').bind(a.id, mm[1]).first();
    return json({ order: orderRow(fresh) });
  }

  return null;
}
