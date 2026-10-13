import { MAP_W, MAP_H, TILE } from '../engine/config';
import { paintMinimap } from '../map/painter';
import { DISTRICT_NAMES } from '../map/tiles';
import type { App } from '../app';
import { h, fmtTime } from './dom';

const SHOP_COLORS: Record<string, string> = { garage: '#ffb627', dealer: '#9dff4a', clothes: '#8a5cff', kiosk: '#22e0ff', police: '#3b6bff' };
const SHOP_LETTERS: Record<string, string> = { garage: 'G', dealer: '$', clothes: 'T', kiosk: 'K', police: 'P' };

/** Affichage tête haute : mini-carte, argent, étoiles, objectif, chronomètre, jauges, invites. */
export class Hud {
  root: HTMLElement;
  private minimap: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private money = h('span', { id: 'money', class: 'pill', text: '0 ¤' });
  private level = h('span', { id: 'level', class: 'pill', text: 'NIV 1' });
  private xp = h('i');
  private stars = h('div', { id: 'stars', role: 'img' });
  private district = h('div', { class: 'hud-district' });
  private netPill = h('button', { id: 'netpill', hidden: true, 'aria-label': 'Jeu en ligne' });
  private netKey = '';
  private vehicle = h('div', { id: 'vehicle', class: 'pill', hidden: true });
  private vName = h('div', { class: 'v-name' });
  private vSpeed = h('div', { class: 'v-speed' });
  private vBar = h('i');
  private vBarWrap = h('div', { class: 'bar' }, this.vBar);
  private objective = h('div', { id: 'objective', hidden: true });
  private oTitle = h('span');
  private oProg = h('span');
  private oText = h('div', { class: 'o-text' });
  private timer = h('div', { id: 'timer', hidden: true });
  private meter = h('div', { id: 'meter', hidden: true });
  private mLabel = h('span');
  private mBar = h('i');
  private mBarWrap = h('div', { class: 'bar' }, this.mBar);
  private hint = h('div', { id: 'hint', hidden: true });
  private prompt = h('div', { id: 'prompt', hidden: true });
  private pKey = h('kbd', { text: 'E' });
  private pText = h('span');
  private arrow = h('div', { id: 'arrow', hidden: true });
  /** Pile de notifications (remplie par l'interface). */
  toasts = h('div', { id: 'toasts' });
  private lastMoney = -1;
  private mapT = 0;
  private lastObjective = '';

  constructor(private app: App, onPause: () => void, onMap: () => void, onNet: () => void = () => {}) {
    this.netPill.onclick = onNet;
    this.minimap = h('canvas', { id: 'minimap', title: 'Ouvrir la carte', onclick: onMap });
    for (let i = 0; i < 5; i++) this.stars.append(h('i'));
    this.vehicle.append(this.vName, this.vSpeed, this.vBarWrap);
    this.objective.append(h('div', { class: 'o-title' }, this.oTitle, this.oProg), this.oText);
    this.meter.append(this.mLabel, this.mBarWrap);
    this.prompt.append(this.pKey, this.pText);
    this.root = h('div', { id: 'hud', hidden: true },
      h('div', { class: 'hud-tl' }, this.minimap, this.district, this.netPill),
      h('div', { class: 'hud-tc' }, this.objective, this.timer, this.meter, this.hint),
      h('div', { class: 'hud-tr' },
        h('div', { class: 'hud-row' }, this.stars, h('button', { id: 'btn-pause', 'aria-label': 'Pause', onclick: onPause })),
        h('div', { class: 'hud-row' }, this.level, this.money),
        h('div', { id: 'xpbar' }, this.xp),
        this.vehicle),
      h('div', { class: 'hud-bc' }, this.toasts, this.prompt),
      this.arrow,
    );
    this.base = document.createElement('canvas');
    this.base.width = MAP_W; this.base.height = MAP_H;
    this.base.getContext('2d')!.putImageData(paintMinimap(app.world.map), 0, 0);
  }
  get mapBase(): HTMLCanvasElement { return this.base; }

