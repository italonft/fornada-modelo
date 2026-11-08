// Lista de compras e de produção: explode os pedidos do período em receitas e ingredientes.
import { html, useMemo, useState } from '../vendor/index.mjs';
import { shoppingList } from '../shared/calc.js';
import { addDays, brl, dayLabel, fmtNum, qtyText, shortDate, today, waLink } from '../shared/format.js';
import { readLocal, toast, writeLocal } from '../lib/api.js';
import { engine, isPro, loadRange, saveItem, useStore } from './store.js';
import { Empty, ErrorBox, Loading, NumInput, PageHead, ProLock, Seg, useAsync } from './ui.js';
import { shoppingMessage } from './mensagens.js';

const PRESETS = {
  hoje: () => [today(), today()],
  amanha: () => [addDays(today(), 1), addDays(today(), 1)],
  semana: () => [today(), addDays(today(), 6)],
  quinzena: () => [today(), addDays(today(), 14)],
};

function batchesText(n) {
  if (n <= 0) return '';
  const r = Math.round(n * 100) / 100;
  return `${fmtNum(r, 2)} ${r === 1 ? 'receita' : 'receitas'}`;
}

function StockEdit({ item }) {
  const [v, setV] = useState(item.stock || 0);
  const [busy, setBusy] = useState(false);
  const changed = (v || 0) !== (item.stock || 0);
  return html`<span class="stock-edit">
    <label class="sr-only" for=${`st-${item.id}`}>Quanto tem de ${item.name}</label>
    <${NumInput} id=${`st-${item.id}`} value=${v} onValue=${(x) => setV(x > 0 ? x : 0)} suffix=${item.unit} placeholder="0" />
    ${changed
      ? html`<button type="button" class="btn btn-small" disabled=${busy} onClick=${async () => {
          setBusy(true);
          try {
            await saveItem({ ...item, stock: v || 0 });
            toast('Estoque salvo.');
          } catch (e) {
            toast(e.message, { bad: true });
          } finally {
            setBusy(false);
          }
        }}>Salvar</button>`
      : null}
  </span>`;
}

