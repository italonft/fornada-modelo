// Peças de tela usadas em várias partes do app.
import { html, useEffect, useRef, useState, useCallback } from '../vendor/index.mjs';
import { brl, fmtNum, moneyInput, numInput, parseMoney, parseNum, pct } from '../shared/format.js';
import { closeDialog, useStore } from './store.js';

// ---------- Navegação ----------
export function parseHash(h = location.hash) {
  const raw = String(h || '').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] || 'inicio', id: parts[1] || '', q: new URLSearchParams(query), raw };
}

const checks = new Set();
/** Cada tela de edição registra "tenho mudança sem salvar?"; o roteador pergunta antes de sair. */
export const guard = {
  add(fn) {
    checks.add(fn);
    return () => checks.delete(fn);
  },
  clear() {
    checks.clear();
  },
  dirty() {
    for (const fn of checks) if (fn()) return true;
    return false;
  },
};

/** Registra a tela como "tem mudança sem salvar". Lê sempre o valor da última renderização. */
export function useDirty(isDirty) {
  const ref = useRef(false);
  ref.current = Boolean(isDirty);
  useEffect(() => guard.add(() => ref.current), []);
}

export function go(hash, { replace = false } = {}) {
  const h = hash.startsWith('#') ? hash : `#/${hash}`;
  if (replace) {
    history.replaceState(null, '', h);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else location.hash = h;
}

// ---------- Campos ----------
export function Field({ label, hint, error, children, class: cls = '', id }) {
  return html`<label class=${`field ${cls}`} for=${id}>
    <span>${label}</span>
    ${children}
    ${error ? html`<span class="error-text" role="alert">${error}</span>` : hint ? html`<span class="hint">${hint}</span>` : null}
  </label>`;
}

/** Campo de dinheiro: aceita "6,49" ou "6.49", devolve centavos (null se vazio, NaN se inválido). */
export function MoneyInput({ value, onValue, id, placeholder = '0,00', invalid, prefix = true, ...rest }) {
  const [text, setText] = useState(moneyInput(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      const parsed = parseMoney(text);
      if (parsed !== value && !(value === 0 && parsed === null)) setText(moneyInput(value));
    }
  }, [value]);
  const input = html`<input
    id=${id}
    type="text"
    inputmode="decimal"
    autocomplete="off"
    placeholder=${placeholder}
    value=${text}
    aria-invalid=${invalid ? 'true' : undefined}
    onInput=${(e) => {
      setText(e.currentTarget.value);
      const v = parseMoney(e.currentTarget.value);
      last.current = v;
      onValue(v);
    }}
    onBlur=${() => {
      const v = parseMoney(text);
      if (Number.isFinite(v)) setText(moneyInput(v));
    }}
    ...${rest}
  />`;
  return prefix ? html`<div class="affix"><span class="pre">R$</span>${input}</div>` : input;
}

/** Campo de número com vírgula. */
export function NumInput({ value, onValue, id, placeholder = '', invalid, suffix, max = 3, ...rest }) {
  const [text, setText] = useState(numInput(value, max));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      const parsed = parseNum(text);
      if (parsed !== value && !(value === 0 && parsed === null)) setText(numInput(value, max));
    }
  }, [value]);
  const input = html`<input
    id=${id}
    type="text"
    inputmode="decimal"
    autocomplete="off"
    placeholder=${placeholder}
    value=${text}
    aria-invalid=${invalid ? 'true' : undefined}
    onInput=${(e) => {
      setText(e.currentTarget.value);
      const v = parseNum(e.currentTarget.value);
      last.current = v;
      onValue(v);
    }}
    ...${rest}
  />`;
  return suffix ? html`<div class="affix">${input}<span class="post">${suffix}</span></div>` : input;
}

/** Escolha entre poucas opções, como botões lado a lado. */
export function Seg({ value, options, onChange, label, small = false }) {
  return html`<div class=${`seg${small ? ' seg-small' : ''}`} role="radiogroup" aria-label=${label}>
    ${options.map(
      (o) => html`<button type="button" role="radio" aria-checked=${value === o.v ? 'true' : 'false'} class=${value === o.v ? 'on' : ''} onClick=${() => onChange(o.v)}>
        ${o.label}${o.count ? html` <span class="seg-count">${o.count}</span>` : null}
      </button>`,
    )}
  </div>`;
}

// ---------- Janelas ----------
export function Sheet({ open, title, onClose, children, footer, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      const first = d.querySelector('[autofocus], input, select, textarea');
      first?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return html`<dialog
    ref=${ref}
    class=${`sheet${wide ? ' sheet-wide' : ''}`}
    onCancel=${(e) => {
      e.preventDefault();
      onClose();
    }}
    onClick=${(e) => {
      if (e.target === ref.current) onClose();
    }}
  >
    ${open
      ? html`<div class="sheet-in">
          <header class="sheet-head">
            <h2>${title}</h2>
            <button type="button" class="btn btn-ghost btn-small sheet-x" onClick=${onClose} aria-label="Fechar">Fechar</button>
          </header>
          <div class="sheet-body">${children}</div>
          ${footer ? html`<footer class="sheet-foot">${footer}</footer>` : null}
        </div>`
      : null}
  </dialog>`;
}

export function DialogHost() {
  const s = useStore();
  const d = s.dialog;
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (d && !el.open) {
      el.showModal();
      el.querySelector('.dialog-ok')?.focus();
    }
    if (!d && el.open) el.close();
  }, [d]);
  return html`<dialog ref=${ref} class="sheet sheet-ask" onCancel=${(e) => (e.preventDefault(), closeDialog(false))}>
    ${d
      ? html`<div class="sheet-in">
          <div class="sheet-body ask">
            <h2>${d.title}</h2>
            ${d.text ? html`<p class="muted">${d.text}</p>` : null}
          </div>
          <footer class="sheet-foot">
            <button type="button" class="btn" onClick=${() => closeDialog(false)}>${d.cancel}</button>
            <button type="button" class=${`btn dialog-ok ${d.danger ? 'btn-danger' : 'btn-main'}`} onClick=${() => closeDialog(true)}>${d.ok}</button>
          </footer>
        </div>`
      : null}
  </dialog>`;
}

