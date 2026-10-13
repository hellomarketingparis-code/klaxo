import Phaser from 'phaser';
import { CHUNK_PX, CHUNKS_X, CHUNKS_Y, TILE, WORLD_H, WORLD_W } from '../engine/config';
import { clamp, lerp } from '../engine/math';
import { paintChunk } from '../map/painter';
import type { PaintOpts } from '../map/painter';
import { carSize, drawBeam, drawGlow, drawIcon, drawPedSheet, drawTrafficLight, drawTree, drawVehicle, PED_FRAME, PED_FRAMES } from '../assets/textures';
import type { IconName } from '../assets/textures';
import type { Vehicle } from '../vehicles/Vehicle';
import type { Ped } from '../npc/Ped';
import { lookKey } from '../npc/looks';
import type { Look } from '../npc/looks';
import { GUARD_FOV, GUARD_RANGE } from '../missions/MissionRunner';
import type { GuardState } from '../missions/MissionRunner';
import type { World } from '../world/World';
import type { Intent } from '../player/Player';

interface ChunkView { img: Phaser.GameObjects.Image; key: string; objs: Phaser.GameObjects.GameObject[]; lights: { node: number; arm: number; img: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }[]; }
interface VehView { body: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; beam: Phaser.GameObjects.Image; tail: Phaser.GameObjects.Image; siren?: Phaser.GameObjects.Image; key: string; smokeT: number; }
interface Particle { img: Phaser.GameObjects.Image; vx: number; vy: number; life: number; max: number; grow: number; a0: number; }

export interface SceneDeps {
  world: World;
  /** Fournit l'intention du joueur pour la frame. */
  readInput: () => Intent;
  /** Appelé après chaque frame pour mettre l'interface à jour. */
  onFrame: (dt: number) => void;
  paintOpts: () => PaintOpts;
  effects: () => { glows: boolean; particles: boolean; rain: boolean };
}

const DEPTH = { ground: 0, decal: 1, shadow: 3, ped: 5, player: 5.5, car: 6, tl: 7, tree: 8, light: 9, fx: 10, marker: 11 };
const TL_OFF = 34;

/** Affichage de la ville : chunks peints à la demande, entités, lumières, effets, caméra. */
export class GameScene extends Phaser.Scene {
  private w!: World;
  private deps!: SceneDeps;
  private chunks = new Map<number, ChunkView>();
  private queue: number[] = [];
  private vehViews = new Map<number, VehView>();
  private pedViews = new Map<number, Phaser.GameObjects.Sprite>();
  private playerSprite!: Phaser.GameObjects.Sprite;
  private carry!: Phaser.GameObjects.Image;
  private gfx!: Phaser.GameObjects.Graphics;
  private cones!: Phaser.GameObjects.Graphics;
  private icons: Phaser.GameObjects.Image[] = [];
  private particles: Particle[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  private rain?: Phaser.GameObjects.TileSprite;
  private camX = 0; private camY = 0;
  private shake = 0;
  private playerKey = '';
  /** Nombre de chunks peints (statistiques et tests). */
  paintedChunks = 0;
  /** Temps cumulé de peinture des chunks, en millisecondes. */
  paintMs = 0;
  ready = false;

  constructor() { super('game'); }

  init(data: SceneDeps): void { this.deps = data; this.w = data.world; }

  create(): void {
    this.makeTextures();
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H).setBackgroundColor('#0b0a16').setRoundPixels(true);
    this.gfx = this.add.graphics().setDepth(DEPTH.marker);
    this.cones = this.add.graphics().setDepth(DEPTH.decal).setBlendMode(Phaser.BlendModes.ADD);
    this.playerSprite = this.add.sprite(0, 0, this.ensurePed(this.w.player.look), 0).setDepth(DEPTH.player).setVisible(false);
    this.carry = this.add.image(0, 0, 'ic_box').setDepth(DEPTH.player + 0.1).setVisible(false);
    this.camX = this.w.focusX; this.camY = this.w.focusY;
    const bus = this.w.bus;
    bus.on('crash', (e) => { this.sparks(e.x, e.y, Math.min(10, 3 + Math.floor(e.force / 25))); if (e.force > 70) this.shake = Math.min(5, this.shake + e.force / 60); });
    bus.on('flash', (e) => this.emit('glow', e.x, e.y, 0, 0, 0.18, 0.9, 0, 0xffffff, 1.2));
    bus.on('busted', () => { this.camX = this.w.focusX; this.camY = this.w.focusY; });
    this.scale.on('resize', () => this.onResize());
    this.onResize();
    // Peint immédiatement ce qui est visible pour éviter un écran vide.
    this.syncChunks(true);
    this.ready = true;
  }

