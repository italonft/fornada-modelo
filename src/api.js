// Rotas da API: contas, dados do negócio, pedidos, cardápio, assinatura Pro por Pix e aviso do Mercado Pago.
import { accountRoutes, auth, currentAccount } from './auth.js';
import { config, publicConfig } from './config.js';
import { dataRoutes } from './data.js';
import { menuOrder } from './menu.js';
import { MpError, verifySignature } from './mp.js';
import { ordersRoutes } from './orders.js';
import { owner } from './owner.js';
import { applyMpOrder, billingView, checkoutView, findCoupon, mpClient, priceWith, refreshPayment, refund, startCheckout } from './payments.js';
import { serverSecrets } from './secrets.js';
import { clientKey } from './security.js';
import { allow, bump, setMeta } from './store.js';
import { HttpError, ORDER_RE, cleanRef, json, readJson, text } from './util.js';

const HOUR = 3600000;

async function limit(env, req, scope, max, windowMs) {
  const key = `${scope}:${await clientKey(req, scope)}`;
  if (!(await allow(env, key, max, windowMs))) throw new HttpError(429, 'Muitas tentativas. Espere alguns minutos e tente de novo.');
}

async function webhook(req, env, c, url) {
  const raw = (await req.text()).slice(0, 20000);
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }
  const dataId = url.searchParams.get('data.id') || (body?.data?.id ? String(body.data.id) : '');
  const now = Date.now();
  await setMeta(env, 'aviso_mp_em', now);
  if (c.mpWebhookSecret) {
    const ok = await verifySignature({ secret: c.mpWebhookSecret, signature: req.headers.get('x-signature'), requestId: req.headers.get('x-request-id'), dataId });
    if (!ok) {
      await setMeta(env, 'aviso_mp_invalido_em', now);
      return text('assinatura inválida', 401);
    }
  }
  if (!dataId || !/^[A-Za-z0-9_-]{4,80}$/.test(dataId)) return text('ok');
  let pay = await env.DB.prepare('SELECT * FROM payments WHERE mp_order_id = ?1').bind(dataId).first();
  if (!pay && c.mpToken) {
    try {
      const mp = await mpClient(c).getOrder(dataId);
      const ext = String(mp?.external_reference ?? '');
      if (ORDER_RE.test(ext)) pay = await env.DB.prepare('SELECT * FROM payments WHERE id = ?1').bind(ext).first();
      if (pay) {
        await applyMpOrder(env, pay, mp, now);
        return text('ok');
      }
    } catch (e) {
      if (!(e instanceof MpError)) throw e;
    }
  }
  if (!pay || !c.mpToken) return text('ok');
  try {
    const mp = await mpClient(c).getOrder(pay.mp_order_id);
    await applyMpOrder(env, pay, mp, now);
  } catch (e) {
    if (!(e instanceof MpError)) throw e;
    return text('tente depois', 503);
  }
  return text('ok');
}

