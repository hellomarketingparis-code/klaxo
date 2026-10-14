import './ui/styles.css';
import Phaser from 'phaser';
import { QUALITY, GAME_VERSION } from './engine/config';
import type { Quality } from './engine/config';
import { generateCity } from './map/generator';
import { World } from './world/World';
import type { SaveData } from './world/World';
import { GameScene } from './scenes/GameScene';
import type { SceneDeps } from './scenes/GameScene';
import { InputSystem } from './input/Input';
import { AudioSystem } from './audio/AudioSystem';
import { SaveSystem, openStore, DEFAULT_SETTINGS } from './save/SaveSystem';
import type { Settings } from './save/SaveSystem';
import { validateMission } from './missions/validate';
import type { ArchiveIndex, MissionDef } from './missions/schema';
import { validateChanges } from './weekly/WorldModifiers';
import type { WeeklyChangesFile } from './weekly/WorldModifiers';
import type { Look } from './npc/looks';
import { UI } from './ui/UI';
import { Vehicle } from './vehicles/Vehicle';
import type { VehicleType } from './vehicles/specs';
import type { App } from './app';
import { NetSystem } from './net/NetSystem';
import type { NetTarget } from './net/NetSystem';
import { localTransport } from './net/transport';
import { trysteroTransport } from './net/trystero';
import { normalizeGroupCode } from './net/protocol';
import { drawLogo, makeVictoryCard } from './ui/share';
// Les missions de l'histoire sont aussi embarquées dans le code : le jeu démarre même si le fichier est injoignable.
import storyBundled from '../public/data/missions/story.json';

const DATA = `${import.meta.env.BASE_URL}data/`;

