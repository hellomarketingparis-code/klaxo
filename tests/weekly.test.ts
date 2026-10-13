import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020';
import { city, readJson } from './helpers';
import { RNG } from '../src/engine/rng';
import { validateMission } from '../src/missions/validate';
import { validateChanges, WorldModifiers } from '../src/weekly/WorldModifiers';
import { validateEvents } from '../src/weekly/RandomEvents';
import { parseFeed, classify, pickTopic, isoWeek } from '../tools/weekly/generate';
import { buildWeekly, reserveMission, KEYWORDS } from '../tools/weekly/templates';
import type { Category } from '../tools/weekly/templates';

const root = path.join(__dirname, '..');
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'rss', name), 'utf8');
const schema = (name: string) => JSON.parse(fs.readFileSync(path.join(root, 'schemas', name), 'utf8'));
const news = { headline: 'Titre de test', source: 'Source de test', url: 'https://example.org/a', date: '2026-10-08T00:00:00.000Z', category: 'ai' };

describe('lecture des flux d’actualité', () => {
  it('lit RSS et Atom, ignore les liens non sécurisés', () => {
    const a = parseFeed(fixture('journal-alpha.xml'), 'Alpha');
    expect(a.length).toBe(4);
    expect(a[0].title).toContain('panne informatique');
    expect(a[0].link).toBe('https://example.org/alpha/panne');
    const b = parseFeed(fixture('gazette-beta.xml'), 'Beta');
    expect(b.length).toBe(2);
    expect(b[0].date.toISOString()).toBe('2026-10-08T09:30:00.000Z');
    expect(parseFeed(fixture('courrier-gamma.xml'), 'Gamma')[1].title).toContain("d'un milliard");
    expect(parseFeed('pas du xml', 'X')).toEqual([]);
  });
  it('classe les titres et écarte les tragédies', () => {
    expect(classify('Une panne informatique paralyse les caisses')).toBe('outage');
    expect(classify('Le festival de cinéma ouvre ses portes')).toBe('culture');
    expect(classify('La fusée décolle vers la Lune')).toBe('space');
    expect(classify('Un séisme fait des victimes')).toBeNull();
    expect(classify('Robot attack kills three')).toBeNull();
    expect(classify('Recette de la tarte aux pommes')).toBeNull();
  });
  it('préfère un fait recoupé par plusieurs sources', () => {
    const items = [...parseFeed(fixture('journal-alpha.xml'), 'Alpha'), ...parseFeed(fixture('gazette-beta.xml'), 'Beta'), ...parseFeed(fixture('courrier-gamma.xml'), 'Gamma')];
    const pick = pickTopic(items, [], 1)!;
    expect(pick.category).toBe('outage');
    expect(pick.corroborated).toBe(2);
    // La variété prime : si la catégorie vient d'être utilisée, un autre sujet peut passer devant.
    expect(pickTopic(items.filter((i) => !/panne/.test(i.title)), [], 1)!.category).not.toBe('outage');
    expect(pickTopic([], [], 1)).toBeNull();
  });
  it('calcule la semaine ISO', () => {
    const w = isoWeek(new Date('2026-10-11T12:00:00Z'));
    expect(w.id).toBe('2026-W41');
    expect(w.start.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(isoWeek(new Date('2027-01-01T12:00:00Z')).id).toBe('2026-W53');
  });
});

describe('modèles de missions d’actualité', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validMission = ajv.compile(schema('mission.schema.json'));
  const validChanges = ajv.compile(schema('weekly-changes.schema.json'));
  const cats = [...Object.keys(KEYWORDS), 'generic'] as Category[];
  for (const cat of cats) {
    it(`catégorie « ${cat} » : mission jouable et changements valides`, () => {
      for (let week = 1; week <= 4; week++) {
        const out = buildWeekly(cat, { ...news, category: cat }, `2026-W${40 + week}`, new Date('2026-10-05T00:00:00Z'), new Date('2026-10-13T00:00:00Z'), new RNG(week * 77), city());
        const r = validateMission(out.mission, city());
        expect(r.errors, `${cat} semaine ${week}`).toEqual([]);
        expect(out.mission.kind).toBe('weekly');
        expect(validChanges({ schema: 1, changes: out.changes }), JSON.stringify(validChanges.errors)).toBe(true);
        expect(validateChanges({ schema: 1, changes: out.changes }).errors).toEqual([]);
        expect(validMission(out.mission), JSON.stringify(validMission.errors?.slice(0, 2))).toBe(true);
        // Chaque étape a un objectif, et la mission repose sur de vraies mécaniques, pas seulement « aller à un point ».
        expect(out.mission.steps.some((s) => s.type !== 'goto')).toBe(true);
      }
    });
  }
  it('mission de réserve valide, sans actualité', () => {
    const m = reserveMission('weekly-reserve', undefined, '2026-10-05T00:00:00Z', '2026-10-13T00:00:00Z');
    expect(validateMission(m, city()).errors).toEqual([]);
    expect(m.news).toBeUndefined();
  });
  it('les fichiers publiés respectent les schémas JSON', () => {
    for (const def of readJson('missions/story.json').missions) expect(validMission(def), `${def.id} ${JSON.stringify(validMission.errors?.slice(0, 2))}`).toBe(true);
    for (const def of readJson('missions/weekly.json').missions) { expect(validMission(def), JSON.stringify(validMission.errors?.slice(0, 2))).toBe(true); if (def.news) expect(def.news.url).toMatch(/^https:\/\//); } // la mission de réserve n'a pas de source
    expect(validChanges(readJson('world/weekly-changes.json'))).toBe(true);
    expect(ajv.compile(schema('events.schema.json'))(readJson('world/events.json'))).toBe(true);
    expect(validateEvents(readJson('world/events.json')).errors).toEqual([]);
  });
});

describe('validation stricte des missions', () => {
  const good = () => JSON.parse(JSON.stringify(readJson('missions/story.json').missions[0]));
  const errs = (mut: (m: any) => void) => { const m = good(); mut(m); return validateMission(m, city()).errors.join(' | '); };
  it('accepte la mission d’origine', () => expect(validateMission(good(), city()).ok).toBe(true));
  it('refuse une mécanique inconnue', () => expect(errs((m) => (m.steps[0].type = 'run_script'))).toMatch(/valeur inconnue/));
  it('refuse toute propriété inconnue (pas de code dans les données)', () => {
    expect(errs((m) => (m.steps[0].script = 'alert(1)'))).toMatch(/propriété inconnue/);
    expect(errs((m) => (m.onLoad = 'x'))).toMatch(/propriété inconnue/);
    expect(errs((m) => m.steps[0].onComplete.push({ do: 'eval', code: 'x' }))).toMatch(/valeur inconnue/);
  });
  it('refuse un lieu inexistant ou inaccessible', () => {
    expect(errs((m) => (m.steps[0].target = { poi: 'atlantide' }))).toMatch(/lieu inconnu/);
    expect(errs((m) => (m.steps[0].target = { x: 2, y: 2 }))).toMatch(/inaccessible/);
  });
  it('refuse les récompenses et textes hors bornes', () => {
    expect(errs((m) => (m.reward.money = 999999))).toMatch(/reward\.money/);
    expect(errs((m) => (m.title = 'x'.repeat(200)))).toMatch(/title/);
    expect(errs((m) => (m.intro[0].text = '<img src=x onerror=alert(1)>'))).toMatch(/interdits/);
  });
  it('refuse un chronomètre infaisable', () => expect(errs((m) => (m.steps[2].timeLimit = 12))).toMatch(/infaisable/));
  it('refuse une URL d’actualité non https', () => expect(errs((m) => (m.news = { headline: 'x', source: 'y', url: 'javascript:alert(1)', date: '2026-10-08', category: 'ai' }))).toMatch(/URL https/));
});

describe('changements hebdomadaires de la ville', () => {
  it('ne s’appliquent que pendant leur période', () => {
    const mods = new WorldModifiers();
    // Fichier figé (semaine 2026-W41) : le fichier publié change chaque lundi, le test ne doit pas en dépendre.
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weekly-changes-2026-w41.json'), 'utf8'));
    expect(validateChanges(file).ok).toBe(true);
    mods.apply(file, new Date('2026-10-08T12:00:00Z'));
    expect(mods.robotShare).toBeCloseTo(0.2);
    expect(mods.billboard).toBe('RALENTISSEZ');
    expect(mods.chatter.length).toBeGreaterThan(3);
    mods.apply(file, new Date('2026-11-08T12:00:00Z'));
    expect(mods.robotShare).toBe(0);
    expect(mods.billboard).toBeNull();
  });
  it('refusent les types et valeurs inconnus', () => {
    const base = { id: 'x', label: 'x', start: '2026-10-05T00:00:00Z', end: '2026-10-12T00:00:00Z' };
    expect(validateChanges({ schema: 1, changes: [{ ...base, type: 'gravity', factor: 0 }] }).ok).toBe(false);
    expect(validateChanges({ schema: 1, changes: [{ ...base, type: 'prices', factor: 50 }] }).ok).toBe(false);
    expect(validateChanges({ schema: 1, changes: [{ ...base, type: 'billboard', text: '<script>' }] }).ok).toBe(false);
    expect(validateChanges({ schema: 1, changes: [{ ...base, type: 'lighting', factor: 0.5, district: 'oldtown', extra: 1 }] }).ok).toBe(false);
    expect(validateChanges({ schema: 1, changes: [{ ...base, type: 'lighting', factor: 0.5, district: 'oldtown' }] }).ok).toBe(true);
  });
  it('effets temporaires de mission : appliqués puis annulés', () => {
    const mods = new WorldModifiers();
    mods.setTemp('trafficFactor', 1.6, 10);
    expect(mods.trafficFactor).toBe(1.6);
    mods.update(5); expect(mods.trafficFactor).toBe(1.6);
    mods.update(11); expect(mods.trafficFactor).toBe(1);
  });
});

describe('générateur hebdomadaire (ligne de commande)', () => {
  const runGen = (args: string[]) => execFileSync('npx', ['tsx', 'tools/weekly/generate.ts', ...args, '--dry', '--no-llm'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  it('produit une mission valide à partir de flux locaux', () => {
    const out = runGen(['--fixture', 'tests/fixtures/rss', '--date', '2026-10-11']);
    expect(out).toContain('catégorie outage');
    expect(out).toContain('recoupé par 2');
    expect(out).toContain('Mission valide');
  }, 70000);
  it('sans actualité exploitable, conserve la dernière mission valide', () => {
    const empty = fs.mkdtempSync(path.join(fs.realpathSync(require('node:os').tmpdir()), 'klaxo-'));
    const out = runGen(['--fixture', empty, '--date', '2026-10-11']);
    expect(out).toContain('Aucun sujet exploitable');
    expect(out).toContain('On conserve la dernière mission valide');
  }, 70000);
});
