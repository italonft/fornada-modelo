// Páginas montadas no servidor: cardápio público, pedido do cliente e "página não encontrada".
import { html } from './util.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

/** JSON dentro de <script type="application/json">, sem como fechar a tag por dentro. */
export function safeJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function layout({ title, description = '', css = [], js = [], body, og = {}, noindex = false, bodyClass = '' }) {
  const metas = [
    `<meta property="og:title" content="${esc(og.title || title)}">`,
    description ? `<meta name="description" content="${esc(description)}"><meta property="og:description" content="${esc(description)}">` : '',
    og.image ? `<meta property="og:image" content="${esc(og.image)}">` : '',
    og.url ? `<meta property="og:url" content="${esc(og.url)}">` : '',
    noindex ? '<meta name="robots" content="noindex">' : '',
  ].join('');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
${metas}
<meta name="theme-color" content="#2a1a14">
<link rel="icon" href="/img/icone.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/base.css">
${css.map((h) => `<link rel="stylesheet" href="${esc(h)}">`).join('\n')}
</head>
<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>
${body}
${js.map((s) => `<script type="module" src="${esc(s)}"></script>`).join('\n')}
</body>
</html>`;
}

export function notFound(c, message = 'Esta página não existe.', status = 404) {
  const body = `<main class="lost">
  <a class="lost-brand" href="/">${esc(c.brand)}</a>
  <h1>${esc(message)}</h1>
  <p>Confira o link que você recebeu. Se ele veio de uma loja, peça para ela mandar de novo.</p>
  <p><a class="btn btn-main" href="/">Ir para a página inicial</a></p>
</main>`;
  return html(layout({ title: `Não encontrado · ${c.brand}`, body, noindex: true }), status);
}
