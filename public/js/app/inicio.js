// Início: o que entregar hoje, o que está atrasado, preços em alerta e como vai o mês.
import { html, useMemo } from '../vendor/index.mjs';
import { alerts, monthReport, orderMath, receivable } from '../shared/calc.js';
import { addDays, brl, longDate, monthLabel, today } from '../shared/format.js';
import { toast } from '../lib/api.js';
import { engine, isPro, loadMonth, loadOpen, saveAccount, setOrderStatus, useStore } from './store.js';
import { ErrorBox, Loading, useAsync, Verdict } from './ui.js';
import { OrderRow } from './pedidos.js';
import { saleLabel } from './produtos.js';

function Checklist({ s, hasOrders }) {
  const st = s.account.settings;
  const priced = s.items.filter((i) => i.pkgPrice > 0).length;
  const eng = engine(s);
  const steps = [
    { done: priced >= 3, title: 'Coloque o preço que você paga nos ingredientes', text: 'Use a última nota do mercado. Dá para atualizar vários de uma vez.', href: '#/ingredientes' },
    {
      done: s.fichas.some((f) => f.sell?.on && f.sell.price > 0 && !eng.cost(f.id)?.blocking && !/\(exemplo\)/.test(f.name)),
      title: 'Monte a ficha de um produto que você vende',
      text: 'Ingredientes, embalagem e quanto rende. O app mostra o custo e o preço certo.',
      href: '#/ficha/nova',
    },
    { done: st.fixed.length > 0, title: 'Diga quanto quer ganhar e seus custos fixos', text: 'Gás, luz, internet. Assim o preço paga o seu trabalho também.', href: '#/conta?aba=precos' },
    { done: hasOrders, title: 'Lance o primeiro pedido', text: 'A agenda, a lista de compras e o lucro saem dos pedidos.', href: '#/pedido/novo' },
    { done: Boolean(st.whatsapp) && s.fichas.some((f) => f.menu?.on), title: 'Divulgue seu cardápio online', text: 'Um link para o cliente escolher e mandar o pedido pronto.', href: '#/cardapio' },
  ];
  const left = steps.filter((x) => !x.done).length;
  if (!left || st.setupDone) return null;
  const hide = async () => {
    try {
      await saveAccount({ settings: { ...st, setupDone: true } });
    } catch (e) {
      toast(e.message, { bad: true });
    }
  };
  return html`<section class="panel checklist">
    <div class="panel-head">
      <h2>Primeiros passos</h2>
      <span class="muted small">${steps.length - left} de ${steps.length}</span>
    </div>
    <ol>
      ${steps.map(
        (x) => html`<li class=${x.done ? 'done' : ''}>
          <span class="tick" aria-hidden="true">${x.done ? '✓' : ''}</span>
          <span><a href=${x.href}><strong>${x.title}</strong></a><span class="muted small">${x.text}</span></span>
          <span class="sr-only">${x.done ? 'feito' : 'a fazer'}</span>
        </li>`,
      )}
    </ol>
    <button type="button" class="btn-link small muted" onClick=${hide}>Esconder esta lista</button>
  </section>`;
}

function TodayList({ title, list, actions }) {
  if (!list.length) return null;
  return html`<section class="day">
    <h2>${title}</h2>
    <ul class="rows">
      ${list.map(
        (o) => html`<${OrderRow} o=${o} />
          ${actions ? html`<li class="row-actions">${actions(o)}</li>` : null}`,
      )}
    </ul>
  </section>`;
}

