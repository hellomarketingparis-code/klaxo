import { TILE } from '../engine/config';
import { clamp } from '../engine/math';
import type { CityMap } from '../map/CityMap';
import { VEHICLES } from './specs';
import type { VehicleSpec, VehicleType } from './specs';

export type DriverKind = 'none' | 'player' | 'npc' | 'police';
let nextId = 1;
export function resetVehicleIds(): void { nextId = 1; }

export interface Impact { x: number; y: number; force: number; }

/** Véhicule avec physique arcade : vitesse longitudinale + glisse latérale amortie. */
export class Vehicle {
  id = nextId++;
  spec: VehicleSpec;
  x = 0; y = 0; angle = 0;
  vx = 0; vy = 0;
  throttle = 0; steer = 0; handbrake = false;
  hp: number;
  color: number;
  driver: DriverKind = 'none';
  /** État libre pour le système qui pilote le véhicule (circulation, police, mission). */
  ai: any = null;
  braking = false;
  honk = 0;
  siren = false;
  owned = false;
  tag = '';
  /** Place de stationnement d'origine (-1 si aucune). */
  spot = -1;
  /** Cumul de chocs subis pendant la frame (pour sons et dégâts). */
  impact = 0;
  stuckTime = 0;
  remove = false;
  /** Temps écoulé hors de la zone active (pour le nettoyage). */
  farTime = 0;
  smoke = 0;

  constructor(public type: VehicleType, x: number, y: number, angle: number, color?: number) {
    this.spec = VEHICLES[type];
    this.x = x; this.y = y; this.angle = angle;
    this.hp = this.spec.hp;
    this.color = color ?? this.spec.colors[0];
  }
  get dead(): boolean { return this.hp <= 0; }
  get speed(): number { return Math.hypot(this.vx, this.vy); }
  /** Vitesse le long de l'axe du véhicule (négative en marche arrière). */
  get forwardSpeed(): number { return this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle); }
  get radius(): number { return this.spec.wid / 2; }
  /** Décalages des cercles de collision le long de l'axe. */
  circleOffsets(): number[] {
    const r = this.spec.wid / 2, h = this.spec.len / 2 - r;
    return this.spec.len > 36 ? [-h, -h / 3, h / 3, h] : [-h, 0, h];
  }
  damage(amount: number): void {
    if (amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
  }

  step(dt: number, map: CityMap): Impact | null {
    const s = this.spec;
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    let vf = this.vx * cos + this.vy * sin;
    let vl = -this.vx * sin + this.vy * cos;
    const power = this.dead ? 0 : this.hp < s.hp * 0.3 ? 0.7 : 1;
    const th = this.dead ? 0 : this.throttle;
    this.braking = false;
    if (th > 0.01) {
      if (vf < -4) { vf += s.brake * dt; this.braking = true; }
      else if (vf < s.maxSpeed * power) vf = Math.min(s.maxSpeed * power, vf + s.accel * power * th * (1 - 0.45 * clamp(vf / s.maxSpeed, 0, 1)) * dt);
    } else if (th < -0.01) {
      if (vf > 4) { vf = Math.max(0, vf + s.brake * th * dt); this.braking = true; }
      else vf = Math.max(-s.reverse, vf + s.accel * 0.6 * th * dt);
    } else {
      const coast = this.driver === 'none' ? 260 : 55;
      vf = vf > 0 ? Math.max(0, vf - coast * dt) : Math.min(0, vf + coast * dt);
    }
    if (this.handbrake) { vf = vf > 0 ? Math.max(0, vf - 190 * dt) : Math.min(0, vf + 190 * dt); this.braking = true; }
    if (vf > s.maxSpeed * power) vf = Math.max(s.maxSpeed * power, vf - 120 * dt);
    const grip = this.handbrake ? 2.4 : s.grip;
    vl *= Math.exp(-grip * dt);
    // Direction : nulle à l'arrêt, maximale à vitesse moyenne, réduite à haute vitesse.
    const speedN = Math.abs(vf) / s.maxSpeed;
    const steerGain = clamp(Math.abs(vf) / 32, 0, 1) * (1 - 0.4 * clamp(speedN, 0, 1)) * (this.handbrake ? 1.35 : 1);
    this.angle += this.steer * s.turn * steerGain * Math.sign(vf || 1) * dt;
    // La vitesse reste exprimée dans l'ancien repère : la rotation crée naturellement de la glisse.
    this.vx = cos * vf - sin * vl;
    this.vy = sin * vf + cos * vl;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.honk > 0) this.honk -= dt;
    return this.collideMap(map);
  }

  /** Collision des cercles du véhicule avec les tuiles solides. */
  collideMap(map: CityMap): Impact | null {
    const r = this.radius;
    let hit: Impact | null = null;
    const offs = this.circleOffsets();
    for (let pass = 0; pass < 2; pass++) {
      const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
      for (const o of offs) {
        const cx = this.x + cos * o, cy = this.y + sin * o;
        const tx0 = Math.floor((cx - r) / TILE), tx1 = Math.floor((cx + r) / TILE);
        const ty0 = Math.floor((cy - r) / TILE), ty1 = Math.floor((cy + r) / TILE);
        for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          if (!map.solidAt(tx, ty)) continue;
          const nx = clamp(cx, tx * TILE, (tx + 1) * TILE), ny = clamp(cy, ty * TILE, (ty + 1) * TILE);
          let dx = cx - nx, dy = cy - ny;
          let d = Math.hypot(dx, dy);
          if (d >= r) continue;
          if (d < 0.0001) { dx = cx - (tx + 0.5) * TILE; dy = cy - (ty + 0.5) * TILE; d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d; d = 0; }
          else { dx /= d; dy /= d; }
          const push = r - d;
          this.x += dx * push; this.y += dy * push;
          const vn = this.vx * dx + this.vy * dy;
          if (vn < 0) {
            this.vx -= dx * vn * 1.15; this.vy -= dy * vn * 1.15;
            this.vx *= 0.985; this.vy *= 0.985;
            // Léger couple : le véhicule glisse le long du mur au lieu de s'y planter.
            const torque = (cos * o) * dy - (sin * o) * dx;
            this.angle += clamp(torque * -vn * 0.00035, -0.06, 0.06);
            if (!hit || -vn > hit.force) hit = { x: nx, y: ny, force: -vn };
          }
        }
      }
    }
    return hit;
  }
}

