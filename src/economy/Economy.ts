import type { World } from '../world/World';
import { VEHICLES } from '../vehicles/specs';
import type { VehicleType } from '../vehicles/specs';

export interface OwnedVehicle { type: VehicleType; color: number; }
export interface Achievement { id: string; name: string; desc: string; test: (e: Economy) => boolean; }

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_drive', name: 'Premier tour de roue', desc: 'Conduire un véhicule.', test: (e) => e.get('drives') >= 1 },
  { id: 'klaxo', name: 'Klaxomane', desc: 'Klaxonner 100 fois.', test: (e) => e.get('honks') >= 100 },
  { id: 'first_mission', name: 'Coursier certifié', desc: 'Terminer une première mission.', test: (e) => e.get('missionsDone') >= 1 },
  { id: 'story_all', name: 'Légende de Klaxo', desc: 'Terminer les trois missions de l’histoire.', test: (e) => e.get('storyDone') >= 3 },
  { id: 'weekly', name: 'À la une', desc: 'Terminer une mission de l’actualité.', test: (e) => e.get('weeklyDone') >= 1 },
  { id: 'evade3', name: 'Insaisissable', desc: 'Semer la police avec trois étoiles ou plus.', test: (e) => e.get('evade3') >= 1 },
  { id: 'busted', name: 'Premier procès-verbal', desc: 'Se faire arrêter. Ça arrive.', test: (e) => e.get('busted') >= 1 },
  { id: 'secrets5', name: 'Fouineur', desc: 'Trouver 5 lieux secrets.', test: (e) => e.get('secrets') >= 5 },
  { id: 'secrets12', name: 'Cartographe', desc: 'Trouver les 12 lieux secrets.', test: (e) => e.get('secrets') >= 12 },
  { id: 'owner', name: 'Propriétaire', desc: 'Acheter un véhicule.', test: (e) => e.owned.length >= 1 },
  { id: 'rich', name: 'Pognon de dingue', desc: 'Posséder 10 000 unités.', test: (e) => e.money >= 10000 },
  { id: 'level5', name: 'Figure du quartier', desc: 'Atteindre le niveau 5.', test: (e) => e.level >= 5 },
  { id: 'events5', name: 'Bon voisin', desc: 'Réussir 5 événements de rue.', test: (e) => e.get('eventsDone') >= 5 },
  { id: 'km10', name: 'Dix bornes', desc: 'Parcourir 10 km au volant.', test: (e) => e.get('distance') >= 62000 },
];

/** XP nécessaire pour passer du niveau n au niveau n+1. */
export const xpForLevel = (n: number) => Math.round(120 * Math.pow(n, 1.35));

/** Argent virtuel, expérience, statistiques, succès, véhicules possédés. Aucune conversion en argent réel. */
export class Economy {
  money = 150;
  xp = 0;
  level = 1;
  stats: Record<string, number> = {};
  achievements = new Set<string>();
  owned: OwnedVehicle[] = [];
  /** Accessoires débloqués (indices dans ACC_NAMES). */
  unlockedAcc = new Set<number>([0]);

  constructor(private w: World) {}

  get(key: string): number { return this.stats[key] ?? 0; }
  stat(key: string, delta: number): void { this.stats[key] = (this.stats[key] ?? 0) + delta; this.checkAchievements(); }
  statMax(key: string, value: number): void { if (value > (this.stats[key] ?? 0)) { this.stats[key] = value; this.checkAchievements(); } }

  price(base: number): number { return Math.max(1, Math.round((base * this.w.mods.priceFactor) / 5) * 5); }
  canPay(amount: number): boolean { return this.money >= amount; }
  add(amount: number, reason?: string): void {
    if (!amount) return;
    this.money = Math.max(0, Math.round(this.money + amount));
    if (amount > 0) this.stats.earned = (this.stats.earned ?? 0) + amount;
    this.w.bus.emit('money', { delta: amount, total: this.money, reason });
    if (amount > 0) this.w.bus.emit('sfx', { name: 'coin' });
    this.checkAchievements();
  }
  pay(amount: number, reason?: string): boolean {
    if (this.money < amount) { this.w.bus.emit('toast', { text: 'Pas assez d’argent.', kind: 'bad' }); this.w.bus.emit('sfx', { name: 'deny' }); return false; }
    this.add(-amount, reason);
    this.stats.spent = (this.stats.spent ?? 0) + amount;
    return true;
  }
  addXp(amount: number): void {
    if (amount <= 0) return;
    this.xp += amount;
    let up = false;
    while (this.xp >= xpForLevel(this.level)) { this.xp -= xpForLevel(this.level); this.level++; up = true; }
    this.w.bus.emit('xp', { delta: amount, level: this.level, levelUp: up });
    if (up) {
      this.w.bus.emit('toast', { text: `Niveau ${this.level} ! Bonus : ${this.level * 100} ¤`, kind: 'good', ttl: 4 });
      this.w.bus.emit('sfx', { name: 'levelup' });
      this.add(this.level * 100, 'niveau');
    }
    this.checkAchievements();
  }
  buyVehicle(type: VehicleType, color: number): boolean {
    const cost = this.price(VEHICLES[type].price);
    if (!this.pay(cost, 'véhicule')) return false;
    this.owned.push({ type, color });
    this.checkAchievements();
    return true;
  }
  checkAchievements(): void {
    for (const a of ACHIEVEMENTS) {
      if (this.achievements.has(a.id) || !a.test(this)) continue;
      this.achievements.add(a.id);
      this.w.bus.emit('achievement', { id: a.id, name: a.name });
      this.w.bus.emit('toast', { text: `Succès : ${a.name}`, kind: 'good', ttl: 4 });
    }
  }
}
