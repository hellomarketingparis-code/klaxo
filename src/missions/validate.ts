import { TILE, MAP_W, MAP_H } from '../engine/config';
import type { CityMap } from '../map/CityMap';
import { VEHICLES } from '../vehicles/specs';
import { ACTION_TYPES, STEP_TYPES, FAIL_CONDS, isPoiLoc } from './schema';
import type { MissionDef, Loc, Step } from './schema';

/**
 * Validation stricte des missions : structure, types, bornes, lieux existants et accessibles,
 * faisabilité des chronomètres. Utilisée par le jeu (au chargement) et par l'outil hebdomadaire.
 * Toute propriété inconnue est refusée : un fichier de mission ne peut rien déclencher d'imprévu.
 */
export interface ValidationResult { ok: boolean; errors: string[]; }

const PROFILES = ['passerby', 'employee', 'shopkeeper', 'courier', 'tourist', 'worker', 'robot', 'cop', 'guard'];
const MODES = ['any', 'foot', 'vehicle'];
const WORLD_SETS = ['traffic', 'pedestrians', 'lights_blink', 'robots'];
const SFX = ['coin', 'horn', 'alarm', 'tick', 'cuckoo', 'neon', 'start', 'success', 'fail', 'phone', 'robot', 'groan', 'cure'];

