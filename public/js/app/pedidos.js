// Pedidos: agenda de entregas, pedidos do mês e o formulário de cada pedido.
import { html, useEffect, useMemo, useState } from '../vendor/index.mjs';
import { channelTable, itemSnapshot, orderMath } from '../shared/calc.js';
import { addMonths, brl, dayLabel, fmtNum, longDate, monthLabel, pct, phoneDigits, phoneText, STATUS_LABEL, timeText, today, waLink } from '../shared/format.js';
import { newId } from '../shared/schema.js';
import { copyText, toast } from '../lib/api.js';
import { ask, deleteOrder, engine, getOrder, isPro, loadMonth, loadOpen, markSeen, saveOrder, setOrderStatus, useStore } from './store.js';
import { Empty, ErrorBox, Field, Lcd, Loading, MoneyInput, NumInput, PageHead, Seg, go, guard, useDirty, useAsync } from './ui.js';
import { orderMessage, readyMessage } from './mensagens.js';
import { saleLabel } from './produtos.js';

export const STATUS_CLS = { orcamento: 'chip', confirmado: 'chip chip-dark', pronto: 'chip chip-yolk', entregue: 'chip chip-good', cancelado: 'chip chip-bad' };

export function itemsSummary(o, max = 3) {
  const parts = o.items.slice(0, max).map((it) => `${fmtNum(it.qty, 3)} ${it.name}`);
  if (o.items.length > max) parts.push(`+${o.items.length - max}`);
  return parts.join(', ');
}

export function PayChip({ o }) {
  if (o.status === 'cancelado') return null;
  const m = orderMath(o);
  if (m.total <= 0) return null;
  if (m.due <= 0) return html`<span class="chip chip-good">Pago</span>`;
  if (m.paid > 0) return html`<span class="chip chip-warn">Falta ${brl(m.due)}</span>`;
  return html`<span class="chip">A receber</span>`;
}

