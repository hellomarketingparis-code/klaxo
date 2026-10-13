import { TILE } from '../engine/config';
import { clamp, approachAngle } from '../engine/math';
import type { CityMap } from '../map/CityMap';
import type { TilePt } from '../map/pathfinding';
import { lookKey } from './looks';
import type { Look, ProfileKey } from './looks';

export type PedState = 'walk' | 'idle' | 'wait' | 'chat' | 'look' | 'flee' | 'down' | 'static' | 'seek';
export type PedRole = 'civil' | 'cop' | 'guard' | 'npc';
let nextPedId = 100000;

/** Personnage à pied (habitant, policier, garde, personnage de mission). */
export class Ped {
  id = nextPedId++;
  angle = Math.PI / 2;
  vx = 0; vy = 0;
  state: PedState = 'idle';
  role: PedRole = 'civil';
  lookKey: string;
  path: TilePt[] | null = null;
  pi = 0;
  timer = 1;
  speed = 30;
  offX = 0; offY = 0;
  fleeX = 0; fleeY = 0;
  lookX = 0; lookY = 0;
  partner: Ped | null = null;
  chatIdx = 0; chatStep = 0;
  pendingPath = false;
  pathFails = 0;
  moving = false; running = false;
  animT = 0;
  tag = ''; name = '';
  remove = false;
  bubbleCd = 0;
  waitT = 0; checkT = 0;
  resume: PedState = 'walk';
  radius = 4;
  /** État libre pour la police, les gardes et les missions. */
  ai: any = null;
  /** Point d'attache des commerçants. */
  homeX = 0; homeY = 0;

  constructor(public x: number, public y: number, public profile: ProfileKey, public look: Look) {
    this.lookKey = lookKey(look);
  }
  get tx(): number { return Math.floor(this.x / TILE); }
  get ty(): number { return Math.floor(this.y / TILE); }

  face(x: number, y: number, dt = 1, rate = 12): void {
    this.angle = approachAngle(this.angle, Math.atan2(y - this.y, x - this.x), rate * dt);
  }
  stop(): void { this.vx = 0; this.vy = 0; this.moving = false; this.running = false; }

  /** Avance vers un point ; renvoie la distance restante. */
  moveToward(x: number, y: number, speed: number, dt: number, map: CityMap): number {
    const dx = x - this.x, dy = y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) { this.stop(); return d; }
    const s = Math.min(speed, d / dt);
    this.vx = (dx / d) * s; this.vy = (dy / d) * s;
    this.integrate(dt, map);
    this.angle = approachAngle(this.angle, Math.atan2(dy, dx), 10 * dt);
    this.moving = true; this.running = speed > 60;
    this.animT += dt * (speed / 22);
    return d;
  }
  moveDir(ax: number, ay: number, speed: number, dt: number, map: CityMap): void {
    const d = Math.hypot(ax, ay) || 1;
    this.vx = (ax / d) * speed; this.vy = (ay / d) * speed;
    this.integrate(dt, map);
    this.angle = approachAngle(this.angle, Math.atan2(ay, ax), 12 * dt);
    this.moving = true; this.running = speed > 60;
    this.animT += dt * (speed / 22);
  }
  integrate(dt: number, map: CityMap): void {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    collideCircleMap(this, this.radius, map);
  }
}

/** Collision d'un cercle avec les tuiles solides (piétons, joueur). Renvoie true en cas de contact. */
export function collideCircleMap(o: { x: number; y: number }, r: number, map: CityMap): boolean {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    const tx0 = Math.floor((o.x - r) / TILE), tx1 = Math.floor((o.x + r) / TILE);
    const ty0 = Math.floor((o.y - r) / TILE), ty1 = Math.floor((o.y + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (!map.solidAt(tx, ty)) continue;
      const nx = clamp(o.x, tx * TILE, (tx + 1) * TILE), ny = clamp(o.y, ty * TILE, (ty + 1) * TILE);
      let dx = o.x - nx, dy = o.y - ny;
      let d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d < 0.0001) { dx = o.x - (tx + 0.5) * TILE; dy = o.y - (ty + 0.5) * TILE; d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d; d = 0; } else { dx /= d; dy /= d; }
      o.x += dx * (r - d); o.y += dy * (r - d);
      hit = true;
    }
  }
  return hit;
}
