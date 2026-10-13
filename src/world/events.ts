/** Événements émis par la simulation vers l'affichage, l'audio et l'interface. */
export interface WorldEvents {
  sfx: { name: string; x?: number; y?: number; vol?: number };
  bubble: { id: number; x: number; y: number; text: string; ttl?: number };
  toast: { text: string; kind?: 'info' | 'good' | 'bad' | 'news'; ttl?: number };
  crash: { x: number; y: number; force: number };
  spark: { x: number; y: number; n: number };
  smoke: { x: number; y: number };
  flash: { x: number; y: number };
  wanted: { level: number; prev: number };
  busted: { fine: number };
  money: { delta: number; total: number; reason?: string };
  xp: { delta: number; level: number; levelUp: boolean };
  district: { id: number };
  dialog: { lines: DialogLine[]; onDone?: () => void };
  reveal: { title: string; text: string; onDone?: () => void };
  card: { title: string; subtitle?: string; kind: 'start' | 'success' | 'fail' | 'info' };
  objective: { text: string | null };
  save: { reason: string };
  shop: { poi: string };
  achievement: { id: string; name: string };
  secret: { found: number; total: number };
  playerVehicle: { entered: boolean };
}
export interface DialogLine { who: string; text: string; look?: string; }
