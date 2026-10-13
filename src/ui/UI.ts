import { RNG, hashStr } from '../engine/rng';
import { drawPortrait } from '../assets/textures';
import { randomLook } from '../npc/looks';
import type { Look } from '../npc/looks';
import { DISTRICT_NAMES } from '../map/tiles';
import type { DialogLine } from '../world/events';
import type { App } from '../app';
import { Hud } from './hud';
import { Menus } from './menus';
import { TouchControls } from './touch';
import { h, clear } from './dom';

interface Bubble { el: HTMLElement; id: number; x: number; y: number; until: number; }

/** Façade de l'interface : relie les événements du monde aux éléments HTML. */
export class UI {
  hud: Hud;
  menus: Menus;
  touch: TouchControls;
  private root: HTMLElement;
  private bubblesEl = h('div', { id: 'bubbles' });
  private toastsEl!: HTMLElement;
  private overlay = h('div', { id: 'overlay' });
  private banner = h('div', { id: 'banner' });
  private cardEl: HTMLElement | null = null;
  private cardT = 0;
  private bannerT = 0;
  private bubbles: Bubble[] = [];
  private dialog: { el: HTMLElement; lines: DialogLine[]; i: number; shown: number; text: HTMLElement; who: HTMLElement; canvas: HTMLCanvasElement; done?: () => void; key: (e: KeyboardEvent) => void } | null = null;
  private reveal: { el: HTMLElement; key: (e: KeyboardEvent) => void } | null = null;

  constructor(private app: App, mountPoint: HTMLElement) {
    this.root = mountPoint;
    this.hud = new Hud(app, () => this.togglePause(), () => this.openMap());
    this.menus = new Menus(app, this.hud, this.overlay);
    this.touch = new TouchControls(app);
    this.menus.onChange = () => this.syncPause();
    this.toastsEl = this.hud.toasts;
    this.hud.root.append(this.banner);
    mountPoint.append(this.bubblesEl, this.hud.root, this.touch.root, this.overlay);

    const bus = app.world.bus;
    bus.on('toast', (e) => this.toast(e.text, e.kind ?? 'info', e.ttl ?? 3.2));
    bus.on('bubble', (e) => this.bubble(e.id, e.x, e.y, e.text, e.ttl ?? 2.4));
    bus.on('dialog', (e) => this.showDialog(e.lines, e.onDone));
    bus.on('reveal', (e) => this.showReveal(e.title, e.text, e.onDone));
    bus.on('card', (e) => this.card(e.title, e.subtitle ?? '', e.kind));
    bus.on('busted', (e) => this.card('Arrêté !', `Amende : ${e.fine} ¤. Tu ressors du commissariat.`, 'fail'));
    bus.on('district', (e) => { if (app.playing) this.showBanner(DISTRICT_NAMES[e.id]); });
    bus.on('shop', (e) => this.openShop(e.poi));
    app.input.onKey = (k) => {
      if (k === 'pause') this.togglePause();
      else if (k === 'map') this.openMap();
      else if (k === 'retry') { if (app.playing && !this.menus.open && app.world.missions.retry()) this.hideCard(); }
    };
    // Changement d'onglet ou écran verrouillé : pause automatique.
    document.addEventListener('visibilitychange', () => { if (document.hidden && app.playing && !this.modal) { this.menus.showPause('missions'); this.syncPause(); } });
  }

