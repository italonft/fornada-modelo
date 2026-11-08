// Ingredientes e embalagens: o que você compra, quanto custa e quanto subiu.
import { html, useEffect, useMemo, useState } from '../vendor/index.mjs';
import { unitPrice } from '../shared/calc.js';
import { brl, pct, qtyText, shortDate, today } from '../shared/format.js';
import { newId } from '../shared/schema.js';
import { toast } from '../lib/api.js';
import { ask, deleteItem, saveItem, useStore } from './store.js';
import { Empty, Field, MoneyInput, NumInput, PageHead, Seg, Sheet, guard, useDirty } from './ui.js';

export const KIND_LABEL = { ing: 'Ingrediente', emb: 'Embalagem', out: 'Outro' };
const BIG = { g: 'kg', ml: 'l', un: 'un' };

export function perUnitText(item) {
  const u = unitPrice(item);
  if (!(u > 0)) return '';
  if (item.unit === 'g') return `${brl(Math.round(u * 1000))} o kg`;
  if (item.unit === 'ml') return `${brl(Math.round(u * 1000))} o litro`;
  return `${brl(Math.round(u))} a unidade`;
}

export function changeOf(pc) {
  if (!pc?.last || !pc?.prev || !(pc.prev.unit > 0)) return null;
  const p = ((pc.last.unit - pc.prev.unit) / pc.prev.unit) * 100;
  return Math.abs(p) < 0.5 ? null : { p, at: pc.last.at };
}

export function ChangeChip({ pc }) {
  const c = changeOf(pc);
  if (!c) return null;
  const when = shortDate(today(c.at));
  return c.p > 0 ? html`<span class="chip chip-bad">subiu ${pct(c.p)} em ${when}</span>` : html`<span class="chip chip-good">caiu ${pct(-c.p)} em ${when}</span>`;
}

export function usedIn(fichas, itemId) {
  return fichas.filter((f) => (f.parts || []).some((p) => p.t === 'i' && p.id === itemId));
}

