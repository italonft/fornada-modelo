// Venda automática do plano Pro: gera o Pix, confere o pagamento e libera os dias sem ninguém precisar agir.
import { MercadoPago, MpError, orderState, parseOrder } from './mp.js';
import { bump } from './store.js';
import { HttpError, randomId } from './util.js';

const DAY = 86400000;
export const COUPON_RE = /^[A-Z0-9_-]{3,24}$/;

export function mpClient(c, fetchImpl) {
  return new MercadoPago({ base: c.mpBase, token: c.mpToken, fetchImpl });
}

export async function findCoupon(env, code) {
  const k = String(code ?? '').trim().toUpperCase();
  if (!COUPON_RE.test(k)) return null;
  const row = await env.DB.prepare('SELECT * FROM coupons WHERE code = ?1').bind(k).first();
  if (!row || !row.active) return null;
  if (row.max_uses !== null && row.uses >= row.max_uses) return null;
  return row;
}

export const priceWith = (priceCents, coupon) => (coupon ? Math.round((priceCents * (100 - coupon.percent_off)) / 100) : priceCents);

/** Marca como pago uma vez só, mesmo que o aviso do Mercado Pago e a consulta cheguem juntos. Soma os dias ao Pro. */
async function markPaid(env, pay, { paymentId = '', now }) {
  const r = await env.DB.prepare(
    "UPDATE payments SET status = 'paid', paid_at = ?2, mp_payment_id = COALESCE(NULLIF(?3, ''), mp_payment_id), updated_at = ?2, last_check_at = ?2 WHERE id = ?1 AND status IN ('creating', 'pending')",
  )
    .bind(pay.id, now, paymentId)
    .run();
  if (!r.meta.changes) return false;
  const stmts = [env.DB.prepare('UPDATE accounts SET pro_until = MAX(pro_until, ?2) + ?3, updated_at = ?2 WHERE id = ?1').bind(pay.account_id, now, pay.plan_days * DAY)];
  if (pay.coupon) stmts.push(env.DB.prepare('UPDATE coupons SET uses = uses + 1 WHERE code = ?1').bind(pay.coupon));
  await env.DB.batch(stmts);
  await bump(env, 'venda', pay.ref, now);
  return true;
}

async function markRefunded(env, pay, now) {
  const r = await env.DB.prepare("UPDATE payments SET status = 'refunded', refunded_at = ?2, updated_at = ?2 WHERE id = ?1 AND status = 'paid'").bind(pay.id, now).run();
  if (!r.meta.changes) return false;
  await env.DB.prepare('UPDATE accounts SET pro_until = MAX(pro_until - ?2, 0), updated_at = ?3 WHERE id = ?1').bind(pay.account_id, pay.plan_days * DAY, now).run();
  await bump(env, 'reembolso', pay.ref, now);
  return true;
}

/** Aplica o que o Mercado Pago disse sobre a cobrança. Confere valor e referência antes de liberar. */
export async function applyMpOrder(env, pay, mpOrder, now = Date.now()) {
  const p = parseOrder(mpOrder);
  const state = orderState(p);
  if (state === 'paid') {
    if (p.externalRef && p.externalRef !== pay.id) return 'divergente';
    if (p.amountCents !== null && p.amountCents !== pay.amount_cents) {
      await env.DB.prepare("UPDATE payments SET status = 'review', note = ?2, updated_at = ?3 WHERE id = ?1 AND status IN ('creating', 'pending')")
        .bind(pay.id, `Valor recebido ${p.amountCents} diferente de ${pay.amount_cents}`, now)
        .run();
      return 'review';
    }
    await markPaid(env, pay, { paymentId: p.paymentId, now });
    return 'paid';
  }
  if (state === 'refunded') {
    if (pay.status === 'paid') await markRefunded(env, pay, now);
    else await env.DB.prepare("UPDATE payments SET status = 'refunded', refunded_at = ?2, updated_at = ?2 WHERE id = ?1 AND status IN ('creating', 'pending')").bind(pay.id, now).run();
    return 'refunded';
  }
  if (state === 'canceled' || state === 'failed') {
    await env.DB.prepare("UPDATE payments SET status = ?2, updated_at = ?3, last_check_at = ?3 WHERE id = ?1 AND status IN ('creating', 'pending')").bind(pay.id, state, now).run();
    return state;
  }
  await env.DB.prepare('UPDATE payments SET last_check_at = ?2 WHERE id = ?1').bind(pay.id, now).run();
  return 'pending';
}

