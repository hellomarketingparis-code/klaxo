import { DISTRICT_KEYS } from '../map/tiles';

/** Types de changements hebdomadaires que le moteur sait appliquer. Liste fermée, validée. */
export const CHANGE_TYPES = ['lighting', 'prices', 'robots', 'traffic', 'pedestrians', 'decor', 'chatter', 'billboard', 'lights_mode'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];
export const DECOR_KINDS = ['garlands', 'banners', 'flags'] as const;

export interface WorldChange {
  id: string; type: ChangeType; label: string;
  start: string; end: string;
  district?: string; factor?: number; share?: number; kind?: string; lines?: string[]; text?: string; mode?: string;
}
export interface WeeklyChangesFile { schema: 1; generatedAt?: string; changes: WorldChange[]; }

export function validateChanges(data: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const E = (m: string) => errors.push(m);
  if (!data || typeof data !== 'object' || data.schema !== 1 || !Array.isArray(data.changes)) return { ok: false, errors: ['structure invalide (schema: 1, changes: [])'] };
  if (data.changes.length > 12) E('trop de changements (12 max)');
  const allowed = new Set(['id', 'type', 'label', 'start', 'end', 'district', 'factor', 'share', 'kind', 'lines', 'text', 'mode']);
  data.changes.forEach((c: any, i: number) => {
    const p = `changes[${i}]`;
    if (!c || typeof c !== 'object') return E(`${p} : objet attendu`);
    for (const k of Object.keys(c)) if (!allowed.has(k)) E(`${p}.${k} : propriété inconnue`);
    if (typeof c.id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(c.id)) E(`${p}.id invalide`);
    if (!CHANGE_TYPES.includes(c.type)) E(`${p}.type inconnu : ${c.type}`);
    if (typeof c.label !== 'string' || c.label.length > 120) E(`${p}.label invalide`);
    if (isNaN(Date.parse(c.start)) || isNaN(Date.parse(c.end))) E(`${p} : dates invalides`);
    else if (Date.parse(c.end) <= Date.parse(c.start)) E(`${p} : fin avant début`);
    if (c.district !== undefined && !(DISTRICT_KEYS as readonly string[]).includes(c.district)) E(`${p}.district inconnu`);
    const num = (k: string, min: number, max: number) => { if (typeof c[k] !== 'number' || c[k] < min || c[k] > max) E(`${p}.${k} doit être entre ${min} et ${max}`); };
    if (c.type === 'lighting') num('factor', 0.2, 1.5);
    if (c.type === 'prices') num('factor', 0.5, 3);
    if (c.type === 'traffic' || c.type === 'pedestrians') num('factor', 0.2, 2);
    if (c.type === 'robots') num('share', 0, 0.6);
    if (c.type === 'decor' && !(DECOR_KINDS as readonly string[]).includes(c.kind)) E(`${p}.kind inconnu`);
    if (c.type === 'chatter' && (!Array.isArray(c.lines) || c.lines.length > 12 || c.lines.some((l: any) => typeof l !== 'string' || l.length > 80))) E(`${p}.lines invalide`);
    if (c.type === 'billboard' && (typeof c.text !== 'string' || !/^[A-Z0-9 !?+.-]{1,14}$/.test(c.text))) E(`${p}.text : 14 caractères max, majuscules sans accents`);
    if (c.type === 'lights_mode' && c.mode !== 'blink' && c.mode !== 'normal') E(`${p}.mode inconnu`);
  });
  return { ok: errors.length === 0, errors };
}

/** État courant des modificateurs du monde (changements hebdomadaires + effets temporaires de mission). */
export class WorldModifiers {
  trafficFactor = 1;
  pedFactor = 1;
  priceFactor = 1;
  robotShare = 0;
  lightsMode: 'normal' | 'blink' = 'normal';
  /** Intensité de l'éclairage par quartier (1 = normal). */
  lighting = [1, 1, 1, 1, 1];
  decor: { kind: string; district: number }[] = [];
  billboard: string | null = null;
  chatter: string[] = [];
  active: WorldChange[] = [];
  private temp: { key: string; value: any; until: number }[] = [];
  private base: Record<string, any> = {};

  /** Applique les changements dont la période contient `now`. */
  apply(file: WeeklyChangesFile | null, now: Date = new Date()): void {
    this.trafficFactor = 1; this.pedFactor = 1; this.priceFactor = 1; this.robotShare = 0; this.lightsMode = 'normal';
    this.lighting = [1, 1, 1, 1, 1]; this.decor = []; this.billboard = null; this.chatter = []; this.active = [];
    if (!file) return;
    const t = now.getTime();
    for (const c of file.changes) {
      if (t < Date.parse(c.start) || t >= Date.parse(c.end)) continue;
      this.active.push(c);
      const di = c.district ? (DISTRICT_KEYS as readonly string[]).indexOf(c.district) : -1;
      switch (c.type) {
        case 'lighting': if (di >= 0) this.lighting[di] = c.factor!; else this.lighting = this.lighting.map(() => c.factor!); break;
        case 'prices': this.priceFactor = c.factor!; break;
        case 'traffic': this.trafficFactor = c.factor!; break;
        case 'pedestrians': this.pedFactor = c.factor!; break;
        case 'robots': this.robotShare = c.share!; break;
        case 'decor': if (di >= 0) this.decor.push({ kind: c.kind!, district: di }); else for (let d = 0; d < 5; d++) this.decor.push({ kind: c.kind!, district: d }); break;
        case 'chatter': this.chatter.push(...(c.lines ?? [])); break;
        case 'billboard': this.billboard = c.text!; break;
        case 'lights_mode': this.lightsMode = c.mode as any; break;
      }
    }
  }
  /** Effet temporaire déclenché par une mission (seuls quelques réglages sont autorisés). */
  setTemp(key: 'trafficFactor' | 'pedFactor' | 'lightsMode' | 'robotShare', value: any, until: number): void {
    if (!(key in this.base)) this.base[key] = (this as any)[key];
    this.temp = this.temp.filter((t) => t.key !== key);
    this.temp.push({ key, value, until });
    (this as any)[key] = value;
  }
  clearTemp(): void {
    for (const k of Object.keys(this.base)) (this as any)[k] = this.base[k];
    this.base = {}; this.temp = [];
  }
  update(time: number): void {
    if (!this.temp.length) return;
    for (const t of this.temp) if (time >= t.until) { (this as any)[t.key] = this.base[t.key]; delete this.base[t.key]; }
    this.temp = this.temp.filter((t) => time < t.until);
  }
}
