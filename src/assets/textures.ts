import { VEHICLES } from '../vehicles/specs';
import type { VehicleType } from '../vehicles/specs';
import type { Look } from '../npc/looks';
import { hex, shade } from './palette';
import { drawText } from './pixelfont';

/**
 * Tous les sprites du jeu sont dessinés ici, pixel par pixel, au lancement.
 * Les fonctions ne dépendent que d'un contexte Canvas 2D : elles servent au jeu et à l'interface.
 */
export const PED_FRAME = 16;
export const PED_FRAMES = 6; // 0 immobile, 1-4 marche, 5 à terre
export const CAR_PAD = 3;

type Ctx = CanvasRenderingContext2D;
const px = (ctx: Ctx, c: string, x: number, y: number, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

/** Ajoute un contour sombre d'un pixel autour de tout ce qui est dessiné dans la zone. */
export function outline(ctx: Ctx, x: number, y: number, w: number, h: number, color: [number, number, number] = [13, 11, 24]): void {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] > 40 ? 1 : 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (solid[k]) continue;
    if ((i > 0 && solid[k - 1]) || (i < w - 1 && solid[k + 1]) || (j > 0 && solid[k - w]) || (j < h - 1 && solid[k + w])) {
      d[k * 4] = color[0]; d[k * 4 + 1] = color[1]; d[k * 4 + 2] = color[2]; d[k * 4 + 3] = 235;
    }
  }
  ctx.putImageData(img, x, y);
}

export function carSize(type: VehicleType): { w: number; h: number } {
  const s = VEHICLES[type];
  return { w: s.len + CAR_PAD * 2, h: s.wid + CAR_PAD * 2 };
}

