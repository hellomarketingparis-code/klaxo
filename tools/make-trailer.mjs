// Bande-annonce verticale (9:16, 720×1280, ~25 s) filmée dans le vrai jeu, pour TikTok, Reels et Shorts.
// Usage : npm run build && node tools/make-trailer.mjs   → marketing/klaxo-bande-annonce-9x16.mp4
// La vidéo est muette : ajoutez une musique depuis l'application du réseau social (meilleure portée).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serve } from '../e2e/server.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'marketing');
const frames = path.join(out, '.frames');
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });
const exe = process.env.KLAXO_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const { server, url } = await serve(path.join(root, 'dist'));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const ctx = await browser.newContext({ viewport: { width: 720, height: 1280 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn('[page]', String(e)));
  await page.goto(url + '?net=local');
  await page.waitForFunction(() => window.__klaxo && window.__klaxo.scene, null, { timeout: 45000 });
  // Outils de tournage : pilote automatique, cri commandé, légendes.
  await page.evaluate(() => {
    const g = window.__klaxo;
    g.settings.quality = 'high'; g.applySettings();
    const ad = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
    const A = (window.__shoot = { pts: [], i: 0, cruise: 150, stuck: 0, rev: 0, shout: false, on: false });
    A.route = (poi) => {
      const w = g.world, m = w.map, p = w.player, t = typeof poi === 'string' ? m.poiPx(poi) : poi;
      A.pts = m.routeNodes(m.nearestNode(p.px, p.py).id, m.nearestNode(t.x, t.y).id).map((id) => ({ x: m.nodes[id].cx, y: m.nodes[id].cy }));
      A.i = 0; A.on = true;
    };
    const base = g.input.read.bind(g.input);
    g.input.read = () => {
      const it = { moveX: 0, moveY: 0, run: false, interact: false, action: false, actionHeld: false, handbrake: false };
      if (A.shout) { A.shout = false; it.action = true; return it; }
      const v = g.world.player.vehicle;
      if (!A.on || !v || !A.pts.length) { base(); return it; }
      while (A.i < A.pts.length - 1 && Math.hypot(v.x - A.pts[A.i].x, v.y - A.pts[A.i].y) < 30) A.i++;
      const t = A.pts[A.i];
      const err = ad(v.angle, Math.atan2(t.y - v.y, t.x - v.x));
      const vf = v.forwardSpeed;
      const target = Math.abs(err) > 0.9 ? 45 : Math.abs(err) > 0.4 ? 80 : A.cruise;
      it.moveY = vf < target ? -1 : vf > target + 15 ? 1 : 0;
      it.moveX = Math.max(-1, Math.min(1, err * 2.6));
      if (A.rev > 0) { A.rev -= 1 / 60; it.moveY = 1; it.moveX = -it.moveX; }
      else if (Math.abs(vf) < 5) { A.stuck += 1 / 60; if (A.stuck > 1) { A.rev = 0.8; A.stuck = 0; } } else A.stuck = 0;
      return it;
    };
    const cap = document.createElement('div');
    cap.id = 'trailer-cap';
    cap.style.cssText = 'position:fixed;left:0;right:0;top:11%;z-index:99;text-align:center;pointer-events:none;padding:0 28px;font:800 50px/1.12 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#fff;text-shadow:0 4px 0 #ff2e88,0 0 24px rgba(0,0,0,.9);opacity:0;transition:opacity .25s';
    document.body.append(cap);
    window.__caption = (t, low = false) => { cap.textContent = t; cap.style.top = low ? '66%' : '12%'; cap.style.opacity = t ? '1' : '0'; };
    // Pas de notifications pendant le tournage.
    const st = document.createElement('style'); st.textContent = '#toasts{display:none!important}'; document.head.append(st);
    window.__card = (on) => {
      let el = document.getElementById('trailer-card');
      if (!on) { el?.remove(); return; }
      el = document.createElement('div'); el.id = 'trailer-card';
      el.style.cssText = 'position:fixed;inset:0;z-index:98;background:rgba(11,10,22,.88);display:grid;place-content:center;justify-items:center;gap:26px;text-align:center;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#f2f0ff';
      const c = document.createElement('canvas'); c.width = 600; c.height = 140;
      g.art.drawLogo(c.getContext('2d'), 12, 12, 19);
      const tag = document.createElement('div'); tag.textContent = 'LA VILLE QUI KLAXONNE L’ACTUALITÉ';
      tag.style.cssText = 'font:700 26px ui-monospace,Menlo,Consolas,monospace;color:#22e0ff;letter-spacing:.06em';
      const p = document.createElement('div'); p.textContent = 'Gratuit · Navigateur · Entre amis';
      p.style.cssText = 'font:800 40px system-ui,sans-serif;margin-top:20px';
      const u = document.createElement('div'); u.textContent = 'hellomarketingparis-code.github.io/klaxo';
      u.style.cssText = 'font:700 26px ui-monospace,Menlo,Consolas,monospace;background:#ff2e88;color:#0b0a16;padding:12px 18px;margin-top:10px';
      const f = document.createElement('div'); f.textContent = 'Jeu de fiction';
      f.style.cssText = 'font:500 20px system-ui,sans-serif;color:#a9a4cc;margin-top:6px';
      el.append(c, tag, p, u, f); document.body.append(el);
    };
  });
  return page;
}
async function startGame(page, look, group) {
  await page.evaluate(({ look, group }) => {
    const g = window.__klaxo;
    g.settings.shownStorageNotice = true; g.settings.online = 'on'; g.settings.netGroup = group;
    g.newGame(look, '');
    g.world.economy.stats.introSeen = 1;
    document.getElementById('toasts')?.replaceChildren();
  }, { look, group });
  await page.waitForFunction(() => window.__klaxo.playing && window.__klaxo.net.status === 'online', null, { timeout: 15000 });
}
const car = (page, type = 'sport', poi = null) => page.evaluate(({ type, poi }) => {
  const g = window.__klaxo, w = g.world;
  if (poi) { const t = w.map.poiPx(poi); w.player.x = t.x; w.player.y = t.y; }
  if (w.player.vehicle) w.exitVehicle(true);
  const v = g.debug.car(type); w.player.x = v.x; w.player.y = v.y; w.enterVehicle(v);
}, { type, poi });

// ---------- Deux joueurs : A est filmé, B joue l'ami ----------
const A = await open();
const B = await open();
await A.bringToFront();
await startGame(A, { skin: 0xc98d5e, hair: 0x1c1b22, hairStyle: 3, top: 0xff2e88, bottom: 0x1f2233, acc: 4, accColor: 0x22e0ff }, 'TRAIL');
await startGame(B, { skin: 0xf6d3b3, hair: 0xd9b45a, hairStyle: 1, top: 0x22e0ff, bottom: 0x3b4a7a, acc: 1, accColor: 0xffb627 }, 'TRAIL');
await A.waitForFunction(() => window.__klaxo.net.count === 1, null, { timeout: 15000 });
// L'onglet de l'ami n'est pas affiché : Chromium y suspend l'animation. On fait avancer sa partie au minuteur.
await B.evaluate(() => {
  const g = window.__klaxo;
  let last = performance.now();
  setInterval(() => { const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now; g.world.update(dt, g.input.read()); g.net.update(dt, true); }, 33);
});

// ---------- Enregistrement (flux d'images de Chromium) ----------
const cdp = await ctx.newCDPSession(A);
const shots = [];
let recording = false;
cdp.on('Page.screencastFrame', async (f) => {
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  if (!recording) return;
  const file = path.join(frames, `f${String(shots.length).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
  shots.push({ file, t: f.metadata.timestamp });
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 720, maxHeight: 1280, everyNthFrame: 1 });
const segments = [];
async function shoot(seconds, caption, setup, low = false) {
  if (setup) await setup();
  await A.evaluate(({ c, low }) => window.__caption(c, low), { c: caption, low });
  await sleep(250);
  recording = true;
  const t0 = Date.now() / 1000;
  await sleep(seconds * 1000);
  segments.push([t0, Date.now() / 1000]);
  recording = false;
  await A.evaluate(() => window.__caption(''));
}

// 1. La ville (vitrine du menu), avec le logo.
await shoot(2.6, '', async () => {
  await A.evaluate(() => { window.__klaxo.playing = false; window.__klaxo.world.toAttract(); document.getElementById('hud').hidden = true; window.__card(true); document.getElementById('trailer-card').style.background = 'rgba(11,10,22,.55)'; });
  await sleep(1200);
});
await A.evaluate(() => { window.__card(false); });
// Reprise de la partie.
await A.evaluate(() => { const g = window.__klaxo; g.world.attract = false; g.world.startGame(); g.playing = true; g.ui.showGame(); document.getElementById('toasts')?.replaceChildren(); });

// 2. Conduite dans les rues néon.
await shoot(4.6, 'Une ville néon rien que pour toi', async () => {
  await car(A, 'sport', 'kiosk');
  await A.evaluate(() => window.__shoot.route('tour'));
  await sleep(1500);
});
// 3. Les amis : B rejoint A en voiture.
await shoot(4.4, 'Joue avec tes amis', async () => {
  // A ralentit ; B arrive derrière lui en taxi, sur exactement le même trajet.
  const plan = await A.evaluate(() => { const S = window.__shoot, v = window.__klaxo.world.player.vehicle; S.cruise = 75; return { pts: S.pts, i: S.i, x: v.x - Math.cos(v.angle) * 60, y: v.y - Math.sin(v.angle) * 60, a: v.angle }; });
  await B.evaluate((p) => {
    const g = window.__klaxo, w = g.world;
    if (w.player.vehicle) w.exitVehicle(true);
    const v = g.debug.car('taxi'); v.x = p.x; v.y = p.y; v.angle = p.a; v.vx = Math.cos(p.a) * 60; v.vy = Math.sin(p.a) * 60;
    w.player.x = v.x; w.player.y = v.y; w.enterVehicle(v);
    const S = window.__shoot; S.pts = p.pts; S.i = p.i; S.cruise = 92; S.on = true;
  }, plan);
  await sleep(900);
});
await A.evaluate(() => { window.__shoot.cruise = 150; });
// 4. La police.
await shoot(4.2, 'La police ne lâche rien', async () => {
  await A.evaluate(() => { const g = window.__klaxo; g.debug.wanted(3); window.__shoot.route('hotel'); });
  await sleep(2600);
});
// 5. Les zombies.
await shoot(5.4, 'Des zombies… qui veulent du café', async () => {
  await A.evaluate(() => {
    const g = window.__klaxo, w = g.world;
    window.__shoot.on = false;
    w.wanted.clear(true); w.police.reset();
    if (w.player.vehicle) { const v = w.player.vehicle; v.vx = 0; v.vy = 0; w.exitVehicle(true); }
    const t = w.map.poiPx('gare'); w.player.x = t.x; w.player.y = t.y + 34; w.player.state = 'foot'; w.player.vehicle = null;
    w.missions.begin(w.missions.find('story-04-zombies'), 0);
    w.missions.active.biteCd = 1e9; // tournage : le héros ne se fait pas mordre
    w.missions.active.spawnZombies({ poi: 'gare', dy: 3 }, 7, 4, 30);
    g.scene.cameras.main.setZoom(2);
    document.getElementById('toasts')?.replaceChildren();
  });
  await B.evaluate(() => { const w = window.__klaxo.world; window.__shoot.on = false; if (w.player.vehicle) w.exitVehicle(true); w.player.x = 40; w.player.y = 40; });
  await sleep(1800);
});
await A.evaluate(() => { window.__shoot.shout = true; });
await shoot(1.4, 'Klaxonne. Ils détestent ça.', null);
await A.evaluate(() => { window.__shoot.shout = true; });
await shoot(1.6, 'Klaxonne. Ils détestent ça.', null);
// 6. L'actualité.
await shoot(3.6, 'Chaque semaine, une mission tirée de l’actualité', async () => {
  await A.evaluate(() => { const g = window.__klaxo, w = g.world; g.scene.cameras.main.setZoom(1); w.missions.suspend(); const t = w.map.poiPx('kiosk'); w.player.x = t.x + 30; w.player.y = t.y + 20; w.missions.begin(w.missions.weekly, 0); });
  await sleep(150);
}, true);
// 7. Fin.
await shoot(3.2, '', async () => { await A.evaluate(() => window.__card(true)); await sleep(300); });

await cdp.send('Page.stopScreencast');
await browser.close();
server.close();

// ---------- Montage : images retenues → vidéo 30 i/s ----------
const keep = shots.filter((s) => segments.some(([a, b]) => s.t >= a && s.t <= b + 0.05));
const list = [];
let total = 0;
for (let i = 0; i < keep.length; i++) {
  const cur = keep[i], next = keep[i + 1];
  // Durée d'une image : jusqu'à la suivante, sans franchir une coupe.
  let d = next ? next.t - cur.t : 1 / 30;
  if (d > 0.2 || d <= 0) d = 1 / 30;
  total += d;
  list.push(`file '${path.basename(cur.file)}'`, `duration ${d.toFixed(4)}`);
}
if (keep.length) list.push(`file '${path.basename(keep[keep.length - 1].file)}'`);
fs.writeFileSync(path.join(frames, 'list.txt'), list.join('\n'));
const mp4 = path.join(out, 'klaxo-bande-annonce-9x16.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(frames, 'list.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', mp4], { cwd: frames });
console.log(`${keep.length} images, ${total.toFixed(1)} s → ${path.relative(root, mp4)} (${(fs.statSync(mp4).size / 1024 / 1024).toFixed(1)} Mo)`);
fs.rmSync(frames, { recursive: true, force: true });
