import { TILE } from '../engine/config';
import { clamp, angleDiff, dist } from '../engine/math';
import { D } from '../map/tiles';
import type { RoadEdge } from '../map/tiles';
import { ARM_DX, ARM_DY } from '../map/CityMap';
import { Vehicle } from '../vehicles/Vehicle';
import { VEHICLES } from '../vehicles/specs';
import type { VehicleType } from '../vehicles/specs';
import type { World } from '../world/World';

/** État de conduite d'un véhicule autonome suivant le réseau routier. */
export interface DriveAI {
  kind: 'traffic';
  edge: number; from: number; to: number; lane: number;
  next: number; nextLane: number; turn: number; // -1 gauche, 0 tout droit, 1 droite, 2 demi-tour
  phase: 'edge' | 'node';
  curve: { x: number; y: number }[]; ci: number;
  temper: number;
  blocked: number; honkCd: number; reverse: number;
  res: number;
  sense: number; gap: number;
  /** Identifiant du véhicule qui bloque (-1 : rien, ou un piéton). */
  by: number;
  /** Temps restant d'une manœuvre de contournement d'un obstacle immobile. */
  swerve: number;
  /** Vitesse imposée (missions de filature), 0 = normale. */
  speedCap: number;
  /** Itinéraire imposé (liste de nœuds), sinon errance. */
  route: number[] | null;
  ignoreLights: boolean;
  /** Arrêts fantaisistes (mission 2). */
  quirk: number;
  arrived: boolean;
  /** À l'arrêt, moteur tournant (attente d'un signal de mission). */
  hold: boolean;
}

export const TYPE_WEIGHTS: Record<number, [VehicleType, number][]> = {
  [D.DOWNTOWN]: [['compact', 30], ['sedan', 30], ['taxi', 20], ['sport', 7], ['van', 10], ['truck', 3]],
  [D.BUSINESS]: [['sedan', 40], ['sport', 18], ['taxi', 20], ['compact', 15], ['van', 7]],
  [D.OLDTOWN]: [['compact', 45], ['sedan', 20], ['van', 20], ['taxi', 10], ['truck', 5]],
  [D.INDUSTRIAL]: [['truck', 32], ['van', 30], ['compact', 16], ['sedan', 16], ['taxi', 6]],
  [D.HILLS]: [['sedan', 35], ['compact', 30], ['sport', 14], ['van', 10], ['taxi', 11]],
};
const DENSITY: Record<number, number> = { [D.DOWNTOWN]: 15, [D.BUSINESS]: 12, [D.OLDTOWN]: 10, [D.INDUSTRIAL]: 8, [D.HILLS]: 6 };

/** Circulation autonome : apparition hors champ, suivi de voie, feux, priorités, évitement. */
export class TrafficSystem {
  /** Réservation des carrefours sans feux : nœud → { véhicule, échéance }. */
  private reservations = new Map<number, { id: number; until: number }>();
  private spawnT = 0;
  private byId = new Map<number, Vehicle>();

  constructor(private w: World) {}

  get count(): number { let n = 0; for (const v of this.w.vehicles) if (v.driver === 'npc' && v.ai?.kind === 'traffic' && !v.tag) n++; return n; }

  makeAI(edge: RoadEdge, from: number, lane: number): DriveAI {
    return {
      kind: 'traffic', edge: edge.id, from, to: this.w.map.otherNode(edge, from), lane, next: -1, nextLane: 0, turn: 0, phase: 'edge',
      curve: [], ci: 0, temper: this.w.rng.range(0.85, 1.12), blocked: 0, honkCd: 2, reverse: 0, res: -1, sense: this.w.rng.next() * 0.1, gap: 999, by: -1, swerve: 0,
      speedCap: 0, route: null, ignoreLights: false, quirk: 0, arrived: false, hold: false,
    };
  }

