import { CHUNK_PX, CHUNKS_X, CHUNKS_Y, MAX_DT, QUALITY, TILE, WORLD_H, WORLD_W, WORLD_SEED, SAVE_VERSION } from '../engine/config';
import type { QualityProfile } from '../engine/config';
import { Bus } from '../engine/bus';
import { RNG } from '../engine/rng';
import { angleDiff, clamp, dist } from '../engine/math';
import type { CityMap } from '../map/CityMap';
import { Vehicle, collideVehicles } from '../vehicles/Vehicle';
import { VEHICLES } from '../vehicles/specs';
import type { VehicleType } from '../vehicles/specs';
import type { Ped } from '../npc/Ped';
import { PedSystem } from '../npc/PedSystem';
import { ANGRY_LINES, DOWN_LINES } from '../npc/chatter';
import type { Look } from '../npc/looks';
import { Player, NO_INTENT } from '../player/Player';
import type { Intent } from '../player/Player';
import { TrafficSystem, TYPE_WEIGHTS } from '../traffic/TrafficSystem';
import { WantedSystem } from '../police/WantedSystem';
import { PoliceSystem } from '../police/PoliceSystem';
import { MissionManager } from '../missions/MissionManager';
import type { MissionSave } from '../missions/MissionManager';
import { Economy } from '../economy/Economy';
import type { OwnedVehicle } from '../economy/Economy';
import { WorldModifiers } from '../weekly/WorldModifiers';
import { RandomEvents } from '../weekly/RandomEvents';
import type { DialogLine, WorldEvents } from './events';

export interface Prompt { label: string; kind: 'mission' | 'giver' | 'shop' | 'vehicle' | 'garage'; x: number; y: number; ref?: any; }

export interface SaveData {
  v: number; savedAt: string;
  player: { x: number; y: number; look: Look; name: string };
  money: number; xp: number; level: number;
  owned: OwnedVehicle[]; unlockedAcc: number[];
  missions: MissionSave;
  secrets: number[];
  stats: Record<string, number>;
  achievements: string[];
  playTime: number;
}

const SHOP_TYPES_POI = ['clothes', 'dealer', 'kiosk', 'garage'];

/** La simulation complète de la ville. Aucune dépendance à l'affichage : elle tourne aussi dans les tests. */
export class World {
  bus = new Bus<WorldEvents>();
  rng: RNG;
  time = 0;
  quality: QualityProfile = QUALITY.high;
  player = new Player();
  vehicles: Vehicle[] = [];
  peds: Ped[] = [];
  mods = new WorldModifiers();
  economy: Economy;
  pedSys: PedSystem;
  traffic: TrafficSystem;
  wanted: WantedSystem;
  police: PoliceSystem;
  missions: MissionManager;
  randomEvents: RandomEvents;
  /** Point autour duquel la ville est simulée (joueur, ou caméra du menu). */
  focusX = 0; focusY = 0;
  viewW = 440; viewH = 260;
  /** Mode vitrine du menu principal : la ville vit, sans joueur. */
  attract = true;
  paused = false;
  headless: boolean;
  playerImpact = 0;
  playerHonked = false;
  prompt: Prompt | null = null;
  secretsFound = new Set<number>();
  district = -1;
  playTime = 0;
  private dialogDepth = 0;
  private activeChunks = new Set<number>();
  private spotVehicle = new Map<number, Vehicle>();
  private takenSpots = new Set<number>();
  private autosaveT = 20;
  private bustCd = 0;
  private hornCd = 0;

  constructor(public map: CityMap, opts: { headless?: boolean; seed?: number } = {}) {
    this.headless = !!opts.headless;
    this.rng = new RNG((opts.seed ?? WORLD_SEED) ^ 0x9e3779b9);
    this.economy = new Economy(this);
    this.pedSys = new PedSystem(this);
    this.traffic = new TrafficSystem(this);
    this.wanted = new WantedSystem(this);
    this.police = new PoliceSystem(this);
    this.missions = new MissionManager(this);
    this.randomEvents = new RandomEvents(this);
    const spawn = map.poiPx('spawn');
    this.player.x = spawn.x; this.player.y = spawn.y;
    const c = map.poiPx('x_centre');
    this.focusX = c.x; this.focusY = c.y;
  }

