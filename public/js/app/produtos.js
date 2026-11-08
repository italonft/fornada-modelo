// Produtos e receitas (fichas técnicas): custo de verdade e preço certo em cada canal de venda.
import { html, useEffect, useMemo, useRef, useState } from '../vendor/index.mjs';
import { alerts, baseOf, channelTable, makeEngine, suggestPrice, unitsForFicha, unitsForItem, unitPrice } from '../shared/calc.js';
import { brl, fmtNum, pct, qtyText, saleUnitShort, UNIT_LABEL } from '../shared/format.js';
import { newId } from '../shared/schema.js';
import { toast } from '../lib/api.js';
import { ask, deleteFicha, engine, isPro, removePhoto, saveFicha, saveItem, uploadPhoto, useStore } from './store.js';
import { Empty, Field, Lcd, MoneyInput, NumInput, PageHead, Seg, Sheet, Verdict, VERDICT_HELP, go, guard, useDirty } from './ui.js';
import { ItemForm, KIND_LABEL, perUnitText } from './ingredientes.js';

const YIELD_LABEL = { un: 'unidades', g: 'gramas', kg: 'quilos', ml: 'ml', l: 'litros' };

export function yieldText(f) {
  const q = fmtNum(f.yieldQty, 3);
  return { un: `${q} un`, g: `${q} g`, kg: `${q} kg`, ml: `${q} ml`, l: `${q} l` }[f.yieldUnit] || q;
}

export const saleLabel = (f) => f.sell?.label || { un: 'unidade', g: 'kg', kg: 'kg', ml: 'litro', l: 'litro' }[f.yieldUnit];

function partUnitLabel(unit, target, isItem) {
  if (unit === 'un' && isItem && target && target.unit !== 'un') return `embalagem (${qtyText(target.pkgQty, target.unit)})`;
  if (unit === 'un' && !isItem && target && baseOf(target.yieldUnit) !== 'un') return 'porção';
  return UNIT_LABEL[unit] || unit;
}

const PROBLEM_TEXT = {
  semPreco: (n) => `${n} está sem preço.`,
  cupG: (n) => `Falta dizer quanto pesa 1 xícara de ${n}.`,
  unitG: (n) => `Falta dizer quanto pesa 1 unidade de ${n}.`,
  peso: (n) => `Falta o peso de 1 unidade em "${n}".`,
  dim: (n) => `Essa medida não serve para ${n}. Escolha outra.`,
  unidade: () => 'Medida inválida.',
  embalagem: (n) => `${n} está sem tamanho de embalagem.`,
  sumiu: () => 'Este item foi apagado. Tire esta linha.',
  ciclo: (n) => `"${n}" já usa esta receita. Tire esta linha.`,
  filha: (n) => `A receita "${n}" tem ingrediente sem preço.`,
  filhaErro: (n) => `A receita "${n}" tem um problema. Abra e confira.`,
};

