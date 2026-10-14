import { TILE } from '../engine/config';
import { angleDiff, clamp, dist } from '../engine/math';
import { findPath } from '../map/pathfinding';
import type { TilePt } from '../map/pathfinding';
import { lookKey, randomLook, zombieLook } from '../npc/looks';
import { ZOMBIE_BITE_LINES, ZOMBIE_CURED_LINES, ZOMBIE_LINES, ZOMBIE_STUN_LINES } from '../npc/chatter';
import { Vehicle } from '../vehicles/Vehicle';
import type { VehicleType } from '../vehicles/specs';
import type { Ped } from '../npc/Ped';
import type { DriveAI } from '../traffic/TrafficSystem';
import type { World } from '../world/World';
import { resolveLoc } from './validate';
import type { Action, ItemDef, Loc, MissionDef, Step } from './schema';

export interface Marker { x: number; y: number; kind: 'target' | 'item' | 'npc' | 'vehicle' | 'checkpoint'; radius?: number; dim?: boolean; }
export interface Meter { label: string; value: number; tone: 'warn' | 'good'; }
export interface GuardState { kind: 'guard'; pts: { x: number; y: number }[]; idx: number; dir: number; loop: boolean; pause: number; detect: number; }
export type RunnerState = 'idle' | 'running' | 'success' | 'failed';

export interface ZombieState {
  kind: 'zombie'; homeX: number; homeY: number; aggro: number; locked: boolean;
  stun: number; fx: number; fy: number; groan: number; wander: number; wx: number; wy: number;
  path: TilePt[] | null; pi: number; pathT: number;
}
/** Portée du klaxon et du cri sur les zombies (pixels). */
export const HORN_SCARE = 130;
export const SHOUT_SCARE = 72;
const ZOMBIE_CAP = 30;

export const GUARD_RANGE = 92;
export const GUARD_FOV = 0.62;

/** Exécute une mission décrite en données : étapes, chronomètre, échecs, récompense. */
export class MissionRunner {
  state: RunnerState = 'idle';
  stepIndex = -1;
  stepTime = 0;
  timeLeft: number | null = null;
  meter: Meter | null = null;
  markers: Marker[] = [];
  prompt: { label: string; x: number; y: number } | null = null;
  hint: string | null = null;
  objective = '';
  guards: Ped[] = [];
  zombies: Ped[] = [];
  /** Morsures reçues pendant la mission. */
  bites = 0;
  private biteCd = 0;
  private pathBudget = 0;
  detected = false;
  failReason = '';
  checkpointStep = 0;
  private tagged = new Map<string, (Ped | Vehicle)[]>();
  private waiting = false;
  private fired = new Set<number>();
  private st: any = {};
  private carried: ItemDef | null = null;
  /** Coopération : dernière étape terminée par un coéquipier, appliquée dès que possible. */
  private pendingSkip = -1;
  /** Coopération : objets déjà ramassés par l'équipe à l'étape en cours. */
  private teamCollected = new Set<number>();

  constructor(private w: World, public def: MissionDef) {}

  get step(): Step | null { return this.def.steps[this.stepIndex] ?? null; }
  get progress(): string { return `${Math.min(this.stepIndex + 1, this.def.steps.length)}/${this.def.steps.length}`; }

  start(fromStep = 0): void {
    this.state = 'running';
    this.run(this.def.setup);
    // Reprise : on rend l'objet transporté s'il avait déjà été ramassé.
    for (let i = 0; i < fromStep; i++) {
      const s = this.def.steps[i];
      if (s.type === 'pickup') this.carried = s.item;
      if (s.type === 'deliver') this.carried = null;
    }
    this.w.player.carrying = this.carried?.id ?? null;
    this.begin(fromStep);
  }

  private tag(tag: string, e: Ped | Vehicle): void {
    e.tag = e.tag || `m:${tag}`;
    let list = this.tagged.get(tag);
    if (!list) { list = []; this.tagged.set(tag, list); }
    list.push(e);
  }
  private despawn(tag: string): void {
    for (const e of this.tagged.get(tag) ?? []) {
      if (e instanceof Vehicle && this.w.player.vehicle === e) { e.tag = ''; continue; }
      e.remove = true;
    }
    this.tagged.delete(tag);
  }
  private pos(loc: Loc): { x: number; y: number } { return resolveLoc(this.w.map, loc); }