/** Véhicule vu du dessus, orienté vers la droite. */
export function drawVehicle(ctx: Ctx, type: VehicleType, color: number, damaged = false, ox = 0, oy = 0): void {
  const s = VEHICLES[type];
  const L = s.len, W = s.wid;
  const x = ox + CAR_PAD, y = oy + CAR_PAD;
  const body = shade(color, 0.95), hi = shade(color, 1.35), lo = shade(color, 0.62), roof = shade(color, 1.12);
  const glass = '#131b2e', glint = '#6c8fc8';
  // Pneus.
  for (const wx of [x + 3, x + L - 8]) { px(ctx, '#0b0a14', wx, y - 1, 5, 1); px(ctx, '#0b0a14', wx, y + W, 5, 1); }
  // Carrosserie aux coins arrondis.
  px(ctx, body, x + 1, y, L - 2, W); px(ctx, body, x, y + 1, L, W - 2);
  px(ctx, hi, x + 2, y, L - 5, 1); px(ctx, lo, x + 2, y + W - 1, L - 5, 1);
  px(ctx, lo, x, y + 2, 1, W - 4);
  if (type === 'truck') {
    const cab = 11;
    const box = color === 0xd8b23a ? '#b8b4c8' : '#9a98b0';
    px(ctx, box, x, y, L - cab - 1, W); px(ctx, shade(0x9a98b0, 1.25), x, y, L - cab - 1, 1); px(ctx, '#6f6d86', x, y + W - 1, L - cab - 1, 1);
    for (let i = x + 4; i < x + L - cab - 2; i += 5) px(ctx, '#7f7d98', i, y + 1, 1, W - 2);
    px(ctx, '#17152a', x + L - cab - 1, y + 1, 1, W - 2);
    px(ctx, roof, x + L - cab + 1, y + 2, 5, W - 4);
    px(ctx, glass, x + L - 5, y + 2, 3, W - 4); px(ctx, glint, x + L - 5, y + 3, 1, 2);
  } else if (type === 'van') {
    px(ctx, roof, x + 2, y + 2, L - 12, W - 4);
    px(ctx, shade(color, 0.8), x + 9, y + 2, 1, W - 4); px(ctx, shade(color, 0.8), x + 16, y + 2, 1, W - 4);
    px(ctx, glass, x + L - 9, y + 2, 4, W - 4); px(ctx, glint, x + L - 8, y + 3, 1, 2);
    px(ctx, glass, x + L - 12, y + 1, 5, 1); px(ctx, glass, x + L - 12, y + W - 2, 5, 1);
  } else {
    const sport = type === 'sport';
    const ws = x + Math.round(L * (sport ? 0.56 : 0.6)), rw = x + Math.round(L * (sport ? 0.22 : 0.18));
    px(ctx, roof, rw + 3, y + 2, ws - rw - 3, W - 4);
    px(ctx, glass, ws, y + 2, sport ? 5 : 4, W - 4); px(ctx, glint, ws + 1, y + 3, 1, 2);
    px(ctx, glass, rw, y + 2, 3, W - 4);
    px(ctx, glass, rw + 3, y + 1, ws - rw - 3, 1); px(ctx, glass, rw + 3, y + W - 2, ws - rw - 3, 1);
    if (sport) { px(ctx, '#f5f5ff', x + 1, y + (W >> 1) - 1, L - 2, 2); px(ctx, glass, ws, y + 2, 5, W - 4); px(ctx, glint, ws + 1, y + 3, 1, 2); px(ctx, glass, rw, y + 2, 3, W - 4); px(ctx, '#17152a', x, y + 1, 2, W - 2); }
    if (type === 'taxi') {
      for (let i = x + 3; i < x + L - 3; i += 2) { px(ctx, '#17152a', i, y + 1, 1, 1); px(ctx, '#17152a', i + 1, y + W - 2, 1, 1); }
      px(ctx, '#17152a', rw + 5, y + (W >> 1) - 3, 4, 6); px(ctx, '#fff6c4', rw + 6, y + (W >> 1) - 2, 2, 4);
    }
    if (type === 'police') {
      px(ctx, '#22306e', x + L - 8, y + 1, 6, W - 2); px(ctx, '#22306e', x + 1, y + 1, 4, W - 2);
      px(ctx, '#22306e', rw + 3, y, ws - rw - 3, 1); px(ctx, '#22306e', rw + 3, y + W - 1, ws - rw - 3, 1);
      const bx = rw + 3 + ((ws - rw - 3) >> 1) - 1;
      px(ctx, '#17152a', bx - 1, y + 2, 4, W - 4);
      px(ctx, '#ff3b3b', bx, y + 2, 2, (W - 4) >> 1); px(ctx, '#3b6bff', bx, y + 2 + ((W - 4) >> 1), 2, (W - 4) >> 1);
    }
  }
  // Phares et feux arrière.
  px(ctx, damaged ? '#55506a' : '#fff3b0', x + L - 1, y + 2, 1, 2); px(ctx, '#fff3b0', x + L - 1, y + W - 4, 1, 2);
  px(ctx, '#ff3b3b', x, y + 2, 1, 2); px(ctx, '#ff3b3b', x, y + W - 4, 1, 2);
  if (damaged) {
    px(ctx, '#1a1626', x + L - 4, y, 3, 2); px(ctx, '#1a1626', x + L - 6, y + 1, 2, 1); px(ctx, '#1a1626', x + 2, y + W - 2, 4, 2);
    px(ctx, '#8fa6cc', x + Math.round(L * 0.6) + 1, y + 4, 2, 1); px(ctx, '#8fa6cc', x + Math.round(L * 0.6) + 2, y + 5, 1, 2);
    px(ctx, '#2a2433', x + (L >> 1), y, 4, 1); px(ctx, '#2a2433', x + 5, y + 3, 2, 2);
  }
  const sz = carSize(type);
  outline(ctx, ox, oy, sz.w, sz.h);
}

