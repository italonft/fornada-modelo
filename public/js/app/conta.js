// Conta: plano Pro por Pix, dados do negócio, preço e custos, canais de venda, senha e seus dados.
import { html, useEffect, useRef, useState } from '../vendor/index.mjs';
import { hourRates } from '../shared/calc.js';
import { brl, fmtNum, longDate, pct, today } from '../shared/format.js';
import { DEFAULT_CHANNELS, SEGMENTS } from '../shared/schema.js';
import { api, copyText, toast } from '../lib/api.js';
import { ask, refreshAccount, saveAccount, useStore } from './store.js';
import { Field, MoneyInput, NumInput, PageHead, Seg, go, guard, useDirty, useAsync } from './ui.js';
import { logout } from './session.js';

const SEG_LABEL = { confeitaria: 'Confeitaria e doces', salgados: 'Salgados e festas', marmitas: 'Marmitas e refeições', outro: 'Outro' };
const ROUND_LABEL = { nenhum: 'Não arredondar', '0.10': 'Para cima, de 10 em 10 centavos', '0.50': 'Para cima, de 50 em 50 centavos', '1.00': 'Para cima, em reais inteiros', '0.90': 'Terminar em ,90' };

const PRO_FEATURES = ['Produtos à venda sem limite (no grátis: até 5)', 'Pedidos sem limite (no grátis: até 20 por mês)', 'Lista de compras completa, com embalagens e gasto', 'Lucro por produto e por canal, e planilha do mês', 'Cardápio online com todos os seus produtos'];

