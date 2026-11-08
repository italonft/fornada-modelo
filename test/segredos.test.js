// Publicação pelo celular: sem SESSION_SECRET e PASSWORD_PEPPER na Cloudflare, o app cria e guarda os seus.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { resetSecretsCache, serverSecrets } from '../src/secrets.js';
import { startFakeMp } from './ajuda/fake-mp.mjs';
import { SECRETS, startApp } from './ajuda/servidor.mjs';

/** Um D1 de mentira só com a tabela meta, suficiente para os segredos. */
function fakeDb() {
  const meta = new Map();
  return {
    meta,
    DB: {
      prepare(sql) {
        let args = [];
        const api = {
          bind: (...a) => ((args = a), api),
          async all() {
            return { results: args.filter((k) => meta.has(k)).map((k) => ({ key: k, value: meta.get(k) })) };
          },
          async run() {
            if (/^INSERT INTO meta/.test(sql) && !meta.has(args[0])) meta.set(args[0], args[1]);
            return { meta: { changes: 1 } };
          },
          async first() {
            return meta.has(args[0]) ? { value: meta.get(args[0]) } : null;
          },
        };
        return api;
      },
    },
  };
}

test('sem segredos na Cloudflare: cria, guarda e mantém os mesmos valores', async () => {
  resetSecretsCache();
  const env = fakeDb();
  const a = await serverSecrets(env, { sessionSecret: '', pepper: '' });
  assert.equal(a.pepperOrigin, 'banco');
  assert.ok(a.session.length >= 40 && a.pepper.length >= 40);
  resetSecretsCache();
  const b = await serverSecrets(env, { sessionSecret: '', pepper: '' });
  assert.equal(b.session, a.session);
  assert.equal(b.pepper, a.pepper);
  resetSecretsCache();
  const c = await serverSecrets(env, { sessionSecret: '', pepper: 'colocado-depois' });
  assert.equal(c.pepper, a.pepper, 'um PASSWORD_PEPPER criado depois é ignorado: as senhas continuam valendo');
});

test('com PASSWORD_PEPPER da Cloudflare: usa ele e recusa se sumir ou mudar', async () => {
  resetSecretsCache();
  const env = fakeDb();
  const a = await serverSecrets(env, { sessionSecret: 'sessao', pepper: 'tempero-1' });
  assert.equal(a.pepperOrigin, 'env');
  assert.equal(a.pepper, 'tempero-1');
  assert.equal(a.session, 'sessao');
  resetSecretsCache();
  await assert.rejects(() => serverSecrets(env, { sessionSecret: 'sessao', pepper: '' }), /sem o segredo PASSWORD_PEPPER/);
  resetSecretsCache();
  await assert.rejects(() => serverSecrets(env, { sessionSecret: 'sessao', pepper: 'tempero-2' }), /foi trocado/);
  resetSecretsCache();
  assert.equal((await serverSecrets(env, { sessionSecret: 'sessao', pepper: 'tempero-1' })).pepper, 'tempero-1');
});

let mp;
let app;
before(async () => {
  mp = await startFakeMp();
  app = await startApp({ mpUrl: mp.url, omit: ['SESSION_SECRET', 'PASSWORD_PEPPER'] });
});
after(async () => {
  await app?.stop();
  await mp?.close();
});

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(app.base + path, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.9.0.${Math.floor(Math.random() * 250) + 1}`, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json(), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

test('app publicado sem os dois segredos: contas, recuperação e painel do dono funcionam', async () => {
  const email = `celular${Date.now()}@exemplo.com`;
  const s = await call('/api/conta/criar', { method: 'POST', body: { business: 'Doces do Celular', email, password: 'senha-forte-1' } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal((await call('/api/conta/entrar', { method: 'POST', body: { email, password: 'senha-forte-1' } })).status, 200);
  assert.equal((await call('/api/conta/entrar', { method: 'POST', body: { email, password: 'errada-123' } })).status, 401);
  const r = await call('/api/conta/recuperar', { method: 'POST', body: { email, code: s.data.recoveryCode, password: 'nova-senha-123' } });
  assert.equal(r.status, 200);
  assert.equal((await call('/api/conta/entrar', { method: 'POST', body: { email, password: 'nova-senha-123' } })).status, 200);
  const meta = JSON.parse(app.sql("SELECT key, value FROM meta WHERE key IN ('tempero_origem', 'segredo_sessao')"))[0].results;
  assert.equal(meta.find((x) => x.key === 'tempero_origem').value, 'banco');
  assert.ok(meta.find((x) => x.key === 'segredo_sessao').value.length >= 40);
  const login = await call('/api/owner/login', { method: 'POST', body: { password: SECRETS.ADMIN_PASSWORD } });
  assert.equal(login.status, 200);
  const sum = await call('/api/owner/summary', { cookie: login.cookie });
  assert.equal(sum.status, 200);
  assert.equal(sum.data.status.pepperOrigin, 'banco');
});
