import { RNG } from '../engine/rng';

/** Apparence d'un personnage vu du dessus. Sert au joueur comme aux habitants. */
export interface Look {
  skin: number; hair: number; hairStyle: number; // 0 court, 1 long, 2 chauve, 3 crête, 4 chignon
  top: number; bottom: number;
  /** 0 aucun, 1 casquette, 2 chapeau, 3 sac à dos, 4 lunettes, 5 casque, 6 képi */
  acc: number; accColor: number;
  robot?: boolean;
}

export const SKINS = [0xf6d3b3, 0xe8b88a, 0xc98d5e, 0x9c6a43, 0x6f4526, 0x4a2c17];
export const HAIRS = [0x1c1b22, 0x4a3020, 0x8a5a2b, 0xd9b45a, 0xb8442f, 0xcfd3e0, 0xff5fb0, 0x35d0c0];
export const TOPS = [0xff2e88, 0x22e0ff, 0xffb627, 0x9dff4a, 0x8a5cff, 0xf5f5ff, 0x2b3a67, 0xe0443a, 0x2e2e3a, 0x4fa36b, 0xe8853a, 0x7a8aa8];
export const BOTTOMS = [0x1f2233, 0x3b4a7a, 0x4a3a2a, 0x2a2a2a, 0x6a6a7a, 0x7a2a3a, 0x284a3a];
export const ACC_NAMES = ['Aucun', 'Casquette', 'Chapeau', 'Sac à dos', 'Lunettes', 'Casque audio'];
export const HAIR_NAMES = ['Court', 'Long', 'Chauve', 'Crête', 'Chignon'];

export const DEFAULT_LOOK: Look = { skin: SKINS[1], hair: HAIRS[0], hairStyle: 0, top: TOPS[0], bottom: BOTTOMS[0], acc: 0, accColor: TOPS[1] };

export type ProfileKey = 'passerby' | 'employee' | 'shopkeeper' | 'courier' | 'tourist' | 'worker' | 'robot' | 'cop' | 'guard';

export function randomLook(profile: ProfileKey, rng: RNG): Look {
  const base: Look = {
    skin: rng.pick(SKINS), hair: rng.pick(HAIRS.slice(0, 6)), hairStyle: rng.weighted([0, 1, 2, 3, 4], (s) => [5, 4, 1.2, 0.6, 1.5][s]),
    top: rng.pick(TOPS), bottom: rng.pick(BOTTOMS), acc: rng.chance(0.25) ? rng.pick([1, 2, 4, 5]) : 0, accColor: rng.pick(TOPS),
  };
  switch (profile) {
    case 'employee': base.top = rng.pick([0x2b3a67, 0x2e2e3a, 0x7a8aa8, 0xf5f5ff]); base.bottom = rng.pick([0x1f2233, 0x2a2a2a]); base.acc = rng.chance(0.2) ? 4 : 0; break;
    case 'shopkeeper': base.top = 0xf5f5ff; base.bottom = 0x4a3a2a; base.acc = 0; break;
    case 'courier': base.top = rng.pick([0x9dff4a, 0xffb627, 0x22e0ff]); base.acc = 3; base.accColor = rng.pick([0xff2e88, 0x2e2e3a, 0x22e0ff]); break;
    case 'tourist': base.top = rng.pick([0xff2e88, 0xffb627, 0x9dff4a, 0xe8853a]); base.acc = rng.pick([1, 2, 2]); base.accColor = rng.pick([0xf5f5ff, 0xe8c63a]); break;
    case 'worker': base.top = 0xffb627; base.bottom = 0x3b4a7a; base.acc = 5; base.accColor = 0xffe14a; break;
    case 'robot': return { skin: 0xb8c4d8, hair: 0x22e0ff, hairStyle: 2, top: 0x8f9bb5, bottom: 0x5a6680, acc: 0, accColor: 0x22e0ff, robot: true };
    case 'cop': base.top = 0x2740a8; base.bottom = 0x16204a; base.acc = 6; base.accColor = 0x16204a; base.hairStyle = 0; break;
    case 'guard': base.top = 0x3a3a48; base.bottom = 0x1c1c26; base.acc = 1; base.accColor = 0xe0443a; break;
    default: break;
  }
  return base;
}
export function lookKey(l: Look): string {
  return `ped_${l.skin.toString(16)}_${l.hair.toString(16)}_${l.hairStyle}_${l.top.toString(16)}_${l.bottom.toString(16)}_${l.acc}_${l.accColor.toString(16)}${l.robot ? '_r' : ''}`;
}