/** Une image de personnage vu du dessus, tourné vers la droite. */
export function drawPedFrame(ctx: Ctx, ox: number, oy: number, look: Look, frame: number): void {
  const p = (c: string, x: number, y: number, w = 1, h = 1) => px(ctx, c, ox + x, oy + y, w, h);
  const skin = hex(look.skin), hair = hex(look.hair), top = hex(look.top), topLo = shade(look.top, 0.7), topHi = shade(look.top, 1.25);
  const shoe = shade(look.bottom, 0.75), acc = hex(look.accColor);
  if (frame === 5) {
    // À terre : étalé de tout son long.
    p(shoe, 1, 6, 3, 2); p(shoe, 1, 9, 3, 2);
    p(top, 4, 5, 7, 7); p(topLo, 4, 11, 7, 1);
    p(skin, 5, 3, 2, 2); p(skin, 8, 12, 2, 2);
    p(skin, 11, 6, 4, 5); p(hair, 11, 6, 2, 5);
    return;
  }
  const ph = frame === 0 ? 0 : frame;
  const f = [0, 3, 0, -3, 0][ph] ?? 0;
  const walking = frame !== 0;
  // Pieds.
  p(shoe, 7 + (walking ? f : 2), 5, 3, 2);
  p(shoe, 7 - (walking ? f : -2), 9, 3, 2);
  if (look.acc === 3) { p(acc, 3, 5, 3, 6); p(shade(look.accColor, 0.7), 3, 10, 3, 1); }
  // Épaules et bras.
  if (look.robot) {
    p('#8f9bb5', 5, 3, 6, 10); p('#6f7b95', 5, 12, 6, 1); p('#b8c4d8', 5, 3, 6, 1);
    p('#5a6680', 7 - Math.sign(f), 2, 2, 1); p('#5a6680', 7 + Math.sign(f), 13, 2, 1);
    p('#b8c4d8', 6, 5, 5, 6); p('#dfe8f5', 6, 5, 5, 1); p('#22e0ff', 10, 7, 1, 2); p('#22e0ff', 5, 8, 1, 1); p('#ff2e88', 7, 6, 1, 1);
    return;
  }
  p(top, 6, 3, 4, 10); p(top, 5, 4, 6, 8); p(topLo, 5, 4, 1, 8); p(topHi, 9, 4, 1, 3);
  const ha = walking ? -Math.sign(f) * 2 : 0;
  p(skin, 8 + ha, 2, 2, 2); p(skin, 8 - ha, 12, 2, 2);
  // Tête.
  p(skin, 7, 5, 4, 6); p(skin, 6, 6, 6, 4);
  switch (look.hairStyle) {
    case 1: p(hair, 6, 5, 4, 6); p(hair, 5, 6, 2, 4); p(hair, 4, 7, 2, 2); break;
    case 2: p(shade(look.skin, 1.15), 7, 7, 2, 2); break;
    case 3: p(hair, 6, 7, 5, 2); p(shade(look.hair, 1.3), 7, 7, 3, 1); break;
    case 4: p(hair, 6, 5, 3, 6); p(hair, 6, 6, 4, 4); p(hair, 4, 7, 2, 2); break;
    default: p(hair, 7, 5, 3, 6); p(hair, 6, 6, 3, 4);
  }
  switch (look.acc) {
    case 1: p(acc, 7, 5, 3, 6); p(acc, 6, 6, 5, 4); p(shade(look.accColor, 0.7), 11, 6, 2, 4); break;
    case 2: p(acc, 6, 4, 6, 8); p(acc, 5, 5, 8, 6); p(shade(look.accColor, 0.75), 7, 6, 4, 4); break;
    case 4: p('#111018', 10, 6, 1, 4); break;
    case 5: p(acc, 7, 4, 3, 1); p(acc, 7, 11, 3, 1); p(shade(look.accColor, 0.7), 8, 5, 1, 6); break;
    case 6: p('#16204a', 7, 5, 3, 6); p('#16204a', 6, 6, 5, 4); p('#0e1430', 11, 6, 1, 4); p('#ffd84a', 10, 7, 1, 2); break;
    default: break;
  }
}
export function drawPedSheet(ctx: Ctx, look: Look): void {
  for (let f = 0; f < PED_FRAMES; f++) {
    drawPedFrame(ctx, f * PED_FRAME, 0, look, f);
    outline(ctx, f * PED_FRAME, 0, PED_FRAME, PED_FRAME);
  }
}

export function drawTree(ctx: Ctx, variant: number, size: number): void {
  const c = size / 2;
  const blobs: [number, number, number, string][] = variant === 3
    ? [[c, c, c - 2, '#16382e'], [c - 1, c - 1, c - 4, '#1f4d3c'], [c - 2, c - 2, c - 6, '#2b6a50']]
    : variant === 0
      ? [[c, c + 1, c - 2, '#12302a'], [c - 2, c - 1, c - 5, '#1b4638'], [c + 3, c + 2, c - 7, '#1b4638'], [c - 3, c - 3, c - 8, '#297052']]
      : variant === 1
        ? [[c, c, c - 2, '#132c2c'], [c + 1, c - 2, c - 5, '#1c4240'], [c - 3, c + 2, c - 7, '#1c4240'], [c - 1, c - 3, c - 9, '#2c6e68']]
        : [[c, c, c - 3, '#18321f'], [c - 1, c - 1, c - 6, '#234a2a'], [c + 2, c + 3, c - 8, '#234a2a'], [c - 3, c - 3, c - 9, '#3a7a3c']];
  for (const [x, y, r, col] of blobs) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, r), 0, 7); ctx.fill(); }
  // Quelques feuilles accrochent la lumière.
  const tips = variant === 3 ? '#49a07a' : '#3f9068';
  for (let i = 0; i < size / 3; i++) {
    const a = i * 2.4, rr = (c - 5) * ((i * 37) % 10) / 10;
    px(ctx, tips, Math.round(c - 2 + Math.cos(a) * rr), Math.round(c - 2 + Math.sin(a) * rr));
  }
  outline(ctx, 0, 0, size, size, [8, 16, 14]);
}