export function Inicio() {
  const s = useStore();
  const ym = today().slice(0, 7);
  const open = useAsync(() => loadOpen(), [s.open === null]);
  const month = useAsync(() => loadMonth(ym), [ym, s.months[ym] === undefined]);
  const eng = engine(s);
  const bad = useMemo(() => alerts(eng, s.fichas).filter((a) => a.channel.id === 'direto').slice(0, 4), [eng, s.fichas]);
  const t = today();
  const tomorrow = addDays(t, 1);

  if ((open.loading && !open.data) || (month.loading && !month.data)) return html`<div class="page"><${Loading} /></div>`;
  if (open.error || month.error) return html`<div class="page"><${ErrorBox} error=${open.error || month.error} onRetry=${() => (open.reload(), month.reload())} /></div>`;

  const orders = open.data || [];
  const late = orders.filter((o) => o.dueDate < t);
  const dueToday = orders.filter((o) => o.dueDate === t);
  const dueTomorrow = orders.filter((o) => o.dueDate === tomorrow);
  const fresh = orders.filter((o) => !o.seen);
  const rep = monthReport(month.data || [], s.account.settings, ym);
  const all = [...orders, ...(month.data || []).filter((o) => !orders.some((x) => x.id === o.id))];
  const rec = receivable(all);
  const week = orders.filter((o) => o.dueDate > tomorrow && o.dueDate <= addDays(t, 7));

  const deliver = async (o) => {
    try {
      const m = orderMath(o);
      await setOrderStatus(o.id, 'entregue', m.due > 0 ? m.total : undefined);
      toast(`Pedido nº ${o.num} entregue.`);
    } catch (e) {
      toast(e.message, { bad: true });
    }
  };
  const ready = async (o) => {
    try {
      await setOrderStatus(o.id, 'pronto');
      toast(`Pedido nº ${o.num} pronto.`);
    } catch (e) {
      toast(e.message, { bad: true });
    }
  };
  const actions = (o) =>
    o.status === 'orcamento'
      ? null
      : html`${o.status === 'confirmado' ? html`<button type="button" class="btn btn-small" onClick=${() => ready(o)}>Pronto</button>` : null}
          <button type="button" class="btn btn-small" onClick=${() => deliver(o)}>${orderMath(o).due > 0 ? 'Entregue e recebido' : 'Entregue'}</button>`;

  return html`<div class="page home">
    <header class="page-head">
      <p class="muted home-date">${longDate(t)}</p>
      <h1>${s.account.business}</h1>
    </header>

    <${Checklist} s=${s} hasOrders=${all.length > 0} />

    ${fresh.length
      ? html`<a class="callout callout-yolk callout-link" href="#/pedidos">
          <strong>${fresh.length === 1 ? '1 pedido novo' : `${fresh.length} pedidos novos`} pelo cardápio.</strong> Confira e confirme com o cliente.
        </a>`
      : null}

    <div class="home-grid">
      <div class="home-main">
        ${late.length ? html`<${TodayList} title=${`Atrasados (${late.length})`} list=${late} actions=${actions} />` : null}
        ${dueToday.length
          ? html`<${TodayList} title="Para hoje" list=${dueToday} actions=${actions} />`
          : html`<section class="day"><h2>Para hoje</h2><p class="muted">Nada para entregar hoje.${!orders.length ? ' ' : ''}${!orders.length ? html`<a href="#/pedido/novo">Lançar um pedido</a>` : null}</p></section>`}
        <${TodayList} title="Amanhã" list=${dueTomorrow} />
        ${week.length ? html`<p class="small muted">Mais ${week.length} ${week.length === 1 ? 'pedido' : 'pedidos'} nos próximos 7 dias. <a href="#/pedidos">Ver agenda</a> · <a href="#/compras">Lista de compras</a></p>` : null}
      </div>
      <aside class="home-side">
        <section class="panel">
          <h2>${monthLabel(ym).replace(/^./, (c) => c.toUpperCase())}</h2>
          <dl class="kpis">
            <div><dt>Vendido e entregue</dt><dd class="num">${brl(rep.revenue)}</dd></div>
            <div><dt>Sobrou para você</dt><dd class=${`num ${rep.earnings < 0 ? 'neg' : ''}`}>${brl(Math.round(rep.earnings))}</dd></div>
            <div><dt>A receber</dt><dd class="num">${brl(rec.due)}</dd></div>
          </dl>
          <p class="small muted">"Sobrou" já desconta ingredientes, taxas e os custos fixos do mês. <a href="#/lucro">Ver o mês</a></p>
        </section>
        ${bad.length
          ? html`<section class="panel">
              <h2>Preço em alerta</h2>
              <ul class="alert-list">
                ${bad.map(
                  (a) => html`<li><a href=${`#/ficha/${a.ficha.id}`}><strong>${a.ficha.name}</strong></a>
                    <span class="small">${brl(a.price)} por ${saleLabel(a.ficha)}${a.suggested.ok ? `, sugerido ${brl(a.suggested.cents)}` : ''}</span>
                    <${Verdict} v=${a.verdict} /></li>`,
                )}
              </ul>
            </section>`
          : null}
        ${!isPro(s) && s.account.limits.ordersMonth
          ? html`<section class="panel panel-quiet">
              <h2>Plano grátis</h2>
              <p class="small">${s.account.usage.ordersMonth} de ${s.account.limits.ordersMonth} pedidos neste mês e ${s.account.usage.products} de ${s.account.limits.products} produtos à venda.</p>
              <a class="btn btn-main btn-small" href="#/conta?aba=plano">Conhecer o Pro</a>
            </section>`
          : null}
      </aside>
    </div>
  </div>`;
}
