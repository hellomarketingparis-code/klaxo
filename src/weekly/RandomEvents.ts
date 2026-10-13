import { TILE } from '../engine/config';
import { dist } from '../engine/math';
import { T, DISTRICT_KEYS } from '../map/tiles';
import type { POI } from '../map/tiles';
import { Vehicle } from '../vehicles/Vehicle';
import type { World } from '../world/World';
import { validateMission } from '../missions/validate';
import type { MissionDef, Loc, Step } from '../missions/schema';

/** Types d'événements de rue que le moteur sait jouer. La table data/world/events.json règle fréquences et récompenses. */
export const EVENT_TYPES = ['breakdown', 'lift', 'courier', 'mystery_car', 'race', 'roadworks', 'lost_item', 'taxi_shift'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export interface EventDef { id: string; type: EventType; weight: number; districts?: Partial<Record<string, number>>; minLevel?: number; reward: number; xp: number; enabled?: boolean; }
export interface EventsFile { schema: 1; cooldown: [number, number]; offerSeconds: number; events: EventDef[]; }

export const DEFAULT_EVENTS: EventsFile = {
  schema: 1, cooldown: [40, 85], offerSeconds: 70,
  events: [
    { id: 'panne', type: 'breakdown', weight: 3, reward: 160, xp: 35 },
    { id: 'coup-de-main', type: 'lift', weight: 3, reward: 130, xp: 30 },
    { id: 'livreur', type: 'courier', weight: 3, districts: { downtown: 1.5, oldtown: 1.5, hills: 0.4 }, reward: 220, xp: 45 },
    { id: 'vehicule-mystere', type: 'mystery_car', weight: 1.5, minLevel: 2, reward: 320, xp: 60 },
    { id: 'course', type: 'race', weight: 2, reward: 280, xp: 55 },
    { id: 'travaux', type: 'roadworks', weight: 1.5, reward: 0, xp: 0 },
    { id: 'objet-perdu', type: 'lost_item', weight: 3, reward: 120, xp: 30 },
    { id: 'taxi', type: 'taxi_shift', weight: 2, districts: { downtown: 1.5, business: 1.5 }, reward: 360, xp: 70 },
  ],
};

export function validateEvents(data: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || data.schema !== 1 || !Array.isArray(data.events) || !Array.isArray(data.cooldown)) return { ok: false, errors: ['structure invalide'] };
  if (data.cooldown.length !== 2 || data.cooldown.some((n: any) => typeof n !== 'number' || n < 10 || n > 3600) || data.cooldown[0] > data.cooldown[1]) errors.push('cooldown invalide');
  if (typeof data.offerSeconds !== 'number' || data.offerSeconds < 15 || data.offerSeconds > 600) errors.push('offerSeconds invalide');
  if (data.events.length > 40) errors.push('trop d’événements');
  data.events.forEach((e: any, i: number) => {
    const p = `events[${i}]`;
    if (!e || typeof e !== 'object') return errors.push(`${p} invalide`);
    for (const k of Object.keys(e)) if (!['id', 'type', 'weight', 'districts', 'minLevel', 'reward', 'xp', 'enabled'].includes(k)) errors.push(`${p}.${k} : propriété inconnue`);
    if (typeof e.id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(e.id)) errors.push(`${p}.id invalide`);
    if (!(EVENT_TYPES as readonly string[]).includes(e.type)) errors.push(`${p}.type inconnu`);
    if (typeof e.weight !== 'number' || e.weight < 0 || e.weight > 100) errors.push(`${p}.weight invalide`);
    if (typeof e.reward !== 'number' || e.reward < 0 || e.reward > 2000) errors.push(`${p}.reward invalide`);
    if (typeof e.xp !== 'number' || e.xp < 0 || e.xp > 500) errors.push(`${p}.xp invalide`);
    if (e.districts) for (const k of Object.keys(e.districts)) if (!(DISTRICT_KEYS as readonly string[]).includes(k) || typeof e.districts[k] !== 'number') errors.push(`${p}.districts.${k} invalide`);
  });
  return { ok: errors.length === 0, errors };
}

const NAMES = ['Josiane', 'Bébert', 'Karim', 'Mireille', 'Dédé', 'Fatou', 'Raymond', 'Lucette', 'Momo', 'Sylvie', 'Jean-Mi', 'Aïcha', 'Gaston', 'Nadia', 'Roger', 'Chantal'];
const LOST = [['perruque', 'Perruque de gala'], ['ticket', 'Ticket gagnant'], ['dentier', 'Dentier de rechange'], ['telephone', 'Téléphone fissuré'], ['doudou', 'Doudou du petit'], ['cle-usb', 'Clé USB « TOP SECRET »']];
const CROSSINGS = ['x_centre', 'x_nord', 'x_est', 'x_ouest', 'x_sud', 'x_indus'];

