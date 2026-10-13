import { MAP_W, MAP_H, TILE, CHUNK_TILES, CHUNKS_X, CHUNKS_Y } from '../engine/config';
import { T, SOLID } from './tiles';
import type { RoadNode, RoadEdge, Lot, Building, POI, Lamp, TreeProp, ParkSpot, SecretSpot, Prop, GuardRoute } from './tiles';

export type SignalState = 'g' | 'y' | 'r';
export const SIGNAL_CYCLE = 16;

/** Vecteur unitaire par bras : 0=N, 1=E, 2=S, 3=O. */
export const ARM_DX = [0, 1, 0, -1];
export const ARM_DY = [-1, 0, 1, 0];

export interface LaneSeg { sx: number; sy: number; ex: number; ey: number; dx: number; dy: number; len: number; }

/** Données complètes de la ville + requêtes spatiales. Aucune dépendance à Phaser : utilisable dans les tests et les outils. */
export class CityMap {
  readonly w = MAP_W;
  readonly h = MAP_H;
  kind = new Uint8Array(MAP_W * MAP_H);
  district = new Uint8Array(MAP_W * MAP_H);
  solid = new Uint8Array(MAP_W * MAP_H);
  opaque = new Uint8Array(MAP_W * MAP_H);
  /** 0 = pas de route, 1 = horizontale, 2 = verticale, 3 = carrefour. */
  rdir = new Uint8Array(MAP_W * MAP_H);
  /** Composante piétonne principale (1 = atteignable à pied depuis la rue). */
  reach = new Uint8Array(MAP_W * MAP_H);
  lotId = new Uint16Array(MAP_W * MAP_H);
  nodes: RoadNode[] = [];
  edges: RoadEdge[] = [];
  lots: Lot[] = [];
  buildings: Building[] = [];
  pois = new Map<string, POI>();
  lamps: Lamp[] = [];
  trees: TreeProp[] = [];
  spots: ParkSpot[] = [];
  secrets: SecretSpot[] = [];
  props: Prop[] = [];
  guardRoutes: Record<string, GuardRoute[]> = {};
  /** Index par chunk. */
  chunkBuildings: number[][] = [];
  chunkLamps: number[][] = [];
  chunkTrees: number[][] = [];
  chunkSpots: number[][] = [];
  chunkNodes: number[][] = [];
  chunkProps: number[][] = [];

  idx(tx: number, ty: number): number { return ty * MAP_W + tx; }
  inb(tx: number, ty: number): boolean { return tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H; }
  kindAt(tx: number, ty: number): number { return this.inb(tx, ty) ? this.kind[ty * MAP_W + tx] : T.FOREST; }
  solidAt(tx: number, ty: number): boolean { return !this.inb(tx, ty) || this.solid[ty * MAP_W + tx] === 1; }
  solidAtPx(x: number, y: number): boolean { return this.solidAt(Math.floor(x / TILE), Math.floor(y / TILE)); }
  kindAtPx(x: number, y: number): number { return this.kindAt(Math.floor(x / TILE), Math.floor(y / TILE)); }
  districtAt(tx: number, ty: number): number { return this.inb(tx, ty) ? this.district[ty * MAP_W + tx] : 0; }
  districtAtPx(x: number, y: number): number { return this.districtAt(Math.floor(x / TILE), Math.floor(y / TILE)); }
  isRoadKind(k: number): boolean { return k === T.ROAD || k === T.CROSSWALK; }

  poi(id: string): POI {
    const p = this.pois.get(id);
    if (!p) throw new Error(`POI inconnu : ${id}`);
    return p;
  }
  poiPx(id: string): { x: number; y: number } {
    const p = this.poi(id);
    return { x: (p.tx + 0.5) * TILE, y: (p.ty + 0.5) * TILE };
  }

