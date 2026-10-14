// Génère les schémas JSON (documentation, validation dans l'éditeur) à partir des listes du moteur.
// La validation qui fait foi dans le jeu reste src/missions/validate.ts ; un test vérifie que les deux concordent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VEHICLES } from '../src/vehicles/specs';
import { CHANGE_TYPES, DECOR_KINDS } from '../src/weekly/WorldModifiers';
import { EVENT_TYPES } from '../src/weekly/RandomEvents';
import { DISTRICT_KEYS } from '../src/map/tiles';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const str = (max: number, min = 1) => ({ type: 'string', minLength: min, maxLength: max, pattern: '^[^<>]*$' });
const num = (min: number, max: number, int = false) => ({ type: int ? 'integer' : 'number', minimum: min, maximum: max });
const id = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{1,59}$' };
const obj = (props: Record<string, any>, required: string[]) => ({ type: 'object', additionalProperties: false, properties: props, required });
const ref = (n: string) => ({ $ref: `#/$defs/${n}` });
const vehicles = { enum: Object.keys(VEHICLES) };
const profiles = { enum: ['passerby', 'employee', 'shopkeeper', 'courier', 'tourist', 'worker', 'robot', 'cop', 'guard'] };
const mode = { enum: ['any', 'foot', 'vehicle'] };

const actions = [
  obj({ do: { const: 'toast' }, text: str(140) }, ['do', 'text']),
  obj({ do: { const: 'say' }, who: str(30), text: str(180) }, ['do', 'who', 'text']),
  obj({ do: { const: 'dialog' }, lines: { type: 'array', maxItems: 6, items: ref('line') } }, ['do', 'lines']),
  obj({ do: { const: 'reveal' }, title: str(60), text: str(260) }, ['do', 'title', 'text']),
  obj({ do: { const: 'spawn_npc' }, tag: id, npc: ref('npc') }, ['do', 'tag', 'npc']),
  obj({ do: { const: 'spawn_vehicle' }, tag: id, vehicle: vehicles, at: ref('loc'), broken: { type: 'boolean' } }, ['do', 'tag', 'vehicle', 'at']),
  obj({ do: { const: 'spawn_guards' }, routes: { type: 'string' } }, ['do', 'routes']),
  obj({ do: { const: 'despawn' }, tag: id }, ['do', 'tag']),
  obj({ do: { const: 'wanted' }, level: num(0, 5, true) }, ['do', 'level']),
  obj({ do: { const: 'sfx' }, name: { enum: ['coin', 'horn', 'alarm', 'tick', 'cuckoo', 'neon', 'start', 'success', 'fail', 'phone', 'robot', 'groan', 'cure'] } }, ['do', 'name']),
  obj({ do: { const: 'world' }, set: { enum: ['traffic', 'pedestrians', 'lights_blink', 'robots'] }, value: num(0, 2), seconds: num(1, 900) }, ['do', 'set', 'value', 'seconds']),
  obj({ do: { const: 'zombies' }, at: ref('loc'), count: num(1, 10, true), spread: num(1, 12, true), aggro: num(3, 40, true) }, ['do', 'at', 'count']),
  obj({ do: { const: 'cure_zombies' } }, ['do']),
];
const base = { objective: str(110), timeLimit: num(10, 900), failIf: { type: 'array', items: { enum: ['detected', 'wanted'] } }, onStart: ref('actions'), onComplete: ref('actions'), checkpoint: { type: 'boolean' },
  events: { type: 'array', maxItems: 8, items: obj({ at: num(0, 900), do: ref('actions') }, ['at', 'do']) } };
