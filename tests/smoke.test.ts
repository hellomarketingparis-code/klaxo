import { describe, it, expect } from 'vitest';
import { makeWorld, run, city, readJson } from './helpers';
import { generateCity } from '../src/map/generator';
import { validateMission } from '../src/missions/validate';
import { findPath } from '../src/map/pathfinding';
import { T } from '../src/map/tiles';

describe('ville', () => {
  it('se génère avec cinq quartiers, des routes et tous les lieux de mission', () => {
    const m = city();
    expect(m.nodes.length).toBeGreaterThan(80);
    expect(new Set(m.buildings.map((b) => b.district)).size).toBe(5);
    for (const id of ['m1_shop', 'hotel', 'm2_giver', 'gare', 'wazou', 'm3_bar', 'm3_item', 'm3_observe', 'kiosk', 'police', 'dealer', 'clothes', 'garage_old', 'garage_ind', 'mairie', 'banque', 'parc', 'marche', 'port', 'usine', 'plage']) expect(m.pois.has(id), id).toBe(true);
    expect(m.secrets.length).toBe(12);
    expect(m.nodes.filter((n) => n.signal).length).toBeGreaterThan(20);
  });
  it('est déterministe : deux générations donnent la même ville', () => {
    const a = city().kind, b = generateCity().kind;
    let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    expect(diff).toBe(0);
  });
  it('a un réseau routier connexe et des lieux tous accessibles à pied', () => {
    const m = city();
    for (const n of m.nodes) expect(m.routeNodes(0, n.id).length, `nœud ${n.id}`).toBeGreaterThan(n.id === 0 ? 0 : 1);
    for (const p of m.pois.values()) expect(m.reach[m.idx(p.tx, p.ty)], p.id).toBe(1);
    for (const s of m.secrets) expect(m.reach[m.idx(s.tx, s.ty)]).toBe(1);
  });
  it('les bâtiments sont des obstacles, pas les routes', () => {
    const m = city();
    const b = m.buildings[10];
    expect(m.solidAt(b.x + 1, b.y + 1)).toBe(true);
    const e = m.edges[0];
    expect(m.solidAt(e.x, e.y)).toBe(false);
    expect(m.kindAt(e.x, e.y)).toBe(T.ROAD);
  });
  it('trouve un chemin piéton entre deux commerces', () => {
    const m = city();
    const a = m.poi('kiosk'), b = m.poi('clothes');
    const path = findPath(m, a.tx, a.ty, b.tx, b.ty, { maxNodes: 20000 });
    expect(path && path.length).toBeGreaterThan(10);
  });
});

describe('missions de l’histoire', () => {
  it('sont valides et faisables', () => {
    const defs = readJson('missions/story.json').missions;
    expect(defs.length).toBe(3);
    for (const def of defs) expect(validateMission(def, city()).errors, def.id).toEqual([]);
  });
});

describe('simulation', () => {
  it('tourne deux minutes sans erreur, avec circulation et piétons', () => {
    const w = makeWorld(3);
    let maxCars = 0, maxPeds = 0;
    for (let i = 0; i < 120; i++) { run(w, 1); maxCars = Math.max(maxCars, w.traffic.count); maxPeds = Math.max(maxPeds, w.pedSys.civilCount); }
    expect(maxCars).toBeGreaterThan(6);
    expect(maxPeds).toBeGreaterThan(12);
    for (const v of w.vehicles) expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
  });
  it('la circulation autonome roule sans se bloquer ni se rentrer dedans', () => {
    const w = makeWorld(5);
    let total = 0, moving = 0, blocked = 0, damaged = 0;
    for (let i = 0; i < 150; i++) {
      run(w, 1);
      if (i < 20) continue;
      for (const v of w.vehicles) { if (v.driver !== 'npc') continue; total++; if (v.speed > 15) moving++; if ((v.ai?.blocked ?? 0) > 8) blocked++; if (v.hp < v.spec.hp * 0.9) damaged++; }
    }
    expect(total).toBeGreaterThan(500);
    expect(moving / total).toBeGreaterThan(0.45);
    expect(blocked / total).toBeLessThan(0.08);
    expect(damaged / total).toBeLessThan(0.08);
  });
  it('les véhicules autonomes s’arrêtent au feu rouge', () => {
    const w = makeWorld(7);
    const m = w.map;
    let checked = 0, ran = 0;
    for (let i = 0; i < 2400; i++) {
      run(w, 1 / 30);
      for (const v of w.vehicles) {
        const ai = v.ai;
        if (v.driver !== 'npc' || !ai || ai.kind !== 'traffic' || ai.phase !== 'node') continue;
        const node = m.nodes[ai.to];
        if (!node.signal || node.deg < 3) continue;
        // Au centre du carrefour à vitesse soutenue alors que son axe est au rouge depuis plus de 2 s : infraction.
        const e = m.edges[ai.edge];
        const p = ((w.time + node.phase) % 16 + 16) % 16;
        const redFor = e.vertical ? (p >= 7.5 ? p - 7.5 : 0) : (p < 8 ? p + 0.5 : p >= 15.5 ? p - 15.5 : 0);
        checked++;
        if (redFor > 2.5 && redFor < 6 && v.speed > 40 && Math.hypot(v.x - node.cx, v.y - node.cy) < 14) ran++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(ran / checked).toBeLessThan(0.02);
  });
});