/** Formulário de um ingrediente ou embalagem. Também abre de dentro de uma receita. */
export function ItemForm({ item, onSaved, onClose, startName = '' }) {
  const s = useStore();
  const isNew = !item;
  const [base] = useState(() => item || { id: newId(), name: startName, kind: 'ing', unit: 'g', pkgQty: 0, pkgPrice: 0, cupG: 0, unitG: 0, stock: 0, note: '' });
  const [f, setF] = useState(base);
  const [pkgUnit, setPkgUnit] = useState(base.unit === 'un' ? 'un' : base.pkgQty >= 1000 && base.pkgQty % 1000 === 0 ? BIG[base.unit] : base.unit);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const factor = pkgUnit === 'kg' || pkgUnit === 'l' ? 1000 : 1;
  const [pkgText, setPkgText] = useState(base.pkgQty ? base.pkgQty / factor : null);
  const users = useMemo(() => (isNew ? [] : usedIn(s.fichas, base.id)), [s.fichas]);
  const up = (patch) => setF((x) => ({ ...x, ...patch }));

  const [saved, setSaved] = useState(false);
  useDirty(!saved && JSON.stringify(f) !== JSON.stringify(base));

  const setUnit = (u) => {
    setPkgUnit(u);
    up({ unit: u, pkgQty: pkgText > 0 ? pkgText : 0 });
  };
  const setPkg = (v, unitSel = pkgUnit) => {
    setPkgText(v);
    const fac = unitSel === 'kg' || unitSel === 'l' ? 1000 : 1;
    up({ pkgQty: v > 0 ? Math.round(v * fac * 1000) / 1000 : 0 });
  };

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    if (!f.name.trim()) return setErr({ field: 'name', message: 'Dê um nome.' });
    if (!(f.pkgQty > 0)) return setErr({ field: 'pkgQty', message: 'Informe o tamanho da embalagem que você compra.' });
    if (!Number.isFinite(f.pkgPrice ?? 0)) return setErr({ field: 'pkgPrice', message: 'Preço inválido.' });
    setBusy(true);
    try {
      const r = await saveItem({ ...f, pkgPrice: f.pkgPrice || 0 });
      setSaved(true);
      toast(isNew ? 'Ingrediente criado.' : 'Ingrediente salvo.');
      onSaved?.(r.item);
    } catch (ex) {
      setErr({ field: ex.field, message: ex.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await ask({ title: `Apagar ${f.name}?`, text: 'O histórico de preços dele também some.', ok: 'Apagar', danger: true }))) return;
    try {
      await deleteItem(f.id);
      setSaved(true);
      toast('Apagado.');
      onClose?.();
    } catch (ex) {
      setErr({ message: ex.message });
    }
  }

  const unitOpts = f.unit === 'g' ? ['g', 'kg'] : f.unit === 'ml' ? ['ml', 'l'] : ['un'];
  const e = (k) => (err && err.field === k ? err.message : '');
  return html`<form class="form" onSubmit=${submit} novalidate>
    <${Field} label="Nome" error=${e('name')}>
      <input value=${f.name} onInput=${(ev) => up({ name: ev.currentTarget.value })} maxlength="60" autofocus=${isNew} placeholder="Ex.: Leite condensado" />
    </${Field}>
    <div class="field">
      <span class="label">É um</span>
      <${Seg} label="Tipo" value=${f.kind} onChange=${(v) => up({ kind: v })} options=${[{ v: 'ing', label: 'Ingrediente' }, { v: 'emb', label: 'Embalagem' }, { v: 'out', label: 'Outro' }]} />
    </div>
    <div class="field">
      <span class="label">Você compra por</span>
      <${Seg} label="Medida de compra" value=${f.unit} onChange=${setUnit} options=${[{ v: 'g', label: 'Peso' }, { v: 'ml', label: 'Volume' }, { v: 'un', label: 'Unidade' }]} />
    </div>
    <div class="grid-2">
      <${Field} label="Tamanho da embalagem" error=${e('pkgQty')}>
        <div class="affix">
          <${NumInput} value=${pkgText} onValue=${(v) => setPkg(v)} placeholder=${f.unit === 'un' ? '12' : '395'} invalid=${Boolean(e('pkgQty'))} />
          ${unitOpts.length > 1
            ? html`<select class="post-select" aria-label="Unidade da embalagem" value=${pkgUnit} onChange=${(ev) => (setPkgUnit(ev.currentTarget.value), setPkg(pkgText, ev.currentTarget.value))}>
                ${unitOpts.map((u) => html`<option value=${u}>${u === 'l' ? 'litro' : u}</option>`)}
              </select>`
            : html`<span class="post">unidades</span>`}
        </div>
      </${Field}>
      <${Field} label="Preço que você paga" error=${e('pkgPrice')} hint=${perUnitText(f) || 'Na última compra.'}>
        <${MoneyInput} value=${f.pkgPrice} onValue=${(v) => up({ pkgPrice: Number.isFinite(v) ? v : v === null ? 0 : NaN })} />
      </${Field}>
    </div>
    <details class="more" open=${f.cupG > 0 || f.unitG > 0 || f.stock > 0}>
      <summary>Medidas caseiras e estoque</summary>
      <div class="grid-2">
        ${f.unit !== 'un'
          ? html`<${Field} label="1 xícara (240 ml) pesa" hint=${f.unit === 'g' ? 'Para usar xícara e colher nas receitas. Farinha de trigo: cerca de 120 g.' : 'Só se alguma receita usar este líquido em gramas.'}>
              <${NumInput} value=${f.cupG} onValue=${(v) => up({ cupG: v > 0 ? v : 0 })} suffix="g" max=${1} />
            </${Field}>`
          : html`<${Field} label="1 unidade pesa" hint="Só se alguma receita usar em gramas. Ex.: 1 ovo, cerca de 50 g.">
              <${NumInput} value=${f.unitG} onValue=${(v) => up({ unitG: v > 0 ? v : 0 })} suffix="g" max=${1} />
            </${Field}>`}
        <${Field} label="Quanto você tem em casa" hint="A lista de compras desconta isto.">
          <${NumInput} value=${f.stock} onValue=${(v) => up({ stock: v > 0 ? v : 0 })} suffix=${f.unit} />
        </${Field}>
      </div>
    </details>
    ${!isNew && s.priceChanges[f.id]
      ? html`<p class="small muted">Preço por ${f.unit === 'un' ? 'unidade' : f.unit === 'g' ? 'kg' : 'litro'}: ${(() => {
          const pc = s.priceChanges[f.id];
          const k = f.unit === 'un' ? 1 : 1000;
          return pc.prev ? `${brl(Math.round(pc.prev.unit * k))} em ${shortDate(today(pc.prev.at))}, ${brl(Math.round(pc.last.unit * k))} em ${shortDate(today(pc.last.at))}.` : `${brl(Math.round(pc.last.unit * k))} desde ${shortDate(today(pc.last.at))}.`;
        })()}</p>`
      : null}
    ${users.length ? html`<p class="small muted">Usado em: ${users.map((u) => u.name).join(', ')}.</p>` : null}
    ${err && !err.field ? html`<p class="error-text" role="alert">${err.message}</p>` : null}
    <div class="form-actions">
      <button class="btn btn-main" disabled=${busy}>${busy ? 'Salvando…' : isNew ? 'Criar' : 'Salvar'}</button>
      ${!isNew && !users.length ? html`<button type="button" class="btn btn-danger" onClick=${remove}>Apagar</button>` : null}
    </div>
  </form>`;
}

