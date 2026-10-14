// Image d'aperçu des liens partagés (Open Graph, 1200×630) et visuels carrés pour les réseaux sociaux.
// Fabriquées à partir du vrai jeu compilé : npm run build && node tools/make-og.mjs
// Sorties : public/og.png (servie avec le jeu) et marketing/ (visuels du kit de lancement).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../e2e/server.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'marketing');
fs.mkdirSync(out, { recursive: true });
const exe = process.env.KLAXO_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const { server, url } = await serve(path.join(root, 'dist'));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function cityPage(w, h, query = '') {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await page.goto(url + query);
  await page.waitForFunction(() => window.__klaxo && window.__klaxo.scene, null, { timeout: 45000 });
  await page.evaluate(() => { const g = window.__klaxo; g.settings.quality = 'high'; g.applySettings(); });
  return page;
}
/** Compose une image dans la page : la ville en fond, puis un dessin par-dessus. */
async function compose(page, W, H, draw, zoom = 1) {
  const data = await page.evaluate(async ({ W, H, draw, zoom }) => {
    const g = window.__klaxo;
    const img = await g.snapshot();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    if (img) { const k = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom; ctx.drawImage(img, (W - img.naturalWidth * k) / 2, (H - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k); }
    new Function('ctx', 'W', 'H', 'art', draw)(ctx, W, H, g.art);
    return c.toDataURL('image/png');
  }, { W, H, draw, zoom });
  return Buffer.from(data.split(',')[1], 'base64');
}
const DISPLAY = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const BODY = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

// ---------- Aperçu des liens (1200×630) ----------
{
  const page = await cityPage(1200, 630);
  // On masque l'interface : seule la ville du menu (qui flâne dans le centre-ville) est photographiée.
  await page.addStyleTag({ content: '#ui { visibility: hidden !important; }' });
  await page.evaluate(() => { const w = window.__klaxo.world; w.time = 38; });
  await page.waitForTimeout(2500);
  const png = await compose(page, 1200, 630, `
    const g = ctx.createLinearGradient(0, 0, W * 0.72, 0);
    g.addColorStop(0, 'rgba(11,10,22,0.94)'); g.addColorStop(0.6, 'rgba(11,10,22,0.78)'); g.addColorStop(1, 'rgba(11,10,22,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    art.drawLogo(ctx, 64, 86, 15);
    ctx.font = '700 25px ${DISPLAY}'; ctx.fillStyle = '#22e0ff'; ctx.fillText('LA VILLE QUI KLAXONNE L’ACTUALITÉ', 68, 236);
    ctx.font = '600 34px ${BODY}'; ctx.fillStyle = '#f2f0ff';
    ['Courses-poursuites, zombies et missions', 'entre amis. Une mission inspirée de', 'l’actualité chaque semaine.'].forEach((l, i) => ctx.fillText(l, 68, 312 + i * 46));
    const tag = 'GRATUIT · DANS LE NAVIGATEUR · EN LIGNE';
    ctx.font = '800 24px ${DISPLAY}'; const tw = ctx.measureText(tag).width;
    ctx.fillStyle = '#ff2e88'; ctx.fillRect(64, 488, tw + 40, 54); ctx.fillStyle = '#0b0a16'; ctx.fillText(tag, 84, 523);`);
  fs.writeFileSync(path.join(out, 'apercu-lien-1200x630.png'), png);
  // Version JPEG légère pour l'aperçu des liens (chargée par WhatsApp, Facebook, X…).
  const jpg = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.86);
  }, png.toString('base64'));
  const jbuf = Buffer.from(jpg.split(',')[1], 'base64');
  fs.writeFileSync(path.join(root, 'public', 'og.jpg'), jbuf);
  console.log('public/og.jpg', (jbuf.length / 1024).toFixed(0), 'ko');
  await page.context().close();
}

// ---------- Visuel carré (1080×1080) et carte de victoire « zombies » (1080×1350) ----------
{
  const page = await cityPage(1080, 1080, '?net=local');
  await page.addStyleTag({ content: '#ui { visibility: hidden !important; }' });
  // Une partie en cours, au milieu des zombies.
  await page.evaluate(() => {
    const g = window.__klaxo, w = g.world;
    g.settings.shownStorageNotice = true; g.settings.online = 'off';
    w.resetProgress(); w.startGame(); g.playing = true;
    w.player.look = { skin: 0xc98d5e, hair: 0x1c1b22, hairStyle: 3, top: 0xff2e88, bottom: 0x1f2233, acc: 4, accColor: 0x22e0ff };
    w.missions.begin(w.missions.find('story-04-zombies'), 0);
    const p = w.map.poiPx('mairie'); w.player.x = p.x + 40; w.player.y = p.y + 70; w.player.angle = Math.PI;
    w.missions.active.spawnZombies?.({ poi: 'mairie', dx: 2, dy: 5 }, 6, 3, 30);
  });
  await page.waitForTimeout(2600);
  const square = await compose(page, 1080, 1080, `
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, 'rgba(11,10,22,0)'); g.addColorStop(0.55, 'rgba(11,10,22,0.92)'); g.addColorStop(1, 'rgba(11,10,22,1)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const t = ctx.createLinearGradient(0, 0, 0, 280); t.addColorStop(0, 'rgba(11,10,22,0.95)'); t.addColorStop(0.6, 'rgba(11,10,22,0.7)'); t.addColorStop(1, 'rgba(11,10,22,0)');
    ctx.fillStyle = t; ctx.fillRect(0, 0, W, 280);
    art.drawLogo(ctx, 60, 56, 13);
    ctx.font = '800 64px ${BODY}'; ctx.fillStyle = '#f2f0ff';
    ctx.fillText('Ils veulent du café.', 60, 800); ctx.fillStyle = '#9dff4a'; ctx.fillText('Klaxonne.', 60, 876);
    ctx.font = '700 28px ${DISPLAY}'; ctx.fillStyle = '#ff2e88'; ctx.fillText('GRATUIT · NAVIGATEUR · ENTRE AMIS', 62, 960);
    ctx.fillStyle = '#c9c4ea'; ctx.font = '600 26px ${DISPLAY}'; ctx.fillText('hellomarketingparis-code.github.io/klaxo', 62, 1010);`, 1.5);
  fs.writeFileSync(path.join(out, 'visuel-zombies-1080x1080.png'), square);
  const card = await page.evaluate(async () => {
    const g = window.__klaxo, w = g.world, def = w.missions.find('story-04-zombies');
    const img = await g.snapshot();
    const blob = await g.art.makeVictoryCard({ title: def.title, text: def.punchline.text, kind: 'story', look: w.player.look, name: 'Comète 47', level: 6, money: 8450, missions: 4, tag: 'SURVIVANT DES ZOMBIES' }, img);
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  });
  fs.writeFileSync(path.join(out, 'carte-victoire-zombies-1080x1350.png'), Buffer.from(card.split(',')[1], 'base64'));
  console.log('marketing/ : visuel carré et carte de victoire');
  await page.context().close();
}
await browser.close();
server.close();
