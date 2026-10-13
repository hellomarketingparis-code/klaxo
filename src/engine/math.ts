export interface Vec2 { x: number; y: number; }
export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax: number, ay: number, bx: number, by: number) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
export const angleDiff = (from: number, to: number) => wrapAngle(to - from);
export function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}
export function approachAngle(a: number, target: number, step: number): number {
  const d = angleDiff(a, target);
  return Math.abs(d) <= step ? target : a + Math.sign(d) * step;
}
