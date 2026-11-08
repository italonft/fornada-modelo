// Formato e limites dos dados. O servidor usa para validar; o navegador, para preencher o que falta.

export const ID_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
const ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';

export function newId(len = 10) {
  const out = [];
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < 248 && out.length < len) out.push(ALPHA[b % 31]);
    }
  }
  return out.join('');
}

export const SEGMENTS = ['confeitaria', 'salgados', 'marmitas', 'outro'];
export const ROUNDINGS = ['nenhum', '0.10', '0.50', '1.00', '0.90'];
export const KINDS = ['ing', 'emb', 'out'];
export const DELIVERY = ['retirada', 'entrega'];
export const MENU_DELIVERY = ['retirada', 'entrega', 'ambos'];
const ORDER_STATUSES = ['orcamento', 'confirmado', 'pronto', 'entregue', 'cancelado'];
const PART_UNITS = ['g', 'kg', 'ml', 'l', 'xic', 'cs', 'cc', 'un', 'dz'];

export const LIMITS = { items: 400, fichas: 300, parts: 80, orderItems: 60, channels: 8, fixed: 20 };

export class Invalid extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

/** Texto limpo: sem caracteres de controle, espaços repetidos nem pontas. */
export function cleanText(v, max, { lines = false } = {}) {
  let s = String(v ?? '').normalize('NFC');
  s = lines ? s.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '') : s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ');
  s = s.trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

function num(v, min, max, def, field, label) {
  if (v === undefined || v === null || v === '') return def;
  const x = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(x)) throw new Invalid(field, `${label}: digite um número.`);
  if (x < min || x > max) throw new Invalid(field, `${label}: use um valor entre ${String(min).replace('.', ',')} e ${String(max).replace('.', ',')}.`);
  return x;
}
const cents = (v, max, def, field, label) => Math.round(num(v, 0, max, def, field, label));
const pick = (v, list, def) => (list.includes(v) ? v : def);
export const digits = (v, max = 13) => String(v ?? '').replace(/\D/g, '').slice(0, max);
const dec = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

export const DEFAULT_CHANNELS = [
  { id: 'direto', name: 'Direto (Pix ou dinheiro)', feePct: 0 },
  { id: 'cartao', name: 'Maquininha (crédito)', feePct: 4 },
  { id: 'ifood', name: 'iFood (plano Entrega)', feePct: 26.2 },
];

/** Configurações do negócio, sempre completas. Valores fora do limite voltam ao padrão. */
export function normSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const safe = (fn, def) => {
    try {
      return fn();
    } catch {
      return def;
    }
  };
  const fixed = Array.isArray(r.fixed)
    ? r.fixed
        .slice(0, LIMITS.fixed)
        .map((x) => ({ name: cleanText(x?.name, 40), cents: safe(() => cents(x?.cents, 100000000, 0), 0) }))
        .filter((x) => x.name || x.cents)
    : [];
  let channels = Array.isArray(r.channels)
    ? r.channels
        .slice(0, LIMITS.channels)
        .map((x) => ({ id: String(x?.id ?? '').replace(/[^a-z0-9]/g, '').slice(0, 12), name: cleanText(x?.name, 30), feePct: dec(safe(() => num(x?.feePct, 0, 60, 0), 0), 2) }))
        .filter((x) => x.id && x.name)
    : [];
  const seen = new Set();
  channels = channels.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
  if (!channels.length) channels = DEFAULT_CHANNELS.map((c) => ({ ...c }));
  if (channels[0].id !== 'direto') {
    const d = channels.find((c) => c.id === 'direto') || { ...DEFAULT_CHANNELS[0] };
    channels = [d, ...channels.filter((c) => c.id !== 'direto')];
  }
  const m = r.menu && typeof r.menu === 'object' ? r.menu : {};
  return {
    segment: pick(r.segment, SEGMENTS, 'confeitaria'),
    wageCents: safe(() => cents(r.wageCents, 100000000, 200000), 200000),
    hoursMonth: dec(safe(() => num(r.hoursMonth, 1, 744, 130), 130), 1),
    fixed,
    marginPct: dec(safe(() => num(r.marginPct, 0, 90, 20), 20), 1),
    taxPct: dec(safe(() => num(r.taxPct, 0, 50, 0), 0), 2),
    rounding: pick(r.rounding, ROUNDINGS, '0.10'),
    channels,
    pixKey: cleanText(r.pixKey, 80),
    pixName: cleanText(r.pixName, 60),
    whatsapp: digits(r.whatsapp),
    instagram: String(r.instagram ?? '').replace(/^@/, '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30),
    city: cleanText(r.city, 40),
    menu: {
      on: m.on !== false,
      note: cleanText(m.note, 300, { lines: true }),
      leadDays: Math.round(safe(() => num(m.leadDays, 0, 60, 1), 1)),
      delivery: pick(m.delivery, MENU_DELIVERY, 'ambos'),
      deliveryNote: cleanText(m.deliveryNote, 140),
      minOrder: safe(() => cents(m.minOrder, 10000000, 0), 0),
    },
    setupDone: Boolean(r.setupDone),
  };
}

