// Acesso ao banco D1: contadores, limites de abuso e dados de cada conta.
import { dayOf } from './util.js';

export async function bump(env, name, ref = '', now = Date.now(), n = 1) {
  await env.DB.prepare(
    'INSERT INTO events (day, name, ref, count) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(day, name, ref) DO UPDATE SET count = count + ?4',
  )
    .bind(dayOf(now), name, ref, n)
    .run();
}

/** Conta uma tentativa e diz se ainda está dentro do limite da janela. */
export async function allow(env, key, limit, windowMs, now = Date.now()) {
  const row = await env.DB.prepare(
    `INSERT INTO ratelimit (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start < ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start < ?3 THEN ?2 ELSE window_start END
     RETURNING count`,
  )
    .bind(key, now, now - windowMs)
    .first();
  return (row?.count ?? 1) <= limit;
}

export async function setMeta(env, key, value) {
  await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2').bind(key, String(value)).run();
}

export async function getMeta(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM meta').all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

export function parseJson(s, def = {}) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : def;
  } catch {
    return def;
  }
}

/** Ingredientes, receitas e configurações de uma conta, prontos para as contas. */
export async function loadWorkspace(env, account) {
  const [items, fichas] = await env.DB.batch([
    env.DB.prepare('SELECT id, data, updated_at FROM items WHERE account_id = ?1').bind(account.id),
    env.DB.prepare('SELECT id, data, created_at, updated_at FROM fichas WHERE account_id = ?1').bind(account.id),
  ]);
  return {
    items: items.results.map((r) => ({ ...parseJson(r.data), id: r.id, updatedAt: r.updated_at })),
    fichas: fichas.results.map((r) => ({ ...parseJson(r.data), id: r.id, createdAt: r.created_at, updatedAt: r.updated_at })),
    settings: parseJson(account.settings),
  };
}

export function orderRow(r) {
  return { ...parseJson(r.data), id: r.id, num: r.num, token: r.token, status: r.status, dueDate: r.due_date, origin: r.origin, seen: Boolean(r.seen), createdAt: r.created_at, updatedAt: r.updated_at };
}

/** Insere várias linhas num comando só, respeitando o limite de 100 valores por comando do D1. */
export function multiInsert(env, sqlHead, cols, rows) {
  const per = Math.max(1, Math.floor(96 / cols));
  const stmts = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const values = chunk.map((_, r) => `(${Array.from({ length: cols }, (_, c) => `?${r * cols + c + 1}`).join(', ')})`).join(', ');
    stmts.push(env.DB.prepare(`${sqlHead} VALUES ${values}`).bind(...chunk.flat()));
  }
  return stmts;
}
