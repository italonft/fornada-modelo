// Gera os ícones PNG e a imagem de compartilhamento (og.png) a partir do SVG e de um HTML com as fontes do app.
// Uso (precisa do Playwright): node scripts/dev/gerar-imagens.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const PUB = path.join(ROOT, 'public');
const svg = fs.readFileSync(path.join(PUB, 'img/icone.svg'), 'utf8');
const font = (f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(PUB, 'fonts', f)).toString('base64')})`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(PUB, `img/icone-${size}.png`), omitBackground: true });
}
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<html><head><style>
@font-face{font-family:A;src:${font('archivo.woff2')};font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:D;src:${font('dseg7.woff2')};font-weight:700}
body{margin:0;width:1200px;height:630px;background:#2a1a14;color:#fbf3ee;font-family:A;display:grid;grid-template-columns:1fr 430px;align-items:center;gap:56px;padding:0 72px;box-sizing:border-box}
h1{font-size:84px;line-height:.96;font-weight:900;font-stretch:125%;letter-spacing:-.025em;margin:0 0 28px}
p{font-size:30px;margin:0;color:#e6d8d0;font-stretch:105%}
.brand{display:flex;align-items:center;gap:16px;font-size:34px;font-weight:900;font-stretch:122%;margin-bottom:36px}
.brand svg{width:56px;height:56px}
.lcd{background:linear-gradient(#b8c6a2,#a9b991);border-radius:18px;padding:26px 30px;color:#1d2816;box-shadow:inset 0 3px 8px rgba(0,0,0,.25)}
.lab{font-size:24px;font-weight:700;font-stretch:85%;opacity:.8}
.dig{display:flex;justify-content:flex-end;align-items:baseline;gap:14px;font-family:D;font-weight:700;font-size:118px;line-height:1;margin-top:8px}
.dig small{font-family:A;font-size:34px;font-weight:800}
.val{position:relative}.ghost{position:absolute;right:0;color:rgba(29,40,22,.1)}
.row{display:flex;justify-content:space-between;font-size:26px;margin-top:18px;color:#e6d8d0}.row b{color:#ffc21a}
</style></head><body>
<div><div class="brand">${svg.replace('<svg ', '<svg width="56" height="56" ')}Fornada</div><h1>Quanto sobra de cada venda?</h1><p>Custo de verdade, preço certo no Pix, na maquininha e no iFood, encomendas e cardápio online.</p></div>
<div><div class="lcd"><div class="lab">Preço sugerido</div><div class="dig"><small>R$</small><span class="val"><span class="ghost">8.88</span><span>1.10</span></span></div></div>
<div class="row"><span>No iFood</span><b>R$ 1,60</b></div><div class="row"><span>Sobra no Pix</span><b>R$ 0,27</b></div></div>
</body></html>`);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(PUB, 'img/og.png') });
await browser.close();
console.log('Imagens geradas em public/img.');
