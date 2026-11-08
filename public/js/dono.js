// Painel do dono: entra com senha; mostra lucro por dia, funil, contas, origens, gastos, cupons e pagamentos.
import { api, copyText, getConfig, toast } from './lib/api.js';
import { brl, parseMoney, today } from './shared/format.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const STATUS = { paid: 'Pago', refunded: 'Reembolsado', pending: 'Aguardando Pix', review: 'Em análise', canceled: 'Expirado', failed: 'Falhou', creating: 'Criando' };
const dt = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
const dm = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
  return n;
}

function table(head, rows) {
  return el('table', { class: 'list' }, el('thead', {}, el('tr', {}, head.map(([label, num]) => el('th', { class: num ? 'num' : null, text: label })))), el('tbody', {}, rows));
}

function kpi(title, t) {
  return el(
    'div',
    { class: 'kpi' },
    el('h3', { text: title }),
    el('p', { class: `big${t.profit < 0 ? ' neg' : ''}`, text: brl(t.profit) }),
    el('dl', {}, [
      ['Vendas', String(t.sales)],
      ['Contas novas', String(t.signups)],
      ['Faturamento', brl(t.gross)],
      ['Reembolsos', brl(-t.refunds)],
      ['Taxa do Pix (estimada)', brl(-t.fees)],
      ['Gastos anotados', brl(-t.costs)],
    ].map(([a, b]) => [el('dt', { text: a }), el('dd', { text: b })])),
  );
}

let lastSeries = [];
function chart(series) {
  lastSeries = series;
  const holder = $('chart');
  holder.replaceChildren();
  const W = Math.max(280, Math.round(holder.clientWidth || 720));
  const H = 220;
  const pad = { l: 8, r: 8, t: 14, b: 26 };
  const vals = series.map((d) => d.profit);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 100;
  const y = (v) => pad.t + ((max - v) / span) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / series.length;
  const bw = Math.max(4, Math.min(16, slot * 0.6));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Lucro por dia. A tabela abaixo tem os mesmos números.');
  const add = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    svg.append(n);
    return n;
  };
  add('line', { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), class: 'zero' });
  const tip = el('div', { class: 'chart-tip', hidden: true });
  series.forEach((d, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const top = y(Math.max(0, d.profit));
    const h = Math.max(d.profit === 0 ? 0 : 2, Math.abs(y(d.profit) - y(0)));
    if (h > 0) add('rect', { x: cx - bw / 2, y: d.profit >= 0 ? top : y(0), width: bw, height: h, rx: Math.min(3, bw / 2), class: d.profit >= 0 ? 'bar-pos' : 'bar-neg' });
    const hit = add('rect', { x: cx - slot / 2, y: pad.t, width: slot, height: H - pad.t - pad.b, class: 'bar-hit' });
    const showTip = () => {
      tip.textContent = `${dm(d.day)}: ${d.profit >= 0 ? 'lucro' : 'prejuízo'} de ${brl(Math.abs(d.profit))} · ${d.sales} ${d.sales === 1 ? 'venda' : 'vendas'} · ${d.signups} ${d.signups === 1 ? 'conta' : 'contas'}`;
      const r = svg.getBoundingClientRect();
      tip.style.left = `${(cx / W) * r.width}px`;
      tip.style.top = `${(Math.min(top, y(0)) / H) * r.height}px`;
      tip.hidden = false;
    };
    hit.addEventListener('pointerenter', showTip);
    hit.addEventListener('pointerdown', showTip);
    hit.addEventListener('pointerleave', () => (tip.hidden = true));
    const last = i === series.length - 1;
    const every = W < 480 ? 10 : 7;
    if (last || (i % every === 0 && series.length - 1 - i >= every / 2)) {
      const t = add('text', { x: last ? W - pad.r : cx, y: H - 8, 'text-anchor': last ? 'end' : 'middle' });
      t.textContent = last ? `hoje, ${dm(d.day)}` : dm(d.day);
    }
  });
  if (max > 0) add('text', { x: pad.l, y: pad.t - 3 }).textContent = brl(max);
  if (min < 0) add('text', { x: pad.l, y: H - pad.b - 4 }).textContent = brl(min);
  holder.append(svg, tip);
  $('chart-table').replaceChildren(
    table(
      [['Dia'], ['Contas', 1], ['Vendas', 1], ['Faturamento', 1], ['Taxas e reembolsos', 1], ['Gastos', 1], ['Lucro', 1]],
      [...series]
        .reverse()
        .map((d) => el('tr', {}, el('td', { text: dm(d.day) }), el('td', { class: 'num', text: String(d.signups) }), el('td', { class: 'num', text: String(d.sales) }), el('td', { class: 'num', text: brl(d.gross) }), el('td', { class: 'num', text: brl(-(d.fees + d.refunds)) }), el('td', { class: 'num', text: brl(-d.costs) }), el('td', { class: 'num', text: brl(d.profit) }))),
    ),
  );
}