  update(dt: number): void {
    const { world: w, input } = this.app;
    const p = w.player, e = w.economy;
    if (e.money !== this.lastMoney) {
      if (this.lastMoney >= 0) { this.money.classList.remove('bump'); void this.money.offsetWidth; this.money.classList.add('bump'); }
      this.lastMoney = e.money; this.money.textContent = `${e.money.toLocaleString('fr-FR')} ¤`;
    }
    this.level.textContent = `NIV ${e.level}`;
    this.xp.style.width = `${Math.min(100, (e.xp / Math.max(1, Math.round(120 * Math.pow(e.level, 1.35)))) * 100)}%`;
    const lvl = w.wanted.level;
    for (let i = 0; i < 5; i++) this.stars.children[i].classList.toggle('on', i < lvl);
    this.stars.classList.toggle('evading', lvl > 0 && (!w.wanted.seen || lvl === 1));
    this.stars.setAttribute('aria-label', `Niveau de recherche : ${lvl} sur 5`);
    this.district.textContent = DISTRICT_NAMES[w.map.districtAtPx(p.px, p.py)];

    const v = p.driving ? p.vehicle : null;
    this.vehicle.hidden = !v;
    if (v) {
      this.vName.textContent = v.spec.name;
      // Échelle du monde : environ 6,2 px par mètre.
      this.vSpeed.replaceChildren(String(Math.round((v.speed / 6.2) * 3.6)), h('small', { text: 'km/h' }));
      const r = v.hp / v.spec.hp;
      this.vBar.style.width = `${r * 100}%`;
      this.vBarWrap.className = 'bar' + (r < 0.3 ? ' bad' : r < 0.6 ? ' warn' : '');
    }
    const r = w.missions.active;
    this.objective.hidden = !r;
    if (r) {
      this.oTitle.textContent = r.def.title; this.oProg.textContent = r.progress;
      if (r.objective !== this.lastObjective) { this.lastObjective = r.objective; this.oText.textContent = r.objective; }
    } else this.lastObjective = '';
    const tl = r?.timeLeft ?? null;
    this.timer.hidden = tl === null;
    if (tl !== null) { this.timer.textContent = fmtTime(tl); this.timer.classList.toggle('low', tl < 10); }
    const m = r?.meter ?? null;
    this.meter.hidden = !m;
    if (m) {
      this.mLabel.textContent = m.label; this.mBar.style.width = `${Math.round(m.value * 100)}%`;
      this.mBarWrap.className = 'bar' + (m.tone === 'warn' ? (m.value > 0.66 ? ' bad' : m.value > 0.25 ? ' warn' : '') : (m.value < 0.34 ? ' bad' : m.value < 0.67 ? ' warn' : ''));
    }
    const hint = r?.hint ?? null;
    this.hint.hidden = !hint;
    if (hint) this.hint.textContent = hint;
    const pr = w.prompt;
    const touch = this.app.touchMode;
    this.prompt.hidden = !pr || touch;
    if (pr && !touch) { this.pKey.textContent = input.lastDevice === 'gamepad' ? 'A' : 'E'; this.pText.textContent = pr.label; }

    // Indicateur de jeu en ligne.
    const net = this.app.net;
    const key = `${net.status}|${net.count}|${net.placeLabel}|${net.session ? net.partners().length : -1}`;
    if (key !== this.netKey) {
      this.netKey = key;
      const st = net.status;
      this.netPill.hidden = st === 'off' || st === 'unavailable';
      this.netPill.className = st;
      const team = net.session ? net.partners().length : 0;
      this.netPill.textContent = st === 'online' ? `En ligne · ${net.count + 1} joueur${net.count ? 's' : ''}${team ? ` · équipe ${team + 1}` : ''}` : st === 'connecting' ? 'Connexion…' : 'Hors ligne';
      this.netPill.title = st === 'online' ? net.placeLabel : net.error;
    }
    this.updateArrow();
    this.mapT -= dt;
    if (this.mapT <= 0) { this.mapT = 0.08; this.drawMinimap(); }
  }

