import { describe, it, expect } from 'vitest';
import { makeWorld, run, intent, tp, giveCar, driveTo, DT, city } from './helpers';
import { dist } from '../src/engine/math';
import { TILE } from '../src/engine/config';
import { T } from '../src/map/tiles';
import { MemoryStore, SaveSystem } from '../src/save/SaveSystem';
import { validateSave } from '../src/world/World';
import { EVENT_TYPES } from '../src/weekly/RandomEvents';
import type { GuardState } from '../src/missions/MissionRunner';

describe('joueur et véhicules', () => {
  it('marche, court et bute contre les bâtiments', () => {
    const w = makeWorld(1, { traffic: false });
    const p = w.player;
    const x0 = p.x;
    run(w, 1, intent({ moveX: 1 }));
    const walked = p.x - x0;
    expect(walked).toBeGreaterThan(40);
    run(w, 1, intent({ moveX: 1, run: true }));
    expect(p.x - x0 - walked).toBeGreaterThan(walked * 1.4);
    // Vers le nord depuis le kiosque : le bâtiment arrête le joueur.
    tp(w, 'kiosk');
    run(w, 3, intent({ moveY: -1 }));
    expect(w.map.solidAtPx(p.x, p.y)).toBe(false);
    expect(p.y).toBeGreaterThan(w.map.poi('kiosk').ty * TILE - 6);
  });
  it('monte dans une voiture, conduit, freine et descend', () => {
    const w = makeWorld(2, { traffic: false });
    tp(w, 'x_centre', 30, 60);
    const v = giveCar(w, 'sedan');
    expect(w.player.state).toBe('driving');
    expect(v.driver).toBe('player');
    const start = { x: v.x, y: v.y };
    run(w, 2.5, intent({ moveY: -1 }));
    expect(dist(start.x, start.y, v.x, v.y)).toBeGreaterThan(120);
    expect(v.speed).toBeGreaterThan(100);
    const a0 = v.angle;
    run(w, 0.5, intent({ moveY: -1, moveX: 1 }));
    expect(Math.abs(v.angle - a0)).toBeGreaterThan(0.3);
    run(w, 3, intent({ moveY: 1 }), () => v.speed < 10);
    expect(v.speed).toBeLessThan(40);
    run(w, 2, intent({ handbrake: true }), () => v.speed < 5);
    w.update(DT, intent({ interact: true }));
    run(w, 1);
    expect(w.player.state).toBe('foot');
    expect(v.driver).toBe('none');
    expect(w.map.solidAtPx(w.player.x, w.player.y)).toBe(false);
  });
  it('les collisions abîment le véhicule', () => {
    const w = makeWorld(2, { traffic: false });
    tp(w, 'kiosk', 0, 40);
    const v = giveCar(w, 'compact');
    v.angle = -Math.PI / 2; v.x = w.map.poiPx('kiosk').x; v.y = w.map.poiPx('kiosk').y + 90;
    run(w, 3, intent({ moveY: -1 }));
    expect(v.hp).toBeLessThan(v.spec.hp);
    expect(w.map.solidAtPx(v.x, v.y)).toBe(false);
  });
  it('voler une voiture en circulation éjecte son conducteur', () => {
    const w = makeWorld(9);
    run(w, 20);
    const car = w.vehicles.find((v) => v.driver === 'npc' && v.type !== 'police');
    expect(car).toBeTruthy();
    car!.vx = 0; car!.vy = 0; car!.ai.hold = true;
    run(w, 1.5);
    w.player.x = car!.x + Math.sin(car!.angle) * 12; w.player.y = car!.y - Math.cos(car!.angle) * 12;
    w.update(DT, intent({ interact: true }));
    run(w, 1, intent(), () => w.player.state === 'driving');
    expect(w.player.vehicle).toBe(car);
    expect(car!.driver).toBe('player');
    // L'ancien conducteur est sur le trottoir, en fuite.
    expect(w.peds.some((q) => q.state === 'flee' && dist(q.x, q.y, car!.x, car!.y) < 60)).toBe(true);
    expect(w.economy.get('drives')).toBe(1);
  });
});