export function OrderRow({ o, showDate = false }) {
  const m = orderMath(o);
  return html`<li>
    <a class=${`row order-row${!o.seen ? ' is-new' : ''}`} href=${`#/pedido/${o.id}`}>
      <span class="order-when">${showDate ? html`<strong>${dayLabel(o.dueDate)}</strong>` : null}${o.dueTime ? html`<span class="num">${timeText(o.dueTime)}</span>` : null}</span>
      <span class="row-main">
        <strong>${!o.seen ? html`<span class="chip chip-yolk">Novo</span> ` : null}nº ${o.num} · ${o.customer || 'Cliente'}</strong>
        <span class="muted small">${itemsSummary(o)}${o.delivery === 'entrega' ? ' · entrega' : ''}</span>
      </span>
      <span class="row-side">
        <strong class="num">${brl(m.total)}</strong>
        <span class="chips"><span class=${STATUS_CLS[o.status]}>${STATUS_LABEL[o.status]}</span><${PayChip} o=${o} /></span>
      </span>
    </a>
  </li>`;
}

function groupByDay(orders) {
  const map = new Map();
  for (const o of orders) {
    if (!map.has(o.dueDate)) map.set(o.dueDate, []);
    map.get(o.dueDate).push(o);
  }
  return [...map.entries()];
}

function Agenda() {
  const { data, error, loading, reload } = useAsync(() => loadOpen(), []);
  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const t = today();
  const late = data.filter((o) => o.dueDate < t);
  const next = data.filter((o) => o.dueDate >= t);
  if (!data.length) {
    return html`<${Empty} title="Nenhum pedido em aberto.">
      <p class="muted">Lance as encomendas aqui para ver a agenda, o que comprar e quanto vai receber.</p>
      <p><a class="btn btn-main" href="#/pedido/novo">Lançar pedido</a></p>
    </${Empty}>`;
  }
  return html`<div class="agenda">
    ${late.length
      ? html`<section class="day day-late">
          <h2>Atrasados <span class="chip chip-bad">${late.length}</span></h2>
          <p class="small muted">Já passou do dia. Marque como entregue ou mude a data.</p>
          <ul class="rows">${late.map((o) => html`<${OrderRow} o=${o} showDate=${true} />`)}</ul>
        </section>`
      : null}
    ${groupByDay(next).map(
      ([d, list]) => html`<section class="day">
        <h2>${dayLabel(d)} <span class="muted day-sub">${dayLabel(d).includes(',') ? '' : longDate(d)}</span></h2>
        <ul class="rows">${list.map((o) => html`<${OrderRow} o=${o} />`)}</ul>
        <p class="day-total small muted">${list.length} ${list.length === 1 ? 'pedido' : 'pedidos'} · ${brl(list.reduce((a, o) => a + orderMath(o).total, 0))}</p>
      </section>`,
    )}
  </div>`;
}

function Mes({ ym, setYm }) {
  const { data, error, loading, reload } = useAsync(() => loadMonth(ym), [ym]);
  const totals = useMemo(() => {
    if (!data) return null;
    let sold = 0;
    let due = 0;
    let count = 0;
    for (const o of data) {
      if (o.status === 'cancelado') continue;
      const m = orderMath(o);
      count++;
      if (o.status === 'entregue') sold += m.total;
      if (o.status !== 'orcamento') due += m.due;
    }
    return { sold, due, count };
  }, [data]);
  return html`<div>
    <div class="month-nav">
      <button type="button" class="btn btn-small" onClick=${() => setYm(addMonths(ym, -1))} aria-label="Mês anterior">‹</button>
      <h2>${monthLabel(ym)}</h2>
      <button type="button" class="btn btn-small" onClick=${() => setYm(addMonths(ym, 1))} aria-label="Próximo mês">›</button>
    </div>
    ${loading && !data ? html`<${Loading} />` : error ? html`<${ErrorBox} error=${error} onRetry=${reload} />` : null}
    ${data
      ? html`
        <dl class="kpis kpis-3">
          <div><dt>Pedidos</dt><dd>${totals.count}</dd></div>
          <div><dt>Entregue</dt><dd class="num">${brl(totals.sold)}</dd></div>
          <div><dt>A receber</dt><dd class="num">${brl(totals.due)}</dd></div>
        </dl>
        ${data.length ? html`<ul class="rows">${data.map((o) => html`<${OrderRow} o=${o} showDate=${true} />`)}</ul>` : html`<${Empty} title="Nenhum pedido neste mês." />`}`
      : null}
  </div>`;
}

export function Pedidos({ route }) {
  const s = useStore();
  const [mode, setMode] = useState(route.q.get('modo') === 'mes' ? 'mes' : 'agenda');
  const [ym, setYm] = useState(route.q.get('mes') || today().slice(0, 7));
  const pro = isPro(s);
  const lim = s.account.limits.ordersMonth;
  return html`<div class="page">
    <${PageHead} title="Pedidos" sub="Encomendas e vendas, com a data de entrega e quanto falta receber.">
      <a class="btn btn-main" href="#/pedido/novo">Novo pedido</a>
    </${PageHead}>
    <${Seg} label="Ver" value=${mode} onChange=${setMode} options=${[{ v: 'agenda', label: 'Agenda' }, { v: 'mes', label: 'Por mês' }]} />
    ${!pro && lim ? html`<p class="small muted usage">${s.account.usage.ordersMonth} de ${lim} pedidos lançados neste mês no plano grátis. Pedidos do cardápio não contam.</p>` : null}
    ${mode === 'agenda' ? html`<${Agenda} />` : html`<${Mes} ym=${ym} setYm=${setYm} />`}
  </div>`;
}

// ---------- Formulário do pedido ----------
function blankOrder(q) {
  return { id: newId(), customer: '', phone: '', dueDate: q.get('data') || today(), dueTime: '', delivery: 'retirada', address: '', deliveryFee: 0, discount: 0, channel: 'direto', items: [], paid: 0, status: 'confirmado', notes: '' };
}

const snapOf = (o) =>
  JSON.stringify({ c: o.customer, p: o.phone, d: o.dueDate, t: o.dueTime, dl: o.delivery, a: o.address, df: o.deliveryFee, di: o.discount, ch: o.channel, it: o.items.map((i) => [i.f, i.name, i.qty, i.price]), pa: o.paid, st: o.status, n: o.notes });

export function PedidoEditor({ id, q }) {
  const isNew = !id || id === 'novo';
  const { data, error, loading, reload } = useAsync(() => (isNew ? null : getOrder(id)), [id]);
  if (!isNew && loading) return html`<div class="page"><${Loading} /></div>`;
  if (!isNew && error) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;
  return html`<${OrderForm} initial=${isNew ? blankOrder(q) : data} isNew=${isNew} />`;
}

const prep = (x) => ({ ...structuredClone(x), phone: phoneText(x.phone) || x.phone || '' });

function OrderForm({ initial, isNew }) {
  const s = useStore();
  const [o, setO] = useState(() => prep(initial));
  const [snap, setSnap] = useState(() => snapOf(prep(initial)));
  const [saved, setSaved] = useState(isNew ? null : initial);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wasUnseen] = useState(!initial.seen && initial.origin === 'cardapio');
  const eng = engine(s);
  const st = s.account.settings;
  const products = s.fichas.filter((f) => f.sell?.on);
  const up = (patch) => setO((x) => ({ ...x, ...patch }));
  const setItem = (i, patch) => setO((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  useDirty(snapOf(o) !== snap);
  useEffect(() => {
    if (wasUnseen && !isNew) markSeen(initial).catch(() => {});
  }, []);

  const priceFor = (f, channel) => {
    const row = channelTable(eng, f).find((r) => r.channel.id === channel);
    if (row?.price > 0) return { price: row.price, suggested: false };
    if (row?.suggested?.ok) return { price: row.suggested.cents, suggested: true };
    return { price: 0, suggested: false };
  };

  const pickProduct = (i, fid) => {
    if (fid === '') return setItem(i, { f: '', name: '' });
    const f = s.fichas.find((x) => x.id === fid);
    const pr = priceFor(f, o.channel);
    setItem(i, { f: fid, name: f.name, price: pr.price, ...itemSnapshot(eng, fid) });
  };

  const changeChannel = async (ch) => {
    const withFicha = o.items.filter((it) => it.f);
    up({ channel: ch });
    if (withFicha.length && (await ask({ title: 'Usar os preços deste canal?', text: 'Os itens do pedido passam a ter o preço que você definiu para este canal.', ok: 'Usar preços do canal', cancel: 'Manter os preços' }))) {
      setO((x) => ({ ...x, channel: ch, items: x.items.map((it) => (it.f && s.fichas.some((f) => f.id === it.f) ? { ...it, price: priceFor(s.fichas.find((f) => f.id === it.f), ch).price } : it)) }));
    }
  };

  // Custo estimado com as receitas de hoje; o servidor refaz a conta ao salvar.
  const preview = useMemo(() => {
    const ch = st.channels.find((c) => c.id === o.channel) || st.channels[0];
    const items = o.items.map((it) => (it.f && eng.fichas.has(it.f) ? { ...it, ...itemSnapshot(eng, it.f) } : it));
    return orderMath({ ...o, items, feePct: ch.feePct, taxPct: st.taxPct });
  }, [o, eng]);

  async function save(e) {
    e?.preventDefault();
    setErr(null);
    if (!o.items.length) return setErr({ field: 'items', message: 'Coloque pelo menos um item.' });
    const bad = o.items.findIndex((it) => !it.name.trim() || !(it.qty > 0));
    if (bad >= 0) return setErr({ field: `items.${bad}`, message: `Item ${bad + 1}: escolha o produto e a quantidade.` });
    if (!o.dueDate) return setErr({ field: 'dueDate', message: 'Escolha a data.' });
    setBusy(true);
    try {
      const r = await saveOrder(o);
      setSaved({ ...r, savedOnce: true });
      setO(prep(r));
      setSnap(snapOf(prep(r)));
      toast(isNew && !saved ? `Pedido nº ${r.num} criado.` : 'Pedido salvo.');
      if (isNew && !saved) setTimeout(() => go(`#/pedido/${r.id}`, { replace: true }), 0);
    } catch (ex) {
      setErr({ field: ex.field, message: ex.message, code: ex.code });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await ask({ title: `Apagar o pedido nº ${o.num}?`, text: 'Ele some da agenda e do lucro do mês. Para guardar o histórico, prefira marcar como cancelado.', ok: 'Apagar', danger: true }))) return;
    await deleteOrder(o.id);
    setSnap(snapOf(o));
    toast('Pedido apagado.');
    go('#/pedidos', { replace: true });
  }

  async function quickStatus(status, paidAll = false) {
    if (snapOf(o) !== snap) return setErr({ message: 'Salve as mudanças antes de mudar a situação.' });
    try {
      const r = await setOrderStatus(o.id, status, paidAll ? preview.total : undefined);
      setO(prep(r));
      setSnap(snapOf(prep(r)));
      setSaved({ ...r, savedOnce: true });
      toast(`Pedido ${STATUS_LABEL[status].toLowerCase()}.`);
    } catch (ex) {
      toast(ex.message, { bad: true });
    }
  }

  const e = (k) => (err && err.field === k ? err.message : '');
  const origin = location.origin;
  const isSaved = Boolean(saved);
  const phone = phoneDigits(o.phone);
  const dirty = snapOf(o) !== snap;

  return html`<form class="page editor" onSubmit=${save} novalidate>
    <${PageHead} title=${isSaved ? `Pedido nº ${o.num}` : 'Novo pedido'} sub=${isSaved && o.origin === 'cardapio' ? 'Chegou pelo cardápio online.' : ''} back=${{ href: '#/pedidos', label: 'Pedidos' }} />
    <div class="editor-grid">
      <div class="editor-main">
        <section class="panel">
          <div class="grid-2">
            <${Field} label="Cliente">
              <input value=${o.customer} maxlength="60" autocomplete="off" placeholder="Nome" onInput=${(ev) => up({ customer: ev.currentTarget.value })} />
            </${Field}>
            <${Field} label="WhatsApp" hint=${o.phone && !phone ? 'Use DDD e número.' : ''}>
              <input value=${o.phone} inputmode="tel" autocomplete="off" placeholder="(11) 98765-4321" onInput=${(ev) => up({ phone: ev.currentTarget.value })} />
            </${Field}>
          </div>
          <div class="grid-3">
            <${Field} label="Para quando" error=${e('dueDate')}>
              <input type="date" value=${o.dueDate} onInput=${(ev) => up({ dueDate: ev.currentTarget.value })} />
            </${Field}>
            <${Field} label="Horário">
              <input type="time" value=${o.dueTime} onInput=${(ev) => up({ dueTime: ev.currentTarget.value })} />
            </${Field}>
            <div class="field">
              <span class="label">Como entrega</span>
              <${Seg} small label="Entrega" value=${o.delivery} onChange=${(v) => up({ delivery: v })} options=${[{ v: 'retirada', label: 'Retirada' }, { v: 'entrega', label: 'Entrega' }]} />
            </div>
          </div>
          ${o.delivery === 'entrega'
            ? html`<div class="grid-2">
                <${Field} label="Endereço"><textarea rows="2" maxlength="200" value=${o.address} onInput=${(ev) => up({ address: ev.currentTarget.value })}></textarea></${Field}>
                <${Field} label="Taxa de entrega" hint="Entra no total, mas não no lucro: paga a entrega."><${MoneyInput} value=${o.deliveryFee} onValue=${(v) => up({ deliveryFee: v > 0 ? v : 0 })} /></${Field}>
              </div>`
            : null}
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Itens</h2>
            <label class="inline-field small">Canal
              <select value=${o.channel} onChange=${(ev) => changeChannel(ev.currentTarget.value)}>
                ${st.channels.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
              </select>
            </label>
          </div>
          ${e('items') ? html`<p class="error-text">${e('items')}</p>` : null}
          <ol class="order-items">
            ${o.items.map((it, i) => {
              const f = it.f ? s.fichas.find((x) => x.id === it.f) : null;
              const free = !it.f;
              return html`<li class="order-item">
                <div class="oi-name">
                  <label class="sr-only" for=${`p-${i}`}>Produto</label>
                  <select id=${`p-${i}`} value=${it.f || ''} onChange=${(ev) => pickProduct(i, ev.currentTarget.value)}>
                    <option value="">Outro item (escrever)</option>
                    ${products.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
                    ${it.f && !products.some((p) => p.id === it.f) ? html`<option value=${it.f}>${it.name}</option>` : null}
                  </select>
                  ${free ? html`<input aria-label="Nome do item" value=${it.name} maxlength="80" placeholder="Ex.: Topo de bolo" onInput=${(ev) => setItem(i, { name: ev.currentTarget.value })} />` : null}
                </div>
                <div class="oi-nums">
                  <label class="mini">Qtd.<${NumInput} value=${it.qty} onValue=${(v) => setItem(i, { qty: v > 0 ? v : 0 })} invalid=${!(it.qty > 0) || Boolean(e(`items.${i}`))} suffix=${f ? saleLabel(f) : ''} /></label>
                  <label class="mini">Preço${f ? ` por ${saleLabel(f)}` : ''}<${MoneyInput} value=${it.price} onValue=${(v) => setItem(i, { price: v > 0 ? v : 0 })} /></label>
                  <span class="oi-sub num">${brl(Math.round((it.qty || 0) * (it.price || 0)))}</span>
                  <button type="button" class="btn btn-ghost btn-small" aria-label="Tirar item" onClick=${() => setO((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))}>Tirar</button>
                </div>
                ${e(`items.${i}`) ? html`<p class="error-text">${e(`items.${i}`)}</p>` : null}
              </li>`;
            })}
          </ol>
          <button type="button" class="btn" onClick=${() => setO((x) => ({ ...x, items: [...x.items, { f: '', name: '', qty: 1, price: 0, cost: 0, min: 0 }] }))}>+ Item</button>
          ${!products.length ? html`<p class="small muted">Dica: monte seus produtos em <a href="#/produtos">Produtos</a> para o preço e o custo entrarem sozinhos.</p>` : null}
          <div class="grid-2 discount">
            <${Field} label="Desconto"><${MoneyInput} value=${o.discount} onValue=${(v) => up({ discount: v > 0 ? v : 0 })} /></${Field}>
          </div>
        </section>

        <section class="panel">
          <h2>Pagamento e situação</h2>
          <div class="grid-2">
            <${Field} label="Já recebido">
              <${MoneyInput} value=${o.paid} onValue=${(v) => up({ paid: v > 0 ? v : 0 })} />
            </${Field}>
            <div class="field">
              <span class="label">Atalhos</span>
              <div class="chips-row">
                <button type="button" class="btn btn-small" onClick=${() => up({ paid: 0 })}>Nada</button>
                <button type="button" class="btn btn-small" onClick=${() => up({ paid: Math.round(preview.total / 2) })}>Sinal de 50%</button>
                <button type="button" class="btn btn-small" onClick=${() => up({ paid: preview.total })}>Tudo</button>
              </div>
            </div>
          </div>
          <div class="field">
            <span class="label">Situação</span>
            <${Seg} label="Situação" value=${o.status} onChange=${(v) => up({ status: v })} options=${['orcamento', 'confirmado', 'pronto', 'entregue', 'cancelado'].map((k) => ({ v: k, label: STATUS_LABEL[k] }))} />
          </div>
          <${Field} label="Observações" hint="Só você vê. Não aparece para o cliente.">
            <textarea rows="3" maxlength="1000" value=${o.notes} onInput=${(ev) => up({ notes: ev.currentTarget.value })}></textarea>
          </${Field}>
        </section>
      </div>

      <aside class="editor-side">
        <div class="cost-card">
          <${Lcd} label="Total do pedido" cents=${preview.total} />
          <dl class="cost-list">
            <div><dt>Itens</dt><dd class="num">${brl(preview.items)}</dd></div>
            ${preview.delivery ? html`<div><dt>Entrega</dt><dd class="num">${brl(preview.delivery)}</dd></div>` : null}
            ${preview.discount ? html`<div><dt>Desconto</dt><dd class="num">-${brl(preview.discount)}</dd></div>` : null}
            <div class="sum"><dt>Recebido</dt><dd class="num">${brl(Math.min(preview.paid, preview.total))}</dd></div>
            <div class=${preview.due > 0 ? 'due' : ''}><dt>Falta receber</dt><dd class="num">${brl(preview.due)}</dd></div>
          </dl>
          <dl class="cost-list cost-list-quiet">
            <div><dt>Ingredientes e embalagens</dt><dd class="num">${brl(Math.round(preview.mat))}</dd></div>
            ${preview.fee ? html`<div><dt>Taxa do canal</dt><dd class="num">${brl(Math.round(preview.fee))}</dd></div>` : null}
            ${preview.tax ? html`<div><dt>Imposto</dt><dd class="num">${brl(Math.round(preview.tax))}</dd></div>` : null}
            <div class="sum"><dt>Sobra do pedido</dt><dd class=${`num ${preview.contribution < 0 ? 'neg' : 'pos'}`}>${brl(Math.round(preview.contribution))}</dd></div>
          </dl>
          <p class="small muted">A sobra paga seu tempo (${fmtNum(preview.min / 60, 1)} h neste pedido) e os custos fixos.${preview.revenue > 0 ? ` É ${pct((preview.contribution / preview.revenue) * 100)} do valor.` : ''}</p>
        </div>
        ${isSaved
          ? html`<div class="side-actions">
              <a class="btn btn-block" href=${waLink(orderMessage(o, s.account, origin), phone)} target="_blank" rel="noopener">Mandar resumo no WhatsApp</a>
              ${o.status === 'pronto' ? html`<a class="btn btn-block" href=${waLink(readyMessage(o, s.account), phone)} target="_blank" rel="noopener">Avisar que está pronto</a>` : null}
              <button type="button" class="btn btn-block" onClick=${async () => ((await copyText(`${origin}/p/${o.token}`)) ? toast('Link do pedido copiado.') : toast(`${origin}/p/${o.token}`, { ms: 9000 }))}>Copiar link para o cliente</button>
              ${o.status === 'confirmado' ? html`<button type="button" class="btn btn-block" onClick=${() => quickStatus('pronto')}>Marcar como pronto</button>` : null}
              ${o.status === 'pronto' || o.status === 'confirmado' ? html`<button type="button" class="btn btn-block" onClick=${() => quickStatus('entregue', preview.due > 0)}>${preview.due > 0 ? 'Entregue e recebido' : 'Marcar como entregue'}</button>` : null}
            </div>`
          : null}
      </aside>
    </div>
    ${err && !err.field ? html`<p class=${`callout ${err.code ? 'callout-warn' : 'callout-bad'}`} role="alert">${err.message} ${err.code === 'limite_pedidos' ? html`<a href="#/conta?aba=plano">Ver o Pro</a>` : null}</p>` : null}
    <div class="save-bar">
      <button class="btn btn-main" disabled=${busy}>${busy ? 'Salvando…' : isSaved ? 'Salvar' : 'Criar pedido'}</button>
      ${isSaved ? html`<button type="button" class="btn btn-danger" onClick=${remove}>Apagar</button>` : null}
      ${dirty ? html`<span class="small muted">Mudanças sem salvar</span>` : null}
      ${isSaved && o.phone ? html`<span class="small muted save-bar-phone">${phoneText(o.phone)}</span>` : null}
    </div>
  </form>`;
}
