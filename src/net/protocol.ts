/**
 * Format des messages échangés entre joueurs.
 *
 * Règles de sécurité :
 * - tout message reçu est validé ici avant usage ; un message invalide est ignoré ;
 * - aucun texte venant d'un autre joueur n'est jamais affiché : les noms sont fabriqués localement
 *   à partir de l'identifiant réseau, les missions sont désignées par leur identifiant et leur titre
 *   est lu dans les fichiers du jeu ;
 * - aucun message ne déclenche autre chose qu'une mécanique prévue (pas de code, pas de contenu libre).
 */
import { hashStr } from '../engine/rng';
import { WORLD_H, WORLD_W } from '../engine/config';
import { BOTTOMS, HAIRS, SKINS, TOPS } from '../npc/looks';
import type { Look } from '../npc/looks';
import type { VehicleType } from '../vehicles/specs';

export const PROTO = 1;
/** Identifiant de l'application sur le réseau de mise en relation (change si le protocole change). */
export const APP_ID = 'klaxo-ville-2026-p1';
/** Joueurs au maximum par ville (soi compris) : au-delà, le pair-à-pair devient lourd pour un téléphone. */
export const ROOM_CAP = 8;
/** Nombre de villes publiques essayées avant d'abandonner. */
export const MAX_CITIES = 60;
/** Fréquence d'envoi de la position (par seconde). */
export const STATE_HZ = 10;
/** Un joueur silencieux depuis ce délai (ms) est retiré. */
export const PEER_TIMEOUT_MS = 9000;

export type Channel = 'hi' | 'st' | 'hn' | 'co';
export const CHANNELS: Channel[] = ['hi', 'st', 'hn', 'co'];

export const VEHICLE_CODES: VehicleType[] = ['compact', 'sedan', 'sport', 'taxi', 'van', 'truck', 'police'];

/** Présentation envoyée à l'arrivée d'un joueur. */
export interface Hello { v: number; look: Look; joined: number; }
/** Position et état visible d'un joueur. */
export interface PeerState {
  x: number; y: number; a: number;
  /** 0 à pied, 1 en véhicule. */
  mode: 0 | 1;
  vt: VehicleType; vc: number;
  sp: number; wanted: number; moving: boolean;
  /** Session de mission en coopération ('' si aucune). */
  sid: string;
}
export type CoopMsg =
  | { k: 'inv'; sid: string; m: string; s: number }
  | { k: 'join'; sid: string }
  | { k: 'sync'; sid: string; m: string; s: number; c: number[] }
  | { k: 'step'; sid: string; s: number }
  | { k: 'col'; sid: string; s: number; i: number };

const num = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const int = (v: unknown, min: number, max: number): number | null => { const n = num(v, min, max); return n !== null && Number.isInteger(n) ? n : null; };
const SID_RE = /^[a-z0-9]{4,24}$/;
const MISSION_RE = /^[a-z0-9-]{1,64}$/;
const pal = (v: unknown, list: number[]): number | null => (typeof v === 'number' && list.includes(v) ? v : null);

export function encodeState(s: PeerState): (number | string)[] {
  return [Math.round(s.x), Math.round(s.y), Math.round(s.a * 100) / 100, s.mode, VEHICLE_CODES.indexOf(s.vt), s.vc, Math.round(s.sp), s.wanted, s.moving ? 1 : 0, s.sid];
}
export function decodeState(d: unknown): PeerState | null {
  if (!Array.isArray(d) || d.length !== 10) return null;
  const x = num(d[0], 0, WORLD_W), y = num(d[1], 0, WORLD_H), a = num(d[2], -100, 100);
  const mode = int(d[3], 0, 1), vti = int(d[4], -1, VEHICLE_CODES.length - 1), vc = int(d[5], 0, 0xffffff);
  const sp = num(d[6], 0, 2000), wanted = int(d[7], 0, 5), mv = int(d[8], 0, 1);
  const sid = typeof d[9] === 'string' && (d[9] === '' || SID_RE.test(d[9])) ? d[9] : null;
  if (x === null || y === null || a === null || mode === null || vti === null || vc === null || sp === null || wanted === null || mv === null || sid === null) return null;
  if (mode === 1 && vti < 0) return null;
  return { x, y, a, mode: mode as 0 | 1, vt: VEHICLE_CODES[Math.max(0, vti)], vc, sp, wanted, moving: mv === 1, sid };
}