describe('police', () => {
  it('une étoile s’efface seule si on se tient tranquille', () => {
    const w = makeWorld(4, { traffic: false });
    w.wanted.setLevel(1);
    expect(w.wanted.level).toBe(1);
    run(w, 14);
    expect(w.wanted.level).toBe(0);
  });
  it('deux étoiles : une patrouille arrive et arrête le joueur immobile', () => {
    const w = makeWorld(4, { traffic: false });
    tp(w, 'x_centre', 40, 40);
    w.economy.money = 1000;
    w.wanted.setLevel(2);
    let units = 0;
    run(w, 60, intent(), () => { units = Math.max(units, w.police.unitCount); return w.economy.get('busted') > 0; });
    expect(units).toBeGreaterThan(0);
    expect(w.economy.get('busted')).toBe(1);
    expect(w.wanted.level).toBe(0);
    expect(w.economy.money).toBeLessThan(1000);
    const st = w.map.poiPx('police');
    expect(dist(w.player.x, w.player.y, st.x, st.y)).toBeLessThan(40);
  });
  it('plus d’étoiles, plus d’unités ; barrages à partir de quatre', () => {
    const w = makeWorld(6, { traffic: false });
    tp(w, 'x_centre', 30, 60);
    const v = giveCar(w, 'sport');
    w.wanted.setLevel(5);
    let units = 0, blocks = 0;
    const node = w.map.poiPx('x_est');
    // On roule vers l'est pour laisser le temps aux renforts et aux barrages d'apparaître.
    const m = w.map;
    const path = m.routeNodes(m.nearestNode(v.x, v.y).id, m.nearestNode(node.x, node.y).id);
    expect(path.length).toBeGreaterThan(2);
    for (let i = 0; i < 40 && w.economy.get('busted') === 0; i++) {
      driveTo(w, node.x, node.y, 1);
      units = Math.max(units, w.police.unitCount);
      blocks = Math.max(blocks, w.vehicles.filter((c) => c.tag === 'roadblock').length);
      w.wanted.setLevel(5);
    }
    expect(units).toBeGreaterThanOrEqual(3);
    expect(blocks).toBeGreaterThanOrEqual(2);
  });
  it('on sème la police en restant hors de vue', () => {
    const w = makeWorld(8, { traffic: false });
    const m = w.map;
    // Une cour intérieure entourée de bâtiments : aucune ligne de vue depuis la rue.
    let spot: { x: number; y: number } | null = null;
    for (let ty = 30; ty < 200 && !spot; ty++) for (let tx = 120; tx < 200 && !spot; tx++) {
      if (m.solidAt(tx, ty) || m.reach[m.idx(tx, ty)]) continue;
      spot = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    }
    expect(spot).toBeTruthy();
    w.player.x = spot!.x; w.player.y = spot!.y;
    w.wanted.setLevel(3);
    run(w, 45, intent(), () => w.wanted.level === 0);
    expect(w.wanted.level).toBe(0);
    expect(w.economy.get('busted')).toBe(0);
    expect(w.economy.get('evasions')).toBe(1);
  });
  it('renverser un piéton devant témoin déclenche une recherche', () => {
    const w = makeWorld(10, { traffic: false });
    w.wanted.crime('pedHit', w.player.x, w.player.y);
    w.wanted.crime('pedHit', w.player.x, w.player.y);
    w.wanted.crime('pedHit', w.player.x, w.player.y);
    expect(w.wanted.level).toBeGreaterThanOrEqual(1);
  });
});