  /** Flèche en bord d'écran vers l'objectif quand il est hors champ. */
  private updateArrow(): void {
    const { world: w, scene } = this.app;
    const r = w.missions.active;
    let tx: number | null = null, ty = 0;
    if (r && r.markers.length) { tx = r.markers[0].x; ty = r.markers[0].y; }
    else if (!r) {
      // Hors mission : la flèche guide vers le donneur de mission le plus proche.
      let bd = Infinity;
      for (const ped of w.missions.givers.values()) { const d = Math.hypot(ped.x - w.player.px, ped.y - w.player.py); if (d < bd) { bd = d; tx = ped.x; ty = ped.y; } }
    }
    if (tx === null || !scene) { this.arrow.hidden = true; return; }
    const s = scene.project(tx, ty);
    if (s.x > 0.03 && s.x < 0.97 && s.y > 0.05 && s.y < 0.95) { this.arrow.hidden = true; return; }
    const dx = s.x - 0.5, dy = s.y - 0.5;
    const k = Math.min(0.44 / Math.abs(dx || 1e-6), 0.4 / Math.abs(dy || 1e-6));
    this.arrow.hidden = false;
    this.arrow.style.left = `${(0.5 + dx * k) * 100}%`; this.arrow.style.top = `${(0.5 + dy * k) * 100}%`;
    this.arrow.style.transform = `rotate(${Math.atan2(dy * window.innerHeight, dx * window.innerWidth) + Math.PI / 2}rad)`;
    this.arrow.style.borderBottomColor = r ? '' : 'var(--cyan)';
  }