  private run(actions?: Action[]): void {
    if (!actions) return;
    const w = this.w;
    for (const a of actions) {
      switch (a.do) {
        case 'toast': w.bus.emit('toast', { text: a.text, kind: 'info', ttl: 4 }); break;
        case 'say': w.bus.emit('toast', { text: `${a.who} : « ${a.text} »`, kind: 'info', ttl: 5 }); w.bus.emit('sfx', { name: 'phone' }); break;
        case 'dialog': this.waiting = true; w.showDialog(a.lines.map((l) => this.line(l)), () => { this.waiting = false; }); break;
        case 'reveal': this.waiting = true; w.showReveal(a.title, a.text, () => { this.waiting = false; }); break;
        case 'spawn_npc': { const p = this.pos(a.npc.at); this.tag(a.tag, w.pedSys.spawnStatic(p.x, p.y, a.npc.profile, undefined, `m:${a.tag}`, a.npc.name)); break; }
        case 'spawn_vehicle': {
          const p = this.pos(a.at);
          const r = w.map.nearestRoadPoint(p.x, p.y);
          const near = dist(r.x, r.y, p.x, p.y) < 90 ? r : { x: p.x, y: p.y, angle: 0 };
          const v = new Vehicle(a.vehicle, near.x, near.y, near.angle, w.rng.pick(w.vehicleColors(a.vehicle)));
          if (a.broken) { v.hp = 0; v.smoke = 1; }
          w.vehicles.push(v); this.tag(a.tag, v);
          break;
        }
        case 'spawn_guards': this.spawnGuards(a.routes); break;
        case 'despawn': this.despawn(a.tag); break;
        case 'wanted': w.wanted.setLevel(a.level); break;
        case 'sfx': w.bus.emit('sfx', { name: a.name }); break;
        case 'zombies': this.spawnZombies(a.at, a.count, a.spread ?? 5, a.aggro ?? 9); break;
        case 'cure_zombies': this.cureZombies(); break;
        case 'world': {
          const until = w.time + a.seconds;
          if (a.set === 'traffic') w.mods.setTemp('trafficFactor', a.value, until);
          else if (a.set === 'pedestrians') w.mods.setTemp('pedFactor', a.value, until);
          else if (a.set === 'robots') w.mods.setTemp('robotShare', clamp(a.value, 0, 0.6), until);
          else if (a.set === 'lights_blink') w.mods.setTemp('lightsMode', a.value > 0 ? 'blink' : 'normal', until);
          break;
        }
      }
    }
  }
  line(l: { who: string; text: string }): { who: string; text: string; look?: string } {
    if (l.who === 'giver') return { who: this.def.giver.name, text: l.text, look: 'giver' };
    if (l.who === 'player') return { who: this.w.player.name || 'Toi', text: l.text, look: 'player' };
    return { who: l.who, text: l.text };
  }

  private spawnGuards(key: string): void {
    const w = this.w;
    for (const g of this.guards) g.remove = true;
    this.guards = [];
    for (const route of w.map.guardRoutes[key] ?? []) {
      const pts = route.points.map((p) => ({ x: (p.tx + 0.5) * TILE, y: (p.ty + 0.5) * TILE }));
      const ped = w.pedSys.spawn(pts[0].x, pts[0].y, 'guard');
      ped.role = 'guard'; ped.state = 'seek'; ped.speed = 30; ped.tag = 'm:guard'; ped.name = 'Vigile';
      ped.ai = { kind: 'guard', pts, idx: 1 % pts.length, dir: 1, loop: route.loop, pause: 0, detect: 0 } as GuardState;
      ped.angle = Math.atan2(pts[1 % pts.length].y - pts[0].y, pts[1 % pts.length].x - pts[0].x);
      this.guards.push(ped);
    }
  }
  private updateGuards(dt: number): number {
    const w = this.w, p = w.player;
    let max = 0;
    for (const g of this.guards) {
      const ai = g.ai as GuardState;
      if (ai.pause > 0) {
        ai.pause -= dt; g.stop();
        g.angle += Math.sin(w.time * 2.2 + g.id) * dt * 0.9; // regarde autour de lui
      } else {
        const t = ai.pts[ai.idx];
        if (g.moveToward(t.x, t.y, g.speed, dt, w.map) < 3) {
          ai.pause = 1.1;
          if (ai.loop) ai.idx = (ai.idx + 1) % ai.pts.length;
          else { if (ai.idx + ai.dir < 0 || ai.idx + ai.dir >= ai.pts.length) ai.dir = -ai.dir; ai.idx += ai.dir; }
        }
      }
      const d = dist(g.x, g.y, p.px, p.py);
      let sees = false;
      if (d < 13) sees = true;
      else if (d < GUARD_RANGE) {
        const a = Math.atan2(p.py - g.y, p.px - g.x);
        sees = Math.abs(angleDiff(g.angle, a)) < GUARD_FOV && w.map.lineOfSight(g.x, g.y, p.px, p.py);
      }
      ai.detect = clamp(ai.detect + (sees ? dt * (d < 40 ? 2.8 : 1.5) : -dt * 0.8), 0, 1);
      if (sees && ai.pause <= 0 && ai.detect > 0.4) { g.stop(); g.face(p.px, p.py, dt, 6); }
      if (ai.detect > max) max = ai.detect;
    }
    if (max >= 1 && !this.detected) { this.detected = true; w.bus.emit('sfx', { name: 'alarm' }); }
    return max;
  }