// ---------- Plano ----------
function PixBox({ pay, onPaid }) {
  const [st, setSt] = useState(pay.status);
  useEffect(() => {
    if (st !== 'pending') return undefined;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const r = await api(`/api/assinatura/pix/${pay.paymentId}`);
        if (!alive) return;
        if (r.status !== 'pending') {
          setSt(r.status);
          if (r.status === 'paid') onPaid();
        }
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [st]);
  if (st === 'paid') return html`<div class="callout callout-good" role="status"><strong>Pagamento confirmado.</strong> Seu Pro já está valendo. Obrigado!</div>`;
  if (st !== 'pending') return html`<div class="callout callout-warn">Este Pix não vale mais. Gere outro.</div>`;
  return html`<div class="pix">
    ${pay.qrBase64 ? html`<img class="pix-qr" src=${`data:image/png;base64,${pay.qrBase64}`} alt="QR Code do Pix" width="220" height="220" />` : null}
    <div class="pix-text">
      <p><strong>${brl(pay.amountCents)}</strong> por ${pay.planDays} dias de Pro</p>
      <p class="small muted">Abra o app do banco, escolha Pix e leia o QR Code, ou copie o código abaixo.</p>
      <p class="pix-code"><code>${pay.qrCode}</code></p>
      <button type="button" class="btn btn-main" onClick=${async () => ((await copyText(pay.qrCode)) ? toast('Código Pix copiado.') : toast('Selecione e copie o código acima.', { bad: true }))}>Copiar código Pix</button>
      <p class="small muted" role="status">Esperando o pagamento… a confirmação chega sozinha em alguns segundos.</p>
    </div>
  </div>`;
}

function Plano() {
  const s = useStore();
  const a = s.account;
  const cfg = s.config;
  const bill = useAsync(() => api('/api/assinatura'), []);
  const [plan, setPlan] = useState('ano');
  const [coupon, setCoupon] = useState('');
  const [deal, setDeal] = useState(null);
  const [pay, setPay] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const left = a.plan.pro ? Math.max(0, Math.ceil((a.plan.proUntil - Date.now()) / 86400000)) : 0;
  const plans = cfg.plans.map((p) => ({ ...p, cents: deal?.plans?.find((x) => x.id === p.id)?.cents ?? p.cents }));
  const month = plans.find((p) => p.id === 'mes');

  async function checkCoupon() {
    setErr('');
    if (!coupon.trim()) return setDeal(null);
    try {
      const r = await api('/api/cupom', { method: 'POST', body: { code: coupon } });
      if (!r.valid) {
        setDeal(null);
        return setErr(r.error);
      }
      setDeal(r);
      toast(`Cupom de ${r.percentOff}% aplicado.`);
    } catch (e) {
      setErr(e.message);
    }
  }
  async function buy() {
    setErr('');
    setBusy(true);
    try {
      const r = await api('/api/assinatura/pix', { method: 'POST', body: { plan, coupon: deal?.code || '' } });
      if (r.status === 'paid') {
        await refreshAccount();
        bill.reload();
        toast('Pro liberado.');
      } else setPay(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function refund(p) {
    if (!(await ask({ title: 'Pedir o reembolso?', text: `Você recebe ${brl(p.amountCents)} de volta pelo Mercado Pago e perde os ${p.days} dias desse pagamento.`, ok: 'Pedir reembolso', danger: true }))) return;
    try {
      await api(`/api/assinatura/reembolso/${p.id}`, { method: 'POST' });
      toast('Reembolso feito. O dinheiro volta pelo Mercado Pago.');
      await refreshAccount();
      bill.reload();
    } catch (e) {
      toast(e.message, { bad: true });
    }
  }

  return html`<div class="plan">
    <section class=${`panel plan-status ${a.plan.pro ? 'is-pro' : ''}`}>
      ${a.plan.pro
        ? html`<h2>${a.plan.trial ? 'Teste grátis do Pro' : 'Você está no Pro'}</h2>
            <p>Vale até ${longDate(today(a.plan.proUntil))} (${left} ${left === 1 ? 'dia' : 'dias'}).${a.plan.trial ? ' Depois, a conta volta para o plano grátis sem perder nada.' : ''}</p>`
        : html`<h2>Plano grátis</h2>
            <p>${a.usage.products} de ${a.limits.products} produtos à venda e ${a.usage.ordersMonth} de ${a.limits.ordersMonth} pedidos neste mês.</p>`}
    </section>
    <section class="panel">
      <h2>${a.plan.pro ? 'Somar mais dias' : 'Assinar o Pro'}</h2>
      <ul class="feature-list">${PRO_FEATURES.map((f) => html`<li>${f}</li>`)}</ul>
      <p class="small muted">Sem cartão e sem fidelidade: você paga por Pix o período que quiser. Os dias se somam ao que já tem. Desistiu em até ${cfg.refundDays} dias? O reembolso é na hora, aqui mesmo.</p>
      ${!cfg.paymentsEnabled
        ? html`<p class="callout callout-warn">O pagamento por Pix ainda não foi ligado neste site.</p>`
        : pay
          ? html`<${PixBox} pay=${pay} onPaid=${async () => (await refreshAccount(), bill.reload())} />
              <button type="button" class="btn-link small" onClick=${() => setPay(null)}>Escolher outro plano</button>`
          : html`<div class="plans" role="radiogroup" aria-label="Plano">
                ${plans.map((p) => {
                  const per = Math.round(p.cents / (p.days / 30));
                  const save = month && p.id !== 'mes' ? Math.round((1 - p.cents / ((month.cents * p.days) / 30)) * 100) : 0;
                  return html`<button type="button" role="radio" aria-checked=${plan === p.id ? 'true' : 'false'} class=${`plan-card ${plan === p.id ? 'on' : ''}`} onClick=${() => setPlan(p.id)}>
                    <span class="plan-name">${p.label}</span>
                    <strong class="plan-price">${brl(p.cents)}</strong>
                    <span class="small muted">${p.id === 'mes' ? 'por 30 dias' : `${brl(per)} por mês`}</span>
                    ${save > 0 ? html`<span class="chip chip-good">economiza ${save}%</span>` : null}
                  </button>`;
                })}
              </div>
              <div class="coupon">
                <label class="sr-only" for="cupom">Cupom</label>
                <input id="cupom" placeholder="Cupom (opcional)" value=${coupon} maxlength="24" onInput=${(e) => setCoupon(e.currentTarget.value.toUpperCase())} />
                <button type="button" class="btn" onClick=${checkCoupon}>Aplicar</button>
              </div>
              ${err ? html`<p class="error-text" role="alert">${err}</p>` : null}
              <button type="button" class="btn btn-main btn-block" disabled=${busy} onClick=${buy}>${busy ? 'Gerando Pix…' : `Pagar ${brl(plans.find((p) => p.id === plan).cents)} com Pix`}</button>`}
    </section>
    ${bill.data?.payments?.length
      ? html`<section class="panel">
          <h2>Pagamentos</h2>
          <ul class="rows">
            ${bill.data.payments.map(
              (p) => html`<li class="row">
                <span class="row-main"><strong>${brl(p.amountCents)} · ${p.days} dias</strong><span class="muted small">${p.paidAt ? longDate(today(p.paidAt)) : ''}${p.status === 'refunded' ? ' · reembolsado' : p.status === 'review' ? ' · em análise' : ''}</span></span>
                ${p.refundable ? html`<button type="button" class="btn btn-small btn-danger" onClick=${() => refund(p)}>Pedir reembolso</button>` : null}
              </li>`,
            )}
          </ul>
        </section>`
      : null}
  </div>`;
}

// ---------- Seu negócio ----------
function Negocio() {
  const s = useStore();
  const a = s.account;
  const init = () => ({ business: a.business, slug: a.slug, segment: a.settings.segment, pixKey: a.settings.pixKey, pixName: a.settings.pixName });
  const [f, setF] = useState(init);
  const [snap, setSnap] = useState(() => JSON.stringify(init()));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useDirty(JSON.stringify(f) !== snap);
  const up = (p) => setF((x) => ({ ...x, ...p }));
  async function save(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const acc = await saveAccount({ business: f.business, slug: f.slug.trim().toLowerCase(), settings: { ...a.settings, segment: f.segment, pixKey: f.pixKey, pixName: f.pixName } });
      const next = { business: acc.business, slug: acc.slug, segment: acc.settings.segment, pixKey: acc.settings.pixKey, pixName: acc.settings.pixName };
      setF(next);
      setSnap(JSON.stringify(next));
      toast('Dados salvos.');
    } catch (ex) {
      setErr({ field: ex.field, message: ex.message });
    } finally {
      setBusy(false);
    }
  }
  const e = (k) => (err?.field === k ? err.message : '');
  return html`<form class="panel form" onSubmit=${save} novalidate>
    <${Field} label="Nome do negócio" error=${e('business')}><input value=${f.business} maxlength="60" onInput=${(ev) => up({ business: ev.currentTarget.value })} /></${Field}>
    <${Field} label="Endereço do cardápio" error=${e('slug')} hint="Letras sem acento, números e hífen. Se mudar, o link antigo para de funcionar.">
      <div class="affix"><span class="pre">${location.host}/c/</span><input value=${f.slug} maxlength="40" autocapitalize="none" spellcheck="false" onInput=${(ev) => up({ slug: ev.currentTarget.value })} /></div>
    </${Field}>
    <${Field} label="Tipo de negócio">
      <select value=${f.segment} onChange=${(ev) => up({ segment: ev.currentTarget.value })}>${SEGMENTS.map((k) => html`<option value=${k}>${SEG_LABEL[k]}</option>`)}</select>
    </${Field}>
    <h3 class="h-small">Para seus clientes pagarem</h3>
    <div class="grid-2">
      <${Field} label="Sua chave Pix" hint="Aparece no resumo do pedido e na página do pedido."><input value=${f.pixKey} maxlength="80" onInput=${(ev) => up({ pixKey: ev.currentTarget.value })} /></${Field}>
      <${Field} label="Nome de quem recebe"><input value=${f.pixName} maxlength="60" onInput=${(ev) => up({ pixName: ev.currentTarget.value })} /></${Field}>
    </div>
    <p class="small muted">O dinheiro dos seus clientes vai direto para a sua conta. O app nunca passa por ele.</p>
    ${err && !err.field ? html`<p class="error-text">${err.message}</p>` : null}
    <div class="form-actions"><button class="btn btn-main" disabled=${busy || JSON.stringify(f) === snap}>${busy ? 'Salvando…' : 'Salvar'}</button></div>
  </form>`;
}

// ---------- Preço e custos ----------
function Precos() {
  const s = useStore();
  const a = s.account;
  const [f, setF] = useState(() => structuredClone(a.settings));
  const [snap, setSnap] = useState(() => JSON.stringify(a.settings));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [week, setWeek] = useState(() => Math.round((a.settings.hoursMonth / 4.33) * 10) / 10);
  useDirty(JSON.stringify(f) !== snap);
  const up = (p) => setF((x) => ({ ...x, ...p }));
  const rates = hourRates(f);
  const setFixed = (i, p) => up({ fixed: f.fixed.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const setCh = (i, p) => up({ channels: f.channels.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  async function save(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const fixed = f.fixed.filter((x) => x.name.trim() || x.cents > 0).map((x) => ({ name: x.name.trim() || 'Custo fixo', cents: x.cents || 0 }));
      const channels = f.channels.filter((x, i) => i === 0 || x.name.trim()).map((x) => ({ ...x, name: x.name.trim() || 'Canal' }));
      const acc = await saveAccount({ settings: { ...a.settings, ...f, fixed, channels } });
      setF(structuredClone(acc.settings));
      setSnap(JSON.stringify(acc.settings));
      toast('Salvo. Todos os preços sugeridos foram refeitos.');
    } catch (ex) {
      setErr({ field: ex.field, message: ex.message });
    } finally {
      setBusy(false);
    }
  }
  const e = (k) => (err?.field === k ? err.message : '');
  const newChannelId = () => {
    let i = 1;
    while (f.channels.some((c) => c.id === `canal${i}`)) i++;
    return `canal${i}`;
  };
  return html`<form class="form" onSubmit=${save} novalidate>
    <section class="panel">
      <h2>Seu trabalho</h2>
      <div class="grid-2">
        <${Field} label="Quanto você quer ganhar por mês" error=${e('wageCents')} hint="Seu salário, tirado das vendas.">
          <${MoneyInput} value=${f.wageCents} onValue=${(v) => up({ wageCents: v > 0 ? v : 0 })} />
        </${Field}>
        <${Field} label="Horas por semana na cozinha" error=${e('hoursMonth')} hint=${`Cerca de ${fmtNum(f.hoursMonth, 0)} horas por mês.`}>
          <${NumInput} value=${week} onValue=${(v) => (setWeek(v), up({ hoursMonth: v > 0 ? Math.min(744, Math.round(v * 4.33 * 10) / 10) : 1 }))} suffix="h" max=${1} />
        </${Field}>
      </div>
      <p class="lcd-inline">Seu tempo vale <strong>${brl(Math.round(rates.hour))}</strong> por hora. Esse valor entra no custo de cada receita, pelo tempo de trabalho dela.</p>
    </section>
    <section class="panel">
      <h2>Custos fixos do mês</h2>
      <p class="small muted">O que você paga todo mês, vendendo ou não: gás, a parte da conta de luz e de água da cozinha, internet, aluguel, o DAS do MEI.</p>
      <ul class="fixed-list">
        ${f.fixed.map(
          (x, i) => html`<li class="fixed-row">
            <input aria-label="Nome do custo" value=${x.name} maxlength="40" placeholder="Ex.: Gás" onInput=${(ev) => setFixed(i, { name: ev.currentTarget.value })} />
            <${MoneyInput} value=${x.cents} onValue=${(v) => setFixed(i, { cents: v > 0 ? v : 0 })} aria-label=${`Valor de ${x.name || 'custo'}`} />
            <button type="button" class="btn btn-ghost btn-small" onClick=${() => up({ fixed: f.fixed.filter((_, j) => j !== i) })}>Tirar</button>
          </li>`,
        )}
      </ul>
      <button type="button" class="btn btn-small" disabled=${f.fixed.length >= 20} onClick=${() => up({ fixed: [...f.fixed, { name: '', cents: 0 }] })}>+ Custo fixo</button>
      <p class="small">Total: <strong>${brl(rates.fixedTotal)}</strong> por mês, ou ${brl(Math.round(rates.fixedHour))} por hora de cozinha.</p>
    </section>
    <section class="panel">
      <h2>Lucro e preço</h2>
      <div class="grid-3">
        <${Field} label="Lucro desejado" error=${e('marginPct')} hint="Do preço, depois de pagar tudo e o seu salário.">
          <${NumInput} value=${f.marginPct} onValue=${(v) => up({ marginPct: v >= 0 ? v : 0 })} suffix="%" max=${1} placeholder="20" />
        </${Field}>
        <${Field} label="Imposto sobre a venda" error=${e('taxPct')} hint="MEI: deixe 0 e ponha o DAS nos custos fixos. Simples: pergunte ao contador.">
          <${NumInput} value=${f.taxPct} onValue=${(v) => up({ taxPct: v >= 0 ? v : 0 })} suffix="%" max=${2} placeholder="0" />
        </${Field}>
        <${Field} label="Arredondar o preço sugerido">
          <select value=${f.rounding} onChange=${(ev) => up({ rounding: ev.currentTarget.value })}>${Object.entries(ROUND_LABEL).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select>
        </${Field}>
      </div>
    </section>
    <section class="panel">
      <h2>Canais de venda</h2>
      <p class="small muted">A taxa de cada canal é uma parte do preço que fica com a maquininha ou o app. Confira a sua: elas mudam por plano e por contrato.</p>
      <ul class="fixed-list">
        ${f.channels.map(
          (c, i) => html`<li class="fixed-row">
            <input aria-label="Nome do canal" value=${c.name} maxlength="30" disabled=${i === 0} onInput=${(ev) => setCh(i, { name: ev.currentTarget.value })} />
            <${NumInput} value=${c.feePct} onValue=${(v) => setCh(i, { feePct: v >= 0 ? v : 0 })} suffix="%" max=${2} placeholder="0" aria-label=${`Taxa de ${c.name}`} disabled=${i === 0} />
            ${i === 0 ? html`<span class="small muted">sem taxa</span>` : html`<button type="button" class="btn btn-ghost btn-small" onClick=${() => up({ channels: f.channels.filter((_, j) => j !== i) })}>Tirar</button>`}
          </li>`,
        )}
      </ul>
      <div class="chips-row">
        <button type="button" class="btn btn-small" disabled=${f.channels.length >= 8} onClick=${() => up({ channels: [...f.channels, { id: newChannelId(), name: '', feePct: 0 }] })}>+ Canal</button>
        ${!f.channels.some((c) => c.id === 'ifood') ? html`<button type="button" class="btn btn-small btn-ghost" onClick=${() => up({ channels: [...f.channels, { ...DEFAULT_CHANNELS[2] }] })}>Pôr iFood de volta</button>` : null}
      </div>
      <p class="small muted">No iFood, a comissão de junho de 2025 era de 12% no plano Básico e 23% no plano Entrega, mais 3,2% pelo pagamento online (fonte: Saipos). Confira no seu contrato.</p>
    </section>
    ${err ? html`<p class="callout callout-bad" role="alert">${err.message}</p>` : null}
    <div class="save-bar">
      <button class="btn btn-main" disabled=${busy || JSON.stringify(f) === snap}>${busy ? 'Salvando…' : 'Salvar'}</button>
      ${JSON.stringify(f) !== snap ? html`<span class="small muted">Mudanças sem salvar. Ao salvar, os preços sugeridos são refeitos.</span>` : null}
    </div>
  </form>`;
}

// ---------- Segurança e dados ----------
function Seguranca() {
  const s = useStore();
  const [pw, setPw] = useState({ current: '', password: '' });
  const [msg, setMsg] = useState(null);
  const [codePw, setCodePw] = useState('');
  const [code, setCode] = useState('');
  const [delPw, setDelPw] = useState('');
  const [busy, setBusy] = useState('');
  async function run(kind, fn) {
    setMsg(null);
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind, bad: true, text: e.message });
    } finally {
      setBusy('');
    }
  }
  return html`<div class="form">
    <section class="panel">
      <h2>Entrar</h2>
      <p>E-mail da conta: <strong>${s.account.email}</strong></p>
      <form class="form" onSubmit=${(e) => (e.preventDefault(), run('senha', async () => {
        await api('/api/conta/senha', { method: 'POST', body: pw });
        setPw({ current: '', password: '' });
        setMsg({ kind: 'senha', text: 'Senha trocada. Os outros aparelhos precisam entrar de novo.' });
      }))}>
        <div class="grid-2">
          <${Field} label="Senha atual"><input type="password" autocomplete="current-password" value=${pw.current} onInput=${(e) => setPw({ ...pw, current: e.currentTarget.value })} /></${Field}>
          <${Field} label="Nova senha" hint="Pelo menos 8 caracteres."><input type="password" autocomplete="new-password" minlength="8" value=${pw.password} onInput=${(e) => setPw({ ...pw, password: e.currentTarget.value })} /></${Field}>
        </div>
        ${msg?.kind === 'senha' ? html`<p class=${msg.bad ? 'error-text' : 'small'} role="status">${msg.text}</p>` : null}
        <div class="form-actions"><button class="btn" disabled=${busy === 'senha' || !pw.current || pw.password.length < 8}>Trocar senha</button></div>
      </form>
    </section>
    <section class="panel">
      <h2>Código de recuperação</h2>
      <p class="small muted">Com ele você cria uma senha nova se esquecer a atual. Gerar outro invalida o anterior.</p>
      ${code
        ? html`<p class="recovery"><code>${code}</code></p><p class="small">Guarde agora: tire um print ou mande para você mesma no WhatsApp. Ele não aparece de novo.</p>`
        : html`<form class="form inline-form" onSubmit=${(e) => (e.preventDefault(), run('codigo', async () => {
            const r = await api('/api/conta/codigo', { method: 'POST', body: { password: codePw } });
            setCode(r.recoveryCode);
            setCodePw('');
          }))}>
            <${Field} label="Sua senha"><input type="password" autocomplete="current-password" value=${codePw} onInput=${(e) => setCodePw(e.currentTarget.value)} /></${Field}>
            <button class="btn" disabled=${busy === 'codigo' || !codePw}>Gerar novo código</button>
          </form>`}
      ${msg?.kind === 'codigo' ? html`<p class="error-text">${msg.text}</p>` : null}
    </section>
    <section class="panel">
      <h2>Seus dados</h2>
      <p class="small muted">Baixe tudo o que está na sua conta: ingredientes, receitas, pedidos e configurações.</p>
      <p><a class="btn" href="/api/conta/exportar" download>Baixar meus dados</a></p>
      ${s.config.contactEmail ? html`<p class="small">Dúvidas ou problemas: <strong class="selectable">${s.config.contactEmail}</strong></p>` : null}
      <p><button type="button" class="btn" onClick=${logout}>Sair deste aparelho</button></p>
    </section>
    <section class="panel panel-danger">
      <h2>Apagar a conta</h2>
      <p class="small">Apaga para sempre ingredientes, receitas, fotos, pedidos e o cardápio. Não dá para desfazer. Pagamentos já feitos não são devolvidos por aqui.</p>
      <form class="form inline-form" onSubmit=${(e) => (e.preventDefault(), run('apagar', async () => {
        if (!(await ask({ title: 'Apagar tudo para sempre?', text: 'Sua conta e todos os dados somem agora.', ok: 'Apagar minha conta', danger: true }))) return;
        await api('/api/conta/excluir', { method: 'POST', body: { password: delPw } });
        guard.clear();
        location.href = '/?conta=apagada';
      }))}>
        <${Field} label="Sua senha"><input type="password" autocomplete="current-password" value=${delPw} onInput=${(e) => setDelPw(e.currentTarget.value)} /></${Field}>
        <button class="btn btn-danger" disabled=${busy === 'apagar' || !delPw}>Apagar minha conta</button>
      </form>
      ${msg?.kind === 'apagar' ? html`<p class="error-text">${msg.text}</p>` : null}
    </section>
  </div>`;
}

export function Conta({ route }) {
  const tab = ['plano', 'negocio', 'precos', 'seguranca'].includes(route.q.get('aba')) ? route.q.get('aba') : 'plano';
  const ref = useRef(null);
  return html`<div class="page">
    <${PageHead} title="Conta" />
    <${Seg} label="Seção" value=${tab} onChange=${(v) => go(`#/conta?aba=${v}`)} options=${[{ v: 'plano', label: 'Plano' }, { v: 'negocio', label: 'Seu negócio' }, { v: 'precos', label: 'Preço e custos' }, { v: 'seguranca', label: 'Senha e dados' }]} />
    <div ref=${ref} class="tab-body">
      ${tab === 'plano' ? html`<${Plano} />` : tab === 'negocio' ? html`<${Negocio} />` : tab === 'precos' ? html`<${Precos} />` : html`<${Seguranca} />`}
    </div>
  </div>`;
}
