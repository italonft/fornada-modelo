// Contas da Fornada. Roda igual no navegador e no servidor (Cloudflare).
// Dinheiro guardado em centavos inteiros. Nas contas usamos frações e só arredondamos para mostrar ou guardar.
import { normSettings } from './schema.js';

export const CUP_ML = 240;

/** Medidas aceitas nas receitas. `f` converte para a base da dimensão: g, ml ou un. */
export const UNITS = {
  g: { dim: 'm', f: 1 },
  kg: { dim: 'm', f: 1000 },
  ml: { dim: 'v', f: 1 },
  l: { dim: 'v', f: 1000 },
  xic: { dim: 'v', f: CUP_ML },
  cs: { dim: 'v', f: 15 },
  cc: { dim: 'v', f: 5 },
  un: { dim: 'c', f: 1 },
  dz: { dim: 'c', f: 12 },
};
const BASE_DIM = { g: 'm', ml: 'v', un: 'c' };
const DIM_BASE = { m: 'g', v: 'ml', c: 'un' };
export const ITEM_UNITS = ['g', 'ml', 'un'];
export const YIELD_UNITS = ['un', 'g', 'kg', 'ml', 'l'];

export const baseOf = (unit) => DIM_BASE[UNITS[unit]?.dim] ?? null;

/** Quanto `qty` em `unit` vale na base do insumo (g, ml ou un). "un" de algo vendido em g ou ml é 1 embalagem. */
export function itemQty(item, qty, unit) {
  const u = UNITS[unit];
  if (!u || !item || !(qty >= 0)) return { ok: false, why: 'unidade' };
  const to = BASE_DIM[item.unit];
  const v = qty * u.f;
  if (u.dim === to) return { ok: true, v };
  if (u.dim === 'c' && (to === 'm' || to === 'v')) return item.pkgQty > 0 ? { ok: true, v: v * item.pkgQty } : { ok: false, why: 'embalagem' };
  if (to === 'c' && u.dim === 'm') return item.unitG > 0 ? { ok: true, v: v / item.unitG } : { ok: false, why: 'unitG' };
  if (to === 'm' && u.dim === 'v') return item.cupG > 0 ? { ok: true, v: (v * item.cupG) / CUP_ML } : { ok: false, why: 'cupG' };
  if (to === 'v' && u.dim === 'm') return item.cupG > 0 ? { ok: true, v: (v * CUP_ML) / item.cupG } : { ok: false, why: 'cupG' };
  return { ok: false, why: 'dim' };
}

/** Medidas que fazem sentido para um insumo, na ordem em que aparecem na tela. */
export function unitsForItem(item) {
  if (!item) return ['g'];
  if (item.unit === 'g') return item.cupG > 0 ? ['g', 'kg', 'xic', 'cs', 'cc', 'un'] : ['g', 'kg', 'un', 'xic', 'cs', 'cc'];
  if (item.unit === 'ml') return ['ml', 'l', 'xic', 'cs', 'cc', 'un', 'g', 'kg'];
  return item.unitG > 0 ? ['un', 'dz', 'g', 'kg'] : ['un', 'dz'];
}

export const unitPrice = (item) => (item && item.pkgQty > 0 ? (item.pkgPrice || 0) / item.pkgQty : 0);

export const yieldBase = (f) => (f.yieldQty || 0) * (UNITS[f.yieldUnit]?.f ?? 1);
export const effYield = (f) => yieldBase(f) * (1 - Math.min(90, Math.max(0, f.lossPct || 0)) / 100);
/** Unidade de venda: 1 un para o que rende em unidades; 1 kg ou 1 litro para o que rende em peso ou volume. */
export const saleFactor = (f) => (baseOf(f.yieldUnit) === 'un' ? 1 : 1000);

/** Quanto `qty` em `unit` vale na base do rendimento da ficha. Peso de 1 unidade permite usar por grama. */
export function fichaQty(f, qty, unit) {
  const u = UNITS[unit];
  if (!u || !f || !(qty >= 0)) return { ok: false, why: 'unidade' };
  const to = UNITS[f.yieldUnit]?.dim;
  const v = qty * u.f;
  if (u.dim === to) return { ok: true, v };
  const w = f.unitWeightG;
  if (to === 'c' && u.dim === 'm') return w > 0 ? { ok: true, v: v / w } : { ok: false, why: 'peso' };
  if (to === 'm' && u.dim === 'c') return w > 0 ? { ok: true, v: v * w } : { ok: false, why: 'peso' };
  return { ok: false, why: 'dim' };
}