  // ---------- Zombies ----------
  get maxBites(): number { return this.def.bites ?? 3; }
  private spawnZombies(at: Loc, count: number, spread: number, aggro: number): void {
    const w = this.w, m = w.map, c = this.pos(at);
    const p = w.player;
    for (let k = 0; k < count && this.zombies.length < ZOMBIE_CAP; k++) {
      let spot: { x: number; y: number } | null = null;
      for (let t = 0; t < 14 && !spot; t++) {
        const tx = Math.floor(c.x / TILE) + w.rng.int(-spread, spread), ty = Math.floor(c.y / TILE) + w.rng.int(-spread, spread);
        if (!m.inb(tx, ty)) continue;
        const q = m.nearestWalkable(tx, ty, 4);
        if (!m.reach[m.idx(q.tx, q.ty)]) continue;
        const x = (q.tx + 0.5) * TILE, y = (q.ty + 0.5) * TILE;
        if (dist(x, y, p.px, p.py) < 70) continue; // jamais sous le nez du joueur
        spot = { x, y };
      }
      if (!spot) continue;
      const z = w.pedSys.spawn(spot.x, spot.y, 'passerby', zombieLook(w.rng));
      z.role = 'zombie'; z.state = 'seek'; z.name = 'Zombie'; z.speed = w.rng.range(27, 37);
      z.ai = { kind: 'zombie', homeX: spot.x, homeY: spot.y, aggro: aggro * TILE, locked: false, stun: 0, fx: 0, fy: 0, groan: w.rng.range(1, 6), wander: 0, wx: spot.x, wy: spot.y, path: null, pi: 0, pathT: 0 } as ZombieState;
      this.tag('zombies', z);
      this.zombies.push(z);
    }
  }
  private cureZombies(): void {
    const w = this.w;
    for (const z of this.zombies) {
      if (z.remove) continue;
      z.look = randomLook('employee', w.rng); z.lookKey = lookKey(z.look);
      z.role = 'civil'; z.state = 'idle'; z.timer = w.rng.range(2, 5); z.ai = null; z.tag = ''; z.name = ''; z.speed = w.rng.range(26, 34);
      z.stop(); z.bubbleCd = 0;
      if (w.inView(z.x, z.y, 0) && w.rng.chance(0.7)) w.pedSys.say(z, w.rng.pick(ZOMBIE_CURED_LINES), 2.6);
      w.bus.emit('flash', { x: z.x, y: z.y });
    }
    this.tagged.delete('zombies');
    this.zombies = [];
    w.bus.emit('sfx', { name: 'cure' });
  }
  private updateZombies(dt: number): void {
    const w = this.w, m = w.map, p = w.player;
    this.zombies = this.zombies.filter((z) => !z.remove);
    if (!this.zombies.length) return;
    this.biteCd -= dt;
    this.pathBudget = 2;
    const px = p.px, py = p.py;
    const scare = w.playerHonked ? HORN_SCARE : w.playerShouted ? SHOUT_SCARE : 0;
    let groaned = false;
    for (const z of this.zombies) {
      const ai = z.ai as ZombieState;
      if (z.state === 'down') {
        // Renversé par une voiture : il glisse, puis se relève.
        z.vx *= Math.exp(-6 * dt); z.vy *= Math.exp(-6 * dt);
        z.integrate(dt, m); z.moving = false;
        z.timer -= dt;
        if (z.timer <= 0) { z.state = 'seek'; ai.stun = 0.8; ai.fx = z.x; ai.fy = z.y; }
        continue;
      }
      const d = dist(z.x, z.y, px, py);
      if (scare && d < scare) {
        if (ai.stun <= 0.3 && w.rng.chance(0.4)) w.pedSys.say(z, w.rng.pick(ZOMBIE_STUN_LINES), 1.4);
        ai.stun = w.rng.range(2, 2.8); ai.fx = px; ai.fy = py; ai.path = null;
      }
      if (ai.stun > 0) {
        ai.stun -= dt;
        // Recule en se bouchant les oreilles.
        let ax = z.x - ai.fx, ay = z.y - ai.fy;
        const n = Math.hypot(ax, ay) || 1; ax /= n; ay /= n;
        const bx = z.x, by = z.y;
        z.moveDir(ax, ay, 44, dt, m);
        if (Math.hypot(z.x - bx, z.y - by) < 44 * dt * 0.4) z.moveDir(-ay, ax, 44, dt, m);
        continue;
      }
      const chase = d < ai.aggro || (ai.locked && d < ai.aggro * 1.8);
      ai.locked = chase;
      if (chase) {
        if (m.lineOfSight(z.x, z.y, px, py)) { ai.path = null; z.moveToward(px, py, z.speed, dt, m); }
        else {
          ai.pathT -= dt;
          if ((!ai.path || ai.pathT <= 0) && this.pathBudget > 0) {
            this.pathBudget--; ai.pathT = 1.4;
            ai.path = findPath(m, z.tx, z.ty, Math.floor(px / TILE), Math.floor(py / TILE), { roadCost: 1, maxNodes: 1600 }); ai.pi = 1;
          }
          const node = ai.path?.[ai.pi];
          if (node) { if (z.moveToward((node.tx + 0.5) * TILE, (node.ty + 0.5) * TILE, z.speed, dt, m) < 4) ai.pi++; }
          else z.moveToward(px, py, z.speed, dt, m);
        }
      } else {
        // Déambulation lente autour de son point d'apparition.
        ai.wander -= dt;
        if (ai.wander <= 0) { ai.wander = w.rng.range(2, 5); ai.wx = ai.homeX + w.rng.range(-40, 40); ai.wy = ai.homeY + w.rng.range(-40, 40); }
        if (z.moveToward(ai.wx, ai.wy, z.speed * 0.45, dt, m) < 3) z.stop();
      }
      // Morsure : seulement à pied, une à la fois.
      if (p.onFoot && !w.attract && d < 9 && this.biteCd <= 0) {
        this.bites++;
        this.biteCd = 1.5; ai.stun = 1.3; ai.fx = px; ai.fy = py;
        const k = d || 1;
        p.state = 'stunned'; p.timer = 0.45; p.vx = ((px - z.x) / k) * 80; p.vy = ((py - z.y) / k) * 80;
        z.bubbleCd = 0; w.pedSys.say(z, w.rng.pick(ZOMBIE_BITE_LINES), 1.6);
        w.bus.emit('sfx', { name: 'bite', x: px, y: py });
        w.bus.emit('toast', { text: `Morsure ! (${this.bites}/${this.maxBites})`, kind: 'bad', ttl: 2 });
        if (this.bites >= this.maxBites) { this.fail('Trop de morsures : tu rejoins le club du café'); return; }
      }
      // Grognements, avec modération.
      ai.groan -= dt;
      if (ai.groan <= 0) {
        ai.groan = w.rng.range(4, 9);
        if (!groaned && d < 220 && w.inView(z.x, z.y, 0)) { groaned = true; w.pedSys.say(z, w.rng.pick(ZOMBIE_LINES), 1.8); if (w.rng.chance(0.5)) w.bus.emit('sfx', { name: 'groan', x: z.x, y: z.y }); }
      }
    }
  }