export function Compras() {
  const s = useStore();
  const [preset, setPreset] = useState('semana');
  const [range, setRange] = useState(PRESETS.semana());
  const [quotes, setQuotes] = useState(false);
  const [editStock, setEditStock] = useState(false);
  const [from, to] = range;
  const key = `fornada-compras-${from}-${to}`;
  const [checked, setChecked] = useState(() => readLocal(key, {}));
  const { data, error, loading, reload } = useAsync(() => loadRange(from, to), [from, to]);
  const eng = engine(s);
  const orders = useMemo(() => (data || []).filter((o) => o.status === 'confirmado' || (quotes && o.status === 'orcamento')), [data, quotes]);
  const list = useMemo(() => shoppingList(eng, orders), [eng, orders]);
  const pro = isPro(s);
  const period = from === to ? dayLabel(from) : `${shortDate(from)} a ${shortDate(to)}`;
  const toggle = (id) => {
    const next = { ...checked, [id]: !checked[id] };
    setChecked(next);
    writeLocal(key, next);
  };
  const choose = (p) => {
    setPreset(p);
    if (p !== 'outro') {
      const r = PRESETS[p]();
      setRange(r);
      setChecked(readLocal(`fornada-compras-${r[0]}-${r[1]}`, {}));
    }
  };
  const buyRows = list.shopping.filter((x) => x.buy > 0);
  const haveRows = list.shopping.filter((x) => x.buy <= 0);
  const visible = pro ? buyRows : buyRows.slice(0, 3);
  const hidden = pro ? [] : buyRows.slice(3);
  const pending = (data || []).filter((o) => o.status === 'orcamento').length;

  const ShopRow = (x) => html`<li class=${`row shop-row${checked[x.id] ? ' is-checked' : ''}`}>
    <label class="check row-main">
      <input type="checkbox" checked=${Boolean(checked[x.id])} onChange=${() => toggle(x.id)} />
      <span><strong>${x.name}</strong>
        <span class="muted small">Precisa de ${qtyText(x.need, x.base)}${x.stock > 0 ? `, tem ${qtyText(x.stock, x.base)}` : ''}</span></span>
    </label>
    <span class="row-side">
      <strong>${x.pkgQty > 0 ? `${x.packages} × ${qtyText(x.pkgQty, x.base)}` : qtyText(x.buy, x.base)}</strong>
      ${x.noPrice ? html`<span class="chip chip-warn">sem preço</span>` : html`<span class="muted small num">${brl(x.spend)}</span>`}
      ${editStock ? html`<${StockEdit} item=${s.items.find((i) => i.id === x.id)} />` : null}
    </span>
  </li>`;

  return html`<div class="page">
    <${PageHead} title="Compras e produção" sub="O que produzir e o que comprar para os pedidos confirmados do período.">
      ${buyRows.length ? html`<a class="btn" href=${waLink(shoppingMessage({ ...list, shopping: pro ? list.shopping : list.shopping.filter((x) => visible.includes(x)) }, period))} target="_blank" rel="noopener">Mandar no WhatsApp</a>` : null}
    </${PageHead}>
    <div class="toolbar">
      <${Seg} small label="Período" value=${preset} onChange=${choose} options=${[{ v: 'hoje', label: 'Hoje' }, { v: 'amanha', label: 'Amanhã' }, { v: 'semana', label: '7 dias' }, { v: 'quinzena', label: '15 dias' }, { v: 'outro', label: 'Escolher' }]} />
      ${preset === 'outro'
        ? html`<div class="range">
            <label class="mini">De<input type="date" value=${from} onInput=${(e) => e.currentTarget.value && setRange([e.currentTarget.value, to < e.currentTarget.value ? e.currentTarget.value : to])} /></label>
            <label class="mini">Até<input type="date" value=${to} onInput=${(e) => e.currentTarget.value && setRange([from > e.currentTarget.value ? e.currentTarget.value : from, e.currentTarget.value])} /></label>
          </div>`
        : null}
    </div>
    <label class="check small">
      <input type="checkbox" checked=${quotes} onChange=${(e) => setQuotes(e.currentTarget.checked)} />
      <span>Incluir orçamentos ainda não confirmados${pending ? ` (${pending})` : ''}</span>
    </label>
    ${loading && !data ? html`<${Loading} />` : error ? html`<${ErrorBox} error=${error} onRetry=${reload} />` : null}
    ${data && !orders.length
      ? html`<${Empty} title=${`Nenhum pedido confirmado ${from === to ? 'para ' + dayLabel(from).toLowerCase() : 'no período'}.`}>
          <p class="muted">A lista sai dos pedidos confirmados. Pedidos prontos ou entregues já foram feitos e não entram.</p>
        </${Empty}>`
      : null}
    ${data && orders.length
      ? html`
        <p class="small muted">${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'} de ${period}.</p>
        ${list.problems.length ? html`<p class="callout callout-warn small">Algumas receitas têm problema e ficaram de fora da conta: ${list.problems.map((p) => p.name).join(', ')}. Abra em Produtos para corrigir.</p>` : null}
        <section class="panel">
          <h2>Para produzir</h2>
          <ul class="rows">
            ${list.production.map(
              (p) => html`<li class="row">
                <span class="row-main"><strong>${p.name}</strong><span class="muted small">${p.sold ? 'Produto' : 'Receita base'} · rende ${fmtNum(p.yieldQty, 3)} ${{ un: 'un', g: 'g', kg: 'kg', ml: 'ml', l: 'l' }[p.yieldUnit]} por receita</span></span>
                <span class="row-side"><strong>${qtyText(p.need, p.base)}</strong><span class="muted small">${batchesText(p.batches)}</span></span>
              </li>`,
            )}
            ${list.products.filter((p) => p.free).map(
              (p) => html`<li class="row"><span class="row-main"><strong>${p.name}</strong><span class="muted small">Item avulso, sem receita</span></span><span class="row-side"><strong>${fmtNum(p.qty, 3)}</strong></span></li>`,
            )}
          </ul>
        </section>
        <section class="panel">
          <div class="panel-head">
            <h2>Para comprar</h2>
            <button type="button" class="btn btn-small btn-ghost" onClick=${() => setEditStock(!editStock)}>${editStock ? 'Pronto' : 'Tenho em casa'}</button>
          </div>
          ${buyRows.length ? null : html`<p class="muted">Você já tem tudo o que precisa.</p>`}
          <ul class="rows">${visible.map(ShopRow)}</ul>
          ${hidden.length
            ? html`<${ProLock} title=${`Mais ${hidden.length} itens na lista`} text="No Pro, a lista de compras sai completa, com as embalagens certas e o gasto estimado.">
                <ul class="rows">${hidden.map(ShopRow)}</ul>
              </${ProLock}>`
            : null}
          ${pro && list.total > 0 ? html`<p class="sum-line">Gasto estimado: <strong class="num">${brl(list.total)}</strong></p>` : null}
          ${haveRows.length && pro ? html`<details class="more"><summary>${haveRows.length} itens que você já tem</summary><ul class="rows">${haveRows.map(ShopRow)}</ul></details>` : null}
        </section>`
      : null}
  </div>`;
}