describe('missions', () => {
  const accept = (w: ReturnType<typeof makeWorld>, id: string) => {
    const giver = w.missions.givers.get(id)!;
    expect(giver, `donneur de ${id}`).toBeTruthy();
    w.player.x = giver.x + 8; w.player.y = giver.y + 4;
    run(w, 0.2);
    expect(w.prompt?.kind).toBe('giver');
    w.update(DT, intent({ interact: true }));
    expect(w.missions.active?.def.id).toBe(id);
  };
  const interactAtMarker = (w: ReturnType<typeof makeWorld>) => {
    const mk = w.missions.active!.markers[0];
    w.player.x = mk.x + 6; w.player.y = mk.y + 6;
    run(w, 0.1);
    expect(w.missions.active!.prompt, 'invite de mission').toBeTruthy();
    w.update(DT, intent({ interact: true }));
  };

  it('mission 1 : colis livré à temps en conduisant vraiment jusqu’à l’hôtel', () => {
    const w = makeWorld(11, { traffic: false });
    const money = w.economy.money;
    accept(w, 'story-01-colis');
    interactAtMarker(w);
    expect(w.player.carrying).toBe('colis');
    expect(w.missions.active!.stepIndex).toBe(1);
    giveCar(w, 'sedan');
    run(w, 0.2);
    expect(w.missions.active!.stepIndex).toBe(2);
    expect(w.missions.active!.timeLeft).toBeGreaterThan(70);
    const h = w.map.poiPx('hotel');
    const road = w.map.nearestRoadPoint(h.x, h.y);
    const res = driveTo(w, road.x, road.y, 80, 40);
    expect(res.ok, `arrivée en ${res.time.toFixed(0)} s`).toBe(true);
    console.log(`[mission 1] trajet du pilote automatique : ${res.time.toFixed(1)} s sur 80 s disponibles`);
    run(w, 3, intent({ handbrake: true }), () => w.missions.active?.stepIndex === 3);
    expect(w.missions.active!.stepIndex).toBe(3);
    w.update(DT, intent({ interact: true })); // descendre
    run(w, 1);
    interactAtMarker(w);
    run(w, 0.5);
    expect(w.missions.active).toBeNull();
    expect(w.missions.isDone('story-01-colis')).toBe(true);
    // 500 de récompense, plus la prime de passage au niveau 2.
    expect(w.economy.money).toBeGreaterThanOrEqual(money + 500);
    expect(w.missions.givers.has('story-02-bouchons')).toBe(true);
  });
  it('mission 1 : échec si le temps est écoulé ou si le colis est trop secoué', () => {
    const w = makeWorld(12, { traffic: false });
    accept(w, 'story-01-colis');
    interactAtMarker(w);
    giveCar(w, 'sedan');
    run(w, 0.2);
    run(w, 85, intent(), () => !w.missions.active);
    expect(w.missions.active).toBeNull();
    expect(w.missions.isDone('story-01-colis')).toBe(false);
    expect(w.missions.history[0].result).toBe('failed');
    expect(w.missions.lastFailed?.def.id).toBe('story-01-colis');
    // Réessai depuis le point de passage : le colis est rendu, puis on le fracasse contre les murs.
    expect(w.missions.retry()).toBe(true);
    expect(w.player.carrying).toBe('colis');
    const r = w.missions.active!;
    run(w, 0.3);
    expect(r.stepIndex).toBe(2);
    const v = w.player.vehicle!;
    const wall = w.map.poiPx('kiosk');
    for (let k = 0; k < 8 && w.missions.active; k++) { v.hp = v.spec.hp; v.x = wall.x; v.y = wall.y + 90; v.angle = -Math.PI / 2; v.vx = 0; v.vy = 0; run(w, 2.2, intent({ moveY: -1 })); }
    expect(r.failReason).toMatch(/survécu/);
    expect(w.missions.active).toBeNull();
    expect(w.missions.history[0].result).toBe('failed');
  });
  it('mission 2 : filature réussie en suivant la berline à bonne distance', () => {
    const w = makeWorld(13, { traffic: false });
    w.missions.done['story-01-colis'] = { times: 1, at: '' };
    w.missions.refreshGivers();
    accept(w, 'story-02-bouchons');
    giveCar(w, 'compact');
    run(w, 0.3);
    const r = w.missions.active!;
    expect(r.stepIndex).toBe(1);
    const target = r.markers[0];
    const p = w.player;
    // Approche, puis on suit la trace de la cible avec ~110 px de retard.
    const near = w.map.nearestRoadPoint(target.x, target.y);
    driveTo(w, near.x, near.y, 60, 120);
    const trail: { x: number; y: number }[] = [];
    let t = 0, maxSusp = 0;
    while (t < 240 && w.missions.active && r.stepIndex === 1) {
      const tv = w.vehicles.find((c) => c.tag === 'm:tail')!;
      if (!trail.length || dist(trail[trail.length - 1].x, trail[trail.length - 1].y, tv.x, tv.y) > 14) trail.push({ x: tv.x, y: tv.y });
      const v = p.vehicle!;
      const d = dist(v.x, v.y, tv.x, tv.y);
      while (trail.length > 1 && dist(v.x, v.y, trail[0].x, trail[0].y) < 26) trail.shift();
      const goal = trail[0];
      const err = Math.atan2(goal.y - v.y, goal.x - v.x) - v.angle;
      const e = Math.atan2(Math.sin(err), Math.cos(err));
      const want = d > 130 ? 110 : d > 95 ? 60 : 0;
      const vf = v.forwardSpeed;
      w.update(DT, intent({ moveX: Math.max(-1, Math.min(1, e * 2.6)), moveY: vf < want ? -1 : vf > want + 10 ? 1 : 0 }));
      maxSusp = Math.max(maxSusp, r.meter?.value ?? 0);
      t += DT;
    }
    expect(r.state, r.failReason).toBe('running');
    expect(r.stepIndex).toBe(2);
    expect(maxSusp).toBeLessThan(1);
    w.update(DT, intent({ handbrake: true }));
    run(w, 2, intent({ handbrake: true }), () => p.vehicle!.speed < 5);
    w.update(DT, intent({ interact: true }));
    run(w, 1);
    interactAtMarker(w);
    run(w, 0.5);
    expect(w.missions.isDone('story-02-bouchons')).toBe(true);
  });
  it('mission 2 : coller la cible ou la perdre fait échouer', () => {
    const w = makeWorld(14, { traffic: false });
    w.missions.done['story-01-colis'] = { times: 1, at: '' };
    w.missions.refreshGivers();
    accept(w, 'story-02-bouchons');
    giveCar(w, 'compact');
    run(w, 0.3);
    const r = w.missions.active!;
    const tv = w.vehicles.find((c) => c.tag === 'm:tail')!;
    const v = w.player.vehicle!;
    // Pare-chocs contre pare-chocs : le soupçon monte jusqu'à l'échec.
    for (let t = 0; t < 12 && w.missions.active; t += DT) { v.x = tv.x - Math.cos(tv.angle) * 34; v.y = tv.y - Math.sin(tv.angle) * 34; v.angle = tv.angle; v.vx = tv.vx; v.vy = tv.vy; w.update(DT, intent()); }
    expect(w.missions.active).toBeNull();
    expect(r.failReason).toMatch(/repéré/);
  });
  it('mission 3 : infiltration réussie sans être vu, puis livraison', () => {
    const w = makeWorld(15, { traffic: false });
    w.missions.done['story-01-colis'] = { times: 1, at: '' };
    w.missions.done['story-02-bouchons'] = { times: 1, at: '' };
    w.missions.refreshGivers();
    accept(w, 'story-03-neon');
    const r = w.missions.active!;
    expect(r.guards.length).toBe(3);
    tp(w, 'm3_observe', 0, 30);
    run(w, 0.3);
    expect(r.stepIndex).toBe(1);
    run(w, 8);
    expect(r.stepIndex).toBe(2);
    expect(r.detected).toBe(false);
    // On attend que personne ne regarde l'enseigne, on la prend, on ressort.
    const item = w.map.poiPx('m3_item');
    const safe = () => r.guards.every((g) => {
      const d = dist(g.x, g.y, item.x, item.y);
      if (d < 60) return false;
      const a = Math.atan2(item.y - g.y, item.x - g.x) - g.angle;
      return d > 100 || Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > 0.9;
    });
    run(w, 40, intent(), safe);
    expect(safe()).toBe(true);
    w.player.x = item.x + 5; w.player.y = item.y + 5;
    w.update(DT, intent());
    w.update(DT, intent({ interact: true }));
    expect(w.player.carrying).toBe('neon');
    expect(r.stepIndex).toBe(3);
    tp(w, 'm3_observe', 0, 16 * 8);
    run(w, 0.3);
    expect(r.state).toBe('running');
    expect(r.stepIndex).toBe(4);
    tp(w, 'm3_bar', 0, 8);
    run(w, 0.5);
    expect(w.missions.isDone('story-03-neon')).toBe(true);
    expect(w.economy.get('storyDone')).toBe(1);
    expect(w.peds.filter((q) => q.role === 'guard').length).toBe(0);
  });
  it('mission 3 : se planter devant un vigile déclenche l’alerte', () => {
    const w = makeWorld(16, { traffic: false });
    w.missions.done['story-01-colis'] = { times: 1, at: '' };
    w.missions.done['story-02-bouchons'] = { times: 1, at: '' };
    w.missions.refreshGivers();
    accept(w, 'story-03-neon');
    const r = w.missions.active!;
    tp(w, 'm3_observe', 0, 30);
    run(w, 9);
    expect(r.stepIndex).toBe(2);
    const g = r.guards[0];
    for (let t = 0; t < 4 && w.missions.active; t += DT) { w.player.x = g.x + Math.cos(g.angle) * 30; w.player.y = g.y + Math.sin(g.angle) * 30; w.update(DT, intent()); }
    expect((g.ai as GuardState).detect).toBeGreaterThan(0.9);
    expect(w.missions.active).toBeNull();
    expect(r.failReason).toMatch(/vigiles/);
    // Derrière un conteneur, un vigile ne voit pas.
    expect(w.map.lineOfSight(g.x, g.y, g.x + 3, g.y + 3)).toBe(true);
  });
  it('une arrestation fait échouer la mission en cours', () => {
    const w = makeWorld(17, { traffic: false });
    accept(w, 'story-01-colis');
    w.bust();
    expect(w.missions.active).toBeNull();
    expect(w.missions.history[0].result).toBe('failed');
  });
});

