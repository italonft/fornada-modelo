// Roda a Fornada no seu computador, sem publicar e sem conta nenhuma, para você ver como funciona.
// O Pix fica desligado aqui; para testar o Pro, crie um cupom de 100% no painel do dono.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { ensureWrangler, ROOT, WRANGLER } from './publicar.mjs';

const PORT = 8787;
const URL_BASE = `http://localhost:${PORT}`;
const STATE = path.join(ROOT, '.wrangler', 'teste-local');
const PASSWORD = 'teste-local-123';

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const c = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true });
    c.on('error', () => {});
    c.unref();
  } catch {
    /* sem navegador: o endereço aparece na tela */
  }
}

await ensureWrangler();
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };
const mig = spawnSync(process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', STATE], { cwd: ROOT, env, stdio: 'inherit' });
if (mig.status !== 0) {
  console.error('Não consegui preparar o banco local.');
  process.exit(1);
}
const args = [WRANGLER, 'dev', '--port', String(PORT), '--persist-to', STATE, '--var', `ADMIN_PASSWORD:${PASSWORD}`, '--var', `SESSION_SECRET:${crypto.randomBytes(16).toString('hex')}`, '--var', 'PASSWORD_PEPPER:tempero-do-teste-local'];
const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...env, CI: '' }, stdio: 'inherit' });
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const r = await fetch(`${URL_BASE}/api/config`);
    if (r.ok) break;
  } catch {
    /* ainda subindo */
  }
}
console.log('\n================================================================');
console.log(`Fornada rodando no seu computador: ${URL_BASE}`);
console.log(`Painel do dono: ${URL_BASE}/dono  (senha do teste: ${PASSWORD})`);
console.log('Crie uma conta em Criar conta. O Pix fica desligado no teste: para ver o Pro, crie um cupom de 100% no painel do dono.');
console.log('Para fechar, aperte Ctrl+C ou feche esta janela.');
console.log('================================================================\n');
openBrowser(URL_BASE);
child.on('close', (code) => process.exit(code ?? 0));