/** Événements de rue aléatoires, déclenchés de façon contrôlée, jamais pendant une mission. */
export class RandomEvents {
  table: EventsFile = DEFAULT_EVENTS;
  private timer = 30;
  private works: { until: number; items: (Vehicle | { remove: boolean })[] } | null = null;
  enabled = true;
  /** Dernier événement proposé (tests, statistiques). */
  lastType: EventType | null = null;

  constructor(private w: World) {}

  load(data: any): void {
    const r = validateEvents(data);
    this.table = r.ok ? (data as EventsFile) : DEFAULT_EVENTS;
    this.timer = this.w.rng.range(18, 32);
  }

  update(dt: number): void {
    const w = this.w;
    if (this.works && w.time > this.works.until && this.works.items.every((it) => !(it instanceof Vehicle) || !w.inView(it.x, it.y, 40))) {
      for (const it of this.works.items) it.remove = true;
      this.works = null;
    }
    if (!this.enabled || w.attract || w.missions.active || w.wanted.level > 0) return;
    this.timer -= dt;
    if (this.timer > 0 || w.missions.sideMarker) return;
    this.timer = w.rng.range(this.table.cooldown[0], this.table.cooldown[1]);
    this.trigger();
  }

  /** Tire un événement selon le quartier et le niveau du joueur. */
  trigger(force?: EventType): boolean {
    const w = this.w;
    const dkey = DISTRICT_KEYS[w.map.districtAtPx(w.player.px, w.player.py)];
    const pool = this.table.events.filter((e) => e.enabled !== false && (force ? e.type === force : true) && (e.minLevel ?? 1) <= w.economy.level);
    if (!pool.length) return false;
    const ev = w.rng.weighted(pool, (e) => e.weight * (e.districts?.[dkey] ?? 1));
    this.lastType = ev.type;
    if (ev.type === 'roadworks') return this.roadworks();
    const spot = this.findSpot();
    if (!spot) return false;
    const def = this.build(ev, spot);
    if (!def) return false;
    const check = validateMission(def, w.map);
    if (!check.ok) { console.warn('[événement] définition invalide', check.errors); return false; }
    const ped = w.pedSys.spawnStatic((spot.x + 0.5) * TILE, (spot.y + 0.5) * TILE, def.giver.profile, undefined, 'side-offer', def.giver.name);
    w.missions.offerSide(def, ped, this.table.offerSeconds);
    w.bus.emit('toast', { text: 'Quelqu’un a besoin d’un coup de main dans le coin (point jaune sur la carte).', kind: 'info', ttl: 4.5 });
    w.bus.emit('sfx', { name: 'phone' });
    return true;
  }

  /** Tuile de trottoir proche du joueur, hors de l'écran si possible. */
  private findSpot(): { x: number; y: number } | null {
    const w = this.w, m = w.map, p = w.player;
    let fallback: { x: number; y: number } | null = null;
    for (let t = 0; t < 60; t++) {
      const a = w.rng.range(0, Math.PI * 2), r = w.rng.range(110, 260);
      const tx = Math.floor((p.px + Math.cos(a) * r) / TILE), ty = Math.floor((p.py + Math.sin(a) * r) / TILE);
      if (!m.inb(tx, ty) || m.kind[m.idx(tx, ty)] !== T.SIDEWALK || !m.reach[m.idx(tx, ty)]) continue;
      if (!w.inView((tx + 0.5) * TILE, (ty + 0.5) * TILE, 10)) return { x: tx, y: ty };
      fallback = fallback ?? { x: tx, y: ty };
    }
    return fallback;
  }
  private farPoi(from: { x: number; y: number }, min: number, max: number, filter?: (p: POI) => boolean): POI {
    const w = this.w;
    const all = [...w.map.pois.values()].filter((p) => p.building !== undefined && (!filter || filter(p)));
    const ok = all.filter((p) => { const d = Math.hypot(p.tx - from.x, p.ty - from.y); return d >= min && d <= max; });
    return w.rng.pick(ok.length ? ok : all);
  }

