import type { App } from '../app';
import { h } from './dom';

/**
 * Commandes tactiles : joystick flottant à gauche, boutons à droite.
 * À pied : le joystick donne la direction, pousser à fond fait courir.
 * En voiture : la voiture se dirige vers la direction du joystick ; un bouton frein s'ajoute.
 */
export class TouchControls {
  root: HTMLElement;
  private base = h('div', { id: 'stick-base' });
  private knob = h('div', { id: 'stick-knob' });
  private zone = h('div', { id: 'stick-zone' });
  private bInteract = h('button', { id: 'tb-interact', class: 'tbtn', 'aria-label': 'Interagir' });
  private bAction = h('button', { id: 'tb-action', class: 'tbtn', 'aria-label': 'Action' });
  private bBrake = h('button', { id: 'tb-brake', class: 'tbtn', text: 'Frein', hidden: true });
  private rotate = h('div', { id: 'rotate', hidden: true, text: 'Tourne ton téléphone à l’horizontale pour mieux voir la rue.' });
  private pid: number | null = null;
  private ox = 0; private oy = 0;
  private readonly R = 46;

  constructor(private app: App) {
    this.base.append(this.knob);
    this.zone.append(this.base);
    this.root = h('div', { id: 'touch', hidden: true }, this.zone, h('div', { class: 'tbtns' }, this.bBrake, this.bAction, this.bInteract), this.rotate);
    const t = app.input.touch;
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      if (this.pid !== null) return;
      e.preventDefault();
      this.pid = e.pointerId; z.setPointerCapture(e.pointerId);
      const r = z.getBoundingClientRect();
      this.ox = e.clientX; this.oy = e.clientY;
      this.base.classList.add('live');
      this.base.style.left = `${e.clientX - r.left}px`; this.base.style.top = `${e.clientY - r.top}px`;
      t.active = true; t.x = 0; t.y = 0;
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pid) return;
      let dx = e.clientX - this.ox, dy = e.clientY - this.oy;
      const d = Math.hypot(dx, dy);
      if (d > this.R) { dx = (dx / d) * this.R; dy = (dy / d) * this.R; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const m = Math.min(1, d / this.R);
      t.x = d > 4 ? (dx / this.R) : 0; t.y = d > 4 ? (dy / this.R) : 0;
      t.run = m > 0.86;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pid) return;
      this.pid = null; t.active = false; t.x = 0; t.y = 0; t.run = false;
      this.knob.style.transform = '';
      this.base.classList.remove('live'); this.base.style.left = ''; this.base.style.top = '';
    };
    z.addEventListener('pointerup', end); z.addEventListener('pointercancel', end);

    const hold = (el: HTMLElement, down: () => void, up: () => void) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('down'); down(); });
      const off = () => { el.classList.remove('down'); up(); };
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold(this.bInteract, () => { t.interact = true; app.audio.unlock(); }, () => {});
    hold(this.bAction, () => { t.action = true; t.actionHeld = true; }, () => { t.actionHeld = false; });
    hold(this.bBrake, () => { t.brake = true; }, () => { t.brake = false; });
  }

  update(): void {
    const { world: w } = this.app;
    const p = w.player, pr = w.prompt;
    let label = '';
    if (pr) label = pr.kind === 'vehicle' ? 'Monter' : pr.kind === 'shop' ? 'Entrer' : pr.kind === 'garage' ? 'Garage' : pr.label.split(/[\s:]/)[0];
    else if (p.driving) label = 'Sortir';
    this.bInteract.textContent = label || '·';
    this.bInteract.classList.toggle('ready', !!label);
    this.bAction.textContent = p.driving ? 'Klaxon' : 'Hé !';
    this.bBrake.hidden = !p.driving;
    this.rotate.hidden = !(window.innerHeight > window.innerWidth * 1.15);
  }
  reset(): void {
    const t = this.app.input.touch;
    t.active = false; t.x = 0; t.y = 0; t.run = false; t.brake = false; t.actionHeld = false; t.interact = false; t.action = false;
    this.pid = null; this.knob.style.transform = '';
  }
}