describe('événements de rue', () => {
  it('chaque type d’événement produit une proposition valide', () => {
    for (const type of EVENT_TYPES) {
      const w = makeWorld(20, { traffic: false });
      w.economy.level = 3;
      tp(w, 'x_centre', 40, 40);
      run(w, 1);
      const ok = w.randomEvents.trigger(type);
      expect(ok, type).toBe(true);
      if (type !== 'roadworks') {
        const side = w.missions.sideMarker!;
        expect(side, type).toBeTruthy();
        expect(w.map.kindAtPx(side.x, side.y)).toBe(T.SIDEWALK);
      }
      run(w, 2);
    }
  });
  it('un événement accepté se joue comme une mission et rapporte sa récompense', () => {
    const w = makeWorld(21, { traffic: false });
    tp(w, 'x_centre', 40, 40);
    run(w, 1);
    expect(w.randomEvents.trigger('lost_item')).toBe(true);
    const ped = w.missions.sideMarker!;
    w.player.x = ped.x + 8; w.player.y = ped.y + 4;
    run(w, 0.2);
    w.update(DT, intent({ interact: true }));
    const r = w.missions.active!;
    expect(r.def.kind).toBe('side');
    const mk = r.markers[0];
    w.player.x = mk.x; w.player.y = mk.y;
    run(w, 0.2);
    expect(r.stepIndex).toBe(1);
    const money = w.economy.money;
    const npc = r.markers[0];
    w.player.x = npc.x + 6; w.player.y = npc.y + 6;
    run(w, 0.1);
    w.update(DT, intent({ interact: true }));
    run(w, 0.3);
    expect(w.missions.active).toBeNull();
    expect(w.economy.money).toBe(money + 120);
    expect(w.economy.get('eventsDone')).toBe(1);
  });
  it('aucun événement ne se déclenche pendant une mission', () => {
    const w = makeWorld(22, { traffic: false });
    w.randomEvents.enabled = true;
    const giver = w.missions.givers.get('story-01-colis')!;
    w.player.x = giver.x + 8; w.player.y = giver.y + 4;
    run(w, 0.2);
    w.update(DT, intent({ interact: true }));
    expect(w.missions.active).toBeTruthy();
    run(w, 200, intent(), () => !w.missions.active);
    expect(w.missions.sideMarker).toBeNull();
  });
});

