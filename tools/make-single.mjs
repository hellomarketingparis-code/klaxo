// Assemble une version du jeu en UN SEUL fichier HTML (code, styles et données embarqués).
// Usage : npm run build:single   → single/klaxo.html (page complète) et single/klaxo-contenu.html (contenu seul)
// Cette version n'a pas de service worker : elle se joue en ligne, la sauvegarde locale fonctionne.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
execSync('npx vite build --config vite.single.config.ts', { cwd: root, stdio: 'inherit' });
const build = path.join(root, 'single', 'build');
// Un script intégré ne doit jamais contenir la séquence de fermeture de balise.
const js = fs.readFileSync(path.join(build, 'klaxo.js'), 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const css = fs.readFileSync(path.join(build, 'klaxo.css'), 'utf8');

const data = {};
const dataDir = path.join(root, 'public', 'data');
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.json')) data[path.relative(dataDir, p).split(path.sep).join('/')] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
})(dataDir);
const json = JSON.stringify(data).replace(/</g, '\\u003c');

const body = `<div id="app">
  <div id="game"></div>
  <div id="ui">
    <div id="boot" role="status">
      <div class="boot-name">KLAXO</div>
      <div class="boot-bar"><i></i></div>
      <div class="boot-msg" id="boot-msg">Construction de la ville…</div>
    </div>
  </div>
</div>
<script type="application/json" id="klaxo-data">${json}</script>
<script>${js}</script>`;
const content = `<title>KLAXO</title>\n<style>${css}</style>\n${body}\n`;
const page = `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<meta name="theme-color" content="#0b0a16">\n<title>KLAXO</title>\n<style>${css}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(root, 'single', 'klaxo-contenu.html'), content);
fs.writeFileSync(path.join(root, 'single', 'klaxo.html'), page);
fs.rmSync(build, { recursive: true, force: true });
console.log(`single/klaxo.html : ${(page.length / 1024 / 1024).toFixed(2)} Mo (page complète, à ouvrir ou héberger telle quelle)`);
console.log(`single/klaxo-contenu.html : ${(content.length / 1024 / 1024).toFixed(2)} Mo (contenu sans en-tête, pour une intégration)`);