// ---------- Lista ----------
export function Produtos({ route }) {
  const s = useStore();
  const [tab, setTab] = useState(route.q.get('aba') === 'bases' ? 'bases' : 'venda');
  const eng = engine(s);
  const selling = s.fichas.filter((f) => f.sell?.on);
  const bases = s.fichas.filter((f) => !f.sell?.on);
  const list = tab === 'venda' ? selling : bases;
  const pro = isPro(s);
  const max = s.account.limits.products;
  const bad = useMemo(() => alerts(eng, selling).filter((a) => a.channel.id === 'direto'), [eng, s.fichas]);

  return html`<div class="page">
    <${PageHead} title="Produtos e receitas" sub="Cada receita mostra o custo de verdade. O que você vende ganha preço sugerido por canal.">
      <a class="btn btn-main" href=${tab === 'venda' ? '#/ficha/nova' : '#/ficha/nova?base=1'}>${tab === 'venda' ? 'Novo produto' : 'Nova receita base'}</a>
    </${PageHead}>
    <${Seg} label="Mostrar" value=${tab} onChange=${setTab} options=${[{ v: 'venda', label: 'À venda', count: selling.length }, { v: 'bases', label: 'Receitas base', count: bases.length }]} />
    ${tab === 'venda' && !pro ? html`<p class="small muted usage">${selling.length} de ${max} produtos à venda no plano grátis. <a href="#/conta?aba=plano">Sem limite no Pro</a>.</p>` : null}
    ${tab === 'venda' && bad.length ? html`<p class="callout callout-warn small">${bad.length === 1 ? '1 produto está' : `${bad.length} produtos estão`} com preço abaixo do que deveria. Eles aparecem marcados abaixo.</p>` : null}
    ${tab === 'bases' ? html`<p class="small muted usage">Receitas base são massas, recheios e coberturas que entram em outros produtos. Monte uma vez e use em vários.</p>` : null}
    ${list.length
      ? html`<ul class="rows">
          ${list.map((f) => {
            const c = eng.cost(f.id);
            const row = f.sell?.on ? channelTable(eng, f)[0] : null;
            const missing = c?.problems.filter((p) => p.why === 'semPreco').length || 0;
            return html`<li>
              <a class="row" href=${`#/ficha/${f.id}`}>
                ${f.menu?.photo ? html`<img class="thumb" src=${`/f/${f.menu.photo}`} alt="" loading="lazy" width="44" height="44" />` : html`<span class="thumb thumb-empty" aria-hidden="true">${f.name.slice(0, 1)}</span>`}
                <span class="row-main">
                  <strong>${f.name}</strong>
                  <span class="muted small">Rende ${yieldText(f)} · custo ${c && !c.blocking ? `${brl(Math.round(c.sale.total))} por ${saleLabel(f)}` : 'incompleto'}</span>
                  ${c?.blocking ? html`<span class="chip chip-bad">Tem item com problema</span>` : missing ? html`<span class="chip chip-warn">${missing} sem preço</span>` : null}
                </span>
                <span class="row-side">
                  ${f.sell?.on ? html`${f.sell.price > 0 ? html`<strong class="num">${brl(f.sell.price)}</strong>` : null}<${Verdict} v=${row?.verdict} />` : html`<span class="muted small">${brl(Math.round(c?.batch.total || 0))} a receita</span>`}
                </span>
              </a>
            </li>`;
          })}
        </ul>`
      : html`<${Empty} title=${tab === 'venda' ? 'Nenhum produto à venda ainda.' : 'Nenhuma receita base.'}>
          <p class="muted">${tab === 'venda' ? 'Monte a ficha de um produto: ingredientes, embalagem e quanto rende. O app calcula o resto.' : 'Crie uma massa ou recheio para usar em vários produtos.'}</p>
        </${Empty}>`}
  </div>`;
}

// ---------- Escolher ingrediente ou receita ----------
function uses(fichas, fromId, targetId, depth = 0) {
  if (depth > 20) return true;
  const f = fichas.find((x) => x.id === fromId);
  if (!f) return false;
  return (f.parts || []).some((p) => p.t === 'f' && (p.id === targetId || uses(fichas, p.id, targetId, depth + 1)));
}

const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function Picker({ mode, selfId, onPick, onClose }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  if (creating) {
    return html`<${ItemForm} startName=${q} onSaved=${(item) => onPick({ t: 'i', id: item.id })} onClose=${() => setCreating(false)} />`;
  }
  const options =
    mode === 'i'
      ? s.items.filter((i) => !q || norm(i.name).includes(norm(q)))
      : s.fichas.filter((f) => f.id !== selfId && !uses(s.fichas, f.id, selfId) && (!q || norm(f.name).includes(norm(q))));
  return html`<div class="picker">
    <input type="search" autofocus placeholder=${mode === 'i' ? 'Buscar ingrediente ou embalagem' : 'Buscar receita'} aria-label="Buscar" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
    <ul class="rows picker-list">
      ${options.map(
        (o) => html`<li>
          <button type="button" class="row row-btn" onClick=${() => onPick({ t: mode, id: o.id })}>
            <span class="row-main"><strong>${o.name}</strong>
              <span class="muted small">${mode === 'i' ? `${KIND_LABEL[o.kind]} · ${o.pkgPrice > 0 ? perUnitText(o) : 'sem preço'}` : `Rende ${yieldText(o)}`}</span></span>
          </button>
        </li>`,
      )}
    </ul>
    ${mode === 'i'
      ? html`<button type="button" class="btn btn-block" onClick=${() => setCreating(true)}>${q ? `Criar "${q}"` : 'Criar ingrediente ou embalagem'}</button>`
      : !options.length
        ? html`<p class="muted small">Nenhuma receita disponível. Crie massas e recheios em Produtos, na aba Receitas base.</p>`
        : null}
    ${onClose ? null : null}
  </div>`;
}

// ---------- Foto ----------
async function shrinkPhoto(file, maxBytes = 90000) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Não consegui abrir essa imagem. Use JPG ou PNG.'));
      img.src = URL.createObjectURL(file);
    });
  }
  for (const side of [900, 720, 560, 420]) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.58]) {
      let blob = await new Promise((r) => cv.toBlob(r, 'image/webp', q));
      if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= maxBytes) return blob;
    }
  }
  throw new Error('A foto ficou grande demais mesmo reduzida. Tente outra.');
}

function PhotoBox({ ficha, saved }) {
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  if (!saved) return html`<p class="small muted">Salve o produto para colocar a foto.</p>`;
  async function pick(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const blob = await shrinkPhoto(file);
      await uploadPhoto(ficha.id, blob);
      toast('Foto salva.');
    } catch (ex) {
      toast(ex.message, { bad: true });
    } finally {
      setBusy(false);
    }
  }
  return html`<div class="photo-box">
    ${ficha.menu?.photo ? html`<img src=${`/f/${ficha.menu.photo}`} alt=${`Foto de ${ficha.name}`} width="120" height="120" />` : html`<span class="photo-empty" aria-hidden="true">sem foto</span>`}
    <div class="photo-actions">
      <input ref=${input} type="file" accept="image/*" class="sr-only" id="foto" onChange=${pick} />
      <button type="button" class="btn btn-small" disabled=${busy} onClick=${() => input.current?.click()}>${busy ? 'Enviando…' : ficha.menu?.photo ? 'Trocar foto' : 'Colocar foto'}</button>
      ${ficha.menu?.photo ? html`<button type="button" class="btn btn-small btn-ghost" disabled=${busy} onClick=${async () => (await removePhoto(ficha.id), toast('Foto removida.'))}>Tirar foto</button>` : null}
    </div>
  </div>`;
}

// ---------- Ajustes rápidos dentro da receita ----------
function QuickFix({ problem, part, item, child }) {
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      toast('Salvo. A conta foi refeita.');
    } catch (e) {
      toast(e.message, { bad: true });
    } finally {
      setBusy(false);
    }
  }
  if (problem === 'semPreco' && item) {
    return html`<div class="fix">
      <label class="small" for=${`fx-${part.id}`}>Preço da embalagem de ${qtyText(item.pkgQty, item.unit)}:</label>
      <div class="fix-row"><${MoneyInput} id=${`fx-${part.id}`} value=${v} onValue=${setV} />
      <button type="button" class="btn btn-small" disabled=${busy || !(v > 0)} onClick=${() => run(() => saveItem({ ...item, pkgPrice: v }))}>Salvar preço</button></div>
    </div>`;
  }
  if ((problem === 'cupG' || problem === 'unitG') && item) {
    const k = problem;
    return html`<div class="fix">
      <label class="small" for=${`fx-${part.id}`}>${k === 'cupG' ? `1 xícara de ${item.name} pesa` : `1 unidade de ${item.name} pesa`}:</label>
      <div class="fix-row"><${NumInput} id=${`fx-${part.id}`} value=${v} onValue=${setV} suffix="g" max=${1} />
      <button type="button" class="btn btn-small" disabled=${busy || !(v > 0)} onClick=${() => run(() => saveItem({ ...item, [k]: v }))}>Salvar</button></div>
    </div>`;
  }
  if (problem === 'peso' && child) {
    return html`<div class="fix">
      <label class="small" for=${`fx-${part.id}`}>${baseOf(child.yieldUnit) === 'un' ? `1 unidade de "${child.name}" pesa` : `1 porção de "${child.name}" pesa`}:</label>
      <div class="fix-row"><${NumInput} id=${`fx-${part.id}`} value=${v} onValue=${setV} suffix="g" max=${1} />
      <button type="button" class="btn btn-small" disabled=${busy || !(v > 0)} onClick=${() => run(() => saveFicha({ ...child, unitWeightG: v }))}>Salvar</button></div>
    </div>`;
  }
  return null;
}

// ---------- Editor ----------
function blank(base) {
  return {
    id: newId(),
    name: '',
    yieldQty: 0,
    yieldUnit: 'un',
    unitWeightG: 0,
    lossPct: 0,
    prepMin: 0,
    parts: [],
    sell: { on: !base, label: '', price: 0, prices: {} },
    menu: { on: false, cat: '', desc: '', photo: '' },
    notes: '',
  };
}

const clean = (f) => JSON.stringify({ ...f, createdAt: undefined, updatedAt: undefined });

export function FichaEditor({ id, q }) {
  const s = useStore();
  const existing = id && id !== 'nova' ? s.fichas.find((f) => f.id === id) : null;
  const [f, setF] = useState(() => (existing ? structuredClone(existing) : blank(q.get('base') === '1')));
  const [snap, setSnap] = useState(() => (existing ? clean(existing) : clean(f)));
  const [picker, setPicker] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const isSaved = s.fichas.some((x) => x.id === f.id);
  const up = (patch) => setF((x) => ({ ...x, ...patch }));
  const upSell = (patch) => setF((x) => ({ ...x, sell: { ...x.sell, ...patch } }));
  const upMenu = (patch) => setF((x) => ({ ...x, menu: { ...x.menu, ...patch } }));
  const setPart = (i, patch) => setF((x) => ({ ...x, parts: x.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  // A foto muda pelo servidor; traz para o rascunho sem marcar como mudança.
  const livePhoto = s.fichas.find((x) => x.id === f.id)?.menu?.photo ?? '';
  useEffect(() => {
    if (isSaved && livePhoto !== f.menu.photo) {
      setF((x) => ({ ...x, menu: { ...x.menu, photo: livePhoto } }));
      setSnap((sn) => {
        const o = JSON.parse(sn);
        o.menu.photo = livePhoto;
        return JSON.stringify(o);
      });
    }
  }, [livePhoto]);

  useDirty(clean(f) !== snap);

  const eng = useMemo(() => makeEngine({ items: s.items, fichas: [...s.fichas.filter((x) => x.id !== f.id), f], settings: s.account.settings }), [f, s.items, s.fichas, s.account.settings]);
  const c = eng.cost(f.id);
  const table = f.sell.on ? channelTable(eng, f) : [];
  const st = eng.settings;
  const direct = table[0];
  const sugDirect = c ? suggestPrice(c.sale.total, { marginPct: st.marginPct, taxPct: st.taxPct, feePct: 0, rounding: st.rounding }) : null;
  const unitSale = saleUnitShort(f.yieldUnit);
  const label = saleLabel(f);
  const cats = [...new Set(s.fichas.map((x) => x.menu?.cat).filter(Boolean))];
  const pro = isPro(s);

  if (id && id !== 'nova' && !existing && !isSaved) {
    return html`<div class="page"><${Empty} title="Receita não encontrada."><p><a href="#/produtos">Voltar para produtos</a></p></${Empty}></div>`;
  }

  function addPart(pick) {
    const target = pick.t === 'i' ? s.items.find((i) => i.id === pick.id) : s.fichas.find((x) => x.id === pick.id);
    const unit = pick.t === 'i' ? (target ? unitsForItem(target)[0] : 'g') : target ? unitsForFicha(target)[0] : 'g';
    setF((x) => ({ ...x, parts: [...x.parts, { t: pick.t, id: pick.id, qty: 0, unit }] }));
    setPicker(null);
    setTimeout(() => document.getElementById(`q-${f.parts.length}`)?.focus(), 60);
  }

  async function save(e) {
    e?.preventDefault();
    setErr(null);
    if (!f.name.trim()) return setErr({ field: 'name', message: 'Dê um nome à receita.' });
    if (!(f.yieldQty > 0)) return setErr({ field: 'yieldQty', message: 'Diga quanto a receita rende.' });
    const bad = f.parts.findIndex((p) => !(p.qty > 0));
    if (bad >= 0) return setErr({ field: `parts.${bad}`, message: `Item ${bad + 1}: informe a quantidade.` });
    setBusy(true);
    try {
      const saved = await saveFicha(f);
      const next = { ...f, menu: { ...f.menu, photo: saved.menu.photo } };
      setF(next);
      setSnap(clean(next));
      toast(isSaved ? 'Receita salva.' : 'Receita criada.');
      if (!isSaved) setTimeout(() => go(`#/ficha/${f.id}`, { replace: true }), 0);
    } catch (ex) {
      setErr({ field: ex.field, message: ex.message, code: ex.code });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await ask({ title: `Apagar ${f.name || 'esta receita'}?`, text: 'Pedidos antigos continuam com o nome e o valor que tinham.', ok: 'Apagar', danger: true }))) return;
    try {
      await deleteFicha(f.id);
      setSnap(clean(f));
      toast('Receita apagada.');
      go('#/produtos', { replace: true });
    } catch (ex) {
      setErr({ message: ex.message });
    }
  }

  async function duplicate() {
    if (clean(f) !== snap && !(await ask({ title: 'Duplicar sem salvar?', text: 'A cópia sai como a receita está salva, sem as mudanças desta tela.', ok: 'Duplicar mesmo assim' }))) return;
    const src = s.fichas.find((x) => x.id === f.id) || f;
    const copy = { ...structuredClone(src), id: newId(), name: `${src.name} (cópia)`.slice(0, 60), menu: { ...src.menu, photo: '', on: false } };
    try {
      await saveFicha(copy);
      setSnap(clean(f));
      toast('Cópia criada.');
      go(`#/ficha/${copy.id}`);
    } catch (ex) {
      toast(ex.message, { bad: true });
    }
  }

  const e = (k) => (err && err.field === k ? err.message : '');
  const lineOf = (i) => c?.lines.find((l) => l.idx === i);
  const probOf = (i) => c?.problems.find((p) => p.idx === i);

  return html`<form class="page editor" onSubmit=${save} novalidate>
    <${PageHead} title=${isSaved ? f.name || 'Receita' : f.sell.on ? 'Novo produto' : 'Nova receita base'} back=${{ href: f.sell.on ? '#/produtos' : '#/produtos?aba=bases', label: 'Produtos' }} />
    <div class="editor-grid">
      <div class="editor-main">
        <section class="panel">
          <${Field} label="Nome" error=${e('name')}>
            <input value=${f.name} maxlength="60" placeholder="Ex.: Bolo de pote de ninho" aria-invalid=${e('name') ? 'true' : undefined} onInput=${(ev) => up({ name: ev.currentTarget.value })} />
          </${Field}>
          <div class="grid-yield">
            <${Field} label="A receita inteira rende" error=${e('yieldQty')}>
              <div class="affix">
                <${NumInput} value=${f.yieldQty} onValue=${(v) => up({ yieldQty: v > 0 ? v : 0 })} placeholder="ex.: 25" invalid=${Boolean(e('yieldQty'))} />
                <select class="post-select" aria-label="Unidade do rendimento" value=${f.yieldUnit} onChange=${(ev) => up({ yieldUnit: ev.currentTarget.value })}>
                  ${Object.entries(YIELD_LABEL).map(([k, t]) => html`<option value=${k}>${t}</option>`)}
                </select>
              </div>
            </${Field}>
            <${Field} label="Perda ou quebra" hint="O que some no forno ou quebra.">
              <${NumInput} value=${f.lossPct} onValue=${(v) => up({ lossPct: v > 0 ? Math.min(90, v) : 0 })} suffix="%" max=${1} placeholder="0" />
            </${Field}>
            <${Field} label="Tempo de trabalho" hint="Seu tempo na receita toda, sem contar forno sozinho.">
              <${NumInput} value=${f.prepMin} onValue=${(v) => up({ prepMin: v > 0 ? Math.round(v) : 0 })} suffix="min" max=${0} placeholder="0" />
            </${Field}>
          </div>
          ${baseOf(f.yieldUnit) === 'un'
            ? html`<details class="more" open=${f.unitWeightG > 0}>
                <summary>Peso de cada unidade (opcional)</summary>
                <${Field} label="1 unidade pesa" hint="Serve para usar esta receita por peso dentro de outra. Ex.: brigadeiro de 18 g.">
                  <${NumInput} value=${f.unitWeightG} onValue=${(v) => up({ unitWeightG: v > 0 ? v : 0 })} suffix="g" max=${1} />
                </${Field}>
              </details>`
            : html`<details class="more" open=${f.unitWeightG > 0}>
                <summary>Tamanho da porção (opcional)</summary>
                <${Field} label="1 porção pesa" hint="Para usar esta receita em porções dentro de outra.">
                  <${NumInput} value=${f.unitWeightG} onValue=${(v) => up({ unitWeightG: v > 0 ? v : 0 })} suffix="g" max=${1} />
                </${Field}>
              </details>`}
        </section>

        <section class="panel">
          <h2>O que vai na receita</h2>
          ${f.parts.length ? null : html`<p class="muted small">Coloque cada ingrediente e embalagem na quantidade da receita inteira. Massas e recheios que você já montou entram como receita.</p>`}
          <ol class="parts">
            ${f.parts.map((p, i) => {
              const target = p.t === 'i' ? s.items.find((x) => x.id === p.id) : s.fichas.find((x) => x.id === p.id);
              const units = p.t === 'i' ? unitsForItem(target) : unitsForFicha(target);
              const ln = lineOf(i);
              const pr = probOf(i);
              const unitOpts = units.includes(p.unit) ? units : [p.unit, ...units];
              return html`<li class=${`part${pr && pr.why !== 'semPreco' && pr.why !== 'filha' ? ' part-bad' : ''}`}>
                <div class="part-top">
                  <span class="part-name">${p.t === 'f' ? html`<span class="chip">receita</span> ` : null}${target ? target.name : p.t === 'i' ? 'Ingrediente apagado' : 'Receita apagada'}</span>
                  <span class="part-cost num">${ln && !ln.bad ? brl(Math.round(ln.mat + ln.lab + ln.fix)) : ''}</span>
                </div>
                <div class="part-inputs">
                  <label class="sr-only" for=${`q-${i}`}>Quantidade de ${target?.name || 'item'}</label>
                  <${NumInput} id=${`q-${i}`} value=${p.qty} onValue=${(v) => setPart(i, { qty: v > 0 ? v : 0 })} placeholder="0" invalid=${Boolean(e(`parts.${i}`)) || !(p.qty > 0)} />
                  <label class="sr-only" for=${`u-${i}`}>Medida</label>
                  <select id=${`u-${i}`} value=${p.unit} onChange=${(ev) => setPart(i, { unit: ev.currentTarget.value })}>
                    ${unitOpts.map((u) => html`<option value=${u}>${partUnitLabel(u, target, p.t === 'i')}</option>`)}
                  </select>
                  <button type="button" class="btn btn-ghost btn-small" aria-label=${`Tirar ${target?.name || 'item'}`} onClick=${() => setF((x) => ({ ...x, parts: x.parts.filter((_, j) => j !== i) }))}>Tirar</button>
                </div>
                ${pr ? html`<p class=${`part-problem ${pr.why === 'semPreco' || pr.why === 'filha' ? 'warn' : 'bad'}`}>${(PROBLEM_TEXT[pr.why] || (() => 'Confira este item.'))(pr.name || target?.name || '')}</p>` : null}
                ${pr ? html`<${QuickFix} problem=${pr.why} part=${p} item=${p.t === 'i' ? target : null} child=${p.t === 'f' ? target : null} />` : null}
                ${e(`parts.${i}`) ? html`<p class="error-text">${e(`parts.${i}`)}</p>` : null}
              </li>`;
            })}
          </ol>
          <div class="part-add">
            <button type="button" class="btn" onClick=${() => setPicker('i')}>+ Ingrediente ou embalagem</button>
            <button type="button" class="btn" onClick=${() => setPicker('f')}>+ Outra receita</button>
          </div>
        </section>

        <section class="panel">
          <label class="check check-big">
            <input type="checkbox" checked=${f.sell.on} onChange=${(ev) => upSell({ on: ev.currentTarget.checked })} />
            <span><strong>Eu vendo isso</strong><span class="muted small">Desmarque para massas, recheios e coberturas que só entram em outros produtos.</span></span>
          </label>
          ${err?.code === 'limite_produtos' ? html`<p class="callout callout-warn">${err.message} <a href="#/conta?aba=plano">Ver o Pro</a></p>` : null}
          ${f.sell.on
            ? html`
              <div class="grid-2">
                <${Field} label="Nome da unidade de venda" hint=${unitSale === 'un' ? 'Como você chama 1 unidade: pote, fatia, caixa, marmita.' : `O preço é por ${unitSale === 'kg' ? 'quilo' : 'litro'}.`}>
                  <input value=${f.sell.label} maxlength="20" placeholder=${unitSale === 'un' ? 'unidade' : unitSale} onInput=${(ev) => upSell({ label: ev.currentTarget.value })} />
                </${Field}>
                <${Field} label=${`Seu preço por ${label} (Pix ou dinheiro)`} error=${e('sell.price')}>
                  <${MoneyInput} value=${f.sell.price} onValue=${(v) => upSell({ price: v > 0 ? v : 0 })} />
                </${Field}>
              </div>
              ${sugDirect?.ok && !(f.sell.price >= sugDirect.cents)
                ? html`<p class="suggest">Preço sugerido para ter ${pct(st.marginPct)} de lucro: <strong>${brl(sugDirect.cents)}</strong> <button type="button" class="btn btn-small" onClick=${() => upSell({ price: sugDirect.cents })}>Usar este preço</button></p>`
                : null}
              ${direct && f.sell.price > 0 ? html`<p class="verdict-line"><${Verdict} v=${direct.verdict} /> <span class="small muted">${VERDICT_HELP[direct.verdict.status]}</span></p>` : null}
              <h3 class="h-small">Em cada canal de venda</h3>
              <ul class="ch-list">
                ${table.map(
                  (r) => html`<li class="ch-row">
                    <div class="ch-name"><strong>${r.channel.name}</strong><span class="muted small">${r.channel.feePct ? `taxa de ${pct(r.channel.feePct, 1)}` : 'sem taxa'}</span></div>
                    <div class="ch-cell"><span class="mini-label">Sugerido</span><span class="num">${r.suggested.ok ? brl(r.suggested.cents) : '—'}</span></div>
                    <div class="ch-cell">
                      <span class="mini-label">Seu preço</span>
                      ${r.channel.id === 'direto'
                        ? html`<span class="num">${f.sell.price > 0 ? brl(f.sell.price) : '—'}</span>`
                        : html`<${MoneyInput} prefix=${false} placeholder=${f.sell.price > 0 ? (f.sell.price / 100).toFixed(2).replace('.', ',') : '0,00'} value=${f.sell.prices?.[r.channel.id] || 0} onValue=${(v) => upSell({ prices: { ...f.sell.prices, [r.channel.id]: v > 0 ? v : 0 } })} aria-label=${`Preço no ${r.channel.name}`} />`}
                    </div>
                    <div class="ch-cell ch-left">
                      <span class="mini-label">Sobra por ${label}</span>
                      ${r.price > 0 ? html`<span class=${`num ${r.verdict.profit < 0 ? 'neg' : ''}`}>${brl(Math.round(r.verdict.profit))}</span><${Verdict} v=${r.verdict} />` : html`<span class="muted">—</span>`}
                    </div>
                  </li>`,
                )}
              </ul>
              <p class="small muted">"Sobra" é o que fica depois de taxa, imposto, ingredientes, embalagem, seu tempo e os custos fixos. Os canais e taxas ficam em <a href="#/conta?aba=precos">Conta, preço e custos</a>.</p>

              <div class="menu-opts">
                <label class="check">
                  <input type="checkbox" checked=${f.menu.on} onChange=${(ev) => upMenu({ on: ev.currentTarget.checked })} />
                  <span><strong>Mostrar no cardápio online</strong>${!pro ? html`<span class="muted small">No grátis o cardápio mostra até ${s.account.limits.products} produtos.</span>` : null}</span>
                </label>
                ${f.menu.on
                  ? html`<div class="grid-2">
                      <${Field} label="Categoria" hint="Ex.: Bolos de pote, Docinhos, Marmitas fit.">
                        <input value=${f.menu.cat} maxlength="30" list="cats" onInput=${(ev) => upMenu({ cat: ev.currentTarget.value })} />
                        <datalist id="cats">${cats.map((c2) => html`<option value=${c2}></option>`)}</datalist>
                      </${Field}>
                      <${Field} label="Foto">
                        <${PhotoBox} ficha=${f} saved=${isSaved} />
                      </${Field}>
                    </div>
                    <${Field} label="Descrição no cardápio" hint=${`${240 - (f.menu.desc || '').length} letras restantes.`}>
                      <textarea maxlength="240" rows="2" value=${f.menu.desc} onInput=${(ev) => upMenu({ desc: ev.currentTarget.value })}></textarea>
                    </${Field}>`
                  : null}
              </div>`
            : null}
        </section>

        <section class="panel">
          <${Field} label="Modo de preparo e anotações">
            <textarea rows="4" maxlength="3000" value=${f.notes} onInput=${(ev) => up({ notes: ev.currentTarget.value })}></textarea>
          </${Field}>
        </section>
      </div>

      <aside class="editor-side">
        <div class="cost-card">
          <${Lcd} label=${`Custo por ${f.sell.on ? label : unitSale === 'un' ? 'unidade' : unitSale}`} cents=${c && !c.blocking ? c.sale.total : NaN} />
          ${c
            ? html`<dl class="cost-list">
                <div><dt>Ingredientes e embalagens</dt><dd class="num">${brl(Math.round(c.sale.mat))}</dd></div>
                <div><dt>Seu tempo</dt><dd class="num">${brl(Math.round(c.sale.lab))}</dd></div>
                <div><dt>Custos fixos</dt><dd class="num">${brl(Math.round(c.sale.fix))}</dd></div>
                <div class="sum"><dt>Receita inteira</dt><dd class="num">${brl(Math.round(c.batch.total))}</dd></div>
              </dl>
              <p class="small muted">Rende ${f.yieldQty > 0 ? yieldText(f) : '?'}${f.lossPct ? `, ${fmtNum(c.effYield / (unitSale === 'un' ? 1 : 1000), 2)} ${unitSale} depois da perda` : ''}. Seu tempo vale ${brl(Math.round(eng.hour))} por hora.</p>
              ${c.problems.some((p) => p.why === 'semPreco' || p.why === 'filha') ? html`<p class="callout callout-warn small">Tem ingrediente sem preço: o custo real é maior.</p>` : null}
              ${!(f.yieldQty > 0)
                ? html`<p class="callout small">Diga quanto a receita rende para ver o custo de cada unidade.</p>`
                : c.blocking
                  ? html`<p class="callout callout-bad small">Tem item com problema. Confira as linhas marcadas.</p>`
                  : null}`
            : null}
          ${f.sell.on && direct?.price > 0 && c && !c.blocking ? html`<div class="profit-line">Sobra por ${label} no direto: <strong class=${direct.verdict.profit < 0 ? 'neg' : 'pos'}>${brl(Math.round(direct.verdict.profit))}</strong></div>` : null}
        </div>
      </aside>
    </div>

    ${err && !err.field && err.code !== 'limite_produtos' ? html`<p class="callout callout-bad" role="alert">${err.message}</p>` : null}
    <div class="save-bar">
      <button class="btn btn-main" disabled=${busy}>${busy ? 'Salvando…' : 'Salvar'}</button>
      ${isSaved ? html`<button type="button" class="btn" onClick=${duplicate}>Duplicar</button>` : null}
      ${isSaved ? html`<button type="button" class="btn btn-danger" onClick=${remove}>Apagar</button>` : null}
      ${clean(f) !== snap ? html`<span class="small muted">Mudanças sem salvar</span>` : null}
      ${c && !c.blocking && c.sale.total > 0
        ? html`<span class="save-cost small">Custo <strong>${brl(Math.round(c.sale.total))}</strong>${f.sell.on && sugDirect?.ok ? html` · sugerido <strong>${brl(sugDirect.cents)}</strong>` : null}</span>`
        : null}
    </div>

    <${Sheet} open=${Boolean(picker)} title=${picker === 'i' ? 'Escolher ingrediente ou embalagem' : 'Escolher receita'} onClose=${() => setPicker(null)}>
      ${picker ? html`<${Picker} key=${picker} mode=${picker} selfId=${f.id} onPick=${addPart} />` : null}
    </${Sheet}>
  </form>`;
}

export { unitPrice };
