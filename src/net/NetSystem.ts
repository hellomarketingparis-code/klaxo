/**
 * Jeu en ligne, pair-à-pair, sans serveur de jeu.
 *
 * - Villes publiques de ROOM_CAP joueurs au plus ; quand une ville est pleine, les derniers arrivés
 *   passent automatiquement à la suivante (ville-1, ville-2…). Le nombre de villes n'est pas limité.
 * - Groupes privés : un code à 5 caractères, à partager hors du jeu.
 * - Chacun simule sa propre circulation, ses piétons et sa police. On partage seulement la position,
 *   l'apparence, le véhicule, les étoiles de recherche, le klaxon et la progression des missions faites ensemble.
 * - Aucune discussion : aucun texte saisi par un joueur ne circule ni ne s'affiche.
 */
import { angleDiff } from '../engine/math';
import type { Look } from '../npc/looks';
import type { World } from '../world/World';
import type { MissionDef } from '../missions/schema';
import type { NetRoom, Transport } from './transport';
import {
  MAX_CITIES, PEER_TIMEOUT_MS, PROTO, ROOM_CAP, STATE_HZ,
  autoName, decodeCoop, decodeHello, decodeState, encodeState, mustLeave, peerColor, RateLimiter,
} from './protocol';
import type { CoopMsg, PeerState } from './protocol';

export type NetStatus = 'off' | 'connecting' | 'online' | 'error' | 'unavailable';
export type NetTarget = { kind: 'public' } | { kind: 'group'; code: string };

interface Snap extends PeerState { t: number; }
export interface RemotePlayer {
  id: string; name: string; color: string;
  look: Look | null; joined: number;
  snaps: Snap[]; last: number;
  /** Position affichée (interpolée). */
  x: number; y: number; a: number; mode: 0 | 1; vt: PeerState['vt']; vc: number; moving: boolean; wanted: number; sid: string;
  animT: number; hornT: number;
}
export interface Invite { from: string; name: string; sid: string; def: MissionDef; step: number; until: number; }

const RENDER_DELAY = 120;

export class NetSystem {
  status: NetStatus = 'off';
  target: NetTarget | null = null;
  /** Ville publique actuelle (1, 2, …) ou null pour un groupe privé. */
  city: number | null = null;
  peers = new Map<string, RemotePlayer>();
  invite: Invite | null = null;
  /** Session de mission partagée en cours (identifiant commun à l'équipe). */
  session: { sid: string; missionId: string } | null = null;
  error = '';
  private room: NetRoom | null = null;
  private joinedAt = 0;
  private sendT = 0;
  private lastSent = '';
  private idleSend = 0;
  private applyingRemote = false;
  private sidSeq = 0;
  private gen = 0;
  private limiter: RateLimiter;
  private checkT = 0;

  constructor(private w: World, private makeTransport: (() => Transport) | null, private now: () => number = () => Date.now()) {
    if (!makeTransport) this.status = 'unavailable';
    this.limiter = new RateLimiter({ hi: 4, st: 25, hn: 4, co: 12 }, now);
    const bus = w.bus;
    bus.on('missionStart', (e) => this.onMissionStart(e.id, e.kind, e.step));
    bus.on('missionStep', (e) => { if (!this.applyingRemote && this.session?.missionId === e.id) this.sendCoop({ k: 'step', sid: this.session.sid, s: e.step }); });
    bus.on('missionCollect', (e) => { if (!this.applyingRemote && this.session?.missionId === e.id) this.sendCoop({ k: 'col', sid: this.session.sid, s: e.step, i: e.idx }); });
    bus.on('missionEnd', (e) => { if (this.session?.missionId === e.id) { this.session = null; this.emit('session'); } });
    bus.on('playerVehicle', () => { this.sendT = 0; });
  }

  get selfId(): string { return this.room?.selfId ?? ''; }
  get selfName(): string { return this.room ? autoName(this.room.selfId) : ''; }
  get online(): boolean { return this.status === 'online'; }
  get count(): number { return this.peers.size; }
  /** Libellé court de l'endroit où l'on joue. */
  get placeLabel(): string {
    if (!this.target) return '';
    return this.target.kind === 'group' ? `Groupe ${this.target.code}` : `Ville publique ${this.city ?? 1}`;
  }
  partners(): RemotePlayer[] { const s = this.session?.sid; return s ? [...this.peers.values()].filter((p) => p.sid === s) : []; }