export function unitsForFicha(f) {
  if (!f) return ['g'];
  const b = baseOf(f.yieldUnit);
  if (b === 'un') return f.unitWeightG > 0 ? ['un', 'dz', 'g', 'kg'] : ['un', 'dz'];
  if (b === 'g') return f.unitWeightG > 0 ? ['g', 'kg', 'un'] : ['g', 'kg'];
  return ['ml', 'l', 'xic', 'cs', 'cc'];
}

/** Problemas que deixam a conta errada (a linha fica de fora) e avisos (a conta sai, mas incompleta). */
export const BLOCKING = new Set(['sumiu', 'ciclo', 'unidade', 'dim', 'cupG', 'unitG', 'peso', 'embalagem']);

export function hourRates(settings) {
  const s = normSettings(settings);
  const fixedTotal = s.fixed.reduce((a, x) => a + x.cents, 0);
  return {
    s,
    fixedTotal,
    hour: s.hoursMonth > 0 ? s.wageCents / s.hoursMonth : 0,
    fixedHour: s.hoursMonth > 0 ? fixedTotal / s.hoursMonth : 0,
  };
}

/** Custo de cada ficha: ingredientes e embalagens, seu tempo e a parte dos custos fixos. */
export function makeEngine({ items = [], fichas = [], settings = {} } = {}) {
  const { s, fixedTotal, hour, fixedHour } = hourRates(settings);
  const I = new Map(items.map((i) => [i.id, i]));
  const F = new Map(fichas.map((f) => [f.id, f]));
  const memo = new Map();

  function cost(id, stack = []) {
    if (memo.has(id)) return memo.get(id);
    const f = F.get(id);
    if (!f) return null;
    const st = [...stack, id];
    const lines = [];
    const problems = [];
    const prep = Math.max(0, f.prepMin || 0);
    let mat = 0;
    let lab = (prep / 60) * hour;
    let fix = (prep / 60) * fixedHour;
    let min = prep;
    (f.parts || []).forEach((p, idx) => {
      if (p.t === 'i') {
        const it = I.get(p.id);
        if (!it) {
          problems.push({ idx, why: 'sumiu', name: '' });
          lines.push({ idx, t: 'i', id: p.id, name: 'Ingrediente apagado', q: 0, mat: 0, lab: 0, fix: 0, min: 0, bad: true });
          return;
        }
        const q = itemQty(it, p.qty, p.unit);
        if (!q.ok) {
          problems.push({ idx, why: q.why, name: it.name });
          lines.push({ idx, t: 'i', id: it.id, name: it.name, kind: it.kind, q: 0, mat: 0, lab: 0, fix: 0, min: 0, bad: true });
          return;
        }
        const c = q.v * unitPrice(it);
        if (!(it.pkgPrice > 0)) problems.push({ idx, why: 'semPreco', name: it.name });
        mat += c;
        lines.push({ idx, t: 'i', id: it.id, name: it.name, kind: it.kind, base: it.unit, q: q.v, mat: c, lab: 0, fix: 0, min: 0 });
        return;
      }
      const ch = F.get(p.id);
      if (!ch) {
        problems.push({ idx, why: 'sumiu', name: '' });
        lines.push({ idx, t: 'f', id: p.id, name: 'Receita apagada', q: 0, mat: 0, lab: 0, fix: 0, min: 0, bad: true });
        return;
      }
      if (st.includes(ch.id)) {
        problems.push({ idx, why: 'ciclo', name: ch.name });
        lines.push({ idx, t: 'f', id: ch.id, name: ch.name, q: 0, mat: 0, lab: 0, fix: 0, min: 0, bad: true });
        return;
      }
      const q = fichaQty(ch, p.qty, p.unit);
      if (!q.ok) {
        problems.push({ idx, why: q.why, name: ch.name });
        lines.push({ idx, t: 'f', id: ch.id, name: ch.name, q: 0, mat: 0, lab: 0, fix: 0, min: 0, bad: true });
        return;
      }
      const cc = cost(ch.id, st);
      const k = q.v;
      const l = { idx, t: 'f', id: ch.id, name: ch.name, base: cc.base, q: k, mat: k * cc.unit.mat, lab: k * cc.unit.lab, fix: k * cc.unit.fix, min: k * cc.unit.min };
      mat += l.mat;
      lab += l.lab;
      fix += l.fix;
      min += l.min;
      if (cc.problems.length) problems.push({ idx, why: cc.problems.some((x) => BLOCKING.has(x.why) || x.why === 'filhaErro') ? 'filhaErro' : 'filha', name: ch.name });
      lines.push(l);
    });
    const y = effYield(f);
    if (!(y > 0)) problems.push({ idx: -1, why: 'rendimento', name: f.name });
    const per = (x) => (y > 0 ? x / y : 0);
    const unit = { mat: per(mat), lab: per(lab), fix: per(fix), min: per(min) };
    unit.total = unit.mat + unit.lab + unit.fix;
    const factor = saleFactor(f);
    const sale = { factor, mat: unit.mat * factor, lab: unit.lab * factor, fix: unit.fix * factor, min: unit.min * factor, total: unit.total * factor };
    const r = {
      id,
      name: f.name,
      base: baseOf(f.yieldUnit),
      effYield: y,
      batch: { mat, lab, fix, min, total: mat + lab + fix },
      unit,
      sale,
      lines,
      problems,
      blocking: problems.some((x) => BLOCKING.has(x.why) || x.why === 'rendimento' || x.why === 'filhaErro'),
    };
    memo.set(id, r);
    return r;
  }

  return { settings: s, fixedTotal, hour, fixedHour, items: I, fichas: F, cost };
}