const step = (type: string, props: Record<string, any>, required: string[]) => obj({ type: { const: type }, ...base, ...props }, ['type', 'objective', ...required]);
const radius = num(1, 30);
const steps = [
  step('talk', { npc: ref('npc'), tag: id, lines: { type: 'array', maxItems: 10, items: ref('line') } }, ['npc', 'lines']),
  step('goto', { target: ref('loc'), radius, mode }, ['target']),
  step('pickup', { target: ref('loc'), item: ref('item') }, ['target', 'item']),
  step('get_vehicle', { vehicle: vehicles }, []),
  step('deliver', { target: ref('loc'), radius, mode, item: ref('item'), fragile: obj({ max: num(1, 20, true) }, ['max']) }, ['target']),
  step('tail', { vehicle: vehicles, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, route: { type: 'array', minItems: 2, maxItems: 8, items: ref('loc') }, speed: num(30, 140), min: num(20, 120), max: num(120, 400), objectiveFollow: str(110) }, ['vehicle', 'route', 'speed', 'min', 'max']),
  step('observe', { target: ref('loc'), radius, seconds: num(1, 60), mode, label: str(30) }, ['target', 'seconds']),
  step('leave', { target: ref('loc'), radius: num(3, 60) }, ['target', 'radius']),
  step('lose_wanted', {}, []),
  step('collect', { targets: { type: 'array', minItems: 1, maxItems: 10, items: ref('loc') }, item: ref('item'), radius, mode }, ['targets', 'item']),
  step('checkpoints', { targets: { type: 'array', minItems: 2, maxItems: 12, items: ref('loc') }, radius, mode }, ['targets']),
  step('passengers', { fares: { type: 'array', minItems: 1, maxItems: 6, items: obj({ name: str(30), from: ref('loc'), to: ref('loc'), line: str(140), profile: profiles }, ['name', 'from', 'to']) } }, ['fares']),
  step('wait', { seconds: num(1, 120) }, ['seconds']),
];
const date = { type: 'string' };
const mission = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://klaxo.example/schemas/mission.schema.json', title: 'Mission KLAXO',
  description: 'Une mission (histoire, actualité hebdomadaire ou événement de rue). Le moteur ne connaît que les mécaniques listées ici.',
  ...obj({
    schema: { const: 1 }, id, kind: { enum: ['story', 'weekly', 'side'] }, title: str(60), summary: str(220), giver: ref('npc'),
    intro: { type: 'array', maxItems: 10, items: ref('line') }, setup: ref('actions'), steps: { type: 'array', minItems: 1, maxItems: 12, items: { oneOf: steps } },
    outro: { type: 'array', maxItems: 10, items: ref('line') }, punchline: obj({ title: str(60), text: str(260) }, ['title', 'text']),
    reward: obj({ money: num(0, 5000, true), xp: num(0, 1000, true) }, ['money', 'xp']),
    bites: num(1, 9, true),
    requires: obj({ missions: { type: 'array', items: id }, level: num(1, 50, true) }, []),
    news: obj({ headline: str(240), source: str(60), url: { type: 'string', pattern: '^https://[^\\s"\'<>]{4,300}$' }, date: { type: 'string' }, category: str(30) }, ['headline', 'source', 'url', 'date', 'category']),
    publishedAt: { type: 'string' }, expiresAt: { type: 'string' },
  }, ['schema', 'id', 'kind', 'title', 'summary', 'giver', 'intro', 'steps', 'reward']),
  $defs: {
    loc: { oneOf: [obj({ poi: { type: 'string' }, dx: num(-12, 12, true), dy: num(-12, 12, true) }, ['poi']), obj({ x: num(0, 319, true), y: num(0, 239, true) }, ['x', 'y'])] },
    line: obj({ who: str(30), text: str(220) }, ['who', 'text']),
    npc: obj({ name: str(30), profile: profiles, at: ref('loc') }, ['name', 'profile', 'at']),
    item: obj({ id, name: str(40) }, ['id', 'name']),
    actions: { type: 'array', maxItems: 8, items: { oneOf: actions } },
  },
};
const missionFile = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Fichier de missions KLAXO (story.json, weekly.json, archive/*.json)', ...obj({ schema: { const: 1 }, generatedAt: { type: 'string' }, missions: { type: 'array', items: { $ref: 'mission.schema.json' } } }, ['schema', 'missions']) };
const changeIf = (type: string, required: string[]) => ({ if: { properties: { type: { const: type } } }, then: { required } });
const changes = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Changements hebdomadaires de la ville (world/weekly-changes.json)',
  ...obj({ schema: { const: 1 }, generatedAt: { type: 'string' }, changes: { type: 'array', maxItems: 12, items: {
    ...obj({ id: { type: 'string', pattern: '^[a-z0-9_-]{1,40}$' }, type: { enum: [...CHANGE_TYPES] }, label: { type: 'string', maxLength: 120 }, start: date, end: date,
      district: { enum: [...DISTRICT_KEYS] }, factor: num(0.2, 3), share: num(0, 0.6), kind: { enum: [...DECOR_KINDS] }, lines: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 80 } },
      text: { type: 'string', pattern: '^[A-Z0-9 !?+.-]{1,14}$' }, mode: { enum: ['blink', 'normal'] } }, ['id', 'type', 'label', 'start', 'end']),
    allOf: [changeIf('lighting', ['factor']), changeIf('prices', ['factor']), changeIf('traffic', ['factor']), changeIf('pedestrians', ['factor']), changeIf('robots', ['share']), changeIf('decor', ['kind']), changeIf('chatter', ['lines']), changeIf('billboard', ['text']), changeIf('lights_mode', ['mode'])],
  } } }, ['schema', 'changes']),
};
const districtWeights: Record<string, any> = {}; for (const d of DISTRICT_KEYS) districtWeights[d] = { type: 'number', minimum: 0 };
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Table des événements de rue (world/events.json)',
  ...obj({ schema: { const: 1 }, cooldown: { type: 'array', minItems: 2, maxItems: 2, items: num(10, 3600) }, offerSeconds: num(15, 600), events: { type: 'array', maxItems: 40, items:
    obj({ id: { type: 'string', pattern: '^[a-z0-9_-]{1,40}$' }, type: { enum: [...EVENT_TYPES] }, weight: num(0, 100), districts: obj(districtWeights, []), minLevel: num(1, 50, true), reward: num(0, 2000), xp: num(0, 500), enabled: { type: 'boolean' } }, ['id', 'type', 'weight', 'reward', 'xp']) } }, ['schema', 'cooldown', 'offerSeconds', 'events']),
};
fs.mkdirSync(out, { recursive: true });
for (const [name, schema] of Object.entries({ 'mission.schema.json': mission, 'mission-file.schema.json': missionFile, 'weekly-changes.schema.json': changes, 'events.schema.json': events })) {
  fs.writeFileSync(path.join(out, name), JSON.stringify(schema, null, 2) + '\n');
  console.log('écrit', name);
}
