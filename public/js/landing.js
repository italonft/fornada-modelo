// Página inicial: calculadora de exemplo que usa as mesmas contas do app, e valores do plano vindos do servidor.
import { judge, makeEngine, suggestPrice } from './shared/calc.js';
import { brl, parseMoney, parseNum, pct } from './shared/format.js';
import { getConfig, rememberRef, track } from './lib/api.js';

rememberRef();
track('pagina');

const form = document.getElementById('calc');
const CHANNELS = [
  { id: 'direto', name: 'No Pix ou dinheiro', feePct: 0 },
  { id: 'cartao', name: 'Na maquininha (4%)', feePct: 4 },
  { id: 'ifood', name: 'No iFood (26,2%)', feePct: 26.2 },
];
const MESSAGES = {
  ok: 'O preço paga tudo, inclusive o seu tempo.',
  baixo: 'Paga tudo, mas o lucro fica abaixo de 20%.',
  tempo: 'Paga os ingredientes, mas não paga todo o seu tempo.',
  prejuizo: 'Não paga nem os ingredientes. Cada venda tira do seu bolso.',
  semPreco: 'Digite quanto você cobra.',
};

function setLcd(id, cents) {
  const box = document.getElementById(id);
  const ok = Number.isFinite(cents) && cents > 0;
  const v = ok ? (Math.round(cents) / 100).toFixed(2) : '-.--';
  box.querySelector('.lit').textContent = v;
  box.querySelector('.ghost').textContent = v.replace(/[0-9-]/g, '8');
}

function money(name) {
  const v = parseMoney(form.elements[name].value);
  return Number.isFinite(v) ? v : 0;
}
function number(name) {
  const v = parseNum(form.elements[name].value);
  return Number.isFinite(v) ? v : 0;
}

function update() {
  const items = [
    { id: 'condensado', name: 'Leite condensado', unit: 'g', pkgQty: 395, pkgPrice: money('condensado'), cupG: 300 },
    { id: 'manteiga', name: 'Manteiga', unit: 'g', pkgQty: 200, pkgPrice: money('manteiga'), cupG: 200 },
    { id: 'chocolate', name: 'Chocolate em pó', unit: 'g', pkgQty: 200, pkgPrice: money('chocolate'), cupG: 90 },
    { id: 'forminha', name: 'Forminha', unit: 'un', pkgQty: 100, pkgPrice: money('forminha') },
  ];
  const yieldQty = Math.max(0, number('rende'));
  const ficha = {
    id: 'brigadeiro',
    name: 'Brigadeiro',
    yieldQty,
    yieldUnit: 'un',
    prepMin: number('minutos'),
    parts: [
      { t: 'i', id: 'condensado', qty: 1, unit: 'un' },
      { t: 'i', id: 'manteiga', qty: 1, unit: 'cs' },
      { t: 'i', id: 'chocolate', qty: 3, unit: 'cs' },
      { t: 'i', id: 'forminha', qty: yieldQty, unit: 'un' },
    ],
  };
  const hour = money('hora');
  const eng = makeEngine({ items, fichas: [ficha], settings: { wageCents: Math.round(hour * 100), hoursMonth: 100, fixed: [], marginPct: 20, taxPct: 0, rounding: '0.10' } });
  const c = eng.cost('brigadeiro');
  const total = c && yieldQty > 0 ? c.sale.total : NaN;
  setLcd('lcd-custo', total);
  const sug = suggestPrice(total, { marginPct: 20, rounding: '0.10' });
  setLcd('lcd-preco', sug.ok ? sug.cents : NaN);
  const dl = document.getElementById('canais');
  dl.replaceChildren(
    ...CHANNELS.map((ch) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = ch.name;
      const s = suggestPrice(total, { marginPct: 20, feePct: ch.feePct, rounding: '0.10' });
      dd.textContent = s.ok ? brl(s.cents) : '—';
      row.append(dt, dd);
      return row;
    }),
  );
  const price = parseMoney(form.elements.cobra.value);
  const v = judge(Number.isFinite(price) ? price : 0, c?.sale, { marginPct: 20 });
  const out = document.getElementById('veredito');
  const chip = document.createElement('span');
  chip.className = `chip ${{ ok: 'chip-good', baixo: 'chip-warn', tempo: 'chip-warn', prejuizo: 'chip-bad' }[v.status] || ''}`;
  chip.textContent = { ok: `Lucro de ${pct(v.margin)}`, baixo: `Lucro de ${pct(v.margin)}`, tempo: 'Não paga seu tempo', prejuizo: 'Prejuízo', semPreco: 'Sem preço' }[v.status];
  out.replaceChildren(chip, document.createTextNode(` ${MESSAGES[v.status]}`));
}

form.addEventListener('input', update);
form.addEventListener('submit', (e) => e.preventDefault());
update();

getConfig().then((c) => {
  const set = (sel, text) => document.querySelectorAll(sel).forEach((el) => (el.textContent = text));
  if (c.brand) set('[data-brand]', c.brand);
  set('[data-trial]', `${c.trialDays} ${c.trialDays === 1 ? 'dia' : 'dias'}`);
  set('[data-free-products]', String(c.freeProducts));
  set('[data-free-orders]', String(c.freeOrders));
  set('[data-refund]', String(c.refundDays));
  for (const p of c.plans || []) set(`[data-price-${p.id}]`, brl(p.cents));
});
