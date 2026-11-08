// Painel do dono do site: vendas do Pro, lucro por dia, de onde vêm as contas, cupons, gastos, reembolsos e suporte.
import { deleteAccountData } from './auth.js';
import { COUPON_RE, refund } from './payments.js';
import { checkSession, clientKey, makeSession, passwordMatches, randomToken, readCookie, SESSION_COOKIE, SESSION_MS, sessionCookie, sha256Hex } from './security.js';
import { allow, bump, getMeta } from './store.js';
import { HttpError, ORDER_RE, dayOf, json, readJson } from './util.js';

const DAY = 86400000;
const ACCOUNT_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/;
export const FUNNEL = ['visita', 'conta_criada', 'ficha_criada', 'pedido_criado', 'cardapio_visita', 'cardapio_pedido', 'pix_gerado', 'venda', 'reembolso'];

function sameOrigin(req, url) {
  const o = req.headers.get('origin');
  return !o || o === url.origin;
}

function lastDays(today, n) {
  const out = [];
  const t = Date.parse(`${today}T00:00:00Z`);
  for (let i = n - 1; i >= 0; i--) out.push(new Date(t - i * DAY).toISOString().slice(0, 10));
  return out;
}

export async function summary(env, c, days = 30, now = Date.now()) {
  const today = dayOf(now);
  const span = lastDays(today, days);
  const first = span[0];
  const since = Date.parse(`${first}T03:00:00Z`);
  const byDay = Object.fromEntries(span.map((d) => [d, { day: d, sales: 0, gross: 0, refunds: 0, fees: 0, costs: 0, net: 0, profit: 0, signups: 0, visits: 0, pix: 0 }]));

  const { results: pays } = await env.DB.prepare(
    "SELECT amount_cents, status, ref, paid_at, refunded_at FROM payments WHERE status IN ('paid', 'refunded') AND (paid_at >= ?1 OR refunded_at >= ?1)",
  )
    .bind(since)
    .all();
  const byRef = {};
  const refRow = (ref) => (byRef[ref] ??= { ref, visits: 0, signups: 0, sales: 0, gross: 0 });
  for (const o of pays) {
    if (o.paid_at >= since) {
      const d = byDay[dayOf(o.paid_at)];
      if (d) {
        d.sales += 1;
        d.gross += o.amount_cents;
        d.fees += Math.round((o.amount_cents * c.pixFeePct) / 100);
      }
      const r = refRow(o.ref || 'direto');
      r.sales += 1;
      r.gross += o.amount_cents;
    }
    if (o.status === 'refunded' && o.refunded_at >= since) {
      const d = byDay[dayOf(o.refunded_at)];
      if (d) d.refunds += o.amount_cents;
    }
  }
  const { results: costs } = await env.DB.prepare('SELECT day, SUM(amount_cents) AS total FROM costs WHERE day >= ?1 GROUP BY day').bind(first).all();
  for (const r of costs) if (byDay[r.day]) byDay[r.day].costs = r.total;

  const { results: events } = await env.DB.prepare('SELECT day, name, ref, count FROM events WHERE day >= ?1').bind(first).all();
  const funnel = Object.fromEntries(FUNNEL.map((k) => [k, 0]));
  for (const e of events) {
    if (Object.hasOwn(funnel, e.name)) funnel[e.name] += e.count;
    const d = byDay[e.day];
    if (d && e.name === 'conta_criada') d.signups += e.count;
    if (d && e.name === 'visita') d.visits += e.count;
    if (d && e.name === 'pix_gerado') d.pix += e.count;
    if (e.name === 'conta_criada' || e.name === 'visita') refRow(e.ref || 'direto')[e.name === 'visita' ? 'visits' : 'signups'] += e.count;
  }
  const series = span.map((d) => {
    const x = byDay[d];
    x.net = x.gross - x.refunds - x.fees;
    x.profit = x.net - x.costs;
    return x;
  });
  const sum = (list) =>
    list.reduce(
      (a, x) => ({ sales: a.sales + x.sales, gross: a.gross + x.gross, refunds: a.refunds + x.refunds, fees: a.fees + x.fees, costs: a.costs + x.costs, net: a.net + x.net, profit: a.profit + x.profit, signups: a.signups + x.signups }),
      { sales: 0, gross: 0, refunds: 0, fees: 0, costs: 0, net: 0, profit: 0, signups: 0 },
    );

  const [meta, pending, review, acc] = await Promise.all([
    getMeta(env),
    env.DB.prepare("SELECT COUNT(*) AS n FROM payments WHERE status = 'pending'").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM payments WHERE status = 'review'").first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
        SUM(created_at >= ?2) AS week,
        SUM(seen_at >= ?2) AS active,
        SUM(pro_until > ?1 AND trial_until < pro_until) AS paying,
        SUM(pro_until > ?1 AND trial_until >= pro_until) AS trial
       FROM accounts`,
    )
      .bind(now, now - 7 * DAY)
      .first(),
  ]);
  return {
    today,
    days,
    series,
    totals: { today: sum(series.slice(-1)), week: sum(series.slice(-7)), period: sum(series) },
    funnel,
    refs: Object.values(byRef).sort((a, b) => b.gross - a.gross || b.signups - a.signups || b.visits - a.visits),
    accounts: { total: acc?.total ?? 0, week: acc?.week ?? 0, active: acc?.active ?? 0, paying: acc?.paying ?? 0, trial: acc?.trial ?? 0 },
    status: {
      payments: Boolean(c.mpToken),
      webhookSecret: Boolean(c.mpWebhookSecret),
      pepperOrigin: c.pepperOrigin || null,
      lastWebhookAt: Number(meta.aviso_mp_em) || null,
      lastInvalidWebhookAt: Number(meta.aviso_mp_invalido_em) || null,
      lastCronAt: Number(meta.rotina_em) || null,
      lastCleanupAt: Number(meta.limpeza_em) || null,
      pending: pending?.n ?? 0,
      review: review?.n ?? 0,
    },
    config: { plans: c.plans, pixFeePct: c.pixFeePct, trialDays: c.trialDays, freeProducts: c.freeProducts, freeOrders: c.freeOrders, refundDays: c.refundDays },
  };
}

function accountRow(r, now) {
  return {
    id: r.id,
    email: r.email,
    business: r.business,
    slug: r.slug,
    createdAt: r.created_at,
    seenAt: r.seen_at,
    proUntil: r.pro_until,
    pro: r.pro_until > now,
    trial: r.pro_until > now && r.trial_until >= r.pro_until,
    ref: r.ref,
    paid: r.paid ?? 0,
    products: r.products ?? 0,
    orders: r.orders ?? 0,
  };
}

export async function owner(req, env, c, url) {
  const p = url.pathname;
  const m = req.method;
  const now = Date.now();
  const secure = url.protocol === 'https:';
  const ready = Boolean(c.adminPassword && c.sessionSecret);
  if (p === '/api/owner/session' && m === 'GET') {
    if (!ready) return json({ ok: false, message: 'Falta a senha do painel do dono. Na Cloudflare, em Workers & Pages > fornada > Settings > Variables and Secrets, crie o segredo ADMIN_PASSWORD com a senha que você quer.' });
    return json({ ok: await checkSession(c.sessionSecret, readCookie(req, SESSION_COOKIE)) });
  }
  if (!ready) throw new HttpError(503, 'Falta a senha do painel do dono (segredo ADMIN_PASSWORD na Cloudflare).');

  if (p === '/api/owner/login' && m === 'POST') {
    if (!sameOrigin(req, url)) throw new HttpError(403, 'Origem não permitida.');
    if (!(await allow(env, `login:${await clientKey(req, 'login')}`, 8, 15 * 60000))) throw new HttpError(429, 'Muitas tentativas. Espere 15 minutos.');
    const body = await readJson(req, 1024);
    if (!(await passwordMatches(String(body.password ?? ''), c.adminPassword))) throw new HttpError(401, 'Senha incorreta.');
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(await makeSession(c.sessionSecret), SESSION_MS / 1000, secure) });
  }
  if (p === '/api/owner/logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, secure) });

  if (!(await checkSession(c.sessionSecret, readCookie(req, SESSION_COOKIE)))) throw new HttpError(401, 'Entre com a senha do dono.');
  if (m !== 'GET' && !sameOrigin(req, url)) throw new HttpError(403, 'Origem não permitida.');

  if (p === '/api/owner/summary' && m === 'GET') {
    const days = Math.min(90, Math.max(7, Number(url.searchParams.get('days')) || 30));
    return json(await summary(env, c, days, now));
  }

  if (p === '/api/owner/orders' && m === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.account_id, p.plan_days, p.amount_cents, p.status, p.coupon, p.ref, p.created_at, p.paid_at, p.refunded_at, p.note, a.email, a.business
       FROM payments p LEFT JOIN accounts a ON a.id = p.account_id
       WHERE p.status IN ('paid', 'refunded', 'review', 'pending') ORDER BY p.created_at DESC LIMIT 60`,
    ).all();
    return json({ orders: results });
  }

  let mm = p.match(/^\/api\/owner\/orders\/([^/]+)\/refund$/);
  if (mm && m === 'POST') {
    if (!ORDER_RE.test(mm[1])) throw new HttpError(404, 'Pagamento não encontrado.');
    const pay = await env.DB.prepare('SELECT * FROM payments WHERE id = ?1').bind(mm[1]).first();
    if (!pay) throw new HttpError(404, 'Pagamento não encontrado.');
    return json(await refund(env, c, pay, { now }));
  }

  if (p === '/api/owner/accounts' && m === 'GET') {
    const q = String(url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 80);
    const like = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    const { results } = await env.DB.prepare(
      `SELECT a.*,
        (SELECT COUNT(*) FROM payments p WHERE p.account_id = a.id AND p.status = 'paid') AS paid,
        (SELECT COUNT(*) FROM fichas f WHERE f.account_id = a.id AND f.sell = 1) AS products,
        (SELECT COUNT(*) FROM orders o WHERE o.account_id = a.id) AS orders
       FROM accounts a
       WHERE (?1 = '' OR a.email LIKE ?2 ESCAPE '\\' OR lower(a.business) LIKE ?2 ESCAPE '\\' OR a.slug LIKE ?2 ESCAPE '\\')
       ORDER BY a.created_at DESC LIMIT 40`,
    )
      .bind(q, like)
      .all();
    return json({ accounts: results.map((r) => accountRow(r, now)) });
  }

  mm = p.match(/^\/api\/owner\/accounts\/([^/]+)\/(link|dias|apagar)$/);
  if (mm && m === 'POST') {
    if (!ACCOUNT_RE.test(mm[1])) throw new HttpError(404, 'Conta não encontrada.');
    const a = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?1').bind(mm[1]).first();
    if (!a) throw new HttpError(404, 'Conta não encontrada.');
    if (mm[2] === 'link') {
      const token = randomToken(24);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM resets WHERE account_id = ?1').bind(a.id),
        env.DB.prepare('INSERT INTO resets (id, account_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)').bind(await sha256Hex(token), a.id, now, now + DAY),
      ]);
      return json({ url: `${url.origin}/nova-senha#${token}`, expiresAt: now + DAY });
    }
    if (mm[2] === 'dias') {
      const body = await readJson(req, 256);
      const days = Number(body.days);
      if (!Number.isInteger(days) || days < 1 || days > 366) throw new HttpError(422, 'Dias de cortesia: de 1 a 366.', { field: 'days' });
      await env.DB.prepare('UPDATE accounts SET pro_until = MAX(pro_until, ?2) + ?3, updated_at = ?2 WHERE id = ?1').bind(a.id, now, days * DAY).run();
      await bump(env, 'cortesia', '', now);
      const fresh = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?1').bind(a.id).first();
      return json({ account: accountRow(fresh, now) });
    }
    const body = await readJson(req, 256);
    if (String(body.confirm ?? '').trim().toLowerCase() !== a.email) throw new HttpError(422, 'Digite o e-mail da conta para confirmar.', { field: 'confirm' });
    await deleteAccountData(env, a.id);
    await bump(env, 'conta_excluida', 'dono', now);
    return json({ ok: true });
  }

  if (p === '/api/owner/coupons' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
    return json({ coupons: results });
  }
  if (p === '/api/owner/coupons' && m === 'POST') {
    const body = await readJson(req, 1024);
    const code = String(body.code ?? '').trim().toUpperCase();
    const pct = Number(body.percentOff);
    const maxUses = body.maxUses === '' || body.maxUses === null || body.maxUses === undefined ? null : Number(body.maxUses);
    if (!COUPON_RE.test(code)) throw new HttpError(422, 'Use de 3 a 24 letras sem acento, números, - ou _.', { field: 'code' });
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) throw new HttpError(422, 'Desconto de 1% a 100%.', { field: 'percentOff' });
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100000)) throw new HttpError(422, 'Limite de usos inválido.', { field: 'maxUses' });
    const r = await env.DB.prepare('INSERT OR IGNORE INTO coupons (code, percent_off, max_uses, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(code, pct, maxUses, String(body.note ?? '').slice(0, 80), now)
      .run();
    if (!r.meta.changes) throw new HttpError(409, 'Já existe um cupom com esse código.', { field: 'code' });
    return json({ ok: true }, 201);
  }
  mm = p.match(/^\/api\/owner\/coupons\/([^/]+)$/);
  if (mm && m === 'POST') {
    const code = decodeURIComponent(mm[1]).toUpperCase();
    const body = await readJson(req, 256);
    await env.DB.prepare('UPDATE coupons SET active = ?2 WHERE code = ?1').bind(code, body.active ? 1 : 0).run();
    return json({ ok: true });
  }

  if (p === '/api/owner/costs' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM costs ORDER BY day DESC, id DESC LIMIT 100').all();
    return json({ costs: results });
  }
  if (p === '/api/owner/costs' && m === 'POST') {
    const body = await readJson(req, 1024);
    const day = String(body.day ?? '');
    const cents = Math.round(Number(body.amountCents));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new HttpError(422, 'Data inválida.', { field: 'day' });
    if (!Number.isFinite(cents) || cents <= 0 || cents > 100000000) throw new HttpError(422, 'Valor inválido.', { field: 'amount' });
    await env.DB.prepare('INSERT INTO costs (day, amount_cents, note, created_at) VALUES (?1, ?2, ?3, ?4)').bind(day, cents, String(body.note ?? '').slice(0, 80), now).run();
    return json({ ok: true }, 201);
  }
  mm = p.match(/^\/api\/owner\/costs\/(\d+)$/);
  if (mm && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM costs WHERE id = ?1').bind(Number(mm[1])).run();
    return json({ ok: true });
  }

  throw new HttpError(404, 'Não encontrado.');
}
