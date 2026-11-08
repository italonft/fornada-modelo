// Cardápio público de cada loja, pedido feito pelo cliente, página do pedido para o cliente e fotos.
import { orderMath, saleFactor } from '../public/js/shared/calc.js';
import { brl, dayLabel, fmtNum, longDate, phoneDigits, phoneText, STATUS_LABEL, timeText, today, addDays } from '../public/js/shared/format.js';
import { checkMenuOrder, Invalid, newId, normSettings } from '../public/js/shared/schema.js';
import { isPro } from './auth.js';
import { nextNumber, priceOrder } from './orders.js';
import { clientKey, randomToken } from './security.js';
import { allow, bump, loadWorkspace, parseJson } from './store.js';
import { esc, layout, notFound, safeJson } from './pages.js';
import { HttpError, dayOf, html, isBot, json, readJson } from './util.js';

const SLUG = /^[a-z0-9-]{3,40}$/;

export const unitName = (f) => f.sell?.label || ({ un: 'unidade', g: 'kg', kg: 'kg', ml: 'litro', l: 'litro' })[f.yieldUnit] || 'unidade';

/** Produtos que aparecem no cardápio. No plano grátis, só os primeiros, pela data de criação. */
export async function menuProducts(env, c, account, now = Date.now()) {
  const { results } = await env.DB.prepare('SELECT id, data, created_at FROM fichas WHERE account_id = ?1 AND sell = 1 AND menu = 1 ORDER BY created_at, id').bind(account.id).all();
  const max = isPro(account, now) ? c.proProducts : c.freeProducts;
  const all = results.map((r) => ({ ...parseJson(r.data), id: r.id }));
  return all.slice(0, max);
}

async function loadBySlug(env, slug) {
  if (!SLUG.test(slug)) return null;
  return env.DB.prepare('SELECT * FROM accounts WHERE slug = ?1').bind(slug).first();
}

function productView(f) {
  return {
    id: f.id,
    name: f.name,
    desc: f.menu?.desc || '',
    cat: f.menu?.cat || '',
    price: f.sell?.price || 0,
    unit: unitName(f),
    step: saleFactor(f) === 1 ? 1 : 0.5,
    photo: f.menu?.photo || '',
  };
}

