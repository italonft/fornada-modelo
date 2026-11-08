// Ponto de entrada na Cloudflare. Os arquivos de public/ são servidos direto; o resto passa por aqui.
import { handleApi } from './api.js';
import { config } from './config.js';
import { scheduled } from './cron.js';
import { menuPage, orderPage, photo } from './menu.js';
import { notFound } from './pages.js';
import { securityHeaders } from './util.js';

/** Página inicial: o HTML é estático, mas as prévias do WhatsApp e do Facebook pedem endereço completo da imagem. */
async function home(req, env, url) {
  const res = await env.ASSETS.fetch(new Request(new URL('/inicio', url), { method: req.method, headers: req.headers }));
  if (!res.ok) return res;
  const out = new HTMLRewriter()
    .on('meta[property="og:image"]', { element: (e) => e.setAttribute('content', `${url.origin}/img/og.png`) })
    .on('meta[property="og:url"]', { element: (e) => e.setAttribute('content', `${url.origin}/`) })
    .on('link[rel="canonical"]', { element: (e) => e.setAttribute('href', `${url.origin}/`) })
    .transform(res);
  const h = securityHeaders(new Headers(out.headers));
  h.set('cache-control', 'public, max-age=300');
  return new Response(out.body, { status: out.status, headers: h });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p.startsWith('/api/')) return handleApi(req, env, ctx, url);
    const read = req.method === 'GET' || req.method === 'HEAD';
    if (p === '/' && read) return home(req, env, url);
    let m = p.match(/^\/c\/([a-z0-9-]{3,40})\/?$/);
    if (m && read) return menuPage(req, env, ctx, config(env), url, m[1]);
    m = p.match(/^\/p\/([A-Za-z0-9_-]{20,40})\/?$/);
    if (m && read) return orderPage(req, env, config(env), url, m[1]);
    m = p.match(/^\/f\/([a-z0-9]{16})$/);
    if (m && read) return photo(env, m[1]);
    return notFound(config(env), 'Esta página não existe.');
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduled(event, env, ctx));
  },
};
