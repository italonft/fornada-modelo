// App da Fornada: navegação, moldura da tela e carregamento inicial.
import { html, render, useEffect, useRef, useState } from '../vendor/index.mjs';
import { daysBetween, today } from '../shared/format.js';
import { ask, closeDialog, get, loadAll, useStore } from './store.js';
import { logout } from './session.js';
import { DialogHost, ErrorBox, guard, Loading, parseHash } from './ui.js';
import { Inicio } from './inicio.js';
import { Pedidos, PedidoEditor } from './pedidos.js';
import { Produtos, FichaEditor } from './produtos.js';
import { Ingredientes } from './ingredientes.js';
import { Compras } from './compras.js';
import { Lucro } from './lucro.js';
import { CardapioConfig } from './cardapio.js';
import { Conta } from './conta.js';

const I = {
  inicio: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" /></svg>`,
  pedidos: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1z" /><path d="M9 9h6M9 13h4" /></svg>`,
  produtos: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h16v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M4 13c0-3 3.6-5 8-5s8 2 8 5" /><path d="M12 8V5" /><path d="M7 16.5c1.7 1 3.3 1 5 0s3.3-1 5 0" /></svg>`,
  ingredientes: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8v3l2 3v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V9l2-3z" /><path d="M6 12h12" /></svg>`,
  compras: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>`,
  lucro: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16" /><path d="M7 16v-4M12 16V8M17 16v-7" /></svg>`,
  cardapio: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M9 9h6M9 13h6" /></svg>`,
  conta: html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="3.5" /><path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5" /></svg>`,
  mais: html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18" cy="12" r="1.4" /></svg>`,
};

const NAV = [
  ['inicio', 'Início'],
  ['pedidos', 'Pedidos'],
  ['produtos', 'Produtos'],
  ['ingredientes', 'Ingredientes'],
  ['compras', 'Compras'],
  ['lucro', 'Lucro'],
  ['cardapio', 'Cardápio'],
  ['conta', 'Conta'],
];
const TABS = ['inicio', 'pedidos', 'produtos', 'compras', 'mais'];
const IN_MAIS = ['ingredientes', 'lucro', 'cardapio', 'conta', 'mais'];

function section(name) {
  if (name === 'pedido') return 'pedidos';
  if (name === 'ficha') return 'produtos';
  return name;
}

function PlanNote({ account }) {
  const p = account.plan;
  if (!p.pro) return null;
  const left = daysBetween(today(), today(p.proUntil));
  if (p.trial) return html`<a class="plan-note" href="#/conta?aba=plano" title="Teste grátis do Pro">Pro grátis: ${left <= 0 ? 'acaba hoje' : `${left} ${left === 1 ? 'dia' : 'dias'}`}</a>`;
  if (left <= 5) return html`<a class="plan-note plan-note-warn" href="#/conta?aba=plano">Pro acaba ${left <= 0 ? 'hoje' : `em ${left} ${left === 1 ? 'dia' : 'dias'}`}</a>`;
  return null;
}

function Mais() {
  const items = [
    ['ingredientes', 'Ingredientes e embalagens', 'Preço que você paga em cada coisa.'],
    ['lucro', 'Lucro do mês', 'Quanto sobrou para você.'],
    ['cardapio', 'Cardápio online', 'Link para seus clientes pedirem.'],
    ['conta', 'Conta e configurações', 'Plano, custos, canais de venda e senha.'],
  ];
  return html`<div class="page">
    <header class="page-head"><h1>Mais</h1></header>
    <ul class="menu-links">
      ${items.map(
        ([k, t, d]) => html`<li>
          <a href=${`#/${k}`}><span class="ico">${I[k]}</span><span><strong>${t}</strong><span class="muted small">${d}</span></span></a>
        </li>`,
      )}
    </ul>
  </div>`;
}

