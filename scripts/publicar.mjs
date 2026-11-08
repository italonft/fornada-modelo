// Publica a Fornada na Cloudflare (plano grátis) e configura o Mercado Pago.
// Uso: abra Publicar.bat (Windows), Publicar.command (Mac) ou publicar.sh (Linux). Ele chama este arquivo.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOML = path.join(ROOT, 'wrangler.toml');
export const WRANGLER = process.env.FORNADA_WRANGLER || path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DB_NAME = 'fornada-db';
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

// ---------- conversa no terminal ----------
let muted = false;
let rl = null;
let lines = null;
function io() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    rl._writeToOutput = (s) => {
      if (!muted) rl.output.write(s);
      else if (!/[\r\n]/.test(s)) rl.output.write('*'.repeat(s.length));
    };
    lines = rl[Symbol.asyncIterator]();
  }
  return lines;
}

async function ask(question, def = '') {
  process.stdout.write(`${question}${def ? ` [${def}]` : ''}: `);
  const { value, done } = await io().next();
  if (done) throw new Error('Entrada encerrada.');
  const v = String(value ?? '').trim();
  return v || def;
}

async function askSecret(question) {
  process.stdout.write(`${question}: `);
  muted = Boolean(process.stdin.isTTY);
  const { value, done } = await io().next();
  muted = false;
  if (process.stdin.isTTY) process.stdout.write('\n');
  if (done) throw new Error('Entrada encerrada.');
  return String(value ?? '').trim();
}

async function yes(question, def = true) {
  const a = (await ask(`${question} (s/n)`, def ? 's' : 'n')).toLowerCase();
  return a.startsWith('s') || a === 'y';
}

const say = (s = '') => console.log(s);
const title = (s) => say(`\n=== ${s} ===`);

// ---------- Wrangler ----------
function run(args, { capture = false, interactive = false, env = {} } = {}) {
  if (interactive) rl?.pause();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WRANGLER, ...args], {
      cwd: ROOT,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...env },
      stdio: [interactive ? 'inherit' : 'ignore', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
    });
    let out = '';
    if (capture) {
      child.stdout.on('data', (d) => {
        out += d;
        process.stdout.write(d);
      });
      child.stderr.on('data', (d) => {
        out += d;
        process.stderr.write(d);
      });
    }
    child.on('close', (code) => {
      if (interactive) rl?.resume();
      resolve({ code, out });
    });
    child.on('error', (e) => {
      if (interactive) rl?.resume();
      resolve({ code: 1, out: String(e) });
    });
  });
}

function findNpm() {
  const dir = path.dirname(process.execPath);
  for (const p of [path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]) {
    if (fs.existsSync(p)) return { cmd: process.execPath, args: [p] };
  }
  return { cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [], shell: process.platform === 'win32' };
}

export async function ensureWrangler() {
  if (fs.existsSync(WRANGLER)) return;
  title('Preparando as ferramentas da Cloudflare');
  say('Baixando a ferramenta oficial da Cloudflare (Wrangler). Acontece só uma vez e ocupa cerca de 150 MB.');
  const npm = findNpm();
  const code = await new Promise((resolve) => {
    const c = spawn(npm.cmd, [...npm.args, 'install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', shell: npm.shell });
    c.on('close', resolve);
    c.on('error', () => resolve(1));
  });
  if (code !== 0 || !fs.existsSync(WRANGLER)) throw new Error('Não consegui baixar o Wrangler. Confira a internet e tente de novo.');
}

