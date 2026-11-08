// Contas do app: medidas, custo com sub-receitas, preço por canal, pedidos, lista de compras e lucro do mês.
import test from 'node:test';
import assert from 'node:assert/strict';
import { itemQty, fichaQty, makeEngine, roundPrice, suggestPrice, judge, channelTable, alerts, orderMath, shoppingList, monthReport, receivable, itemSnapshot } from '../public/js/shared/calc.js';
import { checkFicha, checkItem, checkOrder, checkSettings, checkMenuOrder, normSettings, newId, Invalid } from '../public/js/shared/schema.js';
import { parseMoney, parseNum, brl, qtyText, fmtNum, dayLabel, addMonths, monthRange } from '../public/js/shared/format.js';
import { starterData } from '../public/js/shared/catalog.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const items = [
  { id: 'condensado', name: 'Leite condensado', kind: 'ing', unit: 'g', pkgQty: 395, pkgPrice: 649, cupG: 300 },
  { id: 'manteiga', name: 'Manteiga', kind: 'ing', unit: 'g', pkgQty: 200, pkgPrice: 1190, cupG: 200 },
  { id: 'chocpo', name: 'Chocolate em pó', kind: 'ing', unit: 'g', pkgQty: 200, pkgPrice: 990, cupG: 90 },
  { id: 'forminha', name: 'Forminha', kind: 'emb', unit: 'un', pkgQty: 100, pkgPrice: 600 },
  { id: 'leite', name: 'Leite', kind: 'ing', unit: 'ml', pkgQty: 1000, pkgPrice: 549 },
  { id: 'ovos', name: 'Ovos', kind: 'ing', unit: 'un', pkgQty: 12, pkgPrice: 1080, unitG: 50 },
  { id: 'farinha', name: 'Farinha', kind: 'ing', unit: 'g', pkgQty: 1000, pkgPrice: 600, cupG: 120 },
  { id: 'pote', name: 'Pote', kind: 'emb', unit: 'un', pkgQty: 25, pkgPrice: 2500 },
  { id: 'semPreco', name: 'Corante', kind: 'ing', unit: 'g', pkgQty: 10, pkgPrice: 0 },
];
const settings = { wageCents: 200000, hoursMonth: 120, fixed: [{ name: 'Gás', cents: 12000 }, { name: 'Luz', cents: 8000 }], marginPct: 20, taxPct: 0, rounding: '0.10' };
const brigadeiro = {
  id: 'brigadeiro',
  name: 'Brigadeiro',
  yieldQty: 25,
  yieldUnit: 'un',
  unitWeightG: 18,
  lossPct: 0,
  prepMin: 40,
  parts: [
    { t: 'i', id: 'condensado', qty: 1, unit: 'un' },
    { t: 'i', id: 'manteiga', qty: 1, unit: 'cs' },
    { t: 'i', id: 'chocpo', qty: 3, unit: 'cs' },
    { t: 'i', id: 'forminha', qty: 25, unit: 'un' },
  ],
  sell: { on: true, label: 'unidade', price: 150, prices: { ifood: 250 } },
};
const massa = {
  id: 'massa',
  name: 'Massa branca',
  yieldQty: 1.2,
  yieldUnit: 'kg',
  lossPct: 10,
  prepMin: 60,
  parts: [
    { t: 'i', id: 'farinha', qty: 2, unit: 'xic' },
    { t: 'i', id: 'leite', qty: 1, unit: 'xic' },
    { t: 'i', id: 'ovos', qty: 4, unit: 'un' },
  ],
  sell: { on: false },
};
const bolo = {
  id: 'bolopote',
  name: 'Bolo de pote',
  yieldQty: 1,
  yieldUnit: 'un',
  prepMin: 5,
  parts: [
    { t: 'f', id: 'massa', qty: 120, unit: 'g' },
    { t: 'f', id: 'brigadeiro', qty: 90, unit: 'g' },
    { t: 'i', id: 'pote', qty: 1, unit: 'un' },
  ],
  sell: { on: true, label: 'pote', price: 1200, prices: {} },
};

