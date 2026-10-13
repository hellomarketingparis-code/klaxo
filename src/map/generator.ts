import { MAP_W, MAP_H, TILE, WORLD_SEED } from '../engine/config';
import { RNG, hash2 } from '../engine/rng';
import { CityMap } from './CityMap';
import { T, D, SOLID } from './tiles';
import type { RoadType, RoadNode, RoadEdge, Lot, Building, BuildingKind, LotUse } from './tiles';

/**
 * Génération procédurale et déterministe de la ville de Klaxo.
 * Étapes : artères → rues par quartier → suppression de tronçons → trottoirs → terrains spéciaux →
 * parcelles → bâtiments → mobilier urbain → index.
 */

const AVW = 6;
const V_AV = [20, 112, 204, 288];
const H_AV = [18, 104, 168, 212];
const COLS: [number, number][] = [[26, 111], [118, 203], [210, 287]];
const ROWS: [number, number][] = [[24, 103], [110, 167], [174, 211]];
const IN_X0 = 26, IN_X1 = 287, IN_Y0 = 24, IN_Y1 = 211;

export function districtOf(x: number, y: number): number {
  if (x < 115) return y < 107 ? D.HILLS : D.OLDTOWN;
  if (x < 207) return y < 171 ? D.DOWNTOWN : D.OLDTOWN;
  return y < 107 ? D.BUSINESS : D.INDUSTRIAL;
}

interface DistrictParams { gap: [number, number]; sw: number; remove: number; lot: [number, number]; alley: boolean; }
const DP: Record<number, DistrictParams> = {
  [D.HILLS]: { gap: [22, 28], sw: 1, remove: 0.3, lot: [7, 10], alley: false },
  [D.BUSINESS]: { gap: [20, 26], sw: 2, remove: 0.08, lot: [9, 14], alley: false },
  [D.DOWNTOWN]: { gap: [16, 20], sw: 2, remove: 0.06, lot: [6, 10], alley: false },
  [D.OLDTOWN]: { gap: [12, 16], sw: 1, remove: 0.18, lot: [4, 7], alley: true },
  [D.INDUSTRIAL]: { gap: [24, 30], sw: 1, remove: 0.12, lot: [10, 18], alley: false },
};

interface Line { vertical: boolean; pos: number; w: number; a0: number; a1: number; type: RoadType; }

interface Special {
  id: string; d: number; w: number; h: number; px: number; py: number; type: string; name: string;
  sign?: string; kind?: BuildingKind; layout?: 'compound' | 'park' | 'market' | 'dealer' | 'house';
}
const SPECIALS: Special[] = [
  { id: 'm3_warehouse', d: D.INDUSTRIAL, w: 22, h: 18, px: 250, py: 150, type: 'warehouse', name: 'Entrepôt Stock 13', layout: 'compound' },
  { id: 'parc', d: D.DOWNTOWN, w: 14, h: 12, px: 160, py: 92, type: 'park', name: 'Parc Central', layout: 'park' },
  { id: 'gare', d: D.DOWNTOWN, w: 12, h: 7, px: 138, py: 150, type: 'station', name: 'Gare de Klaxo', sign: 'GARE', kind: 'civic' },
  { id: 'mairie', d: D.DOWNTOWN, w: 10, h: 7, px: 165, py: 130, type: 'cityhall', name: 'Mairie', sign: 'MAIRIE', kind: 'civic' },
  { id: 'police', d: D.DOWNTOWN, w: 8, h: 7, px: 135, py: 55, type: 'police', name: 'Commissariat', sign: 'POLICE', kind: 'civic' },
  { id: 'm2_giver', d: D.DOWNTOWN, w: 6, h: 6, px: 188, py: 120, type: 'radio', name: 'Radio Bouchon', sign: 'RADIO', kind: 'block' },
  { id: 'clothes', d: D.DOWNTOWN, w: 5, h: 5, px: 180, py: 70, type: 'clothes', name: 'Fringues & Cie', sign: 'FRINGUES', kind: 'shop' },
  { id: 'kiosk', d: D.DOWNTOWN, w: 4, h: 4, px: 150, py: 108, type: 'kiosk', name: 'Kiosque de Jo', sign: 'KIOSQUE', kind: 'shop' },
  { id: 'dealer', d: D.BUSINESS, w: 12, h: 8, px: 228, py: 88, type: 'dealer', name: 'Klaxocars', sign: 'AUTOS', kind: 'shop', layout: 'dealer' },
  { id: 'wazou', d: D.BUSINESS, w: 9, h: 9, px: 268, py: 42, type: 'hq', name: 'Siège de Wazou', sign: 'WAZOU', kind: 'tower' },
  { id: 'tour', d: D.BUSINESS, w: 10, h: 10, px: 250, py: 70, type: 'tower', name: 'Tour K', sign: 'TOUR K', kind: 'tower' },
  { id: 'banque', d: D.BUSINESS, w: 8, h: 7, px: 235, py: 45, type: 'bank', name: 'Banque Pognon', sign: 'BANQUE', kind: 'tower' },
  { id: 'hotel', d: D.BUSINESS, w: 9, h: 8, px: 272, py: 88, type: 'hotel', name: 'Hôtel Palace', sign: 'HOTEL', kind: 'tower' },
  { id: 'marche', d: D.OLDTOWN, w: 10, h: 8, px: 70, py: 165, type: 'market', name: 'Marché du Vieux', layout: 'market' },
  { id: 'garage_old', d: D.OLDTOWN, w: 7, h: 6, px: 42, py: 190, type: 'garage', name: 'Garage Momo', sign: 'GARAGE', kind: 'warehouse' },
  { id: 'musee', d: D.OLDTOWN, w: 8, h: 6, px: 150, py: 195, type: 'museum', name: 'Musée du Klaxon', sign: 'MUSEE', kind: 'civic' },
  { id: 'm1_shop', d: D.OLDTOWN, w: 5, h: 5, px: 58, py: 135, type: 'grocery', name: 'Chez Gégé', sign: 'CHEZ GEGE', kind: 'shop' },
  { id: 'm3_bar', d: D.OLDTOWN, w: 5, h: 5, px: 92, py: 185, type: 'bar', name: 'Le Flamant Rose', sign: 'FLAMANT', kind: 'shop' },
  { id: 'usine', d: D.INDUSTRIAL, w: 14, h: 10, px: 268, py: 125, type: 'factory', name: 'Usine Robotix', sign: 'ROBOTIX', kind: 'warehouse' },
  { id: 'depot', d: D.INDUSTRIAL, w: 10, h: 8, px: 225, py: 195, type: 'depot', name: 'Dépôt Vrac', sign: 'DEPOT', kind: 'warehouse' },
  { id: 'garage_ind', d: D.INDUSTRIAL, w: 8, h: 6, px: 222, py: 125, type: 'garage', name: 'Carrosserie Néon', sign: 'GARAGE', kind: 'warehouse' },
  { id: 'port', d: D.INDUSTRIAL, w: 7, h: 5, px: 280, py: 195, type: 'port', name: 'Capitainerie', sign: 'PORT', kind: 'civic' },
  { id: 'm1_dest', d: D.HILLS, w: 8, h: 7, px: 48, py: 45, type: 'house', name: 'Chez Maman Gégé', layout: 'house' },
  { id: 'villa', d: D.HILLS, w: 9, h: 8, px: 92, py: 62, type: 'house', name: 'Villa Belvédère', layout: 'house' },
];