export async function menuPage(req, env, ctx, c, url, slug) {
  const a = await loadBySlug(env, slug);
  if (!a) return notFound(c, 'Este cardápio não existe.');
  const s = normSettings(parseJson(a.settings));
  if (!s.menu.on) return notFound(c, 'Este cardápio não está aberto agora.');
  const products = (await menuProducts(env, c, a)).map(productView);
  if (!isBot(req)) ctx.waitUntil(bump(env, 'cardapio_visita', '').catch(() => {}));

  const cats = [];
  for (const p of products) {
    let cat = cats.find((x) => x.name === p.cat);
    if (!cat) cats.push((cat = { name: p.cat, items: [] }));
    cat.items.push(p);
  }
  const meta = [s.city, s.instagram ? `@${s.instagram}` : ''].filter(Boolean);
  const delivery = { retirada: 'Só retirada', entrega: 'Só entrega', ambos: 'Retirada ou entrega' }[s.menu.delivery];
  const notes = [
    s.menu.leadDays > 0 ? `Encomendas com ${s.menu.leadDays} ${s.menu.leadDays === 1 ? 'dia' : 'dias'} de antecedência.` : 'Aceita pedidos para hoje.',
    `${delivery}${s.menu.deliveryNote ? `: ${s.menu.deliveryNote}` : '.'}`,
    s.menu.minOrder > 0 ? `Pedido mínimo de ${brl(s.menu.minOrder)}.` : '',
  ].filter(Boolean);
  const item = (p) => `<li class="dish" data-id="${esc(p.id)}">
      ${p.photo ? `<img class="dish-photo" src="/f/${esc(p.photo)}" alt="" loading="lazy" width="96" height="96">` : '<span class="dish-photo dish-photo-empty" aria-hidden="true"></span>'}
      <div class="dish-text">
        <h3>${esc(p.name)}</h3>
        ${p.desc ? `<p class="dish-desc">${esc(p.desc)}</p>` : ''}
        <p class="dish-price">${p.price > 0 ? `${esc(brl(p.price))} <span>por ${esc(p.unit)}</span>` : '<span>Preço a combinar</span>'}</p>
      </div>
      <div class="dish-qty" data-slot="qty"></div>
    </li>`;
  const body = `<header class="menu-top">
  <div class="menu-top-in">
    <h1>${esc(a.business)}</h1>
    ${meta.length ? `<p class="menu-meta">${meta.map(esc).join(' <span aria-hidden="true">/</span> ')}</p>` : ''}
  </div>
</header>
<main class="menu-main">
  ${s.menu.note ? `<p class="menu-note">${esc(s.menu.note).replace(/\n/g, '<br>')}</p>` : ''}
  <ul class="menu-rules">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
  ${
    products.length
      ? cats.map((cat) => `<section class="menu-cat">${cat.name ? `<h2>${esc(cat.name)}</h2>` : ''}<ul class="dishes">${cat.items.map(item).join('')}</ul></section>`).join('')
      : '<p class="menu-empty">O cardápio está sendo montado. Volte daqui a pouco.</p>'
  }
  ${s.whatsapp ? `<p class="menu-contact">Dúvidas? WhatsApp <a href="https://wa.me/55${esc(phoneDigits(s.whatsapp))}" rel="noopener">${esc(phoneText(s.whatsapp))}</a></p>` : ''}
</main>
<div id="carrinho"></div>
<footer class="made-with">
  <p>Cardápio feito com <a href="/?ref=cardapio">${esc(c.brand)}</a>. Vende doce, salgado ou marmita? <a href="/?ref=cardapio">Monte o seu de graça</a>.</p>
</footer>
<script type="application/json" id="dados">${safeJson({
    slug: a.slug,
    business: a.business,
    whatsapp: phoneDigits(s.whatsapp),
    leadDays: s.menu.leadDays,
    delivery: s.menu.delivery,
    deliveryNote: s.menu.deliveryNote,
    minOrder: s.menu.minOrder,
    today: today(),
    products,
  })}</script>`;
  const first = products.find((p) => p.photo);
  return html(
    layout({
      title: `${a.business} · Cardápio`,
      description: `Faça seu pedido para ${a.business}${s.city ? ` em ${s.city}` : ''}.`,
      css: ['/css/publico.css'],
      js: ['/js/cardapio.js'],
      body,
      bodyClass: 'public',
      og: { title: `${a.business}: cardápio`, image: first ? `${url.origin}/f/${first.photo}` : `${url.origin}/img/og.png`, url: `${url.origin}/c/${a.slug}` },
    }),
  );
}

