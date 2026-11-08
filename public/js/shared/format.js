// Dinheiro, quantidades, datas e telefone no jeito brasileiro. Datas sempre como texto AAAA-MM-DD,
// sem depender do fuso do aparelho; "hoje" é calculado no horário de Brasília.

export const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WD_SHORT = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const DAY_MS = 86400000;
export const TZ = -180;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseDate(s) {
  const m = DATE_RE.exec(String(s ?? ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { y, mo, d, t };
}

export function today(now = Date.now(), tz = TZ) {
  return new Date(now + tz * 60000).toISOString().slice(0, 10);
}

export function addDays(date, n) {
  const d = parseDate(date);
  return d ? new Date(d.t + n * DAY_MS).toISOString().slice(0, 10) : '';
}

export function daysBetween(a, b) {
  const x = parseDate(a);
  const y = parseDate(b);
  return x && y ? Math.round((y.t - x.t) / DAY_MS) : null;
}

export function weekday(date) {
  const d = parseDate(date);
  return d ? new Date(d.t).getUTCDay() : null;
}

export function shortDate(date) {
  const d = parseDate(date);
  return d ? `${String(d.d).padStart(2, '0')}/${String(d.mo).padStart(2, '0')}` : '';
}

export function longDate(date) {
  const d = parseDate(date);
  if (!d) return '';
  return `${WEEKDAYS[new Date(d.t).getUTCDay()]}, ${d.d} de ${MONTHS[d.mo - 1]}`;
}

/** "Hoje", "Amanhã", "Ontem" ou "sáb., 14/11". */
export function dayLabel(date, ref = today()) {
  const n = daysBetween(ref, date);
  if (n === 0) return 'Hoje';
  if (n === 1) return 'Amanhã';
  if (n === -1) return 'Ontem';
  const w = weekday(date);
  return w === null ? '' : `${WD_SHORT[w]}, ${shortDate(date)}`;
}

export function timeText(time) {
  const m = TIME_RE.exec(String(time ?? ''));
  if (!m) return '';
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return mi ? `${h}h${String(mi).padStart(2, '0')}` : `${h}h`;
}

export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} de ${m[1]}` : '';
}

export function addMonths(ym, n) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ''));
  if (!m) return '';
  const idx = Number(m[1]) * 12 + Number(m[2]) - 1 + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function monthRange(ym) {
  const next = addMonths(ym, 1);
  return { from: `${ym}-01`, to: addDays(`${next}-01`, -1) };
}

// ---------- Números e dinheiro ----------

const groups = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function brl(cents, { sign = false } = {}) {
  const v = Math.round(Number(cents) || 0);
  const abs = Math.abs(v);
  const s = `R$ ${groups(String(Math.floor(abs / 100)))},${String(abs % 100).padStart(2, '0')}`;
  if (v < 0) return `-${s}`;
  return sign && v > 0 ? `+${s}` : s;
}

/** Número com vírgula, até `max` casas, sem zeros sobrando: 1,5 / 0,25 / 1.200. */
export function fmtNum(x, max = 2) {
  if (!Number.isFinite(x)) return '';
  const r = Math.round(x * 10 ** max) / 10 ** max;
  const [i, d = ''] = Math.abs(r).toFixed(max).split('.');
  const dd = d.replace(/0+$/, '');
  return `${r < 0 ? '-' : ''}${groups(i)}${dd ? `,${dd}` : ''}`;
}

export const pct = (x, max = 0) => `${fmtNum(x, max)}%`;

/** "6,49", "R$ 1.234,50", "10" → centavos. Vazio → null. Inválido → NaN. */
export function parseMoney(s) {
  let t = String(s ?? '').replace(/R\$|\s/g, '');
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}

/** "1,5", "1.200" (milhar), "0.25" → número. Vazio → null. Inválido → NaN. */
export function parseNum(s) {
  let t = String(s ?? '').replace(/\s/g, '');
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return NaN;
  return Number(t);
}

/** Valor em centavos para um campo de texto: 649 → "6,49"; 0 → "". */
export const moneyInput = (cents) => (cents > 0 ? (cents / 100).toFixed(2).replace('.', ',') : '');
export const numInput = (x, max = 3) => (x > 0 ? fmtNum(x, max).replace(/\./g, '') : '');

/** Quantidade na base (g, ml, un) com a unidade mais legível: 1.250 g → "1,25 kg". */
export function qtyText(v, base) {
  if (!Number.isFinite(v)) return '';
  if (base === 'g') return v >= 1000 ? `${fmtNum(v / 1000, 2)} kg` : `${fmtNum(v, v < 100 ? 1 : 0)} g`;
  if (base === 'ml') return v >= 1000 ? `${fmtNum(v / 1000, 2)} L` : `${fmtNum(v, v < 100 ? 1 : 0)} ml`;
  return `${fmtNum(v, 2)} un`;
}

export const UNIT_LABEL = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'litro',
  xic: 'xícara',
  cs: 'colher de sopa',
  cc: 'colher de chá',
  un: 'unidade',
  dz: 'dúzia',
};

/** Rótulo curto da unidade de venda: "un", "kg" ou "l". */
export const saleUnitShort = (yieldUnit) => ({ un: 'un', g: 'kg', kg: 'kg', ml: 'l', l: 'l' })[yieldUnit] || 'un';

// ---------- Telefone e WhatsApp ----------

/** Telefone brasileiro com DDD: só os dígitos (10 ou 11) ou ''. */
export function phoneDigits(s) {
  let d = String(s ?? '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : '';
}

export function phoneText(digits) {
  const d = phoneDigits(digits);
  if (!d) return '';
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

export function waLink(text, digits = '') {
  const d = phoneDigits(digits);
  return `https://wa.me/${d ? `55${d}` : ''}?text=${encodeURIComponent(text)}`;
}

export function plural(n, one, many) {
  return `${fmtNum(n, 2)} ${Math.abs(n) === 1 ? one : many}`;
}

export const STATUS_LABEL = {
  orcamento: 'Orçamento',
  confirmado: 'Confirmado',
  pronto: 'Pronto',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};
