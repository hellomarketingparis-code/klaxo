import { CHUNK_PX, CHUNK_TILES, CHUNKS_X, MAP_W, MAP_H, TILE } from '../engine/config';
import { RNG, hash2 } from '../engine/rng';
import { drawText, textWidth } from '../assets/pixelfont';
import { NEON_LIST, NEON_RGB, shadeHex } from '../assets/palette';
import type { CityMap } from './CityMap';
import { T, D } from './tiles';
import type { Building, Prop } from './tiles';

/**
 * Peinture procédurale de la ville : chaque chunk (512×512 px) est dessiné une fois dans un canvas,
 * puis affiché comme une simple image. Sol, marquages, bâtiments, enseignes, halos des lampadaires :
 * tout est généré ici, sans aucun fichier image.
 */
export interface PaintOpts {
  glows: boolean;
  reflections: boolean;
  /** Intensité de l'éclairage par quartier. */
  lighting: number[];
  decor: { kind: string; district: number }[];
  billboard: string | null;
}
export const DEFAULT_PAINT: PaintOpts = { glows: true, reflections: true, lighting: [1, 1, 1, 1, 1], decor: [], billboard: null };

const ROOFS: Record<number, string[]> = {
  [D.DOWNTOWN]: ['#3b3558', '#473b5e', '#35405e', '#4b3a4f', '#2f3350', '#40385c'],
  [D.BUSINESS]: ['#2d3b5c', '#32466b', '#283350', '#3a4a70', '#2b4460'],
  [D.OLDTOWN]: ['#5a3a3f', '#63443c', '#4f3a4a', '#5c4a3a', '#553846', '#4a4038'],
  [D.INDUSTRIAL]: ['#3d3f48', '#474a52', '#35363f', '#4a443f', '#3a4248'],
  [D.HILLS]: ['#5e3d3a', '#4a4a5e', '#3f5350', '#66493a', '#523f55'],
};
const WALLS: Record<number, string[]> = {
  [D.DOWNTOWN]: ['#2a2440', '#2f2a48', '#262a44'],
  [D.BUSINESS]: ['#1c2a44', '#1f3050', '#18243c'],
  [D.OLDTOWN]: ['#3d3238', '#44363a', '#3a3040', '#40382f'],
  [D.INDUSTRIAL]: ['#2c2d36', '#30303a', '#2a2c30'],
  [D.HILLS]: ['#3a3540', '#40383c', '#35383f'],
};
const LIT = ['#ffd27a', '#ffc45c', '#9fe8ff', '#ffd27a', '#ff9ac8', '#c9b8ff', '#ffe6a8'];
const LAMP_RGB: Record<number, [number, number, number]> = {
  [D.DOWNTOWN]: [255, 205, 120], [D.BUSINESS]: [190, 228, 255], [D.OLDTOWN]: [255, 176, 92], [D.INDUSTRIAL]: [255, 150, 70], [D.HILLS]: [255, 214, 150],
};
const SIDEWALK: Record<number, [string, string]> = {
  [D.DOWNTOWN]: ['#454069', '#3a365c'], [D.BUSINESS]: ['#4a4a72', '#3e3e63'], [D.OLDTOWN]: ['#4a4258', '#3c3549'],
  [D.INDUSTRIAL]: ['#3f3d50', '#343243'], [D.HILLS]: ['#474462', '#3b3852'],
};
const CONTAINER = ['#8f3a30', '#2f5a8f', '#8f742f', '#3c7449', '#633c74', '#2f7474'];
const SLOGANS = ['KLAXO', 'WAZOU+', 'GLOU COLA', 'RADIO 13', 'MEGA PROMO', 'ZZZ MATELAS', 'PIZZA 24H', 'TAXI 3615'];

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: [number, number, number], a: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  g.addColorStop(0.45, `rgba(${c[0]},${c[1]},${c[2]},${a * 0.38})`);
  g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function paintGround(ctx: CanvasRenderingContext2D, m: CityMap, tx: number, ty: number): void {
  const k = m.kind[ty * MAP_W + tx];
  const d = m.district[ty * MAP_W + tx];
  const x = tx * TILE, y = ty * TILE;
  const h = hash2(tx, ty, 1), h2 = hash2(tx, ty, 2);
  const px = (c: string, ox: number, oy: number, w = 1, hh = 1) => { ctx.fillStyle = c; ctx.fillRect(x + ox, y + oy, w, hh); };
  const base = (c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, TILE, TILE); };
  const yardBase = () => { base(h < 0.3 ? '#353340' : '#32303c'); if (h2 < 0.12) px('#292732', (h * 97) % 11 | 0, (h2 * 89) % 11 | 0, 4, 3); };
  switch (k) {
    case T.ROAD: case T.CROSSWALK:
      base(h < 0.25 ? '#262340' : h > 0.82 ? '#221f37' : '#24213a');
      px('#2d2a47', (h * 53) % 15 | 0, (h2 * 71) % 15 | 0); px('#1f1c33', (h2 * 37) % 14 | 0, (h * 91) % 14 | 0, 2, 1);
      if (h2 < 0.012) { ctx.fillStyle = '#1a1830'; ctx.beginPath(); ctx.arc(x + 8, y + 8, 3.5, 0, 7); ctx.fill(); px('#39355a', 6, 5, 4, 1); px('#39355a', 6, 10, 4, 1); }
      break;
    case T.SIDEWALK: {
      const [c, j] = SIDEWALK[d];
      base(c);
      if (d === D.OLDTOWN) { for (let i = 0; i < 4; i++) px(j, ((h * 31 + i * 5) % 14) | 0, ((h2 * 47 + i * 4) % 14) | 0, 2, 1); px(j, 0, 15, 16, 1); }
      else { px(j, 15, 0, 1, 16); px(j, 0, 15, 16, 1); if (d === D.BUSINESS) px(j, 7, 0, 1, 16); }
      if (h < 0.08) px(shadeHex(c, 0.82), (h2 * 11) | 0, (h * 100) % 11 | 0, 3, 2);
      break;
    }
    case T.PLAZA:
      base('#4a4468');
      px('#524b72', 0, 0, 8, 8); px('#524b72', 8, 8, 8, 8);
      if (h < 0.06) px('#3f3a5a', (h2 * 12) | 0, (h * 150) % 12 | 0, 3, 2);
      break;
    case T.PARKING: base(h < 0.3 ? '#2c2944' : '#2a2742'); px('#34314f', (h * 53) % 15 | 0, (h2 * 71) % 15 | 0); break;
    case T.GRASS: case T.TREE: case T.GARDEN: {
      const g0 = k === T.GARDEN ? '#22463a' : '#1c3a31';
      base(h < 0.3 ? shadeHex(g0, 1.06) : h > 0.75 ? shadeHex(g0, 0.9) : g0);
      px('#2c5a48', (h * 61) % 14 | 0, (h2 * 43) % 13 | 0, 1, 2); px('#2c5a48', (h2 * 29) % 14 | 0, (h * 83) % 13 | 0, 1, 2);
      if (k === T.GARDEN && h2 > 0.93) { px('#ff8ac2', (h * 200) % 13 | 0, (h2 * 300) % 13 | 0, 2, 2); }
      if (k === T.TREE) { ctx.fillStyle = 'rgba(8,16,14,0.55)'; ctx.beginPath(); ctx.arc(x + 9, y + 9, 7, 0, 7); ctx.fill(); px('#3b2a22', 6, 6, 4, 4); }
      break;
    }
    case T.YARD: case T.FENCE: yardBase(); break;
    case T.PROP: if (tx >= 296) { base('#4b3c40'); } else if (d === D.INDUSTRIAL) yardBase(); else { base('#4a4468'); } break;
    case T.PATH: base('#584e55'); px('#6a5f66', (h * 53) % 14 | 0, (h2 * 71) % 14 | 0, 2, 1); px('#4a4148', (h2 * 37) % 14 | 0, (h * 91) % 14 | 0, 2, 2); break;
    case T.DOCK: base('#4b3c40'); px('#3b2f33', 0, 0, 16, 1); px('#3b2f33', 0, 8, 16, 1); px('#3b2f33', (h * 12) | 0, 1, 1, 7); px('#3b2f33', ((h2 * 12) | 0) + 2, 9, 1, 7); px('#5a494d', (h * 9) | 0, 3, 3, 1); break;
    case T.SAND: base(h < 0.4 ? '#6e6158' : '#695c54'); px('#7c6e63', (h * 53) % 15 | 0, (h2 * 71) % 15 | 0, 2, 1); px('#5d524b', (h2 * 37) % 14 | 0, (h * 91) % 14 | 0); break;
    case T.WATER: base(h < 0.5 ? '#14234c' : '#13214a'); if (h2 < 0.4) px('#1d3a7a', (h * 40) % 10 | 0, (h2 * 30) % 13 | 0, 5, 1); if (h2 > 0.9) px('#3c62b8', (h * 90) % 12 | 0, (h2 * 60) % 12 | 0, 3, 1); break;
    case T.FOREST: {
      base('#0f231d');
      ctx.fillStyle = h < 0.5 ? '#17332b' : '#143027';
      ctx.beginPath(); ctx.arc(x + 4 + h * 8, y + 4 + h2 * 8, 6 + h * 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#1d4034'; ctx.beginPath(); ctx.arc(x + 3 + h2 * 9, y + 3 + h * 9, 3, 0, 7); ctx.fill();
      break;
    }
    default: base('#1a1830');
  }
}

