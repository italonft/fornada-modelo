// Estado do app: conta, ingredientes, receitas e pedidos. As telas leem daqui e pedem as mudanças por aqui.
import { useEffect, useState } from '../vendor/index.mjs';
import { makeEngine } from '../shared/calc.js';
import { addDays, monthRange, today } from '../shared/format.js';
import { api } from '../lib/api.js';

let state = {
  ready: false,
  error: null,
  config: null,
  account: null,
  items: [],
  fichas: [],
  priceChanges: {},
  newOrders: 0,
  open: null,
  months: {},
  ranges: {},
  dialog: null,
  version: 0,
};
const subs = new Set();

export const get = () => state;

export function set(patch) {
  state = { ...state, ...patch, version: state.version + 1 };
  for (const fn of subs) fn(state);
}

export function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subs.add(fn);
    return () => subs.delete(fn);
  }, []);
  return state;
}

// ---------- Contas ----------
let engCache = { key: null, eng: null };
/** Motor de cálculo das receitas atuais, refeito só quando algo muda. */
export function engine(s = state) {
  const key = `${s.items === engCache.items}-${s.fichas === engCache.fichas}-${s.account?.settings === engCache.settings}`;
  if (engCache.eng && key === 'true-true-true') return engCache.eng;
  engCache = { items: s.items, fichas: s.fichas, settings: s.account?.settings, eng: makeEngine({ items: s.items, fichas: s.fichas, settings: s.account?.settings }) };
  return engCache.eng;
}

export const isPro = (s = state) => Boolean(s.account?.plan?.pro);
export const sellingCount = (s = state) => s.fichas.filter((f) => f.sell?.on).length;

// ---------- Carregar ----------
export async function loadAll() {
  try {
    const [config, d] = await Promise.all([api('/api/config'), api('/api/dados')]);
    set({ ready: true, error: null, config, account: d.account, items: sortByName(d.items), fichas: sortByName(d.fichas), priceChanges: d.priceChanges || {}, newOrders: d.newOrders || 0 });
  } catch (e) {
    if (e.status === 401) {
      location.replace(`/entrar?volta=${encodeURIComponent(location.hash || '')}`);
      return;
    }
    set({ ready: false, error: e.message });
  }
}

const sortByName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));

// ---------- Ingredientes ----------
export async function saveItem(item) {
  const isNew = !state.items.some((i) => i.id === item.id);
  const r = await api(`/api/insumos/${item.id}`, { method: 'PUT', body: item });
  const items = sortByName([...state.items.filter((i) => i.id !== item.id), r.item]);
  const priceChanges = { ...state.priceChanges };
  if (r.priceChange) priceChanges[item.id] = r.priceChange;
  set({ items, priceChanges });
  return { item: r.item, isNew };
}

export async function deleteItem(id) {
  await api(`/api/insumos/${id}`, { method: 'DELETE' });
  const priceChanges = { ...state.priceChanges };
  delete priceChanges[id];
  set({ items: state.items.filter((i) => i.id !== id), priceChanges });
}

// ---------- Receitas ----------
export async function saveFicha(ficha) {
  const r = await api(`/api/fichas/${ficha.id}`, { method: 'PUT', body: ficha });
  const fichas = sortByName([...state.fichas.filter((f) => f.id !== ficha.id), r.ficha]);
  set({ fichas, account: withUsage(state.account, { products: fichas.filter((f) => f.sell?.on).length }) });
  return r.ficha;
}

export async function deleteFicha(id) {
  await api(`/api/fichas/${id}`, { method: 'DELETE' });
  const fichas = state.fichas.filter((f) => f.id !== id);
  set({ fichas, account: withUsage(state.account, { products: fichas.filter((f) => f.sell?.on).length }) });
}

