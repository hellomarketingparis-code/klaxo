/** Types de tuiles, quartiers et structures de données de la ville. */
export const T = {
  GRASS: 0, ROAD: 1, SIDEWALK: 2, CROSSWALK: 3, BUILDING: 4, WATER: 5, PLAZA: 6, PARKING: 7,
  YARD: 8, PATH: 9, FENCE: 10, DOCK: 11, TREE: 12, FOREST: 13, GARDEN: 14, SAND: 15, PROP: 16,
} as const;

const solidKinds: number[] = [T.BUILDING, T.WATER, T.FENCE, T.TREE, T.FOREST, T.PROP];
export const SOLID: boolean[] = [];
for (let i = 0; i < 32; i++) SOLID[i] = solidKinds.includes(i);

export const D = { HILLS: 0, BUSINESS: 1, DOWNTOWN: 2, OLDTOWN: 3, INDUSTRIAL: 4 } as const;
export const DISTRICT_NAMES = ['Residential Hills', 'Business District', 'Downtown', 'Old Town', 'Industrial Zone'];
export const DISTRICT_KEYS = ['hills', 'business', 'downtown', 'oldtown', 'industrial'] as const;
export type DistrictKey = (typeof DISTRICT_KEYS)[number];

export type RoadType = 'avenue' | 'street' | 'alley';

export interface RoadNode {
  id: number;
  /** Centre en pixels. */
  cx: number; cy: number;
  /** Boîte du carrefour en tuiles. */
  bx: number; by: number; bw: number; bh: number;
  /** Arêtes par bras : 0=N, 1=E, 2=S, 3=O (-1 si absent). */
  arms: [number, number, number, number];
  deg: number;
  signal: boolean;
  phase: number;
  district: number;
}

export interface RoadEdge {
  id: number;
  /** a = nœud nord (vertical) ou ouest (horizontal) ; b = sud ou est. */
  a: number; b: number;
  vertical: boolean;
  type: RoadType;
  /** Largeur de chaussée en tuiles. */
  w: number;
  /** Rectangle de chaussée entre les deux carrefours, en tuiles. */
  x: number; y: number; wT: number; hT: number;
  /** Voies par sens. */
  lanes: number;
  /** Ouverte à la circulation automatique. */
  traffic: boolean;
  length: number;
}

export type LotUse = 'building' | 'parking' | 'park' | 'plaza' | 'yard' | 'house' | 'special' | 'filler';
export interface Lot { id: number; x: number; y: number; w: number; h: number; district: number; use: LotUse; frontS: boolean; }

export type BuildingKind = 'tower' | 'shop' | 'house' | 'warehouse' | 'block' | 'civic';
export interface Building {
  id: number; x: number; y: number; w: number; h: number;
  district: number; kind: BuildingKind; seed: number;
  /** Nombre de rangées de façade visibles côté sud. */
  facade: number;
  doorX: number;
  sign?: { text: string; color: number };
  poi?: string;
}

export interface POI {
  id: string; type: string; name: string; district: number;
  /** Tuile piétonne devant l'entrée. */
  tx: number; ty: number;
  building?: number;
  /** Rectangle du terrain (pour les zones). */
  rect?: { x: number; y: number; w: number; h: number };
}

export interface Lamp { x: number; y: number; }
export interface TreeProp { x: number; y: number; variant: number; }
export interface ParkSpot { x: number; y: number; angle: number; filled: boolean; kind?: string; }
export interface SecretSpot { id: number; tx: number; ty: number; }
export interface Prop { x: number; y: number; w: number; h: number; kind: 'container' | 'fountain' | 'stall' | 'crate' | 'bench'; seed: number; }

export interface GuardRoute { points: { tx: number; ty: number }[]; loop: boolean; }
