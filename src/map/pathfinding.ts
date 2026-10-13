import { MAP_W, MAP_H } from '../engine/config';
import type { CityMap } from './CityMap';
import { T } from './tiles';

/** A* sur la grille de tuiles, pour les piétons, les policiers à pied et les gardes. */
const N = MAP_W * MAP_H;
const g = new Float32Array(N);
const stamp = new Uint32Array(N);
const closed = new Uint32Array(N);
const came = new Int32Array(N);
let gen = 0;

class Heap {
  ids: number[] = []; pri: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, p: number) {
    const ids = this.ids, pri = this.pri;
    let i = ids.length; ids.push(id); pri.push(p);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (pri[par] <= p) break;
      ids[i] = ids[par]; pri[i] = pri[par]; i = par;
    }
    ids[i] = id; pri[i] = p;
  }
  pop(): number {
    const ids = this.ids, pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop()!, lastP = pri.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= lastP) break;
        ids[i] = ids[c]; pri[i] = pri[c]; i = c;
      }
      ids[i] = lastId; pri[i] = lastP;
    }
    return top;
  }
}

export interface PathOpts { roadCost?: number; maxNodes?: number; }
export interface TilePt { tx: number; ty: number; }

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export function tileCost(kind: number, roadCost: number): number {
  switch (kind) {
    case T.SIDEWALK: return 1;
    case T.CROSSWALK: return 1.3;
    case T.PLAZA: case T.PATH: return 1.1;
    case T.ROAD: return roadCost;
    case T.PARKING: return Math.min(roadCost, 2);
    default: return Math.min(roadCost, 1.6);
  }
}

export function findPath(m: CityMap, sx: number, sy: number, tx: number, ty: number, opts: PathOpts = {}): TilePt[] | null {
  const roadCost = opts.roadCost ?? 9;
  const maxNodes = opts.maxNodes ?? 6000;
  if (!m.inb(sx, sy) || !m.inb(tx, ty) || m.solidAt(tx, ty)) return null;
  gen++;
  const heap = new Heap();
  const start = sy * MAP_W + sx, goal = ty * MAP_W + tx;
  g[start] = 0; stamp[start] = gen; came[start] = -1;
  heap.push(start, 0);
  let expanded = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (++expanded > maxNodes) return null;
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (m.solid[ni] || closed[ni] === gen) continue;
      if (k >= 4 && (m.solid[cy * MAP_W + nx] || m.solid[ny * MAP_W + cx])) continue; // pas de coupe de coin
      const step = (k >= 4 ? 1.4142 : 1) * tileCost(m.kind[ni], roadCost);
      const ng = g[cur] + step;
      if (stamp[ni] !== gen || ng < g[ni]) {
        g[ni] = ng; stamp[ni] = gen; came[ni] = cur;
        const hx = Math.abs(nx - tx), hy = Math.abs(ny - ty);
        heap.push(ni, ng + Math.max(hx, hy) + 0.4142 * Math.min(hx, hy));
      }
    }
  }
  if (stamp[goal] !== gen) return null;
  const out: TilePt[] = [];
  for (let c = goal; c >= 0; c = came[c]) { out.push({ tx: c % MAP_W, ty: (c / MAP_W) | 0 }); if (c === start) break; }
  return out.reverse();
}
