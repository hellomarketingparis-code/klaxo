import { approachAngle } from '../engine/math';
import type { CityMap } from '../map/CityMap';
import { collideCircleMap } from '../npc/Ped';
import { DEFAULT_LOOK } from '../npc/looks';
import type { Look } from '../npc/looks';
import type { Vehicle } from '../vehicles/Vehicle';

export type PlayerState = 'foot' | 'entering' | 'driving' | 'exiting' | 'stunned';
export interface Intent {
  /** Déplacement absolu à pied ; en voiture : x = direction, y = -accélérateur. */
  moveX: number; moveY: number;
  run: boolean;
  /** Fronts montants (une seule frame). */
  interact: boolean; action: boolean;
  /** Maintien du bouton d'action (klaxon) et du frein à main. */
  actionHeld: boolean; handbrake: boolean;
}
export const NO_INTENT: Intent = { moveX: 0, moveY: 0, run: false, interact: false, action: false, actionHeld: false, handbrake: false };

export const WALK_SPEED = 56;
export const RUN_SPEED = 98;

export class Player {
  readonly id = 1;
  x = 0; y = 0; angle = Math.PI / 2;
  vx = 0; vy = 0;
  state: PlayerState = 'foot';
  vehicle: Vehicle | null = null;
  /** Véhicule visé pendant l'animation d'entrée/sortie. */
  target: Vehicle | null = null;
  timer = 0;
  fromX = 0; fromY = 0; toX = 0; toY = 0;
  moving = false; running = false;
  animT = 0;
  radius = 4;
  look: Look = { ...DEFAULT_LOOK };
  name = '';
  /** Objet de mission porté (affiché sur le dos). */
  carrying: string | null = null;

  get onFoot(): boolean { return this.state === 'foot' || this.state === 'stunned'; }
  get driving(): boolean { return this.state === 'driving' && !!this.vehicle; }
  /** Position de référence (celle du véhicule quand on conduit). */
  get px(): number { return this.vehicle && this.state === 'driving' ? this.vehicle.x : this.x; }
  get py(): number { return this.vehicle && this.state === 'driving' ? this.vehicle.y : this.y; }
  get speed(): number { return this.driving ? this.vehicle!.speed : Math.hypot(this.vx, this.vy); }

  updateFoot(dt: number, input: Intent, map: CityMap): void {
    if (this.state === 'stunned') {
      this.timer -= dt;
      this.vx *= Math.exp(-5 * dt); this.vy *= Math.exp(-5 * dt);
      this.x += this.vx * dt; this.y += this.vy * dt;
      collideCircleMap(this, this.radius, map);
      this.moving = false;
      if (this.timer <= 0) this.state = 'foot';
      return;
    }
    const mag = Math.hypot(input.moveX, input.moveY);
    if (mag > 0.18) {
      const sp = (input.run ? RUN_SPEED : WALK_SPEED) * Math.min(1, mag);
      this.vx = (input.moveX / mag) * sp; this.vy = (input.moveY / mag) * sp;
      this.angle = approachAngle(this.angle, Math.atan2(this.vy, this.vx), 14 * dt);
      this.moving = true; this.running = input.run && mag > 0.6;
      this.animT += dt * (sp / 20);
    } else { this.vx = 0; this.vy = 0; this.moving = false; this.running = false; }
    this.x += this.vx * dt; this.y += this.vy * dt;
    collideCircleMap(this, this.radius, map);
  }
}