export function drawGlow(ctx: Ctx, size: number): void {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
}
/** Faisceau de phare : sommet à gauche, s'ouvre vers la droite. */
export function drawBeam(ctx: Ctx, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, h / 2 - 2); ctx.lineTo(w, 0); ctx.lineTo(w, h); ctx.lineTo(0, h / 2 + 2); ctx.closePath(); ctx.fill();
}

export type IconName = 'excl' | 'star' | 'box' | 'neon' | 'item' | 'talk' | 'news';
export function drawIcon(ctx: Ctx, name: IconName, ox = 0, oy = 0): void {
  const p = (c: string, x: number, y: number, w = 1, h = 1) => px(ctx, c, ox + x, oy + y, w, h);
  switch (name) {
    case 'excl': p('#ffd84a', 4, 1, 3, 6); p('#fff3b0', 4, 1, 1, 6); p('#ffd84a', 4, 8, 3, 2); break;
    case 'talk': p('#ff2e88', 1, 1, 9, 6); p('#ff2e88', 3, 7, 3, 2); p('#fff', 3, 3, 1, 2); p('#fff', 5, 3, 1, 2); p('#fff', 7, 3, 1, 2); break;
    case 'news': p('#22e0ff', 1, 1, 9, 8); p('#0b1a2a', 2, 2, 7, 2); p('#0b1a2a', 2, 5, 3, 3); p('#0b1a2a', 6, 5, 3, 1); p('#0b1a2a', 6, 7, 3, 1); break;
    case 'star': p('#ffd84a', 5, 1, 1, 9); p('#ffd84a', 1, 4, 9, 2); p('#ffd84a', 3, 3, 5, 5); p('#fff8d0', 4, 4, 2, 2); p('#ffd84a', 2, 8, 2, 2); p('#ffd84a', 7, 8, 2, 2); break;
    case 'box': p('#8a5a3a', 1, 2, 9, 8); p('#b07a4f', 1, 2, 9, 2); p('#e8d8b0', 5, 2, 1, 8); p('#e8d8b0', 1, 5, 9, 1); p('#6a4329', 1, 9, 9, 1); break;
    case 'neon': p('#3a0f24', 0, 2, 11, 7); p('#ff2e88', 1, 3, 9, 5); p('#ffd0e6', 2, 4, 7, 1); p('#ff7ab8', 2, 6, 5, 1); break;
    case 'item': p('#22e0ff', 5, 1, 1, 9); p('#22e0ff', 3, 3, 5, 5); p('#22e0ff', 1, 5, 9, 1); p('#d8f8ff', 4, 4, 2, 2); break;
  }
  outline(ctx, ox, oy, 11, 11);
}

export function drawTrafficLight(ctx: Ctx, state: 'r' | 'y' | 'g' | 'off', ox = 0, oy = 0): void {
  px(ctx, '#0d0b18', ox, oy, 5, 11); px(ctx, '#2a2840', ox + 1, oy + 1, 3, 9);
  px(ctx, state === 'r' ? '#ff3b3b' : '#4a1a22', ox + 1, oy + 1, 3, 3);
  px(ctx, state === 'y' ? '#ffc21a' : '#4a3a14', ox + 1, oy + 4, 3, 3);
  px(ctx, state === 'g' ? '#3bff7a' : '#14402a', ox + 1, oy + 7, 3, 3);
}