function BulkPrices({ items, onDone }) {
  const [vals, setVals] = useState(() => Object.fromEntries(items.map((i) => [i.id, i.pkgPrice])));
  const [busy, setBusy] = useState(false);
  const changed = items.filter((i) => Number.isFinite(vals[i.id]) && (vals[i.id] ?? 0) !== i.pkgPrice);
  const [done, setDone] = useState(false);
  useDirty(!done && changed.length > 0);
  async function save() {
    setBusy(true);
    let n = 0;
    try {
      for (const it of changed) {
        await saveItem({ ...it, pkgPrice: vals[it.id] || 0 });
        n++;
      }
      setDone(true);
      toast(`${n} ${n === 1 ? 'preço atualizado' : 'preços atualizados'}.`);
      onDone(n);
    } catch (e) {
      toast(`${n} salvos. ${e.message}`, { bad: true });
    } finally {
      setBusy(false);
    }
  }
  return html`<div class="bulk">
    <p class="muted small">Digite o preço que você pagou em cada embalagem. Só o que mudar é salvo.</p>
    <ul class="rows">
      ${items.map(
        (i) => html`<li class="row bulk-row">
          <label for=${`p-${i.id}`} class="row-main"><strong>${i.name}</strong><span class="muted small">${qtyText(i.pkgQty, i.unit)}</span></label>
          <div class="bulk-input"><${MoneyInput} id=${`p-${i.id}`} value=${vals[i.id]} onValue=${(v) => setVals((x) => ({ ...x, [i.id]: v === null ? 0 : v }))} /></div>
        </li>`,
      )}
    </ul>
    <div class="sticky-actions">
      <button type="button" class="btn btn-main" disabled=${busy || !changed.length} onClick=${save}>${busy ? 'Salvando…' : changed.length ? `Salvar ${changed.length} ${changed.length === 1 ? 'preço' : 'preços'}` : 'Nada mudou ainda'}</button>
      <button type="button" class="btn" onClick=${() => (setDone(true), onDone(0))}>Cancelar</button>
    </div>
  </div>`;
}

