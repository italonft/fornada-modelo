// Rotina automática a cada 10 minutos: confere Pix pendentes e, uma vez por dia, faz a limpeza.
import { config } from './config.js';
import { refreshPayment } from './payments.js';
import { getMeta, setMeta } from './store.js';

const DAY = 86400000;

export async function checkPending(env, c, now = Date.now(), { fetchImpl } = {}) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM payments WHERE status = 'pending' AND mp_order_id IS NOT NULL AND created_at > ?1 AND last_check_at < ?2 ORDER BY created_at DESC LIMIT 25",
  )
    .bind(now - 3 * DAY, now - 4 * 60000)
    .all();
  let changed = 0;
  for (const pay of results) {
    const st = await refreshPayment(env, c, pay, { now, minGapMs: 0, fetchImpl });
    if (st !== 'pending') changed++;
  }
  await env.DB.prepare("UPDATE payments SET status = 'canceled', updated_at = ?1 WHERE status IN ('pending', 'creating') AND created_at < ?2").bind(now, now - 3 * DAY).run();
  return { checked: results.length, changed };
}

/** Sessões e links vencidos, contadores de abuso antigos e códigos Pix que não servem mais. */
export async function cleanup(env, c, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now),
    env.DB.prepare('DELETE FROM resets WHERE expires_at < ?1').bind(now),
    env.DB.prepare('DELETE FROM ratelimit WHERE window_start < ?1').bind(now - DAY),
    env.DB.prepare("UPDATE payments SET qr_code = NULL, qr_base64 = NULL WHERE status <> 'pending' AND qr_base64 IS NOT NULL AND updated_at < ?1").bind(now - DAY),
  ]);
  return { ok: true };
}

export async function scheduled(event, env, ctx, { now = Date.now(), fetchImpl } = {}) {
  const c = config(env);
  const out = { pending: await checkPending(env, c, now, { fetchImpl }) };
  const meta = await getMeta(env);
  if (!meta.limpeza_em || now - Number(meta.limpeza_em) > DAY - 15 * 60000) {
    out.cleanup = await cleanup(env, c, now);
    await setMeta(env, 'limpeza_em', now);
  }
  await setMeta(env, 'rotina_em', now);
  return out;
}