test('medidas: xícara, colher, embalagem e unidade viram a base do ingrediente', () => {
  const [condensado, manteiga, chocpo, , leite, ovos] = items;
  assert.deepEqual(itemQty(condensado, 1, 'un'), { ok: true, v: 395 });
  assert.deepEqual(itemQty(condensado, 0.5, 'kg'), { ok: true, v: 500 });
  near(itemQty(manteiga, 1, 'cs').v, 12.5);
  near(itemQty(chocpo, 3, 'cs').v, 16.875);
  near(itemQty(leite, 1, 'xic').v, 240);
  near(itemQty(ovos, 100, 'g').v, 2);
  assert.equal(itemQty(ovos, 1, 'xic').ok, false);
  assert.deepEqual(itemQty({ unit: 'g', pkgQty: 100 }, 1, 'xic'), { ok: false, why: 'cupG' });
  assert.deepEqual(itemQty({ unit: 'un', pkgQty: 12 }, 50, 'g'), { ok: false, why: 'unitG' });
  near(fichaQty(brigadeiro, 90, 'g').v, 5);
  assert.deepEqual(fichaQty(massa, 1, 'un'), { ok: false, why: 'peso' });
});

test('custo do brigadeiro: ingredientes, tempo e custos fixos por unidade', () => {
  const eng = makeEngine({ items, fichas: [brigadeiro], settings });
  const c = eng.cost('brigadeiro');
  // 649 + 74,375 + 83,53 + 150 centavos na receita inteira
  near(c.batch.mat, 649 + 74.375 + 83.53125 + 150);
  near(c.unit.mat, (649 + 74.375 + 83.53125 + 150) / 25);
  near(c.unit.lab, ((40 / 60) * (200000 / 120)) / 25);
  near(c.unit.fix, ((40 / 60) * (20000 / 120)) / 25);
  near(c.sale.min, 1.6);
  assert.equal(c.problems.length, 0);
  assert.equal(c.blocking, false);
});

test('sub-receitas levam ingredientes, tempo e perda para o produto', () => {
  const eng = makeEngine({ items, fichas: [brigadeiro, massa, bolo], settings });
  const m = eng.cost('massa');
  // massa: 240 g farinha (144) + 240 ml leite (131,76) + 4 ovos (360) = 635,76; rende 1080 g por causa da perda de 10%
  near(m.batch.mat, 144 + 131.76 + 360);
  near(m.effYield, 1080);
  near(m.sale.mat, ((144 + 131.76 + 360) / 1080) * 1000);
  const b = eng.cost('bolopote');
  const br = eng.cost('brigadeiro');
  near(b.batch.mat, 120 * m.unit.mat + 5 * br.unit.mat + 100);
  near(b.batch.min, 5 + 120 * m.unit.min + 5 * br.unit.min);
  assert.equal(b.sale.factor, 1);
  assert.equal(m.sale.factor, 1000);
});

test('receita que usa ela mesma por outra receita é apontada como ciclo', () => {
  const a = { id: 'a', name: 'A', yieldQty: 100, yieldUnit: 'g', parts: [{ t: 'f', id: 'b', qty: 10, unit: 'g' }] };
  const b = { id: 'b', name: 'B', yieldQty: 100, yieldUnit: 'g', parts: [{ t: 'f', id: 'a', qty: 10, unit: 'g' }] };
  const eng = makeEngine({ items, fichas: [a, b], settings });
  const c = eng.cost('a');
  assert.ok(c.problems.some((p) => p.why === 'filhaErro'));
  assert.ok(eng.cost('b').problems.some((p) => p.why === 'ciclo'));
  assert.equal(c.blocking, true);
  const sl = shoppingList(eng, [{ items: [{ f: 'a', qty: 1 }] }]);
  assert.ok(Array.isArray(sl.shopping));
});

test('ingrediente sem preço avisa, mas não bloqueia a conta', () => {
  const f = { id: 'x', name: 'X', yieldQty: 1, yieldUnit: 'un', parts: [{ t: 'i', id: 'semPreco', qty: 1, unit: 'g' }, { t: 'i', id: 'pote', qty: 1, unit: 'un' }] };
  const eng = makeEngine({ items, fichas: [f], settings });
  const c = eng.cost('x');
  assert.deepEqual(c.problems.map((p) => p.why), ['semPreco']);
  assert.equal(c.blocking, false);
  near(c.batch.mat, 100);
});