function paintCurbs(ctx: CanvasRenderingContext2D, m: CityMap, tx: number, ty: number): void {
  const k = m.kind[ty * MAP_W + tx];
  if (k !== T.SIDEWALK) return;
  const x = tx * TILE, y = ty * TILE;
  const road = (ax: number, ay: number) => m.isRoadKind(m.kindAt(ax, ay));
  const L = '#6f6a9c', S = '#14122a';
  if (road(tx, ty - 1)) { ctx.fillStyle = L; ctx.fillRect(x, y, 16, 2); ctx.fillStyle = S; ctx.fillRect(x, y - 1, 16, 1); }
  if (road(tx, ty + 1)) { ctx.fillStyle = L; ctx.fillRect(x, y + 14, 16, 2); ctx.fillStyle = S; ctx.fillRect(x, y + 16, 16, 1); }
  if (road(tx - 1, ty)) { ctx.fillStyle = L; ctx.fillRect(x, y, 2, 16); ctx.fillStyle = S; ctx.fillRect(x - 1, y, 1, 16); }
  if (road(tx + 1, ty)) { ctx.fillStyle = L; ctx.fillRect(x + 14, y, 2, 16); ctx.fillStyle = S; ctx.fillRect(x + 16, y, 1, 16); }
}

function paintMarkings(ctx: CanvasRenderingContext2D, m: CityMap, x0: number, y0: number, x1: number, y1: number): void {
  const line = '#6e6996', amber = '#8f7a45', white = '#a9a6cc';
  for (const e of m.edges) {
    const ex0 = e.x * TILE, ey0 = e.y * TILE, ex1 = (e.x + e.wT) * TILE, ey1 = (e.y + e.hT) * TILE;
    if (ex1 < x0 || ey1 < y0 || ex0 > x1 || ey0 > y1) continue;
    if (e.type === 'alley') continue;
    const a = m.nodes[e.a], b = m.nodes[e.b];
    // Les marquages s'arrêtent avant les passages piétons.
    const startPad = a.deg >= 3 ? 2 * TILE + 4 : 0, endPad = b.deg >= 3 ? 2 * TILE + 4 : 0;
    if (e.vertical) {
      const cx = (ex0 + ex1) / 2;
      const s = ey0 + startPad, t = ey1 - endPad;
      if (e.type === 'avenue') {
        ctx.fillStyle = amber; ctx.fillRect(cx - 2, s, 1, t - s); ctx.fillRect(cx + 1, s, 1, t - s);
        ctx.fillStyle = line; for (let y = s; y < t; y += 14) { ctx.fillRect(cx - 24, y, 1, 7); ctx.fillRect(cx + 23, y, 1, 7); }
      } else { ctx.fillStyle = line; for (let y = s; y < t; y += 12) ctx.fillRect(cx, y, 1, 6); }
      ctx.fillStyle = white;
      // Ligne d'arrêt côté voies entrantes : on roule à droite.
      if (a.deg >= 3) ctx.fillRect(cx + 1, ey0 + 2 * TILE + 2, e.wT * 8 - 1, 2);
      if (b.deg >= 3) ctx.fillRect(cx - e.wT * 8, ey1 - 2 * TILE - 4, e.wT * 8 - 1, 2);
    } else {
      const cy = (ey0 + ey1) / 2;
      const s = ex0 + startPad, t = ex1 - endPad;
      if (e.type === 'avenue') {
        ctx.fillStyle = amber; ctx.fillRect(s, cy - 2, t - s, 1); ctx.fillRect(s, cy + 1, t - s, 1);
        ctx.fillStyle = line; for (let x = s; x < t; x += 14) { ctx.fillRect(x, cy - 24, 7, 1); ctx.fillRect(x, cy + 23, 7, 1); }
      } else { ctx.fillStyle = line; for (let x = s; x < t; x += 12) ctx.fillRect(x, cy, 6, 1); }
      ctx.fillStyle = white;
      if (a.deg >= 3) ctx.fillRect(ex0 + 2 * TILE + 2, cy - e.hT * 8, 2, e.hT * 8 - 1);
      if (b.deg >= 3) ctx.fillRect(ex1 - 2 * TILE - 4, cy + 1, 2, e.hT * 8 - 1);
    }
  }
  // Passages piétons : bandes parallèles au sens de circulation.
  ctx.fillStyle = white;
  for (const n of m.nodes) {
    if (n.deg < 3) continue;
    const bx = n.bx * TILE, by = n.by * TILE, bw = n.bw * TILE, bh = n.bh * TILE;
    if (bx + bw + 40 < x0 || by + bh + 40 < y0 || bx - 40 > x1 || by - 40 > y1) continue;
    const vert = (px: number, py: number, w: number) => { for (let x = px + 2; x + 3 <= px + w - 1; x += 6) ctx.fillRect(x, py + 4, 3, 2 * TILE - 8); };
    const horiz = (px: number, py: number, h: number) => { for (let y = py + 2; y + 3 <= py + h - 1; y += 6) ctx.fillRect(px + 4, y, 2 * TILE - 8, 3); };
    if (n.arms[0] >= 0) vert(bx, by - 2 * TILE, bw);
    if (n.arms[2] >= 0) vert(bx, by + bh, bw);
    if (n.arms[3] >= 0) horiz(bx - 2 * TILE, by, bh);
    if (n.arms[1] >= 0) horiz(bx + bw, by, bh);
  }
}