/** Arredonda para cima: R$ 0,10, R$ 0,50, R$ 1,00 ou terminando em ,90. */
export function roundPrice(cents, mode) {
  const c = Math.ceil(cents - 1e-6);
  if (mode === '0.10') return Math.ceil(c / 10) * 10;
  if (mode === '0.50') return Math.ceil(c / 50) * 50;
  if (mode === '1.00') return Math.ceil(c / 100) * 100;
  if (mode === '0.90') return Math.max(0, Math.ceil((c - 90) / 100)) * 100 + 90;
  return c;
}

/**
 * Preço que paga tudo e ainda deixa o lucro desejado.
 * As taxas e o imposto são porcentagem do preço, então dividimos: preço = custo / (1 - lucro - imposto - taxa).
 */
export function suggestPrice(costCents, { marginPct = 0, taxPct = 0, feePct = 0, rounding = 'nenhum' } = {}) {
  const denom = 1 - (marginPct + taxPct + feePct) / 100;
  if (denom < 0.05) return { ok: false, why: 'taxas' };
  if (!(costCents > 0)) return { ok: false, why: 'semCusto' };
  return { ok: true, cents: roundPrice(costCents / denom, rounding), raw: costCents / denom };
}

/** O que sobra de verdade a um preço: depois de taxa e imposto, de ingredientes, do seu tempo e dos custos fixos. */
export function judge(priceCents, sale, { taxPct = 0, feePct = 0, marginPct = 0 } = {}) {
  if (!(priceCents > 0) || !sale) return { status: 'semPreco', net: 0, profit: 0, margin: 0, contribution: 0 };
  const net = priceCents * (1 - (taxPct + feePct) / 100);
  const profit = net - sale.total;
  const margin = (profit / priceCents) * 100;
  let status = 'ok';
  if (net < sale.mat) status = 'prejuizo';
  else if (profit < 0) status = 'tempo';
  else if (margin < marginPct - 0.5) status = 'baixo';
  return { status, net, profit, margin, contribution: net - sale.mat };
}

/** Preço sugerido e preço praticado em cada canal (direto, maquininha, iFood...). */
export function channelTable(eng, ficha) {
  const s = eng.settings;
  const c = eng.cost(ficha.id);
  if (!c) return [];
  const base = ficha.sell?.price || 0;
  return s.channels.map((ch) => {
    const own = ficha.sell?.prices?.[ch.id];
    const price = own > 0 ? own : base;
    const sug = suggestPrice(c.sale.total, { marginPct: s.marginPct, taxPct: s.taxPct, feePct: ch.feePct, rounding: s.rounding });
    return { channel: ch, suggested: sug, price, own: own > 0, verdict: judge(price, c.sale, { taxPct: s.taxPct, feePct: ch.feePct, marginPct: s.marginPct }) };
  });
}