// ---------- wrangler.toml ----------
/** O wrangler.toml vem com um banco de exemplo (zeros): ainda não foi publicado nesta conta. */
export const isPlaceholder = (id) => id === 'local' || /^0{8}-0{4}-/.test(id);
const readToml = () => fs.readFileSync(TOML, 'utf8');
const writeToml = (s) => fs.writeFileSync(TOML, s);
export function getVar(toml, key) {
  const m = toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return m ? m[1] : '';
}
export function setVar(toml, key, value) {
  const clean = String(value).replace(/["\\\r\n]/g, '');
  const re = new RegExp(`^${key}\\s*=\\s*"[^"]*"`, 'm');
  return re.test(toml) ? toml.replace(re, `${key} = "${clean}"`) : toml.replace(/^\[vars\]\s*$/m, `[vars]\n${key} = "${clean}"`);
}
export function parseDbId(text) {
  const m = String(text).match(/"?(?:database_id|uuid)"?\s*[:=]\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
  return m ? m[1] : '';
}
export function parseUrl(text) {
  const m = String(text).match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/i);
  return m ? m[0] : '';
}
export function parseMoney(s) {
  const t = String(s).trim().replace(/[R$\s]/g, '');
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
const brl = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

// ---------- etapas ----------
async function login() {
  title('1. Entrar na Cloudflare');
  let r = await run(['whoami'], { capture: true });
  if (r.code === 0 && !/not authenticated|not logged in|não autenticado/i.test(r.out)) {
    say('Você já está conectado à Cloudflare.');
    return;
  }
  say('Vai abrir o navegador. Crie uma conta grátis na Cloudflare (ou entre) e clique em "Allow" para autorizar.');
  await run(['login'], { interactive: true });
  r = await run(['whoami'], { capture: true });
  if (r.code !== 0 || /not authenticated/i.test(r.out)) throw new Error('Não consegui confirmar o acesso à Cloudflare. Rode de novo.');
}

async function database() {
  title('2. Banco de dados');
  let toml = readToml();
  let id = (toml.match(/database_id\s*=\s*"([^"]*)"/) || [])[1] || '';
  if (!id || isPlaceholder(id)) {
    const r = await run(['d1', 'create', DB_NAME], { capture: true, interactive: true });
    id = parseDbId(r.out);
    if (!id) {
      const list = await run(['d1', 'list', '--json'], { capture: true });
      try {
        const arr = JSON.parse(list.out.slice(list.out.indexOf('[')));
        id = arr.find((d) => d.name === DB_NAME)?.uuid || '';
      } catch {
        id = '';
      }
    }
    if (!id) throw new Error('Não consegui criar o banco de dados na Cloudflare.');
    toml = toml.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${id}"`);
    writeToml(toml);
    say(`Banco criado: ${id}`);
  } else say('O banco já existe.');
  const m = await run(['d1', 'migrations', 'apply', 'DB', '--remote'], { capture: true, env: { CI: 'true' } });
  if (m.code !== 0) throw new Error('Não consegui preparar as tabelas do banco.');
}

async function business({ first }) {
  title(first ? '3. Seus dados' : 'Dados do negócio');
  let toml = readToml();
  say('Aparecem na política de privacidade e nos termos de uso, para os clientes falarem com você.');
  let email = '';
  while (!EMAIL_RE.test(email)) email = await ask('E-mail de contato para clientes', getVar(toml, 'CONTACT_EMAIL'));
  let name = '';
  while (name.length < 3) name = await ask('Seu nome ou o nome do negócio', getVar(toml, 'OWNER_NAME'));
  const prices = {};
  for (const [key, label, def] of PLANS) {
    let cents = NaN;
    while (!(cents >= 100 && cents <= 1000000)) cents = parseMoney(await ask(`Preço do Pro por ${label}, em reais`, (Number(getVar(toml, key) || def) / 100).toFixed(2).replace('.', ',')));
    prices[key] = cents;
  }
  toml = setVar(toml, 'CONTACT_EMAIL', email);
  toml = setVar(toml, 'OWNER_NAME', name);
  for (const [key] of PLANS) toml = setVar(toml, key, String(prices[key]));
  writeToml(toml);
  say(`Preços: ${PLANS.map(([key, label]) => `${label} ${brl(prices[key])}`).join(', ')}.`);
}

const PLANS = [
  ['PRICE_30', '1 mês', 1990],
  ['PRICE_90', '3 meses', 4990],
  ['PRICE_365', '1 ano', 15990],
];

async function deploy() {
  title('Publicando o site');
  const r = await run(['deploy'], { capture: true, interactive: true });
  const url = parseUrl(r.out);
  if (r.code !== 0 || !url) throw new Error('A publicação falhou. Leia a mensagem acima. Se pedir um subdomínio workers.dev, escolha um nome e rode de novo.');
  return url;
}

async function putSecrets(values) {
  const entries = Object.entries(values).filter(([, v]) => v);
  if (!entries.length) return;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fornada-')), 'segredos.json');
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
  try {
    const r = await run(['secret', 'bulk', file], { capture: true, interactive: true });
    if (r.code !== 0) throw new Error('Não consegui gravar os segredos na Cloudflare.');
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

async function askMpToken() {
  say('No Mercado Pago: entre em mercadopago.com.br/developers, abra "Suas integrações", crie uma aplicação');
  say('(pagamentos online, Checkout Transparente/API) e copie o Access Token de PRODUÇÃO, que começa com APP_USR-.');
  say('Deixe em branco para configurar depois. Sem ele, o site funciona, mas ninguém consegue pagar.');
  for (;;) {
    const t = await askSecret('Access Token de produção do Mercado Pago');
    if (!t || /^(APP_USR|TEST)-[A-Za-z0-9-]{20,}$/.test(t)) return t;
    say('Esse texto não parece um Access Token. Ele começa com APP_USR- e é bem longo.');
  }
}

function strongPassword() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(18), (b) => alpha[b % alpha.length]).join('');
}

async function askOwnerPassword() {
  say('O painel do dono mostra vendas e lucro. Escolha uma senha forte (12 ou mais caracteres) ou deixe em branco para eu gerar uma.');
  for (;;) {
    const p = await askSecret('Senha do painel do dono');
    if (!p) return { password: strongPassword(), generated: true };
    if (p.length >= 12) return { password: p, generated: false };
    say('Use pelo menos 12 caracteres.');
  }
}

function summary(url, extra = []) {
  const lines = [
    `Site: ${url}`,
    `Criar conta: ${url}/comecar`,
    `App (depois de entrar): ${url}/app`,
    `Painel do dono: ${url}/dono`,
    `Endereço do aviso de pagamento (webhook): ${url}/api/mp/webhook`,
    '',
    'Para o Pix liberar na hora, configure o aviso no Mercado Pago:',
    '  1. mercadopago.com.br/developers > Suas integrações > sua aplicação > Webhooks > Configurar notificações.',
    `  2. Em "URL modo produção", cole: ${url}/api/mp/webhook`,
    '  3. Marque o evento "Order (Mercado Pago)" e clique em Salvar.',
    '  4. Copie a "Assinatura secreta" que aparece e rode este programa de novo, opção 3.',
    'Sem isso o pagamento ainda é conferido sozinho a cada poucos segundos com o cliente na tela, e a cada 10 minutos depois.',
    ...extra,
  ];
  title('Pronto');
  for (const l of lines) say(l);
  fs.writeFileSync(path.join(ROOT, 'publicacao.txt'), `${lines.join('\n')}\n\nGerado em ${new Date().toLocaleString('pt-BR')}. Este arquivo não tem senhas.\n`);
  say('\nGuardei esses endereços em publicacao.txt, nesta pasta.');
}

async function firstTime() {
  say('Vou publicar a Fornada na Cloudflare, no plano grátis, e ligar o Pix do Mercado Pago.');
  say('Você vai precisar de: uma conta grátis na Cloudflare e uma conta no Mercado Pago.');
  if (!(await yes('Continuar?'))) return;
  await login();
  await database();
  await business({ first: true });
  title('4. Mercado Pago');
  const token = await askMpToken();
  title('5. Senha do dono');
  const { password, generated } = await askOwnerPassword();
  const url = await deploy();
  await putSecrets({ MP_ACCESS_TOKEN: token, ADMIN_PASSWORD: password, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), PASSWORD_PEPPER: crypto.randomBytes(32).toString('hex') });
  const extra = [];
  if (generated) {
    say(`\nSENHA DO PAINEL DO DONO (anote agora, ela não fica salva em lugar nenhum): ${password}`);
  }
  if (!token) extra.push('', 'Atenção: o Pix ainda não está ligado. Rode este programa de novo e escolha a opção 2.');
  extra.push('', 'Teste antes de divulgar: crie a sua conta no site. No painel do dono, crie um cupom de 90%. No app, em Conta > Plano, pague o Pro de 1 mês com esse cupom e confira se liberou. Depois peça o reembolso ali mesmo.');
  summary(url, extra);
}

async function menu() {
  const toml = readToml();
  say(`Fornada já publicada. Preços do Pro: ${PLANS.map(([key, label, def]) => `${label} ${brl(Number(getVar(toml, key) || def))}`).join(', ')}.`);
  say('1. Publicar de novo (depois de mudar algum arquivo)');
  say('2. Trocar o Access Token do Mercado Pago');
  say('3. Gravar a assinatura secreta do aviso do Mercado Pago');
  say('4. Trocar a senha do painel do dono');
  say('5. Mudar preços do Pro, e-mail de contato ou nome');
  say('0. Sair');
  const op = await ask('Escolha', '1');
  if (op === '0') return;
  await login();
  if (op === '1') return summary(await deploy());
  if (op === '2') {
    const token = await askMpToken();
    if (!token) return say('Nada foi gravado.');
    await putSecrets({ MP_ACCESS_TOKEN: token });
    return say('Access Token gravado.');
  }
  if (op === '3') {
    say('Cole a "Assinatura secreta" que aparece em Webhooks > Configurar notificações, no Mercado Pago.');
    const s = await askSecret('Assinatura secreta');
    if (s.length < 16) return say('Assinatura curta demais. Nada foi gravado.');
    await putSecrets({ MP_WEBHOOK_SECRET: s });
    return say('Assinatura gravada. Os avisos de pagamento agora são conferidos.');
  }
  if (op === '4') {
    const { password, generated } = await askOwnerPassword();
    await putSecrets({ ADMIN_PASSWORD: password, SESSION_SECRET: crypto.randomBytes(32).toString('hex') });
    return say(generated ? `Nova senha (anote agora): ${password}` : 'Senha trocada.');
  }
  if (op === '5') {
    await business({ first: false });
    return summary(await deploy());
  }
  say('Opção inválida.');
}

async function main() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 20) throw new Error('É preciso o Node.js 20 ou mais novo.');
  await ensureWrangler();
  const id = (readToml().match(/database_id\s*=\s*"([^"]*)"/) || [])[1];
  if (!id || isPlaceholder(id)) await firstTime();
  else await menu();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .catch((e) => {
      console.error(`\nErro: ${e.message}`);
      process.exitCode = 1;
    })
    .finally(() => rl?.close());
}
