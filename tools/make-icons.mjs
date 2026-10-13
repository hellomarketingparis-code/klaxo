// Dessine les icônes de l'application (PNG) sans aucune dépendance : un « K » néon sur fond nuit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
const K = ['10001', '10010', '10100', '11000', '10100', '10010', '10001'];
function icon(size, pad) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= size || y >= size) return; const i = (y * size + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Fond : nuit violette, routes en croix discrètes, halo rose au centre.
    const dx = (x - size / 2) / size, dy = (y - size / 2) / size;
    const glow = Math.max(0, 1 - Math.hypot(dx, dy) * 2.2);
    const road = Math.abs(dx) < 0.07 || Math.abs(dy) < 0.07;
    const r = 11 + glow * 70 + (road ? 14 : 0), g = 10 + glow * 10 + (road ? 12 : 0), b = 22 + glow * 50 + (road ? 22 : 0);
    set(x, y, r, g, b);
  }
  const cell = Math.floor((size - 2 * pad) / 7);
  const ox = Math.floor((size - cell * 5) / 2), oy = Math.floor((size - cell * 7) / 2);
  const rect = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, ...c); };
  const sh = Math.max(2, Math.round(cell / 4));
  K.forEach((row, r) => [...row].forEach((bit, c) => { if (bit === '1') rect(ox + c * cell + sh, oy + r * cell + sh, cell, cell, [74, 18, 48]); }));
  K.forEach((row, r) => [...row].forEach((bit, c) => { if (bit === '1') rect(ox + c * cell, oy + r * cell, cell, cell, [255, 46, 136]); }));
  K.forEach((row, r) => [...row].forEach((bit, c) => { if (bit === '1' && (r === 0 || K[r - 1][c] === '0')) rect(ox + c * cell, oy + r * cell, cell, Math.max(2, Math.round(cell / 5)), [255, 194, 221]); }));
  return encodePNG(size, size, px);
}
fs.writeFileSync(path.join(out, 'icon-192.png'), icon(192, 34));
fs.writeFileSync(path.join(out, 'icon-512.png'), icon(512, 90));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), icon(512, 130));
console.log('icônes écrites dans public/icons');
