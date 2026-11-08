// Wrangler de mentira para testar o script de publicação sem internet. Registra cada chamada num arquivo.
import fs from 'node:fs';
const log = process.env.FAKE_WRANGLER_LOG;
const args = process.argv.slice(2);
const entry = { args };
if (args[0] === 'secret' && args[1] === 'bulk') entry.secretKeys = Object.keys(JSON.parse(fs.readFileSync(args[2], 'utf8'))).sort();
if (args[0] === 'secret' && args[1] === 'bulk') entry.secretValues = JSON.parse(fs.readFileSync(args[2], 'utf8'));
fs.appendFileSync(log, `${JSON.stringify(entry)}\n`);
const cmd = args.slice(0, 2).join(' ');
if (args[0] === 'whoami') console.log('You are logged in with an OAuth Token, associated with the email teste@exemplo.com.');
else if (cmd === 'd1 create') console.log('✅ Successfully created DB \'fornada-db\'\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "fornada-db"\ndatabase_id = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"');
else if (cmd === 'd1 migrations') console.log('🚣 17 commands executed successfully.');
else if (args[0] === 'deploy') console.log('Uploaded fornada (3.21 sec)\nDeployed fornada triggers (1.02 sec)\n  https://fornada.fulano.workers.dev\n  schedule: */10 * * * *');
else if (cmd === 'secret bulk') console.log('✨ Finished processing secrets file');
else console.log('ok');