export function Ingredientes({ route }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState(route.q.get('filtro') || 'todos');
  const [open, setOpen] = useState(null);
  const [bulk, setBulk] = useState(false);
  const noPrice = s.items.filter((i) => !(i.pkgPrice > 0));
  const list = s.items.filter((i) => {
    if (kind === 'ing' && i.kind !== 'ing') return false;
    if (kind === 'emb' && i.kind !== 'emb') return false;
    if (kind === 'sem' && i.pkgPrice > 0) return false;
    if (q && !i.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))) return false;
    return true;
  });
  const stockValue = Math.round(s.items.reduce((a, i) => a + (i.stock > 0 ? i.stock * unitPrice(i) : 0), 0));
  const closeSheet = () => {
    if (guard.dirty()) {
      ask({ title: 'Fechar sem salvar?', ok: 'Fechar', danger: true }).then((ok) => ok && setOpen(null));
    } else setOpen(null);
  };

  return html`<div class="page">
    <${PageHead} title="Ingredientes e embalagens" sub="O preço que você paga em cada coisa. Mudou no mercado? Atualize aqui e todas as receitas recalculam.">
      ${!bulk ? html`<button type="button" class="btn" onClick=${() => setBulk(true)}>Atualizar preços</button>` : null}
      ${!bulk ? html`<button type="button" class="btn btn-main" onClick=${() => setOpen('novo')}>Novo</button>` : null}
    </${PageHead}>
    ${bulk
      ? html`<${BulkPrices} items=${list} onDone=${() => setBulk(false)} />`
      : html`
        <div class="toolbar">
          <input type="search" placeholder="Buscar" aria-label="Buscar ingrediente" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
          <${Seg} small label="Mostrar" value=${kind} onChange=${setKind} options=${[{ v: 'todos', label: 'Todos' }, { v: 'ing', label: 'Ingredientes' }, { v: 'emb', label: 'Embalagens' }, { v: 'sem', label: 'Sem preço', count: noPrice.length }]} />
        </div>
        ${noPrice.length && kind !== 'sem' ? html`<p class="callout callout-warn small">${noPrice.length} ${noPrice.length === 1 ? 'item está' : 'itens estão'} sem preço. As receitas que usam ficam com o custo incompleto. <button type="button" class="btn-link" onClick=${() => setKind('sem')}>Ver quais</button></p>` : null}
        ${list.length
          ? html`<ul class="rows">
              ${list.map(
                (i) => html`<li>
                  <button type="button" class="row row-btn" onClick=${() => setOpen(i.id)}>
                    <span class="row-main">
                      <strong>${i.name}</strong>
                      <span class="muted small">${KIND_LABEL[i.kind]} · ${qtyText(i.pkgQty, i.unit)}${i.stock > 0 ? ` · tem ${qtyText(i.stock, i.unit)}` : ''}</span>
                    </span>
                    <span class="row-side">
                      ${i.pkgPrice > 0 ? html`<strong class="num">${brl(i.pkgPrice)}</strong><span class="muted small">${perUnitText(i)}</span>` : html`<span class="chip chip-warn">Sem preço</span>`}
                      <${ChangeChip} pc=${s.priceChanges[i.id]} />
                    </span>
                  </button>
                </li>`,
              )}
            </ul>`
          : html`<${Empty} title=${q ? 'Nada encontrado.' : 'Nenhum item aqui.'}><p class="muted">${q ? 'Confira a escrita ou crie um novo.' : 'Crie os ingredientes e embalagens que você usa.'}</p></${Empty}>`}
      `}
    <${Sheet} open=${Boolean(open)} title=${open === 'novo' ? 'Novo ingrediente ou embalagem' : 'Ingrediente'} onClose=${closeSheet}>
      ${open ? html`<${ItemForm} key=${open} item=${open === 'novo' ? null : s.items.find((i) => i.id === open)} onSaved=${() => setOpen(null)} onClose=${() => setOpen(null)} />` : null}
    </${Sheet}>
    <p class="faint small foot-note">${s.items.length} ${s.items.length === 1 ? 'item' : 'itens'}.${stockValue > 0 ? ` O que você tem em casa vale ${brl(stockValue)}.` : ''}</p>
  </div>`;
}
