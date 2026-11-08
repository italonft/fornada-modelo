// Conversa com o servidor e pequenos ajudantes de tela usados em todas as páginas.

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || (status === 0 ? 'Sem conexão. Confira a internet e tente de novo.' : 'Algo deu errado. Tente de novo.'));
    this.status = status;
    this.data = data || {};
    this.field = data?.field;
    this.code = data?.code;
  }
}

export async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: raw ? headers : body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, null);
  }
  let data = null;
  if ((res.headers.get('content-type') || '').includes('json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

let configPromise = null;
export function getConfig() {
  configPromise ??= api('/api/config').catch(() => ({ brand: 'Fornada', plans: [], freeProducts: 5, freeOrders: 20, trialDays: 7, refundDays: 7, paymentsEnabled: false }));
  return configPromise;
}

let zone = null;
export function toast(message, { bad = false, ms = 3800 } = {}) {
  if (!zone) {
    zone = document.createElement('div');
    zone.className = 'toast-zone';
    zone.setAttribute('role', 'status');
    zone.setAttribute('aria-live', 'polite');
    document.body.append(zone);
  }
  const t = document.createElement('div');
  t.className = bad ? 'toast toast-bad' : 'toast';
  t.textContent = message;
  zone.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Copia texto. Se o navegador recusar, devolve false para a tela mostrar o texto selecionável. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Guarda de onde a pessoa veio (?ref=insta) para contar no painel do dono. */
export function rememberRef() {
  try {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref && /^[a-z0-9_-]{1,40}$/i.test(ref)) localStorage.setItem('fornada-ref', ref.toLowerCase());
    return localStorage.getItem('fornada-ref') || '';
  } catch {
    return '';
  }
}

export function track(name) {
  const ref = rememberRef();
  fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, ref }) }).catch(() => {});
}

export function readLocal(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : JSON.parse(v);
  } catch {
    return def;
  }
}

export function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem armazenamento: segue sem lembrar */
  }
}