function funnel(f) {
  const steps = [
    ['Visitas à página inicial', f.visita],
    ['Criaram conta', f.conta_criada],
    ['Montaram uma receita', f.ficha_criada],
    ['Lançaram pedido', f.pedido_criado],
    ['Geraram Pix do Pro', f.pix_gerado],
    ['Pagaram', f.venda],
  ];
  const top = Math.max(1, ...steps.map((s) => s[1]));
  $('funnel').replaceChildren(
    ...steps.map(([label, n], i) => {
      const prev = i ? steps[i - 1][1] : 0;
      const bar = el('span', { class: 'bar' }, el('i', {}));
      bar.firstChild.style.width = `${Math.round((n / top) * 100)}%`;
      return el('div', {}, el('span', { text: label }), bar, el('strong', { class: 'nowrap', text: i && prev ? `${n} · ${Math.round((n / prev) * 100)}%` : String(n) }));
    }),
  );
  $('funnel-note').textContent = `Últimos 30 dias. "Montaram uma receita" e "Lançaram pedido" contam cada receita e pedido. Os cardápios das lojas tiveram ${f.cardapio_visita} visitas e ${f.cardapio_pedido} pedidos: cada visita é gente vendo o nome do app no rodapé.`;
}

function accountsTable(list) {
  if (!list.length) return el('p', { class: 'locked', text: 'Nenhuma conta encontrada.' });
  return table(
    [['Negócio'], ['Criada'], ['Plano'], ['Produtos', 1], ['Pedidos', 1], ['Pagamentos', 1], ['']],
    list.map((a) => {
      const acts = el('div', { class: 'acts' });
      const out = el('div', {});
      const btn = (label, fn, cls = 'btn btn-ghost btn-small') => el('button', { type: 'button', class: cls, onclick: fn }, label);
      acts.append(
        btn('Link de senha nova', async () => {
          try {
            const r = await api(`/api/owner/accounts/${a.id}/link`, { method: 'POST', body: {} });
            const ok = await copyText(r.url);
            out.replaceChildren(el('div', { class: 'link-out' }, el('span', { class: 'small', text: ok ? 'Copiado. Vale 24 horas e uma vez:' : 'Copie e mande para a pessoa. Vale 24 horas e uma vez:' }), el('code', { text: r.url })));
          } catch (ex) {
            toast(ex.message, { bad: true });
          }
        }),
        btn('+30 dias de cortesia', async () => {
          try {
            await api(`/api/owner/accounts/${a.id}/dias`, { method: 'POST', body: { days: 30 } });
            toast('30 dias de Pro somados.');
            await searchAccounts();
          } catch (ex) {
            toast(ex.message, { bad: true });
          }
        }),
        btn('Apagar conta', () => {
          const input = el('input', { 'aria-label': 'Digite o e-mail da conta para confirmar', placeholder: a.email });
          const go = btn('Apagar de vez', async () => {
            try {
              await api(`/api/owner/accounts/${a.id}/apagar`, { method: 'POST', body: { confirm: input.value } });
              toast('Conta apagada.');
              await searchAccounts();
            } catch (ex) {
              toast(ex.message, { bad: true });
            }
          }, 'btn btn-danger btn-small');
          out.replaceChildren(el('div', { class: 'link-out' }, el('span', { class: 'small', text: 'Isto apaga tudo e não volta. Digite o e-mail da conta:' }), input, go));
        }, 'btn btn-ghost btn-small'),
      );
      const plan = a.pro ? (a.trial ? `Teste até ${dt(a.proUntil).slice(0, 8)}` : `Pro até ${dt(a.proUntil).slice(0, 8)}`) : 'Grátis';
      return el(
        'tr',
        {},
        el('td', {}, el('strong', { text: a.business }), el('span', { class: 'note-text', text: a.email }), el('span', { class: 'note-text', text: `/c/${a.slug}${a.ref ? ` · veio de ${a.ref}` : ''}` }), out),
        el('td', {}, el('span', { text: dt(a.createdAt) }), el('span', { class: 'note-text', text: `visto ${dt(a.seenAt)}` })),
        el('td', { text: plan }),
        el('td', { class: 'num', text: String(a.products) }),
        el('td', { class: 'num', text: String(a.orders) }),
        el('td', { class: 'num', text: String(a.paid) }),
        el('td', {}, acts),
      );
    }),
  );
}

async function searchAccounts() {
  const q = $('acc-q').value.trim();
  const r = await api(`/api/owner/accounts?q=${encodeURIComponent(q)}`);
  $('accounts').replaceChildren(accountsTable(r.accounts));
}