  private onResize(): void {
    const { width, height } = this.scale.gameSize;
    this.w.viewW = width; this.w.viewH = height;
    this.cameras.main.setSize(width, height);
    if (this.rain) this.rain.setSize(width, height);
  }

  // ---------- Textures ----------
  private canvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
    if (this.textures.exists(key)) return;
    const t = this.textures.createCanvas(key, w, h)!;
    const ctx = t.getContext();
    ctx.imageSmoothingEnabled = false;
    draw(ctx);
    t.refresh();
  }
  private makeTextures(): void {
    this.canvasTex('glow', 64, 64, (c) => drawGlow(c, 64));
    this.canvasTex('beam', 60, 46, (c) => drawBeam(c, 60, 46));
    this.canvasTex('px', 2, 2, (c) => { c.fillStyle = '#fff'; c.fillRect(0, 0, 2, 2); });
    for (let v = 0; v < 4; v++) { const s = v === 3 ? 18 : 28; this.canvasTex('tree' + v, s, s, (c) => drawTree(c, v, s)); }
    for (const n of ['excl', 'star', 'box', 'neon', 'item', 'talk', 'news'] as IconName[]) this.canvasTex('ic_' + n, 11, 11, (c) => drawIcon(c, n));
    for (const s of ['r', 'y', 'g', 'off'] as const) this.canvasTex('tl_' + s, 5, 11, (c) => drawTrafficLight(c, s));
    this.canvasTex('rain', 64, 64, (c) => {
      c.strokeStyle = 'rgba(170,190,255,0.5)'; c.lineWidth = 1;
      for (let i = 0; i < 9; i++) { const x = (i * 29) % 64, y = (i * 47) % 64; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 2, y + 6); c.stroke(); }
    });
  }
  ensureCar(type: Vehicle['type'], color: number, damaged: boolean): string {
    const key = `car_${type}_${color.toString(16)}${damaged ? '_d' : ''}`;
    const sz = carSize(type);
    this.canvasTex(key, sz.w, sz.h, (c) => drawVehicle(c, type, color, damaged));
    return key;
  }
  ensurePed(look: Look): string {
    const key = lookKey(look);
    if (!this.textures.exists(key)) {
      const t = this.textures.createCanvas(key, PED_FRAME * PED_FRAMES, PED_FRAME)!;
      drawPedSheet(t.getContext(), look);
      for (let i = 0; i < PED_FRAMES; i++) t.add(i, 0, i * PED_FRAME, 0, PED_FRAME, PED_FRAME);
      t.refresh();
    }
    return key;
  }

  // ---------- Chunks ----------
  /** Force la reconstruction de tous les chunks (changement de qualité ou de décor). */
  repaintAll(): void {
    for (const id of [...this.chunks.keys()]) this.unloadChunk(id);
    this.queue = [];
    this.syncChunks(true);
  }
  private syncChunks(immediate = false): void {
    const cam = this.cameras.main;
    const hw = cam.width / 2 + 96, hh = cam.height / 2 + 96;
    const c0x = clamp(Math.floor((this.camX - hw) / CHUNK_PX), 0, CHUNKS_X - 1), c1x = clamp(Math.floor((this.camX + hw) / CHUNK_PX), 0, CHUNKS_X - 1);
    const c0y = clamp(Math.floor((this.camY - hh) / CHUNK_PX), 0, CHUNKS_Y - 1), c1y = clamp(Math.floor((this.camY + hh) / CHUNK_PX), 0, CHUNKS_Y - 1);
    const want = new Set<number>();
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) want.add(cy * CHUNKS_X + cx);
    for (const id of want) if (!this.chunks.has(id) && !this.queue.includes(id)) this.queue.push(id);
    for (const id of [...this.chunks.keys()]) {
      if (want.has(id)) continue;
      const cx = id % CHUNKS_X, cy = Math.floor(id / CHUNKS_X);
      // On garde une marge d'un chunk pour éviter de repeindre en boucle.
      if (cx < c0x - 1 || cx > c1x + 1 || cy < c0y - 1 || cy > c1y + 1) this.unloadChunk(id);
    }
    this.queue = this.queue.filter((id) => want.has(id));
    let budget = immediate ? 99 : 1;
    while (budget-- > 0 && this.queue.length) this.loadChunk(this.queue.shift()!);
  }
  private loadChunk(id: number): void {
    const m = this.w.map;
    const cx = id % CHUNKS_X, cy = Math.floor(id / CHUNKS_X);
    const key = 'chunk_' + id;
    if (this.textures.exists(key)) this.textures.remove(key);
    const t0 = performance.now();
    const tex = this.textures.createCanvas(key, CHUNK_PX, CHUNK_PX)!;
    paintChunk(tex.getContext(), m, cx, cy, this.deps.paintOpts());
    tex.refresh();
    this.paintedChunks++;
    this.paintMs += performance.now() - t0;
    const img = this.add.image(cx * CHUNK_PX, cy * CHUNK_PX, key).setOrigin(0).setDepth(DEPTH.ground);
    const objs: Phaser.GameObjects.GameObject[] = [];
    for (const ti of m.chunkTrees[id]) {
      const t = m.trees[ti];
      objs.push(this.add.image(t.x, t.y - (t.variant === 3 ? 2 : 3), 'tree' + t.variant).setDepth(DEPTH.tree));
    }
    const lights: ChunkView['lights'] = [];
    for (const ni of m.chunkNodes[id]) {
      const n = m.nodes[ni];
      if (!n.signal) continue;
      const x0 = n.bx * TILE, y0 = n.by * TILE, x1 = (n.bx + n.bw) * TILE, y1 = (n.by + n.bh) * TILE;
      const pos = [[x0 - 6, y0 - TL_OFF], [x1 + TL_OFF, y0 - 6], [x1 + 6, y1 + TL_OFF], [x0 - TL_OFF, y1 + 6]];
      for (let arm = 0; arm < 4; arm++) {
        if (n.arms[arm] < 0) continue;
        const im = this.add.image(pos[arm][0], pos[arm][1], 'tl_r').setDepth(DEPTH.tl);
        const gl = this.add.image(pos[arm][0], pos[arm][1], 'glow').setDepth(DEPTH.light).setBlendMode(Phaser.BlendModes.ADD).setScale(0.32).setAlpha(0.55);
        lights.push({ node: ni, arm, img: im, glow: gl });
        objs.push(im, gl);
      }
    }
    this.chunks.set(id, { img, key, objs, lights });
  }
  private unloadChunk(id: number): void {
    const c = this.chunks.get(id);
    if (!c) return;
    c.img.destroy();
    for (const o of c.objs) o.destroy();
    this.textures.remove(c.key);
    this.chunks.delete(id);
  }

  // ---------- Particules ----------
  private emit(tex: string, x: number, y: number, vx: number, vy: number, life: number, alpha: number, grow: number, tint: number, scale: number, add = true): void {
    if (this.particles.length > 90) return;
    const img = this.pool.pop() ?? this.add.image(0, 0, tex);
    img.setTexture(tex).setPosition(x, y).setAlpha(alpha).setScale(scale).setTint(tint).setDepth(DEPTH.fx).setVisible(true).setBlendMode(add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    this.particles.push({ img, vx, vy, life, max: life, grow, a0: alpha });
  }
  private sparks(x: number, y: number, n: number): void {
    if (!this.deps.effects().particles) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, s = 30 + Math.random() * 70;
      this.emit('px', x, y, Math.cos(a) * s, Math.sin(a) * s, 0.25 + Math.random() * 0.25, 1, 0, Math.random() < 0.5 ? 0xffd84a : 0xfff3b0, 0.6);
    }
  }
  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { p.img.setVisible(false); this.pool.push(p.img); this.particles.splice(i, 1); continue; }
      p.img.x += p.vx * dt; p.img.y += p.vy * dt;
      p.img.setAlpha(p.a0 * (p.life / p.max));
      if (p.grow) p.img.setScale(p.img.scaleX + p.grow * dt);
    }
  }

  // ---------- Boucle ----------
  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    const w = this.w;
    const fx = this.deps.effects();
    if (w.attract) {
      // Vitrine du menu : la caméra flâne dans le centre-ville.
      const c = w.map.poiPx('x_centre');
      const t = w.time * 0.035;
      w.focusX = c.x + Math.cos(t) * 330 + Math.cos(t * 2.3) * 70;
      w.focusY = c.y - 120 + Math.sin(t * 1.3) * 260;
    }
    w.update(dt, this.deps.readInput());

    // Caméra : suit le joueur avec une légère anticipation dans le sens du déplacement.
    const p = w.player;
    let tx = w.focusX, ty = w.focusY;
    if (!w.attract) {
      const vx = p.driving ? p.vehicle!.vx : p.vx, vy = p.driving ? p.vehicle!.vy : p.vy;
      tx += clamp(vx * 0.32, -70, 70); ty += clamp(vy * 0.32, -50, 50);
    }
    const k = 1 - Math.exp(-(w.attract ? 2 : 6) * dt);
    if (Math.abs(tx - this.camX) > 400 || Math.abs(ty - this.camY) > 400) { this.camX = tx; this.camY = ty; }
    this.camX = lerp(this.camX, tx, k); this.camY = lerp(this.camY, ty, k);
    this.shake = Math.max(0, this.shake - dt * 14);
    const cam = this.cameras.main;
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0, sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    cam.setScroll(Math.round(this.camX - cam.width / 2 + sx), Math.round(this.camY - cam.height / 2 + sy));

    this.syncChunks();
    this.syncLights();
    this.syncVehicles(dt, fx);
    this.syncPeds();
    this.syncPlayer();
    this.drawOverlays();
    this.updateParticles(dt);
    if (fx.rain) {
      if (!this.rain) this.rain = this.add.tileSprite(0, 0, cam.width, cam.height, 'rain').setOrigin(0).setScrollFactor(0).setDepth(DEPTH.fx + 1).setAlpha(0.28).setBlendMode(Phaser.BlendModes.ADD);
      this.rain.setVisible(true);
      this.rain.tilePositionX = cam.scrollX * 0.6 + w.time * 40; this.rain.tilePositionY = cam.scrollY * 0.6 - w.time * 260;
    } else if (this.rain) this.rain.setVisible(false);
    this.deps.onFrame(dt);
  }

  private syncLights(): void {
    const w = this.w, m = w.map;
    const blink = w.mods.lightsMode === 'blink';
    for (const c of this.chunks.values()) {
      for (const l of c.lights) {
        const n = m.nodes[l.node];
        let s: string = m.signalState(n, l.arm === 0 || l.arm === 2, w.time);
        if (blink) s = Math.floor(w.time * 1.6) % 2 ? 'y' : 'off';
        const key = 'tl_' + s;
        if (l.img.texture.key !== key) {
          l.img.setTexture(key);
          l.glow.setTint(s === 'r' ? 0xff3b3b : s === 'y' ? 0xffc21a : 0x3bff7a).setVisible(s !== 'off');
        }
      }
    }
  }

  private syncVehicles(dt: number, fx: { glows: boolean; particles: boolean }): void {
    const w = this.w;
    const seen = new Set<number>();
    const cam = this.cameras.main;
    for (const v of w.vehicles) {
      seen.add(v.id);
      let view = this.vehViews.get(v.id);
      const dmg = v.hp < v.spec.hp * 0.45;
      const key = this.ensureCar(v.type, v.color, dmg);
      if (!view) {
        const body = this.add.image(v.x, v.y, key).setDepth(DEPTH.car);
        const shadow = this.add.image(v.x, v.y, key).setDepth(DEPTH.shadow).setTintFill(0x05040f).setAlpha(0.4);
        const beam = this.add.image(v.x, v.y, 'beam').setOrigin(0, 0.5).setDepth(DEPTH.light).setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff0c8).setAlpha(0.5);
        const tail = this.add.image(v.x, v.y, 'glow').setDepth(DEPTH.light).setBlendMode(Phaser.BlendModes.ADD).setTint(0xff2a2a).setScale(0.3);
        view = { body, shadow, beam, tail, key, smokeT: 0 };
        this.vehViews.set(v.id, view);
      }
      if (view.key !== key) { view.body.setTexture(key); view.shadow.setTexture(key); view.key = key; }
      const vis = Math.abs(v.x - this.camX) < cam.width / 2 + 70 && Math.abs(v.y - this.camY) < cam.height / 2 + 70;
      view.body.setVisible(vis); view.shadow.setVisible(vis);
      const engine = v.driver !== 'none' && !v.dead;
      const lit = vis && fx.glows && (engine || v.siren);
      view.beam.setVisible(lit && engine); view.tail.setVisible(lit);
      if (view.siren) view.siren.setVisible(vis && v.siren);
      if (!vis) continue;
      const cos = Math.cos(v.angle), sin = Math.sin(v.angle);
      view.body.setPosition(v.x, v.y).setRotation(v.angle);
      view.shadow.setPosition(v.x + 2, v.y + 3).setRotation(v.angle);
      if (lit) {
        const h = v.spec.len / 2;
        view.beam.setPosition(v.x + cos * (h - 1), v.y + sin * (h - 1)).setRotation(v.angle);
        view.tail.setPosition(v.x - cos * h, v.y - sin * h).setAlpha(v.braking ? 0.95 : 0.4).setScale(v.braking ? 0.42 : 0.28);
      }
      if (v.siren) {
        if (!view.siren) view.siren = this.add.image(v.x, v.y, 'glow').setDepth(DEPTH.light).setBlendMode(Phaser.BlendModes.ADD);
        const ph = Math.floor(w.time * 5 + v.id) % 2;
        view.siren.setPosition(v.x, v.y).setTint(ph ? 0xff2a2a : 0x2a5aff).setScale(fx.glows ? 1.25 : 0.6).setAlpha(0.75).setVisible(true);
      }
      if (v.smoke > 0 || dmg) {
        view.smokeT -= dt;
        if (view.smokeT <= 0 && fx.particles) {
          view.smokeT = v.dead ? 0.12 : 0.3;
          this.emit('glow', v.x + cos * v.spec.len * 0.3, v.y + sin * v.spec.len * 0.3, (Math.random() - 0.5) * 8, -10 - Math.random() * 8, 1.1, v.dead ? 0.5 : 0.28, 0.5, v.dead ? 0x555066 : 0x8a86a0, 0.14, false);
        }
      }
    }
    for (const [id, view] of this.vehViews) {
      if (seen.has(id)) continue;
      view.body.destroy(); view.shadow.destroy(); view.beam.destroy(); view.tail.destroy(); view.siren?.destroy();
      this.vehViews.delete(id);
    }
  }

  private pedFrame(q: { state?: string; moving: boolean; animT: number }): number {
    if (q.state === 'down' || q.state === 'stunned') return 5;
    return q.moving ? 1 + (Math.floor(q.animT) % 4) : 0;
  }
  private syncPeds(): void {
    const w = this.w;
    const seen = new Set<number>();
    const cam = this.cameras.main;
    for (const q of w.peds) {
      seen.add(q.id);
      let sp = this.pedViews.get(q.id);
      if (!sp) { sp = this.add.sprite(q.x, q.y, this.ensurePed(q.look), 0).setDepth(DEPTH.ped); this.pedViews.set(q.id, sp); }
      const vis = Math.abs(q.x - this.camX) < cam.width / 2 + 20 && Math.abs(q.y - this.camY) < cam.height / 2 + 20;
      sp.setVisible(vis);
      if (!vis) continue;
      sp.setPosition(q.x, q.y).setRotation(q.angle).setFrame(this.pedFrame(q));
    }
    for (const [id, sp] of this.pedViews) if (!seen.has(id)) { sp.destroy(); this.pedViews.delete(id); }
  }
  private syncPlayer(): void {
    const w = this.w, p = w.player;
    const key = lookKey(p.look);
    if (key !== this.playerKey) { this.playerKey = key; this.playerSprite.setTexture(this.ensurePed(p.look), 0); }
    const show = !w.attract && p.state !== 'driving';
    this.playerSprite.setVisible(show);
    if (show) {
      const fade = p.state === 'entering' ? clamp(p.timer / 0.28, 0, 1) : p.state === 'exiting' ? 1 - clamp(p.timer / 0.28, 0, 1) : 1;
      this.playerSprite.setPosition(p.x, p.y).setRotation(p.angle).setFrame(this.pedFrame(p)).setAlpha(0.35 + fade * 0.65);
    }
    const carrying = show && !!p.carrying;
    this.carry.setVisible(carrying);
    if (carrying) {
      this.carry.setTexture(p.carrying === 'neon' ? 'ic_neon' : 'ic_box').setScale(0.7);
      this.carry.setPosition(p.x - Math.cos(p.angle) * 5, p.y - Math.sin(p.angle) * 5).setRotation(p.angle);
    }
  }

  private icon(i: number, tex: string, x: number, y: number, alpha = 1): number {
    let im = this.icons[i];
    if (!im) { im = this.add.image(0, 0, tex).setDepth(DEPTH.marker); this.icons[i] = im; }
    im.setTexture(tex).setPosition(x, y).setAlpha(alpha).setVisible(true);
    return i + 1;
  }
  /** Marqueurs de mission, donneurs, lieux secrets, champs de vision des gardes. */
  private drawOverlays(): void {
    const w = this.w, g = this.gfx, m = w.map;
    g.clear(); this.cones.clear();
    let n = 0;
    const bob = Math.sin(w.time * 5) * 1.5;
    const pulse = 0.5 + 0.5 * Math.sin(w.time * 4);
    if (!w.attract) {
      for (const [id, ped] of w.missions.givers) {
        const def = w.missions.find(id);
        n = this.icon(n, def?.kind === 'weekly' ? 'ic_news' : 'ic_talk', ped.x, ped.y - 14 + bob);
      }
      const side = w.missions.sideMarker;
      if (side) n = this.icon(n, 'ic_excl', side.x, side.y - 14 + bob);
      const r = w.missions.active;
      if (r) {
        for (const mk of r.markers) {
          const a = mk.dim ? 0.35 : 1;
          if (mk.kind === 'target' || mk.kind === 'checkpoint') {
            const rad = mk.radius ?? 30;
            const col = mk.kind === 'checkpoint' ? 0x22e0ff : 0xff2e88;
            g.lineStyle(1, col, a * (0.55 + 0.4 * pulse)); g.strokeCircle(mk.x, mk.y, rad);
            g.lineStyle(1, col, a * 0.25); g.strokeCircle(mk.x, mk.y, rad * (0.55 + 0.25 * pulse));
            g.fillStyle(col, a * 0.07); g.fillCircle(mk.x, mk.y, rad);
          } else if (mk.kind === 'item') {
            g.fillStyle(0x22e0ff, 0.16 + 0.1 * pulse); g.fillCircle(mk.x, mk.y, 9);
            const carried = r.step && (r.step as any).item?.id;
            n = this.icon(n, carried === 'neon' ? 'ic_neon' : carried === 'colis' || carried === 'commande' ? 'ic_box' : 'ic_item', mk.x, mk.y - 2 + bob);
          } else if (mk.kind === 'npc') {
            n = this.icon(n, 'ic_talk', mk.x, mk.y - 14 + bob);
            if (mk.radius) { g.lineStyle(1, 0xffd84a, 0.5 + 0.3 * pulse); g.strokeCircle(mk.x, mk.y, mk.radius); }
          } else if (mk.kind === 'vehicle') {
            g.fillStyle(0xff2e88, 0.9); g.fillTriangle(mk.x - 4, mk.y - 22 + bob, mk.x + 4, mk.y - 22 + bob, mk.x, mk.y - 16 + bob);
          }
        }
        // Champs de vision des vigiles, découpés par les obstacles.
        for (const guard of r.guards) {
          const ai = guard.ai as GuardState;
          const col = ai.detect > 0.5 ? 0xff3b3b : ai.detect > 0.05 ? 0xffb627 : 0xffe9a8;
          this.cones.fillStyle(col, 0.16 + ai.detect * 0.2);
          const pts: number[] = [guard.x, guard.y];
          for (let i = 0; i <= 14; i++) {
            const a = guard.angle - GUARD_FOV + (2 * GUARD_FOV * i) / 14;
            const ca = Math.cos(a), sa = Math.sin(a);
            let d = 0;
            for (; d < GUARD_RANGE; d += 5) { const tx = Math.floor((guard.x + ca * (d + 5)) / TILE), ty = Math.floor((guard.y + sa * (d + 5)) / TILE); if (!m.inb(tx, ty) || m.opaque[m.idx(tx, ty)]) break; }
            pts.push(guard.x + ca * d, guard.y + sa * d);
          }
          this.cones.beginPath(); this.cones.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) this.cones.lineTo(pts[i], pts[i + 1]);
          this.cones.closePath(); this.cones.fillPath();
        }
      }
      for (const s of m.secrets) {
        if (w.secretsFound.has(s.id)) continue;
        const x = (s.tx + 0.5) * TILE, y = (s.ty + 0.5) * TILE;
        if (Math.abs(x - this.camX) > this.cameras.main.width / 2 + 20 || Math.abs(y - this.camY) > this.cameras.main.height / 2 + 20) continue;
        g.fillStyle(0xffd84a, 0.14 + 0.1 * pulse); g.fillCircle(x, y, 8);
        n = this.icon(n, 'ic_star', x, y + bob * 0.6);
      }
      // Indicateur d'interaction sous la cible.
      if (w.prompt) { g.lineStyle(1, 0xf5f5ff, 0.5 + 0.4 * pulse); g.strokeCircle(w.prompt.x, w.prompt.y, w.prompt.kind === 'vehicle' ? 16 : 9); }
    }
    for (let i = n; i < this.icons.length; i++) this.icons[i].setVisible(false);
  }

  /** Conversion monde → écran (0..1), pour positionner l'interface HTML. */
  project(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: (x - cam.scrollX) / cam.width, y: (y - cam.scrollY) / cam.height };
  }
  get stats(): { chunks: number; vehicles: number; peds: number; fps: number } {
    return { chunks: this.chunks.size, vehicles: this.vehViews.size, peds: this.pedViews.size, fps: Math.round(this.game.loop.actualFps) };
  }
}
