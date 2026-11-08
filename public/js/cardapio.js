// Cardápio público: escolher, revisar e mandar o pedido. O pedido entra na agenda da loja e abre o WhatsApp dela.
import { addDays, brl, dayLabel, fmtNum, phoneDigits, timeText, waLink } from './shared/format.js';
import { api, readLocal, writeLocal } from './lib/api.js';

const data = JSON.parse(document.getElementById('dados').textContent);
const byId = new Map(data.products.map((p) => [p.id, p]));
const KEY = `fornada-carrinho-${data.slug}`;
const cart = new Map(Object.entries(readLocal(KEY, {})).filter(([id, q]) => byId.has(id) && q > 0));
const firstDate = addDays(data.today, data.leadDays);

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.filter((x) => x !== null && x !== undefined && x !== false));
  return n;
};

const save = () => writeLocal(KEY, Object.fromEntries(cart));
const qtyText = (p, q) => (p.step === 1 ? String(q) : `${fmtNum(q, 1)} ${p.unit}`);
const total = () => [...cart].reduce((a, [id, q]) => a + Math.round(q * (byId.get(id)?.price || 0)), 0);

function setQty(id, q) {
  const p = byId.get(id);
  const v = Math.max(0, Math.round(q / p.step) * p.step);
  if (v > 0) cart.set(id, Math.min(v, 500));
  else cart.delete(id);
  save();
  renderQty(id);
  renderBar();
}

function renderQty(id) {
  const slot = document.querySelector(`.dish[data-id="${id}"] [data-slot="qty"]`);
  if (!slot) return;
  const p = byId.get(id);
  const q = cart.get(id) || 0;
  if (!q) {
    slot.replaceChildren(el('button', { type: 'button', class: 'btn btn-small', onclick: () => setQty(id, p.step) , 'aria-label': `Adicionar ${p.name}` }, 'Adicionar'));
    return;
  }
  slot.replaceChildren(
    el(
      'div',
      { class: 'stepper', role: 'group', 'aria-label': `Quantidade de ${p.name}` },
      el('button', { type: 'button', onclick: () => setQty(id, q - p.step), 'aria-label': 'Menos' }, '−'),
      el('output', { 'aria-live': 'polite' }, qtyText(p, q)),
      el('button', { type: 'button', onclick: () => setQty(id, q + p.step), 'aria-label': 'Mais' }, '+'),
    ),
  );
}

const root = document.getElementById('carrinho');
const bar = el('div', { class: 'cart-bar', hidden: true });
root.append(bar);

function renderBar() {
  const n = cart.size;
  bar.hidden = n === 0;
  if (!n) return;
  bar.replaceChildren(
    el('div', { class: 'cart-bar-in' }, el('span', {}, `${n} ${n === 1 ? 'item' : 'itens'} · `, el('strong', {}, brl(total()))), el('button', { type: 'button', class: 'btn btn-main', onclick: openCheckout }, 'Ver pedido')),
  );
}

const dlg = el('dialog', { class: 'checkout', 'aria-labelledby': 'co-title' });
root.append(dlg);
dlg.addEventListener('click', (e) => {
  if (e.target === dlg) dlg.close();
});

function field(label, input, hint) {
  return el('label', { class: 'field' }, el('span', {}, label), input, hint ? el('span', { class: 'hint' }, hint) : null);
}

