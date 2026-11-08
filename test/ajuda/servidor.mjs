// Sobe o app com o Wrangler (Cloudflare local, banco D1 de verdade em SQLite) apontando para o Mercado Pago de mentira.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const WRANGLER = path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js');

export const SECRETS = { MP_ACCESS_TOKEN: 'TEST-TOKEN', MP_WEBHOOK_SECRET: 'segredo-do-aviso', ADMIN_PASSWORD: 'senha-do-dono', SESSION_SECRET: 'sessao-teste', PASSWORD_PEPPER: 'tempero-teste', CONTACT_EMAIL: 'contato@exemplo.com', OWNER_NAME: 'Fulano de Tal' };

function env() {
  const no = [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
  return { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_PROXY: no, no_proxy: no, CI: '1', FORCE_COLOR: '0' };
}

export function d1(dir, sql) {
  return execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'DB', '--local', '--persist-to', dir, '--json', '--command', sql], { cwd: ROOT, env: env(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function startApp({ mpUrl, port = 8700 + Math.floor(Math.random() * 200), vars = {}, omit = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fornada-'));
  execFileSync(process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', dir], { cwd: ROOT, env: env(), stdio: 'ignore' });
  const all = { ...SECRETS, MP_API_BASE: mpUrl, ...vars };
  for (const k of omit) delete all[k];
  const args = [WRANGLER, 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', dir, '--test-scheduled', '--show-interactive-dev-session=false', '--log-level', 'warn'];
  for (const [k, v] of Object.entries(all)) args.push('--var', `${k}:${v}`);
  const child = spawn(process.execPath, args, { cwd: ROOT, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(`${base}/api/config`);
      if (r.ok) break;
    } catch {
      /* ainda subindo */
    }
    if (child.exitCode !== null) throw new Error(`wrangler saiu: ${log.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 250));
    if (i === 239) throw new Error(`wrangler não respondeu: ${log.slice(-2000)}`);
  }
  return {
    base,
    dir,
    log: () => log,
    sql: (q) => d1(dir, q),
    async stop() {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (child.exitCode === null) child.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
