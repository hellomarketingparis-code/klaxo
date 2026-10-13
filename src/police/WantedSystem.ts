import type { World } from '../world/World';

export type CrimeType = 'pedHit' | 'carjack' | 'hitPolice' | 'crash' | 'trespass' | 'copHit' | 'redLight';
const HEAT: Record<CrimeType, number> = { pedHit: 14, carjack: 10, hitPolice: 16, crash: 4, trespass: 14, copHit: 30, redLight: 2 };
/** Probabilité qu'un délit soit signalé sans policier à proximité. */
const REPORT: Record<CrimeType, number> = { pedHit: 0.6, carjack: 0.45, hitPolice: 1, crash: 0.12, trespass: 1, copHit: 1, redLight: 0 };
export const LEVEL_HEAT = [0, 8, 22, 45, 75, 110];

/** Niveau de recherche (0 à 5 étoiles), visibilité du joueur et temps nécessaire pour semer la police. */
export class WantedSystem {
  heat = 0;
  level = 0;
  /** Vrai si une unité de police voit actuellement le joueur. */
  seen = false;
  lastX = 0; lastY = 0;
  evade = 0;
  crimes = 0;
  private noUnit = 0;
  /** Temps total passé recherché (statistiques). */
  constructor(private w: World) {}

  evadeTime(): number { return this.level <= 1 ? 9 : 8 + 4 * this.level; }
  /** Progression de la fuite (0 → 1) pour l'affichage clignotant des étoiles. */
  get evadeRatio(): number { return this.level === 0 ? 0 : Math.min(1, this.evade / this.evadeTime()); }

  crime(type: CrimeType, x: number, y: number): void {
    const w = this.w;
    if (w.attract) return;
    const witnessed = this.level > 0 || w.police.witness(x, y) || w.rng.chance(REPORT[type]);
    if (!witnessed) return;
    this.crimes++;
    this.heat = Math.min(140, this.heat + HEAT[type] * (this.level >= 3 ? 0.7 : 1));
    this.evade = 0;
    this.lastX = w.player.px; this.lastY = w.player.py;
    this.sync();
  }
  setLevel(level: number): void {
    this.heat = Math.max(this.heat, LEVEL_HEAT[Math.max(0, Math.min(5, level))]);
    if (level === 0) this.heat = 0;
    this.evade = 0;
    this.lastX = this.w.player.px; this.lastY = this.w.player.py;
    this.sync();
  }
  clear(silent = false): void {
    const prev = this.level;
    this.heat = 0; this.level = 0; this.evade = 0; this.seen = false; this.noUnit = 0;
    if (prev > 0) {
      this.w.bus.emit('wanted', { level: 0, prev });
      if (!silent) { this.w.bus.emit('toast', { text: 'Tu as semé la police.', kind: 'good' }); this.w.economy.stat('evasions', 1); if (prev >= 3) this.w.economy.stat('evade3', 1); }
    }
  }
  private sync(): void {
    let lvl = 0;
    for (let i = 1; i <= 5; i++) if (this.heat >= LEVEL_HEAT[i]) lvl = i;
    if (lvl !== this.level) {
      const prev = this.level;
      this.level = lvl;
      this.w.bus.emit('wanted', { level: lvl, prev });
      if (lvl > prev) { this.w.bus.emit('sfx', { name: 'wanted' }); this.w.economy.statMax('maxWanted', lvl); }
    }
  }

  update(dt: number): void {
    if (this.level === 0) return;
    const w = this.w;
    if (this.seen && this.level >= 2) {
      this.evade = 0;
      this.lastX = w.player.px; this.lastY = w.player.py;
      // Une poursuite qui s'éternise attire lentement des renforts.
      if (this.level < 5) { this.heat = Math.min(LEVEL_HEAT[5], this.heat + dt * 0.3); this.sync(); }
    } else if (this.level === 1 || w.police.unitCount > 0 || this.noUnit > 12) {
      // Le compte à rebours de la fuite ne démarre qu'une fois la police réellement à nos trousses.
      this.evade += dt;
      if (this.evade >= this.evadeTime()) this.clear();
    } else this.noUnit += dt;
    if (w.police.unitCount > 0) this.noUnit = 0;
  }
}