async function loadAll() {
  const [s, o, cp, cs] = await Promise.all([api('/api/owner/summary?days=30'), api('/api/owner/orders'), api('/api/owner/coupons'), api('/api/owner/costs')]);
  const a = s.accounts;
  const plans = s.config.plans.map((p) => `${p.label} ${brl(p.cents)}`).join(', ');
  $('dash-sub').textContent = `Hoje é ${dm(s.today)}. ${a.total} ${a.total === 1 ? 'conta' : 'contas'} (${a.week} nos últimos 7 dias, ${a.active} usaram nos últimos 7 dias). ${a.paying} ${a.paying === 1 ? 'pagando' : 'pagando'} o Pro e ${a.trial} no teste grátis. Planos: ${plans}. Taxa do Pix usada na conta: ${String(s.config.pixFeePct).replace('.', ',')}%.`;
  $('kpis').replaceChildren(kpi('Hoje', s.totals.today), kpi('Últimos 7 dias', s.totals.week), kpi('Últimos 30 dias', s.totals.period));
  chart(s.series);
  funnel(s.funnel);
  $('ref-example').textContent = `${location.origin}/?ref=insta1`;
  $('refs').replaceChildren(
    s.refs.length
      ? table([['Origem'], ['Visitas', 1], ['Contas', 1], ['Vendas', 1], ['Faturamento', 1]], s.refs.map((r) => el('tr', {}, el('td', { text: r.ref }), el('td', { class: 'num', text: String(r.visits) }), el('td', { class: 'num', text: String(r.signups) }), el('td', { class: 'num', text: String(r.sales) }), el('td', { class: 'num', text: brl(r.gross) }))))
      : el('p', { class: 'locked', text: 'Ainda não há visitas nem vendas nos últimos 30 dias.' }),
  );
  renderCosts(cs.costs);
  renderCoupons(cp.coupons);
  renderOrders(o.orders);
  await searchAccounts();
  const st = s.status;
  const li = (ok, text) => el('li', {}, el('span', { class: `chip ${ok ? 'chip-good' : 'chip-warn'}`, text: ok ? 'Ok' : 'Atenção' }), el('span', { text }));
  $('status').replaceChildren(
    ...[
      li(st.payments, st.payments ? 'Pix do Mercado Pago configurado.' : 'Pix não configurado: ninguém consegue assinar. Rode o Publicar e informe o Access Token.'),
      li(st.webhookSecret, st.webhookSecret ? 'Assinatura do aviso do Mercado Pago configurada.' : 'Assinatura do aviso do Mercado Pago não configurada. Os pagamentos ainda são conferidos pela consulta automática; configure para liberar na hora (veja o LEIA-ME).'),
      li(Boolean(st.pepperOrigin), st.pepperOrigin === 'env' ? 'Proteção extra das senhas: segredo PASSWORD_PEPPER guardado na Cloudflare. Nunca troque nem apague.' : st.pepperOrigin === 'banco' ? 'Proteção extra das senhas: criada pelo próprio app e guardada no banco (publicação pelo celular). Não crie o segredo PASSWORD_PEPPER depois: ele seria ignorado.' : 'Proteção extra das senhas: será criada no primeiro acesso.'),
      li(Boolean(st.lastWebhookAt), st.lastWebhookAt ? `Último aviso do Mercado Pago: ${dt(st.lastWebhookAt)}.` : 'Nenhum aviso do Mercado Pago chegou ainda. Depois da primeira venda, confira a URL de notificações (veja o LEIA-ME).'),
      st.lastInvalidWebhookAt ? li(false, `Chegou um aviso com assinatura que não confere em ${dt(st.lastInvalidWebhookAt)}. Confira a assinatura secreta no Mercado Pago.`) : null,
      li(Boolean(st.lastCronAt) && Date.now() - st.lastCronAt < 30 * 60000, `Rotina automática (confere Pix e limpa sessões vencidas): ${st.lastCronAt ? `rodou em ${dt(st.lastCronAt)}` : 'ainda não rodou'}.`),
      li(!st.review, `${st.pending} Pix aguardando pagamento${st.review ? `; ${st.review} em análise por valor diferente` : ''}.`),
    ].filter(Boolean),
  );
}

function renderCosts(list) {
  $('costs').replaceChildren(
    list.length
      ? table(
          [['Dia'], ['Descrição'], ['Valor', 1], ['']],
          list.map((c) =>
            el(
              'tr',
              {},
              el('td', { text: dm(c.day) }),
              el('td', { text: c.note || '–' }),
              el('td', { class: 'num', text: brl(c.amount_cents) }),
              el('td', {}, el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: async () => (await api(`/api/owner/costs/${c.id}`, { method: 'DELETE' }), loadAll()) }, 'Apagar')),
            ),
          ),
        )
      : el('p', { class: 'locked', text: 'Nenhum gasto anotado.' }),
  );
}

