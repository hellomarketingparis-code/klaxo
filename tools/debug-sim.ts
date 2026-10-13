// Outil de mise au point : image « radar » de la simulation sans affichage (voitures, piétons, feux).
import fs from 'node:fs';
import { generateCity } from '../src/map/generator';
import { World } from '../src/world/World';
import { T } from '../src/map/tiles';
// @ts-ignore
import { encodePNG } from './png.mjs';

const [poi = 'x_centre', secs = '60', out = 'radar.png', seed = '5'] = process.argv.slice(2);
const map = generateCity();
const w = new World(map, { headless: true, seed: Number(seed) });
w.startGame();
const c = map.poiPx(poi); w.player.x = c.x; w.player.y = c.y;
for (let t = 0; t < Number(secs); t += 1 / 30) w.update(1 / 30);
const R = 380, S = 2;
const W = 2 * R * S, H = 2 * R * S;
const px = new Uint8Array(W * H * 4);
const set = (x: number, y: number, col: number[]) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255; };
const COL: Record<number, number[]> = { [T.ROAD]: [40, 38, 60], [T.CROSSWALK]: [70, 68, 100], [T.SIDEWALK]: [80, 76, 110], [T.BUILDING]: [30, 26, 44] };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const wx = c.x - R + x / S, wy = c.y - R + y / S; set(x, y, COL[map.kindAtPx(wx, wy)] ?? [20, 50, 40]); }
const toS = (x: number, y: number): [number, number] => [(x - c.x + R) * S, (y - c.y + R) * S];
for (const n of map.nodes) { if (!n.signal) continue; const [sx, sy] = toS(n.cx, n.cy); const v = map.signalState(n, true, w.time), hh = map.signalState(n, false, w.time); const colOf = (s: string) => s === 'g' ? [0, 255, 0] : s === 'y' ? [255, 200, 0] : [255, 0, 0]; for (let k = -6; k <= 6; k++) { set(sx, sy + k, colOf(v)); set(sx + k, sy, colOf(hh)); } }
for (const v of w.vehicles) {
  const ai = v.ai;
  const col = v.driver === 'none' ? [120, 120, 120] : ai?.blocked > 3 ? [255, 40, 40] : v.speed < 5 ? [255, 220, 0] : [80, 255, 120];
  const cos = Math.cos(v.angle), sin = Math.sin(v.angle);
  for (let l = -v.spec.len / 2; l <= v.spec.len / 2; l += 0.5) for (let k = -v.spec.wid / 2; k <= v.spec.wid / 2; k += 0.5) { const [sx, sy] = toS(v.x + cos * l - sin * k, v.y + sin * l + cos * k); set(sx, sy, l > v.spec.len / 2 - 4 ? [255, 255, 255] : col); }
}
for (const q of w.peds) { const [sx, sy] = toS(q.x, q.y); const col = q.state === 'wait' ? [255, 160, 0] : q.state === 'flee' ? [255, 0, 255] : [0, 220, 255]; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) set(sx + a, sy + b, col); }
fs.writeFileSync(out, encodePNG(W, H, px));
console.log('voitures', w.vehicles.filter((v) => v.driver === 'npc').map((v) => `${v.type}#${v.id} v=${v.speed.toFixed(0)} blk=${(v.ai?.blocked ?? 0).toFixed(1)} gap=${(v.ai?.gap ?? 0).toFixed(0)} ph=${v.ai?.phase} hp=${v.hp.toFixed(0)}`).join('\n'));