export async function uploadPhoto(fichaId, blob) {
  const r = await api(`/api/fichas/${fichaId}/foto`, { method: 'PUT', raw: blob, headers: { 'content-type': blob.type || 'image/jpeg' } });
  set({ fichas: state.fichas.map((f) => (f.id === fichaId ? { ...f, menu: { ...f.menu, photo: r.photo } } : f)) });
  return r.photo;
}

export async function removePhoto(fichaId) {
  await api(`/api/fichas/${fichaId}/foto`, { method: 'DELETE' });
  set({ fichas: state.fichas.map((f) => (f.id === fichaId ? { ...f, menu: { ...f.menu, photo: '' } } : f)) });
}

const withUsage = (account, patch) => (account ? { ...account, usage: { ...account.usage, ...patch } } : account);

// ---------- Pedidos ----------
export async function loadOpen(force = false) {
  if (state.open && !force) return state.open;
  const r = await api('/api/pedidos?abertos=1');
  set({ open: r.orders });
  return r.orders;
}

export async function loadMonth(ym, force = false) {
  if (state.months[ym] && !force) return state.months[ym];
  const { from, to } = monthRange(ym);
  const r = await api(`/api/pedidos?de=${from}&ate=${to}`);
  set({ months: { ...state.months, [ym]: r.orders } });
  return r.orders;
}

export async function loadRange(from, to, force = false) {
  const key = `${from}|${to}`;
  if (state.ranges[key] && !force) return state.ranges[key];
  const r = await api(`/api/pedidos?de=${from}&ate=${to}`);
  set({ ranges: { ...state.ranges, [key]: r.orders } });
  return r.orders;
}

export async function getOrder(id) {
  const all = [...(state.open || []), ...Object.values(state.months).flat(), ...Object.values(state.ranges).flat()];
  const hit = all.find((o) => o.id === id);
  if (hit) return hit;
  return (await api(`/api/pedidos/${id}`)).order;
}

/** Depois de mudar um pedido, as listas guardadas ficam velhas: some com elas e cada tela recarrega o que precisa. */
function afterOrderChange() {
  set({ months: {}, ranges: {}, open: null });
}

export async function saveOrder(order, { wasUnseen = false } = {}) {
  const r = await api(`/api/pedidos/${order.id}`, { method: 'PUT', body: order });
  afterOrderChange();
  if (wasUnseen) set({ newOrders: Math.max(0, state.newOrders - 1) });
  return r.order;
}

export async function setOrderStatus(id, status, paid) {
  const r = await api(`/api/pedidos/${id}/situacao`, { method: 'POST', body: paid === undefined ? { status } : { status, paid } });
  afterOrderChange();
  return r.order;
}

export async function markSeen(order) {
  if (order.seen) return;
  await api(`/api/pedidos/${order.id}/visto`, { method: 'POST' });
  set({ newOrders: Math.max(0, state.newOrders - 1), open: state.open ? state.open.map((o) => (o.id === order.id ? { ...o, seen: true } : o)) : null });
}

export async function deleteOrder(id) {
  await api(`/api/pedidos/${id}`, { method: 'DELETE' });
  afterOrderChange();
}

// ---------- Conta ----------
export async function saveAccount(patch) {
  const r = await api('/api/conta', { method: 'PATCH', body: patch });
  set({ account: r.account });
  return r.account;
}

export async function refreshAccount() {
  const r = await api('/api/conta');
  set({ account: r.account });
  return r.account;
}

// ---------- Diálogo de confirmação ----------
/** Pergunta dentro da página (o app não usa confirm() do navegador). Resolve true ou false. */
export function ask({ title, text = '', ok = 'Confirmar', cancel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    state.dialog?.resolve(false);
    set({ dialog: { title, text, ok, cancel, danger, resolve } });
  });
}

export function closeDialog(answer) {
  const d = state.dialog;
  set({ dialog: null });
  d?.resolve(answer);
}

export const todayStr = () => today();
export const weekAhead = () => ({ from: today(), to: addDays(today(), 6) });
