import fs from 'node:fs';
import path from 'node:path';
import { generateCity } from '../src/map/generator';
import type { CityMap } from '../src/map/CityMap';
import { World } from '../src/world/World';
import { Vehicle } from '../src/vehicles/Vehicle';
import type { VehicleType } from '../src/vehicles/specs';
import type { Intent } from '../src/player/Player';
import { angleDiff, clamp, dist } from '../src/engine/math';

let cached: CityMap | null = null;
export function city(): CityMap { return (cached ??= generateCity()); }
export function readJson(rel: string): any { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', rel), 'utf8')); }
export function makeWorld(seed = 1, opts: { traffic?: boolean } = {}): World {
  const w = new World(city(), { headless: true, seed });
  w.missions.load(readJson('missions/story.json').missions, null, null);
  w.randomEvents.enabled = false;
  w.startGame();
  if (opts.traffic === false) { w.mods.trafficFactor = 0; w.mods.pedFactor = 0; }
  return w;
}
export const intent = (o: Partial<Intent> = {}): Intent => ({ moveX: 0, moveY: 0, run: false, interact: false, action: false, actionHeld: false, handbrake: false, ...o });
export const DT = 1 / 30;
export function run(w: World, seconds: number, input: Intent | ((t: number) => Intent) = intent(), until?: () => boolean): number {
  let t = 0;
  while (t < seconds) {
    w.update(DT, typeof input === 'function' ? input(t) : input);
    t += DT;
    if (until && until()) break;
  }
  return t;
}
export function tp(w: World, poi: string, dx = 0, dy = 0): void {
  const p = w.map.poiPx(poi);
  const v = w.player.vehicle;
  if (v) { v.x = p.x + dx; v.y = p.y + dy; v.vx = 0; v.vy = 0; }
  w.player.x = p.x + dx; w.player.y = p.y + dy;
}
/** Fait apparaître un véhicule sur la chaussée la plus proche et y installe le joueur (via l'interaction normale). */
export function giveCar(w: World, type: VehicleType = 'sedan'): Vehicle {
  const p = w.player;
  const r = w.map.nearestRoadPoint(p.px, p.py);
  const v = new Vehicle(type, r.x, r.y, r.angle);
  w.vehicles.push(v);
  p.x = v.x + Math.sin(v.angle) * 12; p.y = v.y - Math.cos(v.angle) * 12;
  w.update(DT, intent({ interact: true }));
  run(w, 1, intent(), () => p.state === 'driving');
  return v;
}
/** Pilote automatique de test : suit le réseau routier jusqu'à un point, comme le ferait un joueur prudent. */
export function driveTo(w: World, x: number, y: number, maxSeconds: number, arrive = 34, cruise = 125): { ok: boolean; time: number } {
  const m = w.map, p = w.player;
  const nodes = m.routeNodes(m.nearestNode(p.px, p.py).id, m.nearestNode(x, y).id);
  const pts = nodes.map((id) => ({ x: m.nodes[id].cx, y: m.nodes[id].cy }));
  pts.push({ x, y });
  let i = 0, t = 0, stuck = 0, rev = 0;
  while (t < maxSeconds) {
    const v = p.vehicle;
    if (!v) return { ok: false, time: t };
    while (i < pts.length - 1 && dist(v.x, v.y, pts[i].x, pts[i].y) < 30) i++;
    const last = i === pts.length - 1;
    const d = dist(v.x, v.y, pts[i].x, pts[i].y);
    if (last && d < arrive) {
      w.update(DT, intent({ moveY: v.forwardSpeed > 5 ? 1 : 0, handbrake: true }));
      t += DT;
      if (v.speed < 20) return { ok: true, time: t };
      continue;
    }
    const err = angleDiff(v.angle, Math.atan2(pts[i].y - v.y, pts[i].x - v.x));
    const vf = v.forwardSpeed;
    let target = Math.abs(err) > 0.9 ? 40 : Math.abs(err) > 0.4 ? 70 : cruise;
    if (d < 70) target = Math.min(target, last ? 45 : 75);
    let moveY = vf < target ? -1 : vf > target + 15 ? 1 : 0;
    let moveX = clamp(err * 2.6, -1, 1);
    if (rev > 0) { rev -= DT; moveY = 1; moveX = -moveX; }
    else if (Math.abs(vf) < 5) { stuck += DT; if (stuck > 1.2) { rev = 0.9; stuck = 0; } } else stuck = 0;
    w.update(DT, intent({ moveX, moveY }));
    t += DT;
  }
  return { ok: false, time: t };
}