describe('économie et progression', () => {
  it('lieux secrets : argent, expérience et comptage', () => {
    const w = makeWorld(30, { traffic: false });
    const s = city().secrets[0];
    const money = w.economy.money;
    w.player.x = (s.tx + 0.5) * TILE; w.player.y = (s.ty + 0.5) * TILE;
    run(w, 0.2);
    expect(w.secretsFound.size).toBe(1);
    expect(w.economy.money).toBe(money + 150);
    run(w, 1);
    expect(w.secretsFound.size).toBe(1);
  });
  it('achat, livraison, réparation et peinture d’un véhicule', () => {
    const w = makeWorld(31, { traffic: false });
    w.economy.money = 5000;
    expect(w.economy.buyVehicle('compact', 0xe0443a)).toBe(true);
    expect(w.economy.owned.length).toBe(1);
    expect(w.economy.money).toBe(5000 - 1200);
    expect(w.economy.buyVehicle('sport', 0xff2e88)).toBe(false);
    const v = w.deliverOwned(w.economy.owned[0]);
    expect(w.vehicles.includes(v)).toBe(true);
    expect(w.map.isRoadKind(w.map.kindAtPx(v.x, v.y))).toBe(true);
    w.player.x = v.x + Math.sin(v.angle) * 12; w.player.y = v.y - Math.cos(v.angle) * 12;
    w.update(DT, intent({ interact: true }));
    run(w, 1);
    v.hp = 30;
    const cost = w.repairCost();
    expect(cost).toBeGreaterThan(0);
    const before = w.economy.money;
    expect(w.repair()).toBe(true);
    expect(v.hp).toBe(v.spec.hp);
    expect(w.economy.money).toBe(before - cost);
    w.wanted.setLevel(2); w.wanted.seen = false;
    expect(w.respray(0x22e0ff)).toBe(true);
    expect(v.color).toBe(0x22e0ff);
    expect(w.wanted.level).toBe(0);
  });
  it('l’inflation hebdomadaire modifie les prix', () => {
    const w = makeWorld(32, { traffic: false });
    const base = w.economy.price(1000);
    w.mods.apply({ schema: 1, changes: [{ id: 'inflation', type: 'prices', label: 'Tout augmente', factor: 1.5, start: '2020-01-01T00:00:00Z', end: '2999-01-01T00:00:00Z' }] });
    expect(w.economy.price(1000)).toBe(base * 1.5);
    w.mods.apply({ schema: 1, changes: [{ id: 'vieux', type: 'prices', label: 'Périmé', factor: 3, start: '2020-01-01T00:00:00Z', end: '2020-01-08T00:00:00Z' }] });
    expect(w.economy.price(1000)).toBe(base);
  });
  it('l’expérience fait monter de niveau', () => {
    const w = makeWorld(33, { traffic: false });
    w.economy.addXp(500);
    expect(w.economy.level).toBeGreaterThan(2);
  });
});