  private syncPause(): void { this.app.setPaused(this.menus.open); }
  togglePause(): void {
    if (this.dialog || this.reveal) return;
    if (this.menus.open) {
      if (this.menus.kind === 'pause' || this.menus.kind === 'shop') { if (this.app.playing) this.menus.close(); else this.menus.showMain(); }
      else if (this.menus.kind === 'creator' || this.menus.kind === 'confirm') this.menus.showMain();
    } else if (this.app.playing) this.menus.showPause('missions');
    this.syncPause();
  }
  openMap(): void {
    if (!this.app.playing || this.dialog || this.reveal) return;
    if (this.menus.open) { if (this.menus.kind === 'pause') this.menus.close(); } else this.menus.showPause('map');
    this.syncPause();
  }
  openShop(poi: string): void {
    if (this.menus.open) return;
    this.touch.reset();
    this.menus.showShop(poi);
    this.syncPause();
  }
  showMain(): void { this.hud.root.hidden = true; this.touch.root.hidden = true; this.clearTransient(); this.menus.showMain(); }
  showGame(): void { this.menus.close(); this.hud.root.hidden = false; this.syncPause(); }
  private clearTransient(): void {
    clear(this.toastsEl); clear(this.bubblesEl); this.bubbles = [];
    this.hideCard(); this.banner.classList.remove('on');
  }

  // ---------- Messages ----------
  toast(text: string, kind: string, ttl: number): void {
    if (!this.app.playing) return;
    const el = h('div', { class: `toast ${kind}`, text, role: 'status' });
    this.toastsEl.append(el);
    while (this.toastsEl.children.length > 3) this.toastsEl.firstElementChild!.remove();
    window.setTimeout(() => { el.classList.add('out'); window.setTimeout(() => el.remove(), 380); }, ttl * 1000);
  }
  bubble(id: number, x: number, y: number, text: string, ttl: number): void {
    if (this.bubbles.length >= 7) return;
    this.bubbles = this.bubbles.filter((b) => { if (b.id === id) { b.el.remove(); return false; } return true; });
    const el = h('div', { class: 'bubble', text });
    this.bubblesEl.append(el);
    this.bubbles.push({ el, id, x, y, until: performance.now() + ttl * 1000 });
  }
  card(title: string, subtitle: string, kind: string): void {
    this.hideCard();
    const el = h('div', { id: 'card', class: kind, role: 'status' }, h('div', { class: 'c-sub', text: subtitle }), h('div', { class: 'c-title', text: title }));
    if (kind === 'fail' && this.app.world.missions.lastFailed) {
      el.append(h('button', { class: 'btn small', text: this.app.touchMode ? 'Réessayer' : 'Réessayer (R)', onclick: () => { if (this.app.world.missions.retry()) this.hideCard(); } }));
      this.cardT = 7;
    } else this.cardT = kind === 'start' ? 2.6 : 3.4;
    this.hud.root.append(el);
    this.cardEl = el;
  }
  private hideCard(): void { this.cardEl?.remove(); this.cardEl = null; }
  showBanner(text: string): void { this.banner.textContent = text; this.banner.classList.add('on'); this.bannerT = 2.2; }