  get busy(): boolean { return this.dialogDepth > 0; }
  inView(x: number, y: number, margin = 0): boolean {
    return Math.abs(x - this.focusX) < this.viewW / 2 + margin && Math.abs(y - this.focusY) < this.viewH / 2 + margin;
  }
  vehicleColors(type: VehicleType): number[] { return VEHICLES[type].colors; }

  // ---------- Dialogues ----------
  showDialog(lines: DialogLine[], cb?: () => void): void {
    if (this.headless || lines.length === 0) { cb?.(); return; }
    this.dialogDepth++;
    this.bus.emit('dialog', { lines, onDone: () => { this.dialogDepth = Math.max(0, this.dialogDepth - 1); cb?.(); } });
  }
  showReveal(title: string, text: string, cb?: () => void): void {
    if (this.headless) { cb?.(); return; }
    this.dialogDepth++;
    this.bus.emit('reveal', { title, text, onDone: () => { this.dialogDepth = Math.max(0, this.dialogDepth - 1); cb?.(); } });
  }

  // ---------- Boucle ----------
  update(dtRaw: number, input: Intent = NO_INTENT): void {
    if (this.paused || this.busy) return;
    let dt = Math.min(dtRaw, 0.1);
    let first = true;
    while (dt > 0.0001) {
      const h = Math.min(dt, MAX_DT);
      this.step(h, first ? input : { ...input, interact: false, action: false });
      first = false;
      dt -= h;
      if (this.busy || this.paused) break;
    }
  }

  private step(dt: number, input: Intent): void {
    this.time += dt;
    this.playerImpact = 0; this.playerHonked = false;
    if (this.bustCd > 0) this.bustCd -= dt;
    if (this.hornCd > 0) this.hornCd -= dt;
    this.mods.update(this.time);
    const p = this.player;
    if (!this.attract) {
      this.playTime += dt;
      this.updatePlayer(dt, input);
      this.focusX = p.px; this.focusY = p.py;
    }
    this.syncChunks();
    this.traffic.update(dt);
    this.police.update(dt);
    this.pedSys.update(dt);
    this.wanted.update(dt);
    this.physics(dt);
    if (!this.attract) {
      this.focusX = p.px; this.focusY = p.py;
      this.missions.update(dt);
      this.randomEvents.update(dt);
      this.checkSecrets();
      const d = this.map.districtAtPx(p.px, p.py);
      if (d !== this.district) { this.district = d; this.bus.emit('district', { id: d }); }
      this.computePrompt();
      this.autosaveT -= dt;
      if (this.autosaveT <= 0) { this.autosaveT = 20; this.bus.emit('save', { reason: 'auto' }); }
    }
    this.sweep();
  }

  // ---------- Joueur ----------
  private updatePlayer(dt: number, input: Intent): void {
    const p = this.player;
    if (p.state === 'entering' || p.state === 'exiting') {
      p.timer -= dt;
      const t = clamp(1 - p.timer / 0.28, 0, 1);
      p.x = p.fromX + (p.toX - p.fromX) * t; p.y = p.fromY + (p.toY - p.fromY) * t;
      p.moving = true; p.animT += dt * 4;
      if (p.timer <= 0) {
        if (p.state === 'entering' && p.target && !p.target.remove) this.finishEnter(p.target);
        else p.state = 'foot';
        p.target = null;
      }
      return;
    }
    if (p.state === 'driving' && p.vehicle) {
      const v = p.vehicle;
      if (v.remove) { p.vehicle = null; p.state = 'foot'; return; }
      const abs = (input as any).absolute === true;
      if (abs) {
        // Tactile : le véhicule se dirige vers la direction du joystick.
        const mag = Math.hypot(input.moveX, input.moveY);
        if (mag > 0.2) {
          const want = Math.atan2(input.moveY, input.moveX);
          const err = angleDiff(v.angle, want);
          v.steer = clamp(err * 2.4, -1, 1);
          v.throttle = Math.abs(err) > 2.2 && v.speed < 30 ? 0.6 : Math.min(1, mag * 1.15);
        } else { v.steer = 0; v.throttle = 0; }
        if ((input as any).brake) v.throttle = -1;
      } else { v.steer = clamp(input.moveX, -1, 1); v.throttle = clamp(-input.moveY, -1, 1); }
      v.handbrake = input.handbrake;
      if (input.action || (input.actionHeld && this.hornCd <= 0)) { this.honk(v); this.hornCd = 0.4; }
      p.x = v.x; p.y = v.y; p.angle = v.angle;
      this.economy.stats.distance = (this.economy.stats.distance ?? 0) + v.speed * dt;
      if (input.interact) this.handleInteract();
      return;
    }
    p.updateFoot(dt, input, this.map);
    if (input.interact) this.handleInteract();
    if (input.action && p.state === 'foot' && this.hornCd <= 0) {
      this.hornCd = 1.2;
      this.bus.emit('bubble', { id: p.id, x: p.x, y: p.y, text: 'Hé !', ttl: 1 });
      this.bus.emit('sfx', { name: 'whistle', x: p.x, y: p.y });
      this.pedSys.react('honk', p.x, p.y, 60);
    }
  }

