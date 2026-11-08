// Segredos do servidor. Na publicação pelo computador, o script coloca SESSION_SECRET e PASSWORD_PEPPER na
// Cloudflare. Na publicação pelo celular (botão "Deploy to Cloudflare"), eles não existem: o próprio app cria
// valores aleatórios na primeira vez e guarda no banco.
// O tempero das senhas nunca pode mudar depois que a primeira conta existe. Por isso a origem dele fica anotada:
// se nasceu no banco, o banco vale para sempre; se veio da Cloudflare, ela precisa continuar igual.
import { randomToken, sha256Hex } from './security.js';
import { HttpError } from './util.js';

let cache = null;

export function resetSecretsCache() {
  cache = null;
}

async function readMeta(env, keys) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM meta WHERE key IN (${keys.map((_, i) => `?${i + 1}`).join(', ')})`)
    .bind(...keys)
    .all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

/** Grava só se ainda não existe e devolve o valor que ficou (o de quem chegou primeiro). */
async function claim(env, key, value) {
  await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO NOTHING').bind(key, value).run();
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?1').bind(key).first();
  return row?.value ?? value;
}

/** Devolve { session, pepper, pepperOrigin } prontos para uso. Guarda em memória enquanto o servidor estiver de pé. */
export async function serverSecrets(env, c) {
  if (cache && cache.envSession === c.sessionSecret && cache.envPepper === c.pepper) return cache;
  const m = await readMeta(env, ['segredo_sessao', 'tempero', 'tempero_origem', 'tempero_marca']);
  const session = c.sessionSecret || m.segredo_sessao || (await claim(env, 'segredo_sessao', randomToken(32)));

  let origin = m.tempero_origem;
  if (!origin) origin = await claim(env, 'tempero_origem', c.pepper ? 'env' : 'banco');
  let pepper;
  if (origin === 'banco') {
    pepper = m.tempero || (await claim(env, 'tempero', randomToken(32)));
  } else {
    if (!c.pepper) throw new HttpError(503, 'O servidor está sem o segredo PASSWORD_PEPPER. Avise o dono do site.');
    const mark = (await sha256Hex(`marca:${c.pepper}`)).slice(0, 16);
    const saved = m.tempero_marca || (await claim(env, 'tempero_marca', mark));
    if (saved !== mark) throw new HttpError(503, 'O segredo PASSWORD_PEPPER foi trocado e as senhas pararam de valer. O dono do site precisa colocar o valor antigo de volta.');
    pepper = c.pepper;
  }
  cache = { envSession: c.sessionSecret, envPepper: c.pepper, session, pepper, pepperOrigin: origin };
  return cache;
}