  private drawMinimap(): void {
    const { world: w } = this.app;
    const c = this.minimap;
    const size = Math.round(c.clientWidth * Math.min(2, window.devicePixelRatio || 1));
    if (size <= 0) return;
    if (c.width !== size) { c.width = size; c.height = size; }
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const R = 36; // rayon affiché, en tuiles
    const p = w.player;
    const ptx = p.px / TILE, pty = p.py / TILE;
    const scale = size / (2 * R);
    ctx.fillStyle = '#0d0b1a'; ctx.fillRect(0, 0, size, size);
    const sx = Math.max(0, ptx - R), sy = Math.max(0, pty - R), ex = Math.min(MAP_W, ptx + R), ey = Math.min(MAP_H, pty + R);
    if (ex > sx && ey > sy) ctx.drawImage(this.base, sx, sy, ex - sx, ey - sy, (sx - (ptx - R)) * scale, (sy - (pty - R)) * scale, (ex - sx) * scale, (ey - sy) * scale);
    const pos = (x: number, y: number, clampEdge: boolean): [number, number, boolean] => {
      let mx = (x / TILE - ptx + R) * scale, my = (y / TILE - pty + R) * scale;
      const inside = mx >= 3 && my >= 3 && mx <= size - 3 && my <= size - 3;
      if (!inside && clampEdge) { mx = Math.max(4, Math.min(size - 4, mx)); my = Math.max(4, Math.min(size - 4, my)); }
      return [mx, my, inside];
    };
    const dot = (x: number, y: number, color: string, r: number, clampEdge = false) => {
      const [mx, my, inside] = pos(x, y, clampEdge);
      if (!inside && !clampEdge) return;
      ctx.fillStyle = '#0b0a16'; ctx.fillRect(mx - r - 1, my - r - 1, 2 * r + 2, 2 * r + 2);
      ctx.fillStyle = color; ctx.fillRect(mx - r, my - r, 2 * r, 2 * r);
    };
    const u = Math.max(2, Math.round(size / 56));
    for (const poi of w.map.pois.values()) { const col = SHOP_COLORS[poi.type]; if (col) dot((poi.tx + 0.5) * TILE, (poi.ty + 0.5) * TILE, col, u); }
    for (const [id, ped] of w.missions.givers) dot(ped.x, ped.y, w.missions.find(id)?.kind === 'weekly' ? '#22e0ff' : '#ff2e88', u + 1, true);
    const side = w.missions.sideMarker;
    if (side) dot(side.x, side.y, '#ffd84a', u + 1, true);
    const r = w.missions.active;
    if (r) for (const mk of r.markers) dot(mk.x, mk.y, mk.kind === 'checkpoint' ? '#22e0ff' : '#ff2e88', mk.dim ? u : u + 1, !mk.dim);
    // Autres joueurs en ligne ; les coéquipiers restent visibles au bord de la carte.
    const sid = this.app.net.session?.sid;
    for (const q of this.app.net.peers.values()) if (q.snaps.length) dot(q.x, q.y, q.color, sid && q.sid === sid ? u + 1 : u, !!sid && q.sid === sid);
    if (w.wanted.level > 0) {
      const blink = Math.floor(w.time * 4) % 2;
      for (const v of w.vehicles) if (v.type === 'police' && v.siren) dot(v.x, v.y, blink ? '#ff3b3b' : '#3b6bff', u);
      for (const q of w.peds) if (q.role === 'cop') dot(q.x, q.y, '#3b6bff', u - 1);
    }
    // Joueur : flèche orientée.
    const a = p.driving ? p.vehicle!.angle : p.angle;
    ctx.save(); ctx.translate(size / 2, size / 2); ctx.rotate(a);
    ctx.fillStyle = '#0b0a16'; ctx.beginPath(); ctx.moveTo(u * 3.2, 0); ctx.lineTo(-u * 2.4, -u * 2.4); ctx.lineTo(-u * 2.4, u * 2.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(u * 2.4, 0); ctx.lineTo(-u * 1.6, -u * 1.6); ctx.lineTo(-u * 0.8, 0); ctx.lineTo(-u * 1.6, u * 1.6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /** Carte complète de la ville (menu pause, touche M). */
  drawBigMap(c: HTMLCanvasElement): void {
    const { world: w } = this.app;
    const S = 3;
    c.width = MAP_W * S; c.height = MAP_H * S;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, c.width, c.height);
    ctx.font = '700 15px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'center';
    const labels: [string, number, number][] = [[DISTRICT_NAMES[0], 68, 30], [DISTRICT_NAMES[1], 250, 30], [DISTRICT_NAMES[2], 160, 80], [DISTRICT_NAMES[3], 68, 150], [DISTRICT_NAMES[4], 250, 150]];
    for (const [name, tx, ty] of labels) {
      ctx.fillStyle = 'rgba(8,7,18,0.75)'; const tw = ctx.measureText(name.toUpperCase()).width; ctx.fillRect(tx * S - tw / 2 - 5, ty * S - 14, tw + 10, 20);
      ctx.fillStyle = '#f2f0ff'; ctx.fillText(name.toUpperCase(), tx * S, ty * S);
    }
    const mark = (x: number, y: number, color: string, letter?: string, r = 6) => {
      const mx = (x / TILE) * S, my = (y / TILE) * S;
      ctx.fillStyle = '#0b0a16'; ctx.fillRect(mx - r - 1, my - r - 1, 2 * r + 2, 2 * r + 2);
      ctx.fillStyle = color; ctx.fillRect(mx - r, my - r, 2 * r, 2 * r);
      if (letter) { ctx.fillStyle = '#0b0a16'; ctx.font = '700 10px ui-monospace, Menlo, Consolas, monospace'; ctx.fillText(letter, mx, my + 3.5); }
    };
    for (const poi of w.map.pois.values()) { const col = SHOP_COLORS[poi.type]; if (col) mark((poi.tx + 0.5) * TILE, (poi.ty + 0.5) * TILE, col, SHOP_LETTERS[poi.type]); }
    for (const s of w.map.secrets) if (w.secretsFound.has(s.id)) mark((s.tx + 0.5) * TILE, (s.ty + 0.5) * TILE, '#ffd84a', undefined, 3);
    for (const [id, ped] of w.missions.givers) mark(ped.x, ped.y, w.missions.find(id)?.kind === 'weekly' ? '#22e0ff' : '#ff2e88', 'M', 7);
    const r = w.missions.active;
    if (r) for (const mk of r.markers) mark(mk.x, mk.y, '#ff2e88', '!', 7);
    for (const q of this.app.net.peers.values()) if (q.snaps.length) mark(q.x, q.y, q.color, undefined, 5);
    const p = w.player;
    const px = (p.px / TILE) * S, py = (p.py / TILE) * S;
    ctx.save(); ctx.translate(px, py); ctx.rotate(p.driving ? p.vehicle!.angle : p.angle);
    ctx.fillStyle = '#0b0a16'; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-9, -9); ctx.lineTo(-9, 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