  nearestVehicle(): Vehicle | null {
    const p = this.player;
    let best: Vehicle | null = null, bd = Infinity;
    for (const v of this.vehicles) {
      if (v.remove || v.speed > 55) continue;
      const d = dist(p.x, p.y, v.x, v.y) - v.spec.len / 2;
      if (d < 15 && d < bd) { bd = d; best = v; }
    }
    return best;
  }

  private computePrompt(): void {
    const p = this.player, m = this.map;
    this.prompt = null;
    if (p.state !== 'foot' && p.state !== 'driving') return;
    const mp = this.missions.active?.prompt;
    if (mp) { this.prompt = { label: mp.label, kind: 'mission', x: mp.x, y: mp.y }; return; }
    if (p.onFoot) {
      const g = this.missions.nearbyGiver();
      if (g) { this.prompt = { label: `Parler à ${g.ped.name}`, kind: 'giver', x: g.ped.x, y: g.ped.y, ref: g }; return; }
    }
    for (const poi of m.pois.values()) {
      if (!SHOP_TYPES_POI.includes(poi.type)) continue;
      const x = (poi.tx + 0.5) * TILE, y = (poi.ty + 0.5) * TILE;
      const d = dist(p.px, p.py, x, y);
      if (p.onFoot && d < 22) { this.prompt = { label: `Entrer : ${poi.name}`, kind: 'shop', x, y, ref: poi.id }; return; }
      if (p.driving && poi.type === 'garage' && d < 56 && p.vehicle!.speed < 45) { this.prompt = { label: `Garage : ${poi.name}`, kind: 'garage', x, y, ref: poi.id }; return; }
    }
    if (p.onFoot) {
      const v = this.nearestVehicle();
      if (v) this.prompt = { label: `Monter : ${v.spec.name}`, kind: 'vehicle', x: v.x, y: v.y, ref: v };
    }
  }

  handleInteract(): void {
    const p = this.player;
    this.computePrompt();
    const pr = this.prompt;
    if (pr?.kind === 'mission') { this.missions.active?.interact(); return; }
    if (pr?.kind === 'giver') { this.missions.accept(pr.ref.def, pr.ref.ped); return; }
    if (pr?.kind === 'shop' || pr?.kind === 'garage') { this.bus.emit('shop', { poi: pr.ref }); return; }
    if (p.driving) { this.exitVehicle(); return; }
    if (pr?.kind === 'vehicle') this.enterVehicle(pr.ref as Vehicle);
  }

