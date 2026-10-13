import { TILE } from '../engine/config';
import { dist } from '../engine/math';
import { findPath } from '../map/pathfinding';
import { T, D } from '../map/tiles';
import type { World } from '../world/World';
import { Ped } from './Ped';
import { randomLook } from './looks';
import type { ProfileKey, Look } from './looks';
import { CHAT_PAIRS, IDLE_LINES, HONK_LINES, CRASH_LINES, FLEE_LINES, SHOP_LINES, TOURIST_LINES, ROBOT_LINES } from './chatter';

const DENSITY: Record<number, number> = { [D.DOWNTOWN]: 26, [D.OLDTOWN]: 22, [D.BUSINESS]: 16, [D.HILLS]: 8, [D.INDUSTRIAL]: 8 };
const PROFILE_WEIGHTS: Record<number, [ProfileKey, number][]> = {
  [D.DOWNTOWN]: [['passerby', 5], ['employee', 2], ['tourist', 1.5], ['courier', 1]],
  [D.BUSINESS]: [['employee', 6], ['passerby', 2], ['courier', 1], ['tourist', 1]],
  [D.OLDTOWN]: [['passerby', 6], ['tourist', 2], ['courier', 1], ['employee', 1]],
  [D.INDUSTRIAL]: [['worker', 7], ['passerby', 2], ['courier', 1]],
  [D.HILLS]: [['passerby', 7], ['employee', 2], ['courier', 1]],
};
const SPEEDS: Record<string, [number, number]> = {
  passerby: [24, 34], employee: [32, 40], tourist: [18, 26], courier: [52, 62], worker: [26, 34], shopkeeper: [24, 28], robot: [22, 24], cop: [26, 30], guard: [26, 28],
};

/** Vie des habitants : apparition autour du joueur, routines, réactions. */
export class PedSystem {
  private queue: Ped[] = [];
  private doors: { tx: number; ty: number }[] = [];
  private spawnT = 0;
  /** Répliques ajoutées par les changements hebdomadaires. */
  extraChatter: string[] = [];

  constructor(private w: World) {
    const m = w.map;
    for (const b of m.buildings) {
      const tx = b.doorX, ty = b.y + b.h;
      if ((b.sign || b.poi) && m.inb(tx, ty) && m.reach[m.idx(tx, ty)]) this.doors.push({ tx, ty });
    }
    for (const id of ['parc', 'marche', 'plage', 'spawn']) { const p = m.pois.get(id); if (p) this.doors.push({ tx: p.tx, ty: p.ty }); }
  }

  get civilCount(): number { let n = 0; for (const p of this.w.peds) if (p.role === 'civil') n++; return n; }

  say(p: Ped, text: string, ttl = 2.4): void {
    if (p.bubbleCd > 0) return;
    p.bubbleCd = ttl + 1.5;
    this.w.bus.emit('bubble', { id: p.id, x: p.x, y: p.y, text, ttl });
  }

  /** Garde-robe finie par profil : la mémoire graphique reste bornée, même après des heures de jeu. */
  private wardrobe = new Map<ProfileKey, Look[]>();
  private pickLook(profile: ProfileKey): Look {
    let pool = this.wardrobe.get(profile);
    if (!pool) { pool = []; this.wardrobe.set(profile, pool); }
    const max = profile === 'passerby' ? 16 : profile === 'robot' ? 1 : 8;
    if (pool.length < max) { const l = randomLook(profile, this.w.rng); pool.push(l); return l; }
    return this.w.rng.pick(pool);
  }

  spawn(x: number, y: number, profile: ProfileKey, look?: Look): Ped {
    const w = this.w;
    const p = new Ped(x, y, profile, look ?? this.pickLook(profile));
    const sp = SPEEDS[profile] ?? SPEEDS.passerby;
    p.speed = w.rng.range(sp[0], sp[1]);
    p.offX = w.rng.range(-3.5, 3.5); p.offY = w.rng.range(-3.5, 3.5);
    p.angle = w.rng.range(-Math.PI, Math.PI);
    p.timer = w.rng.range(0.2, 1.5);
    w.peds.push(p);
    return p;
  }
  /** Personnage immobile (donneur de mission, client, etc.). */
  spawnStatic(x: number, y: number, profile: ProfileKey, look: Look | undefined, tag: string, name: string): Ped {
    const p = this.spawn(x, y, profile, look);
    p.role = 'npc'; p.state = 'static'; p.tag = tag; p.name = name; p.angle = Math.PI / 2;
    return p;
  }

  update(dt: number): void {
    const w = this.w;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 0.12; this.trySpawn(); }
    for (let k = 0; k < 2 && this.queue.length; k++) this.solvePath(this.queue.shift()!);

