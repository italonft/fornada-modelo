// O script de publicação, de ponta a ponta, com um Wrangler de mentira (sem internet).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fornada-pub-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts/publicar.mjs'), path.join(dir, 'scripts/publicar.mjs'));
  fs.copyFileSync(path.join(ROOT, 'wrangler.toml'), path.join(dir, 'wrangler.toml'));
  return dir;
}

function runScript(dir, answers) {
  const log = path.join(dir, 'chamadas.log');
  fs.rmSync(log, { force: true });
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts/publicar.mjs')], {
    input: `${answers.join('\n')}\n`,
    encoding: 'utf8',
    env: { ...process.env, FORNADA_WRANGLER: path.join(ROOT, 'test/ajuda/fake-wrangler.mjs'), FAKE_WRANGLER_LOG: log },
    timeout: 30000,
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  return { ...r, calls };
}

test('primeira publicação: banco, dados, preços, Pix, senha, site e segredos', () => {
  const dir = sandbox();
  const token = `APP_USR-${'1'.repeat(16)}-110611-${'a'.repeat(32)}-123456789`;
  const r = runScript(dir, ['s', 'email-errado', 'contato@minhaloja.com', 'Ana Souza', '24,90', '', '0,50', '149', token, '']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const toml = fs.readFileSync(path.join(dir, 'wrangler.toml'), 'utf8');
  assert.match(toml, /database_id = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"/);
  assert.match(toml, /CONTACT_EMAIL = "contato@minhaloja.com"/);
  assert.match(toml, /OWNER_NAME = "Ana Souza"/);
  assert.match(toml, /PRICE_30 = "2490"/);
  assert.match(toml, /PRICE_90 = "4990"/, 'Enter mantém o preço de 3 meses');
  assert.match(toml, /PRICE_365 = "14900"/, 'R$ 0,50 é recusado e pergunta de novo');
  const names = r.calls.map((c) => c.args.slice(0, 2).join(' '));
  assert.deepEqual(names, ['whoami', 'd1 create', 'd1 migrations', 'deploy', 'secret bulk']);
  assert.ok(r.calls[2].args.includes('--remote'));
  const secrets = r.calls.at(-1);
  assert.deepEqual(secrets.secretKeys, ['ADMIN_PASSWORD', 'MP_ACCESS_TOKEN', 'PASSWORD_PEPPER', 'SESSION_SECRET']);
  assert.match(secrets.secretValues.PASSWORD_PEPPER, /^[0-9a-f]{64}$/);
  assert.equal(secrets.secretValues.MP_ACCESS_TOKEN, token);
  assert.ok(secrets.secretValues.ADMIN_PASSWORD.length >= 16);
  assert.ok(r.stdout.includes(secrets.secretValues.ADMIN_PASSWORD), 'senha gerada aparece uma vez na tela');
  assert.ok(!r.stdout.includes(token), 'o token não aparece na tela');
  const pub = fs.readFileSync(path.join(dir, 'publicacao.txt'), 'utf8');
  assert.match(pub, /https:\/\/fornada\.fulano\.workers\.dev\/api\/mp\/webhook/);
  assert.match(pub, /\/comecar/);
  assert.ok(!pub.includes(secrets.secretValues.ADMIN_PASSWORD) && !pub.includes(token), 'nenhum segredo no arquivo');
  const left = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('fornada-') && fs.existsSync(path.join(os.tmpdir(), f, 'segredos.json')));
  assert.equal(left.length, 0, 'arquivo temporário de segredos apagado');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('menu depois de publicado: grava a assinatura do aviso e recusa token inválido', () => {
  const dir = sandbox();
  const tomlPath = path.join(dir, 'wrangler.toml');
  fs.writeFileSync(tomlPath, fs.readFileSync(tomlPath, 'utf8').replace('database_id = "00000000-0000-4000-8000-000000000000"', 'database_id = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"'));
  const a = runScript(dir, ['3', 'f1e2d3c4b5a69788a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2']);
  assert.equal(a.status, 0, a.stderr);
  assert.deepEqual(a.calls.at(-1).secretKeys, ['MP_WEBHOOK_SECRET']);
  const c = runScript(dir, ['4', '']);
  assert.equal(c.status, 0, c.stderr);
  assert.deepEqual(c.calls.at(-1).secretKeys, ['ADMIN_PASSWORD', 'SESSION_SECRET'], 'trocar a senha do dono nunca mexe no tempero das senhas');
  const b = runScript(dir, ['2', 'nao-e-token', '']);
  assert.equal(b.status, 0, b.stderr + b.stdout);
  assert.match(b.stdout, /não parece um Access Token/);
  assert.equal(b.calls.filter((c) => c.args[0] === 'secret').length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