  enterVehicle(v: Vehicle): void {
    const p = this.player;
    if (v.driver === 'police') { this.bus.emit('toast', { text: 'Portière verrouillée. Et un agent te regarde.', kind: 'bad' }); return; }
    const lx = Math.sin(v.angle), ly = -Math.cos(v.angle);
    p.state = 'entering'; p.target = v; p.timer = 0.28;
    p.fromX = p.x; p.fromY = p.y; p.toX = v.x + lx * 3; p.toY = v.y + ly * 3;
    p.vx = 0; p.vy = 0;
    this.bus.emit('sfx', { name: 'door', x: v.x, y: v.y });
  }
  private finishEnter(v: Vehicle): void {
    const p = this.player;
    if (v.driver === 'npc') {
      // Le conducteur est éjecté : c'est un vol de voiture.
      this.traffic.release(v, v.ai);
      this.ejectDriver(v, true);
      this.wanted.crime('carjack', v.x, v.y);
    } else if (v.type === 'police') this.wanted.crime('carjack', v.x, v.y);
    if (v.spot >= 0) { this.takenSpots.add(v.spot); this.spotVehicle.delete(v.spot); v.spot = -1; }
    if (v.tag === 'roadblock') v.tag = '';
    v.driver = 'player'; v.ai = null; v.handbrake = false; v.siren = false;
    p.vehicle = v; p.state = 'driving';
    this.economy.stat('drives', 1);
    this.bus.emit('playerVehicle', { entered: true });
  }
  exitVehicle(force = false): void {
    const p = this.player, v = p.vehicle;
    if (!v) return;
    if (!force && v.speed > 48) { this.bus.emit('toast', { text: 'Ralentis avant de descendre.', kind: 'info', ttl: 1.6 }); return; }
    const lx = Math.sin(v.angle), ly = -Math.cos(v.angle);
    const side = v.spec.wid / 2 + 7;
    const cands = [[lx * side, ly * side], [-lx * side, -ly * side], [-Math.cos(v.angle) * (v.spec.len / 2 + 7), -Math.sin(v.angle) * (v.spec.len / 2 + 7)], [Math.cos(v.angle) * (v.spec.len / 2 + 7), Math.sin(v.angle) * (v.spec.len / 2 + 7)]];
    let out = cands[0];
    for (const c of cands) if (!this.map.solidAtPx(v.x + c[0], v.y + c[1])) { out = c; break; }
    v.driver = 'none'; v.throttle = 0; v.steer = 0; v.handbrake = false;
    p.vehicle = null; p.state = 'exiting'; p.timer = 0.28;
    p.fromX = v.x; p.fromY = v.y; p.toX = v.x + out[0]; p.toY = v.y + out[1];
    p.x = v.x; p.y = v.y; p.vx = 0; p.vy = 0;
    this.bus.emit('sfx', { name: 'door', x: v.x, y: v.y });
    this.bus.emit('playerVehicle', { entered: false });
  }
  private ejectDriver(v: Vehicle, angry: boolean): void {
    const rx = -Math.sin(v.angle), ry = Math.cos(v.angle);
    const ped = this.pedSys.spawn(v.x + rx * (v.spec.wid / 2 + 6), v.y + ry * (v.spec.wid / 2 + 6), v.type === 'police' ? 'cop' : 'passerby');
    ped.state = 'flee'; ped.fleeX = v.x; ped.fleeY = v.y; ped.timer = 4;
    if (angry) this.pedSys.say(ped, this.rng.pick(ANGRY_LINES), 2);
  }
  /** Le conducteur abandonne son véhicule (panne, peur). */
  abandon(v: Vehicle, flee: boolean): void {
    if (v.driver !== 'npc') return;
    if (flee && this.inView(v.x, v.y, 40)) this.ejectDriver(v, false);
    v.driver = 'none'; v.ai = null; v.throttle = 0; v.smoke = 1;
  }

  honk(v: Vehicle): void {
    v.honk = 0.3;
    if (!this.inView(v.x, v.y, 120)) return;
    this.bus.emit('sfx', { name: v.type === 'truck' || v.type === 'van' ? 'horn_low' : 'horn', x: v.x, y: v.y });
    const fx = v.x + Math.cos(v.angle) * 26, fy = v.y + Math.sin(v.angle) * 26;
    this.pedSys.react('honk', fx, fy, 85);
    if (v.driver === 'player') { this.playerHonked = true; this.economy.stat('honks', 1); }
  }

  bust(): void {
    if (this.bustCd > 0 || this.attract) return;
    this.bustCd = 3;
    const p = this.player;
    const fine = Math.min(400, Math.round(this.economy.money * 0.1)) + 30 * this.wanted.level;
    if (p.vehicle) this.exitVehicle(true);
    this.missions.active?.fail('Arrêté par la police');
    this.missions.update(0);
    this.wanted.clear(true);
    this.police.reset();
    this.economy.add(-Math.min(fine, this.economy.money), 'amende');
    this.economy.stat('busted', 1);
    const st = this.map.poiPx('police');
    p.x = st.x; p.y = st.y + 6; p.state = 'foot'; p.vx = 0; p.vy = 0; p.vehicle = null;
    this.focusX = p.x; this.focusY = p.y;
    this.bus.emit('busted', { fine });
    this.bus.emit('sfx', { name: 'fail' });
    this.bus.emit('save', { reason: 'busted' });
  }