test('arredondamento e preço sugerido com taxa sobre o preço', () => {
  assert.equal(roundPrice(108.2, '0.10'), 110);
  assert.equal(roundPrice(108.2, '0.50'), 150);
  assert.equal(roundPrice(108.2, '1.00'), 200);
  assert.equal(roundPrice(108.2, '0.90'), 190);
  assert.equal(roundPrice(1150, '0.90'), 1190);
  assert.equal(roundPrice(1190, '0.90'), 1190);
  assert.equal(roundPrice(50, '0.90'), 90);
  assert.equal(roundPrice(108.2, 'nenhum'), 109);
  const s = suggestPrice(1000, { marginPct: 20, taxPct: 6, feePct: 26.2, rounding: 'nenhum' });
  near(s.raw, 1000 / (1 - 0.522));
  assert.equal(suggestPrice(1000, { marginPct: 60, feePct: 40 }).ok, false);
  assert.equal(suggestPrice(0, { marginPct: 20 }).ok, false);
});

test('veredito do preço: prejuízo, não paga o tempo, abaixo da meta e ok', () => {
  const sale = { mat: 400, lab: 300, fix: 100, total: 800 };
  assert.equal(judge(380, sale, { marginPct: 20 }).status, 'prejuizo');
  assert.equal(judge(700, sale, { marginPct: 20 }).status, 'tempo');
  assert.equal(judge(900, sale, { marginPct: 20 }).status, 'baixo');
  const ok = judge(1000, sale, { marginPct: 20 });
  assert.equal(ok.status, 'ok');
  near(ok.margin, 20);
  assert.equal(judge(1000, sale, { marginPct: 20, feePct: 26.2 }).status, 'tempo');
  assert.equal(judge(0, sale).status, 'semPreco');
});

test('tabela por canal usa o preço próprio do canal quando existe e lista alertas', () => {
  const eng = makeEngine({ items, fichas: [brigadeiro], settings });
  const rows = channelTable(eng, brigadeiro);
  assert.deepEqual(rows.map((r) => r.channel.id), ['direto', 'cartao', 'ifood']);
  assert.equal(rows[0].price, 150);
  assert.equal(rows[2].price, 250);
  assert.equal(rows[2].own, true);
  const total = eng.cost('brigadeiro').sale.total;
  assert.equal(rows[0].suggested.cents, roundPrice(total / 0.8, '0.10'));
  const cheap = { ...brigadeiro, sell: { on: true, price: 30, prices: {} } };
  const eng2 = makeEngine({ items, fichas: [cheap], settings });
  const al = alerts(eng2, [cheap]);
  assert.equal(al[0].status, 'prejuizo');
});

test('pedido: total, sinal, taxa de entrega fora do lucro e desconto', () => {
  const o = { items: [{ qty: 2, price: 1200, cost: 300, min: 5 }, { qty: 1.5, price: 8000, cost: 2000, min: 30 }], deliveryFee: 800, discount: 1000, feePct: 4, taxPct: 0, paid: 5000 };
  const m = orderMath(o);
  assert.equal(m.items, 2400 + 12000);
  assert.equal(m.total, 14400 + 800 - 1000);
  assert.equal(m.revenue, 14400 - 1000);
  near(m.fee, (14200 * 4) / 100);
  near(m.mat, 600 + 3000);
  near(m.min, 10 + 45);
  assert.equal(m.due, 14200 - 5000);
  near(m.contribution, 13400 - 568 - 3600);
});