/** Validação estrita das configurações que a pessoa enviou (mensagens claras), depois normaliza. */
export function checkSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  cents(r.wageCents, 100000000, 0, 'wageCents', 'Quanto quer ganhar por mês');
  num(r.hoursMonth, 1, 744, 1, 'hoursMonth', 'Horas de trabalho por mês');
  num(r.marginPct, 0, 90, 0, 'marginPct', 'Lucro desejado');
  num(r.taxPct, 0, 50, 0, 'taxPct', 'Imposto sobre a venda');
  if (Array.isArray(r.channels)) r.channels.forEach((c, i) => num(c?.feePct, 0, 60, 0, `channels.${i}`, `Taxa de ${cleanText(c?.name, 30) || 'canal'}`));
  if (Array.isArray(r.fixed)) r.fixed.forEach((x, i) => cents(x?.cents, 100000000, 0, `fixed.${i}`, cleanText(x?.name, 40) || 'Custo fixo'));
  const wa = digits(r.whatsapp);
  if (wa && (wa.length < 10 || wa.length > 13)) throw new Invalid('whatsapp', 'WhatsApp: use DDD e número, como 11 98765-4321.');
  const s = normSettings(r);
  const marginPlusFees = s.marginPct + s.taxPct + Math.max(...s.channels.map((c) => c.feePct));
  if (marginPlusFees >= 95) throw new Invalid('marginPct', 'Lucro, imposto e taxa somados passam de 95% do preço. Diminua algum deles.');
  return s;
}

export function checkItem(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = String(r.id ?? '');
  if (!ID_RE.test(id)) throw new Invalid('id', 'Identificador inválido.');
  const name = cleanText(r.name, 60);
  if (!name) throw new Invalid('name', 'Dê um nome ao ingrediente.');
  const unit = pick(r.unit, ['g', 'ml', 'un'], null);
  if (!unit) throw new Invalid('unit', 'Escolha como você compra: em gramas, mililitros ou unidades.');
  const pkgQty = num(r.pkgQty, 0.001, 10000000, null, 'pkgQty', 'Tamanho da embalagem');
  if (!(pkgQty > 0)) throw new Invalid('pkgQty', 'Informe o tamanho da embalagem.');
  return {
    id,
    name,
    kind: pick(r.kind, KINDS, 'ing'),
    unit,
    pkgQty: dec(pkgQty, 3),
    pkgPrice: cents(r.pkgPrice, 100000000, 0, 'pkgPrice', 'Preço da embalagem'),
    cupG: dec(num(r.cupG, 0, 5000, 0, 'cupG', 'Peso de 1 xícara'), 1),
    unitG: dec(num(r.unitG, 0, 100000, 0, 'unitG', 'Peso de 1 unidade'), 1),
    stock: dec(num(r.stock, 0, 1000000000, 0, 'stock', 'Estoque'), 3),
    note: cleanText(r.note, 120),
  };
}