class Ctx {
  errors: string[] = [];
  constructor(public map: CityMap | null) {}
  err(path: string, msg: string): void { if (this.errors.length < 60) this.errors.push(`${path} : ${msg}`); }
  obj(v: any, path: string, allowed: string[], required: string[]): v is Record<string, any> {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { this.err(path, 'objet attendu'); return false; }
    for (const k of Object.keys(v)) if (!allowed.includes(k)) this.err(`${path}.${k}`, 'propriété inconnue');
    for (const k of required) if (v[k] === undefined) this.err(`${path}.${k}`, 'propriété manquante');
    return true;
  }
  str(v: any, path: string, max: number, min = 1): boolean {
    if (typeof v !== 'string' || v.length < min || v.length > max) { this.err(path, `texte de ${min} à ${max} caractères attendu`); return false; }
    if (/[<>]/.test(v)) { this.err(path, 'caractères < et > interdits'); return false; }
    return true;
  }
  num(v: any, path: string, min: number, max: number, int = false): boolean {
    if (typeof v !== 'number' || !isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) { this.err(path, `nombre${int ? ' entier' : ''} entre ${min} et ${max} attendu`); return false; }
    return true;
  }
  oneOf(v: any, path: string, list: readonly string[]): boolean {
    if (typeof v !== 'string' || !list.includes(v)) { this.err(path, `valeur inconnue (${String(v)})`); return false; }
    return true;
  }
  id(v: any, path: string): boolean {
    if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,59}$/.test(v)) { this.err(path, 'identifiant invalide (minuscules, chiffres, tirets)'); return false; }
    return true;
  }
  loc(v: any, path: string): boolean {
    if (!v || typeof v !== 'object') { this.err(path, 'lieu attendu'); return false; }
    if (typeof v.poi === 'string') {
      if (!this.obj(v, path, ['poi', 'dx', 'dy'], ['poi'])) return false;
      if (v.dx !== undefined) this.num(v.dx, `${path}.dx`, -12, 12, true);
      if (v.dy !== undefined) this.num(v.dy, `${path}.dy`, -12, 12, true);
      if (this.map && !this.map.pois.has(v.poi)) { this.err(path, `lieu inconnu « ${v.poi} »`); return false; }
    } else {
      if (!this.obj(v, path, ['x', 'y'], ['x', 'y'])) return false;
      if (!this.num(v.x, `${path}.x`, 0, MAP_W - 1, true) || !this.num(v.y, `${path}.y`, 0, MAP_H - 1, true)) return false;
    }
    if (this.map) {
      const t = resolveLocTile(this.map, v as Loc);
      if (!this.map.reach[this.map.idx(t.tx, t.ty)]) { this.err(path, 'lieu inaccessible à pied'); return false; }
    }
    return true;
  }
  dialog(v: any, path: string, maxLines = 10): void {
    if (!Array.isArray(v) || v.length > maxLines) { this.err(path, `liste de ${maxLines} répliques maximum attendue`); return; }
    v.forEach((l, i) => { if (this.obj(l, `${path}[${i}]`, ['who', 'text'], ['who', 'text'])) { this.str(l.who, `${path}[${i}].who`, 30); this.str(l.text, `${path}[${i}].text`, 220); } });
  }
  npc(v: any, path: string): void {
    if (!this.obj(v, path, ['name', 'profile', 'at'], ['name', 'profile', 'at'])) return;
    this.str(v.name, `${path}.name`, 30); this.oneOf(v.profile, `${path}.profile`, PROFILES); this.loc(v.at, `${path}.at`);
  }
  item(v: any, path: string): void {
    if (!this.obj(v, path, ['id', 'name'], ['id', 'name'])) return;
    this.id(v.id, `${path}.id`); this.str(v.name, `${path}.name`, 40);
  }
  actions(v: any, path: string): void {
    if (v === undefined) return;
    if (!Array.isArray(v) || v.length > 8) { this.err(path, 'liste de 8 actions maximum attendue'); return; }
    v.forEach((a, i) => this.action(a, `${path}[${i}]`));
  }
  action(a: any, p: string): void {
    if (!a || typeof a !== 'object') return this.err(p, 'action attendue');
    if (!this.oneOf(a.do, `${p}.do`, ACTION_TYPES)) return;
    switch (a.do) {
      case 'toast': if (this.obj(a, p, ['do', 'text'], ['text'])) this.str(a.text, `${p}.text`, 140); break;
      case 'say': if (this.obj(a, p, ['do', 'who', 'text'], ['who', 'text'])) { this.str(a.who, `${p}.who`, 30); this.str(a.text, `${p}.text`, 180); } break;
      case 'dialog': if (this.obj(a, p, ['do', 'lines'], ['lines'])) this.dialog(a.lines, `${p}.lines`, 6); break;
      case 'reveal': if (this.obj(a, p, ['do', 'title', 'text'], ['title', 'text'])) { this.str(a.title, `${p}.title`, 60); this.str(a.text, `${p}.text`, 260); } break;
      case 'spawn_npc': if (this.obj(a, p, ['do', 'tag', 'npc'], ['tag', 'npc'])) { this.id(a.tag, `${p}.tag`); this.npc(a.npc, `${p}.npc`); } break;
      case 'spawn_vehicle': if (this.obj(a, p, ['do', 'tag', 'vehicle', 'at', 'broken'], ['tag', 'vehicle', 'at'])) { this.id(a.tag, `${p}.tag`); this.oneOf(a.vehicle, `${p}.vehicle`, Object.keys(VEHICLES)); this.loc(a.at, `${p}.at`); } break;
      case 'spawn_guards': if (this.obj(a, p, ['do', 'routes'], ['routes'])) { if (this.map && !this.map.guardRoutes[a.routes]) this.err(`${p}.routes`, 'rondes inconnues'); } break;
      case 'despawn': if (this.obj(a, p, ['do', 'tag'], ['tag'])) this.id(a.tag, `${p}.tag`); break;
      case 'wanted': if (this.obj(a, p, ['do', 'level'], ['level'])) this.num(a.level, `${p}.level`, 0, 5, true); break;
      case 'sfx': if (this.obj(a, p, ['do', 'name'], ['name'])) this.oneOf(a.name, `${p}.name`, SFX); break;
      case 'world': if (this.obj(a, p, ['do', 'set', 'value', 'seconds'], ['set', 'value', 'seconds'])) { this.oneOf(a.set, `${p}.set`, WORLD_SETS); this.num(a.value, `${p}.value`, 0, 2); this.num(a.seconds, `${p}.seconds`, 1, 900); } break;
      case 'zombies': if (this.obj(a, p, ['do', 'at', 'count', 'spread', 'aggro'], ['at', 'count'])) {
        this.loc(a.at, `${p}.at`); this.num(a.count, `${p}.count`, 1, 10, true);
        if (a.spread !== undefined) this.num(a.spread, `${p}.spread`, 1, 12, true);
        if (a.aggro !== undefined) this.num(a.aggro, `${p}.aggro`, 3, 40, true);
      } break;
      case 'cure_zombies': this.obj(a, p, ['do'], []); break;
    }
  }
  locs(v: any, path: string, min: number, max: number): void {
    if (!Array.isArray(v) || v.length < min || v.length > max) { this.err(path, `liste de ${min} à ${max} lieux attendue`); return; }
    v.forEach((l, i) => this.loc(l, `${path}[${i}]`));
  }
  step(s: any, p: string): void {
    if (!s || typeof s !== 'object') return this.err(p, 'étape attendue');
    if (!this.oneOf(s.type, `${p}.type`, STEP_TYPES)) return;
    const base = ['type', 'objective', 'timeLimit', 'failIf', 'onStart', 'onComplete', 'events', 'checkpoint'];
    const allow = (extra: string[], req: string[]) => this.obj(s, p, [...base, ...extra], ['objective', ...req]);
    this.str(s.objective, `${p}.objective`, 110);
    if (s.timeLimit !== undefined) this.num(s.timeLimit, `${p}.timeLimit`, 10, 900);
    if (s.checkpoint !== undefined && typeof s.checkpoint !== 'boolean') this.err(`${p}.checkpoint`, 'booléen attendu');
    if (s.failIf !== undefined) { if (!Array.isArray(s.failIf)) this.err(`${p}.failIf`, 'liste attendue'); else s.failIf.forEach((f: any, i: number) => this.oneOf(f, `${p}.failIf[${i}]`, FAIL_CONDS)); }
    this.actions(s.onStart, `${p}.onStart`); this.actions(s.onComplete, `${p}.onComplete`);
    if (s.events !== undefined) {
      if (!Array.isArray(s.events) || s.events.length > 8) this.err(`${p}.events`, 'liste de 8 événements maximum attendue');
      else s.events.forEach((e: any, i: number) => { if (this.obj(e, `${p}.events[${i}]`, ['at', 'do'], ['at', 'do'])) { this.num(e.at, `${p}.events[${i}].at`, 0, 900); this.actions(e.do, `${p}.events[${i}].do`); } });
    }
    const radius = () => { if (s.radius !== undefined) this.num(s.radius, `${p}.radius`, 1, 30); };
    const mode = () => { if (s.mode !== undefined) this.oneOf(s.mode, `${p}.mode`, MODES); };
    switch (s.type) {
      case 'talk': if (allow(['npc', 'tag', 'lines'], ['npc', 'lines'])) { this.npc(s.npc, `${p}.npc`); this.dialog(s.lines, `${p}.lines`); if (s.tag !== undefined) this.id(s.tag, `${p}.tag`); } break;
      case 'goto': if (allow(['target', 'radius', 'mode'], ['target'])) { this.loc(s.target, `${p}.target`); radius(); mode(); } break;
      case 'pickup': if (allow(['target', 'item'], ['target', 'item'])) { this.loc(s.target, `${p}.target`); this.item(s.item, `${p}.item`); } break;
      case 'get_vehicle': if (allow(['vehicle'], [])) { if (s.vehicle !== undefined) this.oneOf(s.vehicle, `${p}.vehicle`, Object.keys(VEHICLES)); } break;
      case 'deliver': if (allow(['target', 'radius', 'mode', 'item', 'fragile'], ['target'])) {
        this.loc(s.target, `${p}.target`); radius(); mode();
        if (s.item !== undefined) this.item(s.item, `${p}.item`);
        if (s.fragile !== undefined && this.obj(s.fragile, `${p}.fragile`, ['max'], ['max'])) this.num(s.fragile.max, `${p}.fragile.max`, 1, 20, true);
      } break;
      case 'tail': if (allow(['vehicle', 'color', 'route', 'speed', 'min', 'max', 'objectiveFollow'], ['vehicle', 'route', 'speed', 'min', 'max'])) {
        this.oneOf(s.vehicle, `${p}.vehicle`, Object.keys(VEHICLES)); this.locs(s.route, `${p}.route`, 2, 8);
        this.num(s.speed, `${p}.speed`, 30, 140); this.num(s.min, `${p}.min`, 20, 120); this.num(s.max, `${p}.max`, 120, 400);
        if (s.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(s.color)) this.err(`${p}.color`, 'couleur #rrggbb attendue');
        if (s.objectiveFollow !== undefined) this.str(s.objectiveFollow, `${p}.objectiveFollow`, 110);
      } break;
      case 'observe': if (allow(['target', 'radius', 'seconds', 'mode', 'label'], ['target', 'seconds'])) { this.loc(s.target, `${p}.target`); radius(); mode(); this.num(s.seconds, `${p}.seconds`, 1, 60); if (s.label !== undefined) this.str(s.label, `${p}.label`, 30); } break;
      case 'leave': if (allow(['target', 'radius'], ['target', 'radius'])) { this.loc(s.target, `${p}.target`); this.num(s.radius, `${p}.radius`, 3, 60); } break;
      case 'lose_wanted': allow([], []); break;
      case 'collect': if (allow(['targets', 'item', 'radius', 'mode'], ['targets', 'item'])) { this.locs(s.targets, `${p}.targets`, 1, 10); this.item(s.item, `${p}.item`); radius(); mode(); } break;
      case 'checkpoints': if (allow(['targets', 'radius', 'mode'], ['targets'])) { this.locs(s.targets, `${p}.targets`, 2, 12); radius(); mode(); } break;
      case 'passengers': if (allow(['fares'], ['fares'])) {
        if (!Array.isArray(s.fares) || s.fares.length < 1 || s.fares.length > 6) this.err(`${p}.fares`, '1 à 6 courses attendues');
        else s.fares.forEach((f: any, i: number) => {
          const fp = `${p}.fares[${i}]`;
          if (!this.obj(f, fp, ['name', 'from', 'to', 'line', 'profile'], ['name', 'from', 'to'])) return;
          this.str(f.name, `${fp}.name`, 30); this.loc(f.from, `${fp}.from`); this.loc(f.to, `${fp}.to`);
          if (f.line !== undefined) this.str(f.line, `${fp}.line`, 140);
          if (f.profile !== undefined) this.oneOf(f.profile, `${fp}.profile`, PROFILES);
        });
      } break;
      case 'wait': if (allow(['seconds'], ['seconds'])) this.num(s.seconds, `${p}.seconds`, 1, 120); break;
    }
  }
}

