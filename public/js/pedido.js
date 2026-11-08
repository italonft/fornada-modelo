// Página do pedido para o cliente: copiar a chave Pix da loja.
import { copyText, toast } from './lib/api.js';

for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy)?.textContent || '';
    if (await copyText(text)) {
      btn.textContent = 'Copiado';
      toast('Chave Pix copiada.');
    } else toast('Selecione a chave e copie.', { bad: true });
  });
}