/** Buste vu de face (16×16) : sert de portrait dans les dialogues et à la création du personnage. */
export function drawBust(ctx: Ctx, look: Look, ox = 0, oy = 0): void {
  const p = (c: string, x: number, y: number, w = 1, h = 1) => px(ctx, c, ox + x, oy + y, w, h);
  const skin = hex(look.skin), skinLo = shade(look.skin, 0.8), hair = hex(look.hair), top = hex(look.top), topLo = shade(look.top, 0.7), acc = hex(look.accColor);
  if (look.robot) {
    p('#5a6680', 7, 0, 2, 3); p('#22e0ff', 7, 0, 2, 1);
    p('#b8c4d8', 4, 3, 8, 7); p('#dfe8f5', 4, 3, 8, 1); p('#8f9bb5', 4, 9, 8, 1);
    p('#0b1a2a', 5, 5, 2, 2); p('#0b1a2a', 9, 5, 2, 2); p('#22e0ff', 5, 5, 1, 1); p('#22e0ff', 9, 5, 1, 1);
    p('#5a6680', 6, 8, 4, 1);
    p('#6f7b95', 7, 10, 2, 2); p('#8f9bb5', 2, 12, 12, 4); p('#b8c4d8', 2, 12, 12, 1); p('#ff2e88', 4, 14, 1, 1);
    return;
  }
  // Épaules et cou.
  p(top, 2, 12, 12, 4); p(top, 3, 11, 10, 1); p(topLo, 2, 15, 12, 1); p(shade(look.top, 1.2), 3, 11, 10, 1);
  p(skinLo, 7, 10, 2, 2);
  if (look.acc === 3) { p(acc, 4, 11, 1, 5); p(acc, 11, 11, 1, 5); }
  // Visage.
  p(skin, 5, 3, 6, 7); p(skin, 4, 4, 8, 5);
  p('#1a1420', 6, 6, 1, 1); p('#1a1420', 9, 6, 1, 1); p(skinLo, 7, 8, 2, 1); p(skinLo, 4, 6, 1, 1); p(skinLo, 11, 6, 1, 1);
  switch (look.hairStyle) {
    case 1: p(hair, 4, 2, 8, 2); p(hair, 3, 3, 2, 8); p(hair, 11, 3, 2, 8); p(hair, 5, 4, 1, 1); p(hair, 10, 4, 1, 1); break;
    case 2: p(shade(look.skin, 1.15), 6, 3, 2, 1); break;
    case 3: p(hair, 7, 0, 2, 4); p(shade(look.hair, 1.3), 7, 0, 1, 3); break;
    case 4: p(hair, 6, 0, 4, 2); p(hair, 4, 2, 8, 2); p(hair, 4, 4, 1, 2); p(hair, 11, 4, 1, 2); break;
    default: p(hair, 4, 2, 8, 2); p(hair, 5, 1, 6, 1); p(hair, 4, 4, 1, 1); p(hair, 11, 4, 1, 1);
  }
  switch (look.acc) {
    case 1: p(acc, 4, 1, 8, 3); p(shade(look.accColor, 0.7), 3, 4, 10, 1); break;
    case 2: p(acc, 5, 0, 6, 3); p(shade(look.accColor, 0.75), 2, 3, 12, 1); break;
    case 4: p('#111018', 5, 6, 3, 1); p('#111018', 8, 6, 3, 1); p('#7fd8ff', 6, 6, 1, 1); p('#7fd8ff', 9, 6, 1, 1); break;
    case 5: p(acc, 4, 1, 8, 1); p(acc, 3, 2, 1, 3); p(acc, 12, 2, 1, 3); p(shade(look.accColor, 0.7), 3, 5, 1, 3); p(shade(look.accColor, 0.7), 12, 5, 1, 3); break;
    case 6: p('#16204a', 4, 0, 8, 3); p('#ffd84a', 7, 1, 2, 1); p('#0e1430', 3, 3, 10, 1); break;
    default: break;
  }
}

/** Portrait agrandi d'un personnage (création de personnage, dialogues). */
export function drawPortrait(canvas: HTMLCanvasElement, look: Look, scale = 6, frame = 0): void {
  const tmp = document.createElement('canvas');
  tmp.width = PED_FRAME + 2; tmp.height = PED_FRAME + 2;
  const t = tmp.getContext('2d')!;
  drawBust(t, look, 1, 1);
  outline(t, 0, 0, PED_FRAME + 2, PED_FRAME + 2);
  canvas.width = (PED_FRAME + 2) * scale; canvas.height = (PED_FRAME + 2) * scale;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  void frame;
}
/** Le personnage tel qu'il apparaît en jeu (vu du dessus), animé : pour l'aperçu de création. */
export function drawTopDown(canvas: HTMLCanvasElement, look: Look, scale = 4, frame = 0): void {
  const tmp = document.createElement('canvas');
  tmp.width = PED_FRAME; tmp.height = PED_FRAME;
  const t = tmp.getContext('2d')!;
  drawPedFrame(t, 0, 0, look, frame);
  outline(t, 0, 0, PED_FRAME, PED_FRAME);
  canvas.width = PED_FRAME * scale; canvas.height = PED_FRAME * scale;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.save(); c.translate(canvas.width / 2, canvas.height / 2); c.rotate(Math.PI / 2);
  c.drawImage(tmp, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
  c.restore();
}
export function drawCarIcon(canvas: HTMLCanvasElement, type: VehicleType, color: number, scale = 3): void {
  const sz = carSize(type);
  const tmp = document.createElement('canvas');
  tmp.width = sz.w; tmp.height = sz.h;
  drawVehicle(tmp.getContext('2d')!, type, color);
  canvas.width = sz.w * scale; canvas.height = sz.h * scale;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.drawImage(tmp, 0, 0, canvas.width, canvas.height);
}
export { drawText };
