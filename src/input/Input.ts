import type { Intent } from '../player/Player';

/** Entrées unifiées : clavier (AZERTY et QWERTY via les positions physiques), tactile, manette. */
export class InputSystem {
  private down = new Set<string>();
  private pressed = new Set<string>();
  /** État tactile, écrit par TouchControls. */
  touch = { active: false, x: 0, y: 0, run: false, brake: false, interact: false, action: false, actionHeld: false };
  /** Raccourcis d'interface (pause, carte, réessayer). */
  onKey: (key: 'pause' | 'map' | 'retry' | 'confirm') => void = () => {};
  enabled = true;
  /** Dernier périphérique utilisé : sert à choisir les libellés affichés. */
  lastDevice: 'keyboard' | 'touch' | 'gamepad' = 'keyboard';
  private padPrev: boolean[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const c = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(c)) e.preventDefault();
      if (e.repeat) return;
      this.lastDevice = 'keyboard';
      if (c === 'Escape' || c === 'KeyP') { this.onKey('pause'); return; }
      if (c === 'KeyM') { this.onKey('map'); return; }
      if (c === 'KeyR') this.onKey('retry');
      if (c === 'Enter') this.onKey('confirm');
      this.down.add(c); this.pressed.add(c);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }
  private key(...codes: string[]): boolean { for (const c of codes) if (this.down.has(c)) return true; return false; }
  private hit(...codes: string[]): boolean { for (const c of codes) if (this.pressed.has(c)) return true; return false; }

  /** Vide les fronts montants sans les jouer (ouverture d'un menu, d'un dialogue). */
  flush(): void { this.pressed.clear(); this.touch.interact = false; this.touch.action = false; }

  read(): Intent & { absolute: boolean; brake: boolean } {
    const out = { moveX: 0, moveY: 0, run: false, interact: false, action: false, actionHeld: false, handbrake: false, absolute: false, brake: false };
    if (!this.enabled) { this.flush(); return out; }
    // KeyW/KeyA/KeyS/KeyD désignent des positions physiques : ZQSD sur un clavier AZERTY.
    if (this.key('KeyW', 'ArrowUp')) out.moveY -= 1;
    if (this.key('KeyS', 'ArrowDown')) out.moveY += 1;
    if (this.key('KeyA', 'ArrowLeft')) out.moveX -= 1;
    if (this.key('KeyD', 'ArrowRight')) out.moveX += 1;
    out.run = this.key('ShiftLeft', 'ShiftRight');
    out.handbrake = out.run;
    out.interact = this.hit('KeyE', 'KeyF', 'Enter');
    out.action = this.hit('Space', 'KeyH');
    out.actionHeld = this.key('Space', 'KeyH');
    const t = this.touch;
    if (t.active || t.brake) {
      out.moveX = t.x; out.moveY = t.y; out.absolute = true; out.brake = t.brake;
      this.lastDevice = 'touch';
    }
    if (t.run) out.run = true;
    if (t.interact) { out.interact = true; t.interact = false; this.lastDevice = 'touch'; }
    if (t.action) { out.action = true; t.action = false; }
    if (t.actionHeld) out.actionHeld = true;
    this.readPad(out);
    this.pressed.clear();
    return out;
  }

  private readPad(out: Intent & { absolute: boolean; brake: boolean }): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
    const lx = dz(pad.axes[0] ?? 0), ly = dz(pad.axes[1] ?? 0);
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    const edge = (i: number) => { const now = b(i), was = this.padPrev[i]; this.padPrev[i] = now; return now && !was; };
    const gas = pad.buttons[7]?.value ?? 0, brake = pad.buttons[6]?.value ?? 0;
    if (lx || ly || gas > 0.1 || brake > 0.1) {
      this.lastDevice = 'gamepad';
      out.moveX = lx;
      out.moveY = gas > 0.1 || brake > 0.1 ? brake - gas : ly;
    }
    if (edge(0)) { out.interact = true; this.lastDevice = 'gamepad'; }
    if (edge(2)) out.action = true;
    if (b(2)) out.actionHeld = true;
    if (b(1) || b(5)) { out.run = true; out.handbrake = true; }
    if (edge(9)) this.onKey('pause');
    if (edge(8)) this.onKey('map');
  }
}