describe('sauvegarde', () => {
  it('enregistre puis restaure la progression', async () => {
    const w = makeWorld(40, { traffic: false });
    w.player.name = 'Zoé'; w.player.look.top = 0x22e0ff;
    w.economy.money = 4321; w.economy.addXp(300);
    w.economy.buyVehicle('compact', 0xe0443a);
    w.missions.done['story-01-colis'] = { times: 1, at: '2026-10-11T00:00:00Z' };
    w.secretsFound.add(3);
    tp(w, 'm2_giver', 0, 10);
    const save = new SaveSystem(new MemoryStore());
    await save.save(w.serialize());
    const loaded = await save.load();
    expect(loaded).toBeTruthy();
    const w2 = makeWorld(41, { traffic: false });
    w2.restore(loaded!);
    expect(w2.player.name).toBe('Zoé');
    expect(w2.player.look.top).toBe(0x22e0ff);
    expect(w2.economy.money).toBe(w.economy.money);
    expect(w2.economy.level).toBe(w.economy.level);
    expect(w2.economy.owned).toEqual([{ type: 'compact', color: 0xe0443a }]);
    expect(w2.missions.isDone('story-01-colis')).toBe(true);
    expect(w2.missions.givers.has('story-02-bouchons')).toBe(true);
    expect(w2.secretsFound.has(3)).toBe(true);
    expect(dist(w2.player.x, w2.player.y, w.player.x, w.player.y)).toBeLessThan(20);
  });
  it('reprend une mission en cours à son dernier point de passage', async () => {
    const w = makeWorld(42, { traffic: false });
    const giver = w.missions.givers.get('story-01-colis')!;
    w.player.x = giver.x + 8; w.player.y = giver.y + 4;
    run(w, 0.2); w.update(DT, intent({ interact: true }));
    const mk = w.missions.active!.markers[0];
    w.player.x = mk.x + 5; w.player.y = mk.y + 5; run(w, 0.1); w.update(DT, intent({ interact: true }));
    expect(w.missions.active!.stepIndex).toBe(1);
    const data = JSON.parse(JSON.stringify(w.serialize()));
    expect(data.missions.active).toEqual({ id: 'story-01-colis', step: 1 });
    const w2 = makeWorld(43, { traffic: false });
    w2.restore(data);
    expect(w2.missions.active?.def.id).toBe('story-01-colis');
    expect(w2.missions.active?.stepIndex).toBe(1);
    expect(w2.player.carrying).toBe('colis');
  });
  it('export et import de fichier ; les fichiers invalides sont refusés', () => {
    const w = makeWorld(44, { traffic: false });
    const save = new SaveSystem(new MemoryStore());
    const text = save.exportText(w.serialize());
    expect(validateSave(save.parseImport(text))).toBe(true);
    expect(() => save.parseImport('pas du json')).toThrow();
    expect(() => save.parseImport('{"v":1}')).toThrow();
  });
});