export function resolveLocTile(map: CityMap, loc: Loc): { tx: number; ty: number } {
  if (isPoiLoc(loc)) {
    const p = map.poi(loc.poi);
    const tx = p.tx + (loc.dx ?? 0), ty = p.ty + (loc.dy ?? 0);
    if (loc.dx || loc.dy) return map.nearestWalkable(Math.max(0, Math.min(MAP_W - 1, tx)), Math.max(0, Math.min(MAP_H - 1, ty)), 6);
    return { tx, ty };
  }
  return { tx: loc.x, ty: loc.y };
}
export function resolveLoc(map: CityMap, loc: Loc): { x: number; y: number } {
  const t = resolveLocTile(map, loc);
  return { x: (t.tx + 0.5) * TILE, y: (t.ty + 0.5) * TILE };
}

/** Principal lieu visé par une étape (pour estimer les trajets). */
function stepTargets(s: Step): Loc[] {
  switch (s.type) {
    case 'goto': case 'pickup': case 'deliver': case 'observe': return [s.target];
    case 'talk': return [s.npc.at];
    case 'collect': case 'checkpoints': return s.targets;
    case 'passengers': return s.fares.flatMap((f) => [f.from, f.to]);
    case 'tail': return [s.route[s.route.length - 1]];
    default: return [];
  }
}

