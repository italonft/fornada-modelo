// Entrar, criar conta, recuperar a senha e senha nova pelo link do suporte.
import { api, copyText, getConfig, rememberRef, toast } from './lib/api.js';

const card = document.querySelector('[data-page]');
const page = card.dataset.page;
const form = document.getElementById('form');
const errBox = document.getElementById('erro');
const ref = rememberRef();

getConfig().then((c) => {
  document.querySelectorAll('[data-brand]').forEach((el) => (el.textContent = c.brand));
  document.querySelectorAll('[data-trial]').forEach((el) => (el.textContent = `${c.trialDays} ${c.trialDays === 1 ? 'dia' : 'dias'}`));
  const sem = document.getElementById('sem-codigo');
  if (sem && c.contactEmail) sem.textContent = `Perdeu o código? Escreva para ${c.contactEmail} a partir do e-mail da conta.`;
});

function nextUrl() {
  const back = new URLSearchParams(location.search).get('volta') || '';
  return /^#\/[a-z0-9/?=&-]*$/i.test(back) ? `/app${back}` : '/app';
}

function showError(e) {
  errBox.textContent = e.message;
  errBox.hidden = false;
  for (const el of form.elements) el.removeAttribute?.('aria-invalid');
  if (e.field && form.elements[e.field]) {
    form.elements[e.field].setAttribute('aria-invalid', 'true');
    form.elements[e.field].focus();
  }
}

function showCode(code) {
  document.getElementById('etapa-form')?.setAttribute('hidden', '');
  form.hidden = true;
  const box = document.getElementById('codigo');
  document.getElementById('codigo-texto').textContent = code;
  box.hidden = false;
  document.getElementById('copiar-codigo').addEventListener('click', async () => {
    if (await copyText(code)) toast('Código copiado.');
    else toast('Selecione o código e copie.', { bad: true });
  });
  document.getElementById('abrir-app').focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errBox.hidden = true;
  const btn = form.querySelector('button.btn-main');
  const data = Object.fromEntries(new FormData(form));
  if ((page === 'comecar' || page === 'recuperar' || page === 'nova-senha') && String(data.password || '').length < 8) {
    return showError({ message: 'A senha precisa ter pelo menos 8 caracteres.', field: 'password' });
  }
  btn.disabled = true;
  try {
    if (page === 'entrar') {
      await api('/api/conta/entrar', { method: 'POST', body: data });
      location.href = nextUrl();
    } else if (page === 'comecar') {
      const r = await api('/api/conta/criar', { method: 'POST', body: { ...data, ref } });
      if (!r.recoveryCode) return location.reload();
      showCode(r.recoveryCode);
    } else if (page === 'recuperar') {
      const r = await api('/api/conta/recuperar', { method: 'POST', body: data });
      showCode(r.recoveryCode);
    } else if (page === 'nova-senha') {
      const token = location.hash.slice(1);
      const r = await api('/api/conta/nova-senha', { method: 'POST', body: { ...data, token } });
      history.replaceState(null, '', location.pathname);
      showCode(r.recoveryCode);
    }
  } catch (ex) {
    showError(ex);
  } finally {
    btn.disabled = false;
  }
});

if (page === 'nova-senha' && !location.hash.slice(1)) {
  showError({ message: 'Link incompleto. Abra de novo o link que o suporte mandou.' });
}