// ---------- Mostradores ----------
/** Visor de balança com o valor em dígitos de 7 segmentos. */
export function Lcd({ label, cents, sub, empty = '-.--' }) {
  const ok = Number.isFinite(cents) && cents > 0;
  const v = ok ? (Math.round(cents) / 100).toFixed(2) : empty;
  const ghost = v.replace(/[0-9-]/g, '8');
  return html`<div class="lcd" role="group" aria-label=${`${label}: ${ok ? brl(cents) : 'sem valor'}`}>
    <span class="lcd-label" aria-hidden="true">${label}</span>
    <span class="lcd-digits" aria-hidden="true"><span class="cur">R$</span><span class="val"><span class="ghost">${ghost}</span><span class="lit">${v}</span></span></span>
    ${sub ? html`<span class="lcd-sub">${sub}</span>` : null}
  </div>`;
}

export const VERDICT = {
  ok: { cls: 'chip-good', text: (v) => `Lucro de ${pct(v.margin)}` },
  baixo: { cls: 'chip-warn', text: (v) => `Lucro de ${pct(v.margin)}, abaixo da meta` },
  tempo: { cls: 'chip-warn', text: () => 'Não paga todo o seu tempo' },
  prejuizo: { cls: 'chip-bad', text: () => 'Prejuízo' },
  semPreco: { cls: '', text: () => 'Sem preço' },
};

export function Verdict({ v }) {
  if (!v) return null;
  const k = VERDICT[v.status] || VERDICT.semPreco;
  return html`<span class=${`chip ${k.cls}`}>${k.text(v)}</span>`;
}

export const VERDICT_HELP = {
  ok: 'O preço paga ingredientes, embalagem, seu tempo, os custos fixos e ainda deixa o lucro que você quer.',
  baixo: 'Paga tudo, mas sobra menos lucro do que a sua meta.',
  tempo: 'Paga ingredientes e embalagem, mas não paga todo o seu tempo e os custos fixos. Você está trabalhando de graça em parte.',
  prejuizo: 'Não paga nem os ingredientes e a embalagem. Cada venda tira dinheiro do seu bolso.',
  semPreco: 'Coloque o preço que você cobra para ver o lucro.',
};

export function Empty({ title, children }) {
  return html`<div class="empty"><h3>${title}</h3>${children}</div>`;
}

export function PageHead({ title, sub, back, children }) {
  return html`<header class="page-head">
    ${back ? html`<a class="back" href=${back.href}>${back.label}</a>` : null}
    <div class="page-head-row">
      <div class="page-title">
        <h1>${title}</h1>
        ${sub ? html`<p class="muted">${sub}</p>` : null}
      </div>
      ${children ? html`<div class="page-actions">${children}</div>` : null}
    </div>
  </header>`;
}

export function Loading({ text = 'Carregando…' }) {
  return html`<p class="loading" role="status">${text}</p>`;
}

export function ErrorBox({ error, onRetry }) {
  return html`<div class="callout callout-bad" role="alert">
    <p>${error}</p>
    ${onRetry ? html`<button type="button" class="btn btn-small" onClick=${onRetry}>Tentar de novo</button>` : null}
  </div>`;
}

/** Conteúdo do Pro: mostra uma prévia apagada e o convite para assinar. */
export function ProLock({ title, text, children }) {
  return html`<div class="prolock">
    <div class="prolock-preview" aria-hidden="true" inert>${children}</div>
    <div class="prolock-card">
      <h3>${title}</h3>
      <p>${text}</p>
      <a class="btn btn-main" href="#/conta?aba=plano">Ver o Pro</a>
    </div>
  </div>`;
}

/** Carrega algo do servidor e recarrega quando as dependências mudam. */
export function useAsync(fn, deps) {
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  const run = useCallback(() => {
    let alive = true;
    setSt((x) => ({ ...x, loading: true, error: null }));
    Promise.resolve()
      .then(fn)
      .then((data) => alive && setSt({ loading: false, data, error: null }))
      .catch((e) => alive && setSt({ loading: false, data: null, error: e.message || 'Erro ao carregar.' }));
    return () => {
      alive = false;
    };
  }, deps);
  useEffect(run, [run]);
  return { ...st, reload: run };
}

export const money = (c) => brl(Math.round(c || 0));
export const num = fmtNum;

/** Mantém a mensagem de erro de um campo vinda do servidor. */
export function fieldError(err, field) {
  if (!err) return '';
  if (err.field === field || (field && err.field && err.field.startsWith(`${field}.`))) return err.message;
  return '';
}