/** Produtos à venda que perderam dinheiro ou ficaram abaixo da meta, do pior para o melhor. */
export function alerts(eng, fichas) {
  const rank = { prejuizo: 0, tempo: 1, baixo: 2 };
  const out = [];
  for (const f of fichas) {
    if (!f.sell?.on) continue;
    const c = eng.cost(f.id);
    if (!c || c.blocking) continue;
    for (const row of channelTable(eng, f)) {
      if (!(row.price > 0)) continue;
      const st = row.verdict.status;
      if (st in rank) out.push({ ficha: f, channel: row.channel, status: st, verdict: row.verdict, suggested: row.suggested, price: row.price });
    }
  }
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.verdict.margin - b.verdict.margin);
}

// ---------- Pedidos ----------

export const STATUSES = ['orcamento', 'confirmado', 'pronto', 'entregue', 'cancelado'];
export const OPEN_STATUSES = ['orcamento', 'confirmado', 'pronto'];

/** Totais de um pedido. A taxa de entrega cobre a entrega: entra no total, mas não no lucro. */
export function orderMath(o) {
  let items = 0;
  let mat = 0;
  let min = 0;
  for (const it of o.items || []) {
    items += (it.qty || 0) * (it.price || 0);
    mat += (it.qty || 0) * (it.cost || 0);
    min += (it.qty || 0) * (it.min || 0);
  }
  items = Math.round(items);
  const delivery = Math.max(0, o.deliveryFee || 0);
  const discount = Math.min(Math.max(0, o.discount || 0), items + delivery);
  const total = items + delivery - discount;
  const fee = (total * (o.feePct || 0)) / 100;
  const tax = (total * (o.taxPct || 0)) / 100;
  const paid = Math.max(0, o.paid || 0);
  const revenue = total - delivery;
  return { items, delivery, discount, total, revenue, fee, tax, mat, min, contribution: revenue - fee - tax - mat, paid, due: Math.max(0, total - paid) };
}

/** Custo e tempo de 1 unidade de venda de uma ficha, para guardar no pedido. */
export function itemSnapshot(eng, fichaId) {
  const c = fichaId ? eng.cost(fichaId) : null;
  if (!c) return { cost: 0, min: 0 };
  return { cost: Math.round(c.sale.mat), min: Math.round(c.sale.min * 100) / 100 };
}

// ---------- Lista de compras e produção ----------

/**
 * Explode os pedidos em receitas e ingredientes. `orders` já filtrados pelo período.
 * Devolve o que produzir (cada ficha, quantas receitas) e o que comprar (embalagens a comprar e custo).
 */
export function shoppingList(eng, orders) {
  const fichaNeed = new Map();
  const itemNeed = new Map();
  const products = new Map();
  const problems = [];

  function addFicha(id, base, depth) {
    const f = eng.fichas.get(id);
    if (!f) return;
    if (depth > 12) {
      problems.push({ why: 'ciclo', name: f.name });
      return;
    }
    fichaNeed.set(id, (fichaNeed.get(id) || 0) + base);
    const y = effYield(f);
    if (!(y > 0)) {
      problems.push({ why: 'rendimento', name: f.name });
      return;
    }
    const batches = base / y;
    for (const p of f.parts || []) {
      if (p.t === 'i') {
        const it = eng.items.get(p.id);
        if (!it) continue;
        const q = itemQty(it, p.qty, p.unit);
        if (!q.ok) {
          problems.push({ why: q.why, name: it.name });
          continue;
        }
        itemNeed.set(it.id, (itemNeed.get(it.id) || 0) + q.v * batches);
      } else {
        const ch = eng.fichas.get(p.id);
        if (!ch) continue;
        const q = fichaQty(ch, p.qty, p.unit);
        if (!q.ok) {
          problems.push({ why: q.why, name: ch.name });
          continue;
        }
        addFicha(ch.id, q.v * batches, depth + 1);
      }
    }
  }

  for (const o of orders) {
    for (const it of o.items || []) {
      const f = it.f ? eng.fichas.get(it.f) : null;
      const key = f ? f.id : `livre:${it.name}`;
      const row = products.get(key) || { id: f?.id || '', name: f ? f.name : it.name, qty: 0, factor: f ? saleFactor(f) : 1, free: !f };
      row.qty += it.qty || 0;
      products.set(key, row);
      if (f) addFicha(f.id, (it.qty || 0) * saleFactor(f), 0);
    }
  }

  const production = [...fichaNeed.entries()].map(([id, base]) => {
    const f = eng.fichas.get(id);
    const y = effYield(f);
    return { id, name: f.name, base: baseOf(f.yieldUnit), need: base, batches: y > 0 ? base / y : 0, yieldQty: f.yieldQty, yieldUnit: f.yieldUnit, sold: Boolean(f.sell?.on) };
  });
  production.sort((a, b) => Number(a.sold) - Number(b.sold) || a.name.localeCompare(b.name, 'pt-BR'));

  let total = 0;
  const shopping = [...itemNeed.entries()].map(([id, need]) => {
    const it = eng.items.get(id);
    const stock = Math.max(0, it.stock || 0);
    const buy = Math.max(0, need - stock);
    const packages = it.pkgQty > 0 ? Math.ceil(buy / it.pkgQty - 1e-9) : 0;
    const spend = packages * (it.pkgPrice || 0);
    total += spend;
    return { id, name: it.name, kind: it.kind, base: it.unit, need, stock, buy, packages, pkgQty: it.pkgQty, spend, used: need * unitPrice(it), noPrice: !(it.pkgPrice > 0) };
  });
  const kindOrder = { ing: 0, emb: 1, out: 2 };
  shopping.sort((a, b) => (kindOrder[a.kind] ?? 3) - (kindOrder[b.kind] ?? 3) || a.name.localeCompare(b.name, 'pt-BR'));
  const uniq = new Map(problems.map((p) => [`${p.why}:${p.name}`, p]));
  return { products: [...products.values()], production, shopping, total, problems: [...uniq.values()] };
}