  // ---------- Dialogues ----------
  private lookFor(line: DialogLine): Look {
    const w = this.app.world;
    if (line.look === 'player') return w.player.look;
    const ped = w.peds.find((q) => q.name && q.name === line.who);
    if (ped) return ped.look;
    return randomLook('passerby', new RNG(hashStr(line.who)));
  }
  showDialog(lines: DialogLine[], onDone?: () => void): void {
    this.closeDialog();
    this.touch.reset();
    const who = h('div', { class: 'd-who' }), text = h('div', { class: 'd-text' }), canvas = h('canvas');
    const el = h('div', { id: 'dialog', role: 'dialog', 'aria-live': 'polite', onclick: () => this.advance() }, canvas, h('div', null, who, text),
      h('div', { class: 'd-next', text: this.app.touchMode ? 'Touche pour continuer' : 'Espace ou clic pour continuer' }));
    const key = (e: KeyboardEvent) => { if (['Space', 'Enter', 'KeyE'].includes(e.code) && !e.repeat) { e.preventDefault(); e.stopPropagation(); this.advance(); } };
    window.addEventListener('keydown', key, true);
    this.root.append(el);
    this.dialog = { el, lines, i: 0, shown: 0, text, who, canvas, done: onDone, key };
    this.app.input.enabled = false;
    this.renderLine();
  }
  private renderLine(): void {
    const d = this.dialog!;
    const line = d.lines[d.i];
    d.who.textContent = line.who; d.text.textContent = ''; d.shown = 0;
    drawPortrait(d.canvas, this.lookFor(line), 4);
    this.app.audio.play('ui');
  }
  private advance(): void {
    const d = this.dialog;
    if (!d) return;
    this.app.audio.unlock();
    const line = d.lines[d.i];
    if (d.shown < line.text.length) { d.shown = line.text.length; d.text.textContent = line.text; return; }
    d.i++;
    if (d.i >= d.lines.length) { const done = d.done; this.closeDialog(); done?.(); } else this.renderLine();
  }
  private closeDialog(): void {
    const d = this.dialog;
    if (!d) return;
    window.removeEventListener('keydown', d.key, true);
    d.el.remove(); this.dialog = null;
    this.app.input.enabled = true; this.app.input.flush();
  }
  showReveal(title: string, text: string, onDone?: () => void): void {
    this.touch.reset();
    const close = () => {
      if (!this.reveal) return;
      window.removeEventListener('keydown', this.reveal.key, true);
      this.reveal.el.remove(); this.reveal = null;
      this.app.input.enabled = true; this.app.input.flush();
      onDone?.();
    };
    const key = (e: KeyboardEvent) => { if (['Space', 'Enter', 'KeyE'].includes(e.code) && !e.repeat) { e.preventDefault(); e.stopPropagation(); close(); } };
    const el = h('div', { class: 'win', style: { pointerEvents: 'auto', background: 'rgba(8,7,18,0.6)', zIndex: '25' } },
      h('div', { class: 'panel narrow', role: 'dialog', style: { borderTop: '3px solid var(--amber)' } },
        h('div', { class: 'body' }, h('div', { style: { fontFamily: 'var(--display)', fontWeight: '800', fontSize: '26px', color: 'var(--amber)', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: '1.1' }, text: title }),
          h('p', { style: { margin: '0', fontSize: '16px' }, text }), h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Continuer', onclick: close })))));
    window.addEventListener('keydown', key, true);
    this.root.append(el);
    this.reveal = { el, key };
    this.app.input.enabled = false;
  }
  get modal(): boolean { return !!this.dialog || !!this.reveal || this.menus.open; }

  // ---------- Chaque frame ----------
  update(dt: number): void {
    const app = this.app;
    if (this.dialog) {
      const d = this.dialog, line = d.lines[d.i];
      if (d.shown < line.text.length) { d.shown = Math.min(line.text.length, d.shown + dt * 55); d.text.textContent = line.text.slice(0, Math.floor(d.shown)); }
    }
    if (!app.playing) return;
    this.hud.update(dt);
    const showTouch = app.touchMode && !this.menus.open;
    if (this.touch.root.hidden === showTouch) this.touch.root.hidden = !showTouch;
    if (showTouch) this.touch.update();
    if (this.cardEl) { this.cardT -= dt; if (this.cardT <= 0) this.hideCard(); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.banner.classList.remove('on'); }
    if (this.bubbles.length && app.scene) {
      const now = performance.now(), w = app.world;
      const W = window.innerWidth, H = window.innerHeight;
      this.bubbles = this.bubbles.filter((b) => {
        if (now > b.until) { b.el.remove(); return false; }
        if (b.id === w.player.id) { b.x = w.player.px; b.y = w.player.py; }
        else { const q = w.peds.find((e) => e.id === b.id); if (q) { b.x = q.x; b.y = q.y; } }
        const s = app.scene!.project(b.x, b.y - 10);
        if (s.x < -0.1 || s.x > 1.1 || s.y < -0.1 || s.y > 1.1) { b.el.style.display = 'none'; return true; }
        b.el.style.display = ''; b.el.style.left = `${s.x * W}px`; b.el.style.top = `${s.y * H}px`;
        return true;
      });
    }
  }
}