export function validateMission(def: any, map: CityMap | null = null): ValidationResult {
  const c = new Ctx(map);
  const top = ['schema', 'id', 'kind', 'title', 'summary', 'giver', 'intro', 'setup', 'steps', 'outro', 'punchline', 'reward', 'bites', 'requires', 'news', 'publishedAt', 'expiresAt'];
  if (!c.obj(def, 'mission', top, ['schema', 'id', 'kind', 'title', 'summary', 'giver', 'intro', 'steps', 'reward'])) return { ok: false, errors: c.errors };
  if (def.schema !== 1) c.err('mission.schema', 'version de schéma inconnue');
  c.id(def.id, 'mission.id');
  c.oneOf(def.kind, 'mission.kind', ['story', 'weekly', 'side']);
  c.str(def.title, 'mission.title', 60);
  c.str(def.summary, 'mission.summary', 220);
  c.npc(def.giver, 'mission.giver');
  c.dialog(def.intro, 'mission.intro');
  if (def.outro !== undefined) c.dialog(def.outro, 'mission.outro');
  c.actions(def.setup, 'mission.setup');
  if (def.punchline !== undefined && c.obj(def.punchline, 'mission.punchline', ['title', 'text'], ['title', 'text'])) { c.str(def.punchline.title, 'mission.punchline.title', 60); c.str(def.punchline.text, 'mission.punchline.text', 260); }
  if (c.obj(def.reward, 'mission.reward', ['money', 'xp'], ['money', 'xp'])) { c.num(def.reward.money, 'mission.reward.money', 0, 5000, true); c.num(def.reward.xp, 'mission.reward.xp', 0, 1000, true); }
  if (def.bites !== undefined) c.num(def.bites, 'mission.bites', 1, 9, true);
  if (def.requires !== undefined && c.obj(def.requires, 'mission.requires', ['missions', 'level'], [])) {
    if (def.requires.missions !== undefined) { if (!Array.isArray(def.requires.missions)) c.err('mission.requires.missions', 'liste attendue'); else def.requires.missions.forEach((m: any, i: number) => c.id(m, `mission.requires.missions[${i}]`)); }
    if (def.requires.level !== undefined) c.num(def.requires.level, 'mission.requires.level', 1, 50, true);
  }
  if (def.news !== undefined && c.obj(def.news, 'mission.news', ['headline', 'source', 'url', 'date', 'category'], ['headline', 'source', 'url', 'date', 'category'])) {
    c.str(def.news.headline, 'mission.news.headline', 240); c.str(def.news.source, 'mission.news.source', 60); c.str(def.news.category, 'mission.news.category', 30);
    if (typeof def.news.url !== 'string' || !/^https:\/\/[^\s"'<>]{4,300}$/.test(def.news.url)) c.err('mission.news.url', 'URL https attendue');
    if (typeof def.news.date !== 'string' || isNaN(Date.parse(def.news.date))) c.err('mission.news.date', 'date invalide');
  }
  for (const k of ['publishedAt', 'expiresAt']) if (def[k] !== undefined && (typeof def[k] !== 'string' || isNaN(Date.parse(def[k])))) c.err(`mission.${k}`, 'date invalide');
  if (!Array.isArray(def.steps) || def.steps.length < 1 || def.steps.length > 12) c.err('mission.steps', '1 à 12 étapes attendues');
  else def.steps.forEach((s: any, i: number) => c.step(s, `mission.steps[${i}]`));

  // Faisabilité : un chronomètre doit laisser le temps de parcourir la distance (référence : 75 px/s, marge comprise).
  if (map && c.errors.length === 0) {
    let prev = resolveLoc(map, def.giver.at);
    (def as MissionDef).steps.forEach((s, i) => {
      const targets = stepTargets(s);
      let need = 0, cur = prev;
      for (const t of targets) { const p = resolveLoc(map, t); need += Math.abs(p.x - cur.x) + Math.abs(p.y - cur.y); cur = p; }
      if (s.timeLimit !== undefined && targets.length && need / 75 > s.timeLimit) c.err(`mission.steps[${i}].timeLimit`, `chronomètre infaisable (${Math.ceil(need / 75)} s nécessaires au minimum)`);
      if (s.type === 'tail') {
        for (const t of s.route) { const p = resolveLoc(map, t); if (!map.nearestEdge(p.x, p.y, true) || map.nearestEdge(p.x, p.y, true)!.d > 200) c.err(`mission.steps[${i}].route`, 'étape de filature trop loin d’une route'); }
      }
      if (targets.length) prev = cur;
    });
  }
  return { ok: c.errors.length === 0, errors: c.errors };
}
