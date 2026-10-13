// Outil de mise au point : captures d'écran du jeu dans Chromium, à différents endroits de la ville.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './server.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? '/tmp';
const which = (process.argv[3] ?? 'menu,spawn').split(',');
const vp = process.argv[4] === 'mobile' ? { width: 844, height: 390 } : { width: 1280, height: 720 };
const { server, url } = await serve(path.join(here, '..', 'dist'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: process.argv[4] === 'mobile' ? 3 : 1, hasTouch: process.argv[4] === 'mobile', isMobile: process.argv[4] === 'mobile' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/sw\.js|404/.test(m.text())) errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.__klaxo && window.__klaxo.scene, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const snap = async (name) => { await page.screenshot({ path: path.join(out, name + '.png') }); console.log('saved', name); };
if (which.includes('menu')) await snap('menu');
const start = async () => {
  await page.evaluate(() => { const g = window.__klaxo; g.settings.shownStorageNotice = true; g.newGame({ ...g.world.player.look }, 'Testeur'); });
  await page.waitForTimeout(1200);
};
const goto = async (poi, dx = 0, dy = 0, wait = 2500) => {
  await page.evaluate(([poi, dx, dy]) => { const w = window.__klaxo.world; const p = w.map.poiPx(poi); w.player.x = p.x + dx; w.player.y = p.y + dy; }, [poi, dx, dy]);
  await page.waitForTimeout(wait);
};
if (which.some((w) => w !== 'menu')) await start();
for (const w of which) {
  if (w === 'menu') continue;
  if (w === 'spawn') { await page.waitForTimeout(2500); await snap('spawn'); continue; }
  const [poi, dx, dy] = w.split(':');
  await goto(poi, Number(dx ?? 0), Number(dy ?? 0));
  await snap(poi);
}
const stats = await page.evaluate(() => ({ ...window.__klaxo.scene.stats, q: window.__klaxo.quality, size: [window.__klaxo.phaser.scale.width, window.__klaxo.phaser.scale.height] }));
console.log('stats', JSON.stringify(stats), 'errors', errors);
await browser.close(); server.close();
