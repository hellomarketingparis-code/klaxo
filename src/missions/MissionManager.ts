import { dist } from '../engine/math';
import type { Ped } from '../npc/Ped';
import type { World } from '../world/World';
import { MissionRunner } from './MissionRunner';
import { resolveLoc, validateMission } from './validate';
import type { ArchiveIndex, MissionDef } from './schema';

export interface HistoryEntry { id: string; title: string; kind: string; result: 'success' | 'failed'; at: string; reward: number; }
export interface MissionSave { done: Record<string, { times: number; at: string }>; history: HistoryEntry[]; active: { id: string; step: number } | null; }

/** Catalogue des missions, disponibilité, donneurs de mission, lancement, réussite et échec. */
export class MissionManager {
  story: MissionDef[] = [];
  weekly: MissionDef | null = null;
  archive: ArchiveIndex = { schema: 1, items: [] };
  done: Record<string, { times: number; at: string }> = {};
  history: HistoryEntry[] = [];
  active: MissionRunner | null = null;
  /** Donneurs présents dans la ville : identifiant de mission → personnage. */
  givers = new Map<string, Ped>();
  /** Missions rejetées au chargement (journal affiché dans les options). */
  rejected: { id: string; errors: string[] }[] = [];
  private sideOffer: { def: MissionDef; ped: Ped; until: number } | null = null;
  /** Dernière mission échouée : permet de réessayer depuis le dernier point de passage. */
  lastFailed: { def: MissionDef; step: number } | null = null;

  constructor(private w: World) {}

  /** Charge les missions après validation stricte. Les fichiers invalides sont ignorés, jamais exécutés. */
  load(story: any[], weekly: any | null, archive: ArchiveIndex | null): void {
    this.story = []; this.rejected = [];
    for (const def of story ?? []) {
      const r = validateMission(def, this.w.map);
      if (r.ok) this.story.push(def as MissionDef); else this.rejected.push({ id: String(def?.id), errors: r.errors });
    }
    this.weekly = null;
    if (weekly) {
      const r = validateMission(weekly, this.w.map);
      if (r.ok && weekly.kind === 'weekly') this.weekly = weekly as MissionDef; else this.rejected.push({ id: String(weekly?.id), errors: r.errors.length ? r.errors : ['type de mission inattendu'] });
    }
    if (archive && Array.isArray(archive.items)) this.archive = archive;
    this.refreshGivers();
  }

  isDone(id: string): boolean { return !!this.done[id]; }
  unlocked(def: MissionDef): boolean {
    const req = def.requires;
    if (!req) return true;
    if (req.level && this.w.economy.level < req.level) return false;
    return (req.missions ?? []).every((m) => this.isDone(m));
  }
  /** Missions proposées en ville actuellement. */
  available(): MissionDef[] {
    const out: MissionDef[] = [];
    const nextStory = this.story.find((d) => !this.isDone(d.id) && this.unlocked(d));
    if (nextStory) out.push(nextStory);
    if (this.weekly && !this.isDone(this.weekly.id) && this.unlocked(this.weekly)) out.push(this.weekly);
    return out;
  }
  find(id: string): MissionDef | null {
    return this.story.find((d) => d.id === id) ?? (this.weekly?.id === id ? this.weekly : null);
  }

  refreshGivers(): void {
    const w = this.w;
    const wanted = this.active ? [] : this.available();
    for (const [id, ped] of this.givers) {
      if (!wanted.some((d) => d.id === id)) { ped.remove = true; this.givers.delete(id); }
    }
    for (const def of wanted) {
      if (this.givers.has(def.id)) continue;
      const p = resolveLoc(w.map, def.giver.at);
      const ped = w.pedSys.spawnStatic(p.x + 6, p.y, def.giver.profile, undefined, `giver:${def.id}`, def.giver.name);
      this.givers.set(def.id, ped);
    }
  }

  /** Donneur de mission à portée de voix. */
  nearbyGiver(): { def: MissionDef; ped: Ped } | null {
    const p = this.w.player;
    if (this.active || !p.onFoot) return null;
    for (const [id, ped] of this.givers) {
      if (dist(p.x, p.y, ped.x, ped.y) < 24) { const def = this.find(id); if (def) return { def, ped }; }
    }
    if (this.sideOffer && dist(p.x, p.y, this.sideOffer.ped.x, this.sideOffer.ped.y) < 24) return { def: this.sideOffer.def, ped: this.sideOffer.ped };
    return null;
  }