/** Pedido feito pelo cliente no cardápio. Preço e custo vêm do servidor, nunca do navegador. */
export async function menuOrder(req, env, c, url, slug) {
  const a = await loadBySlug(env, slug);
  if (!a) throw new HttpError(404, 'Cardápio não encontrado.');
  const s = normSettings(parseJson(a.settings));
  if (!s.menu.on) throw new HttpError(404, 'Este cardápio não está aberto agora.');
  if (!(await allow(env, `cardapio-ip:${await clientKey(req, 'cardapio')}`, 8, 3600000))) throw new HttpError(429, 'Muitos pedidos seguidos. Espere um pouco ou chame a loja no WhatsApp.');
  if (!(await allow(env, `cardapio-loja:${a.id}`, 60, 3600000))) throw new HttpError(429, 'A loja recebeu muitos pedidos agora. Tente de novo em alguns minutos ou chame no WhatsApp.');
  const body = await readJson(req, 8192);
  if (body.site) return json({ ok: true, num: 0, token: '' }, 201);
  let req1;
  try {
    req1 = checkMenuOrder(body);
  } catch (e) {
    if (e instanceof Invalid) throw new HttpError(422, e.message, { field: e.field });
    throw e;
  }
  const now = Date.now();
  const first = addDays(today(now), s.menu.leadDays);
  if (req1.date < first) throw new HttpError(422, s.menu.leadDays > 0 ? `Esta loja aceita pedidos a partir de ${dayLabel(first)}.` : 'Escolha hoje ou um dia depois.', { field: 'date' });
  if (req1.date > addDays(today(now), 180)) throw new HttpError(422, 'Escolha uma data nos próximos 6 meses.', { field: 'date' });
  if (s.menu.delivery !== 'ambos' && req1.delivery !== s.menu.delivery) throw new HttpError(422, s.menu.delivery === 'entrega' ? 'Esta loja só faz entrega.' : 'Esta loja só tem retirada.', { field: 'delivery' });
  const products = new Map((await menuProducts(env, c, a, now)).map((f) => [f.id, f]));
  const items = [];
  for (const it of req1.items) {
    const f = products.get(it.id);
    if (!f) throw new HttpError(409, 'Um dos produtos saiu do cardápio. Atualize a página e escolha de novo.');
    const step = saleFactor(f) === 1 ? 1 : 0.5;
    const qty = Math.max(step, Math.round(it.qty / step) * step);
    items.push({ f: f.id, name: f.name, qty, price: f.sell?.price || 0, cost: 0, min: 0 });
  }
  const ws = await loadWorkspace(env, a);
  const order = priceOrder(
    { id: '', customer: req1.name, phone: req1.phone, dueDate: req1.date, dueTime: req1.time, delivery: req1.delivery, address: req1.address, deliveryFee: 0, discount: 0, channel: 'direto', items, paid: 0, status: 'orcamento', notes: req1.notes },
    ws,
  );
  const math = orderMath(order);
  if (s.menu.minOrder > 0 && math.items < s.menu.minOrder) throw new HttpError(422, `O pedido mínimo é de ${brl(s.menu.minOrder)}.`, { field: 'items' });
  const id = newId();
  const token = randomToken(18);
  const num = await nextNumber(env, a.id);
  const { id: _id, status: _st, dueDate: _due, ...data } = order;
  await env.DB.prepare(
    "INSERT INTO orders (account_id, id, num, token, status, due_date, origin, seen, month, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'orcamento', ?5, 'cardapio', 0, ?6, ?7, ?8, ?8)",
  )
    .bind(a.id, id, num, token, req1.date, dayOf(now).slice(0, 7), JSON.stringify(data), now)
    .run();
  await bump(env, 'cardapio_pedido', '', now);
  return json({ ok: true, num, token, total: math.total, items: order.items.map((x) => ({ name: x.name, qty: x.qty, price: x.price })), whatsapp: phoneDigits(s.whatsapp) }, 201);
}

const STEPS = ['orcamento', 'confirmado', 'pronto', 'entregue'];
const STEP_TEXT = {
  orcamento: 'A loja recebeu o pedido e vai confirmar com você.',
  confirmado: 'Pedido confirmado. Já está na agenda da loja.',
  pronto: 'Pedido pronto!',
  entregue: 'Pedido entregue. Bom apetite!',
  cancelado: 'Este pedido foi cancelado.',
};