function paintProp(ctx: CanvasRenderingContext2D, p: Prop): void {
  const x = p.x * TILE, y = p.y * TILE, w = p.w * TILE, h = p.h * TILE;
  const r = new RNG(p.seed + 11);
  if (p.kind === 'container') {
    const c = r.pick(CONTAINER);
    ctx.fillStyle = shadeHex(c, 0.55); ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = c; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.fillStyle = shadeHex(c, 0.78);
    if (w >= h) for (let i = x + 5; i < x + w - 3; i += 4) ctx.fillRect(i, y + 2, 1, h - 4);
    else for (let i = y + 5; i < y + h - 3; i += 4) ctx.fillRect(x + 2, i, w - 4, 1);
    ctx.fillStyle = shadeHex(c, 1.25); ctx.fillRect(x + 2, y + 2, w - 4, 1); ctx.fillRect(x + 2, y + 2, 1, h - 4);
    if (r.chance(0.5)) drawText(ctx, r.pick(['K13', 'FRET', 'XL', '404', 'OK', 'ZOU']), x + 5, y + (h >> 1) - 2, shadeHex(c, 1.5));
  } else if (p.kind === 'fountain') {
    const cx = x + w / 2, cy = y + h / 2;
    ctx.fillStyle = '#6a6788'; ctx.beginPath(); ctx.arc(cx, cy, w / 2 - 1, 0, 7); ctx.fill();
    ctx.fillStyle = '#23508f'; ctx.beginPath(); ctx.arc(cx, cy, w / 2 - 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#4f9be0'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#d8f4ff'; ctx.fillRect(cx - 1, cy - 1, 2, 2);
  } else if (p.kind === 'stall') {
    const a = r.pick(['#c2415c', '#3a8fb0', '#b08f3a', '#5a9a5a']);
    ctx.fillStyle = '#2a2233'; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    for (let i = 0; i < w - 2; i += 4) { ctx.fillStyle = (i / 4) % 2 ? a : '#e8e4f0'; ctx.fillRect(x + 1 + i, y + 2, 4, h - 6); }
    ctx.fillStyle = shadeHex(a, 0.6); ctx.fillRect(x + 1, y + h - 5, w - 2, 2);
  }
}

function paintFence(ctx: CanvasRenderingContext2D, m: CityMap, tx: number, ty: number): void {
  const x = tx * TILE, y = ty * TILE;
  const f = (ax: number, ay: number) => m.kindAt(ax, ay) === T.FENCE;
  const hor = f(tx - 1, ty) || f(tx + 1, ty), ver = f(tx, ty - 1) || f(tx, ty + 1);
  ctx.fillStyle = 'rgba(8,7,18,0.5)';
  if (hor) ctx.fillRect(x, y + 10, 16, 2);
  if (ver) ctx.fillRect(x + 10, y, 2, 16);
  if (hor) { ctx.fillStyle = '#8f8fae'; ctx.fillRect(x, y + 7, 16, 1); ctx.fillStyle = '#5c5c78'; for (let i = 0; i < 16; i += 2) ctx.fillRect(x + i, y + 8, 1, 1); }
  if (ver) { ctx.fillStyle = '#8f8fae'; ctx.fillRect(x + 7, y, 1, 16); ctx.fillStyle = '#5c5c78'; for (let i = 0; i < 16; i += 2) ctx.fillRect(x + 8, y + i, 1, 1); }
  ctx.fillStyle = '#c8c8e0';
  if ((hor && ver) || (tx + ty) % 2 === 0) ctx.fillRect(x + 6, y + 6, 3, 3);
}

interface SignInfo { x: number; y: number; w: number; color: number; bottom: number; }

function paintBuilding(ctx: CanvasRenderingContext2D, b: Building, opts: PaintOpts, signs: SignInfo[], glows: { x: number; y: number; r: number; c: [number, number, number]; a: number }[]): void {
  const r = new RNG(b.seed);
  const x0 = b.x * TILE, y0 = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
  const fh = b.facade * TILE, rh = h - fh;
  const base = r.pick(ROOFS[b.district]);
  const wall = r.pick(WALLS[b.district]);
  const light = shadeHex(base, 1.22), dark = shadeHex(base, 0.68);
  ctx.fillStyle = base; ctx.fillRect(x0, y0, w, rh);
  const rect = (c: string, x: number, y: number, ww: number, hh: number) => { ctx.fillStyle = c; ctx.fillRect(x, y, ww, hh); };

  if (b.kind === 'house') {
    const mid = y0 + (rh >> 1);
    rect(shadeHex(base, 1.14), x0, y0, w, rh >> 1);
    ctx.fillStyle = shadeHex(base, 0.86); for (let x = x0 + 3; x < x0 + w - 1; x += 4) ctx.fillRect(x, y0 + 1, 1, rh - 2);
    rect(shadeHex(base, 1.4), x0, mid - 1, w, 1); rect(dark, x0, mid, w, 1);
    const cx = x0 + 6 + r.int(0, Math.max(0, w - 16));
    rect('#2a2430', cx, y0 + 4, 5, 5); rect('#151320', cx + 1, y0 + 5, 3, 3);
    if (r.chance(0.3)) { rect('#1f3a6a', x0 + w - 16, mid + 3, 12, 7); rect('#3a62a8', x0 + w - 16, mid + 3, 12, 1); rect('#1a2f55', x0 + w - 10, mid + 3, 1, 7); }
  } else if (b.kind === 'warehouse') {
    ctx.fillStyle = shadeHex(base, 0.86); for (let x = x0 + 3; x < x0 + w - 1; x += 4) ctx.fillRect(x, y0 + 2, 1, rh - 4);
    for (let i = 0; i < Math.max(1, b.w >> 2); i++) {
      const sx = x0 + 8 + i * 60 + r.int(0, 8);
      if (sx + 22 > x0 + w - 6) break;
      const lit = r.chance(0.35);
      rect(lit ? '#9fe8ff' : '#2b4a66', sx, y0 + 6, 22, 5); rect(lit ? '#d8f6ff' : '#3a6282', sx, y0 + 6, 22, 1);
      if (lit) glows.push({ x: sx + 11, y: y0 + 8, r: 22, c: [159, 232, 255], a: 0.2 });
    }
    if (rh > 40 && w > 60) drawText(ctx, String(r.int(1, 99)), x0 + w - 26, y0 + rh - 18, shadeHex(base, 1.45), 2);
  } else {
    // Toit plat : acrotère, gravier, équipements.
    for (let i = 0; i < (w * rh) / 260; i++) rect(r.chance(0.5) ? shadeHex(base, 1.1) : shadeHex(base, 0.9), x0 + r.int(3, w - 5), y0 + r.int(3, Math.max(4, rh - 5)), 1, 1);
    if (b.kind === 'tower' && w >= 80 && rh >= 64) {
      rect(shadeHex(base, 1.12), x0 + 7, y0 + 7, w - 14, rh - 14);
      rect(shadeHex(base, 0.88), x0 + 14, y0 + 14, w - 28, rh - 28);
      rect(shadeHex(base, 1.3), x0 + 7, y0 + 7, w - 14, 1); rect(shadeHex(base, 1.3), x0 + 7, y0 + 7, 1, rh - 14);
      if (w >= 128 && rh >= 96 && r.chance(0.7)) {
        const cx = x0 + w / 2, cy = y0 + rh / 2;
        ctx.strokeStyle = '#c9b84a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, 13, 0, 7); ctx.stroke();
        drawText(ctx, 'H', cx - 3, cy - 5, '#e8e4f0', 2);
      }
      rect('#ff3b3b', x0 + w - 6, y0 + 4, 2, 2);
      glows.push({ x: x0 + w - 5, y: y0 + 5, r: 9, c: [255, 60, 60], a: 0.5 });
    }
    const units = Math.max(1, Math.round((w * rh) / 2600));
    for (let i = 0; i < units; i++) {
      const ux = x0 + r.int(4, Math.max(5, w - 14)), uy = y0 + r.int(4, Math.max(5, rh - 12));
      if (uy + 8 > y0 + rh - 2 || ux + 9 > x0 + w - 2) continue;
      const t = r.next();
      if (t < 0.45) { rect('#17152a', ux + 1, uy + 1, 8, 7); rect('#6a6888', ux, uy, 8, 7); rect('#4a4866', ux + 2, uy + 2, 4, 3); rect('#8a88a8', ux, uy, 8, 1); }
      else if (t < 0.7) {
        const lc = r.pick(LIT);
        const lit = r.chance(0.55);
        rect('#17152a', ux, uy, 9, 7); rect(lit ? lc : '#2a2a44', ux + 1, uy + 1, 7, 5); rect('#17152a', ux + 4, uy + 1, 1, 5);
        if (lit) glows.push({ x: ux + 4, y: uy + 3, r: 13, c: [255, 220, 150], a: 0.16 });
      } else if (t < 0.85 && b.district === D.OLDTOWN) {
        ctx.fillStyle = '#17152a'; ctx.beginPath(); ctx.arc(ux + 5, uy + 5, 5, 0, 7); ctx.fill();
        ctx.fillStyle = '#6b4a3a'; ctx.beginPath(); ctx.arc(ux + 4, uy + 4, 4.5, 0, 7); ctx.fill();
        rect('#8a6650', ux + 2, uy + 2, 3, 1);
      } else { rect('#2a2840', ux, uy + 3, 10, 1); rect('#55537a', ux, uy + 2, 10, 1); }
    }
    // Panneau publicitaire sur certains grands toits.
    if ((b.kind === 'block' || b.kind === 'tower') && w >= 96 && rh >= 48 && b.seed % 4 === 0) {
      const text = opts.billboard ?? SLOGANS[b.seed % SLOGANS.length];
      const tw = textWidth(text, 2);
      if (tw + 10 <= w - 12) {
        const bx = x0 + ((w - tw - 10) >> 1), by = y0 + 8;
        const ci = b.seed % NEON_LIST.length;
        rect('#0d0b1a', bx + 1, by + 1, tw + 10, 17); rect('#16132a', bx, by, tw + 10, 16);
        rect(NEON_LIST[ci], bx, by, tw + 10, 1); rect(NEON_LIST[ci], bx, by + 15, tw + 10, 1);
        drawText(ctx, text, bx + 5, by + 3, '#f5f5ff', 2);
        glows.push({ x: bx + tw / 2 + 5, y: by + 8, r: tw * 0.7 + 14, c: NEON_RGB[ci], a: 0.2 });
      }
    }
  }
  rect(light, x0, y0, w, 2); rect(light, x0, y0, 2, rh); rect(dark, x0 + w - 2, y0, 2, rh); rect(dark, x0, y0 + rh - 2, w, 2);

  // ----- Façade sud -----
  const fy = y0 + rh;
  rect(wall, x0, fy, w, fh);
  rect(shadeHex(wall, 0.6), x0, fy, w, 1);
  rect(shadeHex(wall, 1.25), x0, fy + 1, w, 1);
  const litProb = b.district === D.INDUSTRIAL ? 0.2 : b.district === D.BUSINESS ? 0.5 : 0.55;
  const doorX = b.doorX * TILE + 4;
  for (let row = 0; row < b.facade; row++) {
    const ry = fy + row * TILE;
    const groundRow = row === b.facade - 1;
    if (groundRow && b.sign) {
      // Vitrine éclairée.
      const lc = b.kind === 'warehouse' ? '#c9d6e8' : r.pick(['#ffd27a', '#ffe0a0', '#bfeeff']);
      for (let x = x0 + 3; x + 9 <= x0 + w - 3; x += 11) {
        if (x + 9 > doorX - 2 && x < doorX + 10) continue;
        rect('#141226', x, ry + 4, 9, 10); rect(lc, x + 1, ry + 5, 7, 8); rect(shadeHex(lc, 0.7), x + 1, ry + 10, 7, 3);
      }
    } else if (b.kind === 'tower') {
      for (let x = x0 + 3; x + 4 <= x0 + w - 3; x += 6) {
        const lit = r.chance(litProb);
        rect(lit ? r.pick(['#9fe8ff', '#ffd27a', '#bfeeff', '#9fe8ff']) : '#101c33', x, ry + 3, 4, 10);
        if (!lit) rect('#1c2e50', x, ry + 3, 4, 1);
      }
    } else {
      const step = b.kind === 'warehouse' ? 22 : 11;
      for (let x = x0 + 4; x + 6 <= x0 + w - 4; x += step) {
        if (groundRow && x + 6 > doorX - 2 && x < doorX + 10) continue;
        const lit = r.chance(litProb);
        rect('#141226', x, ry + 3, 7, 10); rect(lit ? r.pick(LIT) : '#1b1930', x + 1, ry + 4, 5, 8);
        if (lit) rect('#141226', x + 3, ry + 4, 1, 8); else rect('#27244a', x + 1, ry + 4, 5, 1);
        if (b.district === D.OLDTOWN && !groundRow) { rect(shadeHex(wall, 0.75), x - 1, ry + 13, 9, 1); }
      }
    }
    if (groundRow) {
      if (b.kind === 'warehouse' && !b.sign) { rect('#17161f', doorX - 6, ry + 3, 20, 13); ctx.fillStyle = '#3a3a48'; for (let yy = ry + 5; yy < ry + 16; yy += 3) ctx.fillRect(doorX - 5, yy, 18, 1); }
      else { rect('#0e0c1c', doorX - 1, ry + 4, 10, 12); rect('#2a2540', doorX, ry + 5, 8, 11); rect('#ffd27a', doorX + 6, ry + 10, 1, 1); rect('#ffe9b8', doorX + 3, ry + 2, 2, 1); }
    }
  }
  if (b.sign) {
    const scale = textWidth(b.sign.text, 2) + 8 <= w - 4 ? 2 : 1;
    const tw = textWidth(b.sign.text, scale);
    const bw = tw + 6, bh = 5 * scale + 4;
    let sx = doorX + 4 - (bw >> 1);
    sx = Math.max(x0 + 2, Math.min(x0 + w - bw - 2, sx));
    const sy = fy + (b.facade - 1) * TILE - bh + 3;
    const ci = b.sign.color % NEON_LIST.length;
    rect('#0b0a16', sx, sy, bw, bh);
    rect(NEON_LIST[ci], sx, sy, bw, 1); rect(NEON_LIST[ci], sx, sy + bh - 1, bw, 1); rect(NEON_LIST[ci], sx, sy, 1, bh); rect(NEON_LIST[ci], sx + bw - 1, sy, 1, bh);
    drawText(ctx, b.sign.text, sx + 3, sy + 2, '#fff6fb', scale);
    signs.push({ x: sx + bw / 2, y: sy + bh / 2, w: bw, color: ci, bottom: y0 + h });
    if (b.district === D.OLDTOWN && b.seed % 2 === 0) { for (let x = x0 + 2; x < x0 + w - 2; x += 4) rect(((x - x0) >> 2) % 2 ? NEON_LIST[ci] : '#e8e4f0', x, sy + bh, Math.min(4, x0 + w - 2 - x), 2); }
  }
  ctx.strokeStyle = '#0f0d1f'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
}

/** Dessine un chunk complet. Le contexte doit couvrir CHUNK_PX × CHUNK_PX. */
export function paintChunk(ctx: CanvasRenderingContext2D, m: CityMap, cx: number, cy: number, opts: PaintOpts = DEFAULT_PAINT): void {
  const ox = cx * CHUNK_PX, oy = cy * CHUNK_PX;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, CHUNK_PX, CHUNK_PX);
  ctx.translate(-ox, -oy);
  const tx0 = cx * CHUNK_TILES, ty0 = cy * CHUNK_TILES;
  const tx1 = Math.min(MAP_W, tx0 + CHUNK_TILES), ty1 = Math.min(MAP_H, ty0 + CHUNK_TILES);
  for (let ty = ty0; ty < ty1; ty++) for (let tx = tx0; tx < tx1; tx++) paintGround(ctx, m, tx, ty);
  paintMarkings(ctx, m, ox, oy, ox + CHUNK_PX, oy + CHUNK_PX);
  for (let ty = Math.max(0, ty0 - 1); ty < Math.min(MAP_H, ty1 + 1); ty++) for (let tx = Math.max(0, tx0 - 1); tx < Math.min(MAP_W, tx1 + 1); tx++) paintCurbs(ctx, m, tx, ty);

  const ci = cy * CHUNKS_X + cx;
  // Places de stationnement.
  ctx.fillStyle = '#6f6a96';
  for (const si of m.chunkSpots[ci]) {
    const s = m.spots[si];
    if (m.kindAtPx(s.x, s.y) !== T.PARKING) continue;
    const vertical = Math.abs(Math.sin(s.angle)) > 0.5;
    if (vertical) { ctx.fillRect(s.x - 10, s.y - 15, 1, 30); ctx.fillRect(s.x + 9, s.y - 15, 1, 30); }
    else { ctx.fillRect(s.x - 15, s.y - 10, 30, 1); ctx.fillRect(s.x - 15, s.y + 9, 30, 1); }
  }
  // Flaques : la chaussée mouillée accroche la lumière.
  if (opts.reflections) {
    for (let ty = ty0; ty < ty1; ty++) for (let tx = tx0; tx < tx1; tx++) {
      const k = m.kind[ty * MAP_W + tx];
      if (!m.isRoadKind(k) || hash2(tx, ty, 21) > 0.035) continue;
      const x = tx * TILE + 8, y = ty * TILE + 8;
      ctx.fillStyle = 'rgba(12,11,28,0.55)'; ctx.beginPath(); ctx.ellipse(x, y, 7, 3.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(120,118,180,0.35)'; ctx.fillRect(x - 4, y - 1, 5, 1);
    }
  }
  // Ombres portées.
  ctx.fillStyle = 'rgba(6,5,16,0.42)';
  for (const bi of m.chunkBuildings[ci]) {
    const b = m.buildings[bi];
    const s = 4 + b.facade * 2;
    ctx.fillRect(b.x * TILE + s, b.y * TILE + s, b.w * TILE, b.h * TILE);
  }
  for (const pi of m.chunkProps[ci]) { const p = m.props[pi]; ctx.fillRect(p.x * TILE + 3, p.y * TILE + 3, p.w * TILE, p.h * TILE); }
  for (const pi of m.chunkProps[ci]) paintProp(ctx, m.props[pi]);
  for (let ty = ty0; ty < ty1; ty++) for (let tx = tx0; tx < tx1; tx++) if (m.kind[ty * MAP_W + tx] === T.FENCE) paintFence(ctx, m, tx, ty);

  const signs: SignInfo[] = [];
  const glows: { x: number; y: number; r: number; c: [number, number, number]; a: number }[] = [];
  for (const bi of m.chunkBuildings[ci]) paintBuilding(ctx, m.buildings[bi], opts, signs, glows);

  // Lampadaires.
  for (const li of m.chunkLamps[ci]) {
    const l = m.lamps[li];
    ctx.fillStyle = 'rgba(6,5,16,0.5)'; ctx.fillRect(l.x - 1, l.y, 4, 3);
    ctx.fillStyle = '#b9b6d6'; ctx.fillRect(l.x - 1, l.y - 1, 2, 2);
    ctx.fillStyle = '#fff3d0'; ctx.fillRect(l.x - 1, l.y - 1, 1, 1);
  }
  // Décorations temporaires (changements hebdomadaires).
  for (const dec of opts.decor) paintDecor(ctx, m, dec, ox, oy);

  // ----- Lumière : tout ce qui suit est additif -----
  ctx.globalCompositeOperation = 'lighter';
  for (const li of m.chunkLamps[ci]) {
    const l = m.lamps[li];
    const d = m.districtAtPx(l.x, l.y);
    const f = opts.lighting[d] ?? 1;
    if (f <= 0.05) continue;
    glow(ctx, l.x, l.y, opts.glows ? 54 : 30, LAMP_RGB[d], (opts.glows ? 0.44 : 0.28) * f);
  }
  if (opts.glows) {
    for (const g of glows) glow(ctx, g.x, g.y, g.r, g.c, g.a);
    for (const s of signs) {
      const d = m.districtAtPx(s.x, s.y);
      const f = Math.max(0.35, opts.lighting[d] ?? 1);
      glow(ctx, s.x, s.y, s.w * 0.6 + 20, NEON_RGB[s.color], 0.34 * f);
      if (opts.reflections) {
        // Reflet de l'enseigne sur le trottoir et la chaussée : une tache étirée vers le bas.
        const c = NEON_RGB[s.color];
        ctx.save();
        ctx.translate(s.x, s.bottom + 4);
        ctx.scale(1, 2.1);
        glow(ctx, 0, 0, s.w * 0.5 + 12, c, 0.3 * f);
        ctx.restore();
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

function paintDecor(ctx: CanvasRenderingContext2D, m: CityMap, dec: { kind: string; district: number }, ox: number, oy: number): void {
  for (const e of m.edges) {
    if (e.type === 'alley') continue;
    const ex0 = e.x * TILE, ey0 = e.y * TILE, ex1 = (e.x + e.wT) * TILE, ey1 = (e.y + e.hT) * TILE;
    if (ex1 < ox - 20 || ey1 < oy - 20 || ex0 > ox + CHUNK_PX + 20 || ey0 > oy + CHUNK_PX + 20) continue;
    if (m.districtAtPx((ex0 + ex1) / 2, (ey0 + ey1) / 2) !== dec.district) continue;
    const span = e.w * TILE + 8;
    const item = (x: number, y: number, i: number) => {
      const c = NEON_LIST[i % NEON_LIST.length];
      if (dec.kind === 'garlands') { ctx.fillStyle = c; ctx.fillRect(x, y, 2, 2); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(x, y, 1, 1); }
      else if (dec.kind === 'banners') { ctx.fillStyle = c; ctx.fillRect(x, y, 3, 2); ctx.fillRect(x + 1, y + 2, 1, 2); }
      else { ctx.fillStyle = c; ctx.fillRect(x, y, 4, 3); ctx.fillStyle = '#f5f5ff'; ctx.fillRect(x + 1, y + 1, 2, 1); }
    };
    if (e.vertical) {
      for (let y = ey0 + 28, k = 0; y < ey1 - 20; y += 44, k++) {
        ctx.fillStyle = 'rgba(20,18,40,0.8)'; ctx.fillRect(ex0 - 4, y, span, 1);
        for (let x = ex0 - 2, i = 0; x < ex0 - 4 + span; x += 6, i++) item(x, y + (i % 2), i + k);
      }
    } else {
      for (let x = ex0 + 28, k = 0; x < ex1 - 20; x += 44, k++) {
        ctx.fillStyle = 'rgba(20,18,40,0.8)'; ctx.fillRect(x, ey0 - 4, 1, span);
        for (let y = ey0 - 2, i = 0; y < ey0 - 4 + span; y += 6, i++) item(x + (i % 2), y, i + k);
      }
    }
  }
}

/** Couleurs de la carte et de la mini-carte (1 pixel par tuile). */
export const MAP_COLORS: Record<number, [number, number, number]> = {
  [T.GRASS]: [28, 62, 52], [T.ROAD]: [70, 66, 108], [T.SIDEWALK]: [44, 41, 70], [T.CROSSWALK]: [92, 88, 136], [T.BUILDING]: [22, 20, 40],
  [T.WATER]: [20, 40, 96], [T.PLAZA]: [50, 46, 76], [T.PARKING]: [56, 53, 86], [T.YARD]: [42, 40, 54], [T.PATH]: [66, 58, 66],
  [T.FENCE]: [80, 80, 100], [T.DOCK]: [70, 56, 60], [T.TREE]: [24, 78, 56], [T.FOREST]: [14, 36, 30], [T.GARDEN]: [30, 72, 58], [T.SAND]: [104, 92, 84], [T.PROP]: [60, 52, 60],
};
const BUILDING_TINT: Record<number, [number, number, number]> = {
  [D.DOWNTOWN]: [60, 50, 96], [D.BUSINESS]: [40, 62, 104], [D.OLDTOWN]: [96, 60, 66], [D.INDUSTRIAL]: [64, 66, 78], [D.HILLS]: [92, 66, 70],
};
export function paintMinimap(m: CityMap): ImageData {
  const img = new ImageData(MAP_W, MAP_H);
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const k = m.kind[i];
    const c = k === T.BUILDING ? BUILDING_TINT[m.district[i]] : MAP_COLORS[k] ?? [255, 0, 255];
    img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
  }
  return img;
}