  private begin(i: number): void {
    const w = this.w;
    this.stepIndex = i;
    const s = this.def.steps[i];
    this.stepTime = 0; this.timeLeft = s.timeLimit ?? null;
    this.meter = null; this.hint = null; this.prompt = null; this.markers = []; this.st = {}; this.fired.clear();
    if (s.checkpoint || i === 0) this.checkpointStep = i;
    this.teamCollected.clear();
    this.objective = s.objective;
    this.run(s.onStart);
    const st = this.st;
    switch (s.type) {
      case 'talk': {
        const tag = s.tag ?? `talk${i}`;
        let ped = (this.tagged.get(tag) ?? [])[0] as Ped | undefined;
        if (!ped) { const p = this.pos(s.npc.at); ped = w.pedSys.spawnStatic(p.x, p.y, s.npc.profile, undefined, `m:${tag}`, s.npc.name); this.tag(tag, ped); }
        st.ped = ped;
        break;
      }
      case 'goto': case 'deliver': case 'observe': case 'leave': case 'pickup': st.p = this.pos(s.target); st.t = 0; st.hits = 0; st.cd = 0; break;
      case 'collect': st.left = s.targets.map((t, idx) => ({ ...this.pos(t), idx })).filter((q) => !this.teamCollected.has(q.idx)); st.total = s.targets.length; break;
      case 'checkpoints': st.pts = s.targets.map((t) => this.pos(t)); st.idx = 0; break;
      case 'tail': {
        const m = w.map;
        const nodes = s.route.map((l) => { const p = this.pos(l); return m.nearestNode(p.x, p.y, true).id; });
        const full: number[] = [nodes[0]];
        for (let k = 0; k + 1 < nodes.length; k++) { const seg = m.routeNodes(nodes[k], nodes[k + 1], true); for (let j = 1; j < seg.length; j++) full.push(seg[j]); }
        const color = s.color ? parseInt(s.color.slice(1), 16) : 0x8a5cff;
        const v = w.traffic.spawnRouted(s.vehicle, color, full, s.speed);
        if (!v) { this.fail('Itinéraire introuvable'); return; }
        (v.ai as DriveAI).hold = true; v.vx = 0; v.vy = 0;
        this.tag('tail', v);
        st.v = v; st.phase = 'approach'; st.susp = 0; st.lost = 0;
        break;
      }
      case 'passengers': st.idx = 0; st.phase = 'pickup'; this.spawnFare(s, 0); break;
      default: break;
    }
    w.bus.emit('objective', { text: this.objective });
    this.update(0);
  }
  private spawnFare(s: Extract<Step, { type: 'passengers' }>, idx: number): void {
    const f = s.fares[idx];
    const p = this.pos(f.from);
    const ped = this.w.pedSys.spawnStatic(p.x, p.y, f.profile ?? 'passerby', undefined, 'm:fare', f.name);
    this.tag('fare', ped);
    this.st.ped = ped; this.st.from = p; this.st.to = this.pos(f.to);
  }

