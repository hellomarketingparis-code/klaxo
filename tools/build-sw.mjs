// Génère dist/sw.js après la compilation : liste des fichiers à mettre en cache et numéro de version.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else files.push(path.relative(dist, p).split(path.sep).join('/'));
  }
})(dist);
// Les images d'aperçu des réseaux sociaux ne servent pas au jeu : pas de mise en cache hors ligne.
const shell = files.filter((f) => f !== 'sw.js' && !f.startsWith('data/') && !/^og\.(png|jpe?g)$/.test(f)).sort();
const data = files.filter((f) => f.startsWith('data/')).sort();
const hash = crypto.createHash('sha1');
for (const f of shell) hash.update(f).update(fs.readFileSync(path.join(dist, f)));
const version = hash.digest('hex').slice(0, 12);
const total = [...shell, ...data].reduce((n, f) => n + fs.statSync(path.join(dist, f)).size, 0);
const sw = `// KLAXO — service worker (généré par tools/build-sw.mjs, ne pas modifier à la main).
// Le jeu complet est mis en cache à la première visite : il se lance ensuite sans connexion.
const VERSION = '${version}';
const SHELL = 'klaxo-shell-' + VERSION;
const DATA = 'klaxo-data';
const SHELL_FILES = ${JSON.stringify(['./', ...shell.filter((f) => f !== 'index.html')])};
const DATA_FILES = ${JSON.stringify(data)};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES);
    // Les données de la semaine sont mises de côté sans bloquer l'installation.
    const data = await caches.open(DATA);
    await Promise.allSettled(DATA_FILES.map((f) => data.add(new Request(f, { cache: 'no-cache' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('klaxo-shell-') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const rel = url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : url.pathname;
  if (rel.startsWith('data/')) {
    // Données (missions de la semaine) : le réseau d'abord, le cache si l'on est hors ligne.
    event.respondWith((async () => {
      const cache = await caches.open(DATA);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(url.pathname, res.clone());
        return res;
      } catch (err) {
        return (await cache.match(url.pathname)) || (await cache.match(rel)) || new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }
  // Coque du jeu : le cache d'abord, pour un démarrage immédiat et hors ligne.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('./') : undefined);
    if (hit) return hit;
    try { return await fetch(req); } catch (err) { return (await cache.match('./')) || Response.error(); }
  })());
});
`;
fs.writeFileSync(path.join(dist, 'sw.js'), sw);
console.log(`sw.js généré : version ${version}, ${shell.length} fichiers de jeu + ${data.length} fichiers de données, ${(total / 1024 / 1024).toFixed(2)} Mo au total.`);