/** Plan de l'entrepôt de la mission 3. F = grillage, B = bâtiment, C = conteneur, G = portail. */
const COMPOUND = [
  'FFFFFFFFFFFFFFFFFFFFFF',
  'F....BBBBBBBBBBBBB...F',
  'F....BBBBBBBBBBBBB...F',
  'F....BBBBBBBBBBBBB...F',
  'F....BBBBBBBBBBBBB...F',
  'F....BBBBBBBBBBBBB...F',
  'F....................F',
  'F.CC............CC...F',
  'F.CC............CC...F',
  'F....................F',
  'F......CCCC..........F',
  'F......CCCC....CC....F',
  'F..............CC....F',
  'F.CC.................F',
  'F.CC.....CC..........F',
  'F........CC......CC..F',
  'F................CC..F',
  'FFFFFFFFGGGFFFFFFFFFFF',
];

const SHOP_NAMES: Record<number, string[]> = {
  [D.DOWNTOWN]: ['PIZZA', 'BAR', 'CAFE', 'KEBAB', 'TABAC', 'SUSHI', 'TACOS', 'CINE', 'ARCADE', 'DISQUES', 'LIVRES', 'CLUB', 'BURGER', 'PHOTO', 'LASER', 'NOUILLES', 'KARAOKE', 'VIDEO'],
  [D.OLDTOWN]: ['PAIN', 'FLEURS', 'BROC', 'TABAC', 'CAFE', 'BAR', 'COIFFEUR', 'CLES', 'EPICERIE', 'FROMAGE', 'VELOS', 'TATTOO', 'LAVERIE', 'COUTURE', 'BISTROT', 'PECHE'],
  [D.BUSINESS]: ['CONSEIL', 'FINANCE', 'STARTUP', 'CLOUD', 'INVEST', 'LOUNGE', 'SPA', 'AVOCATS', 'CRYPTO', 'ASSUR', 'MEDIA', 'CAVIAR'],
  [D.INDUSTRIAL]: ['FRET', 'METAUX', 'PNEUS', 'CIMENT', 'CASSE', 'FRIGO', 'CABLES', 'TRANSIT', 'BOULONS'],
  [D.HILLS]: [],
};
const SIGN_PROB: Record<number, number> = { [D.DOWNTOWN]: 0.7, [D.OLDTOWN]: 0.65, [D.BUSINESS]: 0.45, [D.INDUSTRIAL]: 0.3, [D.HILLS]: 0 };

