import { TILE } from '../engine/config';
import { clamp, angleDiff, dist } from '../engine/math';
import { findPath } from '../map/pathfinding';
import type { TilePt } from '../map/pathfinding';
import { Vehicle } from '../vehicles/Vehicle';
import type { Ped } from '../npc/Ped';
import { COP_LINES } from '../npc/chatter';
import type { World } from '../world/World';

interface CopCarAI {
  kind: 'police';
  path: number[]; pi: number; pathT: number;
  reverse: number; stuck: number; bust: number;
  side: number;
}
interface CopFootAI { kind: 'cop'; mode: 'chase' | 'return' | 'post'; car: Vehicle | null; path: TilePt[] | null; pi: number; pathT: number; grab: number; }

const UNITS = [0, 1, 1, 3, 4, 6];

/** Police : témoins, patrouilles, poursuites en voiture et à pied, barrages, arrestation. */
export class PoliceSystem {
  private spawnT = 0;
  private ambientT = 6;
  private blockT = 0;
  private blocks: { x: number; y: number; cars: Vehicle[]; cop: Ped | null }[] = [];

  constructor(private w: World) {}

  private isUnitCar(v: Vehicle): boolean { return v.type === 'police' && v.driver === 'police' && v.ai?.kind === 'police'; }
  get unitCount(): number {
    let n = 0;
    for (const v of this.w.vehicles) if (this.isUnitCar(v) && !v.dead) n++;
    for (const p of this.w.peds) if (p.role === 'cop' && p.ai?.kind === 'cop' && p.ai.mode === 'chase') n++;
    return n;
  }

  /** Un policier (à pied ou en voiture) voit-il ce point ? */
  witness(x: number, y: number): boolean {
    const m = this.w.map;
    for (const v of this.w.vehicles) {
      if (v.type !== 'police' || v.driver === 'none' || v.driver === 'player') continue;
      if (dist(v.x, v.y, x, y) < 180 && m.lineOfSight(v.x, v.y, x, y)) return true;
    }
    for (const p of this.w.peds) {
      if (p.profile !== 'cop' || p.state === 'down') continue;
      if (dist(p.x, p.y, x, y) < 150 && m.lineOfSight(p.x, p.y, x, y)) return true;
    }
    return false;
  }

  private newCarAI(): CopCarAI { return { kind: 'police', path: [], pi: 0, pathT: 0, reverse: 0, stuck: 0, bust: 0, side: this.w.rng.chance(0.5) ? 1 : -1 }; }

  update(dt: number): void {
    const w = this.w, wanted = w.wanted, p = w.player;
    const level = wanted.level;

    // Patrouilles d'ambiance.
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = w.rng.range(8, 14);
      if (level === 0 && !w.vehicles.some((v) => v.type === 'police') && w.rng.chance(0.45)) this.spawnPatrol(false);
    }

    if (level === 0) {
      if (this.blocks.length || w.vehicles.some((v) => this.isUnitCar(v)) || w.peds.some((q) => q.role === 'cop')) this.standDown();
      return;
    }

    // Visibilité du joueur.
    let seen = false;
    const range = 185 + level * 8;
    for (const v of w.vehicles) {
      if (v.type !== 'police' || v.driver === 'player' || v.dead) continue;
      if (v.driver === 'none' && v.tag !== 'roadblock' && v.ai?.kind !== 'parkedPolice') continue;
      if (dist(v.x, v.y, p.px, p.py) < range && w.map.lineOfSight(v.x, v.y, p.px, p.py)) { seen = true; break; }
    }
    if (!seen) for (const q of w.peds) {
      if (q.role !== 'cop' || q.state === 'down') continue;
      if (dist(q.x, q.y, p.px, p.py) < 150 && w.map.lineOfSight(q.x, q.y, p.px, p.py)) { seen = true; break; }
    }
    wanted.seen = seen;

