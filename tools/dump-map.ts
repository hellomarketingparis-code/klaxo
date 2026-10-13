// Outil de contrôle : exporte la carte générée en PNG (1 tuile = 3 px) et affiche quelques statistiques.
import fs from 'node:fs';
import { generateCity } from '../src/map/generator';
import { T, DISTRICT_NAMES } from '../src/map/tiles';
// @ts-ignore
import { encodePNG } from './png.mjs';
const m = generateCity();
const S = 3;
const col: Record<number, [number, number, number]> = {
  [T.GRASS]: [40, 80, 50], [T.ROAD]: [45, 42, 70], [T.SIDEWALK]: [110, 105, 150], [T.CROSSWALK]: [200, 200, 220], [T.BUILDING]: [150, 90, 140],
  [T.WATER]: [20, 40, 110], [T.PLAZA]: [130, 120, 120], [T.PARKING]: [70, 70, 90], [T.YARD]: [90, 85, 80], [T.PATH]: [160, 140, 100],
  [T.FENCE]: [220, 220, 80], [T.DOCK]: [120, 100, 80], [T.TREE]: [20, 120, 40], [T.FOREST]: [10, 50, 25], [T.GARDEN]: [60, 110, 60], [T.SAND]: [200, 180, 120], [T.PROP]: [220, 120, 40],
};
const W = m.w * S, H = m.h * S;
const px = new Uint8Array(W * H * 4);
const set = (x: number, y: number, c: [number, number, number]) => { const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const c = col[m.kind[y * m.w + x]] ?? [255, 0, 255]; for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) set(x * S + i, y * S + j, c); }
for (const p of m.pois.values()) for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) set(p.tx * S + 1 + i, p.ty * S + 1 + j, [255, 40, 40]);
for (const s of m.secrets) for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) set(s.tx * S + 1 + i, s.ty * S + 1 + j, [0, 255, 255]);
for (const n of m.nodes) if (n.signal) set(Math.floor(n.cx / 16) * S + 1, Math.floor(n.cy / 16) * S + 1, [0, 255, 0]);
fs.writeFileSync(process.argv[2] ?? 'map.png', encodePNG(W, H, px));
console.log('noeuds', m.nodes.length, 'arêtes', m.edges.length, 'trafic', m.edges.filter((e) => e.traffic).length, 'feux', m.nodes.filter((n) => n.signal).length);
console.log('bâtiments', m.buildings.length, 'parcelles', m.lots.length, 'lampes', m.lamps.length, 'arbres', m.trees.length, 'places', m.spots.length, 'secrets', m.secrets.length, 'props', m.props.length);
const per = [0, 0, 0, 0, 0]; for (const b of m.buildings) per[b.district]++;
console.log(per.map((n, i) => `${DISTRICT_NAMES[i]}: ${n}`).join(' | '));
console.log([...m.pois.values()].map((p) => `${p.id}@${p.tx},${p.ty}`).join(' '));
