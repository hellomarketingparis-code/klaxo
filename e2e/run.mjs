// Tests de bout en bout : le vrai jeu compilé (dist/), dans un vrai navigateur (Chromium via Playwright).
// Usage : npm run build && npm run test:e2e
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'captures');
fs.mkdirSync(shots, { recursive: true });
const exe = process.env.KLAXO_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const { server, url } = await serve(path.join(here, '..', 'dist'));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const results = [];
let failed = 0;
async function test(name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ name, ok: true, note, ms: Date.now() - t0 }); console.log(`  ✓ ${name}${note ? ` — ${note}` : ''}`); }
  catch (e) { failed++; results.push({ name, ok: false, note: String(e.message ?? e).split('\n')[0], ms: Date.now() - t0 }); console.log(`  ✗ ${name}\n      ${String(e.message ?? e).split('\n')[0]}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(ctx, opts = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(m.text())) errors.push(m.text()); });
  if (opts.route) await opts.route(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__klaxo && window.__klaxo.scene, null, { timeout: 45000 });
  await page.evaluate(() => { const g = window.__klaxo; g.settings.quality = 'medium'; g.applySettings(); });
  return { page, errors };
}
const state = (page) => page.evaluate(() => window.__klaxo.debug.state());
const waitState = (page, fn, timeout = 20000, arg) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
/** Fait défiler un dialogue jusqu'au bout. */
async function skipDialogs(page, max = 14) {
  for (let i = 0; i < max; i++) {
    const open = await page.evaluate(() => !!document.querySelector('#dialog') || !!document.querySelector('.win .btn.primary') && window.__klaxo.world.busy);
    if (!open) { await sleep(150); if (!(await page.evaluate(() => window.__klaxo.world.busy))) return; continue; }
    if (await page.$('#dialog')) { await page.keyboard.press('Space'); await sleep(60); await page.keyboard.press('Space'); }
    else await page.keyboard.press('Enter');
    await sleep(140);
  }
}

console.log('KLAXO — tests de bout en bout\n');

// ============ Ordinateur ============
console.log('Ordinateur (1280×720, clavier)');
const desk = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const { page, errors } = await open(desk);

await test('1. le jeu s’ouvre dans le navigateur, sans erreur', async () => {
  assert(await page.isVisible('#logo'), 'logo absent');
  assert(await page.isVisible('text=Jouer'), 'bouton Jouer absent');
  assert(errors.length === 0, `erreurs console : ${errors.join(' | ')}`);
  await page.screenshot({ path: path.join(shots, '01-menu.png') });
  const size = await page.evaluate(() => performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0));
  return `premier chargement ≈ ${(size / 1024 / 1024).toFixed(2)} Mo transférés`;
});

await test('   la mission de la semaine est annoncée à l’accueil', async () => {
  assert(await page.isVisible('.weekly-card'), 'carte hebdomadaire absente');
  return (await page.textContent('.weekly-card h3'))?.trim();
});

await test('   création du personnage puis entrée en jeu, sans inscription', async () => {
  await page.click('text=Jouer');
  await page.waitForSelector('#player-name');
  await page.fill('#player-name', 'Testeur');
  await page.click('button[aria-label^="Haut #22e0ff"]');
  await page.click('text=Casquette');
  await page.screenshot({ path: path.join(shots, '02-personnage.png') });
  await page.click('text=C’est parti');
  await page.waitForSelector('text=Compris');
  await page.click('text=Compris');
  await waitState(page, () => window.__klaxo.playing && !window.__klaxo.world.paused);
  const s = await page.evaluate(() => ({ name: window.__klaxo.world.player.name, top: window.__klaxo.world.player.look.top, acc: window.__klaxo.world.player.look.acc }));
  assert(s.name === 'Testeur' && s.top === 0x22e0ff && s.acc === 1, `personnage inattendu : ${JSON.stringify(s)}`);
});

await test('2. une vraie ville 2D est affichée', async () => {
  await sleep(1500);
  const st = await page.evaluate(() => ({ ...window.__klaxo.scene.stats, painted: window.__klaxo.scene.paintedChunks, buildings: window.__klaxo.world.map.buildings.length, districts: new Set(window.__klaxo.world.map.buildings.map((b) => b.district)).size }));
  assert(st.chunks >= 1 && st.painted >= 1, 'aucun chunk affiché');
  assert(st.buildings > 300 && st.districts === 5, 'ville incomplète');
  // L'image n'est pas vide : on compte les couleurs distinctes d'une capture.
  const png = await page.screenshot({ path: path.join(shots, '03-ville.png') });
  assert(png.length > 60000, 'capture anormalement uniforme');
  return `${st.buildings} bâtiments, 5 quartiers, ${st.chunks} chunks chargés`;
});

await test('3. le personnage se déplace librement (clavier)', async () => {
  const a = await state(page);
  await page.keyboard.down('KeyD'); await sleep(900); await page.keyboard.up('KeyD');
  const b = await state(page);
  await page.keyboard.down('ArrowDown'); await sleep(700); await page.keyboard.up('ArrowDown');
  const c = await state(page);
  assert(b.x - a.x > 25, `pas de déplacement horizontal (${a.x} → ${b.x})`);
  assert(c.y - b.y > 15, `pas de déplacement vertical (${b.y} → ${c.y})`);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyA'); await sleep(900); await page.keyboard.up('KeyA'); await page.keyboard.up('ShiftLeft');
  const d = await state(page);
  assert(c.x - d.x > (b.x - a.x) * 1.2, 'la course n’est pas plus rapide que la marche');
});

await test('4. des piétons vivent autour du joueur', async () => {
  await waitState(page, () => window.__klaxo.world.pedSys.civilCount >= 8, 25000);
  const n = await page.evaluate(() => { const w = window.__klaxo.world; const states = {}; for (const q of w.peds) states[q.state] = (states[q.state] || 0) + 1; return { count: w.pedSys.civilCount, states }; });
  assert(Object.keys(n.states).length >= 2, 'les piétons n’ont qu’un seul comportement');
  return `${n.count} habitants (${Object.entries(n.states).map(([k, v]) => `${k}: ${v}`).join(', ')})`;
});

await test('5. des voitures circulent', async () => {
  await waitState(page, () => window.__klaxo.world.traffic.count >= 4, 25000);
  const a = await page.evaluate(() => window.__klaxo.world.vehicles.filter((v) => v.driver === 'npc').map((v) => ({ id: v.id, x: v.x, y: v.y })));
  await sleep(2500);
  const b = await page.evaluate(() => window.__klaxo.world.vehicles.filter((v) => v.driver === 'npc').map((v) => ({ id: v.id, x: v.x, y: v.y })));
  const moved = a.filter((v) => { const w = b.find((o) => o.id === v.id); return w && Math.hypot(w.x - v.x, w.y - v.y) > 30; }).length;
  assert(moved >= 2, `seulement ${moved} véhicule(s) en mouvement`);
  return `${a.length} véhicules autonomes, ${moved} ont avancé en 2,5 s`;
});

await test('6. entrer dans une voiture', async () => {
  await page.evaluate(() => { const g = window.__klaxo; g.debug.tp('x_centre', 60, 60); const v = g.debug.car('sedan'); g.world.player.x = v.x + Math.sin(v.angle) * 12; g.world.player.y = v.y - Math.cos(v.angle) * 12; });
  await waitState(page, () => window.__klaxo.world.prompt && window.__klaxo.world.prompt.kind === 'vehicle');
  assert(await page.isVisible('#prompt'), 'invite « Monter » absente');
  await page.keyboard.press('KeyE');
  await waitState(page, () => window.__klaxo.world.player.state === 'driving');
  assert(await page.isVisible('#vehicle'), 'tableau de bord absent');
});

await test('7. conduire dans les rues', async () => {
  const a = await state(page);
  // On relève la vitesse maximale pendant le trajet : en fin de parcours, la voiture peut être freinée par la circulation.
  let top = 0;
  const sample = async (ms) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) top = Math.max(top, (await state(page)).speed); };
  await page.keyboard.down('KeyW'); await sample(1600);
  await page.keyboard.down('KeyD'); await sample(350); await page.keyboard.up('KeyD');
  await sample(500);
  const b = await state(page);
  await page.screenshot({ path: path.join(shots, '04-conduite.png') });
  await page.keyboard.up('KeyW');
  assert(Math.hypot(b.x - a.x, b.y - a.y) > 100, 'la voiture n’a pas avancé');
  assert(top > 60, `vitesse trop faible (${top})`);
  await page.keyboard.press('Space');
  const honks = await page.evaluate(() => window.__klaxo.world.economy.get('honks'));
  return `vitesse atteinte : ${top} px/s, klaxon : ${honks >= 0 ? 'ok' : '?'}`;
});

await test('8. sortir du véhicule', async () => {
  await page.keyboard.down('KeyS');
  await waitState(page, () => window.__klaxo.world.player.vehicle.speed < 25, 8000);
  await page.keyboard.up('KeyS');
  await page.keyboard.down('ShiftLeft'); await sleep(500); await page.keyboard.up('ShiftLeft');
  await page.keyboard.press('KeyE');
  await waitState(page, () => window.__klaxo.world.player.state === 'foot');
});

await test('9-10. parler à un personnage et démarrer une mission', async () => {
  await page.evaluate(() => { const g = window.__klaxo; const ped = g.world.missions.givers.get('story-01-colis'); g.world.player.x = ped.x + 9; g.world.player.y = ped.y + 5; });
  await waitState(page, () => window.__klaxo.world.prompt && window.__klaxo.world.prompt.kind === 'giver');
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#dialog');
  await page.screenshot({ path: path.join(shots, '05-dialogue.png') });
  await skipDialogs(page);
  await waitState(page, () => window.__klaxo.world.missions.active !== null);
  await page.waitForSelector('#objective:not([hidden])');
  const obj = await page.textContent('#objective .o-text');
  assert(/colis/i.test(obj ?? ''), `objectif inattendu : ${obj}`);
  return `objectif affiché : « ${obj} »`;
});

await test('11-12. terminer la mission et recevoir la récompense', async () => {
  const before = await state(page);
  // Étape 1 : ramasser le colis.
  await page.evaluate(() => { const g = window.__klaxo; const mk = g.world.missions.active.markers[0]; g.world.player.x = mk.x + 6; g.world.player.y = mk.y + 6; });
  await waitState(page, () => window.__klaxo.world.prompt && window.__klaxo.world.prompt.kind === 'mission');
  await page.keyboard.press('KeyE');
  await waitState(page, () => window.__klaxo.world.missions.active.stepIndex === 1);
  // Étape 2 : monter dans un véhicule.
  await page.evaluate(() => { const g = window.__klaxo; const v = g.debug.car('compact'); g.world.player.x = v.x + Math.sin(v.angle) * 12; g.world.player.y = v.y - Math.cos(v.angle) * 12; });
  await waitState(page, () => window.__klaxo.world.prompt && window.__klaxo.world.prompt.kind === 'vehicle');
  await page.keyboard.press('KeyE');
  await waitState(page, () => window.__klaxo.world.missions.active.stepIndex === 2);
  assert(await page.isVisible('#timer'), 'chronomètre absent');
  assert(await page.isVisible('#meter'), 'jauge du colis absente');
  await page.screenshot({ path: path.join(shots, '06-mission.png') });
  // Étape 3 : on se place devant l'hôtel (le trajet complet est conduit pour de bon dans les tests unitaires).
  await page.evaluate(() => { const g = window.__klaxo; const h = g.world.map.poiPx('hotel'); const r = g.world.map.nearestRoadPoint(h.x, h.y); const v = g.world.player.vehicle; v.x = r.x; v.y = r.y; v.angle = r.angle; v.vx = 0; v.vy = 0; });
  await waitState(page, () => window.__klaxo.world.missions.active.stepIndex === 3);
  await page.keyboard.press('KeyE');
  await waitState(page, () => window.__klaxo.world.player.state === 'foot');
  // Étape 4 : remettre le colis.
  await page.evaluate(() => { const g = window.__klaxo; const mk = g.world.missions.active.markers[0]; g.world.player.x = mk.x + 6; g.world.player.y = mk.y + 6; });
  await waitState(page, () => window.__klaxo.world.prompt && window.__klaxo.world.prompt.kind === 'mission');
  await page.keyboard.press('KeyE');
  await skipDialogs(page, 20);
  await waitState(page, () => window.__klaxo.world.missions.active === null && window.__klaxo.world.missions.done['story-01-colis']);
  await page.screenshot({ path: path.join(shots, '07-reussite.png') });
  const after = await state(page);
  assert(after.money >= before.money + 500, `récompense non reçue (${before.money} → ${after.money})`);
  return `argent : ${before.money} → ${after.money} ¤`;
});

await test('11 bis. une mission peut aussi échouer (chronomètre)', async () => {
  await page.evaluate(() => { const g = window.__klaxo; const ped = g.world.missions.givers.get('story-02-bouchons'); g.world.player.x = ped.x + 9; g.world.player.y = ped.y + 5; });
  await waitState(page, () => window.__klaxo.world.prompt && window.__klaxo.world.prompt.kind === 'giver');
  await page.keyboard.press('KeyE');
  await skipDialogs(page);
  await waitState(page, () => window.__klaxo.world.missions.active !== null);
  await page.keyboard.press('Escape');
  await page.waitForSelector('text=Abandonner');
  await page.click('text=Abandonner');
  await waitState(page, () => window.__klaxo.world.missions.active === null);
  const h = await page.evaluate(() => window.__klaxo.world.missions.history[0]);
  assert(h.result === 'failed', 'l’abandon n’est pas enregistré comme un échec');
  await page.waitForSelector('#card.fail');
});

await test('13. la police réagit', async () => {
  await page.evaluate(() => { const g = window.__klaxo; g.debug.tp('x_centre', 60, 40); g.debug.wanted(3); });
  await waitState(page, () => document.querySelectorAll('#stars i.on').length === 3);
  await waitState(page, () => window.__klaxo.world.police.unitCount >= 1, 30000);
  await sleep(1500);
  await page.screenshot({ path: path.join(shots, '08-police.png') });
  const n = await page.evaluate(() => window.__klaxo.world.police.unitCount);
  await waitState(page, () => window.__klaxo.world.economy.get('busted') >= 1, 60000);
  const s = await state(page);
  assert(s.wanted === 0, 'niveau de recherche non remis à zéro après l’arrestation');
  return `${n} unité(s) lancée(s) à la poursuite, arrestation puis amende`;
});

await test('14. argent et mini-carte visibles', async () => {
  assert(await page.isVisible('#money'), 'argent absent');
  assert(/¤/.test((await page.textContent('#money')) ?? ''), 'montant absent');
  const filled = await page.evaluate(() => { const c = document.querySelector('#minimap'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 16) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return set.size; });
  assert(filled > 6, 'mini-carte vide');
  await page.keyboard.press('KeyM');
  await page.waitForSelector('#bigmap');
  await page.screenshot({ path: path.join(shots, '09-carte.png') });
  await page.keyboard.press('KeyM');
  await page.waitForSelector('#bigmap', { state: 'detached' });
});

await test('   boutiques : achat d’un véhicule et garage', async () => {
  await page.evaluate(() => { const g = window.__klaxo; g.debug.money(5000); g.debug.tp('dealer'); });
  await waitState(page, () => window.__klaxo.world.prompt && window.__klaxo.world.prompt.kind === 'shop');
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.car-row');
  await page.screenshot({ path: path.join(shots, '10-concession.png') });
  await page.click('.car-row >> nth=0 >> text=Acheter');
  await waitState(page, () => window.__klaxo.world.economy.owned.length === 1);
  await page.keyboard.press('Escape');
  await waitState(page, () => !window.__klaxo.world.paused);
});

let saved;
await test('15. quitter puis retrouver sa progression (IndexedDB)', async () => {
  await page.evaluate(() => window.__klaxo.saveNow('test'));
  saved = await state(page);
  const kind = await page.evaluate(() => window.__klaxo.save.store.kind);
  assert(kind === 'indexeddb', `stockage inattendu : ${kind}`);
  await page.reload();
  await page.waitForFunction(() => window.__klaxo && window.__klaxo.scene, null, { timeout: 45000 });
  await page.waitForSelector('text=Continuer');
  await page.screenshot({ path: path.join(shots, '11-continuer.png') });
  await page.click('text=Continuer');
  await waitState(page, () => window.__klaxo.playing);
  const s = await state(page);
  assert(s.money === saved.money, `argent différent (${saved.money} → ${s.money})`);
  assert(s.done.includes('story-01-colis'), 'mission terminée oubliée');
  assert(s.level === saved.level, 'niveau différent');
  const p = await page.evaluate(() => ({ name: window.__klaxo.world.player.name, top: window.__klaxo.world.player.look.top, owned: window.__klaxo.world.economy.owned.length }));
  assert(p.name === 'Testeur' && p.top === 0x22e0ff && p.owned === 1, 'personnage ou véhicules non restaurés');
  assert(Math.hypot(s.x - saved.x, s.y - saved.y) < 40, 'position non restaurée');
  return `niveau ${s.level}, ${s.money} ¤, position et tenue retrouvés`;
});

await test('   export puis import d’une sauvegarde', async () => {
  const text = await page.evaluate(() => window.__klaxo.save.exportText(window.__klaxo.world.serialize()));
  assert(text.includes('"game": "klaxo"'), 'export invalide');
  await page.evaluate(() => window.__klaxo.debug.money(777));
  await page.keyboard.press('Escape');
  await page.click('text=Sauvegarde');
  await page.fill('#import-text', text);
  await page.click('text=Charger cette sauvegarde');
  await waitState(page, (m) => window.__klaxo.playing && window.__klaxo.world.economy.money === m, 15000, saved.money);
});

await test('   fonctionnement hors ligne après le premier chargement (PWA)', async () => {
  const sw = await page.evaluate(async () => { if (!('serviceWorker' in navigator)) return 'absent'; const reg = await navigator.serviceWorker.ready; return reg.active ? 'actif' : 'inactif'; });
  assert(sw === 'actif', `service worker ${sw}`);
  await page.evaluate(() => window.__klaxo.saveNow('test'));
  await desk.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__klaxo && window.__klaxo.scene, null, { timeout: 45000 });
  assert(await page.isVisible('#logo'), 'le jeu ne démarre pas hors ligne');
  const wk = await page.evaluate(() => window.__klaxo.weekly.mission && window.__klaxo.weekly.mission.id);
  assert(wk, 'mission hebdomadaire absente hors ligne');
  await page.click('text=Continuer');
  await waitState(page, () => window.__klaxo.playing);
  await page.keyboard.down('KeyD'); await sleep(600); await page.keyboard.up('KeyD');
  const s = await state(page);
  assert(s.done.includes('story-01-colis'), 'progression perdue hors ligne');
  await page.screenshot({ path: path.join(shots, '12-hors-ligne.png') });
  await desk.setOffline(false);
  return `jeu, sauvegarde et mission « ${wk} » disponibles sans réseau`;
});

await test('   redémarrage : aucune erreur accumulée', async () => {
  assert(errors.length === 0, `erreurs console : ${errors.slice(0, 3).join(' | ')}`);
});

await test('   mission de l’actualité jouable depuis le kiosque', async () => {
  await page.evaluate(() => { const g = window.__klaxo; g.debug.tp('kiosk'); });
  await waitState(page, () => window.__klaxo.world.prompt && window.__klaxo.world.prompt.kind === 'shop');
  await page.keyboard.press('KeyE');
  await page.waitForSelector('text=À la une cette semaine');
  await page.screenshot({ path: path.join(shots, '13-kiosque.png') });
  const link = await page.getAttribute('.item a', 'href');
  assert(/^https:\/\//.test(link ?? ''), 'lien vers la source absent');
  await page.click('text=Accepter la mission');
  await skipDialogs(page);
  await waitState(page, () => window.__klaxo.world.missions.active && window.__klaxo.world.missions.active.def.kind === 'weekly');
  // Les changements de la semaine en cours (data/world/weekly-changes.json) doivent être appliqués à la ville.
  const check = await page.evaluate(async () => {
    const file = await (await fetch('data/world/weekly-changes.json', { cache: 'no-store' })).json();
    const m = window.__klaxo.world.mods, now = Date.now();
    const due = file.changes.filter((c) => now >= Date.parse(c.start) && now < Date.parse(c.end));
    const wrong = due.filter((c) => !m.active.some((a) => a.id === c.id)
      || (c.type === 'traffic' && m.trafficFactor !== c.factor) || (c.type === 'pedestrians' && m.pedFactor !== c.factor)
      || (c.type === 'robots' && m.robotShare < c.share) || (c.type === 'prices' && m.priceFactor !== c.factor)
      || (c.type === 'chatter' && !c.lines.every((l) => m.chatter.includes(l))));
    return { due: due.map((c) => c.type), wrong: wrong.map((c) => c.id) };
  });
  assert(check.wrong.length === 0, `changements hebdomadaires non appliqués : ${check.wrong.join(', ')}`);
  await sleep(800);
  await page.screenshot({ path: path.join(shots, '14-actualite.png') });
  await page.evaluate(() => window.__klaxo.world.missions.abort());
  return `effets en ville : ${check.due.join(', ') || 'aucun cette semaine'}`;
});

await test('   performances (indicatif : rendu logiciel sans carte graphique)', async () => {
  await page.evaluate(() => { const g = window.__klaxo; g.debug.tp('x_centre', 40, 40); });
  await sleep(1000);
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else res(Math.round((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(tick); }));
  assert(!(await page.evaluate(() => window.__klaxo.world.paused)), 'le monde est resté en pause après la fermeture d’un menu');
  const sim = await page.evaluate(() => { const w = window.__klaxo.world; const t0 = performance.now(); for (let i = 0; i < 300; i++) w.update(1 / 60); return (performance.now() - t0) / 300; });
  const mem = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
  const paint = await page.evaluate(() => { const s = window.__klaxo.scene; return { n: s.paintedChunks, ms: s.paintMs / Math.max(1, s.paintedChunks) }; });
  const tex = await page.evaluate(() => window.__klaxo.scene.textures.getTextureKeys().length);
  return `${fps} images/s en rendu logiciel, simulation ${sim.toFixed(2)} ms par pas, peinture d’un chunk ${paint.ms.toFixed(0)} ms en moyenne (${paint.n} peints), ${tex} textures, mémoire JS ${mem ?? '?'} Mo`;
});
await desk.close();

// ============ Données invalides ============
console.log('\nRobustesse des données');
// Sans service worker : on teste le tout premier chargement, sans aucun cache.
const bad = await browser.newContext({ viewport: { width: 1024, height: 600 }, serviceWorkers: 'block' });
await test('   mission hebdomadaire invalide : ignorée, le jeu démarre', async () => {
  const { page: p2, errors: e2 } = await open(bad, { route: (p) => p.route('**/data/missions/weekly.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema: 1, missions: [{ schema: 1, id: 'weekly-piege', kind: 'weekly', title: 'Piège', summary: 'x', giver: { name: 'X', profile: 'passerby', at: { poi: 'kiosk' } }, intro: [], steps: [{ type: 'run_script', objective: 'x', code: 'alert(1)' }], reward: { money: 999999, xp: 1 } }] }) })) });
  const wk = await p2.evaluate(() => window.__klaxo.weekly.mission);
  assert(wk === null, 'une mission invalide a été acceptée');
  assert(await p2.isVisible('text=Jouer'), 'le jeu ne démarre pas');
  assert(e2.length === 0, `erreurs : ${e2.join(' | ')}`);
  await p2.close();
});
await test('   sources d’actualité absentes : le jeu démarre avec l’histoire seule', async () => {
  const { page: p3 } = await open(bad, { route: async (p) => { await p.route('**/data/missions/weekly.json', (r) => r.fulfill({ status: 404, body: 'x' })); await p.route('**/data/world/**', (r) => r.abort()); await p.route('**/data/missions/story.json', (r) => r.abort()); } });
  const s = await p3.evaluate(() => ({ weekly: window.__klaxo.weekly.mission, story: window.__klaxo.world.missions.story.length }));
  assert(s.weekly === null && s.story === 3, `état inattendu : ${JSON.stringify(s)}`);
  await p3.close();
});
await bad.close();

// ============ Téléphone ============
console.log('\nTéléphone (844×390, tactile, émulation Chromium)');
const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' });
const { page: mp, errors: merr } = await open(phone);
const cdp = await phone.newCDPSession(mp);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 8, radiusY: 8, force: 1 })) });

await test('   menu puis entrée en jeu au doigt', async () => {
  await mp.screenshot({ path: path.join(shots, '20-mobile-menu.png') });
  await mp.tap('text=Jouer');
  await mp.waitForSelector('text=C’est parti');
  await mp.screenshot({ path: path.join(shots, '21-mobile-personnage.png') });
  await mp.tap('text=C’est parti');
  await mp.waitForSelector('text=Compris');
  await mp.tap('text=Compris');
  await waitState(mp, () => window.__klaxo.playing && !window.__klaxo.world.paused);
  assert(await mp.evaluate(() => window.__klaxo.touchMode), 'mode tactile non détecté');
  await mp.waitForSelector('#touch:not([hidden])');
  assert(await mp.isVisible('#tb-interact') && await mp.isVisible('#stick-base'), 'commandes tactiles absentes');
});

await test('   joystick : marcher, puis courir en poussant à fond', async () => {
  const a = await state(mp);
  await touch('touchStart', [{ x: 150, y: 290 }]);
  await touch('touchMove', [{ x: 172, y: 290 }]);
  await sleep(900);
  const b = await state(mp);
  await touch('touchMove', [{ x: 215, y: 290 }]);
  await sleep(900);
  const c = await state(mp);
  await mp.screenshot({ path: path.join(shots, '22-mobile-jeu.png') });
  await touch('touchEnd', []);
  assert(b.x - a.x > 12, `le joystick ne déplace pas le personnage (${a.x} → ${b.x})`);
  assert(c.x - b.x > (b.x - a.x) * 1.3, 'pousser à fond ne fait pas courir');
});

await test('   bouton d’interaction : monter, conduire au joystick, freiner, sortir', async () => {
  await mp.evaluate(() => { const g = window.__klaxo; g.debug.tp('x_centre', 60, 60); const v = g.debug.car('compact'); g.world.player.x = v.x + Math.sin(v.angle) * 12; g.world.player.y = v.y - Math.cos(v.angle) * 12; });
  await waitState(mp, () => window.__klaxo.world.prompt && window.__klaxo.world.prompt.kind === 'vehicle');
  await waitState(mp, () => document.querySelector('#tb-interact').textContent === 'Monter');
  await mp.tap('#tb-interact');
  await waitState(mp, () => window.__klaxo.world.player.state === 'driving');
  const a = await state(mp);
  // Deux doigts à la fois : joystick à gauche, klaxon à droite.
  await touch('touchStart', [{ x: 150, y: 290, id: 1 }]);
  await touch('touchMove', [{ x: 150, y: 245, id: 1 }]);
  await sleep(1500);
  const box = await (await mp.$('#tb-action')).boundingBox();
  await touch('touchStart', [{ x: 150, y: 245, id: 1 }, { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 2 }]);
  await sleep(200);
  await touch('touchEnd', [{ x: 150, y: 245, id: 1 }]);
  const b = await state(mp);
  await mp.screenshot({ path: path.join(shots, '23-mobile-conduite.png') });
  await touch('touchEnd', []);
  assert(Math.hypot(b.x - a.x, b.y - a.y) > 60, 'la voiture ne suit pas le joystick');
  const honks = await mp.evaluate(() => window.__klaxo.world.economy.get('honks'));
  assert(honks >= 1, 'le klaxon tactile ne fonctionne pas pendant la conduite (multi-touch)');
  assert(await mp.isVisible('#tb-brake'), 'bouton frein absent');
  const bb = await (await mp.$('#tb-brake')).boundingBox();
  await touch('touchStart', [{ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }]);
  await waitState(mp, () => Math.abs(window.__klaxo.world.player.vehicle.forwardSpeed) < 30, 8000);
  await touch('touchEnd', []);
  await sleep(700);
  await mp.tap('#tb-interact');
  await waitState(mp, () => window.__klaxo.world.player.state === 'foot', 8000);
});

await test('   l’interface tient dans l’écran, sans défilement horizontal', async () => {
  const o = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(o.sw <= o.cw + 1, `débordement horizontal (${o.sw} > ${o.cw})`);
  await mp.tap('#btn-pause');
  await mp.waitForSelector('.tabs');
  await mp.screenshot({ path: path.join(shots, '24-mobile-pause.png') });
  const o2 = await mp.evaluate(() => { const p = document.querySelector('.panel').getBoundingClientRect(); return { right: p.right, w: innerWidth, bottom: p.bottom, h: innerHeight }; });
  assert(o2.right <= o2.w + 1 && o2.bottom <= o2.h + 1, 'la fenêtre de pause dépasse de l’écran');
  await mp.tap('text=Reprendre');
  await waitState(mp, () => !window.__klaxo.world.paused, 5000);
  assert(merr.length === 0, `erreurs console : ${merr.join(' | ')}`);
});
await phone.close();

await browser.close();
server.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} vérifications réussies${failed ? `, ${failed} en échec` : ''}. Captures : e2e/captures/`);
fs.writeFileSync(path.join(shots, 'resultats.json'), JSON.stringify({ date: new Date().toISOString(), navigateur: browser.version?.() ?? 'chromium', results }, null, 2));
process.exit(failed ? 1 : 0);