/** Données embarquées dans la page (version en un seul fichier) : utilisées si le réseau ne répond pas. */
function embedded(path: string): any | null {
  try {
    const el = document.getElementById('klaxo-data');
    if (!el?.textContent) return null;
    return JSON.parse(el.textContent)[path] ?? null;
  } catch { return null; }
}
async function fetchJson(path: string, timeoutMs = 6000): Promise<any | null> {
  // Version en un seul fichier : tout est déjà dans la page, inutile d'interroger le réseau.
  if (import.meta.env.VITE_SINGLE_FILE) return embedded(path);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(DATA + path, { cache: 'no-cache', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return embedded(path);
    return await res.json();
  } catch { return embedded(path); }
}

function internalSize(): { w: number; h: number } {
  const cw = Math.max(1, window.innerWidth), ch = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  // Environ 250 pixels de ville visibles en hauteur, à un multiple entier de pixels écran.
  const target = ch < 480 ? 210 : 255;
  let n = Math.max(1, Math.round((ch * dpr) / target));
  if ((cw * dpr) / n < 250) n = Math.max(1, Math.floor((cw * dpr) / 250));
  let w = Math.ceil((cw * dpr) / n), h = Math.ceil((ch * dpr) / n);
  const maxW = 720;
  if (w > maxW) { const k = maxW / w; w = maxW; h = Math.round(h * k); }
  return { w, h };
}

class Game implements App {
  world!: World;
  scene: GameScene | null = null;
  input = new InputSystem();
  audio!: AudioSystem;
  save!: SaveSystem;
  settings: Settings = { ...DEFAULT_SETTINGS };
  saveInfo: SaveData | null = null;
  weekly: App['weekly'] = { mission: null, changes: null, archive: { schema: 1, items: [] }, online: true };
  touchMode = false;
  canDownload = true;
  playing = false;
  ui!: UI;
  net!: NetSystem;
  pendingInvite: string | null = null;
  phaser!: Phaser.Game;
  quality: Quality = 'high';
  private fpsLow = 0;
  private touchSeen = false;

  async boot(): Promise<void> {
    const msg = (t: string) => { const el = document.getElementById('boot-msg'); if (el) el.textContent = t; };
    try { this.canDownload = window.self === window.top; } catch { this.canDownload = false; }
    this.save = new SaveSystem(await openStore());
    this.settings = await this.save.loadSettings();
    this.saveInfo = await this.save.load();
    // Laisse le navigateur afficher l'écran de chargement avant le calcul de la ville.
    await new Promise((r) => setTimeout(r, 30));
    const map = generateCity();
    this.world = new World(map);
    this.audio = new AudioSystem(this.world);
    // Jeu en ligne : pair-à-pair sur le site du jeu ; indisponible dans la version en un seul fichier (cadre intégré).
    // ?net=local : les onglets d'un même navigateur jouent ensemble (développement et tests).
    const netMode = new URLSearchParams(location.search).get('net');
    const p2pOk = !import.meta.env.VITE_SINGLE_FILE && typeof RTCPeerConnection !== 'undefined';
    this.net = new NetSystem(this.world, netMode === 'local' ? () => localTransport() : p2pOk ? () => trysteroTransport() : null);
    this.world.bus.on('playerHorn', () => this.net.horn());
    // Lien d'invitation : ?groupe=CODE. Le joueur rejoindra ce groupe en entrant en jeu (après son accord).
    const invite = normalizeGroupCode(new URLSearchParams(location.search).get('groupe') ?? '');
    if (invite && this.net.status !== 'unavailable') this.pendingInvite = invite;
    msg('Lecture des nouvelles de la semaine…');
    await this.loadData();
    msg('Allumage des néons…');
    this.resolveTouch();
    this.resolveQuality();
    this.applySettings();
    this.ui = new UI(this, document.getElementById('ui')!);

    const size = internalSize();
    const deps: SceneDeps = {
      world: this.world,
      readInput: () => (this.playing && !this.ui.modal ? this.input.read() : (this.input.flush(), { moveX: 0, moveY: 0, run: false, interact: false, action: false, actionHeld: false, handbrake: false })),
      onFrame: (dt) => this.frame(dt),
      paintOpts: () => ({ glows: QUALITY[this.quality].glows, reflections: QUALITY[this.quality].reflections, lighting: this.world.mods.lighting, decor: this.world.mods.decor, billboard: this.world.mods.billboard }),
      effects: () => ({ glows: QUALITY[this.quality].glows, particles: QUALITY[this.quality].particles, rain: this.quality === 'high' }),
      remotes: () => this.net.peers.values(),
    };
    this.phaser = new Phaser.Game({
      type: Phaser.AUTO, parent: 'game', width: size.w, height: size.h, backgroundColor: '#0b0a16',
      pixelArt: true, antialias: false, roundPixels: true, banner: false,
      scale: { mode: Phaser.Scale.NONE, autoRound: true },
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      audio: { noAudio: true },
      render: { powerPreference: 'high-performance' },
      scene: [],
    });
    this.phaser.scene.add('game', GameScene, true, deps);
    await new Promise<void>((resolve) => {
      const wait = () => { const s = this.phaser.scene.getScene('game') as GameScene | null; if (s && s.ready) { this.scene = s; resolve(); } else setTimeout(wait, 30); };
      wait();
    });
    const resize = () => { const s = internalSize(); this.phaser.scale.resize(s.w, s.h); };
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));

    this.world.bus.on('save', (e) => void this.saveNow(e.reason));
    window.addEventListener('pagehide', () => void this.saveNow('fermeture'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) void this.saveNow('arrière-plan'); this.audio.suspend(document.hidden); });
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', () => { if (!this.touchSeen) { this.touchSeen = true; this.resolveTouch(); } }, { passive: true });
    window.addEventListener('online', () => void this.refreshWeekly());

    this.world.warmup();
    document.getElementById('boot')?.remove();
    this.ui.showMain();
    this.registerServiceWorker();
    (window as any).__klaxo = this;
  }

  // ---------- Données ----------
  /** Charge un fichier de données ; garde en cache local la dernière version valide pour le hors-ligne. */
  private async cached<T>(path: string, valid: (d: any) => boolean): Promise<{ data: T | null; fresh: boolean }> {
    const key = 'data:' + path;
    const fresh = await fetchJson(path);
    if (fresh && valid(fresh)) { try { await this.save.store.set(key, fresh); } catch { /* cache facultatif */ } return { data: fresh as T, fresh: true }; }
    try { const old = await this.save.store.get(key); if (old && valid(old)) return { data: old as T, fresh: false }; } catch { /* rien en cache */ }
    return { data: null, fresh: false };
  }
  private async loadData(): Promise<void> {
    const w = this.world, map = w.map;
    const [story, weekly, changes, events, archive] = await Promise.all([
      fetchJson('missions/story.json'),
      this.cached<any>('missions/weekly.json', (d) => d?.schema === 1 && Array.isArray(d.missions) && d.missions.length > 0 && validateMission(d.missions[0], map).ok),
      this.cached<WeeklyChangesFile>('world/weekly-changes.json', (d) => validateChanges(d).ok),
      this.cached<any>('world/events.json', (d) => d?.schema === 1 && Array.isArray(d.events)),
      this.cached<ArchiveIndex>('missions/archive/index.json', (d) => d?.schema === 1 && Array.isArray(d.items)),
    ]);
    const storyList = story?.schema === 1 && Array.isArray(story.missions) ? story.missions : (storyBundled as any).missions;
    const wk: MissionDef | null = weekly.data ? (weekly.data.missions[0] as MissionDef) : null;
    this.weekly = { mission: wk, changes: changes.data, archive: archive.data ?? { schema: 1, items: [] }, online: !!story };
    w.mods.apply(changes.data, new Date());
    w.pedSys.extraChatter = w.mods.chatter;
    w.missions.load(storyList, wk, this.weekly.archive);
    if (events.data) w.randomEvents.load(events.data);
  }
  private async refreshWeekly(): Promise<void> {
    if (this.weekly.online) return;
    const before = this.weekly.mission?.id;
    await this.loadData();
    if (this.weekly.mission && this.weekly.mission.id !== before && this.playing) this.world.bus.emit('toast', { text: 'Nouvelle mission d’actualité disponible au kiosque.', kind: 'news', ttl: 5 });
    if (this.scene) this.scene.repaintAll();
  }
  async fetchArchive(file: string): Promise<MissionDef | null> {
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(file)) return null;
    const r = await this.cached<any>('missions/archive/' + file, (d) => d?.schema === 1 && Array.isArray(d.missions) && d.missions.length > 0 && validateMission(d.missions[0], this.world.map).ok);
    return r.data ? (r.data.missions[0] as MissionDef) : null;
  }

  // ---------- Réglages ----------
  private resolveTouch(): void {
    const s = this.settings.touch;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.touchMode = s === 'on' || (s === 'auto' && (coarse || this.touchSeen));
  }
  private resolveQuality(): void {
    const q = this.settings.quality;
    const prev = this.quality;
    this.quality = q === 'auto' ? (this.touchMode ? 'medium' : 'high') : q;
    if (this.world) this.world.quality = QUALITY[this.quality];
    if (prev !== this.quality && this.scene) this.scene.repaintAll();
  }
  applySettings(): void {
    this.resolveTouch();
    this.resolveQuality();
    this.audio.sound = this.settings.sound; this.audio.music = this.settings.music; this.audio.volume = this.settings.volume;
    this.audio.applySettings();
  }
  setPaused(on: boolean): void { this.world.paused = on && this.playing; }

  // ---------- Parties ----------
  private enterGame(): void {
    this.playing = true;
    this.audio.unlock();
    this.ui.showGame();
    const online = () => {
      if (this.net.status === 'unavailable') { this.intro(); return; }
      const invite = this.pendingInvite;
      if (invite) {
        this.pendingInvite = null;
        try { const u = new URL(location.href); u.searchParams.delete('groupe'); history.replaceState(null, '', u.toString()); } catch { /* adresse inchangée */ }
        const join = () => { this.goOnline({ kind: 'group', code: invite }); this.intro(); };
        if (this.settings.online === 'on') { join(); return; }
        this.world.paused = true;
        this.ui.menus.showOnlineConsent((on) => {
          this.world.paused = false;
          if (on) join(); else { this.settings.online = 'off'; void this.save.saveSettings(this.settings); this.intro(); }
        }, invite);
        return;
      }
      if (this.settings.online === 'ask') {
        this.world.paused = true;
        this.ui.menus.showOnlineConsent((on) => {
          this.settings.online = on ? 'on' : 'off';
          void this.save.saveSettings(this.settings);
          this.world.paused = false;
          if (on) this.connectSaved();
          this.intro();
        });
        return;
      }
      if (this.settings.online === 'on') this.connectSaved();
      this.intro();
    };
    if (!this.settings.shownStorageNotice) {
      this.settings.shownStorageNotice = true;
      void this.save.saveSettings(this.settings);
      this.world.paused = true;
      this.ui.menus.showStorageNotice(() => { this.world.paused = false; online(); });
    } else online();
  }
  private connectSaved(): void {
    const code = normalizeGroupCode(this.settings.netGroup);
    void this.net.connect(code ? { kind: 'group', code } : { kind: 'public' });
  }
  goOnline(target: NetTarget): void {
    this.settings.online = 'on';
    this.settings.netGroup = target.kind === 'group' ? target.code : '';
    void this.save.saveSettings(this.settings);
    if (this.playing) void this.net.connect(target);
  }
  snapshot(): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const done = (img: HTMLImageElement | null) => resolve(img);
      try {
        this.phaser.renderer.snapshot((s) => {
          const img = s as HTMLImageElement;
          if (!img || !(img instanceof HTMLImageElement)) return done(null);
          if (img.complete && img.naturalWidth) done(img); else { img.onload = () => done(img); img.onerror = () => done(null); }
        });
      } catch { done(null); }
      setTimeout(() => done(null), 1500);
    });
  }
  goOffline(): void {
    this.settings.online = 'off';
    void this.save.saveSettings(this.settings);
    void this.net.disconnect();
  }
  private intro(): void {
    const w = this.world;
    if (w.economy.get('introSeen')) return;
    w.economy.stats.introSeen = 1;
    const key = this.touchMode ? 'le bouton rose' : 'E';
    w.bus.emit('toast', { text: `Bienvenue à Klaxo. Approche-toi d’une voiture et appuie sur ${key} pour monter.`, kind: 'info', ttl: 7 });
    setTimeout(() => { if (this.playing) w.bus.emit('toast', { text: 'La flèche bleue indique quelqu’un qui a une mission pour toi.', kind: 'info', ttl: 7 }); }, 7500);
  }
  newGame(look: Look, name: string): void {
    const w = this.world;
    w.resetProgress();
    w.player.look = { ...look }; w.player.name = name;
    w.startGame();
    this.enterGame();
    void this.saveNow('nouvelle partie');
  }
  continueGame(): void {
    if (!this.saveInfo) return;
    const w = this.world;
    w.resetProgress();
    w.startGame();
    w.restore(this.saveInfo);
    w.economy.stats.introSeen = 1;
    this.enterGame();
  }
  toMenu(): void {
    void this.saveNow('menu').then(() => {
      this.playing = false;
      void this.net.disconnect(false);
      this.world.toAttract();
      this.ui.showMain();
    });
  }
  async saveNow(_reason: string): Promise<void> {
    if (!this.playing) return;
    const data = this.world.serialize();
    this.saveInfo = data;
    await this.save.save(data);
  }
  async importSave(data: SaveData): Promise<void> {
    await this.save.save(data);
    this.saveInfo = data;
    if (this.playing) { this.playing = false; this.world.toAttract(); }
    this.continueGame();
    this.world.bus.emit('toast', { text: 'Sauvegarde importée.', kind: 'good' });
  }
  async resetSave(): Promise<void> {
    this.playing = false;
    await this.save.clear();
    this.saveInfo = null;
  }

  // ---------- Chaque frame ----------
  private frame(dt: number): void {
    this.net.update(dt, this.playing);
    this.audio.update(dt);
    this.ui.update(dt);
    // Qualité automatique : on allège si l'appareil peine.
    if (this.settings.quality === 'auto' && this.quality !== 'low' && this.playing && !this.world.paused) {
      const fps = this.phaser.loop.actualFps;
      this.fpsLow = fps < 38 ? this.fpsLow + dt : Math.max(0, this.fpsLow - dt * 2);
      if (this.fpsLow > 4) {
        this.fpsLow = 0;
        this.quality = this.quality === 'high' ? 'medium' : 'low';
        this.world.quality = QUALITY[this.quality];
        this.scene?.repaintAll();
        this.world.bus.emit('toast', { text: 'Qualité graphique allégée pour garder le jeu fluide.', kind: 'info' });
      }
    }
  }

  /** Dessins réutilisés par les outils (image d'aperçu, bande-annonce). */
  art = { drawLogo, makeVictoryCard };

  /** Outils de test et de mise au point (console : __klaxo.debug). N'influence pas le jeu tant qu'on ne les appelle pas. */
  debug = {
    car: (type: VehicleType = 'sedan') => {
      const w = this.world, p = w.player;
      const r = w.map.nearestRoadPoint(p.px, p.py);
      const v = new Vehicle(type, r.x, r.y, r.angle);
      w.vehicles.push(v);
      return v;
    },
    tp: (poi: string, dx = 0, dy = 0) => { const w = this.world; const t = w.map.poiPx(poi); if (w.player.vehicle) { w.player.vehicle.x = t.x + dx; w.player.vehicle.y = t.y + dy; w.player.vehicle.vx = 0; w.player.vehicle.vy = 0; } w.player.x = t.x + dx; w.player.y = t.y + dy; },
    wanted: (n: number) => this.world.wanted.setLevel(n),
    money: (n: number) => this.world.economy.add(n, 'debug'),
    event: (type?: any) => this.world.randomEvents.trigger(type),
    state: () => {
      const w = this.world, p = w.player, r = w.missions.active;
      return { x: Math.round(p.px), y: Math.round(p.py), state: p.state, vehicle: p.vehicle?.type ?? null, speed: Math.round(p.speed), money: w.economy.money, level: w.economy.level, wanted: w.wanted.level,
        mission: r ? { id: r.def.id, step: r.stepIndex, objective: r.objective, timeLeft: r.timeLeft, state: r.state } : null, done: Object.keys(w.missions.done), prompt: w.prompt?.label ?? null,
        cars: w.vehicles.length, peds: w.peds.length, time: Math.round(w.time), paused: w.paused, busy: w.busy, district: w.district, secrets: w.secretsFound.size, quality: this.quality };
    },
  };

  private registerServiceWorker(): void {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD || import.meta.env.VITE_SINGLE_FILE) return;
    // Refusé dans certains cadres intégrés : le jeu fonctionne sans, mais pas hors ligne.
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  }
}

const game = new Game();
game.boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('boot-msg');
  if (el) el.textContent = `Le jeu n’a pas pu démarrer : ${err?.message ?? err}. Recharge la page.`;
});
console.info(`KLAXO v${GAME_VERSION}`);