export async function handleApi(req, env, ctx, url) {
  const c = config(env);
  const p = url.pathname;
  const m = req.method;
  try {
    // Pedidos que mudam algo só valem vindos do próprio site (o aviso do Mercado Pago não manda Origin).
    const origin = req.headers.get('origin');
    if (m !== 'GET' && m !== 'HEAD' && origin && origin !== url.origin) throw new HttpError(403, 'Origem não permitida.');

    if (p === '/api/config' && m === 'GET') return json(publicConfig(c));
    if (p.startsWith('/api/conta') || p.startsWith('/api/owner/')) {
      // Senhas e painel do dono precisam dos segredos; se a Cloudflare não tem, o próprio app cria e guarda.
      const sec = await serverSecrets(env, c);
      c.sessionSecret = sec.session;
      c.pepper = sec.pepper;
      c.pepperOrigin = sec.pepperOrigin;
    }
    if (p.startsWith('/api/owner/')) return await owner(req, env, c, url);
    if (p === '/api/mp/webhook' && m === 'POST') return await webhook(req, env, c, url);

    const mm = p.match(/^\/api\/c\/([a-z0-9-]{3,40})\/pedido$/);
    if (mm && m === 'POST') return await menuOrder(req, env, c, url, mm[1]);

    if (p === '/api/track' && m === 'POST') {
      const body = await readJson(req, 512);
      const name = { pagina: 'visita' }[body.name];
      if (name && (await allow(env, `track:${await clientKey(req, 'track')}`, 60, HOUR))) await bump(env, name, cleanRef(body.ref));
      return json({ ok: true });
    }

    if (p === '/api/cupom' && m === 'POST') {
      await limit(env, req, 'cupom', 30, HOUR);
      const body = await readJson(req, 512);
      const cp = await findCoupon(env, body.code);
      if (!cp) return json({ valid: false, error: 'Cupom inválido ou esgotado.' });
      return json({ valid: true, code: cp.code, percentOff: cp.percent_off, plans: c.plans.map((pl) => ({ id: pl.id, cents: priceWith(pl.cents, cp) })) });
    }

    const pub = await auth(req, env, c, url, p, m);
    if (pub) return pub;

    // Daqui para baixo, só com sessão.
    const { account: a, sid, cookie } = await currentAccount(env, req, url);
    if (!a) throw new HttpError(401, 'Sua sessão terminou. Entre de novo.', { code: 'sessao' });
    const res = await accountArea(req, env, c, url, p, m, a, sid);
    if (cookie) res.headers.append('set-cookie', cookie);
    return res;
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
    console.error('Erro na API', p, e?.stack || e);
    return json({ error: 'Erro no servidor. Tente de novo em instantes.' }, 500);
  }
}

async function accountArea(req, env, c, url, p, m, a, sid) {
  const r = (await accountRoutes(req, env, c, url, p, m, a, sid)) || (await dataRoutes(req, env, c, url, p, m, a)) || (await ordersRoutes(req, env, c, url, p, m, a));
  if (r) return r;

  if (p === '/api/assinatura' && m === 'GET') {
    return json({ payments: await billingView(env, c, a), plans: c.plans, refundDays: c.refundDays, paymentsEnabled: Boolean(c.mpToken) });
  }
  if (p === '/api/assinatura/pix' && m === 'POST') {
    await limit(env, req, 'pix', 12, HOUR);
    const body = await readJson(req, 1024);
    const out = await startCheckout(env, c, a, { planId: String(body.plan ?? ''), couponCode: body.coupon, ref: a.ref });
    return json(out, out.status === 'paid' ? 200 : 201);
  }
  let mm = p.match(/^\/api\/assinatura\/pix\/([^/]+)$/);
  if (mm && m === 'GET') {
    if (!ORDER_RE.test(mm[1])) throw new HttpError(404, 'Pagamento não encontrado.');
    let pay = await env.DB.prepare('SELECT * FROM payments WHERE id = ?1 AND account_id = ?2').bind(mm[1], a.id).first();
    if (!pay) throw new HttpError(404, 'Pagamento não encontrado.');
    await refreshPayment(env, c, pay);
    pay = await env.DB.prepare('SELECT * FROM payments WHERE id = ?1').bind(pay.id).first();
    const fresh = await env.DB.prepare('SELECT pro_until FROM accounts WHERE id = ?1').bind(a.id).first();
    return json({ ...checkoutView(pay), qrBase64: undefined, qrCode: undefined, proUntil: fresh?.pro_until ?? a.pro_until });
  }
  mm = p.match(/^\/api\/assinatura\/reembolso\/([^/]+)$/);
  if (mm && m === 'POST') {
    await limit(env, req, 'reembolso', 5, HOUR);
    if (!ORDER_RE.test(mm[1])) throw new HttpError(404, 'Pagamento não encontrado.');
    const pay = await env.DB.prepare('SELECT * FROM payments WHERE id = ?1 AND account_id = ?2').bind(mm[1], a.id).first();
    if (!pay) throw new HttpError(404, 'Pagamento não encontrado.');
    const view = (await billingView(env, c, a)).find((x) => x.id === pay.id);
    if (!view?.refundable) throw new HttpError(409, `O reembolso automático vale por ${c.refundDays} dias depois do pagamento. Depois disso, fale com o suporte.`);
    return json(await refund(env, c, pay));
  }

  throw new HttpError(404, 'Não encontrado.');
}
