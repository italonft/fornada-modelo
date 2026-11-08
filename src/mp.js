// Mercado Pago, API de orders (a recomendada em 2026; a de payments está marcada como legada).
// Documentação: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix
import { hmacHex, safeEqual } from './security.js';

export const centsToAmount = (c) => (Math.round(c) / 100).toFixed(2);
export const amountToCents = (s) => {
  const x = Number(s);
  return Number.isFinite(x) ? Math.round(x * 100) : null;
};

export class MpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class MercadoPago {
  constructor({ base, token, fetchImpl }) {
    this.base = base;
    this.token = token;
    this.fetch = fetchImpl ?? ((...a) => fetch(...a));
  }

  async call(method, path, { body, idempotencyKey } = {}) {
    const headers = { Authorization: `Bearer ${this.token}`, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await this.fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      throw new MpError(0, `Sem resposta do Mercado Pago (${e?.name === 'AbortError' ? 'tempo esgotado' : 'rede'})`);
    } finally {
      clearTimeout(timer);
    }
    const raw = await res.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = data?.message || data?.errors?.[0]?.message || `HTTP ${res.status}`;
      throw new MpError(res.status, String(msg).slice(0, 200), data);
    }
    return data;
  }

  createPixOrder({ id, amountCents, email, expiration = 'PT1H' }) {
    const amount = centsToAmount(amountCents);
    return this.call('POST', '/v1/orders', {
      idempotencyKey: `pedido-${id}`,
      body: {
        type: 'online',
        processing_mode: 'automatic',
        total_amount: amount,
        external_reference: id,
        payer: { email },
        transactions: { payments: [{ amount, payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: expiration }] },
      },
    });
  }

  getOrder(mpId) {
    return this.call('GET', `/v1/orders/${encodeURIComponent(mpId)}`);
  }

  /** Reembolso total. Sem valor no corpo, o Mercado Pago devolve tudo. */
  refundOrder(mpId, { idempotencyKey }) {
    return this.call('POST', `/v1/orders/${encodeURIComponent(mpId)}/refund`, { idempotencyKey, body: {} });
  }
}

/** Extrai só o que o app usa da resposta do Mercado Pago. */
export function parseOrder(o) {
  const pay = o?.transactions?.payments?.[0] ?? {};
  const pm = pay.payment_method ?? {};
  return {
    mpId: o?.id ? String(o.id) : '',
    status: String(o?.status ?? ''),
    detail: String(o?.status_detail ?? ''),
    amountCents: amountToCents(o?.total_amount ?? pay.amount),
    externalRef: String(o?.external_reference ?? ''),
    paymentId: pay.id ? String(pay.id) : '',
    paymentStatus: String(pay.status ?? ''),
    qrCode: typeof pm.qr_code === 'string' ? pm.qr_code : '',
    qrBase64: typeof pm.qr_code_base64 === 'string' ? pm.qr_code_base64 : '',
    ticketUrl: typeof pm.ticket_url === 'string' && /^https:\/\//.test(pm.ticket_url) ? pm.ticket_url : '',
    expiresAt: pay.date_of_expiration ? Date.parse(pay.date_of_expiration) || null : null,
  };
}

/**
 * Estado do pedido para o app. Dinheiro recebido = processed/accredited.
 * Tabela de estados: https://www.mercadopago.com.br/developers/en/docs/checkout-pro-orders/payment-management/status/order-status
 */
export function orderState(p) {
  if (p.status === 'refunded' || p.detail === 'refunded') return 'refunded';
  if (p.status === 'processed' && (p.detail === 'accredited' || p.detail === 'partially_refunded')) return 'paid';
  if (p.status === 'canceled' || p.status === 'expired') return 'canceled';
  if (p.status === 'failed') return 'failed';
  return 'pending';
}

/**
 * Confere a assinatura do aviso (webhook). Modelo: "id:[data.id];request-id:[x-request-id];ts:[ts];".
 * Partes ausentes saem do modelo. Aceita o id como veio e em minúsculas, porque a documentação já mudou sobre isso.
 */
export async function verifySignature({ secret, signature, requestId, dataId, now = Date.now(), toleranceMs = 0 }) {
  if (!secret || !signature) return false;
  const parts = Object.fromEntries(
    String(signature)
      .split(',')
      .map((kv) => kv.split('=').map((x) => x.trim()))
      .filter((kv) => kv.length === 2),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  if (toleranceMs > 0) {
    const tsMs = Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts);
    if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > toleranceMs) return false;
  }
  const ids = [...new Set([String(dataId ?? ''), String(dataId ?? '').toLowerCase()])];
  for (const id of ids) {
    let manifest = '';
    if (id) manifest += `id:${id};`;
    if (requestId) manifest += `request-id:${requestId};`;
    manifest += `ts:${ts};`;
    if (safeEqual(await hmacHex(secret, manifest), v1)) return true;
  }
  return false;
}