function renderCoupons(list) {
  $('coupons').replaceChildren(
    list.length
      ? table(
          [['Código'], ['Desconto', 1], ['Usos', 1], ['Observação'], ['']],
          list.map((c) =>
            el(
              'tr',
              {},
              el('td', {}, el('strong', { text: c.code }), c.active ? null : el('span', { class: 'note-text', text: 'desativado' })),
              el('td', { class: 'num', text: `${c.percent_off}%` }),
              el('td', { class: 'num', text: c.max_uses ? `${c.uses} de ${c.max_uses}` : String(c.uses) }),
              el('td', { text: c.note || '–' }),
              el('td', {}, el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: async () => (await api(`/api/owner/coupons/${encodeURIComponent(c.code)}`, { method: 'POST', body: { active: !c.active } }), loadAll()) }, c.active ? 'Desativar' : 'Ativar')),
            ),
          ),
        )
      : el('p', { class: 'locked', text: 'Nenhum cupom criado.' }),
  );
}

function renderOrders(list) {
  $('orders').replaceChildren(
    list.length
      ? table(
          [['Criado'], ['Conta'], ['Plano'], ['Valor', 1], ['Situação'], ['Cupom'], ['Origem'], ['']],
          list.map((o) => {
            const cell = el('td', {});
            if (o.status === 'paid' && o.amount_cents > 0) {
              const b = el('button', { class: 'btn btn-ghost btn-small', type: 'button' }, 'Reembolsar');
              b.addEventListener('click', () => {
                const yes = el('button', { class: 'btn btn-danger btn-small', type: 'button' }, 'Confirmar reembolso');
                yes.addEventListener('click', async () => {
                  yes.disabled = true;
                  try {
                    await api(`/api/owner/orders/${o.id}/refund`, { method: 'POST', body: {} });
                    toast('Reembolso feito.');
                    await loadAll();
                  } catch (ex) {
                    toast(ex.message, { bad: true });
                    yes.disabled = false;
                  }
                });
                cell.replaceChildren(yes);
              });
              cell.append(b);
            }
            return el(
              'tr',
              {},
              el('td', { text: dt(o.created_at) }),
              el('td', {}, el('span', { text: o.business || '(conta apagada)' }), el('span', { class: 'note-text', text: o.email || '' })),
              el('td', { text: `${o.plan_days} dias` }),
              el('td', { class: 'num', text: brl(o.amount_cents) }),
              el('td', {}, el('span', { text: STATUS[o.status] ?? o.status }), o.note ? el('span', { class: 'note-text', text: o.note }) : null),
              el('td', { text: o.coupon || '–' }),
              el('td', { text: o.ref || 'direto' }),
              cell,
            );
          }),
        )
      : el('p', { class: 'locked', text: 'Nenhum pagamento ainda.' }),
  );
}

function showDash(on) {
  $('login').hidden = on;
  $('dash').hidden = !on;
  $('logout').hidden = !on;
}

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('login-err');
  err.hidden = true;
  try {
    await api('/api/owner/login', { method: 'POST', body: { password: $('pw').value } });
    $('pw').value = '';
    showDash(true);
    await loadAll();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/owner/logout', { method: 'POST', body: {} }).catch(() => {});
  showDash(false);
});

$('acc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await searchAccounts();
  } catch (ex) {
    toast(ex.message, { bad: true });
  }
});

$('cost-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('cost-err');
  err.hidden = true;
  try {
    const cents = parseMoney($('cost-amount').value);
    if (!Number.isFinite(cents) || !(cents > 0)) throw new Error('Digite um valor, por exemplo 25,00.');
    await api('/api/owner/costs', { method: 'POST', body: { day: $('cost-day').value, amountCents: cents, note: $('cost-note').value } });
    $('cost-amount').value = '';
    $('cost-note').value = '';
    await loadAll();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$('coupon-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('cp-err');
  err.hidden = true;
  try {
    await api('/api/owner/coupons', { method: 'POST', body: { code: $('cp-code').value, percentOff: Number($('cp-pct').value), maxUses: $('cp-max').value.trim() === '' ? null : Number($('cp-max').value), note: $('cp-note').value } });
    for (const id of ['cp-code', 'cp-pct', 'cp-max', 'cp-note']) $(id).value = '';
    await loadAll();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$('cost-day').value = today();
getConfig().then((c) => document.querySelectorAll('[data-brand]').forEach((n) => (n.textContent = c.brand)));
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => lastSeries.length && chart(lastSeries), 200);
});
api('/api/owner/session')
  .then((s) => {
    if (!s.ok) {
      showDash(false);
      if (s.message) {
        const err = $('login-err');
        err.textContent = s.message;
        err.hidden = false;
      }
      return null;
    }
    showDash(true);
    return loadAll();
  })
  .catch((ex) => {
    showDash(false);
    toast(ex.message, { bad: true });
  });
