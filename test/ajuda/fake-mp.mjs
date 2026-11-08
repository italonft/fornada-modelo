// Mercado Pago de mentira, só para testes: imita a API de orders (criar Pix, consultar, reembolsar).
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

function crc32(buf) {
  let c;
  const table = crc32.t ??= Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** PNG em tons de cinza com cara de QR Code (não é um QR de verdade). */
export function fakeQrPng(seed = 7) {
  const N = 33;
  const S = 4;
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const mod = Array.from({ length: N }, () => Array.from({ length: N }, () => (rnd() > 0.5 ? 1 : 0)));
  const finder = (r0, c0) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) mod[r0 + r][c0 + c] = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4) ? 1 : 0;
  };
  finder(0, 0);
  finder(0, N - 7);
  finder(N - 7, 0);
  const W = N * S;
  const raw = Buffer.alloc((W + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W + 1)] = 0;
    for (let x = 0; x < W; x++) raw[y * (W + 1) + 1 + x] = mod[Math.floor(y / S)][Math.floor(x / S)] ? 0 : 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return png.toString('base64');
}

export async function startFakeMp({ token = 'TEST-TOKEN' } = {}) {
  const orders = new Map();
  const byKey = new Map();
  const calls = [];
  let failNext = '';
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const url = new URL(req.url, 'http://x');
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    calls.push({ method: req.method, path: url.pathname, headers: req.headers, body });
    if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { message: 'invalid access token' });
    if (failNext && url.pathname.startsWith('/v1/')) {
      const what = failNext;
      failNext = '';
      return send(res, what === 'timeout' ? 504 : 500, { message: 'erro simulado' });
    }
    let m;
    if (req.method === 'POST' && url.pathname === '/v1/orders') {
      const key = req.headers['x-idempotency-key'];
      if (!key) return send(res, 400, { message: 'X-Idempotency-Key required' });
      if (byKey.has(key)) return send(res, 201, orders.get(byKey.get(key)));
      const p = body?.transactions?.payments?.[0];
      if (body?.type !== 'online' || !body?.payer?.email || p?.payment_method?.id !== 'pix' || p?.payment_method?.type !== 'bank_transfer') return send(res, 400, { message: 'bad request', errors: [{ message: 'campo inválido' }] });
      const id = `ORD${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
      const o = {
        id,
        type: 'online',
        status: 'action_required',
        status_detail: 'waiting_transfer',
        total_amount: body.total_amount,
        external_reference: body.external_reference,
        transactions: {
          payments: [
            {
              id: `PAY${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
              amount: p.amount,
              status: 'action_required',
              status_detail: 'waiting_transfer',
              date_of_expiration: new Date(Date.now() + 3600000).toISOString(),
              payment_method: { id: 'pix', type: 'bank_transfer', qr_code: `00020101021226990014br.gov.bcb.pix${id}5204000053039865406${body.total_amount}5802BR`, qr_code_base64: fakeQrPng(id.length + id.charCodeAt(5)), ticket_url: `https://www.mercadopago.com.br/sandbox/payments/${id}/ticket` },
            },
          ],
        },
      };
      orders.set(id, o);
      byKey.set(key, id);
      return send(res, 201, o);
    }
    if (req.method === 'GET' && (m = url.pathname.match(/^\/v1\/orders\/([^/]+)$/))) {
      const o = orders.get(m[1]);
      return o ? send(res, 200, o) : send(res, 404, { message: 'order not found' });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/v1\/orders\/([^/]+)\/refund$/))) {
      const o = orders.get(m[1]);
      if (!o) return send(res, 404, { message: 'order not found' });
      if (o.status !== 'processed') return send(res, 400, { message: 'order not refundable' });
      o.status = 'refunded';
      o.status_detail = 'refunded';
      return send(res, 201, o);
    }
    return send(res, 404, { message: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    orders,
    calls,
    pay(id, amount) {
      const o = orders.get(id);
      o.status = 'processed';
      o.status_detail = 'accredited';
      if (amount) o.total_amount = amount;
      o.transactions.payments[0].status = 'processed';
    },
    cancel(id) {
      const o = orders.get(id);
      o.status = 'canceled';
      o.status_detail = 'canceled';
    },
    fail(what = 'erro') {
      failNext = what;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