// ---------- Lucro do mês ----------

export function monthOf(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

/** Relatório de um mês: pedidos entregues com data de entrega no mês. */
export function monthReport(orders, settings, month) {
  const { s, fixedTotal } = hourRates(settings);
  const done = orders.filter((o) => o.status === 'entregue' && monthOf(o.dueDate) === month);
  const sum = { count: done.length, revenue: 0, delivery: 0, discount: 0, fee: 0, tax: 0, mat: 0, min: 0, contribution: 0, received: 0 };
  const byProduct = new Map();
  const byChannel = new Map();
  for (const o of done) {
    const m = orderMath(o);
    sum.revenue += m.revenue;
    sum.delivery += m.delivery;
    sum.discount += m.discount;
    sum.fee += m.fee;
    sum.tax += m.tax;
    sum.mat += m.mat;
    sum.min += m.min;
    sum.contribution += m.contribution;
    sum.received += Math.min(m.paid, m.total);
    const ch = byChannel.get(o.channel || 'direto') || { id: o.channel || 'direto', count: 0, revenue: 0, fee: 0, contribution: 0 };
    ch.count += 1;
    ch.revenue += m.revenue;
    ch.fee += m.fee;
    ch.contribution += m.contribution;
    byChannel.set(ch.id, ch);
    // Desconto, taxa e imposto divididos entre os itens na proporção do valor de cada um.
    const shareBase = m.items || 1;
    for (const it of o.items || []) {
      const gross = (it.qty || 0) * (it.price || 0);
      const share = gross / shareBase;
      const rev = gross - m.discount * share;
      const key = it.f || `livre:${it.name}`;
      const row = byProduct.get(key) || { key, id: it.f || '', name: it.name, qty: 0, revenue: 0, mat: 0, contribution: 0 };
      row.qty += it.qty || 0;
      row.revenue += rev;
      row.mat += (it.qty || 0) * (it.cost || 0);
      row.contribution += rev - (m.fee + m.tax) * (m.revenue > 0 ? rev / m.revenue : 0) - (it.qty || 0) * (it.cost || 0);
      byProduct.set(key, row);
    }
  }
  const earnings = sum.contribution - fixedTotal;
  const hours = sum.min / 60;
  return {
    month,
    ...sum,
    fixed: fixedTotal,
    earnings,
    wage: s.wageCents,
    afterWage: earnings - s.wageCents,
    hours,
    perHour: hours > 0 ? earnings / hours : null,
    byProduct: [...byProduct.values()].sort((a, b) => b.contribution - a.contribution),
    byChannel: [...byChannel.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

/** Quanto falta receber dos pedidos que ainda não foram cancelados. */
export function receivable(orders) {
  let due = 0;
  let count = 0;
  for (const o of orders) {
    if (o.status === 'cancelado' || o.status === 'orcamento') continue;
    const m = orderMath(o);
    if (m.due > 0) {
      due += m.due;
      count += 1;
    }
  }
  return { due, count };
}