  /** Crée un véhicule de circulation sur une arête donnée. */
  spawnOn(edge: RoadEdge, from: number, lane: number, t: number, type: VehicleType): Vehicle {
    const w = this.w;
    const seg = w.map.laneSeg(edge, from, lane);
    const v = new Vehicle(type, seg.sx + seg.dx * seg.len * t, seg.sy + seg.dy * seg.len * t, Math.atan2(seg.dy, seg.dx), w.rng.pick(VEHICLES[type].colors));
    v.driver = 'npc';
    v.ai = this.makeAI(edge, from, lane);
    this.planNext(v, v.ai);
    v.vx = seg.dx * 50; v.vy = seg.dy * 50;
    w.vehicles.push(v);
    return v;
  }

  update(dt: number): void {
    const w = this.w;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 0.25; this.trySpawn(); }
    const despawnR = Math.max(w.viewW, w.viewH) * 0.5 + 330;
    this.byId.clear();
    for (const v of w.vehicles) this.byId.set(v.id, v);
    for (const v of w.vehicles) {
      const ai = v.ai as DriveAI | null;
      if (!ai || ai.kind !== 'traffic' || v.driver !== 'npc') continue;
      if (v.dead) { w.abandon(v, true); continue; }
      if (!v.tag && dist(v.x, v.y, w.focusX, w.focusY) > despawnR && !w.inView(v.x, v.y, 30)) { v.remove = true; this.release(v, ai); continue; }
      this.drive(v, ai, dt);
    }
  }

  private trySpawn(): void {
    const w = this.w, m = w.map;
    const d = m.districtAtPx(w.focusX, w.focusY);
    const target = Math.round(DENSITY[d] * w.quality.cars * w.mods.trafficFactor);
    if (this.count >= target) return;
    const half = Math.max(w.viewW, w.viewH) * 0.5;
    const minR = half + 40, maxR = half + 260;
    // On ne tire que parmi les rues proches : la ville se peuple vite autour du joueur.
    const near = m.edges.filter((e) => e.traffic && Math.abs((e.x + e.wT / 2) * TILE - w.focusX) < maxR + e.wT * 8 && Math.abs((e.y + e.hT / 2) * TILE - w.focusY) < maxR + e.hT * 8);
    if (!near.length) return;
    for (let t = 0; t < 8; t++) {
      const e = w.rng.pick(near);
      const from = w.rng.chance(0.5) ? e.a : e.b;
      const lane = e.lanes > 1 ? w.rng.int(0, 1) : 0;
      const seg = m.laneSeg(e, from, lane);
      const tt = w.rng.range(0.15, 0.8);
      const x = seg.sx + seg.dx * seg.len * tt, y = seg.sy + seg.dy * seg.len * tt;
      const r = dist(x, y, w.focusX, w.focusY);
      if (r < minR || r > maxR || w.inView(x, y, 30)) continue;
      if (w.vehicles.some((o) => Math.abs(o.x - x) < 56 && Math.abs(o.y - y) < 56)) continue;
      const type = w.rng.weighted(TYPE_WEIGHTS[m.districtAtPx(x, y)], (p) => p[1])[0];
      this.spawnOn(e, from, lane, tt, type);
      return;
    }
  }

  release(v: Vehicle, ai: DriveAI | null): void {
    if (!ai || ai.kind !== 'traffic') return;
    if (ai.res >= 0) { const r = this.reservations.get(ai.res); if (r && r.id === v.id) this.reservations.delete(ai.res); ai.res = -1; }
  }

  /** Choisit la prochaine arête au carrefour d'arrivée. */
  planNext(v: Vehicle, ai: DriveAI): void {
    const m = this.w.map, rng = this.w.rng;
    const e = m.edges[ai.edge];
    const node = m.nodes[ai.to];
    const inArm = m.armFrom(e, ai.from); // direction de déplacement
    let choice = -1;
    if (ai.route && ai.route.length) {
      const idx = ai.route.indexOf(ai.to);
      if (idx >= 0 && idx + 1 < ai.route.length) { const ne = m.edgeBetween(ai.to, ai.route[idx + 1]); if (ne) choice = ne.id; }
      else if (idx === ai.route.length - 1) ai.arrived = false;
    }
    if (choice < 0) {
      const opts: { id: number; turn: number; w: number }[] = [];
      for (let arm = 0; arm < 4; arm++) {
        const id = node.arms[arm];
        if (id < 0 || id === ai.edge || !m.edges[id].traffic) continue;
        const rel = (arm - inArm + 4) % 4; // 0 tout droit, 1 droite, 3 gauche
        const turn = rel === 0 ? 0 : rel === 1 ? 1 : -1;
        opts.push({ id, turn, w: turn === 0 ? 5 : turn === 1 ? 2.5 : 2 });
      }
      // Sur une avenue, pas de changement de voie : la voie de droite va tout droit ou à droite, celle de gauche tout droit ou à gauche.
      const fit = e.lanes > 1 ? opts.filter((o) => o.turn === 0 || (ai.lane === 0 ? o.turn === 1 : o.turn === -1)) : opts;
      const pool = fit.length ? fit : opts;
      if (pool.length) choice = rng.weighted(pool, (o) => o.w).id;
    }
    if (choice < 0) { ai.next = ai.edge; ai.turn = 2; ai.nextLane = 0; return; }
    const ne = m.edges[choice];
    const outArm = m.armFrom(ne, ai.to);
    const rel = (outArm - inArm + 4) % 4;
    ai.next = choice;
    ai.turn = rel === 0 ? 0 : rel === 1 ? 1 : rel === 3 ? -1 : 2;
    ai.nextLane = ne.lanes > 1 ? (ai.turn === 1 ? 0 : ai.turn === -1 ? 1 : e.lanes > 1 ? ai.lane : rng.int(0, 1)) : 0;
  }

  private buildCurve(ai: DriveAI): void {
    const m = this.w.map;
    const e = m.edges[ai.edge], ne = m.edges[ai.next];
    const a = m.laneSeg(e, ai.from, ai.lane);
    const b = m.laneSeg(ne, ai.to, ai.nextLane);
    const pts: { x: number; y: number }[] = [];
    if (ai.turn === 0) { pts.push({ x: b.sx, y: b.sy }); }
    else if (ai.turn === 2) {
      // Demi-tour : petit arc dans le carrefour.
      const n = m.nodes[ai.to];
      pts.push({ x: (a.ex + n.cx) / 2 + a.dx * 6, y: (a.ey + n.cy) / 2 + a.dy * 6 }, { x: (b.sx + n.cx) / 2 + a.dx * 6, y: (b.sy + n.cy) / 2 + a.dy * 6 }, { x: b.sx, y: b.sy });
    } else {
      // Bézier quadratique : le point de contrôle est l'intersection des deux voies.
      // On amorce le virage un peu avant le carrefour et on le termine un peu après : rayon plus confortable.
      const pad = ai.turn === 1 ? 8 : 3;
      const p0x = a.ex - a.dx * pad, p0y = a.ey - a.dy * pad, p1x = b.sx + b.dx * pad, p1y = b.sy + b.dy * pad;
      const cx = a.dx !== 0 ? b.sx : a.ex, cy = a.dx !== 0 ? a.ey : b.sy;
      for (let i = 1; i <= 6; i++) {
        const t = i / 6, u = 1 - t;
        pts.push({ x: u * u * p0x + 2 * u * t * cx + t * t * p1x, y: u * u * p0y + 2 * u * t * cy + t * t * p1y });
      }
    }
    pts.push({ x: b.sx + b.dx * 14, y: b.sy + b.dy * 14 });
    ai.curve = pts; ai.ci = 0;
  }

  /** Distance libre devant le véhicule (autres véhicules, piétons, joueur) et identité de l'obstacle. */
  private senseAhead(v: Vehicle, look: number, narrow: boolean): { gap: number; by: number } {
    const w = this.w;
    const cos = Math.cos(v.angle), sin = Math.sin(v.angle);
    const half = v.spec.len / 2, hw = v.spec.wid / 2 - (narrow ? 4 : 0);
    let gap = 999, by = -1;
    for (const o of w.vehicles) {
      if (o === v) continue;
      const dx = o.x - v.x, dy = o.y - v.y;
      if (dx > look + 40 || dx < -look - 40 || dy > look + 40 || dy < -look - 40) continue;
      const oc = Math.cos(o.angle), os = Math.sin(o.angle);
      for (const off of o.circleOffsets()) {
        const px = dx + oc * off, py = dy + os * off;
        const ahead = px * cos + py * sin, lat = -px * sin + py * cos;
        if (ahead <= 0 || ahead > look + half) continue;
        if (Math.abs(lat) < hw + o.radius + 1.5) { const g = ahead - half - o.radius; if (g < gap) { gap = g; by = o.id; } }
      }
    }
    const checkPt = (x: number, y: number, r: number) => {
      const dx = x - v.x, dy = y - v.y;
      const ahead = dx * cos + dy * sin, lat = -dx * sin + dy * cos;
      if (ahead > 0 && ahead < look + half && Math.abs(lat) < hw + r + 3) { const g = ahead - half - r; if (g < gap) { gap = g; by = -1; } }
    };
    for (const p of w.peds) {
      if (Math.abs(p.x - v.x) > look + 30 || Math.abs(p.y - v.y) > look + 30) continue;
      checkPt(p.x, p.y, p.radius);
    }
    if (!w.player.vehicle && !w.attract) checkPt(w.player.x, w.player.y, 4);
    return { gap, by };
  }

  /** Blocage circulaire entre véhicules autonomes : un seul passe, celui au plus petit identifiant. */
  private winsDeadlock(v: Vehicle, ai: DriveAI): boolean {
    let cur = ai.by, min = v.id;
    for (let k = 0; k < 6; k++) {
      if (cur === v.id) return min === v.id;
      const o = this.byId.get(cur);
      const oa = o?.ai as DriveAI | null;
      if (!o || !oa || oa.kind !== 'traffic' || o.driver !== 'npc' || oa.gap > 14 || o.speed > 8) return false;
      if (o.id < min) min = o.id;
      cur = oa.by;
    }
    return false;
  }
  /** Un véhicule arrive-t-il en face, par le bras opposé, sans tourner à gauche ? */
  private oncoming(v: Vehicle, ai: DriveAI): boolean {
    const m = this.w.map;
    const node = m.nodes[ai.to];
    const inArm = m.armFrom(m.edges[ai.edge], ai.from);
    const opp = node.arms[inArm];
    if (opp < 0) return false;
    for (const o of this.w.vehicles) {
      const oa = o.ai as DriveAI | null;
      if (o === v || !oa || oa.kind !== 'traffic' || oa.to !== node.id || oa.edge !== opp || oa.turn === -1) continue;
      const d = Math.hypot(o.x - node.cx, o.y - node.cy);
      if (d < 120 && (o.speed > 12 || d < 60)) return true;
    }
    return false;
  }
  /** Le carrefour est-il encombré par un véhicule à l'arrêt ? */
  private boxJammed(v: Vehicle, nodeId: number): boolean {
    const n = this.w.map.nodes[nodeId];
    const x0 = n.bx * TILE - 4, y0 = n.by * TILE - 4, x1 = (n.bx + n.bw) * TILE + 4, y1 = (n.by + n.bh) * TILE + 4;
    for (const o of this.w.vehicles) if (o !== v && o.speed < 6 && o.x > x0 && o.x < x1 && o.y > y0 && o.y < y1) return true;
    return false;
  }

  private drive(v: Vehicle, ai: DriveAI, dt: number): void {
    const w = this.w, m = w.map;
    const e = m.edges[ai.edge];
    const seg = m.laneSeg(e, ai.from, ai.lane);
    const node = m.nodes[ai.to];
    const vf = v.forwardSpeed;
    const limitBase = (e.type === 'avenue' ? 104 : e.type === 'street' ? 80 : 50) * ai.temper;
    let target = ai.speedCap > 0 ? Math.min(ai.speedCap, limitBase * 1.25) : limitBase;
    let tx: number, ty: number;
    if (ai.hold) target = 0;

    if (ai.phase === 'edge') {
      const along = (v.x - seg.sx) * seg.dx + (v.y - seg.sy) * seg.dy;
      const L = 18 + Math.abs(vf) * 0.3;
      const ta = Math.min(seg.len + 10, along + L);
      // Contournement d'un obstacle immobile : on se déporte vers la gauche le temps de passer.
      const side = ai.swerve > 0 ? 19 : 0;
      tx = seg.sx + seg.dx * ta + seg.dy * side; ty = seg.sy + seg.dy * ta - seg.dx * side;
      const hasCross = node.deg >= 3;
      const stopAlong = seg.len - (hasCross ? 2 * TILE + 5 : 3);
      const dStop = stopAlong - (along + v.spec.len / 2);
      if (ai.turn !== 0 && seg.len - along < 60) target = Math.min(target, ai.turn === 2 ? 28 : ai.turn === 1 ? 34 : 46);
      // Arrêts aux feux et priorités.
      let mustStop = false;
      if (node.deg >= 3 && dStop > -8) {
        if (node.signal && w.mods.lightsMode !== 'blink') {
          if (!ai.ignoreLights) {
            const s = m.signalState(node, e.vertical, w.time);
            mustStop = s === 'r' || (s === 'y' && dStop > 14);
          }
        } else if (dStop < 46) {
          const r = this.reservations.get(node.id);
          if (r && r.id !== v.id && r.until > w.time) mustStop = true;
          else { this.reservations.set(node.id, { id: v.id, until: w.time + 6 }); ai.res = node.id; }
        }
        // On ne s'engage pas dans un carrefour encombré, et on cède le passage avant de tourner à gauche.
        if (!mustStop && dStop < 30 && dStop > -4 && (this.boxJammed(v, node.id) || (ai.turn === -1 && this.oncoming(v, ai)))) mustStop = true;
        if (ai.quirk > 0 && node.signal && dStop < 30 && dStop > 0) {
          // Conducteur fantasque : s'arrête au vert, repart quand ça lui chante.
          ai.quirk -= dt; mustStop = true;
        }
      }
      if (mustStop) target = Math.min(target, dStop <= 1.5 ? 0 : Math.sqrt(2 * 130 * dStop));
      if (along >= seg.len - (ai.turn === 1 ? 8 : ai.turn === -1 ? 3 : 1)) {
        if (ai.route && ai.route[ai.route.length - 1] === ai.to) { ai.arrived = true; }
        this.buildCurve(ai);
        ai.phase = 'node';
      }
    } else {
      const c = ai.curve[ai.ci];
      tx = c.x; ty = c.y;
      if (ai.turn !== 0) target = Math.min(target, ai.turn === 2 ? 28 : ai.turn === 1 ? 34 : 48);
      const d = dist(v.x, v.y, c.x, c.y);
      const passed = (c.x - v.x) * Math.cos(v.angle) + (c.y - v.y) * Math.sin(v.angle) < 0;
      if (d < 9 || (passed && d < 26)) {
        ai.ci++;
        if (ai.ci >= ai.curve.length) {
          this.release(v, ai);
          const ne = m.edges[ai.next];
          ai.from = ai.to; ai.to = m.otherNode(ne, ai.from); ai.edge = ne.id; ai.lane = ai.nextLane; ai.phase = 'edge';
          if (ai.quirk <= 0 && ai.speedCap > 0 && w.rng.chance(0.45)) ai.quirk = w.rng.range(1.5, 3);
          this.planNext(v, ai);
          return;
        }
      }
    }

    // Capteur avant (rafraîchi ~12 fois par seconde).
    ai.sense -= dt;
    if (ai.swerve > 0) ai.swerve -= dt;
    if (ai.sense <= 0) {
      ai.sense = w.inView(v.x, v.y, 60) ? 0.07 : 0.12;
      const r = this.senseAhead(v, 22 + Math.abs(vf) * 0.85, ai.swerve > 0);
      ai.gap = r.gap; ai.by = r.by;
    }
    let blockedByObstacle = false;
    if (ai.gap < 900) {
      const safe = Math.max(0, ai.gap - 8);
      let lim = safe <= 0 ? 0 : Math.sqrt(2 * 120 * safe);
      // Interblocage : le véhicule prioritaire avance au pas, les autres attendent.
      if (lim < 12 && ai.by >= 0 && ai.blocked > 1.2 && this.winsDeadlock(v, ai)) lim = 22;
      if (lim < target) { target = lim; blockedByObstacle = lim < 12; }
    }
    // Obstacle immobile (véhicule abandonné, joueur à l'arrêt) : on le contourne après quelques secondes.
    if (blockedByObstacle && ai.blocked > 3.5 && ai.swerve <= 0 && ai.phase === 'edge') {
      const o = ai.by >= 0 ? this.byId.get(ai.by) : null;
      if (o && (o.driver === 'none' || o.driver === 'player' || o.dead) && o.speed < 6) { ai.swerve = 3.2; ai.blocked = 1.5; }
    }

    // Blocage : klaxon, puis petite marche arrière pour se dégager.
    if (ai.reverse > 0) {
      ai.reverse -= dt;
      v.throttle = -0.8; v.steer = (v.id % 2 ? 1 : -1) * 0.6; v.handbrake = false;
      return;
    }
    if (blockedByObstacle && Math.abs(vf) < 6) {
      ai.blocked += dt; ai.honkCd -= dt;
      if (ai.blocked > 2.5 && ai.honkCd <= 0) { ai.honkCd = w.rng.range(2.5, 6); w.honk(v); }
      if (ai.blocked > 9) {
        if (!w.inView(v.x, v.y, 20) && !v.tag) { v.remove = true; this.release(v, ai); return; }
        if (ai.blocked > 13) { ai.reverse = 0.9; ai.blocked = 4; }
      }
    } else if (Math.abs(vf) > 12) ai.blocked = Math.max(0, ai.blocked - dt * 2);
    // Coincé contre un mur sans obstacle détecté.
    if (!blockedByObstacle && target > 20 && Math.abs(vf) < 4) { v.stuckTime += dt; if (v.stuckTime > 2.5) { ai.reverse = 0.8; v.stuckTime = 0; } } else v.stuckTime = 0;

    const want = Math.atan2(ty - v.y, tx - v.x);
    v.steer = clamp(angleDiff(v.angle, want) * 2.6, -1, 1);
    // Un écart de cap important impose de ralentir.
    if (Math.abs(angleDiff(v.angle, want)) > 0.9) target = Math.min(target, 40);
    if (target <= 0.5 && Math.abs(vf) < 5) { v.throttle = 0; v.handbrake = true; }
    else {
      v.handbrake = false;
      const dv = target - vf;
      // Freinage franc : sans cela le véhicule suit mal sa courbe d'arrêt et emboutit celui de devant.
      v.throttle = dv > 2 ? clamp(dv / 28, 0.25, 1) : dv < -2 ? -clamp(-dv / 10, 0.35, 1) : 0;
    }
  }

  /** Place un véhicule sur le réseau avec un itinéraire imposé (missions). */
  spawnRouted(type: VehicleType, color: number, route: number[], speedCap: number): Vehicle | null {
    const m = this.w.map;
    if (route.length < 2) return null;
    const e = m.edgeBetween(route[0], route[1]);
    if (!e) return null;
    const v = this.spawnOn(e, route[0], 0, 0.3, type);
    v.color = color;
    const ai = v.ai as DriveAI;
    ai.route = route; ai.speedCap = speedCap; ai.temper = 1;
    this.planNext(v, ai);
    return v;
  }

  /** Voie de circulation la plus proche d'un point : pour remettre un véhicule dans le trafic. */
  static armDir(arm: number): { dx: number; dy: number } { return { dx: ARM_DX[arm], dy: ARM_DY[arm] }; }
}
