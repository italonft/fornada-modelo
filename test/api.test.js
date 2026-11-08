// Fluxo completo com a Cloudflare local (Wrangler + D1) e um Mercado Pago de mentira.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startFakeMp } from './ajuda/fake-mp.mjs';
import { SECRETS, startApp } from './ajuda/servidor.mjs';

let mp;
let app;
let ipSeq = 1;
const newIp = () => `10.1.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
const DAY = 86400000;
const today = (n = 0) => new Date(Date.now() - 3 * 3600000 + n * DAY).toISOString().slice(0, 10);
const ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
const id = (n = 10) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % 31]).join('');

before(async () => {
  mp = await startFakeMp();
  app = await startApp({ mpUrl: mp.url, vars: { FREE_ORDERS: '3', FREE_PRODUCTS: '2' } });
});
after(async () => {
  await app?.stop();
  await mp?.close();
});

async function call(path, { method = 'GET', body, ip = newIp(), cookie, headers = {}, raw } = {}) {
  const h = { ...headers, 'cf-connecting-ip': ip };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  const res = await fetch(app.base + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : type.startsWith('image/') ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, data, headers: res.headers };
}

const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

async function signup(extra = {}) {
  const email = `dona${id(6)}@exemplo.com`;
  const r = await call('/api/conta/criar', { method: 'POST', body: { business: 'Doces da Bia', email, password: 'senha-forte-1', segment: 'confeitaria', ref: 'insta', ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const cookie = cookieOf(r);
  assert.match(cookie, /^sessao=/);
  return { email, cookie, code: r.data.recoveryCode, account: r.data.account };
}

function sign(dataId, requestId = 'req-1', ts = String(Date.now())) {
  const v1 = crypto.createHmac('sha256', SECRETS.MP_WEBHOOK_SECRET).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}

async function ownerCookie() {
  const r = await call('/api/owner/login', { method: 'POST', body: { password: SECRETS.ADMIN_PASSWORD } });
  assert.equal(r.status, 200);
  return cookieOf(r);
}

const setPro = (accountId, ms) => app.sql(`UPDATE accounts SET pro_until = ${ms}, trial_until = 0 WHERE id = '${accountId}'`);

test('páginas, cabeçalhos de segurança e página não encontrada', async () => {
  for (const p of ['/', '/entrar', '/comecar', '/recuperar', '/nova-senha', '/app', '/dono', '/termos', '/privacidade']) {
    const r = await call(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/, p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
  }
  assert.match((await call('/dono')).headers.get('referrer-policy'), /no-referrer$/);
  const home = await call('/');
  assert.match(home.data, new RegExp(`<meta property="og:image" content="${app.base}/img/og.png">`));
  assert.match(home.data, /Quanto sobra de cada brigadeiro/);
  assert.equal((await call('/_headers')).status, 404);
  const lost = await call('/nada-aqui');
  assert.equal(lost.status, 404);
  assert.match(lost.data, /Esta página não existe/);
  assert.match((await call('/robots.txt')).data, /Disallow: \/app/);
  const cfg = await call('/api/config');
  assert.equal(cfg.data.brand, 'Fornada');
  assert.deepEqual(cfg.data.plans.map((p) => p.cents), [1990, 4990, 15990]);
  assert.equal(cfg.data.freeProducts, 2);
  assert.equal(JSON.stringify(cfg.data).includes('TEST-TOKEN'), false, 'segredos não vazam');
});

test('criar conta: teste grátis, dados iniciais, e-mail repetido e senha fraca', async () => {
  const s = await signup();
  assert.match(s.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.equal(s.account.plan.pro, true);
  assert.equal(s.account.plan.trial, true);
  assert.equal(s.account.slug, 'doces-da-bia');
  const d = await call('/api/dados', { cookie: s.cookie });
  assert.equal(d.status, 200);
  assert.ok(d.data.items.length >= 10);
  assert.equal(d.data.fichas.length, 1);
  assert.match(d.data.fichas[0].name, /exemplo/);
  assert.equal((await call('/api/conta/criar', { method: 'POST', body: { business: 'Outra', email: s.email.toUpperCase(), password: 'senha-forte-1' } })).status, 409);
  const weak = await call('/api/conta/criar', { method: 'POST', body: { business: 'Outra', email: 'x@exemplo.com', password: '123' } });
  assert.equal(weak.status, 422);
  assert.equal(weak.data.field, 'password');
  const bot = await call('/api/conta/criar', { method: 'POST', body: { business: 'Robô', email: 'robo@exemplo.com', password: 'senha-forte-1', site: 'http://spam' } });
  assert.equal(bot.status, 201);
  assert.equal(bot.headers.get('set-cookie'), null);
  const s2 = await signup();
  assert.notEqual(s2.account.slug, 'doces-da-bia');
  assert.match(s2.account.slug, /^doces-da-bia-/);
  assert.equal((await call('/api/dados')).status, 401);
});

test('entrar, sair e recuperar a senha com o código', async () => {
  const s = await signup();
  assert.equal((await call('/api/conta/entrar', { method: 'POST', body: { email: s.email, password: 'errada-123' } })).status, 401);
  const ok = await call('/api/conta/entrar', { method: 'POST', body: { email: ` ${s.email.toUpperCase()} `, password: 'senha-forte-1' } });
  assert.equal(ok.status, 200);
  const c2 = cookieOf(ok);
  assert.equal((await call('/api/conta', { cookie: c2 })).status, 200);
  assert.equal((await call('/api/conta/sair', { method: 'POST', cookie: c2 })).status, 200);
  assert.equal((await call('/api/conta', { cookie: c2 })).status, 401);
  assert.equal((await call('/api/conta/recuperar', { method: 'POST', body: { email: s.email, code: 'AAAA-BBBB-CCCC', password: 'nova-senha-123' } })).status, 401);
  const rec = await call('/api/conta/recuperar', { method: 'POST', body: { email: s.email, code: s.code.toLowerCase().replace(/-/g, ' '), password: 'nova-senha-123' } });
  assert.equal(rec.status, 200, JSON.stringify(rec.data));
  assert.notEqual(rec.data.recoveryCode, s.code);
  assert.equal((await call('/api/conta', { cookie: s.cookie })).status, 401, 'sessões antigas caem');
  assert.equal((await call('/api/conta/entrar', { method: 'POST', body: { email: s.email, password: 'nova-senha-123' } })).status, 200);
  const cross = await call('/api/conta/entrar', { method: 'POST', body: { email: s.email, password: 'nova-senha-123' }, headers: { origin: 'https://golpe.example' } });
  assert.equal(cross.status, 403);
});

test('ingredientes: preço com histórico e não apaga o que está em receita', async () => {
  const s = await signup();
  const d = (await call('/api/dados', { cookie: s.cookie })).data;
  const condensado = d.items.find((i) => i.name === 'Leite condensado');
  let r = await call(`/api/insumos/${condensado.id}`, { method: 'PUT', cookie: s.cookie, body: { ...condensado, pkgPrice: 649 } });
  assert.equal(r.status, 200);
  r = await call(`/api/insumos/${condensado.id}`, { method: 'PUT', cookie: s.cookie, body: { ...condensado, pkgPrice: 729 } });
  assert.equal(r.data.priceChange.prev.unit.toFixed(4), (649 / 395).toFixed(4));
  assert.equal(r.data.priceChange.last.unit.toFixed(4), (729 / 395).toFixed(4));
  const used = await call(`/api/insumos/${condensado.id}`, { method: 'DELETE', cookie: s.cookie });
  assert.equal(used.status, 409);
  assert.match(used.data.error, /Brigadeiro/);
  const novo = id();
  r = await call(`/api/insumos/${novo}`, { method: 'PUT', cookie: s.cookie, body: { name: 'Granulado', unit: 'g', pkgQty: 500, pkgPrice: 1500, kind: 'ing' } });
  assert.equal(r.status, 201);
  assert.equal((await call(`/api/insumos/${novo}`, { method: 'PUT', cookie: s.cookie, body: { name: 'Granulado', unit: 'litro', pkgQty: 1 } })).status, 422);
  assert.equal((await call(`/api/insumos/${novo}`, { method: 'DELETE', cookie: s.cookie })).status, 200);
  const other = await signup();
  assert.equal((await call(`/api/insumos/${condensado.id}`, { method: 'DELETE', cookie: other.cookie })).status, 200, 'apagar id de outra conta não afeta a primeira');
  const still = (await call('/api/dados', { cookie: s.cookie })).data.items.find((i) => i.id === condensado.id);
  assert.ok(still);
});

test('receitas: sub-receita, círculo, item inexistente e limite do plano grátis', async () => {
  const s = await signup();
  const d = (await call('/api/dados', { cookie: s.cookie })).data;
  const farinha = d.items.find((i) => i.name === 'Farinha de trigo');
  const massa = { id: id(), name: 'Massa branca', yieldQty: 1.2, yieldUnit: 'kg', lossPct: 10, prepMin: 60, parts: [{ t: 'i', id: farinha.id, qty: 2, unit: 'xic' }], sell: { on: false } };
  assert.equal((await call(`/api/fichas/${massa.id}`, { method: 'PUT', cookie: s.cookie, body: massa })).status, 201);
  const bolo = { id: id(), name: 'Bolo de pote', yieldQty: 1, yieldUnit: 'un', prepMin: 5, parts: [{ t: 'f', id: massa.id, qty: 120, unit: 'g' }], sell: { on: true, price: 1200 } };
  assert.equal((await call(`/api/fichas/${bolo.id}`, { method: 'PUT', cookie: s.cookie, body: bolo })).status, 201);
  const loop = await call(`/api/fichas/${massa.id}`, { method: 'PUT', cookie: s.cookie, body: { ...massa, parts: [...massa.parts, { t: 'f', id: bolo.id, qty: 1, unit: 'un' }] } });
  assert.equal(loop.status, 422);
  assert.match(loop.data.error, /ela mesma/);
  const ghost = await call(`/api/fichas/${id()}`, { method: 'PUT', cookie: s.cookie, body: { name: 'X', yieldQty: 1, yieldUnit: 'un', parts: [{ t: 'i', id: id(), qty: 1, unit: 'g' }] } });
  assert.equal(ghost.status, 422);
  const inUse = await call(`/api/fichas/${massa.id}`, { method: 'DELETE', cookie: s.cookie });
  assert.equal(inUse.status, 409);
  setPro(s.account.id, 0);
  const third = await call(`/api/fichas/${id()}`, { method: 'PUT', cookie: s.cookie, body: { name: 'Trufa', yieldQty: 10, yieldUnit: 'un', parts: [], sell: { on: true, price: 500 } } });
  assert.equal(third.status, 402);
  assert.equal(third.data.code, 'limite_produtos');
  const base = await call(`/api/fichas/${id()}`, { method: 'PUT', cookie: s.cookie, body: { name: 'Recheio', yieldQty: 500, yieldUnit: 'g', parts: [], sell: { on: false } } });
  assert.equal(base.status, 201, 'receita base não conta no limite');
  assert.equal((await call(`/api/fichas/${bolo.id}`, { method: 'PUT', cookie: s.cookie, body: { ...bolo, name: 'Bolo de pote de ninho' } })).status, 200, 'editar produto que já vendia continua valendo');
});

test('pedidos: número, custo calculado no servidor, situação, período e limite do grátis', async () => {
  const s = await signup();
  const d = (await call('/api/dados', { cookie: s.cookie })).data;
  const brig = d.fichas[0];
  for (const it of d.items) await call(`/api/insumos/${it.id}`, { method: 'PUT', cookie: s.cookie, body: { ...it, pkgPrice: 1000 } });
  const o1 = { id: id(), customer: 'Ana', phone: '(11) 98765-4321', dueDate: today(2), dueTime: '15:00', delivery: 'entrega', address: 'Rua A, 10', deliveryFee: 800, channel: 'ifood', items: [{ f: brig.id, name: 'Brigadeiro', qty: 50, price: 250, cost: 1 }], paid: 5000, status: 'confirmado' };
  let r = await call(`/api/pedidos/${o1.id}`, { method: 'PUT', cookie: s.cookie, body: o1 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.order.num, 1);
  assert.ok(r.data.order.items[0].cost > 1, 'custo vem das receitas, não do navegador');
  assert.equal(r.data.order.feePct, 26.2);
  assert.equal(r.data.order.origin, 'app');
  assert.match(r.data.order.token, /^[A-Za-z0-9_-]{24}$/);
  r = await call(`/api/pedidos/${o1.id}`, { method: 'PUT', cookie: s.cookie, body: { ...o1, customer: 'Ana Paula' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.order.num, 1);
  const o2 = { id: id(), customer: 'Bruno', dueDate: today(10), items: [{ name: 'Bolo personalizado', qty: 1, price: 18000 }], status: 'orcamento' };
  r = await call(`/api/pedidos/${o2.id}`, { method: 'PUT', cookie: s.cookie, body: o2 });
  assert.equal(r.data.order.num, 2);
  r = await call(`/api/pedidos/${o1.id}/situacao`, { method: 'POST', cookie: s.cookie, body: { status: 'entregue', paid: 13300 } });
  assert.equal(r.data.order.status, 'entregue');
  assert.equal(r.data.order.paid, 13300);
  const open = await call('/api/pedidos?abertos=1', { cookie: s.cookie });
  assert.deepEqual(open.data.orders.map((o) => o.num), [2]);
  const range = await call(`/api/pedidos?de=${today(0)}&ate=${today(5)}`, { cookie: s.cookie });
  assert.deepEqual(range.data.orders.map((o) => o.num), [1]);
  assert.equal((await call('/api/pedidos?de=2026-13-01&ate=2026-01-01', { cookie: s.cookie })).status, 422);
  assert.equal((await call(`/api/pedidos/${id()}`, { method: 'PUT', cookie: s.cookie, body: { dueDate: today(), items: [] } })).status, 422);
  setPro(s.account.id, 0);
  assert.equal((await call(`/api/pedidos/${id()}`, { method: 'PUT', cookie: s.cookie, body: { ...o2, id: undefined } })).status, 201);
  const over = await call(`/api/pedidos/${id()}`, { method: 'PUT', cookie: s.cookie, body: { ...o2, id: undefined } });
  assert.equal(over.status, 402);
  assert.equal(over.data.code, 'limite_pedidos');
  assert.equal((await call(`/api/pedidos/${o2.id}`, { method: 'DELETE', cookie: s.cookie })).status, 200);
  const other = await signup();
  assert.equal((await call(`/api/pedidos/${o1.id}`, { cookie: other.cookie })).status, 404);
});

test('cardápio público: página, pedido do cliente com preço do servidor e página do pedido', async () => {
  const s = await signup({ business: 'Cantinho da Lu' });
  const d = (await call('/api/dados', { cookie: s.cookie })).data;
  const brig = d.fichas[0];
  let r = await call('/api/conta', { method: 'PATCH', cookie: s.cookie, body: { settings: { ...s.account.settings, whatsapp: '11 98765-4321', pixKey: 'lu@exemplo.com', pixName: 'Luciana', city: 'Campinas', menu: { on: true, leadDays: 2, delivery: 'ambos', note: 'Feito com carinho <3' } } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await call(`/api/fichas/${brig.id}`, { method: 'PUT', cookie: s.cookie, body: { ...brig, name: 'Brigadeiro <b>gourmet</b>', sell: { on: true, label: 'unidade', price: 300 }, menu: { on: true, cat: 'Docinhos', desc: 'Belga 50%' } } });
  const page = await call(`/c/${s.account.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.data, /Cantinho da Lu/);
  assert.match(page.data, /Brigadeiro &lt;b&gt;gourmet&lt;\/b&gt;/);
  assert.doesNotMatch(page.data, /<b>gourmet/);
  assert.match(page.data, /R\$ 3,00/);
  assert.match(page.data, /Feito com carinho &lt;3/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const body = { name: 'Carla', phone: '11912345678', date: today(3), delivery: 'retirada', items: [{ id: brig.id, qty: 100 }], notes: 'Sem granulado' };
  const early = await call(`/api/c/${s.account.slug}/pedido`, { method: 'POST', body: { ...body, date: today(0) } });
  assert.equal(early.status, 422);
  assert.equal(early.data.field, 'date');
  r = await call(`/api/c/${s.account.slug}/pedido`, { method: 'POST', body: { ...body, items: [{ id: brig.id, qty: 100, price: 1 }] } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.total, 30000);
  assert.equal(r.data.whatsapp, '11987654321');
  const fresh = await call('/api/dados', { cookie: s.cookie });
  assert.equal(fresh.data.newOrders, 1);
  const list = await call('/api/pedidos?abertos=1', { cookie: s.cookie });
  const got = list.data.orders.find((o) => o.num === r.data.num);
  assert.equal(got.origin, 'cardapio');
  assert.equal(got.seen, false);
  assert.equal(got.status, 'orcamento');
  assert.equal(got.notes, 'Sem granulado');
  const ticket = await call(`/p/${r.data.token}`);
  assert.equal(ticket.status, 200);
  assert.match(ticket.data, /Pedido nº/);
  assert.match(ticket.data, /lu@exemplo.com/);
  assert.doesNotMatch(ticket.data, /Sem granulado/);
  assert.equal(ticket.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await call(`/p/${'x'.repeat(24)}`)).status, 404);
  const trap = await call(`/api/c/${s.account.slug}/pedido`, { method: 'POST', body: { ...body, site: 'x' } });
  assert.equal(trap.data.num, 0);
  assert.equal((await call(`/api/pedidos/${got.id}/visto`, { method: 'POST', cookie: s.cookie })).status, 200);
  assert.equal((await call('/api/dados', { cookie: s.cookie })).data.newOrders, 0);
  await call('/api/conta', { method: 'PATCH', cookie: s.cookie, body: { settings: { ...s.account.settings, menu: { on: false } } } });
  assert.equal((await call(`/c/${s.account.slug}`)).status, 404);
  assert.equal((await call('/c/nao-existe-mesmo')).status, 404);
});