/** Consulta a cobrança no Mercado Pago, no máximo a cada `minGapMs`. */
export async function refreshPayment(env, c, pay, { now = Date.now(), minGapMs = 4000, fetchImpl } = {}) {
  if (pay.status !== 'pending' || !pay.mp_order_id || !c.mpToken) return pay.status;
  if (now - (pay.last_check_at || 0) < minGapMs) return pay.status;
  await env.DB.prepare('UPDATE payments SET last_check_at = ?2 WHERE id = ?1').bind(pay.id, now).run();
  try {
    const mp = await mpClient(c, fetchImpl).getOrder(pay.mp_order_id);
    return await applyMpOrder(env, pay, mp, now);
  } catch (e) {
    if (e instanceof MpError) return pay.status;
    throw e;
  }
}

/** Cria a cobrança Pix de um plano, ou devolve a que ainda está valendo. */
export async function startCheckout(env, c, account, { planId, couponCode, ref, now = Date.now(), fetchImpl }) {
  const plan = c.plans.find((p) => p.id === planId);
  if (!plan) throw new HttpError(422, 'Escolha um plano.', { field: 'plan' });
  let coupon = null;
  if (couponCode) {
    coupon = await findCoupon(env, couponCode);
    if (!coupon) throw new HttpError(422, 'Cupom inválido ou esgotado.', { field: 'coupon' });
  }
  const amount = priceWith(plan.cents, coupon);
  const couponKey = coupon?.code ?? '';
  const refKey = ref || account.ref || '';

  if (amount === 0) {
    const id = randomId(16);
    await env.DB.prepare(
      "INSERT INTO payments (id, account_id, plan_days, amount_cents, status, coupon, ref, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 'pending', ?4, ?5, ?6, ?6)",
    )
      .bind(id, account.id, plan.days, couponKey, refKey, now)
      .run();
    await markPaid(env, { id, account_id: account.id, plan_days: plan.days, coupon: couponKey, ref: refKey }, { now });
    return { paymentId: id, status: 'paid', amountCents: 0, planDays: plan.days };
  }

  if (!c.mpToken) throw new HttpError(503, 'O pagamento ainda não foi configurado pelo dono do site.');

  const open = await env.DB.prepare(
    "SELECT * FROM payments WHERE account_id = ?1 AND status = 'pending' AND amount_cents = ?2 AND coupon = ?3 AND plan_days = ?4 AND expires_at > ?5 ORDER BY created_at DESC LIMIT 1",
  )
    .bind(account.id, amount, couponKey, plan.days, now + 5 * 60000)
    .first();
  if (open?.qr_code) return checkoutView(open);

  const id = randomId(16);
  await env.DB.prepare("INSERT INTO payments (id, account_id, plan_days, amount_cents, status, coupon, ref, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'creating', ?5, ?6, ?7, ?7)")
    .bind(id, account.id, plan.days, amount, couponKey, refKey, now)
    .run();
  let mp;
  try {
    mp = await mpClient(c, fetchImpl).createPixOrder({ id, amountCents: amount, email: account.email, expiration: c.pixExpiry });
  } catch (e) {
    const note = e instanceof MpError ? `Mercado Pago ${e.status}: ${e.message}` : 'Falha ao criar Pix';
    await env.DB.prepare("UPDATE payments SET status = 'failed', note = ?2, updated_at = ?3 WHERE id = ?1").bind(id, note.slice(0, 240), now).run();
    throw new HttpError(502, e instanceof MpError && e.status === 401 ? 'O pagamento está mal configurado. Avise o suporte.' : 'O Mercado Pago não respondeu. Tente de novo em instantes.');
  }
  const p = parseOrder(mp);
  if (!p.mpId || !p.qrCode) {
    await env.DB.prepare("UPDATE payments SET status = 'failed', note = 'Resposta sem código Pix', updated_at = ?2 WHERE id = ?1").bind(id, now).run();
    throw new HttpError(502, 'O Mercado Pago não devolveu o código Pix. Tente de novo em instantes.');
  }
  const expiresAt = p.expiresAt ?? now + 60 * 60000;
  await env.DB.prepare(
    "UPDATE payments SET status = 'pending', mp_order_id = ?2, mp_payment_id = ?3, qr_code = ?4, qr_base64 = ?5, ticket_url = ?6, expires_at = ?7, updated_at = ?8 WHERE id = ?1",
  )
    .bind(id, p.mpId, p.paymentId, p.qrCode, p.qrBase64, p.ticketUrl, expiresAt, now)
    .run();
  await bump(env, 'pix_gerado', refKey, now);
  const pay = await env.DB.prepare('SELECT * FROM payments WHERE id = ?1').bind(id).first();
  if (orderState(p) === 'paid') await applyMpOrder(env, pay, mp, now);
  return checkoutView(await env.DB.prepare('SELECT * FROM payments WHERE id = ?1').bind(id).first());
}

