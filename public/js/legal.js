// Preenche marca, responsável, contato e valores atuais nas páginas de termos e privacidade.
import { getConfig } from './lib/api.js';
import { brl } from './shared/format.js';

getConfig().then((c) => {
  const values = {
    ownerName: c.ownerName,
    contactEmail: c.contactEmail,
    freeProducts: c.freeProducts,
    freeOrders: c.freeOrders,
    trialDays: c.trialDays,
    refundDays: c.refundDays,
  };
  for (const p of c.plans || []) values[`price-${p.id}`] = brl(p.cents);
  for (const node of document.querySelectorAll('[data-cfg]')) {
    const v = values[node.dataset.cfg];
    if (v !== undefined && v !== null && v !== '') node.textContent = String(v);
  }
  for (const node of document.querySelectorAll('[data-brand]')) node.textContent = c.brand;
});