  private build(ev: EventDef, spot: { x: number; y: number }): MissionDef | null {
    const w = this.w, rng = w.rng, m = w.map;
    const name = rng.pick(NAMES);
    const here: Loc = { x: spot.x, y: spot.y };
    const base = (title: string, summary: string, profile: MissionDef['giver']['profile'], intro: string[], steps: Step[], extra: Partial<MissionDef> = {}): MissionDef => ({
      schema: 1, id: `side-${ev.id}-${Math.floor(w.time)}`, kind: 'side', title, summary,
      giver: { name, profile, at: here },
      intro: intro.map((text, i) => ({ who: i % 2 === 0 ? 'giver' : 'player', text })),
      steps, reward: { money: ev.reward, xp: ev.xp }, ...extra,
    });
    switch (ev.type) {
      case 'breakdown': {
        const garage = [m.poi('garage_old'), m.poi('garage_ind')].sort((a, b) => Math.hypot(a.tx - spot.x, a.ty - spot.y) - Math.hypot(b.tx - spot.x, b.ty - spot.y))[0];
        return base('La panne', `${name} est en rade. Direction le garage.`, 'passerby',
          ['Ma voiture a rendu l’âme. Elle a fait « pouf », puis plus rien.', 'Montez, je vous dépose au garage.'],
          [{ type: 'passengers', objective: `Conduis ${name} au garage`, fares: [{ name, from: here, to: { poi: garage.id }, line: 'Au garage. Et pas un mot sur mon embrayage.' }] }],
          { setup: [{ do: 'spawn_vehicle', tag: 'epave', vehicle: 'compact', at: here, broken: true }] });
      }
      case 'lift': {
        const dest = this.farPoi(spot, 35, 150);
        return base('Le retardataire', `${name} est très en retard. Destination : ${dest.name}.`, 'employee',
          [`Je suis en retard de quarante minutes. Vous allez vers « ${dest.name} » ?`, 'Maintenant, oui.'],
          [{ type: 'passengers', objective: `Dépose ${name} : ${dest.name}`, timeLimit: 120, fares: [{ name, from: here, to: { poi: dest.id }, profile: 'employee', line: 'Roulez ! Mon chef compte les minutes. Et les secondes.' }] }]);
      }
      case 'courier': {
        const dest = this.farPoi(spot, 30, 130);
        const d = (Math.abs(dest.tx - spot.x) + Math.abs(dest.ty - spot.y)) * TILE;
        return base('Livreur d’un soir', `Une commande urgente pour « ${dest.name} ».`, 'shopkeeper',
          ['Mon livreur a démissionné par texto. Avec un émoji.', 'Je prends la commande. Où ça ?', `« ${dest.name} ». C’est chaud, c’est pressé, et c’est payé.`],
          [
            { type: 'pickup', objective: 'Prends la commande', target: here, item: { id: 'commande', name: 'Commande encore tiède' } },
            { type: 'deliver', objective: `Livre la commande : ${dest.name}`, target: { poi: dest.id }, timeLimit: Math.round(d / 55 + 35), item: { id: 'commande', name: 'Commande encore tiède' } },
          ]);
      }
      case 'mystery_car': {
        const order = rng.shuffle([...CROSSINGS]).slice(0, 3);
        const first = m.poi(order[0]);
        return base('La camionnette verte', 'Un inconnu te demande de suivre un véhicule étrange.', 'passerby',
          ['Psst. La camionnette verte. Elle passe tous les soirs. Personne ne sait pourquoi.', 'Et vous voulez que je la suive.', 'Je veux surtout dormir tranquille.'],
          [
            { type: 'get_vehicle', objective: 'Trouve un véhicule' },
            { type: 'tail', objective: `Repère la camionnette verte : ${first.name}`, objectiveFollow: 'Suis la camionnette sans te faire remarquer', vehicle: 'van', color: '#3fbf5a', route: order.map((poi) => ({ poi })), speed: 66, min: 46, max: 210 },
          ],
          { punchline: { title: 'Mystère résolu', text: 'La camionnette livre des croissants chauds au commissariat. Tous les soirs. Depuis 1997. Affaire classée, et tout le monde a faim.' } });
      }
      case 'race': {
        const order = [...CROSSINGS].sort((a, b) => Math.hypot(m.poi(a).tx - spot.x, m.poi(a).ty - spot.y) - Math.hypot(m.poi(b).tx - spot.x, m.poi(b).ty - spot.y)).slice(0, 4);
        let len = 0, cx = spot.x, cy = spot.y;
        for (const id of order) { const p = m.poi(id); len += (Math.abs(p.tx - cx) + Math.abs(p.ty - cy)) * TILE; cx = p.tx; cy = p.ty; }
        return base('Course improvisée', 'Quatre carrefours, un chrono, zéro règle.', 'courier',
          ['Toi, t’as une tête à aimer la vitesse. Quatre carrefours, contre la montre ?', 'J’ai une tête à quoi ?'],
          [
            { type: 'get_vehicle', objective: 'Trouve un véhicule' },
            { type: 'checkpoints', objective: 'Franchis les carrefours dans l’ordre', mode: 'vehicle', radius: 4, timeLimit: Math.round(len / 62 + 20), targets: order.map((poi) => ({ poi })) },
          ]);
      }
      case 'lost_item': {
        const [id, label] = rng.pick(LOST);
        let target: { x: number; y: number } | null = null;
        for (let t = 0; t < 80 && !target; t++) {
          const tx = spot.x + rng.int(-16, 16), ty = spot.y + rng.int(-16, 16);
          if (m.inb(tx, ty) && m.reach[m.idx(tx, ty)] && !m.isRoadKind(m.kind[m.idx(tx, ty)]) && Math.hypot(tx - spot.x, ty - spot.y) > 7) target = { x: tx, y: ty };
        }
        if (!target) return null;
        return base('Objet perdu', `${name} a perdu quelque chose dans le quartier.`, 'tourist',
          [`J’ai perdu mon bien le plus précieux : ${label.toLowerCase()}. C’est tombé par là. Ou par là.`, 'Très précis. Je regarde.'],
          [
            { type: 'collect', objective: `Retrouve : ${label}`, targets: [target], item: { id, name: label } },
            { type: 'talk', objective: `Rapporte l’objet à ${name}`, npc: { name, profile: 'tourist', at: here }, lines: [{ who: 'npc', text: 'Vous l’avez ! Ne me demandez pas pourquoi j’y tiens.' }, { who: 'player', text: 'Je n’allais pas demander.' }] },
          ]);
      }
      case 'taxi_shift': {
        const fares = [0, 1, 2].map((i) => {
          const from = this.farPoi(spot, 10, 90), to = this.farPoi({ x: from.tx, y: from.ty }, 30, 140);
          return { name: NAMES[(NAMES.indexOf(name) + i + 1) % NAMES.length], from: { poi: from.id }, to: { poi: to.id }, line: rng.pick(['Vous prenez la carte ? Non ? Tant pis, roulez.', 'Suivez cette voiture ! Non, je plaisante.', 'Par le chemin le plus long, j’ai un podcast à finir.', 'Vous, vous n’êtes pas le chauffeur habituel.']) };
        });
        return base('Taxi de remplacement', 'Trois courses à assurer pendant que le chauffeur est chez le dentiste.', 'passerby',
          ['J’ai une rage de dents et trois clients. Tu prends le taxi, je prends le dentiste.', 'Marché conclu.'],
          [
            { type: 'get_vehicle', objective: 'Monte dans le taxi', vehicle: 'taxi' },
            { type: 'passengers', objective: 'Assure les trois courses', fares },
          ],
          { setup: [{ do: 'spawn_vehicle', tag: 'taxi', vehicle: 'taxi', at: here }] });
      }
      default: return null;
    }
  }