  /** Parle au donneur puis lance la mission. */
  accept(def: MissionDef, giver?: Ped): void {
    if (this.active) return;
    const w = this.w;
    const go = () => this.begin(def, 0);
    const runner = new MissionRunner(w, def);
    if (giver) giver.face(w.player.x, w.player.y);
    w.showDialog(def.intro.map((l) => runner.line(l)), go);
  }
  begin(def: MissionDef, fromStep = 0): void {
    const w = this.w;
    if (this.active) return;
    if (this.sideOffer?.def === def) { this.sideOffer.ped.tag = ''; this.sideOffer.ped.remove = true; this.sideOffer = null; }
    this.active = new MissionRunner(w, def);
    this.refreshGivers();
    this.active.start(fromStep);
    w.bus.emit('card', { title: def.title, subtitle: def.kind === 'weekly' ? 'Mission de l’actualité' : def.kind === 'side' ? 'Événement de rue' : 'Mission', kind: 'start' });
    w.bus.emit('sfx', { name: 'start' });
    w.bus.emit('save', { reason: 'mission' });
  }
  /** Relance la dernière mission échouée depuis son dernier point de passage. */
  retry(): boolean {
    if (this.active || !this.lastFailed) return false;
    const { def, step } = this.lastFailed;
    this.lastFailed = null;
    this.begin(def, step);
    return true;
  }
  abort(): void {
    if (!this.active) return;
    this.active.fail('Mission abandonnée');
    this.settle();
  }

  /** Interrompt la mission sans la conclure (retour au menu) : elle reprendra au dernier point de passage. */
  suspend(): void {
    if (this.active) { this.active.cleanup(); this.active = null; }
    this.clearSide();
    for (const ped of this.givers.values()) ped.remove = true;
    this.givers.clear();
  }
  /** Remet la progression à zéro (nouvelle partie). */
  resetProgress(): void {
    this.suspend();
    this.done = {}; this.history = []; this.lastFailed = null;
  }
  /** Propose un événement de rue via un personnage (voir RandomEvents). */
  offerSide(def: MissionDef, ped: Ped, seconds: number): void {
    this.clearSide();
    this.sideOffer = { def, ped, until: this.w.time + seconds };
  }
  get sideMarker(): Ped | null { return this.sideOffer?.ped ?? null; }
  clearSide(): void { if (this.sideOffer) { this.sideOffer.ped.remove = true; this.sideOffer = null; } }

  update(dt: number): void {
    const w = this.w;
    if (this.sideOffer && (w.time > this.sideOffer.until || this.sideOffer.ped.remove)) { if (!w.inView(this.sideOffer.ped.x, this.sideOffer.ped.y, 0)) this.clearSide(); else this.sideOffer.until = w.time + 5; }
    const r = this.active;
    if (!r) return;
    r.update(dt);
    if (r.state === 'success' || r.state === 'failed') this.settle();
  }

  private settle(): void {
    const w = this.w, r = this.active;
    if (!r) return;
    const def = r.def;
    const ok = r.state === 'success';
    r.cleanup();
    this.active = null;
    const now = new Date().toISOString();
    if (ok) {
      const first = !this.done[def.id];
      this.done[def.id] = { times: (this.done[def.id]?.times ?? 0) + 1, at: now };
      const money = first ? def.reward.money : Math.round(def.reward.money * 0.3);
      w.economy.add(money, 'mission');
      w.economy.addXp(first ? def.reward.xp : Math.round(def.reward.xp * 0.2));
      w.economy.stat('missionsDone', 1);
      if (first && def.kind === 'story') w.economy.stat('storyDone', 1);
      if (first && def.kind === 'weekly') w.economy.stat('weeklyDone', 1);
      if (def.kind === 'side') w.economy.stat('eventsDone', 1);
      this.history.unshift({ id: def.id, title: def.title, kind: def.kind, result: 'success', at: now, reward: money });
      this.lastFailed = null;
      w.bus.emit('card', { title: 'Mission réussie', subtitle: `${def.title} · +${money} ¤`, kind: 'success' });
      w.bus.emit('sfx', { name: 'success' });
    } else {
      w.economy.stat('missionsFailed', 1);
      this.lastFailed = def.kind !== 'side' ? { def, step: r.checkpointStep } : null;
      this.history.unshift({ id: def.id, title: def.title, kind: def.kind, result: 'failed', at: now, reward: 0 });
      w.bus.emit('card', { title: 'Mission échouée', subtitle: r.failReason, kind: 'fail' });
      w.bus.emit('sfx', { name: 'fail' });
    }
    this.history.length = Math.min(this.history.length, 40);
    w.bus.emit('objective', { text: null });
    this.refreshGivers();
    w.bus.emit('save', { reason: 'mission' });
  }

  serialize(): MissionSave {
    const sideActive = this.active?.def.kind === 'side';
    return { done: this.done, history: this.history, active: this.active && !sideActive ? { id: this.active.def.id, step: this.active.checkpointStep } : null };
  }
  restore(s: MissionSave | undefined): void {
    this.done = s?.done ?? {}; this.history = s?.history ?? [];
    this.refreshGivers();
    if (s?.active) {
      const def = this.find(s.active.id);
      if (def && !this.active) {
        this.begin(def, Math.max(0, Math.min(def.steps.length - 1, s.active.step | 0)));
        this.w.bus.emit('toast', { text: `Mission reprise : ${def.title}`, kind: 'info', ttl: 4 });
      }
    }
  }
}