function openCheckout() {
  const items = [...cart].map(([id, q]) => ({ p: byId.get(id), q }));
  const sum = total();
  const deliveryOpts = data.delivery === 'ambos' ? ['retirada', 'entrega'] : [data.delivery];
  const err = el('p', { class: 'error-text', role: 'alert', hidden: true });
  const address = el('textarea', { name: 'address', rows: '2', maxlength: '200', autocomplete: 'street-address' });
  const addressField = field('Endereço de entrega', address, data.deliveryNote || 'A taxa de entrega a loja combina com você.');
  addressField.hidden = deliveryOpts[0] !== 'entrega';
  const radios = el(
    'div',
    { class: 'radio-row', role: 'radiogroup', 'aria-label': 'Retirada ou entrega' },
    ...deliveryOpts.map((d, i) => el('label', {}, el('input', { type: 'radio', name: 'delivery', value: d, checked: i === 0, onchange: () => (addressField.hidden = d !== 'entrega') }), d === 'entrega' ? 'Entrega' : 'Retirada')),
  );
  const btn = el('button', { class: 'btn btn-main btn-block' }, data.whatsapp ? 'Enviar pedido pelo WhatsApp' : 'Enviar pedido');
  const form = el(
    'form',
    { novalidate: true },
    field('Seu nome', el('input', { name: 'name', maxlength: '60', autocomplete: 'name', required: true })),
    field('Seu WhatsApp', el('input', { name: 'phone', inputmode: 'tel', autocomplete: 'tel', placeholder: '(11) 98765-4321', required: true })),
    el('div', { class: 'two' }, field('Para quando', el('input', { name: 'date', type: 'date', min: firstDate, value: firstDate, required: true })), field('Horário', el('input', { name: 'time', type: 'time' }), 'Opcional')),
    radios,
    addressField,
    field('Observação', el('textarea', { name: 'notes', rows: '2', maxlength: '500' }), 'Ex.: sem granulado, escrever "Parabéns, Ana".'),
    el('label', { class: 'trap', 'aria-hidden': 'true' }, 'Site', el('input', { name: 'site', tabindex: '-1', autocomplete: 'off' })),
    err,
    btn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const f = Object.fromEntries(new FormData(form));
    if (data.minOrder > 0 && sum < data.minOrder) return showErr(`O pedido mínimo é de ${brl(data.minOrder)}.`);
    if (!f.name.trim()) return showErr('Digite seu nome.');
    if (!phoneDigits(f.phone)) return showErr('Digite seu WhatsApp com DDD.');
    btn.disabled = true;
    try {
      const r = await api(`/api/c/${data.slug}/pedido`, { method: 'POST', body: { ...f, items: [...cart].map(([id, qty]) => ({ id, qty })) } });
      cart.clear();
      save();
      data.products.forEach((p) => renderQty(p.id));
      renderBar();
      done(r, f);
    } catch (ex) {
      showErr(ex.message);
    } finally {
      btn.disabled = false;
    }
  });
  function showErr(m) {
    err.textContent = m;
    err.hidden = false;
  }
  dlg.replaceChildren(
    el(
      'div',
      { class: 'checkout-in' },
      el('div', { class: 'checkout-head' }, el('h2', { id: 'co-title' }, 'Seu pedido'), el('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => dlg.close() }, 'Fechar')),
      el('ul', { class: 'checkout-items' }, ...items.map(({ p, q }) => el('li', {}, el('span', {}, `${qtyText(p, q)} × ${p.name}`), el('span', {}, p.price > 0 ? brl(Math.round(q * p.price)) : 'a combinar')))),
      el('p', { class: 'checkout-total' }, el('span', {}, 'Total'), el('span', {}, brl(sum))),
      data.minOrder > 0 && sum < data.minOrder ? el('p', { class: 'error-text' }, `Pedido mínimo: ${brl(data.minOrder)}.`) : null,
      form,
    ),
  );
  if (!dlg.open) dlg.showModal();
}

function done(r, f) {
  const lines = [`Olá! Fiz um pedido pelo cardápio (nº ${r.num}):`, ''];
  for (const it of r.items) lines.push(`• ${fmtNum(it.qty, 3)} × ${it.name}${it.price > 0 ? ` — ${brl(Math.round(it.qty * it.price))}` : ''}`);
  lines.push('', `Total: ${brl(r.total)}`, `Para: ${dayLabel(f.date, data.today)}${f.time ? `, ${timeText(f.time)}` : ''} — ${f.delivery === 'entrega' ? 'Entrega' : 'Retirada'}`);
  if (f.delivery === 'entrega' && f.address) lines.push(`Endereço: ${f.address.replace(/\n/g, ', ')}`);
  lines.push(`Nome: ${f.name}`);
  if (f.notes) lines.push(`Obs.: ${f.notes}`);
  if (r.token) lines.push('', `Acompanhar: ${location.origin}/p/${r.token}`);
  const link = waLink(lines.join('\n'), r.whatsapp || data.whatsapp);
  dlg.replaceChildren(
    el(
      'div',
      { class: 'checkout-in' },
      el(
        'div',
        { class: 'sent' },
        el('h2', {}, `Pedido nº ${r.num} enviado!`),
        el('p', {}, data.whatsapp ? 'Agora é só mandar a mensagem no WhatsApp da loja. Ela confirma com você o valor final e o pagamento.' : 'A loja recebeu o pedido e vai falar com você no WhatsApp.'),
        data.whatsapp ? el('a', { class: 'btn btn-main', href: link, rel: 'noopener' }, 'Abrir o WhatsApp') : null,
        r.token ? el('a', { href: `/p/${r.token}` }, 'Acompanhar o pedido') : null,
      ),
    ),
  );
  if (data.whatsapp) location.href = link;
}

data.products.forEach((p) => renderQty(p.id));
renderBar();
