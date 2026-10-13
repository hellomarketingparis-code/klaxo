/** Petits utilitaires DOM. Les textes passent toujours par textContent : aucun HTML venant des données n'est interprété. */
type Child = Node | string | number | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'object' ? c : String(c));
  return el;
}
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export function clear(el: HTMLElement): void { while (el.firstChild) el.removeChild(el.firstChild); }
export const css = (n: number) => '#' + n.toString(16).padStart(6, '0');
export function fmtTime(s: number): string {
  s = Math.max(0, s);
  if (s < 10) return s.toFixed(1);
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
export function fmtDuration(s: number): string {
  const h2 = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h2 > 0 ? `${h2} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