export function generateCity(seed: number = WORLD_SEED): CityMap {
  const rng = new RNG(seed);
  const m = new CityMap();
  const { kind, district, lotId, rdir } = m;
  const I = (x: number, y: number) => y * MAP_W + x;

  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = I(x, y);
    district[i] = districtOf(x, y);
    kind[i] = x >= 304 || y >= 228 ? T.WATER : x < 14 || y < 12 ? T.FOREST : T.GRASS;
  }

  // ---------- 1. Lignes de routes ----------
  const lines: Line[] = [];
  for (const x of V_AV) lines.push({ vertical: true, pos: x, w: AVW, a0: H_AV[0], a1: H_AV[3] + AVW - 1, type: 'avenue' });
  for (const y of H_AV) lines.push({ vertical: false, pos: y, w: AVW, a0: V_AV[0], a1: V_AV[3] + AVW - 1, type: 'avenue' });

  const subdivide = (c0: number, c1: number, dp: DistrictParams, prev: Line[]) => {
    const out: { pos: number; w: number; ext?: Line }[] = [];
    const minGap = Math.max(8, dp.gap[0] - 4);
    let p = c0 + rng.int(dp.gap[0], dp.gap[1]);
    let prevEnd = c0;
    let i = 0;
    for (;;) {
      let w = dp.alley && i % 2 === 1 ? 2 : 3;
      let ext: Line | undefined;
      for (let guard = 0; guard < 12; guard++) {
        const u = prev.find((l) => Math.abs(l.pos - p) < 10);
        if (!u) break;
        if (u.pos - prevEnd >= minGap && c1 + 1 - (u.pos + u.w) >= minGap) { ext = u; p = u.pos; w = u.w; break; }
        p = u.pos + u.w + 10;
      }
      if (p + w + minGap > c1 + 1) break;
      out.push({ pos: p, w, ext });
      prevEnd = p + w;
      p = prevEnd + rng.int(dp.gap[0], dp.gap[1]);
      i++;
    }
    return out;
  };
  const cellV: Line[][][] = [[], [], []];
  const cellH: Line[][][] = [[], [], []];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    const [x0, x1] = COLS[c], [y0, y1] = ROWS[r];
    const dp = DP[districtOf((x0 + x1) >> 1, (y0 + y1) >> 1)];
    cellV[c][r] = [];
    for (const s of subdivide(x0, x1, dp, r > 0 ? cellV[c][r - 1] : [])) {
      if (s.ext) { s.ext.a1 = H_AV[r + 1] + AVW - 1; cellV[c][r].push(s.ext); } else {
        const l: Line = { vertical: true, pos: s.pos, w: s.w, a0: H_AV[r], a1: H_AV[r + 1] + AVW - 1, type: s.w === 2 ? 'alley' : 'street' };
        lines.push(l); cellV[c][r].push(l);
      }
    }
    cellH[c][r] = [];
    for (const s of subdivide(y0, y1, dp, c > 0 ? cellH[c - 1][r] : [])) {
      if (s.ext) { s.ext.a1 = V_AV[c + 1] + AVW - 1; cellH[c][r].push(s.ext); } else {
        const l: Line = { vertical: false, pos: s.pos, w: s.w, a0: V_AV[c], a1: V_AV[c + 1] + AVW - 1, type: s.w === 2 ? 'alley' : 'street' };
        lines.push(l); cellH[c][r].push(l);
      }
    }
  }

  // ---------- 2. Carrefours et tronçons ----------
  interface TmpNode { v: Line; h: Line; arms: [number, number, number, number]; }
  interface TmpEdge { a: number; b: number; line: Line; removed: boolean; }
  const tn: TmpNode[] = [];
  const te: TmpEdge[] = [];
  const vs = lines.filter((l) => l.vertical), hs = lines.filter((l) => !l.vertical);
  const nodeAt = new Map<string, number>();
  for (const v of vs) for (const h of hs) {
    if (v.pos >= h.a0 && v.pos + v.w - 1 <= h.a1 && h.pos >= v.a0 && h.pos + h.w - 1 <= v.a1) {
      nodeAt.set(`${lines.indexOf(v)}:${lines.indexOf(h)}`, tn.length);
      tn.push({ v, h, arms: [-1, -1, -1, -1] });
    }
  }
  for (const l of lines) {
    const on = tn.map((n, i) => ({ n, i })).filter(({ n }) => (l.vertical ? n.v === l : n.h === l));
    on.sort((p, q) => (l.vertical ? p.n.h.pos - q.n.h.pos : p.n.v.pos - q.n.v.pos));
    for (let k = 0; k + 1 < on.length; k++) {
      const id = te.length;
      te.push({ a: on[k].i, b: on[k + 1].i, line: l, removed: false });
      if (l.vertical) { on[k].n.arms[2] = id; on[k + 1].n.arms[0] = id; } else { on[k].n.arms[1] = id; on[k + 1].n.arms[3] = id; }
    }
  }
  const degOf = (n: TmpNode) => n.arms.filter((a) => a >= 0 && !te[a].removed).length;
  const connected = () => {
    const total = te.filter((e) => !e.removed).length;
    const seenE = new Set<number>();
    const seenN = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      const u = stack.pop()!;
      for (const a of tn[u].arms) {
        if (a < 0 || te[a].removed) continue;
        seenE.add(a);
        const v = te[a].a === u ? te[a].b : te[a].a;
        if (!seenN.has(v)) { seenN.add(v); stack.push(v); }
      }
    }
    return seenE.size === total;
  };
  const order = rng.shuffle(te.map((_, i) => i));
  for (const ei of order) {
    const e = te[ei];
    if (e.line.type === 'avenue') continue;
    const na = tn[e.a], nb = tn[e.b];
    const mx = e.line.vertical ? e.line.pos : (na.v.pos + nb.v.pos) >> 1;
    const my = e.line.vertical ? (na.h.pos + nb.h.pos) >> 1 : e.line.pos;
    const d = districtOf(mx, my);
    if (!rng.chance(DP[d].remove)) continue;
    e.removed = true;
    const deadEnd = degOf(na) === 1 || degOf(nb) === 1;
    const allowDead = (d === D.HILLS || d === D.OLDTOWN) && rng.chance(0.5);
    if (!connected() || (deadEnd && !allowDead)) e.removed = false;
  }

  // Compactage : on ne garde que les nœuds utiles.
  const nodeMap = new Int32Array(tn.length).fill(-1);
  tn.forEach((n, i) => {
    if (degOf(n) === 0) return;
    const id = m.nodes.length;
    nodeMap[i] = id;
    const node: RoadNode = {
      id, cx: (n.v.pos + n.v.w / 2) * TILE, cy: (n.h.pos + n.h.w / 2) * TILE,
      bx: n.v.pos, by: n.h.pos, bw: n.v.w, bh: n.h.w, arms: [-1, -1, -1, -1], deg: 0, signal: false,
      phase: Math.floor(hash2(n.v.pos, n.h.pos, 7) * 16), district: districtOf(n.v.pos, n.h.pos),
    };
    m.nodes.push(node);
  });
  te.forEach((e) => {
    if (e.removed) return;
    const a = m.nodes[nodeMap[e.a]], b = m.nodes[nodeMap[e.b]];
    const l = e.line;
    const id = m.edges.length;
    const edge: RoadEdge = l.vertical
      ? { id, a: a.id, b: b.id, vertical: true, type: l.type, w: l.w, x: l.pos, y: a.by + a.bh, wT: l.w, hT: b.by - (a.by + a.bh), lanes: l.type === 'avenue' ? 2 : 1, traffic: l.type !== 'alley', length: 0 }
      : { id, a: a.id, b: b.id, vertical: false, type: l.type, w: l.w, x: a.bx + a.bw, y: l.pos, wT: b.bx - (a.bx + a.bw), hT: l.w, lanes: l.type === 'avenue' ? 2 : 1, traffic: l.type !== 'alley', length: 0 };
    edge.length = (edge.vertical ? edge.hT : edge.wT) * TILE;
    m.edges.push(edge);
    if (l.vertical) { a.arms[2] = id; b.arms[0] = id; } else { a.arms[1] = id; b.arms[3] = id; }
  });
  for (const n of m.nodes) n.deg = n.arms.filter((a) => a >= 0).length;

  // Réseau ouvert à la circulation : on retire itérativement les impasses (2-cœur du graphe sans ruelles).
  for (let changed = true; changed;) {
    changed = false;
    for (const n of m.nodes) {
      const open = n.arms.filter((a) => a >= 0 && m.edges[a].traffic);
      if (open.length === 1) { m.edges[open[0]].traffic = false; changed = true; }
    }
  }
  for (const n of m.nodes) {
    const hasAvenue = n.arms.some((a) => a >= 0 && m.edges[a].type === 'avenue');
    const noAlley = n.arms.every((a) => a < 0 || m.edges[a].type !== 'alley');
    n.signal = n.deg >= 3 && noAlley && (hasAvenue || n.district === D.DOWNTOWN || n.district === D.BUSINESS);
  }

  // ---------- 3. Rasterisation des routes ----------
  const fill = (x: number, y: number, w: number, h: number, k: number, dir = 0) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) continue;
      kind[I(xx, yy)] = k;
      if (dir) rdir[I(xx, yy)] = dir;
    }
  };
  for (const e of m.edges) fill(e.x, e.y, e.wT, e.hT, T.ROAD, e.vertical ? 2 : 1);
  for (const n of m.nodes) {
    const vert = n.arms[0] >= 0 || n.arms[2] >= 0, hor = n.arms[1] >= 0 || n.arms[3] >= 0;
    fill(n.bx, n.by, n.bw, n.bh, T.ROAD, vert && hor ? 3 : vert ? 2 : 1);
  }
  for (const n of m.nodes) {
    if (n.deg < 3) continue;
    if (n.arms[0] >= 0) fill(n.bx, n.by - 2, n.bw, 2, T.CROSSWALK);
    if (n.arms[2] >= 0) fill(n.bx, n.by + n.bh, n.bw, 2, T.CROSSWALK);
    if (n.arms[3] >= 0) fill(n.bx - 2, n.by, 2, n.bh, T.CROSSWALK);
    if (n.arms[1] >= 0) fill(n.bx + n.bw, n.by, 2, n.bh, T.CROSSWALK);
  }

  // ---------- 4. Trottoirs ----------
  const isRoad = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && (kind[I(x, y)] === T.ROAD || kind[I(x, y)] === T.CROSSWALK);
  const side: number[] = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (kind[I(x, y)] !== T.GRASS) continue;
    const sw = DP[district[I(x, y)]].sw;
    let near = false;
    for (let dy = -sw; dy <= sw && !near; dy++) for (let dx = -sw; dx <= sw; dx++) if (isRoad(x + dx, y + dy)) { near = true; break; }
    if (near) side.push(I(x, y));
  }
  for (const i of side) kind[i] = T.SIDEWALK;

  // ---------- 5. Bandes extérieures : port, plage, lisière ----------
  for (let y = 12; y < 228; y++) for (let x = 14; x < 304; x++) {
    const i = I(x, y);
    if (kind[i] !== T.GRASS) continue;
    if (x >= 296) kind[i] = T.DOCK;
    else if (y >= 220) kind[i] = T.SAND;
  }
  for (const py of [60, 132, 190]) fill(304, py, 10, 3, T.DOCK);
  fill(150, 228, 3, 9, T.DOCK);
  for (let y = 28; y < 208; y += rng.int(9, 14)) {
    const tall = rng.chance(0.5);
    const px = tall ? 299 : 298, pw = tall ? 2 : 4, ph = tall ? 4 : 2;
    if ([60, 132, 190].some((p) => Math.abs(p - y) < 6)) continue;
    fill(px, y, pw, ph, T.PROP);
    m.props.push({ x: px, y, w: pw, h: ph, kind: 'container', seed: rng.int(0, 1e6) });
  }
  for (let y = 12; y < 228; y++) for (let x = 14; x < 296; x++) {
    const i = I(x, y);
    if (kind[i] === T.GRASS && (x < IN_X0 - 6 || y < IN_Y0 - 6) && hash2(x, y, 3) < 0.16) {
      kind[i] = T.TREE;
      m.trees.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, variant: Math.floor(hash2(x, y, 5) * 3) });
    }
  }

  // ---------- 6. Terrains spéciaux ----------
  const interior = (x: number, y: number) => x >= IN_X0 && x <= IN_X1 && y >= IN_Y0 && y <= IN_Y1;
  const free = (x: number, y: number) => interior(x, y) && kind[I(x, y)] === T.GRASS && lotId[I(x, y)] === 0;
  const rectFree = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!free(xx, yy)) return false;
    return true;
  };
  const newLot = (x: number, y: number, w: number, h: number, use: LotUse): Lot => {
    const lot: Lot = { id: m.lots.length + 1, x, y, w, h, district: district[I(x + (w >> 1), y + (h >> 1))], use, frontS: kind[I(x + (w >> 1), y + h)] === T.SIDEWALK };
    m.lots.push(lot);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) lotId[I(xx, yy)] = lot.id;
    return lot;
  };
  const addBuilding = (x: number, y: number, w: number, h: number, bk: BuildingKind, facade: number, sign?: string, poi?: string): Building => {
    const b: Building = {
      id: m.buildings.length, x, y, w, h, district: district[I(x + (w >> 1), y + (h >> 1))], kind: bk,
      seed: rng.int(1, 1e9), facade: Math.max(1, Math.min(facade, h - 2)), doorX: x + (w >> 1), poi,
    };
    if (sign) b.sign = { text: sign, color: rng.int(0, 4) };
    m.buildings.push(b);
    fill(x, y, w, h, T.BUILDING);
    return b;
  };
  const addProp = (x: number, y: number, w: number, h: number, pk: 'container' | 'fountain' | 'stall' | 'crate' | 'bench') => {
    fill(x, y, w, h, T.PROP);
    m.props.push({ x, y, w, h, kind: pk, seed: rng.int(0, 1e6) });
  };
  const addTree = (x: number, y: number) => {
    kind[I(x, y)] = T.TREE;
    m.trees.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, variant: rng.int(0, 2) });
  };

  const placeSpecial = (s: Special): void => {
    let w = s.w, h = s.h;
    let best: { x: number; y: number } | null = null;
    for (; !best && w >= 4 && h >= 4; ) {
      let bd = Infinity;
      for (let y = IN_Y0; y + h - 1 <= IN_Y1; y++) for (let x = IN_X0; x + w - 1 <= IN_X1; x++) {
        if (districtOf(x + (w >> 1), y + (h >> 1)) !== s.d) continue;
        if (kind[I(x + (w >> 1), y + h)] !== T.SIDEWALK) continue;
        if (!free(x, y) || !free(x + w - 1, y + h - 1)) continue;
        if (free(x - 1, y + h - 1) && free(x + w, y + h - 1)) continue; // ancré à un bord de pâté de maisons
        let rowOk = true;
        for (let xx = x; xx < x + w; xx++) if (kind[I(xx, y + h)] !== T.SIDEWALK) { rowOk = false; break; }
        if (!rowOk || !rectFree(x, y, w, h)) continue;
        const d = Math.hypot(x + w / 2 - s.px, y + h / 2 - s.py);
        if (d < bd) { bd = d; best = { x, y }; }
      }
      if (!best) {
        if (s.layout === 'compound') throw new Error('Impossible de placer l’entrepôt de la mission 3');
        if (w >= h) w--; else h--;
      }
    }
    if (!best) throw new Error(`Impossible de placer ${s.id}`);
    const { x, y } = best;
    newLot(x, y, w, h, 'special');
    const doorX = x + (w >> 1);
    let building: Building | undefined;
    if (s.layout === 'compound') {
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const ch = COMPOUND[r][c];
        kind[I(x + c, y + r)] = ch === 'F' ? T.FENCE : T.YARD;
      }
      building = addBuilding(x + 5, y + 1, 13, 5, 'warehouse', 1, 'STOCK 13');
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        if (COMPOUND[r][c] !== 'C') continue;
        if (c > 0 && COMPOUND[r][c - 1] === 'C') continue;
        if (r > 0 && COMPOUND[r - 1][c] === 'C') continue;
        let cw = 1; while (COMPOUND[r][c + cw] === 'C') cw++;
        let chh = 1; while (COMPOUND[r + chh] && COMPOUND[r + chh][c] === 'C') chh++;
        addProp(x + c, y + r, cw, chh, 'container');
      }
      const gateX = x + 9;
      m.pois.set(s.id, { id: s.id, type: s.type, name: s.name, district: s.d, tx: gateX, ty: y + h, building: building.id, rect: { x, y, w, h } });
      m.pois.set('m3_item', { id: 'm3_item', type: 'spot', name: 'Enseigne confisquée', district: s.d, tx: x + 10, ty: y + 7 });
      m.pois.set('m3_observe', { id: 'm3_observe', type: 'spot', name: 'Portail de l’entrepôt', district: s.d, tx: gateX, ty: y + h });
      const P = (c: number, r: number) => ({ tx: x + c, ty: y + r });
      m.guardRoutes['m3'] = [
        { points: [P(5, 9), P(12, 9), P(12, 13), P(5, 13)], loop: true },
        { points: [P(2, 6), P(19, 6)], loop: false },
        { points: [P(20, 8), P(20, 15)], loop: false },
      ];
      return;
    }
    if (s.layout === 'park') {
      const cy = y + (h >> 1);
      for (let xx = x; xx < x + w; xx++) kind[I(xx, cy)] = T.PATH;
      for (let yy = y; yy < y + h; yy++) kind[I(doorX, yy)] = T.PATH;
      fill(x + 2, y + 2, 4, 3, T.WATER);
      for (let yy = y + 1; yy < y + h - 1; yy++) for (let xx = x + 1; xx < x + w - 1; xx++) {
        if (kind[I(xx, yy)] === T.GRASS && rng.chance(0.13)) addTree(xx, yy);
      }
    } else if (s.layout === 'market') {
      fill(x, y, w, h, T.PLAZA);
      for (let yy = y + 1; yy + 1 < y + h - 1; yy += 3) for (let xx = x + 1; xx + 2 < x + w; xx += 4) addProp(xx, yy, 2, 1, 'stall');
    } else if (s.layout === 'dealer') {
      building = addBuilding(x, y, 6, h, s.kind ?? 'shop', 2, s.sign, s.id);
      fill(x + 6, y, w - 6, h, T.PARKING);
      const kinds = ['sport', 'sedan', 'compact', 'van', 'sport', 'sedan'];
      let k = 0;
      for (let yy = y + 1; yy + 2 <= y + h - 1; yy += 3) for (let xx = x + 7; xx + 1 < x + w; xx += 2) {
        m.spots.push({ x: (xx + 0.5) * TILE, y: (yy + 1) * TILE, angle: Math.PI / 2, filled: true, kind: kinds[k++ % kinds.length] });
      }
    } else if (s.layout === 'house') {
      fill(x, y, w, h, T.GARDEN);
      building = addBuilding(x + 1, y + 1, w - 3, h - 3, 'house', 1, undefined, s.id);
      for (let yy = building.y + building.h; yy < y + h; yy++) kind[I(building.doorX, yy)] = T.PATH;
      fill(x + w - 2, y + h - 3, 2, 3, T.PATH);
      m.spots.push({ x: (x + w - 1) * TILE, y: (y + h - 1.5) * TILE, angle: -Math.PI / 2, filled: true, kind: 'compact' });
      addTree(x, y); addTree(x + w - 1, y);
      m.pois.set(s.id, { id: s.id, type: s.type, name: s.name, district: s.d, tx: building.doorX, ty: y + h, building: building.id, rect: { x, y, w, h } });
      return;
    } else {
      const facade = s.kind === 'tower' ? 3 : 2;
      building = addBuilding(x, y, w, h, s.kind ?? 'block', facade, s.sign, s.id);
    }
    const bx = building ? building.doorX : doorX;
    m.pois.set(s.id, { id: s.id, type: s.type, name: s.name, district: s.d, tx: bx, ty: y + h, building: building?.id, rect: { x, y, w, h } });
  };
  for (const s of SPECIALS) placeSpecial(s);

  // ---------- 7. Parcelles et bâtiments ordinaires ----------
  const pickLen = (run: number, min: number, max: number): number => {
    if (run <= max) return run;
    let w = rng.int(min, max);
    if (run - w < min) w = run - min;
    if (w < min) w = Math.ceil(run / 2);
    return w;
  };
  const usedNames = new Map<number, string[]>();
  const shopName = (d: number): string => {
    let pool = usedNames.get(d);
    if (!pool || pool.length === 0) { pool = rng.shuffle([...SHOP_NAMES[d]]); usedNames.set(d, pool); }
    return pool.pop()!;
  };
  for (let y = IN_Y0; y <= IN_Y1; y++) for (let x = IN_X0; x <= IN_X1; x++) {
    if (!free(x, y)) continue;
    const d = district[I(x, y)];
    const [lmin, lmax] = DP[d].lot;
    let run = 0; while (run < 48 && free(x + run, y)) run++;
    const w = pickLen(run, lmin, lmax);
    let down = 0; while (down < 48 && rectFree(x, y + down, w, 1)) down++;
    const h = pickLen(down, lmin, lmax);
    const lot = newLot(x, y, w, h, 'filler');
    const ground = d === D.HILLS ? T.GARDEN : d === D.INDUSTRIAL ? T.YARD : T.PLAZA;
    if (w < 3 || h < 3) { fill(x, y, w, h, ground); continue; }
    const roll = rng.next();
    if (d === D.HILLS) {
      if (roll < 0.14 && w >= 6 && h >= 6) {
        lot.use = 'park';
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
          const border = xx === x || yy === y || xx === x + w - 1 || yy === y + h - 1;
          if (!border && rng.chance(0.16)) addTree(xx, yy);
        }
        continue;
      }
      lot.use = 'house';
      fill(x, y, w, h, T.GARDEN);
      const bw = w - 2 - (w >= 9 ? 1 : 0), bh = h - 3;
      if (bw < 3 || bh < 3) { if (rng.chance(0.5)) addTree(x + (w >> 1), y + (h >> 1)); continue; }
      const b = addBuilding(x + 1, y + 1, bw, bh, 'house', 1);
      for (let yy = b.y + b.h; yy < y + h; yy++) kind[I(b.doorX, yy)] = T.PATH;
      if (w >= 8 && lot.frontS) {
        fill(x + w - 2, y + h - 3, 2, 3, T.PATH);
        m.spots.push({ x: (x + w - 1) * TILE, y: (y + h - 1.5) * TILE, angle: -Math.PI / 2, filled: rng.chance(0.55) });
      }
      if (rng.chance(0.7)) addTree(x, y);
      if (rng.chance(0.5)) addTree(x + w - 1, y);
      if (rng.chance(0.3)) addTree(x, y + h - 1);
      continue;
    }
    const pPark = d === D.DOWNTOWN ? 0.08 : d === D.BUSINESS ? 0.1 : d === D.OLDTOWN ? 0.06 : 0.1;
    const pOpen = d === D.DOWNTOWN ? 0.1 : d === D.BUSINESS ? 0.15 : d === D.OLDTOWN ? 0.07 : 0.28;
    if (roll < pPark && w >= 5 && h >= 5) {
      lot.use = 'parking';
      fill(x, y, w, h, T.PARKING);
      for (let xx = x; xx + 1 <= x + w - 1; xx += 2) {
        m.spots.push({ x: (xx + 1) * TILE - 6, y: (y + 1.1) * TILE, angle: -Math.PI / 2, filled: rng.chance(0.55) });
        if (h >= 6) m.spots.push({ x: (xx + 1) * TILE - 6, y: (y + h - 1.1) * TILE, angle: Math.PI / 2, filled: rng.chance(0.55) });
      }
      continue;
    }
    if (roll < pPark + pOpen) {
      if (d === D.INDUSTRIAL) {
        lot.use = 'yard';
        fill(x, y, w, h, T.YARD);
        for (let t = 0; t < 8; t++) {
          const tall = rng.chance(0.5);
          const cw = tall ? 2 : 4, ch = tall ? 4 : 2;
          const cx = rng.int(x + 1, Math.max(x + 1, x + w - cw - 1)), cy = rng.int(y + 1, Math.max(y + 1, y + h - ch - 1));
          let ok = cx + cw < x + w && cy + ch < y + h;
          for (let yy = cy - 1; ok && yy <= cy + ch; yy++) for (let xx = cx - 1; xx <= cx + cw; xx++) if (kind[I(xx, yy)] !== T.YARD) { ok = false; break; }
          if (ok) addProp(cx, cy, cw, ch, 'container');
        }
        if (w >= 6) m.spots.push({ x: (x + 1.5) * TILE, y: (y + h - 1.5) * TILE, angle: 0, filled: rng.chance(0.6), kind: rng.chance(0.5) ? 'truck' : 'van' });
      } else {
        lot.use = 'plaza';
        fill(x, y, w, h, T.PLAZA);
        if (w >= 6 && h >= 6) addProp(x + (w >> 1) - 1, y + (h >> 1) - 1, 2, 2, 'fountain');
        for (let t = 0; t < 4; t++) {
          const tx = rng.int(x + 1, x + w - 2), ty = rng.int(y + 1, y + h - 2);
          if (kind[I(tx, ty)] === T.PLAZA && rng.chance(0.7)) addTree(tx, ty);
        }
      }
      continue;
    }
    lot.use = 'building';
    fill(x, y, w, h, ground);
    const alley = w >= 5 && rng.chance(d === D.OLDTOWN ? 0.35 : 0.22) ? 1 : 0;
    const bw = w - alley, bh = h - (lot.frontS ? 0 : 1);
    if (bw < 3 || bh < 3) continue;
    const bk: BuildingKind = d === D.BUSINESS ? 'tower' : d === D.INDUSTRIAL ? 'warehouse' : d === D.DOWNTOWN ? (rng.chance(0.5) ? 'block' : 'shop') : 'shop';
    const facade = d === D.BUSINESS ? (bh >= 8 ? 3 : 2) : d === D.DOWNTOWN ? 2 : d === D.OLDTOWN ? rng.int(1, 2) : 1;
    const sign = lot.frontS && bw >= 4 && rng.chance(SIGN_PROB[d]) ? shopName(d) : undefined;
    addBuilding(x, y, bw, bh, bk, facade, sign);
  }

  // ---------- 8. Lampadaires et arbres d'alignement ----------
  const lampAt = (tx: number, ty: number) => {
    if (m.inb(tx, ty) && kind[I(tx, ty)] === T.SIDEWALK) m.lamps.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
  };
  for (const e of m.edges) {
    const step = e.type === 'alley' ? 9 : 7;
    if (e.vertical) {
      for (let yy = e.y + 3, k = 0; yy < e.y + e.hT - 2; yy += step, k++) {
        if (k % 2 === 0) lampAt(e.x - 1, yy); else lampAt(e.x + e.wT, yy);
      }
    } else {
      for (let xx = e.x + 3, k = 0; xx < e.x + e.wT - 2; xx += step, k++) {
        if (k % 2 === 0) lampAt(xx, e.y - 1); else lampAt(xx, e.y + e.hT);
      }
    }
    const d = districtOf(e.x + (e.wT >> 1), e.y + (e.hT >> 1));
    if (DP[d].sw === 2 && e.type !== 'alley') {
      const plant = (tx: number, ty: number) => {
        if (m.inb(tx, ty) && kind[I(tx, ty)] === T.SIDEWALK) m.trees.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, variant: 3 });
      };
      if (e.vertical) for (let yy = e.y + 6; yy < e.y + e.hT - 3; yy += 7) { plant(e.x - 2, yy); plant(e.x + e.wT + 1, yy); }
      else for (let xx = e.x + 6; xx < e.x + e.wT - 3; xx += 7) { plant(xx, e.y - 2); plant(xx, e.y + e.hT + 1); }
    }
  }

  // ---------- 9. Accessibilité piétonne ----------
  {
    const start = m.nodes[0];
    const q = [I(start.bx, start.by)];
    m.reach[q[0]] = 1;
    while (q.length) {
      const i = q.pop()!;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + [1, -1, 0, 0][k], ny = y + [0, 0, 1, -1][k];
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const ni = I(nx, ny);
        if (m.reach[ni] || SOLID[kind[ni]]) continue;
        m.reach[ni] = 1; q.push(ni);
      }
    }
  }
  for (const p of m.pois.values()) {
    if (!m.reach[I(p.tx, p.ty)]) throw new Error(`POI inaccessible : ${p.id}`);
  }

  // ---------- 10. Points d'intérêt généraux et lieux secrets ----------
  const addSpot = (id: string, name: string, tx: number, ty: number) => {
    const p = m.nearestWalkable(tx, ty, 20);
    m.pois.set(id, { id, type: 'spot', name, district: districtOf(p.tx, p.ty), tx: p.tx, ty: p.ty });
  };
  addSpot('plage', 'Plage de Klaxo', 90, 224);
  addSpot('jetee', 'Jetée sud', 151, 234);
  addSpot('quai_nord', 'Quai nord', 310, 61);
  addSpot('quai_sud', 'Quai sud', 310, 191);
  addSpot('belvedere', 'Belvédère', 20, 16);
  addSpot('spawn', 'Place du départ', m.poi('kiosk').tx - 3, m.poi('kiosk').ty);
  // Carrefours nommés : utiles aux missions pour désigner des trajets en voiture.
  const namedNode = (id: string, name: string, tx: number, ty: number) => {
    const n = m.nearestNode(tx * TILE, ty * TILE, true);
    m.pois.set(id, { id, type: 'crossing', name, district: n.district, tx: n.bx - 1, ty: n.by - 1 });
  };
  namedNode('x_centre', 'Carrefour central', 160, 104);
  namedNode('x_nord', 'Porte nord', 160, 20);
  namedNode('x_est', 'Rond-point des affaires', 250, 60);
  namedNode('x_ouest', 'Carrefour des collines', 60, 104);
  namedNode('x_sud', 'Carrefour du vieux port', 110, 212);
  namedNode('x_indus', 'Carrefour des docks', 250, 168);

  {
    const distRoad = new Int16Array(MAP_W * MAP_H).fill(999);
    let frontier: number[] = [];
    for (let i = 0; i < kind.length; i++) if (kind[i] === T.ROAD || kind[i] === T.CROSSWALK) { distRoad[i] = 0; frontier.push(i); }
    for (let d = 1; d <= 12 && frontier.length; d++) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % MAP_W, y = (i / MAP_W) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = x + [1, -1, 0, 0][k], ny = y + [0, 0, 1, -1][k];
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const ni = I(nx, ny);
          if (distRoad[ni] > d) { distRoad[ni] = d; next.push(ni); }
        }
      }
      frontier = next;
    }
    const cand: { tx: number; ty: number; h: number }[] = [];
    for (let y = 12; y < 238; y++) for (let x = 14; x < 316; x++) {
      const i = I(x, y);
      if (m.reach[i] && distRoad[i] >= 5 && kind[i] !== T.SIDEWALK) cand.push({ tx: x, ty: y, h: hash2(x, y, 99) });
    }
    cand.sort((a, b) => a.h - b.h);
    for (const minD of [42, 30, 20]) {
      for (const c of cand) {
        if (m.secrets.length >= 12) break;
        if (m.secrets.every((s) => Math.hypot(s.tx - c.tx, s.ty - c.ty) >= minD)) m.secrets.push({ id: m.secrets.length, tx: c.tx, ty: c.ty });
      }
    }
  }

  m.finalize();
  return m;
}