  private next(): void {
    const s = this.step!;
    this.w.bus.emit('missionStep', { id: this.def.id, step: this.stepIndex });
    this.run(s.onComplete);
    this.w.bus.emit('sfx', { name: 'step' });
    if (this.stepIndex + 1 >= this.def.steps.length) this.finish();
    else this.begin(this.stepIndex + 1);
  }
  private finish(): void {
    const w = this.w;
    this.markers = []; this.prompt = null; this.meter = null; this.timeLeft = null; this.hint = null;
    const done = () => { this.state = 'success'; };
    const outro = () => { if (this.def.outro?.length) w.showDialog(this.def.outro.map((l) => this.line(l)), done); else done(); };
    this.waiting = true;
    // La chute d'abord, le mot de la fin ensuite.
    if (this.def.punchline) w.showReveal(this.def.punchline.title, this.def.punchline.text, outro); else outro();
  }
  fail(reason: string): void {
    if (this.state !== 'running') return;
    this.state = 'failed'; this.failReason = reason;
  }
  /** Retire tout ce que la mission a créé. */
  cleanup(): void {
    for (const tag of [...this.tagged.keys()]) this.despawn(tag);
    for (const g of this.guards) g.remove = true;
    this.guards = [];
    for (const z of this.zombies) z.remove = true;
    this.zombies = [];
    this.w.mods.clearTemp();
    this.w.player.carrying = null;
    this.markers = []; this.prompt = null; this.meter = null;
  }

  private modeOk(mode?: string): boolean {
    const p = this.w.player;
    return !mode || mode === 'any' || (mode === 'foot' ? p.onFoot : p.driving);
  }