export function checkoutView(o) {
  return {
    paymentId: o.id,
    status: o.status === 'creating' ? 'pending' : o.status,
    amountCents: o.amount_cents,
    planDays: o.plan_days,
    qrCode: o.qr_code || '',
    qrBase64: o.qr_base64 || '',
    ticketUrl: o.ticket_url || '',
    expiresAt: o.expires_at || null,
  };
}

/** Reembolso pelo Mercado Pago. Quem decide se pode é quem chama. */
export async function refund(env, c, pay, { now = Date.now(), fetchImpl } = {}) {
  if (pay.status !== 'paid') throw new HttpError(409, 'Esse pagamento não está em aberto para reembolso.');
  if (!pay.amount_cents) {
    await markRefunded(env, pay, now);
    return { ok: true, free: true };
  }
  if (!pay.mp_order_id || !c.mpToken) throw new HttpError(503, 'O pagamento não está configurado para reembolso automático.');
  try {
    await mpClient(c, fetchImpl).refundOrder(pay.mp_order_id, { idempotencyKey: `reembolso-${pay.id}` });
  } catch (e) {
    throw new HttpError(502, `O Mercado Pago não confirmou o reembolso${e instanceof MpError && e.message ? ` (${e.message})` : ''}. Tente de novo ou fale com o suporte.`);
  }
  await markRefunded(env, pay, now);
  return { ok: true };
}

/** Pagamentos da conta e se o último ainda pode ser reembolsado sozinho. */
export async function billingView(env, c, account, now = Date.now()) {
  const { results } = await env.DB.prepare(
    "SELECT id, plan_days, amount_cents, status, coupon, created_at, paid_at, refunded_at FROM payments WHERE account_id = ?1 AND status IN ('paid', 'refunded', 'review') ORDER BY created_at DESC LIMIT 24",
  )
    .bind(account.id)
    .all();
  return results.map((r) => ({
    id: r.id,
    days: r.plan_days,
    amountCents: r.amount_cents,
    status: r.status,
    paidAt: r.paid_at,
    refundedAt: r.refunded_at,
    refundable: r.status === 'paid' && r.amount_cents > 0 && now - r.paid_at <= c.refundDays * DAY,
    refundUntil: r.paid_at ? r.paid_at + c.refundDays * DAY : null,
  }));
}