  private emit(what: 'status' | 'peers' | 'invite' | 'session'): void { this.w.bus.emit('net', { what }); }
  private setStatus(s: NetStatus, error = ''): void { this.status = s; this.error = error; this.emit('status'); }

  // ---------- Connexion ----------
  async connect(target: NetTarget): Promise<void> {
    if (!this.makeTransport) return;
    await this.disconnect(false);
    const gen = ++this.gen;
    this.target = target;
    this.setStatus('connecting');
    try {
      if (target.kind === 'group') { await this.enter(`groupe-${target.code}`, null, gen); return; }
      await this.enter('ville-1', 1, gen);
    } catch (e) {
      if (gen !== this.gen) return;
      console.warn('[net]', e);
      this.room = null;
      this.setStatus('error', 'Connexion impossible pour le moment. Le jeu continue en solo.');
    }
  }
  private async enter(roomId: string, city: number | null, gen: number): Promise<void> {
    const room = await this.makeTransport!().join(roomId);
    if (gen !== this.gen) { void room.leave(); return; }
    this.room = room; this.city = city; this.joinedAt = this.now();
    this.peers.clear(); this.invite = null;
    room.on('hi', (d, from) => this.onHello(d, from));
    room.on('st', (d, from) => this.onState(d, from));
    room.on('hn', (_d, from) => this.onHorn(from));
    room.on('co', (d, from) => this.onCoop(d, from));
    room.onJoin((id) => { this.sendHello(id); this.sendT = 0; });
    room.onLeave((id) => this.dropPeer(id));
    this.sendHello();
    this.sendT = 0; this.lastSent = '';
    this.setStatus('online');
    this.emit('peers');
  }
  async disconnect(clearTarget = true): Promise<void> {
    this.gen++;
    const r = this.room;
    this.room = null;
    this.peers.clear(); this.invite = null; this.session = null;
    if (clearTarget) { this.target = null; this.city = null; }
    if (r) await r.leave().catch(() => {});
    if (this.status !== 'unavailable') this.setStatus('off');
    this.emit('peers');
  }
  /** Ville pleine : on part vers la suivante. */
  private async moveToNextCity(): Promise<void> {
    if (!this.room || this.city === null || this.target?.kind !== 'public') return;
    const next = this.city + 1;
    const gen = ++this.gen;
    const r = this.room;
    this.room = null;
    this.peers.clear();
    await r.leave().catch(() => {});
    if (next > MAX_CITIES) { this.setStatus('error', 'Toutes les villes sont pleines. Réessaie dans un moment.'); return; }
    try { await this.enter(`ville-${next}`, next, gen); } catch { if (gen === this.gen) this.setStatus('error', 'Connexion perdue. Le jeu continue en solo.'); }
  }

  // ---------- Réception ----------
  private peer(id: string): RemotePlayer {
    let p = this.peers.get(id);
    if (!p) {
      p = { id, name: autoName(id), color: peerColor(id), look: null, joined: this.now(), snaps: [], last: this.now(), x: 0, y: 0, a: 0, mode: 0, vt: 'sedan', vc: 0xffffff, moving: false, wanted: 0, sid: '', animT: 0, hornT: 0 };
      this.peers.set(id, p);
      this.emit('peers');
    }
    return p;
  }
  private onHello(d: unknown, from: string): void {
    if (!this.limiter.allow(from, 'hi')) return;
    const h = decodeHello(d);
    if (!h) return;
    const p = this.peer(from);
    p.look = h.look; p.joined = h.joined; p.last = this.now();
    this.checkCapacity();
  }
  private onState(d: unknown, from: string): void {
    if (!this.limiter.allow(from, 'st')) return;
    const s = decodeState(d);
    if (!s) return;
    const p = this.peer(from);
    const t = this.now();
    const first = p.snaps.length === 0;
    p.snaps.push({ ...s, t });
    if (p.snaps.length > 12) p.snaps.shift();
    p.last = t;
    if (first) { p.x = s.x; p.y = s.y; p.a = s.a; p.mode = s.mode; p.vt = s.vt; p.vc = s.vc; }
    if (p.sid !== s.sid) { p.sid = s.sid; this.emit('peers'); }
  }
  private onHorn(from: string): void {
    if (!this.limiter.allow(from, 'hn')) return;
    const p = this.peers.get(from);
    if (!p || !p.snaps.length) return;
    p.hornT = 0.35;
    this.w.bus.emit('sfx', { name: p.mode === 1 && (p.vt === 'truck' || p.vt === 'van') ? 'horn_low' : 'horn', x: p.x, y: p.y });
  }
  private dropPeer(id: string): void {
    if (!this.peers.delete(id)) return;
    this.limiter.forget(id);
    if (this.invite?.from === id) { this.invite = null; this.emit('invite'); }
    this.emit('peers');
  }
  private checkCapacity(): void {
    if (!this.room || this.target?.kind !== 'public') return;
    const others = [...this.peers.values()].map((p) => ({ id: p.id, joined: p.joined }));
    if (mustLeave(this.room.selfId, this.joinedAt, others, ROOM_CAP)) void this.moveToNextCity();
  }