/** Collision entre deux véhicules (cercles). Renvoie la force du choc, 0 sinon. */
export function collideVehicles(a: Vehicle, b: Vehicle): Impact | null {
  const reach = (a.spec.len + b.spec.len) / 2 + 2;
  const ddx = b.x - a.x, ddy = b.y - a.y;
  if (ddx * ddx + ddy * ddy > reach * reach) return null;
  const ra = a.radius, rb = b.radius;
  const ca = Math.cos(a.angle), sa = Math.sin(a.angle), cb = Math.cos(b.angle), sb = Math.sin(b.angle);
  let best: Impact | null = null;
  for (const oa of a.circleOffsets()) {
    const ax = a.x + ca * oa, ay = a.y + sa * oa;
    for (const ob of b.circleOffsets()) {
      const bx = b.x + cb * ob, by = b.y + sb * ob;
      let dx = bx - ax, dy = by - ay;
      let d = Math.hypot(dx, dy);
      const min = ra + rb;
      if (d >= min) continue;
      if (d < 0.001) { dx = 1; dy = 0; d = 0; } else { dx /= d; dy /= d; }
      const overlap = min - d;
      const ima = 1 / a.spec.mass, imb = 1 / b.spec.mass, sum = ima + imb;
      a.x -= dx * overlap * (ima / sum); a.y -= dy * overlap * (ima / sum);
      b.x += dx * overlap * (imb / sum); b.y += dy * overlap * (imb / sum);
      const rvn = (b.vx - a.vx) * dx + (b.vy - a.vy) * dy;
      if (rvn < 0) {
        const j = (-(1 + 0.25) * rvn) / sum;
        a.vx -= dx * j * ima; a.vy -= dy * j * ima;
        b.vx += dx * j * imb; b.vy += dy * j * imb;
        const ta = (ca * oa) * dy - (sa * oa) * dx, tb = (cb * ob) * dy - (sb * ob) * dx;
        a.angle += clamp(ta * rvn * 0.0006 * ima, -0.08, 0.08);
        b.angle -= clamp(tb * rvn * 0.0006 * imb, -0.08, 0.08);
        if (!best || -rvn > best.force) best = { x: (ax + bx) / 2, y: (ay + by) / 2, force: -rvn };
      }
    }
  }
  return best;
}