/** Apparence : seules les couleurs des palettes du jeu sont acceptées. */
export function validateLook(l: unknown): Look | null {
  if (!l || typeof l !== 'object') return null;
  const o = l as Record<string, unknown>;
  const skin = pal(o.skin, SKINS), hair = pal(o.hair, HAIRS), top = pal(o.top, TOPS), bottom = pal(o.bottom, BOTTOMS), accColor = pal(o.accColor, TOPS);
  const hairStyle = int(o.hairStyle, 0, 4), acc = int(o.acc, 0, 5);
  if (skin === null || hair === null || top === null || bottom === null || accColor === null || hairStyle === null || acc === null) return null;
  return { skin, hair, hairStyle, top, bottom, acc, accColor };
}
export function decodeHello(d: unknown): Hello | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  if (o.v !== PROTO) return null;
  const look = validateLook(o.look), joined = num(o.joined, 0, 1e13);
  if (!look || joined === null) return null;
  return { v: PROTO, look, joined };
}
export function decodeCoop(d: unknown): CoopMsg | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  if (typeof o.sid !== 'string' || !SID_RE.test(o.sid)) return null;
  const sid = o.sid;
  switch (o.k) {
    case 'inv': { const s = int(o.s, 0, 63); return typeof o.m === 'string' && MISSION_RE.test(o.m) && s !== null ? { k: 'inv', sid, m: o.m, s } : null; }
    case 'join': return { k: 'join', sid };
    case 'sync': {
      const s = int(o.s, 0, 63);
      if (typeof o.m !== 'string' || !MISSION_RE.test(o.m) || s === null || !Array.isArray(o.c) || o.c.length > 64) return null;
      const c = o.c.map((v) => int(v, 0, 63));
      return c.every((v) => v !== null) ? { k: 'sync', sid, m: o.m, s, c: c as number[] } : null;
    }
    case 'step': { const s = int(o.s, 0, 63); return s !== null ? { k: 'step', sid, s } : null; }
    case 'col': { const s = int(o.s, 0, 63), i = int(o.i, 0, 63); return s !== null && i !== null ? { k: 'col', sid, s, i } : null; }
    default: return null;
  }
}

const NAME_A = ['Comète', 'Néon', 'Turbo', 'Pixel', 'Klaxon', 'Bolide', 'Éclair', 'Phare', 'Nitro', 'Scooter', 'Moustique', 'Rétro', 'Boussole', 'Pétard', 'Radar', 'Sirène'];
/** Nom affiché d'un joueur, calculé localement à partir de son identifiant réseau (jamais saisi par un joueur). */
export function autoName(peerId: string): string {
  const h = hashStr('klaxo:' + peerId);
  return `${NAME_A[h % NAME_A.length]} ${10 + ((h >>> 8) % 90)}`;
}
/** Couleur de repère d'un joueur (étiquette, mini-carte). */
export function peerColor(peerId: string): string {
  const cols = ['#22e0ff', '#9dff4a', '#ffb627', '#8a5cff', '#ff8a3d', '#5cf2c4', '#f2f0ff', '#ffd84a'];
  return cols[hashStr('c:' + peerId) % cols.length];
}

/** Code de groupe privé : 5 caractères faciles à dicter (pas de 0/O ni 1/I). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeGroupCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}
export function normalizeGroupCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{4,8}$/.test(s) ? s : null;
}

/**
 * Qui doit quitter une ville trop pleine ? Chacun fait le même calcul avec les mêmes informations :
 * les arrivées les plus récentes partent, de sorte que la ville se stabilise sans arbitre.
 */
export function mustLeave(selfId: string, selfJoined: number, others: { id: string; joined: number }[], cap = ROOM_CAP): boolean {
  if (others.length + 1 <= cap) return false;
  const all = [{ id: selfId, joined: selfJoined }, ...others].sort((a, b) => a.joined - b.joined || (a.id < b.id ? -1 : 1));
  return all.findIndex((p) => p.id === selfId) >= cap;
}

/** Limiteur de débit par joueur et par canal : protège contre les inondations de messages. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private perSecond: Record<Channel, number>, private now: () => number = () => Date.now()) {}
  allow(peer: string, ch: Channel): boolean {
    const key = peer + ':' + ch, t = this.now(), rate = this.perSecond[ch];
    const b = this.buckets.get(key) ?? { tokens: rate, at: t };
    b.tokens = Math.min(rate, b.tokens + ((t - b.at) / 1000) * rate);
    b.at = t;
    if (b.tokens < 1) { this.buckets.set(key, b); return false; }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }
  forget(peer: string): void { for (const k of [...this.buckets.keys()]) if (k.startsWith(peer + ':')) this.buckets.delete(k); }
}