  private checkSecrets(): void {
    const p = this.player;
    for (const s of this.map.secrets) {
      if (this.secretsFound.has(s.id)) continue;
      if (Math.abs((s.tx + 0.5) * TILE - p.px) < 14 && Math.abs((s.ty + 0.5) * TILE - p.py) < 14) {
        this.secretsFound.add(s.id);
        this.economy.stat('secrets', 1);
        this.economy.add(150, 'secret');
        this.economy.addXp(40);
        this.bus.emit('secret', { found: this.secretsFound.size, total: this.map.secrets.length });
        this.bus.emit('toast', { text: `Lieu secret découvert ! (${this.secretsFound.size}/${this.map.secrets.length}) +150 ¤`, kind: 'good', ttl: 4 });
        this.bus.emit('sfx', { name: 'secret' });
        this.bus.emit('save', { reason: 'secret' });
      }
    }
  }

  // ---------- Physique et collisions ----------
  private physics(dt: number): void {
    const p = this.player, vs = this.vehicles;
    const pv = p.driving ? p.vehicle : null;
    for (const v of vs) {
      if (v.remove) continue;
      // Les véhicules immobiles loin de tout ne sont pas simulés.
      if (v.driver === 'none' && v.vx === 0 && v.vy === 0 && v.throttle === 0) continue;
      const hit = v.step(dt, this.map);
      if (v.driver === 'none' && v.speed < 1.5) { v.vx = 0; v.vy = 0; }
      if (hit && hit.force > 38) {
        v.damage((hit.force - 38) * 0.17);
        if (v === pv) this.playerImpact = Math.max(this.playerImpact, hit.force);
        if (this.inView(hit.x, hit.y, 60)) {
          this.bus.emit('crash', { x: hit.x, y: hit.y, force: hit.force });
          this.bus.emit('sfx', { name: 'crash', x: hit.x, y: hit.y, vol: clamp(hit.force / 160, 0.25, 1) });
          if (hit.force > 90) this.pedSys.react('crash', hit.x, hit.y, 150);
        }
      }
    }
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      if (a.remove) continue;
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (b.remove) continue;
        if (a.vx === 0 && a.vy === 0 && b.vx === 0 && b.vy === 0) continue;
        const hit = collideVehicles(a, b);
        if (!hit || hit.force < 30) continue;
        a.damage((hit.force - 30) * 0.1 * Math.min(2, b.spec.mass / a.spec.mass));
        b.damage((hit.force - 30) * 0.1 * Math.min(2, a.spec.mass / b.spec.mass));
        const mine = a === pv || b === pv;
        if (mine) {
          this.playerImpact = Math.max(this.playerImpact, hit.force);
          const other = a === pv ? b : a;
          if (hit.force > 50) {
            // Emboutir une voiture de police est un délit… si c'est bien le joueur qui fonce dessus.
            if (other.type === 'police' && other.driver !== 'none') { if (pv!.speed > other.speed + 15 && this.wanted.level < 3) this.wanted.crime('hitPolice', hit.x, hit.y); }
            else if (other.driver === 'npc' && hit.force > 70) this.wanted.crime('crash', hit.x, hit.y);
          }
          this.economy.stat('crashes', 1);
        }
        if (this.inView(hit.x, hit.y, 60)) {
          this.bus.emit('crash', { x: hit.x, y: hit.y, force: hit.force });
          this.bus.emit('sfx', { name: 'crash', x: hit.x, y: hit.y, vol: clamp(hit.force / 160, 0.25, 1) });
          if (hit.force > 80) this.pedSys.react('crash', hit.x, hit.y, 150);
        }
      }
    }
    // Véhicules contre piétons et joueur à pied.
    for (const v of vs) {
      if (v.remove) continue;
      const sp = v.speed;
      if (sp < 4) continue;
      const cos = Math.cos(v.angle), sin = Math.sin(v.angle);
      const reach = v.spec.len / 2 + 8;
      const offs = v.circleOffsets();
      for (const q of this.peds) {
        if (q.remove || Math.abs(q.x - v.x) > reach || Math.abs(q.y - v.y) > reach) continue;
        for (const o of offs) {
          const cx = v.x + cos * o, cy = v.y + sin * o;
          const dx = q.x - cx, dy = q.y - cy, d = Math.hypot(dx, dy) || 0.01;
          const min = v.radius + q.radius;
          if (d >= min) continue;
          const ux = dx / d, uy = dy / d;
          q.x += ux * (min - d); q.y += uy * (min - d);
          const closing = v.vx * ux + v.vy * uy;
          if (closing > 46 && q.state !== 'down') {
            this.pedSys.knock(q, v.vx * 0.7 + ux * 40, v.vy * 0.7 + uy * 40, v.x, v.y);
            this.bus.emit('sfx', { name: 'thud', x: q.x, y: q.y });
            this.bus.emit('bubble', { id: q.id, x: q.x, y: q.y, text: this.rng.pick(DOWN_LINES), ttl: 1.8 });
            this.pedSys.react('danger', q.x, q.y, 110);
            if (v === pv) { this.wanted.crime(q.profile === 'cop' || q.role === 'cop' ? 'copHit' : 'pedHit', q.x, q.y); this.economy.stat('pedsHit', 1); }
            v.vx *= 0.92; v.vy *= 0.92;
          } else if (closing > 12 && q.role === 'civil' && q.state !== 'flee' && q.state !== 'down') {
            q.fleeX = v.x; q.fleeY = v.y; q.state = 'flee'; q.timer = 1.6;
          }
          break;
        }
      }
      if (p.onFoot && !this.attract && v !== p.target) {
        for (const o of offs) {
          const cx = v.x + cos * o, cy = v.y + sin * o;
          const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 0.01;
          const min = v.radius + p.radius;
          if (d >= min) continue;
          const ux = dx / d, uy = dy / d;
          p.x += ux * (min - d); p.y += uy * (min - d);
          const closing = v.vx * ux + v.vy * uy;
          if (closing > 60 && p.state === 'foot') {
            p.state = 'stunned'; p.timer = 1.1; p.vx = v.vx * 0.6 + ux * 30; p.vy = v.vy * 0.6 + uy * 30;
            this.bus.emit('sfx', { name: 'thud', x: p.x, y: p.y });
            this.bus.emit('bubble', { id: p.id, x: p.x, y: p.y, text: 'Aïe !', ttl: 1 });
          }
          break;
        }
      }
    }
    // Joueur à pied contre véhicules à l'arrêt (simple répulsion).
    if (p.onFoot && !this.attract) {
      for (const v of vs) {
        if (v.remove || v.speed >= 4 || v === p.target) continue;
        if (Math.abs(p.x - v.x) > 30 || Math.abs(p.y - v.y) > 30) continue;
        const cos = Math.cos(v.angle), sin = Math.sin(v.angle);
        for (const o of v.circleOffsets()) {
          const dx = p.x - (v.x + cos * o), dy = p.y - (v.y + sin * o), d = Math.hypot(dx, dy) || 0.01;
          const min = v.radius + p.radius - 1;
          if (d < min) { p.x += (dx / d) * (min - d); p.y += (dy / d) * (min - d); }
        }
      }
    }
    for (const v of vs) {
      if (v.dead && v.smoke === 0) { v.smoke = 1; if (v === pv) this.bus.emit('toast', { text: 'Moteur hors service. Il va falloir marcher.', kind: 'bad' }); }
      // Bornes du monde.
      v.x = clamp(v.x, 20, WORLD_W - 20); v.y = clamp(v.y, 20, WORLD_H - 20);
    }
    p.x = clamp(p.x, 8, WORLD_W - 8); p.y = clamp(p.y, 8, WORLD_H - 8);
  }

  // ---------- Chunks : véhicules stationnés ----------
  private syncChunks(): void {
    const cx = Math.floor(this.focusX / CHUNK_PX), cy = Math.floor(this.focusY / CHUNK_PX);
    const now = new Set<number>();
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || y < 0 || x >= CHUNKS_X || y >= CHUNKS_Y) continue;
      now.add(y * CHUNKS_X + x);
    }
    for (const c of now) {
      if (this.activeChunks.has(c)) continue;
      for (const si of this.map.chunkSpots[c]) {
        const s = this.map.spots[si];
        if (!s.filled || this.takenSpots.has(si) || this.spotVehicle.has(si)) continue;
        const type = (s.kind as VehicleType) ?? this.rng.weighted(TYPE_WEIGHTS[this.map.districtAtPx(s.x, s.y)], (t) => t[1])[0];
        const v = new Vehicle(type, s.x, s.y, s.angle, this.rng.pick(VEHICLES[type].colors));
        v.spot = si;
        this.vehicles.push(v);
        this.spotVehicle.set(si, v);
      }
    }
    for (const c of this.activeChunks) {
      if (now.has(c)) continue;
      for (const si of this.map.chunkSpots[c]) {
        const v = this.spotVehicle.get(si);
        if (!v) continue;
        const s = this.map.spots[si];
        if (v.driver === 'none' && dist(v.x, v.y, s.x, s.y) < 4) v.remove = true; else { this.takenSpots.add(si); v.spot = -1; }
        this.spotVehicle.delete(si);
      }
    }
    this.activeChunks = now;
  }

  private sweep(): void {
    const far = Math.max(this.viewW, this.viewH) * 0.5 + 420;
    let dirtyV = false, dirtyP = false;
    for (const v of this.vehicles) {
      if (!v.remove && v.driver === 'none' && v.spot < 0 && !v.tag && this.player.target !== v && dist(v.x, v.y, this.focusX, this.focusY) > far) v.remove = true;
      if (v.remove) { dirtyV = true; if (this.player.vehicle === v) { this.player.vehicle = null; this.player.state = 'foot'; } }
    }
    for (const q of this.peds) if (q.remove) dirtyP = true;
    if (dirtyV) this.vehicles = this.vehicles.filter((v) => !v.remove);
    if (dirtyP) this.peds = this.peds.filter((q) => !q.remove);
  }

  // ---------- Démarrage, boutiques, sauvegarde ----------
  /** Remet le monde dans son état initial (nouvelle partie ou chargement). */
  resetProgress(): void {
    this.missions.resetProgress();
    this.wanted.clear(true);
    this.police.reset();
    this.mods.clearTemp();
    this.economy = new Economy(this);
    this.secretsFound.clear();
    this.takenSpots.clear();
    this.playTime = 0;
    for (const v of this.vehicles) v.remove = true;
    for (const q of this.peds) q.remove = true;
    this.spotVehicle.clear(); this.activeChunks.clear();
    this.vehicles = []; this.peds = [];
    const p = this.player;
    const spawn = this.map.poiPx('spawn');
    p.x = spawn.x; p.y = spawn.y; p.vx = 0; p.vy = 0; p.state = 'foot'; p.vehicle = null; p.target = null; p.carrying = null; p.angle = Math.PI / 2;
    this.prompt = null; this.district = -1; this.dialogDepth = 0; this.paused = false;
  }
  /** Peuple la ville autour du point d'attention avant le premier affichage. */
  warmup(seconds = 14): void {
    const vw = this.viewW, vh = this.viewH;
    this.viewW = 40; this.viewH = 40;
    for (let t = 0; t < seconds; t += 1 / 15) this.step(1 / 15, NO_INTENT);
    this.viewW = vw; this.viewH = vh;
  }
  /** Retour au menu : la ville continue de vivre en vitrine. */
  toAttract(): void {
    this.missions.suspend();
    this.wanted.clear(true);
    this.police.reset();
    if (this.player.vehicle) { this.player.vehicle.driver = 'none'; this.player.vehicle = null; }
    this.player.state = 'foot';
    this.attract = true; this.paused = false; this.dialogDepth = 0; this.prompt = null;
  }
  startGame(): void {
    this.attract = false;
    for (const v of this.vehicles) if (v.driver !== 'none' || v.spot < 0) v.remove = true;
    for (const q of this.peds) if (q.role === 'civil') q.remove = true;
    this.focusX = this.player.x; this.focusY = this.player.y;
    this.district = -1;
    this.missions.refreshGivers();
  }
  /** Fait livrer un véhicule possédé sur la chaussée la plus proche. */
  deliverOwned(o: OwnedVehicle): Vehicle {
    const p = this.player;
    const r = this.map.nearestRoadPoint(p.px, p.py);
    let x = r.x, y = r.y;
    for (let k = 0; k < 6 && this.vehicles.some((v) => dist(v.x, v.y, x, y) < 34); k++) { x += Math.cos(r.angle) * 36; y += Math.sin(r.angle) * 36; }
    const v = new Vehicle(o.type, x, y, r.angle, o.color);
    v.owned = true; v.tag = 'owned';
    for (const old of this.vehicles) if (old.owned && old !== p.vehicle && old.type === o.type && old.color === o.color) old.remove = true;
    this.vehicles.push(v);
    return v;
  }
  /** Garage : réparation complète du véhicule conduit. */
  repairCost(): number { const v = this.player.vehicle; return v ? this.economy.price(Math.ceil((v.spec.hp - v.hp) * 2.5)) : 0; }
  repair(): boolean {
    const v = this.player.vehicle;
    if (!v) return false;
    const cost = this.repairCost();
    if (cost > 0 && !this.economy.pay(cost, 'réparation')) return false;
    v.hp = v.spec.hp; v.smoke = 0;
    this.bus.emit('sfx', { name: 'repair' });
    return true;
  }
  /** Garage : nouvelle peinture. Efface le niveau de recherche si aucun policier ne regarde. */
  respray(color: number): boolean {
    const v = this.player.vehicle;
    if (!v) return false;
    if (!this.economy.pay(this.economy.price(150), 'peinture')) return false;
    v.color = color;
    if (this.wanted.level > 0) {
      if (this.wanted.seen) this.bus.emit('toast', { text: 'Repeinte… sous les yeux de la police. Raté.', kind: 'bad' });
      else this.wanted.clear();
    }
    this.bus.emit('sfx', { name: 'repair' });
    return true;
  }

  serialize(): SaveData {
    const p = this.player;
    return {
      v: SAVE_VERSION, savedAt: new Date().toISOString(),
      player: { x: Math.round(p.px), y: Math.round(p.py), look: { ...p.look }, name: p.name },
      money: this.economy.money, xp: this.economy.xp, level: this.economy.level,
      owned: this.economy.owned.map((o) => ({ ...o })), unlockedAcc: [...this.economy.unlockedAcc],
      missions: JSON.parse(JSON.stringify(this.missions.serialize())),
      secrets: [...this.secretsFound], stats: { ...this.economy.stats }, achievements: [...this.economy.achievements],
      playTime: Math.round(this.playTime),
    };
  }
  restore(s: SaveData): void {
    const p = this.player, m = this.map;
    p.look = { ...p.look, ...s.player.look }; p.name = s.player.name ?? '';
    const t = m.nearestWalkable(Math.floor(clamp(s.player.x, 0, WORLD_W - 1) / TILE), Math.floor(clamp(s.player.y, 0, WORLD_H - 1) / TILE), 30);
    p.x = (t.tx + 0.5) * TILE; p.y = (t.ty + 0.5) * TILE; p.state = 'foot'; p.vehicle = null;
    this.focusX = p.x; this.focusY = p.y;
    const e = this.economy;
    e.money = Math.max(0, Math.round(s.money ?? 0)); e.xp = Math.max(0, s.xp ?? 0); e.level = Math.max(1, s.level ?? 1);
    e.owned = (s.owned ?? []).filter((o) => VEHICLES[o.type]);
    e.unlockedAcc = new Set(s.unlockedAcc ?? [0]);
    e.stats = { ...(s.stats ?? {}) };
    e.achievements = new Set(s.achievements ?? []);
    this.secretsFound = new Set(s.secrets ?? []);
    this.playTime = s.playTime ?? 0;
    this.missions.restore(s.missions);
  }
}

/** Vérifie la forme d'une sauvegarde importée. */
export function validateSave(s: any): s is SaveData {
  return !!s && typeof s === 'object' && typeof s.v === 'number' && s.v <= SAVE_VERSION && !!s.player && typeof s.player.x === 'number' && typeof s.player.y === 'number'
    && typeof s.money === 'number' && typeof s.level === 'number' && !!s.missions && typeof s.missions === 'object' && Array.isArray(s.secrets ?? []);
}
