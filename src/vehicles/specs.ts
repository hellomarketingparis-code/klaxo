/** Catalogue des véhicules : gabarit, comportement, prix. Tout l'équilibrage de la conduite est ici. */
export type VehicleType = 'compact' | 'sedan' | 'sport' | 'taxi' | 'van' | 'truck' | 'police';

export interface VehicleSpec {
  type: VehicleType; name: string;
  len: number; wid: number;
  maxSpeed: number; accel: number; brake: number; reverse: number;
  /** Vitesse de rotation maximale (rad/s). */
  turn: number;
  /** Adhérence latérale : plus c'est bas, plus ça glisse. */
  grip: number;
  mass: number; hp: number; price: number;
  colors: number[];
}

export const VEHICLES: Record<VehicleType, VehicleSpec> = {
  compact: { type: 'compact', name: 'Puce 205', len: 24, wid: 13, maxSpeed: 165, accel: 135, brake: 260, reverse: 60, turn: 3.3, grip: 9, mass: 0.8, hp: 80, price: 1200, colors: [0xe0443a, 0x3aa0e0, 0xe8c63a, 0x5fd08a, 0xd8d8e8, 0xff7ab8] },
  sedan: { type: 'sedan', name: 'Berline Mollo', len: 28, wid: 14, maxSpeed: 185, accel: 130, brake: 260, reverse: 60, turn: 3.0, grip: 9, mass: 1, hp: 100, price: 2800, colors: [0x2b3a67, 0x8a8fa8, 0x7a2a3a, 0x1f6f6f, 0xcfd3e0, 0x3b3b4f] },
  sport: { type: 'sport', name: 'Fulgura GT', len: 28, wid: 14, maxSpeed: 255, accel: 210, brake: 300, reverse: 70, turn: 3.2, grip: 6.2, mass: 0.9, hp: 85, price: 9500, colors: [0xff2e88, 0x22e0ff, 0xffb627, 0x9dff4a, 0x8a5cff, 0xf5f5ff] },
  taxi: { type: 'taxi', name: 'Taxi Tacot', len: 28, wid: 14, maxSpeed: 190, accel: 140, brake: 260, reverse: 60, turn: 3.0, grip: 9, mass: 1, hp: 110, price: 3600, colors: [0xffc21a] },
  van: { type: 'van', name: 'Fourgon Costaud', len: 32, wid: 16, maxSpeed: 155, accel: 105, brake: 230, reverse: 55, turn: 2.6, grip: 9.5, mass: 1.5, hp: 140, price: 3200, colors: [0xe8e8f0, 0x4f6fa8, 0x8a5a3a, 0x5a8a5a] },
  truck: { type: 'truck', name: 'Camion Mastoc', len: 42, wid: 18, maxSpeed: 135, accel: 75, brake: 200, reverse: 45, turn: 2.0, grip: 10, mass: 2.6, hp: 220, price: 5800, colors: [0xc2462f, 0x2f6fc2, 0xd8b23a, 0x6a6a7a] },
  police: { type: 'police', name: 'Patrouille', len: 28, wid: 14, maxSpeed: 232, accel: 200, brake: 300, reverse: 70, turn: 3.2, grip: 8.5, mass: 1.15, hp: 170, price: 0, colors: [0xf0f2ff] },
};
export const CIVIL_TYPES: VehicleType[] = ['compact', 'sedan', 'sport', 'taxi', 'van', 'truck'];
/** Types proposés à l'achat, dans l'ordre du concessionnaire. */
export const SHOP_TYPES: VehicleType[] = ['compact', 'sedan', 'van', 'taxi', 'truck', 'sport'];
