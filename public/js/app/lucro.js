// Lucro do mês: quanto entrou, quanto foi embora em ingredientes, taxas e custos fixos, e quanto sobrou para você.
import { html, useMemo, useState } from '../vendor/index.mjs';
import { monthReport, orderMath } from '../shared/calc.js';
import { addMonths, brl, fmtNum, monthLabel, pct, today } from '../shared/format.js';
import { isPro, loadMonth, useStore } from './store.js';
import { Empty, ErrorBox, Loading, PageHead, ProLock, useAsync } from './ui.js';
import { STATUS_LABEL } from '../shared/format.js';

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ordersCsv(orders) {
  const head = ['Número', 'Data', 'Cliente', 'Situação', 'Itens', 'Total', 'Recebido', 'Falta', 'Ingredientes e embalagens', 'Taxa', 'Sobra'];
  const money = (c) => (Math.round(c) / 100).toFixed(2).replace('.', ',');
  const rows = orders.map((o) => {
    const m = orderMath(o);
    return [o.num, o.dueDate.split('-').reverse().join('/'), o.customer, STATUS_LABEL[o.status], o.items.map((i) => `${fmtNum(i.qty, 3)} ${i.name}`).join(' + '), money(m.total), money(Math.min(m.paid, m.total)), money(m.due), money(m.mat), money(m.fee + m.tax), money(m.contribution)];
  });
  return `﻿${[head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

function downloadCsv(orders, ym) {
  const blob = new Blob([ordersCsv(orders)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pedidos-${ym}.csv`;
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

function Bar({ value, max, cls = '' }) {
  const w = max > 0 ? Math.max(2, Math.min(100, (Math.abs(value) / max) * 100)) : 0;
  return html`<span class=${`bar ${cls}`}><span class="bar-fill" ref=${(el) => el && el.style.setProperty('--w', `${w}%`)}></span></span>`;
}

export function Lucro({ route }) {
  const s = useStore();
  const [ym, setYm] = useState(route.q.get('mes') || today().slice(0, 7));
  const { data, error, loading, reload } = useAsync(() => loadMonth(ym), [ym, s.months[ym] === undefined]);
  const r = useMemo(() => (data ? monthReport(data, s.account.settings, ym) : null), [data, s.account.settings]);
  const pro = isPro(s);
  const st = s.account.settings;

  const head = html`<div class="month-nav">
    <button type="button" class="btn btn-small" onClick=${() => setYm(addMonths(ym, -1))} aria-label="Mês anterior">‹</button>
    <h2>${monthLabel(ym)}</h2>
    <button type="button" class="btn btn-small" onClick=${() => setYm(addMonths(ym, 1))} aria-label="Próximo mês" disabled=${ym >= today().slice(0, 7)}>›</button>
  </div>`;

  if (loading && !data) return html`<div class="page"><${PageHead} title="Lucro do mês" />${head}<${Loading} /></div>`;
  if (error) return html`<div class="page"><${PageHead} title="Lucro do mês" />${head}<${ErrorBox} error=${error} onRetry=${reload} /></div>`;

  const steps = [
    { label: 'Vendas entregues', value: r.revenue, note: r.discount ? `já com ${brl(r.discount)} de desconto` : '' },
    { label: 'Ingredientes e embalagens', value: -r.mat },
    { label: 'Taxas de cartão e apps', value: -Math.round(r.fee) },
    ...(r.tax ? [{ label: 'Imposto sobre a venda', value: -Math.round(r.tax) }] : []),
    { label: 'Sobra das vendas', value: Math.round(r.contribution), total: true },
    { label: 'Custos fixos do mês', value: -r.fixed, note: st.fixed.length ? st.fixed.map((x) => x.name).join(', ') : 'nenhum cadastrado' },
    { label: 'Sobrou para você', value: Math.round(r.earnings), total: true, big: true },
  ];
  const max = Math.max(...steps.map((x) => Math.abs(x.value)), 1);
  const topMax = Math.max(...r.byProduct.map((p) => Math.abs(p.contribution)), 1);
  const names = Object.fromEntries(st.channels.map((c) => [c.id, c.name]));

  const products = html`<section class="panel">
    <h2>Por produto</h2>
    ${r.byProduct.length
      ? html`<div class="table-wrap"><table class="report">
          <thead><tr><th scope="col">Produto</th><th scope="col">Qtd.</th><th scope="col">Vendas</th><th scope="col">Sobra</th><th scope="col"><span class="sr-only">Gráfico</span></th></tr></thead>
          <tbody>${r.byProduct.map(
            (p) => html`<tr>
              <th scope="row">${p.name}</th>
              <td class="num">${fmtNum(p.qty, 3)}</td>
              <td class="num">${brl(Math.round(p.revenue))}</td>
              <td class=${`num ${p.contribution < 0 ? 'neg' : ''}`}>${brl(Math.round(p.contribution))}</td>
              <td class="bar-cell"><${Bar} value=${p.contribution} max=${topMax} cls=${p.contribution < 0 ? 'bar-neg' : ''} /></td>
            </tr>`,
          )}</tbody>
        </table></div>`
      : html`<p class="muted">Nenhuma venda entregue neste mês.</p>`}
  </section>`;

  const channels = html`<section class="panel">
    <h2>Por canal de venda</h2>
    ${r.byChannel.length
      ? html`<ul class="rows">${r.byChannel.map(
          (c) => html`<li class="row"><span class="row-main"><strong>${names[c.id] || c.id}</strong><span class="muted small">${c.count} ${c.count === 1 ? 'pedido' : 'pedidos'} · taxas ${brl(Math.round(c.fee))}</span></span>
            <span class="row-side"><strong class="num">${brl(Math.round(c.revenue))}</strong><span class="muted small">sobra ${brl(Math.round(c.contribution))}</span></span></li>`,
        )}</ul>`
      : html`<p class="muted">Nenhuma venda entregue neste mês.</p>`}
  </section>`;

  return html`<div class="page">
    <${PageHead} title="Lucro do mês" sub="Conta feita com os pedidos entregues, o custo de cada receita e os custos fixos.">
      ${pro && data?.length ? html`<button type="button" class="btn" onClick=${() => downloadCsv(data, ym)}>Baixar planilha</button>` : null}
    </${PageHead}>
    ${head}
    ${!r.count
      ? html`<${Empty} title="Nenhum pedido entregue neste mês.">
          <p class="muted">Quando você marcar um pedido como entregue, ele entra aqui com o custo e a sobra.</p>
          ${data?.length ? html`<p class="small muted">${data.length} ${data.length === 1 ? 'pedido está' : 'pedidos estão'} neste mês, ainda sem entrega. <a href=${`#/pedidos?modo=mes&mes=${ym}`}>Ver pedidos</a></p>` : null}
        </${Empty}>`
      : html`<div class="report-grid">
      <section class="panel waterfall">
        <ol>
          ${steps.map(
            (x) => html`<li class=${`${x.total ? 'is-total' : ''} ${x.big ? 'is-big' : ''}`}>
              <span class="wf-label">${x.label}${x.note ? html`<span class="muted small">${x.note}</span>` : null}</span>
              <span class=${`wf-value num ${x.value < 0 && x.total ? 'neg' : ''}`}>${x.value < 0 && !x.total ? `- ${brl(-x.value)}` : brl(x.value)}</span>
              <${Bar} value=${x.value} max=${max} cls=${x.value < 0 ? (x.total ? 'bar-neg' : 'bar-out') : x.total ? 'bar-total' : ''} />
            </li>`,
          )}
        </ol>
      </section>
      <section class="panel">
        <dl class="kpis">
          <div><dt>Pedidos entregues</dt><dd>${r.count}</dd></div>
          <div><dt>Horas de trabalho</dt><dd>${fmtNum(r.hours, 1)} h</dd></div>
          <div><dt>Ganho por hora</dt><dd class="num">${r.perHour === null ? '—' : brl(Math.round(r.perHour))}</dd></div>
          <div><dt>Sua meta de salário</dt><dd class="num">${brl(r.wage)}</dd></div>
        </dl>
        <p class="small muted">
          ${r.wage > 0 && r.count
            ? r.earnings >= r.wage
              ? `Bateu a meta: sobrou ${brl(Math.round(r.afterWage))} além do seu salário. Esse é o lucro do negócio.`
              : `Faltam ${brl(Math.round(r.wage - r.earnings))} para chegar ao salário que você quer (${pct((r.earnings / r.wage) * 100)} da meta).`
            : 'As horas vêm do tempo de trabalho de cada receita.'}
        </p>
        <p class="small muted">Taxas de entrega cobradas (${brl(r.delivery)}) não entram como lucro: elas pagam a entrega.</p>
      </section>
    </div>
    ${pro
      ? html`${products}${channels}`
      : html`<${ProLock} title="Lucro por produto e por canal" text="Veja quais produtos dão mais dinheiro e quanto as taxas de cada canal levam. Disponível no Pro.">${products}</${ProLock}>`}`}
  </div>`;
}
