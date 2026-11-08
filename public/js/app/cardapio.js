// Cardápio online: o link que a loja divulga, o que aparece nele e como o cliente pede.
import { html, useEffect, useState } from '../vendor/index.mjs';
import { brl, phoneDigits } from '../shared/format.js';
import { copyText, toast } from '../lib/api.js';
import { isPro, saveAccount, saveFicha, useStore } from './store.js';
import { Field, MoneyInput, NumInput, PageHead, Seg, guard, useDirty } from './ui.js';
import { menuShareMessage } from './mensagens.js';
import { saleLabel } from './produtos.js';

export function CardapioConfig() {
  const s = useStore();
  const a = s.account;
  const [m, setM] = useState(() => ({ ...a.settings.menu, whatsapp: a.settings.whatsapp, instagram: a.settings.instagram, city: a.settings.city }));
  const [snap, setSnap] = useState(() => JSON.stringify(m));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const url = `${location.origin}/c/${a.slug}`;
  const selling = s.fichas.filter((f) => f.sell?.on);
  const onMenu = selling.filter((f) => f.menu?.on);
  const max = a.limits.products;
  const pro = isPro(s);
  const up = (patch) => setM((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify(m) !== snap;
  useDirty(JSON.stringify(m) !== snap);

  async function save(e) {
    e.preventDefault();
    setErr(null);
    const wa = phoneDigits(m.whatsapp);
    if (m.whatsapp && !wa) return setErr({ field: 'whatsapp', message: 'WhatsApp: use DDD e número, como 11 98765-4321.' });
    setBusy(true);
    try {
      const { whatsapp, instagram, city, ...menu } = m;
      const acc = await saveAccount({ settings: { ...a.settings, whatsapp: wa, instagram, city, menu } });
      const next = { ...acc.settings.menu, whatsapp: acc.settings.whatsapp, instagram: acc.settings.instagram, city: acc.settings.city };
      setM(next);
      setSnap(JSON.stringify(next));
      toast('Cardápio salvo.');
    } catch (ex) {
      setErr({ field: ex.field, message: ex.message });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(f) {
    try {
      await saveFicha({ ...f, menu: { ...f.menu, on: !f.menu?.on } });
    } catch (ex) {
      toast(ex.message, { bad: true });
    }
  }

  const e = (k) => (err?.field === k ? err.message : '');
  return html`<div class="page">
    <${PageHead} title="Cardápio online" sub="Um link para o cliente ver os produtos, escolher e mandar o pedido. O pedido cai na sua agenda e chega no seu WhatsApp." />
    <section class="panel share">
      <p class="label">Seu link</p>
      <p class="share-url"><a href=${url} target="_blank" rel="noopener">${url.replace(/^https?:\/\//, '')}</a></p>
      <div class="chips-row">
        <button type="button" class="btn btn-small" onClick=${async () => ((await copyText(url)) ? toast('Link copiado.') : toast(url, { ms: 9000 }))}>Copiar link</button>
        <a class="btn btn-small" href=${`https://wa.me/?text=${encodeURIComponent(menuShareMessage(a, url))}`} target="_blank" rel="noopener">Mandar no WhatsApp</a>
        <a class="btn btn-small" href=${url} target="_blank" rel="noopener">Abrir cardápio</a>
      </div>
      <p class="small muted">Coloque o link na bio do Instagram e no status do WhatsApp. Para mudar o endereço, vá em <a href="#/conta?aba=negocio">Conta, seu negócio</a>.</p>
      ${!a.settings.whatsapp ? html`<p class="callout callout-warn small">Coloque seu WhatsApp abaixo para os pedidos chegarem até você.</p>` : null}
      ${!m.on ? html`<p class="callout callout-warn small">O cardápio está fechado. Quem abrir o link vê um aviso.</p>` : null}
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>Produtos no cardápio</h2>
        <span class="muted small">${onMenu.length} de ${selling.length}${!pro ? `, até ${max} no grátis` : ''}</span>
      </div>
      ${selling.length
        ? html`<ul class="rows">
            ${selling.map(
              (f, i) => html`<li class="row">
                <label class="check row-main">
                  <input type="checkbox" checked=${Boolean(f.menu?.on)} onChange=${() => toggle(f)} />
                  <span><strong>${f.name}</strong><span class="muted small">${f.sell.price > 0 ? `${brl(f.sell.price)} por ${saleLabel(f)}` : 'sem preço: aparece "a combinar"'}${f.menu?.cat ? ` · ${f.menu.cat}` : ''}${f.menu?.photo ? ' · com foto' : ''}</span>
                  ${!pro && f.menu?.on && onMenu.indexOf(f) >= max ? html`<span class="chip chip-warn">fora do limite do grátis</span>` : null}</span>
                </label>
                <a class="btn btn-small btn-ghost" href=${`#/ficha/${f.id}`}>Editar</a>
              </li>`,
            )}
          </ul>`
        : html`<p class="muted">Você ainda não tem produtos à venda. <a href="#/ficha/nova">Monte o primeiro</a>.</p>`}
      <p class="small muted">Foto, categoria e descrição ficam na ficha de cada produto.</p>
    </section>

    <form class="panel form" onSubmit=${save} novalidate>
      <h2>Como você atende</h2>
      <label class="check"><input type="checkbox" checked=${m.on} onChange=${(ev) => up({ on: ev.currentTarget.checked })} /><span><strong>Cardápio aberto</strong><span class="muted small">Desmarque nas férias ou quando a agenda lotar.</span></span></label>
      <div class="grid-2">
        <${Field} label="WhatsApp para receber pedidos" error=${e('whatsapp')}>
          <input value=${m.whatsapp} inputmode="tel" placeholder="(11) 98765-4321" onInput=${(ev) => up({ whatsapp: ev.currentTarget.value })} />
        </${Field}>
        <${Field} label="Instagram">
          <div class="affix"><span class="pre">@</span><input value=${m.instagram} maxlength="30" onInput=${(ev) => up({ instagram: ev.currentTarget.value })} /></div>
        </${Field}>
        <${Field} label="Cidade ou bairro"><input value=${m.city} maxlength="40" onInput=${(ev) => up({ city: ev.currentTarget.value })} /></${Field}>
        <${Field} label="Antecedência mínima" hint="0 aceita pedido para hoje.">
          <${NumInput} value=${m.leadDays} onValue=${(v) => up({ leadDays: v > 0 ? Math.round(v) : 0 })} suffix="dias" max=${0} placeholder="0" />
        </${Field}>
      </div>
      <div class="field">
        <span class="label">Entrega</span>
        <${Seg} label="Entrega" value=${m.delivery} onChange=${(v) => up({ delivery: v })} options=${[{ v: 'ambos', label: 'Retirada e entrega' }, { v: 'retirada', label: 'Só retirada' }, { v: 'entrega', label: 'Só entrega' }]} />
      </div>
      <div class="grid-2">
        <${Field} label="Sobre a entrega" hint="Ex.: retirada no Cambuí; entrega a combinar.">
          <input value=${m.deliveryNote} maxlength="140" onInput=${(ev) => up({ deliveryNote: ev.currentTarget.value })} />
        </${Field}>
        <${Field} label="Pedido mínimo"><${MoneyInput} value=${m.minOrder} onValue=${(v) => up({ minOrder: v > 0 ? v : 0 })} /></${Field}>
      </div>
      <${Field} label="Recado no topo do cardápio" hint="Ex.: Encomendas de festa com 5 dias de antecedência.">
        <textarea rows="2" maxlength="300" value=${m.note} onInput=${(ev) => up({ note: ev.currentTarget.value })}></textarea>
      </${Field}>
      ${err && !err.field ? html`<p class="error-text">${err.message}</p>` : null}
      <div class="form-actions">
        <button class="btn btn-main" disabled=${busy || !dirty}>${busy ? 'Salvando…' : 'Salvar'}</button>
        ${dirty ? html`<span class="small muted">Mudanças sem salvar</span>` : null}
      </div>
    </form>
  </div>`;
}