  finalize(): void {
    for (let i = 0; i < this.kind.length; i++) {
      const k = this.kind[i];
      this.solid[i] = SOLID[k] ? 1 : 0;
      this.opaque[i] = k === T.BUILDING || k === T.PROP || k === T.FOREST || k === T.TREE ? 1 : 0;
    }
    const n = CHUNKS_X * CHUNKS_Y;
    const mk = () => Array.from({ length: n }, () => [] as number[]);
    this.chunkBuildings = mk(); this.chunkLamps = mk(); this.chunkTrees = mk(); this.chunkSpots = mk(); this.chunkNodes = mk(); this.chunkProps = mk();
    const ci = (px: number, py: number) => {
      const cx = Math.min(CHUNKS_X - 1, Math.max(0, Math.floor(px / (CHUNK_TILES * TILE))));
      const cy = Math.min(CHUNKS_Y - 1, Math.max(0, Math.floor(py / (CHUNK_TILES * TILE))));
      return cy * CHUNKS_X + cx;
    };
    // Les bâtiments sont indexés dans tous les chunks qu'ils touchent (marge pour ombres et halos).
    const spanTiles = (x: number, y: number, w: number, h: number, margin: number, list: number[][], id: number) => {
      const c0x = Math.max(0, Math.floor((x - margin) / CHUNK_TILES)), c1x = Math.min(CHUNKS_X - 1, Math.floor((x + w - 1 + margin) / CHUNK_TILES));
      const c0y = Math.max(0, Math.floor((y - margin) / CHUNK_TILES)), c1y = Math.min(CHUNKS_Y - 1, Math.floor((y + h - 1 + margin) / CHUNK_TILES));
      for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) list[cy * CHUNKS_X + cx].push(id);
    };
    this.buildings.forEach((b, i) => spanTiles(b.x, b.y, b.w, b.h, 4, this.chunkBuildings, i));
    this.props.forEach((p, i) => spanTiles(p.x, p.y, p.w, p.h, 1, this.chunkProps, i));
    this.lamps.forEach((l, i) => spanTiles(Math.floor(l.x / TILE), Math.floor(l.y / TILE), 1, 1, 5, this.chunkLamps, i));
    this.trees.forEach((t, i) => this.chunkTrees[ci(t.x, t.y)].push(i));
    this.spots.forEach((s, i) => this.chunkSpots[ci(s.x, s.y)].push(i));
    this.nodes.forEach((nd, i) => this.chunkNodes[ci(nd.cx, nd.cy)].push(i));
  }

  // ---------- Réseau routier ----------
  otherNode(e: RoadEdge, node: number): number { return e.a === node ? e.b : e.a; }
  /** Bras par lequel on QUITTE `from` en empruntant l'arête. */
  armFrom(e: RoadEdge, from: number): number { return e.vertical ? (e.a === from ? 2 : 0) : (e.a === from ? 1 : 3); }
  laneOffset(e: RoadEdge, lane: number): number {
    if (e.type === 'avenue') return lane === 0 ? 36 : 12;
    if (e.type === 'alley') return 8;
    return 12;
  }
  /** Segment de voie pour parcourir l'arête depuis `from`, conduite à droite. */
  laneSeg(e: RoadEdge, from: number, lane: number): LaneSeg {
    const arm = this.armFrom(e, from);
    const dx = ARM_DX[arm], dy = ARM_DY[arm];
    const off = this.laneOffset(e, lane);
    const rx = -dy, ry = dx; // vecteur « droite » du sens de marche
    const cxRoad = (e.x + e.wT / 2) * TILE, cyRoad = (e.y + e.hT / 2) * TILE;
    const halfLen = (e.vertical ? e.hT : e.wT) * TILE / 2;
    const sx = cxRoad - dx * halfLen + rx * off, sy = cyRoad - dy * halfLen + ry * off;
    const ex = cxRoad + dx * halfLen + rx * off, ey = cyRoad + dy * halfLen + ry * off;
    return { sx, sy, ex, ey, dx, dy, len: halfLen * 2 };
  }
  signalState(node: RoadNode, vertical: boolean, t: number): SignalState {
    if (!node.signal) return 'g';
    const p = ((t + node.phase) % SIGNAL_CYCLE + SIGNAL_CYCLE) % SIGNAL_CYCLE;
    if (vertical) return p < 6 ? 'g' : p < 7.5 ? 'y' : 'r';
    return p >= 8 && p < 14 ? 'g' : p >= 14 && p < 15.5 ? 'y' : 'r';
  }
  nearestNode(x: number, y: number, trafficOnly = false): RoadNode {
    let best = this.nodes[0], bd = Infinity;
    for (const n of this.nodes) {
      if (trafficOnly && !n.arms.some((a) => a >= 0 && this.edges[a].traffic)) continue;
      const d = (n.cx - x) * (n.cx - x) + (n.cy - y) * (n.cy - y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  /** Arête la plus proche d'un point (distance au rectangle de chaussée). */
  nearestEdge(x: number, y: number, trafficOnly = false): { edge: RoadEdge; d: number } | null {
    let best: RoadEdge | null = null, bd = Infinity;
    for (const e of this.edges) {
      if (trafficOnly && !e.traffic) continue;
      const x0 = e.x * TILE, y0 = e.y * TILE, x1 = (e.x + e.wT) * TILE, y1 = (e.y + e.hT) * TILE;
      const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { edge: best, d: Math.sqrt(bd) } : null;
  }
  /** Point de chaussée le plus proche (centre de la voie la plus proche). */
  nearestRoadPoint(x: number, y: number): { x: number; y: number; angle: number } {
    const r = this.nearestEdge(x, y, false)!;
    const e = r.edge;
    const cx = (e.x + e.wT / 2) * TILE, cy = (e.y + e.hT / 2) * TILE;
    if (e.vertical) {
      const py = Math.max(e.y * TILE + 20, Math.min((e.y + e.hT) * TILE - 20, y));
      const side = x < cx ? -1 : 1; // à l'ouest de l'axe, on roule vers le sud
      return { x: cx + side * this.laneOffset(e, 0), y: py, angle: side < 0 ? Math.PI / 2 : -Math.PI / 2 };
    }
    const px = Math.max(e.x * TILE + 20, Math.min((e.x + e.wT) * TILE - 20, x));
    const side = y < cy ? -1 : 1; // au nord de l'axe, on roule vers l'ouest
    return { x: px, y: cy + side * this.laneOffset(e, 0), angle: side < 0 ? Math.PI : 0 };
  }
  /** Plus court chemin (Dijkstra) entre deux carrefours ; renvoie la liste des nœuds. */
  routeNodes(from: number, to: number, trafficOnly = false): number[] {
    const n = this.nodes.length;
    const distArr = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    distArr[from] = 0;
    for (;;) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && distArr[i] < bd) { bd = distArr[i]; u = i; }
      if (u < 0 || u === to) break;
      done[u] = 1;
      for (const ei of this.nodes[u].arms) {
        if (ei < 0) continue;
        const e = this.edges[ei];
        if (trafficOnly && !e.traffic) continue;
        const v = this.otherNode(e, u);
        const nd = bd + e.length + 40;
        if (nd < distArr[v]) { distArr[v] = nd; prev[v] = u; }
      }
    }
    if (from !== to && prev[to] < 0) return [from];
    const path: number[] = [];
    for (let c = to; c >= 0; c = prev[c]) { path.push(c); if (c === from) break; }
    return path.reverse();
  }
  edgeBetween(a: number, b: number): RoadEdge | null {
    for (const ei of this.nodes[a].arms) if (ei >= 0 && this.otherNode(this.edges[ei], a) === b) return this.edges[ei];
    return null;
  }

  // ---------- Visibilité ----------
  /** Ligne de vue entre deux points (pixels). Les bâtiments et conteneurs bloquent, pas les grillages ni l'eau. */
  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(d / 6));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tx = Math.floor((x0 + (x1 - x0) * t) / TILE), ty = Math.floor((y0 + (y1 - y0) * t) / TILE);
      if (!this.inb(tx, ty) || this.opaque[ty * MAP_W + tx]) return false;
    }
    return true;
  }
  /** Cherche une tuile piétonne libre proche d'un point (spirale). */
  nearestWalkable(tx: number, ty: number, maxR = 12): { tx: number; ty: number } {
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx, y = ty + dy;
        if (this.inb(x, y) && this.reach[y * MAP_W + x]) return { tx: x, ty: y };
      }
    }
    return { tx, ty };
  }
}