export async function orderPage(req, env, c, url, token) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return notFound(c, 'Pedido não encontrado.');
  const r = await env.DB.prepare('SELECT o.*, a.business, a.settings, a.slug FROM orders o JOIN accounts a ON a.id = o.account_id WHERE o.token = ?1').bind(token).first();
  if (!r) return notFound(c, 'Pedido não encontrado.');
  const s = normSettings(parseJson(r.settings));
  const o = { ...parseJson(r.data), status: r.status, dueDate: r.due_date };
  const m = orderMath(o);
  const step = STEPS.indexOf(r.status);
  const rel = dayLabel(o.dueDate);
  const when = `${/^(Hoje|Amanhã|Ontem)$/.test(rel) ? `${rel}, ` : ''}${longDate(o.dueDate)}${o.dueTime ? `, às ${timeText(o.dueTime)}` : ''}`;
  const qtyOf = (it) => fmtNum(it.qty, 3);
  const body = `<main class="ticket-page">
  <article class="ticket">
    <header class="ticket-head">
      <p class="ticket-shop">${esc(r.business)}</p>
      <h1>Pedido nº ${esc(r.num)}</h1>
      <p class="ticket-who">${esc(o.customer || 'Cliente')}</p>
    </header>
    ${
      r.status === 'cancelado'
        ? `<p class="ticket-status ticket-status-off">${esc(STEP_TEXT.cancelado)}</p>`
        : `<ol class="ticket-steps">${STEPS.map((st, i) => `<li class="${i <= step ? 'done' : ''}${i === step ? ' now' : ''}">${esc(STATUS_LABEL[st] === 'Orçamento' ? 'Recebido' : STATUS_LABEL[st])}</li>`).join('')}</ol>
    <p class="ticket-status">${esc(STEP_TEXT[r.status] || '')}</p>`
    }
    <dl class="ticket-when">
      <div><dt>${o.delivery === 'entrega' ? 'Entrega' : 'Retirada'}</dt><dd>${esc(when)}</dd></div>
      ${o.delivery === 'entrega' && o.address ? `<div><dt>Endereço</dt><dd>${esc(o.address).replace(/\n/g, '<br>')}</dd></div>` : ''}
    </dl>
    <table class="ticket-items">
      <tbody>
        ${o.items.map((it) => `<tr><td class="q">${esc(qtyOf(it))}×</td><td>${esc(it.name)}</td><td class="v">${it.price > 0 ? esc(brl(Math.round(it.qty * it.price))) : 'a combinar'}</td></tr>`).join('')}
        ${m.delivery ? `<tr class="sub"><td></td><td>Entrega</td><td class="v">${esc(brl(m.delivery))}</td></tr>` : ''}
        ${m.discount ? `<tr class="sub"><td></td><td>Desconto</td><td class="v">-${esc(brl(m.discount))}</td></tr>` : ''}
      </tbody>
      <tfoot>
        <tr><td></td><th scope="row">Total</th><td class="v">${esc(brl(m.total))}</td></tr>
        ${m.paid ? `<tr class="sub"><td></td><td>Já pago</td><td class="v">${esc(brl(Math.min(m.paid, m.total)))}</td></tr>` : ''}
        ${m.paid && r.status !== 'cancelado' ? `<tr class="due"><td></td><th scope="row">Falta pagar</th><td class="v">${esc(brl(m.due))}</td></tr>` : ''}
      </tfoot>
    </table>
    ${
      s.pixKey && m.due > 0 && r.status !== 'cancelado'
        ? `<section class="ticket-pix">
      <h2>Pagar com Pix</h2>
      <p>Chave Pix${s.pixName ? ` de ${esc(s.pixName)}` : ''}:</p>
      <p class="pix-key"><code id="chave">${esc(s.pixKey)}</code> <button type="button" class="btn btn-small" data-copy="chave">Copiar</button></p>
      <p class="hint">Confira o nome de quem recebe antes de confirmar. Depois mande o comprovante para a loja.</p>
    </section>`
        : ''
    }
    ${s.whatsapp ? `<p class="ticket-contact"><a class="btn btn-main" href="https://wa.me/55${esc(phoneDigits(s.whatsapp))}?text=${encodeURIComponent(`Olá! Sobre o pedido nº ${r.num}:`)}" rel="noopener">Falar com a loja no WhatsApp</a></p>` : ''}
  </article>
  <p class="made-with">Pedido organizado com <a href="/?ref=pedido">${esc(c.brand)}</a>, o app de quem vende comida feita em casa.</p>
</main>`;
  return html(layout({ title: `Pedido nº ${r.num} · ${r.business}`, body, css: ['/css/publico.css'], js: ['/js/pedido.js'], noindex: true, bodyClass: 'public' }), 200, { 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
}

export async function photo(env, id) {
  if (!/^[23456789abcdefghjkmnpqrstuvwxyz]{16}$/.test(id)) return new Response('não encontrado', { status: 404 });
  const r = await env.DB.prepare('SELECT mime, bytes FROM photos WHERE id = ?1').bind(id).first();
  if (!r) return new Response('não encontrado', { status: 404 });
  const bytes = r.bytes instanceof ArrayBuffer ? new Uint8Array(r.bytes) : Array.isArray(r.bytes) ? Uint8Array.from(r.bytes) : r.bytes;
  return new Response(bytes, { headers: { 'content-type': r.mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } });
}