  /** Travaux : une rue voisine est barrée pendant une minute environ. */
  private roadworks(): boolean {
    const w = this.w, m = w.map, p = w.player;
    if (this.works) return false;
    const cands = m.edges.filter((e) => {
      if (e.type !== 'street' || e.length < 120) return false;
      const mx = (e.x + e.wT / 2) * TILE, my = (e.y + e.hT / 2) * TILE;
      const d = dist(mx, my, p.px, p.py);
      return d >= 240 && d <= 560 && !w.inView(mx, my, 60);
    });
    if (cands.length) {
      const e = w.rng.pick(cands);
      const mx = (e.x + e.wT / 2) * TILE, my = (e.y + e.hT / 2) * TILE;
      const items: (Vehicle | { remove: boolean })[] = [];
      const truck = new Vehicle('truck', mx, my, e.vertical ? 0 : Math.PI / 2, 0xffb627);
      truck.handbrake = true; truck.tag = 'works'; truck.smoke = 0;
      w.vehicles.push(truck); items.push(truck);
      for (const s of [-1, 1]) {
        const worker = w.pedSys.spawnStatic(mx + (e.vertical ? s * 30 : 12), my + (e.vertical ? 12 : s * 30), 'worker', undefined, 'works', 'Ouvrier');
        items.push(worker);
      }
      this.works = { until: w.time + w.rng.range(55, 90), items };
      w.bus.emit('toast', { text: 'Info trafic : une rue du quartier est barrée pour travaux.', kind: 'news', ttl: 4 });
      return true;
    }
    return false;
  }
}