test('lista de compras explode sub-receitas e conta embalagens a comprar', () => {
  const eng = makeEngine({ items: items.map((i) => (i.id === 'pote' ? { ...i, stock: 5 } : i)), fichas: [brigadeiro, massa, bolo], settings });
  const orders = [
    { items: [{ f: 'bolopote', name: 'Bolo de pote', qty: 12 }] },
    { items: [{ f: 'brigadeiro', name: 'Brigadeiro', qty: 50 }, { f: '', name: 'Vela', qty: 1 }] },
  ];
  const sl = shoppingList(eng, orders);
  const prod = Object.fromEntries(sl.production.map((p) => [p.id, p]));
  near(prod.massa.need, 1440);
  near(prod.massa.batches, 1440 / 1080);
  // 12 potes × 5 brigadeiros (90 g ÷ 18 g) + 50 vendidos = 110 brigadeiros = 4,4 receitas
  near(prod.brigadeiro.need, 110);
  near(prod.brigadeiro.batches, 4.4);
  const shop = Object.fromEntries(sl.shopping.map((s) => [s.id, s]));
  near(shop.condensado.need, 4.4 * 395);
  assert.equal(shop.condensado.packages, 5);
  assert.equal(shop.pote.need, 12);
  assert.equal(shop.pote.buy, 7);
  assert.equal(shop.pote.packages, 1);
  assert.equal(shop.forminha.packages, 2);
  assert.ok(sl.products.some((p) => p.free && p.name === 'Vela'));
  assert.equal(sl.total, sl.shopping.reduce((a, s) => a + s.spend, 0));
});

test('lucro do mês: só pedidos entregues no mês, custos fixos e ganho por hora', () => {
  const s = { ...settings };
  const orders = [
    { id: '1', status: 'entregue', dueDate: '2026-11-03', channel: 'direto', feePct: 0, items: [{ f: 'brigadeiro', name: 'Brigadeiro', qty: 100, price: 150, cost: 38, min: 1.6 }], paid: 15000 },
    { id: '2', status: 'entregue', dueDate: '2026-11-20', channel: 'ifood', feePct: 26.2, items: [{ f: 'bolopote', name: 'Bolo de pote', qty: 10, price: 1500, cost: 400, min: 9 }], deliveryFee: 500, paid: 0 },
    { id: '3', status: 'confirmado', dueDate: '2026-11-25', channel: 'direto', items: [{ f: 'bolopote', name: 'Bolo de pote', qty: 5, price: 1200, cost: 400 }], paid: 2000 },
    { id: '4', status: 'entregue', dueDate: '2026-10-30', channel: 'direto', items: [{ f: 'x', name: 'X', qty: 1, price: 999999, cost: 0 }] },
  ];
  const r = monthReport(orders, s, '2026-11');
  assert.equal(r.count, 2);
  assert.equal(r.revenue, 15000 + 15000);
  assert.equal(r.delivery, 500);
  near(r.fee, (15500 * 26.2) / 100);
  assert.equal(r.mat, 3800 + 4000);
  near(r.contribution, 30000 - (15500 * 26.2) / 100 - 7800);
  assert.equal(r.fixed, 20000);
  near(r.earnings, r.contribution - 20000);
  near(r.hours, (160 + 90) / 60);
  assert.equal(r.byProduct[0].name, 'Brigadeiro');
  near(r.byProduct.reduce((a, p) => a + p.contribution, 0), r.contribution, 0.5);
  const rc = receivable(orders);
  assert.equal(rc.count, 3);
  assert.equal(rc.due, 15500 + 4000 + 999999);
});

test('instantâneo de custo do pedido usa a unidade de venda', () => {
  const eng = makeEngine({ items, fichas: [brigadeiro, massa, bolo], settings });
  const snap = itemSnapshot(eng, 'massa');
  assert.equal(snap.cost, Math.round(eng.cost('massa').sale.mat));
  assert.deepEqual(itemSnapshot(eng, ''), { cost: 0, min: 0 });
});