export function checkFicha(raw, channelIds = ['direto']) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = String(r.id ?? '');
  if (!ID_RE.test(id)) throw new Invalid('id', 'Identificador inválido.');
  const name = cleanText(r.name, 60);
  if (!name) throw new Invalid('name', 'Dê um nome à receita.');
  const yieldUnit = pick(r.yieldUnit, ['un', 'g', 'kg', 'ml', 'l'], null);
  if (!yieldUnit) throw new Invalid('yieldUnit', 'Escolha em que a receita rende: unidades, gramas, quilos, ml ou litros.');
  const yieldQty = num(r.yieldQty, 0.001, 1000000, null, 'yieldQty', 'Rendimento');
  if (!(yieldQty > 0)) throw new Invalid('yieldQty', 'Diga quanto a receita rende.');
  const parts = Array.isArray(r.parts) ? r.parts : [];
  if (parts.length > LIMITS.parts) throw new Invalid('parts', `Use até ${LIMITS.parts} itens por receita.`);
  const cleanParts = parts.map((p, i) => {
    const t = p?.t === 'f' ? 'f' : 'i';
    const pid = String(p?.id ?? '');
    if (!ID_RE.test(pid)) throw new Invalid(`parts.${i}`, `Item ${i + 1}: escolha um ingrediente ou receita.`);
    if (t === 'f' && pid === id) throw new Invalid(`parts.${i}`, 'Uma receita não pode usar ela mesma.');
    const qty = num(p?.qty, 0.0001, 10000000, null, `parts.${i}`, `Quantidade do item ${i + 1}`);
    if (!(qty > 0)) throw new Invalid(`parts.${i}`, `Item ${i + 1}: informe a quantidade.`);
    const unit = pick(p?.unit, PART_UNITS, null);
    if (!unit) throw new Invalid(`parts.${i}`, `Item ${i + 1}: escolha a medida.`);
    return { t, id: pid, qty: dec(qty, 4), unit };
  });
  const s = r.sell && typeof r.sell === 'object' ? r.sell : {};
  const prices = {};
  if (s.prices && typeof s.prices === 'object') {
    for (const ch of channelIds) {
      const v = cents(s.prices[ch], 100000000, 0, `sell.prices.${ch}`, 'Preço no canal');
      if (v > 0 && ch !== 'direto') prices[ch] = v;
    }
  }
  const m = r.menu && typeof r.menu === 'object' ? r.menu : {};
  const photo = String(m.photo ?? '');
  return {
    id,
    name,
    yieldQty: dec(yieldQty, 3),
    yieldUnit,
    unitWeightG: dec(num(r.unitWeightG, 0, 1000000, 0, 'unitWeightG', 'Peso de 1 unidade'), 2),
    lossPct: dec(num(r.lossPct, 0, 90, 0, 'lossPct', 'Perda'), 1),
    prepMin: Math.round(num(r.prepMin, 0, 100000, 0, 'prepMin', 'Tempo de trabalho')),
    parts: cleanParts,
    sell: {
      on: Boolean(s.on),
      label: cleanText(s.label, 20),
      price: cents(s.price, 100000000, 0, 'sell.price', 'Seu preço'),
      prices,
    },
    menu: {
      on: Boolean(m.on),
      cat: cleanText(m.cat, 30),
      desc: cleanText(m.desc, 240, { lines: true }),
      photo: /^[23456789abcdefghjkmnpqrstuvwxyz]{16}$/.test(photo) ? photo : '',
    },
    notes: cleanText(r.notes, 3000, { lines: true }),
  };
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const validDate = (s) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