  /** Touche d'interaction : renvoie true si la mission l'a consommée. */
  interact(): boolean {
    if (this.state !== 'running' || this.waiting || !this.prompt) return false;
    const w = this.w, s = this.step!;
    if (s.type === 'talk') {
      this.waiting = true;
      w.showDialog(s.lines.map((l) => (l.who === 'npc' ? { who: s.npc.name, text: l.text } : this.line(l))), () => { this.waiting = false; this.next(); });
      return true;
    }
    if (s.type === 'pickup') {
      this.carried = s.item; w.player.carrying = s.item.id;
      w.bus.emit('sfx', { name: 'pickup' });
      w.bus.emit('toast', { text: `Récupéré : ${s.item.name}`, kind: 'good' });
      this.next();
      return true;
    }
    return false;
  }

  // ---------- Coopération ----------
  /** Un coéquipier a terminé l'étape `step` : on avance aussi (dès que l'écran de dialogue éventuel est fermé). */
  teamStepDone(step: number): void {
    if (this.state !== 'running' || step < this.stepIndex) return;
    this.pendingSkip = Math.max(this.pendingSkip, step);
  }
  /** Un coéquipier a ramassé l'objet `idx` de l'étape `step`. */
  teamCollect(step: number, idx: number): void {
    if (this.state !== 'running' || step !== this.stepIndex) return;
    this.teamCollected.add(idx);
    const s = this.step;
    if (s?.type === 'collect' && Array.isArray(this.st.left)) this.st.left = (this.st.left as { idx: number }[]).filter((q) => q.idx !== idx);
  }
  /** Objets déjà ramassés à l'étape en cours (pour mettre à jour un coéquipier qui arrive). */
  collectedNow(): number[] {
    const s = this.step;
    if (s?.type !== 'collect' || !Array.isArray(this.st.left)) return [];
    const left = new Set((this.st.left as { idx: number }[]).map((q) => q.idx));
    return s.targets.map((_, i) => i).filter((i) => !left.has(i));
  }
  /** Saute directement à l'étape `target` (terminée ailleurs par l'équipe). Les dialogues des étapes sautées ne sont pas rejoués. */
  private skipTo(target: number): void {
    const w = this.w;
    for (let i = this.stepIndex; i < Math.min(target, this.def.steps.length); i++) {
      const s = this.def.steps[i];
      this.run((s.onComplete ?? []).filter((a) => a.do !== 'dialog' && a.do !== 'reveal'));
      if (s.type === 'pickup') this.carried = s.item;
      if (s.type === 'deliver') this.carried = null;
    }
    w.player.carrying = this.carried?.id ?? null;
    w.bus.emit('sfx', { name: 'step' });
    w.bus.emit('toast', { text: 'Ton équipe a réussi l’étape.', kind: 'good', ttl: 2.5 });
    if (target >= this.def.steps.length) this.finish();
    else this.begin(target);
  }