function Screen({ route }) {
  switch (route.name) {
    case 'inicio':
      return html`<${Inicio} />`;
    case 'pedidos':
      return html`<${Pedidos} route=${route} />`;
    case 'pedido':
      return html`<${PedidoEditor} key=${route.raw} id=${route.id} q=${route.q} />`;
    case 'produtos':
      return html`<${Produtos} route=${route} />`;
    case 'ficha':
      return html`<${FichaEditor} key=${route.raw} id=${route.id} q=${route.q} />`;
    case 'ingredientes':
      return html`<${Ingredientes} route=${route} />`;
    case 'compras':
      return html`<${Compras} />`;
    case 'lucro':
      return html`<${Lucro} route=${route} />`;
    case 'cardapio':
      return html`<${CardapioConfig} />`;
    case 'conta':
    case 'plano':
      return html`<${Conta} key=${route.raw} route=${route.name === 'plano' ? { ...route, q: new URLSearchParams('aba=plano') } : route} />`;
    case 'mais':
      return html`<${Mais} />`;
    default:
      return html`<${Inicio} />`;
  }
}

function App() {
  const s = useStore();
  const [route, setRoute] = useState(parseHash());
  const main = useRef(null);
  const current = useRef(location.hash);

  useEffect(() => {
    const onHash = async () => {
      const next = location.hash;
      if (next === current.current) return;
      if (guard.dirty()) {
        history.replaceState(null, '', current.current || '#/inicio');
        const ok = await ask({ title: 'Sair sem salvar?', text: 'As mudanças feitas nesta tela vão se perder.', ok: 'Sair sem salvar', cancel: 'Continuar editando', danger: true });
        if (!ok) return;
        guard.clear();
        history.replaceState(null, '', next);
      }
      if (get().dialog) closeDialog(false);
      current.current = next;
      setRoute(parseHash(next));
      window.scrollTo(0, 0);
      main.current?.focus({ preventScroll: true });
    };
    const onLeave = (e) => {
      if (guard.dirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, []);

  useEffect(() => {
    if (s.config?.brand) document.title = `${s.account?.business || ''} · ${s.config.brand}`;
  }, [s.config, s.account?.business]);

  if (!s.ready) {
    return html`<div class="boot">${s.error ? html`<${ErrorBox} error=${s.error} onRetry=${loadAll} />` : html`<${Loading} text="Abrindo seu caderno…" />`}</div>`;
  }
  const sec = section(route.name);
  const tabActive = IN_MAIS.includes(sec) ? 'mais' : sec;
  const a = s.account;
  return html`<div class="app">
    <a class="skip" href="#conteudo" onClick=${(e) => (e.preventDefault(), main.current?.focus())}>Pular para o conteúdo</a>
    <aside class="side">
      <a class="brand" href="#/inicio"><span class="brand-mark" aria-hidden="true"></span>${s.config.brand}</a>
      <p class="side-biz">${a.business}</p>
      <nav aria-label="Seções">
        <ul>
          ${NAV.map(
            ([k, t]) => html`<li>
              <a href=${`#/${k}`} aria-current=${sec === k ? 'page' : undefined}>
                <span class="ico">${I[k]}</span>${t}${k === 'pedidos' && s.newOrders ? html`<span class="badge" aria-label=${`${s.newOrders} novos`}>${s.newOrders}</span>` : null}
              </a>
            </li>`,
          )}
        </ul>
      </nav>
      <div class="side-foot">
        <${PlanNote} account=${a} />
        ${!a.plan.pro ? html`<a class="btn btn-main btn-small" href="#/conta?aba=plano">Assinar o Pro</a>` : null}
        <button type="button" class="btn-link small muted" onClick=${logout}>Sair</button>
      </div>
    </aside>
    <header class="topbar">
      <a class="brand" href="#/inicio"><span class="brand-mark" aria-hidden="true"></span><span class="sr-only">${s.config.brand}: </span><span class="topbar-biz">${a.business}</span></a>
      <${PlanNote} account=${a} />
    </header>
    <main id="conteudo" class="main" tabindex="-1" ref=${main}>
      <${Screen} route=${route} />
    </main>
    <nav class="tabbar" aria-label="Seções">
      ${TABS.map(
        (k) => html`<a href=${`#/${k}`} aria-current=${tabActive === k ? 'page' : undefined}>
          <span class="ico">${I[k]}</span><span>${k === 'mais' ? 'Mais' : NAV.find((n) => n[0] === k)[1]}</span>
          ${k === 'pedidos' && s.newOrders ? html`<span class="badge">${s.newOrders}</span>` : null}
        </a>`,
      )}
    </nav>
    <${DialogHost} />
  </div>`;
}


render(html`<${App} />`, document.getElementById('app'));
loadAll();
