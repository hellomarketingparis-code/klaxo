/** Palette « nuit néon » de KLAXO. Toute la direction artistique part de ces couleurs. */
export const NEON = { pink: '#ff2e88', cyan: '#22e0ff', amber: '#ffb627', green: '#9dff4a', violet: '#8a5cff', white: '#f5f5ff' };
export const NEON_LIST = [NEON.pink, NEON.cyan, NEON.amber, NEON.green, NEON.violet];
export const NEON_RGB: [number, number, number][] = [[255, 46, 136], [34, 224, 255], [255, 182, 39], [157, 255, 74], [138, 92, 255]];

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
export function rgb(n: number): [number, number, number] { return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function shade(n: number, f: number): string {
  const [r, g, b] = rgb(n);
  const k = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f)));
  return `rgb(${k(r)},${k(g)},${k(b)})`;
}
export function shadeHex(s: string, f: number): string { return shade(parseInt(s.slice(1), 16), f); }
export function rgba(n: number | string, a: number): string {
  const [r, g, b] = rgb(typeof n === 'string' ? parseInt(n.slice(1), 16) : n);
  return `rgba(${r},${g},${b},${a})`;
}
