// Sair da conta, perguntando antes se há mudança sem salvar.
import { api } from '../lib/api.js';
import { ask } from './store.js';
import { guard } from './ui.js';

export async function logout() {
  if (guard.dirty() && !(await ask({ title: 'Sair sem salvar?', text: 'As mudanças desta tela vão se perder.', ok: 'Sair', danger: true }))) return;
  guard.clear();
  try {
    await api('/api/conta/sair', { method: 'POST' });
  } finally {
    location.href = '/entrar';
  }
}