test('validação: receitas, ingredientes, pedidos, configurações e pedido do cardápio', () => {
  const id = newId();
  assert.match(id, /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/);
  assert.throws(() => checkItem({ id, name: '', unit: 'g', pkgQty: 1 }), Invalid);
  const it = checkItem({ id, name: '  Leite   condensado ', unit: 'g', pkgQty: '395', pkgPrice: 649, cupG: '300' });
  assert.equal(it.name, 'Leite condensado');
  assert.equal(it.pkgQty, 395);
  assert.throws(() => checkFicha({ id, name: 'X', yieldQty: 1, yieldUnit: 'un', parts: [{ t: 'f', id, qty: 1, unit: 'un' }] }), /ela mesma/);
  assert.throws(() => checkFicha({ id, name: 'X', yieldQty: 0, yieldUnit: 'un' }), Invalid);
  const f = checkFicha({ id, name: 'Bolo', yieldQty: 1, yieldUnit: 'un', parts: [], sell: { on: true, price: 1200, prices: { ifood: 1500, hack: 1 } }, menu: { on: true, photo: 'x' } }, ['direto', 'ifood']);
  assert.deepEqual(f.sell.prices, { ifood: 1500 });
  assert.equal(f.menu.photo, '');
  assert.throws(() => checkOrder({ id, dueDate: '2026-02-30', items: [{ name: 'X', qty: 1 }] }), /data/);
  const o = checkOrder({ id, dueDate: '2026-11-14', dueTime: '15:30', items: [{ name: 'Bolo', qty: '1,5', price: 8000 }], channel: 'nada', delivery: 'retirada', address: 'não guarda' });
  assert.equal(o.items[0].qty, 1.5);
  assert.equal(o.channel, 'direto');
  assert.equal(o.address, '');
  assert.throws(() => checkSettings({ marginPct: 70, channels: [{ id: 'direto', name: 'D', feePct: 0 }, { id: 'ifood', name: 'iFood', feePct: 30 }] }), /95%/);
  const s = normSettings({ channels: [{ id: 'ifood', name: 'iFood', feePct: 12 }], rounding: 'x', hoursMonth: 9999 });
  assert.equal(s.channels[0].id, 'direto');
  assert.equal(s.rounding, '0.10');
  assert.equal(s.hoursMonth, 130);
  assert.throws(() => checkMenuOrder({ name: 'Ana', phone: '123', date: '2026-11-14', items: [{ id, qty: 1 }] }), /WhatsApp/);
  assert.throws(() => checkMenuOrder({ name: 'Ana', phone: '11987654321', date: '2026-11-14', delivery: 'entrega', items: [{ id, qty: 1 }] }), /endereço/);
});

test('formatação brasileira de dinheiro, números e datas', () => {
  assert.equal(parseMoney('6,49'), 649);
  assert.equal(parseMoney('R$ 1.234,50'), 123450);
  assert.equal(parseMoney('10'), 1000);
  assert.ok(Number.isNaN(parseMoney('abc')));
  assert.equal(parseMoney(''), null);
  assert.equal(parseNum('1,5'), 1.5);
  assert.equal(parseNum('1.200'), 1200);
  assert.equal(parseNum('0.25'), 0.25);
  assert.equal(brl(123456), 'R$ 1.234,56');
  assert.equal(brl(-50), '-R$ 0,50');
  assert.equal(qtyText(1250, 'g'), '1,25 kg');
  assert.equal(qtyText(12.5, 'g'), '12,5 g');
  assert.equal(qtyText(3, 'un'), '3 un');
  assert.equal(fmtNum(1200.5, 1), '1.200,5');
  assert.equal(dayLabel('2026-11-07', '2026-11-06'), 'Amanhã');
  assert.equal(dayLabel('2026-11-14', '2026-11-06'), 'sáb., 14/11');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
});

test('dados iniciais de cada tipo de negócio montam uma receita de exemplo sem erro de medida', () => {
  let n = 0;
  const idFn = () => `id${String(n++).padStart(8, '0')}`;
  for (const seg of ['confeitaria', 'salgados', 'marmitas', 'outro']) {
    const d = starterData(seg, idFn);
    assert.ok(d.items.length >= 5);
    const priced = d.items.map((i) => ({ ...i, pkgPrice: 1000 }));
    const eng = makeEngine({ items: priced, fichas: d.fichas, settings });
    for (const f of d.fichas) {
      const c = eng.cost(f.id);
      assert.equal(c.blocking, false, `${seg}: ${JSON.stringify(c.problems)}`);
      assert.equal(c.parts?.length ?? f.parts.length, f.parts.length);
      assert.ok(c.sale.total > 0);
    }
  }
});