  // ---------- Coopération ----------
  private sendCoop(m: CoopMsg, to?: string): void { this.room?.send('co', m, to); }
  private onMissionStart(id: string, kind: string, step: number): void {
    if (this.applyingRemote) return;
    if (kind !== 'story' && kind !== 'weekly') { this.session = null; return; }
    // Chaque mission lancée en ligne ouvre une session à laquelle les autres joueurs peuvent se joindre.
    const sid = ((this.room?.selfId ?? 'solo').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10) + (++this.sidSeq).toString(36) + Math.floor(this.now() % 1e6).toString(36)).slice(0, 24).padEnd(4, '0');
    this.session = { sid, missionId: id };
    this.emit('session');
    if (this.room && this.peers.size) this.sendCoop({ k: 'inv', sid, m: id, s: step });
  }
  /** Invite de nouveau les joueurs présents (bouton « Inviter » de l'interface). */
  reinvite(): void {
    const r = this.w.missions.active;
    if (!this.session || !r || !this.room) return;
    this.sendCoop({ k: 'inv', sid: this.session.sid, m: this.session.missionId, s: r.stepIndex });
  }
  private onCoop(d: unknown, from: string): void {
    if (!this.limiter.allow(from, 'co')) return;
    const m = decodeCoop(d);
    if (!m) return;
    const ms = this.w.missions;
    switch (m.k) {
      case 'inv': {
        const def = ms.find(m.m);
        // On n'accepte une invitation que pour une mission connue de ce jeu (histoire ou actualité de la semaine).
        if (!def || (def.kind !== 'story' && def.kind !== 'weekly') || m.s >= def.steps.length) return;
        if (ms.active || this.session) return;
        this.invite = { from, name: autoName(from), sid: m.sid, def, step: m.s, until: this.now() + 25000 };
        this.w.bus.emit('sfx', { name: 'phone' });
        this.emit('invite');
        break;
      }
      case 'join': {
        const r = ms.active;
        if (!this.session || this.session.sid !== m.sid || !r) return;
        // Un coéquipier arrive : on lui donne l'étape en cours et les objets déjà ramassés.
        this.sendCoop({ k: 'sync', sid: m.sid, m: this.session.missionId, s: r.stepIndex, c: r.collectedNow() }, from);
        this.w.bus.emit('toast', { text: `${autoName(from)} te rejoint pour cette mission.`, kind: 'good', ttl: 3.5 });
        break;
      }
      case 'sync': {
        const r = ms.active;
        if (!this.session || this.session.sid !== m.sid || !r || r.def.id !== m.m) return;
        this.applyRemote(() => { if (m.s > r.stepIndex) r.teamStepDone(m.s - 1); for (const i of m.c) r.teamCollect(m.s, i); });
        break;
      }
      case 'step': {
        const r = ms.active;
        if (!this.session || this.session.sid !== m.sid || !r || r.def.id !== this.session.missionId) return;
        this.applyRemote(() => r.teamStepDone(m.s));
        break;
      }
      case 'col': {
        const r = ms.active;
        if (!this.session || this.session.sid !== m.sid || !r || r.def.id !== this.session.missionId) return;
        this.applyRemote(() => r.teamCollect(m.s, m.i));
        break;
      }
    }
  }
  private applyRemote(fn: () => void): void { this.applyingRemote = true; try { fn(); } finally { this.applyingRemote = false; } }

  /** Accepte l'invitation en cours : la mission démarre à l'étape où en est l'équipe. */
  acceptInvite(): boolean {
    const inv = this.invite;
    this.invite = null;
    this.emit('invite');
    const ms = this.w.missions;
    if (!inv || inv.until < this.now() || ms.active || !this.room) return false;
    this.session = { sid: inv.sid, missionId: inv.def.id };
    this.applyRemote(() => ms.begin(inv.def, Math.min(inv.step, inv.def.steps.length - 1)));
    if (!ms.active) { this.session = null; return false; }
    this.sendCoop({ k: 'join', sid: inv.sid });
    this.emit('session');
    this.w.bus.emit('toast', { text: `Tu fais équipe avec ${inv.name}. Chaque étape réussie compte pour tous.`, kind: 'good', ttl: 4.5 });
    this.sendT = 0;
    return true;
  }
  declineInvite(): void { this.invite = null; this.emit('invite'); }

  // ---------- Chaque frame ----------
  /** Klaxon du joueur : entendu par les autres. */
  horn(): void { this.room?.send('hn', 1); }

  update(dt: number, playing: boolean): void {
    if (!this.room) return;
    const t = this.now();
    if (this.invite && this.invite.until < t) { this.invite = null; this.emit('invite'); }
    // Joueurs silencieux : retirés.
    for (const p of [...this.peers.values()]) if (t - p.last > PEER_TIMEOUT_MS) this.dropPeer(p.id);
    this.checkT -= dt;
    if (this.checkT <= 0) { this.checkT = 2; this.checkCapacity(); }
    // Envoi de la position : 10 fois par seconde en mouvement, 1 fois par seconde à l'arrêt.
    this.sendT -= dt;
    if (playing && this.sendT <= 0) {
      const st = this.localState();
      const enc = encodeState(st);
      const key = JSON.stringify(enc);
      this.idleSend -= dt;
      if (key !== this.lastSent || this.idleSend <= 0) {
        this.room.send('st', enc);
        this.lastSent = key; this.idleSend = 1;
      }
      this.sendT = 1 / STATE_HZ;
    }
    this.interpolate(t, dt);
  }
  private localState(): PeerState {
    const w = this.w, p = w.player, v = p.driving ? p.vehicle! : null;
    return {
      x: p.px, y: p.py, a: v ? v.angle : p.angle, mode: v ? 1 : 0, vt: v ? v.type : 'sedan', vc: v ? v.color : 0,
      sp: p.speed, wanted: w.wanted.level, moving: p.moving || !!v, sid: this.session?.sid ?? '',
    };
  }
  private interpolate(t: number, dt: number): void {
    const rt = t - RENDER_DELAY;
    for (const p of this.peers.values()) {
      const s = p.snaps;
      if (!s.length) continue;
      let a = s[0], b = s[s.length - 1];
      for (let i = s.length - 1; i > 0; i--) if (s[i - 1].t <= rt) { a = s[i - 1]; b = s[i]; break; }
      const span = b.t - a.t;
      const k = span > 0 ? Math.max(0, Math.min(1, (rt - a.t) / span)) : 1;
      const jump = Math.hypot(b.x - a.x, b.y - a.y) > 220; // téléportation (arrestation, garage) : pas de glissade
      p.x = jump ? b.x : a.x + (b.x - a.x) * k;
      p.y = jump ? b.y : a.y + (b.y - a.y) * k;
      p.a = a.a + angleDiff(a.a, b.a) * k;
      const cur = k < 0.5 ? a : b;
      p.mode = cur.mode; p.vt = cur.vt; p.vc = cur.vc; p.moving = cur.moving; p.wanted = cur.wanted;
      if (p.moving) p.animT += dt * (cur.sp > 70 ? 12 : 8);
      if (p.hornT > 0) p.hornT -= dt;
    }
  }
  private sendHello(to?: string): void {
    if (!this.room) return;
    this.room.send('hi', { v: PROTO, look: this.w.player.look, joined: this.joinedAt }, to);
  }
  /** À appeler quand l'apparence du joueur change (boutique de vêtements). */
  lookChanged(): void { this.sendHello(); }
}