    // Renforts.
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.unitCount < UNITS[level]) {
      this.spawnT = level >= 4 ? 1.6 : 2.6;
      this.dispatch();
    }
    // Barrages à partir de quatre étoiles.
    if (level >= 4) {
      this.blockT -= dt;
      if (this.blockT <= 0) { this.blockT = 7; if (this.blocks.length < level - 3) this.placeRoadblock(); }
    }
    this.blocks = this.blocks.filter((b) => {
      if (dist(b.x, b.y, p.px, p.py) < 900) return true;
      for (const c of b.cars) c.remove = true;
      if (b.cop) b.cop.remove = true;
      return false;
    });

    for (const v of w.vehicles) if (this.isUnitCar(v)) this.driveCar(v, v.ai as CopCarAI, dt);
    for (const q of w.peds) if (q.role === 'cop' && q.ai?.kind === 'cop') this.updateFoot(q, q.ai as CopFootAI, dt);
  }

  /** Fin d'alerte : les unités reprennent leur ronde. */
  standDown(): void {
    const w = this.w;
    for (const v of w.vehicles) {
      if (v.type !== 'police') continue;
      v.siren = false;
      if (this.isUnitCar(v)) this.toPatrol(v);
      else if (v.tag === 'roadblock') { v.tag = ''; if (!w.inView(v.x, v.y, 30)) v.remove = true; }
    }
    for (const q of w.peds) {
      if (q.role !== 'cop') continue;
      q.role = 'civil'; q.ai = null; q.state = 'idle'; q.timer = w.rng.range(1, 3); q.path = null; q.speed = 28;
    }
    this.blocks = [];
  }
  private toPatrol(v: Vehicle): void {
    const w = this.w, m = w.map;
    const r = m.nearestEdge(v.x, v.y, true);
    if (!r) { v.driver = 'none'; v.ai = null; return; }
    const e = r.edge;
    const hx = Math.cos(v.angle), hy = Math.sin(v.angle);
    const along = e.vertical ? hy : hx;
    const from = along >= 0 ? e.a : e.b;
    v.driver = 'npc';
    v.ai = w.traffic.makeAI(e, from, 0);
    w.traffic.planNext(v, v.ai);
  }

  private spawnPatrol(pursuit: boolean): Vehicle | null {
    const w = this.w, m = w.map, p = w.player;
    const half = Math.max(w.viewW, w.viewH) * 0.5;
    let best: { e: any; from: number; t: number; score: number } | null = null;
    const sp = p.speed, dvx = p.driving ? p.vehicle!.vx : p.vx, dvy = p.driving ? p.vehicle!.vy : p.vy;
    const fx0 = pursuit ? p.px : w.focusX, fy0 = pursuit ? p.py : w.focusY;
    const reach = half + 320;
    const near = m.edges.filter((e) => e.traffic && Math.abs((e.x + e.wT / 2) * TILE - fx0) < reach + e.wT * 8 && Math.abs((e.y + e.hT / 2) * TILE - fy0) < reach + e.hT * 8);
    if (!near.length) return null;
    for (let t = 0; t < 16; t++) {
      const e = w.rng.pick(near);
      const from = w.rng.chance(0.5) ? e.a : e.b;
      const tt = w.rng.range(0.2, 0.8);
      const seg = m.laneSeg(e, from, 0);
      const x = seg.sx + seg.dx * seg.len * tt, y = seg.sy + seg.dy * seg.len * tt;
      const fx = pursuit ? p.px : w.focusX, fy = pursuit ? p.py : w.focusY;
      const r = dist(x, y, fx, fy);
      if (r < half + 50 || r > half + 300 || w.inView(x, y, 30)) continue;
      if (w.vehicles.some((o) => Math.abs(o.x - x) < 50 && Math.abs(o.y - y) < 50)) continue;
      // À partir de trois étoiles, on préfère surgir devant le joueur (interception).
      const ahead = sp > 30 ? ((x - fx) * dvx + (y - fy) * dvy) / (r * sp) : 0;
      const score = (pursuit && w.wanted.level >= 3 ? ahead * 2 : 0) + w.rng.next();
      if (!best || score > best.score) best = { e, from, t: tt, score };
    }
    if (!best) return null;
    const v = w.traffic.spawnOn(best.e, best.from, 0, best.t, 'police');
    if (pursuit) this.engage(v);
    return v;
  }
  private engage(v: Vehicle): void {
    v.driver = 'police'; v.ai = this.newCarAI(); v.siren = true; v.handbrake = false;
  }
  private dispatch(): void {
    const w = this.w, p = w.player;
    // Une patrouille déjà présente dans le secteur ?
    for (const v of w.vehicles) {
      if (v.type === 'police' && v.driver === 'npc' && !v.dead && dist(v.x, v.y, p.px, p.py) < 520) { this.engage(v); return; }
    }
    this.spawnPatrol(true);
  }

  private placeRoadblock(): void {
    const w = this.w, m = w.map, p = w.player;
    if (!p.driving || p.vehicle!.speed < 40) return;
    const v = p.vehicle!;
    const sp = v.speed, dx = v.vx / sp, dy = v.vy / sp;
    const n0 = m.nearestNode(p.px + dx * 190, p.py + dy * 190);
    let bestE = null as null | (typeof m.edges)[number], bd = 0.3;
    for (const ei of n0.arms) {
      if (ei < 0) continue;
      const e = m.edges[ei];
      const o = m.nodes[m.otherNode(e, n0.id)];
      const ex = o.cx - n0.cx, ey = o.cy - n0.cy, el = Math.hypot(ex, ey) || 1;
      const d = (ex * dx + ey * dy) / el;
      if (d > bd && e.length > 90) { bd = d; bestE = e; }
    }
    if (!bestE) return;
    const mx = (bestE.x + bestE.wT / 2) * TILE, my = (bestE.y + bestE.hT / 2) * TILE;
    if (w.inView(mx, my, 70) || dist(mx, my, p.px, p.py) < 200) return;
    if (this.blocks.some((b) => dist(b.x, b.y, mx, my) < 200)) return;
    const wpx = bestE.w * TILE;
    const n = Math.max(2, Math.round(wpx / 31));
    const cars: Vehicle[] = [];
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 30;
      const c = new Vehicle('police', bestE.vertical ? mx + off : mx, bestE.vertical ? my : my + off, bestE.vertical ? 0 : Math.PI / 2);
      c.driver = 'none'; c.siren = true; c.tag = 'roadblock'; c.handbrake = true;
      w.vehicles.push(c); cars.push(c);
    }
    const cop = w.pedSys.spawn(bestE.vertical ? mx + wpx / 2 + 8 : mx + 14, bestE.vertical ? my + 14 : my + wpx / 2 + 8, 'cop');
    cop.role = 'cop'; cop.state = 'seek'; cop.speed = 88;
    cop.ai = { kind: 'cop', mode: 'post', car: null, path: null, pi: 0, pathT: 0, grab: 0 } as CopFootAI;
    this.blocks.push({ x: mx, y: my, cars, cop });
    w.bus.emit('toast', { text: 'Barrage de police droit devant !', kind: 'bad', ttl: 2.5 });
  }

  private driveCar(v: Vehicle, ai: CopCarAI, dt: number): void {
    const w = this.w, m = w.map, p = w.player, wanted = w.wanted;
    if (v.dead) { v.siren = false; v.driver = 'none'; v.ai = null; return; }
    const level = wanted.level;
    const pvx = p.driving ? p.vehicle!.vx : p.vx, pvy = p.driving ? p.vehicle!.vy : p.vy;
    const tX = wanted.seen || level < 2 ? p.px + pvx * 0.35 : wanted.lastX;
    const tY = wanted.seen || level < 2 ? p.py + pvy * 0.35 : wanted.lastY;
    const investigate = level === 1;
    const gxT = investigate ? wanted.lastX : tX, gyT = investigate ? wanted.lastY : tY;
    const d = dist(v.x, v.y, gxT, gyT);
    const dPlayer = dist(v.x, v.y, p.px, p.py);
    const los = d < 210 && m.lineOfSight(v.x, v.y, gxT, gyT);
    let gx = gxT, gy = gyT;
    if (!los) {
      ai.pathT -= dt;
      if (ai.pathT <= 0 || ai.path.length === 0) {
        ai.pathT = 1.2;
        ai.path = m.routeNodes(m.nearestNode(v.x, v.y).id, m.nearestNode(gxT, gyT).id);
        ai.pi = 0;
      }
      while (ai.pi < ai.path.length - 1 && dist(v.x, v.y, m.nodes[ai.path[ai.pi]].cx, m.nodes[ai.path[ai.pi]].cy) < 44) ai.pi++;
      const n = m.nodes[ai.path[ai.pi]];
      if (ai.pi < ai.path.length - 1 || dist(v.x, v.y, n.cx, n.cy) > 44) { gx = n.cx; gy = n.cy; }
    }
    const want = Math.atan2(gy - v.y, gx - v.x);
    const err = angleDiff(v.angle, want);
    const vf = v.forwardSpeed;
    let target = v.spec.maxSpeed * (level >= 4 ? 1.06 : 1);
    if (Math.abs(err) > 1.3) target = 38; else if (Math.abs(err) > 0.55) target = 78;
    v.siren = !investigate;
    if (investigate) { target = Math.min(target, 95); if (d < 70) target = 0; }
    // Deux étoiles : on colle au joueur sans l'éperonner. Au-delà : interception.
    if (level === 2 && p.driving && dPlayer < 46) target = Math.min(target, Math.max(0, p.vehicle!.speed - 8));
    // Au contact, on bouscule sans pulvériser : la vitesse d'approche reste proche de celle du fuyard.
    else if (p.driving && dPlayer < 80) target = Math.min(target, p.vehicle!.speed + (level >= 4 ? 55 : 38));
    if (p.driving && dPlayer < 170 && dPlayer > 1) {
      // Arrivée de face : on freine pour barrer la route plutôt que de percuter à pleine vitesse.
      const closing = ((v.vx - pvx) * (p.px - v.x) + (v.vy - pvy) * (p.py - v.y)) / dPlayer;
      if (closing > 85) target = Math.min(target, Math.max(25, vf - (closing - 85)));
    }
    // Joueur à pied : on s'arrête et l'agent descend.
    if (!investigate && p.onFoot && dPlayer < 90 && los) {
      target = 0;
      if (Math.abs(vf) < 14) { this.deploy(v); return; }
    }
    // Joueur arrêté en voiture : arrestation.
    if (!investigate && p.driving && p.vehicle!.speed < 14 && dPlayer < 44) {
      target = 0;
      ai.bust += dt;
      if (ai.bust > 2.2) { w.bust(); return; }
    } else ai.bust = Math.max(0, ai.bust - dt * 0.5);

    // Évitement sommaire des autres véhicules (hors cible).
    const cos = Math.cos(v.angle), sin = Math.sin(v.angle);
    let avoid = 0;
    for (const o of w.vehicles) {
      if (o === v || (p.driving && o === p.vehicle)) continue;
      const ox = o.x - v.x, oy = o.y - v.y;
      const ahead = ox * cos + oy * sin, lat = -ox * sin + oy * cos;
      if (ahead > 0 && ahead < 26 + Math.abs(vf) * 0.35 && Math.abs(lat) < 15) { avoid = lat >= 0 ? -1 : 1; if (ahead < 24) target = Math.min(target, 40); }
    }

    if (ai.reverse > 0) {
      ai.reverse -= dt;
      v.throttle = -1; v.steer = -ai.side; v.handbrake = false;
      return;
    }
    if (target > 20 && Math.abs(vf) < 6) { ai.stuck += dt; if (ai.stuck > 1.1) { ai.reverse = 0.8; ai.stuck = 0; ai.side = -ai.side; } } else ai.stuck = 0;

    v.steer = clamp(err * 2.8 + avoid * 0.7, -1, 1);
    if (target <= 0.5) { v.throttle = vf > 8 ? -1 : 0; v.handbrake = Math.abs(vf) < 20; }
    else {
      v.handbrake = false;
      const dv = target - vf;
      v.throttle = dv > 2 ? 1 : dv < -6 ? -clamp(-dv / 40, 0.3, 1) : 0;
    }
  }

  /** L'agent descend de voiture pour poursuivre à pied. */
  private deploy(v: Vehicle): void {
    const w = this.w;
    v.driver = 'none'; v.ai = { kind: 'parkedPolice' }; v.throttle = 0; v.handbrake = true;
    const lx = Math.sin(v.angle), ly = -Math.cos(v.angle);
    const cop = w.pedSys.spawn(v.x + lx * (v.spec.wid / 2 + 6), v.y + ly * (v.spec.wid / 2 + 6), 'cop');
    cop.role = 'cop'; cop.state = 'seek'; cop.speed = 90;
    cop.ai = { kind: 'cop', mode: 'chase', car: v, path: null, pi: 0, pathT: 0, grab: 0 } as CopFootAI;
    w.pedSys.say(cop, 'Police ! On ne bouge plus !', 1.8);
  }

  private updateFoot(q: Ped, ai: CopFootAI, dt: number): void {
    const w = this.w, m = w.map, p = w.player;
    if (q.state === 'down') {
      q.vx *= Math.exp(-6 * dt); q.vy *= Math.exp(-6 * dt); q.integrate(dt, m); q.timer -= dt; q.moving = false;
      if (q.timer <= 0) q.state = 'seek';
      return;
    }
    const d = dist(q.x, q.y, p.px, p.py);
    if (ai.mode === 'post') {
      q.stop(); q.face(p.px, p.py, dt);
      if (p.onFoot && d < 90) ai.mode = 'chase';
      return;
    }
    if (ai.mode === 'chase' && !p.onFoot && d > 150 && ai.car && !ai.car.remove && ai.car.driver === 'none') ai.mode = 'return';
    if (ai.mode === 'return' && p.onFoot && d < 120) ai.mode = 'chase';
    const car = ai.car;
    const gx = ai.mode === 'return' && car ? car.x : p.px, gy = ai.mode === 'return' && car ? car.y : p.py;
    const dg = dist(q.x, q.y, gx, gy);
    if (ai.mode === 'return' && car && dg < 18) {
      if (car.driver === 'none' && !car.dead) { this.engage(car); }
      q.remove = true;
      return;
    }
    if (ai.mode === 'chase') {
      // Arrestation : au contact à pied, ou à côté d'une voiture à l'arrêt.
      if (p.onFoot && d < 10) { ai.grab += dt; if (ai.grab > 0.3) { w.bust(); return; } }
      else if (p.driving && p.vehicle!.speed < 12 && d < 24) { ai.grab += dt; if (ai.grab > 1.4) { w.bust(); return; } }
      else ai.grab = 0;
    }
    if (dg < 200 && m.lineOfSight(q.x, q.y, gx, gy)) {
      ai.path = null;
      if (dg > 5) q.moveToward(gx, gy, q.speed, dt, m); else q.stop();
    } else {
      ai.pathT -= dt;
      if (ai.pathT <= 0 || !ai.path) {
        ai.pathT = 0.8;
        ai.path = findPath(m, q.tx, q.ty, Math.floor(gx / TILE), Math.floor(gy / TILE), { roadCost: 1, maxNodes: 3000 });
        ai.pi = 1;
      }
      if (ai.path && ai.pi < ai.path.length) {
        const n = ai.path[ai.pi];
        if (q.moveToward((n.tx + 0.5) * TILE, (n.ty + 0.5) * TILE, q.speed, dt, m) < 4) ai.pi++;
      } else q.stop();
    }
    if (w.rng.chance(dt * 0.15)) w.pedSys.say(q, w.rng.pick(['Arrêtez-vous !', 'Halte !', 'Au nom de la loi !', 'Ça va chauffer !', ...COP_LINES.slice(0, 1)]), 1.6);
  }

  /** Après une arrestation : on retire toutes les unités engagées. */
  reset(): void {
    const w = this.w;
    for (const v of w.vehicles) if (v.type === 'police' && v.driver !== 'player') v.remove = true;
    for (const q of w.peds) if (q.role === 'cop') q.remove = true;
    this.blocks = [];
  }
}