export function checkOrder(raw, channelIds = ['direto']) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = String(r.id ?? '');
  if (!ID_RE.test(id)) throw new Invalid('id', 'Identificador inválido.');
  const dueDate = String(r.dueDate ?? '');
  if (!validDate(dueDate)) throw new Invalid('dueDate', 'Escolha a data de entrega.');
  const dueTime = String(r.dueTime ?? '');
  if (dueTime && !TIME_RE.test(dueTime)) throw new Invalid('dueTime', 'Horário inválido.');
  const items = Array.isArray(r.items) ? r.items : [];
  if (!items.length) throw new Invalid('items', 'Coloque pelo menos um item no pedido.');
  if (items.length > LIMITS.orderItems) throw new Invalid('items', `Use até ${LIMITS.orderItems} itens por pedido.`);
  const cleanItems = items.map((it, i) => {
    const f = String(it?.f ?? '');
    if (f && !ID_RE.test(f)) throw new Invalid(`items.${i}`, `Item ${i + 1}: produto inválido.`);
    const name = cleanText(it?.name, 80);
    if (!name) throw new Invalid(`items.${i}`, `Item ${i + 1}: escolha um produto ou escreva o nome.`);
    const qty = num(it?.qty, 0.001, 100000, null, `items.${i}`, `Quantidade do item ${i + 1}`);
    if (!(qty > 0)) throw new Invalid(`items.${i}`, `Item ${i + 1}: informe a quantidade.`);
    return {
      f,
      name,
      qty: dec(qty, 3),
      price: cents(it?.price, 100000000, 0, `items.${i}`, `Preço do item ${i + 1}`),
      cost: cents(it?.cost, 100000000, 0, `items.${i}`, `Custo do item ${i + 1}`),
      min: dec(num(it?.min, 0, 100000, 0, `items.${i}`, 'Tempo'), 2),
    };
  });
  const delivery = pick(r.delivery, DELIVERY, 'retirada');
  const channel = channelIds.includes(r.channel) ? r.channel : 'direto';
  return {
    id,
    customer: cleanText(r.customer, 60),
    phone: digits(r.phone),
    dueDate,
    dueTime,
    delivery,
    address: delivery === 'entrega' ? cleanText(r.address, 200, { lines: true }) : '',
    deliveryFee: cents(r.deliveryFee, 10000000, 0, 'deliveryFee', 'Taxa de entrega'),
    discount: cents(r.discount, 100000000, 0, 'discount', 'Desconto'),
    channel,
    items: cleanItems,
    paid: cents(r.paid, 1000000000, 0, 'paid', 'Valor recebido'),
    status: pick(r.status, ORDER_STATUSES, 'confirmado'),
    notes: cleanText(r.notes, 1000, { lines: true }),
  };
}

/** Pedido que chega pelo cardápio: só o que o cliente pode escolher. Preço vem do servidor. */
export function checkMenuOrder(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const name = cleanText(r.name, 60);
  if (!name) throw new Invalid('name', 'Digite seu nome.');
  const phone = digits(r.phone);
  if (phone.length < 10 || phone.length > 13) throw new Invalid('phone', 'Digite seu WhatsApp com DDD.');
  const date = String(r.date ?? '');
  if (!validDate(date)) throw new Invalid('date', 'Escolha para quando você quer.');
  const time = String(r.time ?? '');
  if (time && !TIME_RE.test(time)) throw new Invalid('time', 'Horário inválido.');
  const delivery = pick(r.delivery, DELIVERY, 'retirada');
  const address = delivery === 'entrega' ? cleanText(r.address, 200, { lines: true }) : '';
  if (delivery === 'entrega' && address.length < 5) throw new Invalid('address', 'Digite o endereço de entrega.');
  const items = Array.isArray(r.items) ? r.items : [];
  if (!items.length) throw new Invalid('items', 'Escolha pelo menos um produto.');
  if (items.length > 30) throw new Invalid('items', 'Escolha até 30 produtos diferentes.');
  const clean = items.map((it, i) => {
    const id = String(it?.id ?? '');
    if (!ID_RE.test(id)) throw new Invalid('items', 'Produto inválido.');
    const qty = num(it?.qty, 0.001, 1000, null, 'items', `Quantidade do item ${i + 1}`);
    if (!(qty > 0)) throw new Invalid('items', 'Quantidade inválida.');
    return { id, qty: dec(qty, 3) };
  });
  return { name, phone, date, time, delivery, address, notes: cleanText(r.notes, 500, { lines: true }), items: clean };
}
