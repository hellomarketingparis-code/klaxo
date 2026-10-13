/** Constantes globales du moteur. Tout ce qui dimensionne le monde est ici. */
export const TILE = 16;
export const MAP_W = 320;
export const MAP_H = 240;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;
export const CHUNK_TILES = 32;
export const CHUNK_PX = CHUNK_TILES * TILE;
export const CHUNKS_X = Math.ceil(MAP_W / CHUNK_TILES);
export const CHUNKS_Y = Math.ceil(MAP_H / CHUNK_TILES);
/** Graine fixe : la ville est identique pour tous les joueurs et pour l'outil de génération hebdomadaire. */
export const WORLD_SEED = 0x4b4c4158; // "KLAX"
export const GAME_VERSION = '0.2.0';
export const SAVE_VERSION = 1;
/** Pas de simulation maximal (s). Au-delà, la frame est découpée. */
export const MAX_DT = 1 / 30;

export type Quality = 'low' | 'medium' | 'high';
export interface QualityProfile { peds: number; cars: number; glows: boolean; particles: boolean; reflections: boolean; }
export const QUALITY: Record<Quality, QualityProfile> = {
  low: { peds: 0.55, cars: 0.6, glows: false, particles: false, reflections: false },
  medium: { peds: 0.8, cars: 0.85, glows: true, particles: true, reflections: true },
  high: { peds: 1, cars: 1, glows: true, particles: true, reflections: true },
};