test('foto do produto: só imagem, pequena, e serve com cache longo', async () => {
  const s = await signup();
  const brig = (await call('/api/dados', { cookie: s.cookie })).data.fichas[0];
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(2000)]);
  let r = await call(`/api/fichas/${brig.id}/foto`, { method: 'PUT', cookie: s.cookie, raw: jpeg, headers: { 'content-type': 'image/jpeg' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ph = r.data.photo;
  const img = await call(`/f/${ph}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.match(img.headers.get('cache-control'), /immutable/);
  assert.ok(Buffer.compare(img.data, jpeg) === 0);
  assert.equal((await call(`/api/fichas/${brig.id}/foto`, { method: 'PUT', cookie: s.cookie, raw: Buffer.from('<svg onload=alert(1)>'), headers: { 'content-type': 'image/svg+xml' } })).status, 415);
  assert.equal((await call(`/api/fichas/${brig.id}/foto`, { method: 'PUT', cookie: s.cookie, raw: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200000)]), headers: { 'content-type': 'image/jpeg' } })).status, 413);
  const d = (await call('/api/dados', { cookie: s.cookie })).data.fichas[0];
  assert.equal(d.menu.photo, ph);
  await call(`/api/fichas/${brig.id}`, { method: 'PUT', cookie: s.cookie, body: { ...d, menu: { ...d.menu, photo: 'aaaaaaaaaaaaaaaa' } } });
  assert.equal((await call('/api/dados', { cookie: s.cookie })).data.fichas[0].menu.photo, ph, 'não aceita foto de outra conta');
  assert.equal((await call(`/api/fichas/${brig.id}/foto`, { method: 'DELETE', cookie: s.cookie })).status, 200);
  assert.equal((await call(`/f/${ph}`)).status, 404);
});

test('assinatura Pro por Pix: gera, confirma pelo aviso, soma dias e reembolsa', async () => {
  const s = await signup();
  setPro(s.account.id, 0);
  let r = await call('/api/assinatura/pix', { method: 'POST', cookie: s.cookie, body: { plan: 'mes' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.amountCents, 1990);
  assert.ok(r.data.qrCode);
  const payId = r.data.paymentId;
  const again = await call('/api/assinatura/pix', { method: 'POST', cookie: s.cookie, body: { plan: 'mes' } });
  assert.equal(again.data.paymentId, payId, 'reaproveita o Pix em aberto');
  const mpId = [...mp.orders.values()].find((o) => o.external_reference === payId).id;
  mp.pay(mpId);
  const bad = await call(`/api/mp/webhook?data.id=${mpId}&type=order`, { method: 'POST', body: { data: { id: mpId } }, headers: { 'x-signature': 'ts=1,v1=00', 'x-request-id': 'r' } });
  assert.equal(bad.status, 401);
  const hook = await call(`/api/mp/webhook?data.id=${mpId}&type=order`, { method: 'POST', body: { data: { id: mpId } }, headers: sign(mpId) });
  assert.equal(hook.status, 200);
  const st = await call(`/api/assinatura/pix/${payId}`, { cookie: s.cookie });
  assert.equal(st.data.status, 'paid');
  const acc = (await call('/api/conta', { cookie: s.cookie })).data.account;
  assert.equal(acc.plan.pro, true);
  assert.equal(acc.plan.trial, false);
  assert.ok(Math.abs(acc.plan.proUntil - (Date.now() + 30 * DAY)) < 60000);
  const bill = await call('/api/assinatura', { cookie: s.cookie });
  assert.equal(bill.data.payments[0].refundable, true);
  r = await call(`/api/assinatura/reembolso/${payId}`, { method: 'POST', cookie: s.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(mp.orders.get(mpId).status, 'refunded');
  assert.equal((await call('/api/conta', { cookie: s.cookie })).data.account.plan.pro, false);
  assert.equal((await call(`/api/assinatura/reembolso/${payId}`, { method: 'POST', cookie: s.cookie })).status, 409);
  const other = await signup();
  assert.equal((await call(`/api/assinatura/pix/${payId}`, { cookie: other.cookie })).status, 404);
});

test('cupom de 100% libera na hora e cupom de parceiro dá desconto', async () => {
  const oc = await ownerCookie();
  assert.equal((await call('/api/owner/coupons', { method: 'POST', cookie: oc, body: { code: 'CORTESIA', percentOff: 100, maxUses: 1 } })).status, 201);
  assert.equal((await call('/api/owner/coupons', { method: 'POST', cookie: oc, body: { code: 'CONFEITEIRA', percentOff: 20 } })).status, 201);
  const chk = await call('/api/cupom', { method: 'POST', body: { code: 'confeiteira' } });
  assert.equal(chk.data.valid, true);
  assert.equal(chk.data.plans.find((p) => p.id === 'ano').cents, Math.round(15990 * 0.8));
  const s = await signup();
  setPro(s.account.id, 0);
  const r = await call('/api/assinatura/pix', { method: 'POST', cookie: s.cookie, body: { plan: 'tri', coupon: 'CORTESIA' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'paid');
  const acc = (await call('/api/conta', { cookie: s.cookie })).data.account;
  assert.ok(Math.abs(acc.plan.proUntil - (Date.now() + 90 * DAY)) < 60000);
  const s2 = await signup();
  assert.equal((await call('/api/assinatura/pix', { method: 'POST', cookie: s2.cookie, body: { plan: 'tri', coupon: 'CORTESIA' } })).status, 422, 'cupom esgotado');
  const p20 = await call('/api/assinatura/pix', { method: 'POST', cookie: s2.cookie, body: { plan: 'ano', coupon: 'CONFEITEIRA' } });
  assert.equal(p20.data.amountCents, Math.round(15990 * 0.8));
  const mpId = [...mp.orders.values()].find((o) => o.external_reference === p20.data.paymentId).id;
  mp.pay(mpId);
  await fetch(`${app.base}/__scheduled?cron=*/10+*+*+*+*`);
  let acc2;
  for (let i = 0; i < 40; i++) {
    acc2 = (await call('/api/conta', { cookie: s2.cookie })).data.account;
    if (acc2.plan.proUntil > Date.now() + 370 * DAY) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(acc2.plan.proUntil > Date.now() + 370 * DAY, 'pagou na rotina: soma 365 dias aos 7 do teste');
});

test('configurações: validação, endereço do cardápio e exportação', async () => {
  const s = await signup();
  const bad = await call('/api/conta', { method: 'PATCH', cookie: s.cookie, body: { settings: { ...s.account.settings, marginPct: 80 } } });
  assert.equal(bad.status, 422);
  const other = await signup({ business: 'Brigaderia' });
  assert.equal((await call('/api/conta', { method: 'PATCH', cookie: s.cookie, body: { slug: other.account.slug } })).status, 409);
  assert.equal((await call('/api/conta', { method: 'PATCH', cookie: s.cookie, body: { slug: 'app' } })).status, 422);
  assert.equal((await call('/api/conta', { method: 'PATCH', cookie: s.cookie, body: { slug: 'Ç!' } })).status, 422);
  const ok = await call('/api/conta', { method: 'PATCH', cookie: s.cookie, body: { business: 'Doces da Bia Gourmet', slug: `bia-${id(4)}`, settings: { ...s.account.settings, wageCents: 300000, hoursMonth: 100 } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.account.settings.wageCents, 300000);
  const ex = await call('/api/conta/exportar', { cookie: s.cookie });
  assert.equal(ex.status, 200);
  assert.match(ex.headers.get('content-disposition'), /attachment/);
  assert.equal(ex.data.conta.negocio, 'Doces da Bia Gourmet');
  assert.ok(ex.data.ingredientes.length > 5);
});

test('painel do dono: resumo, busca de conta, link de nova senha, cortesia e exclusão', async () => {
  const s = await signup({ business: 'Marmitas da Rô', segment: 'marmitas' });
  const oc = await ownerCookie();
  const sum = await call('/api/owner/summary', { cookie: oc });
  assert.equal(sum.status, 200);
  assert.ok(sum.data.accounts.total >= 1);
  assert.ok(sum.data.funnel.conta_criada >= 1);
  const found = await call(`/api/owner/accounts?q=${encodeURIComponent('marmitas da rô')}`, { cookie: oc });
  const acc = found.data.accounts.find((x) => x.email === s.email);
  assert.ok(acc);
  const link = await call(`/api/owner/accounts/${acc.id}/link`, { method: 'POST', cookie: oc });
  const token = link.data.url.split('#')[1];
  assert.equal((await call('/api/conta/nova-senha', { method: 'POST', body: { token: 'x', password: 'outra-senha-123' } })).status, 401);
  const reset = await call('/api/conta/nova-senha', { method: 'POST', body: { token, password: 'outra-senha-123' } });
  assert.equal(reset.status, 200);
  assert.ok(reset.data.recoveryCode);
  assert.equal((await call('/api/conta/nova-senha', { method: 'POST', body: { token, password: 'outra-senha-123' } })).status, 401, 'link vale uma vez');
  const days = await call(`/api/owner/accounts/${acc.id}/dias`, { method: 'POST', cookie: oc, body: { days: 30 } });
  assert.equal(days.status, 200);
  assert.equal((await call(`/api/owner/accounts/${acc.id}/apagar`, { method: 'POST', cookie: oc, body: { confirm: 'outro@x.com' } })).status, 422);
  assert.equal((await call(`/api/owner/accounts/${acc.id}/apagar`, { method: 'POST', cookie: oc, body: { confirm: s.email } })).status, 200);
  assert.equal((await call('/api/conta/entrar', { method: 'POST', body: { email: s.email, password: 'outra-senha-123' } })).status, 401);
  assert.equal((await call('/api/owner/summary')).status, 401);
});

test('excluir a própria conta apaga tudo', async () => {
  const s = await signup();
  assert.equal((await call('/api/conta/excluir', { method: 'POST', cookie: s.cookie, body: { password: 'errada' } })).status, 401);
  const r = await call('/api/conta/excluir', { method: 'POST', cookie: s.cookie, body: { password: 'senha-forte-1' } });
  assert.equal(r.status, 200);
  const left = JSON.parse(app.sql(`SELECT (SELECT COUNT(*) FROM items WHERE account_id = '${s.account.id}') AS i, (SELECT COUNT(*) FROM fichas WHERE account_id = '${s.account.id}') AS f, (SELECT COUNT(*) FROM sessions WHERE account_id = '${s.account.id}') AS s`))[0].results[0];
  assert.deepEqual(left, { i: 0, f: 0, s: 0 });
});