  update(dt: number): void {
    if (this.state !== 'running' || this.waiting) return;
    if (this.pendingSkip >= this.stepIndex) { const t = this.pendingSkip + 1; this.pendingSkip = -1; this.skipTo(t); return; }
    this.pendingSkip = -1;
    const w = this.w, p = w.player, s = this.step!;
    const st = this.st;
    this.stepTime += dt;
    if (this.timeLeft !== null) { this.timeLeft -= dt; if (this.timeLeft <= 0) { this.timeLeft = 0; return this.fail('Temps écoulé'); } }
    if (s.events) s.events.forEach((e, i) => { if (!this.fired.has(i) && this.stepTime >= e.at) { this.fired.add(i); this.run(e.do); } });
    this.prompt = null; this.hint = null; this.markers = [];
    const alert = this.guards.length ? this.updateGuards(dt) : 0;
    if (this.zombies.length) { this.updateZombies(dt); if (this.state !== 'running') return; }
    if (s.failIf?.includes('detected')) {
      this.meter = { label: 'Alerte', value: alert, tone: 'warn' };
      if (this.detected) return this.fail('Les vigiles t’ont repéré');
    } else this.meter = this.zombies.length || this.bites ? { label: `Morsures ${this.bites}/${this.maxBites}`, value: this.bites / this.maxBites, tone: 'warn' } : null;
    if (s.failIf?.includes('wanted') && w.wanted.level > 0) return this.fail('La police s’en est mêlée');
    const px = p.px, py = p.py;

    switch (s.type) {
      case 'talk': {
        const ped: Ped = st.ped;
        this.markers.push({ x: ped.x, y: ped.y, kind: 'npc' });
        if (dist(px, py, ped.x, ped.y) < 26) {
          if (p.onFoot) this.prompt = { label: `Parler à ${s.npc.name}`, x: ped.x, y: ped.y };
          else this.hint = 'Descends du véhicule';
        }
        break;
      }
      case 'goto': {
        const r = (s.radius ?? 2.5) * TILE;
        this.markers.push({ x: st.p.x, y: st.p.y, kind: 'target', radius: r });
        if (dist(px, py, st.p.x, st.p.y) < r) { if (this.modeOk(s.mode)) return this.next(); this.hint = s.mode === 'foot' ? 'Continue à pied' : 'Il te faut un véhicule'; }
        break;
      }
      case 'pickup': {
        this.markers.push({ x: st.p.x, y: st.p.y, kind: 'item' });
        if (dist(px, py, st.p.x, st.p.y) < 24) {
          if (p.onFoot) this.prompt = { label: `Prendre : ${s.item.name}`, x: st.p.x, y: st.p.y };
          else this.hint = 'Descends du véhicule';
        }
        break;
      }
      case 'get_vehicle': {
        if (p.driving && (!s.vehicle || p.vehicle!.type === s.vehicle)) return this.next();
        if (p.driving && s.vehicle) this.hint = 'Ce n’est pas le bon type de véhicule';
        break;
      }
      case 'deliver': {
        const r = (s.radius ?? 4) * TILE;
        this.markers.push({ x: st.p.x, y: st.p.y, kind: 'target', radius: r });
        if (s.fragile) {
          st.cd -= dt;
          if (p.driving && w.playerImpact > 62 && st.cd <= 0) {
            st.hits++; st.cd = 0.7;
            w.bus.emit('sfx', { name: 'tick' });
            if (st.hits >= s.fragile.max) return this.fail(`${s.item?.name ?? 'Le colis'} n’a pas survécu au voyage`);
            w.bus.emit('toast', { text: `Doucement ! Le colis fait un drôle de bruit… (${st.hits}/${s.fragile.max})`, kind: 'bad', ttl: 2.2 });
          }
          this.meter = { label: 'État du colis', value: 1 - st.hits / s.fragile.max, tone: 'good' };
        }
        if (dist(px, py, st.p.x, st.p.y) < r) {
          if (!this.modeOk(s.mode)) this.hint = s.mode === 'foot' ? 'Continue à pied' : 'Il te faut un véhicule';
          else if (p.speed < 34) { this.carried = null; p.carrying = null; return this.next(); }
          else this.hint = 'Ralentis pour livrer';
        }
        break;
      }
      case 'tail': {
        const v: Vehicle = st.v;
        const ai = v.ai as DriveAI | null;
        if (v.remove || v.dead || !ai) return this.fail('La cible est hors service');
        const d = dist(px, py, v.x, v.y);
        this.markers.push({ x: v.x, y: v.y, kind: 'vehicle' });
        if (st.phase === 'approach') {
          if (d < 140) {
            st.phase = 'follow'; ai.hold = false;
            if (s.objectiveFollow) { this.objective = s.objectiveFollow; w.bus.emit('objective', { text: this.objective }); }
            w.bus.emit('sfx', { name: 'step' });
          }
          break;
        }
        if (d < s.min) { st.susp += dt / 2.4; this.hint = 'Trop près !'; }
        else if (d > s.max) { st.lost += dt; this.hint = 'Tu la perds !'; }
        else { st.susp = Math.max(0, st.susp - dt * 0.1); st.lost = Math.max(0, st.lost - dt); }
        if (w.playerHonked && d < 170) { st.susp += 0.3; this.hint = 'Chut ! Pas de klaxon !'; }
        if (p.driving && w.playerImpact > 70 && d < 170) st.susp += 0.2;
        this.meter = { label: 'Soupçon', value: clamp(st.susp, 0, 1), tone: 'warn' };
        if (st.susp >= 1) return this.fail('Le conducteur t’a repéré');
        if (st.lost > 7) return this.fail('Tu as perdu sa trace');
        if (ai.arrived) {
          ai.hold = true;
          if (v.speed < 8 && d < s.max) { v.driver = 'none'; v.ai = null; v.handbrake = true; return this.next(); }
        }
        break;
      }
      case 'observe': {
        const r = (s.radius ?? 3) * TILE;
        this.markers.push({ x: st.p.x, y: st.p.y, kind: 'target', radius: r });
        const inside = dist(px, py, st.p.x, st.p.y) < r;
        if (inside && this.modeOk(s.mode)) st.t += dt; else st.t = Math.max(0, st.t - dt * 0.5);
        if (inside && !this.modeOk(s.mode)) this.hint = s.mode === 'foot' ? 'Descends du véhicule' : 'Il te faut un véhicule';
        this.meter = { label: s.label ?? 'Observation', value: clamp(st.t / s.seconds, 0, 1), tone: 'good' };
        if (st.t >= s.seconds) return this.next();
        break;
      }
      case 'leave': if (dist(px, py, st.p.x, st.p.y) > s.radius * TILE) return this.next(); break;
      case 'lose_wanted': if (w.wanted.level === 0) return this.next(); break;
      case 'collect': {
        const r = (s.radius ?? 1.6) * TILE;
        const canTake = this.modeOk(s.mode);
        st.left = (st.left as { x: number; y: number; idx: number }[]).filter((q) => {
          if (dist(px, py, q.x, q.y) >= r) return true;
          if (!canTake) { this.hint = s.mode === 'foot' ? 'Descends du véhicule pour la ramasser' : 'Il te faut un véhicule'; return true; }
          w.bus.emit('sfx', { name: 'pickup' });
          w.bus.emit('missionCollect', { id: this.def.id, step: this.stepIndex, idx: q.idx });
          return false;
        });
        for (const q of st.left) this.markers.push({ x: q.x, y: q.y, kind: 'item' });
        const got = st.total - st.left.length;
        const text = `${s.objective} (${got}/${st.total})`;
        if (text !== this.objective) { this.objective = text; w.bus.emit('objective', { text }); }
        if (st.left.length === 0) return this.next();
        break;
      }
      case 'checkpoints': {
        const r = (s.radius ?? 3) * TILE;
        const pts = st.pts as { x: number; y: number }[];
        if (dist(px, py, pts[st.idx].x, pts[st.idx].y) < r) {
          if (this.modeOk(s.mode)) { st.idx++; w.bus.emit('sfx', { name: 'checkpoint' }); if (st.idx >= pts.length) return this.next(); }
          else this.hint = 'Il te faut un véhicule';
        }
        this.markers.push({ x: pts[st.idx].x, y: pts[st.idx].y, kind: 'checkpoint', radius: r });
        if (st.idx + 1 < pts.length) this.markers.push({ x: pts[st.idx + 1].x, y: pts[st.idx + 1].y, kind: 'checkpoint', radius: r, dim: true });
        const text = `${s.objective} (${st.idx}/${pts.length})`;
        if (text !== this.objective) { this.objective = text; w.bus.emit('objective', { text }); }
        break;
      }
      case 'passengers': {
        const f = s.fares[st.idx];
        if (st.phase === 'pickup') {
          this.markers.push({ x: st.from.x, y: st.from.y, kind: 'npc', radius: 40 });
          if (dist(px, py, st.from.x, st.from.y) < 44) {
            if (!p.driving) this.hint = 'Il te faut un véhicule';
            else if (p.speed < 16) {
              this.despawn('fare');
              st.phase = 'drop';
              w.bus.emit('sfx', { name: 'door' });
              w.bus.emit('toast', { text: `${f.name} : « ${f.line ?? 'En route !'} »`, kind: 'info', ttl: 4.5 });
            } else this.hint = 'Arrête-toi pour le laisser monter';
          }
        } else {
          this.markers.push({ x: st.to.x, y: st.to.y, kind: 'target', radius: 40 });
          if (!p.driving) this.hint = 'Remonte en voiture, ton passager attend';
          else if (dist(px, py, st.to.x, st.to.y) < 44) {
            if (p.speed < 16) {
              const out = w.pedSys.spawn(px + 12, py + 12, f.profile ?? 'passerby');
              out.state = 'idle'; out.timer = 0.5;
              w.bus.emit('sfx', { name: 'door' });
              st.idx++;
              if (st.idx >= s.fares.length) return this.next();
              st.phase = 'pickup'; this.spawnFare(s, st.idx);
              const text = `${s.objective} (${st.idx}/${s.fares.length})`;
              this.objective = text; w.bus.emit('objective', { text });
            } else this.hint = 'Arrête-toi pour le déposer';
          }
        }
        break;
      }
      case 'wait': if (this.stepTime >= s.seconds) return this.next(); break;
    }
  }
}

export type { VehicleType };