    const despawnR = Math.max(w.viewW, w.viewH) * 0.5 + 240;
    for (const p of w.peds) {
      if (p.bubbleCd > 0) p.bubbleCd -= dt;
      if (p.role !== 'civil') continue;
      if (dist(p.x, p.y, w.focusX, w.focusY) > despawnR && !w.inView(p.x, p.y, 20)) { p.remove = true; continue; }
      this.updateCivil(p, dt);
    }
    this.separate();
  }

  private trySpawn(): void {
    const w = this.w, m = w.map;
    const d = m.districtAtPx(w.focusX, w.focusY);
    const target = Math.round(DENSITY[d] * w.quality.peds * w.mods.pedFactor);
    if (this.civilCount >= target) return;
    const half = Math.max(w.viewW, w.viewH) * 0.5;
    for (let t = 0; t < 6; t++) {
      const a = w.rng.range(0, Math.PI * 2), r = w.rng.range(half * 0.75, half + 150);
      const x = w.focusX + Math.cos(a) * r, y = w.focusY + Math.sin(a) * r;
      if (w.inView(x, y, 16)) continue;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (!m.inb(tx, ty)) continue;
      const k = m.kind[m.idx(tx, ty)];
      if ((k !== T.SIDEWALK && k !== T.PLAZA && k !== T.PATH) || !m.reach[m.idx(tx, ty)]) continue;
      const td = m.districtAt(tx, ty);
      let profile: ProfileKey = w.rng.weighted(PROFILE_WEIGHTS[td], (e) => e[1])[0];
      if (w.mods.robotShare > 0 && w.rng.chance(w.mods.robotShare)) profile = 'robot';
      // Un commerçant devant sa boutique de temps en temps.
      if (w.rng.chance(0.14)) {
        const door = this.doors.find((dd) => Math.abs(dd.tx - tx) < 6 && Math.abs(dd.ty - ty) < 6 && !w.inView((dd.tx + 0.5) * TILE, (dd.ty + 0.5) * TILE, 16));
        if (door && !w.peds.some((q) => q.profile === 'shopkeeper' && Math.abs(q.homeX - (door.tx + 0.5) * TILE) < 2)) {
          const s = this.spawn((door.tx + 0.5) * TILE + 7, (door.ty + 0.5) * TILE - 3, 'shopkeeper');
          s.homeX = (door.tx + 0.5) * TILE; s.homeY = (door.ty + 0.5) * TILE; s.state = 'idle'; s.timer = 9999; s.angle = Math.PI / 2;
          return;
        }
      }
      const p = this.spawn((tx + 0.5) * TILE, (ty + 0.5) * TILE, profile);
      this.requestPath(p);
      return;
    }
  }

  requestPath(p: Ped): void {
    if (p.pendingPath) return;
    p.pendingPath = true; p.path = null;
    this.queue.push(p);
  }

  private solvePath(p: Ped): void {
    const w = this.w, m = w.map;
    p.pendingPath = false;
    if (p.remove) return;
    let dest: { tx: number; ty: number } | null = null;
    for (let t = 0; t < 10 && !dest; t++) {
      const c = w.rng.pick(this.doors);
      const d = Math.max(Math.abs(c.tx - p.tx), Math.abs(c.ty - p.ty));
      if (d > 5 && d < 40) dest = c;
    }
    if (!dest) {
      for (let t = 0; t < 8 && !dest; t++) {
        const tx = p.tx + w.rng.int(-22, 22), ty = p.ty + w.rng.int(-22, 22);
        if (m.inb(tx, ty) && m.reach[m.idx(tx, ty)] && m.kind[m.idx(tx, ty)] === T.SIDEWALK) dest = { tx, ty };
      }
    }
    const path = dest ? findPath(m, p.tx, p.ty, dest.tx, dest.ty, { roadCost: 9, maxNodes: 5000 }) : null;
    if (!path || path.length < 2) {
      p.pathFails++;
      p.state = 'idle'; p.timer = 2 + w.rng.next() * 2;
      if (p.pathFails > 3 && !w.inView(p.x, p.y, 0)) p.remove = true;
      return;
    }
    p.pathFails = 0; p.path = path; p.pi = 1;
    if (p.state === 'idle' || p.state === 'walk') p.state = 'walk';
  }

  private safeToCross(p: Ped, tx: number, ty: number): boolean {
    const w = this.w, m = w.map;
    const dir = m.rdir[m.idx(tx, ty)];
    let sig = null;
    for (const n of m.nodes) {
      if (!n.signal) continue;
      if (Math.abs(n.cx / TILE - tx) < 7 && Math.abs(n.cy / TILE - ty) < 7) { sig = n; break; }
    }
    if (sig && dir !== 3) {
      // On traverse une chaussée verticale quand les voitures nord-sud ont le rouge, et inversement.
      if (w.mods.lightsMode === 'blink') return this.noCarNear(p, 56);
      return m.signalState(sig, dir === 2, w.time) === 'r' && this.noCarNear(p, 26);
    }
    return this.noCarNear(p, 60);
  }
  private noCarNear(p: Ped, r: number): boolean {
    for (const v of this.w.vehicles) {
      if (v.speed < 22) continue;
      if (Math.abs(v.x - p.x) < r && Math.abs(v.y - p.y) < r) return false;
    }
    return true;
  }

  private updateCivil(p: Ped, dt: number): void {
    const w = this.w, m = w.map;
    switch (p.state) {
      case 'walk': {
        if (!p.path) { if (!p.pendingPath) this.requestPath(p); p.stop(); break; }
        if (p.pi >= p.path.length) { this.arrive(p); break; }
        const node = p.path[p.pi];
        const nk = m.kind[m.idx(node.tx, node.ty)], ck = m.kindAtPx(p.x, p.y);
        const onRoad = m.isRoadKind(ck);
        if (m.isRoadKind(nk) && !onRoad) {
          p.checkT -= dt;
          if (p.checkT <= 0) {
            p.checkT = 0.3;
            if (!this.safeToCross(p, node.tx, node.ty)) { p.state = 'wait'; p.waitT = 0; p.stop(); break; }
          }
        }
        const gx = (node.tx + 0.5) * TILE + p.offX, gy = (node.ty + 0.5) * TILE + p.offY;
        const d = p.moveToward(gx, gy, p.speed * (onRoad ? 1.5 : 1), dt, m);
        if (d < 3.5) p.pi++;
        // Coincé contre un obstacle : on recalcule.
        if (p.moving && Math.hypot(p.vx, p.vy) > 1) { p.waitT = 0; }
        break;
      }
      case 'wait': {
        p.stop();
        p.waitT += dt; p.checkT -= dt;
        if (p.checkT <= 0 && p.path && p.pi < p.path.length) {
          p.checkT = 0.3;
          const node = p.path[p.pi];
          if (p.waitT > 9 || this.safeToCross(p, node.tx, node.ty)) { p.state = 'walk'; p.checkT = 1.2; }
        } else if (!p.path) p.state = 'idle';
        break;
      }
      case 'idle': {
        p.stop();
        p.timer -= dt;
        if (p.profile === 'shopkeeper') {
          if (w.rng.chance(dt * 0.06) && dist(p.x, p.y, w.player.x, w.player.y) < 60) this.say(p, w.rng.pick(SHOP_LINES));
          break;
        }
        if (p.timer <= 0) { p.state = 'walk'; this.requestPath(p); }
        break;
      }
      case 'chat': {
        p.stop();
        const q = p.partner;
        if (!q || q.remove || q.state !== 'chat') { p.state = 'idle'; p.timer = 0.5; p.partner = null; break; }
        p.face(q.x, q.y, dt);
        p.timer -= dt;
        if (p.chatStep === 0 && p.timer < 4.6 && p.ai === 'lead') { p.chatStep = 1; p.bubbleCd = 0; this.say(p, CHAT_PAIRS[p.chatIdx][0], 2.2); }
        if (p.chatStep === 0 && p.timer < 2.4 && p.ai !== 'lead') { p.chatStep = 1; p.bubbleCd = 0; this.say(p, CHAT_PAIRS[p.chatIdx][1], 2.2); }
        if (p.timer <= 0) { p.state = 'idle'; p.timer = w.rng.range(0.3, 1.5); p.partner = null; p.ai = null; }
        break;
      }
      case 'look': {
        p.stop();
        p.face(p.lookX, p.lookY, dt);
        p.timer -= dt;
        if (p.timer <= 0) { p.state = p.path && p.pi < p.path.length ? 'walk' : 'idle'; p.timer = 1; }
        break;
      }
      case 'flee': {
        p.timer -= dt;
        let ax = p.x - p.fleeX, ay = p.y - p.fleeY;
        const d = Math.hypot(ax, ay) || 1;
        ax /= d; ay /= d;
        const bx = p.x, by = p.y;
        p.moveDir(ax, ay, 78, dt, m);
        // Bloqué par un mur : on glisse perpendiculairement.
        if (Math.hypot(p.x - bx, p.y - by) < 78 * dt * 0.4) p.moveDir(-ay * (p.id % 2 ? 1 : -1), ax * (p.id % 2 ? 1 : -1), 78, dt, m);
        if (p.timer <= 0) { p.state = 'idle'; p.timer = w.rng.range(1, 2.5); p.path = null; }
        break;
      }
      case 'down': {
        p.vx *= Math.exp(-6 * dt); p.vy *= Math.exp(-6 * dt);
        p.integrate(dt, m);
        p.moving = false;
        p.timer -= dt;
        if (p.timer <= 0) { p.state = 'flee'; p.timer = 4; }
        break;
      }
      default: p.stop();
    }
  }

  private arrive(p: Ped): void {
    const w = this.w;
    p.path = null; p.stop();
    p.state = 'idle';
    p.timer = p.profile === 'tourist' ? w.rng.range(5, 10) : p.profile === 'courier' ? w.rng.range(1, 2.5) : w.rng.range(3, 9);
    p.angle = -Math.PI / 2; // face à la vitrine
    if (w.inView(p.x, p.y, 0)) {
      if (p.profile === 'tourist') { this.say(p, w.rng.pick(TOURIST_LINES)); w.bus.emit('flash', { x: p.x, y: p.y }); }
      else if (p.profile === 'robot') this.say(p, w.rng.pick(ROBOT_LINES));
      else if (w.rng.chance(0.25)) this.say(p, w.rng.pick(this.extraChatter.length && w.rng.chance(0.5) ? this.extraChatter : IDLE_LINES));
    }
    // Discussion avec un voisin à l'arrêt.
    for (const q of w.peds) {
      if (q === p || q.role !== 'civil' || q.state !== 'idle' || q.profile === 'shopkeeper' || q.partner) continue;
      if (dist(p.x, p.y, q.x, q.y) < 26 && w.rng.chance(0.7)) {
        const idx = w.rng.int(0, CHAT_PAIRS.length - 1);
        for (const [a, b, lead] of [[p, q, 'lead'], [q, p, 'follow']] as [Ped, Ped, string][]) {
          a.state = 'chat'; a.partner = b; a.timer = 5; a.chatIdx = idx; a.chatStep = 0; a.ai = lead;
        }
        break;
      }
    }
  }

  private separate(): void {
    const peds = this.w.peds;
    for (let i = 0; i < peds.length; i++) {
      const a = peds[i];
      if (a.state === 'down') continue;
      for (let j = i + 1; j < peds.length; j++) {
        const b = peds[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx > 8 || dx < -8 || dy > 8 || dy < -8) continue;
        const d = Math.hypot(dx, dy);
        if (d >= 7 || d < 0.01) continue;
        const push = (7 - d) * 0.5;
        const ux = dx / d, uy = dy / d;
        if (a.state !== 'static') { a.x -= ux * push; a.y -= uy * push; }
        if (b.state !== 'static') { b.x += ux * push; b.y += uy * push; }
      }
    }
  }

  /** Réaction collective à un événement sonore ou dangereux. */
  react(type: 'honk' | 'crash' | 'danger', x: number, y: number, radius: number): void {
    const w = this.w;
    for (const p of w.peds) {
      if (p.role !== 'civil' || p.state === 'down') continue;
      const d = dist(p.x, p.y, x, y);
      if (d > radius) continue;
      if (type === 'danger') {
        if (p.state !== 'flee') { p.fleeX = x; p.fleeY = y; p.state = 'flee'; p.timer = w.rng.range(3.5, 6); p.partner = null; if (w.rng.chance(0.4)) this.say(p, w.rng.pick(FLEE_LINES), 1.6); }
      } else if (p.state === 'walk' || p.state === 'idle' || p.state === 'wait' || p.state === 'chat') {
        if (p.profile === 'shopkeeper' && type === 'honk') continue;
        const onRoad = w.map.isRoadKind(w.map.kindAtPx(p.x, p.y));
        if (type === 'honk' && onRoad) { p.speed = Math.min(60, p.speed * 1.5); if (p.state === 'wait') p.state = 'walk'; continue; }
        if (type === 'honk' && d > 70) continue;
        if (onRoad) continue;
        p.lookX = x; p.lookY = y; p.partner = null;
        p.state = 'look'; p.timer = type === 'crash' ? w.rng.range(2, 4) : w.rng.range(0.8, 1.6);
        if (w.rng.chance(type === 'crash' ? 0.35 : 0.3)) this.say(p, w.rng.pick(type === 'crash' ? CRASH_LINES : HONK_LINES), 2);
      }
    }
  }

  knock(p: Ped, vx: number, vy: number, fromX: number, fromY: number): void {
    p.state = 'down'; p.timer = this.w.rng.range(2.2, 3.6);
    p.vx = vx; p.vy = vy; p.fleeX = fromX; p.fleeY = fromY; p.partner = null;
    p.bubbleCd = 0;
  }
}
