import { describe, it, expect } from 'vitest';
import { makeWorld, run, intent, giveCar, DT, city, readJson } from './helpers';
import { dist } from '../src/engine/math';
import { validateMission, resolveLoc } from '../src/missions/validate';
import type { World } from '../src/world/World';
import type { Ped } from '../src/npc/Ped';

const ID = 'story-04-zombies';
const start = (seed = 5) => {
  const w = makeWorld(seed, { traffic: false });
  const def = w.missions.find(ID)!;
  w.missions.begin(def, 0);
  return { w, def, r: () => w.missions.active! };
};
const zombies = (w: World): Ped[] => w.missions.active?.zombies.filter((z) => !z.remove) ?? [];
/** Joueur prudent : crie dès qu'un zombie s'approche. */
const careful = (w: World) => () => {
  const p = w.player, near = zombies(w).some((z) => z.state !== 'down' && dist(z.x, z.y, p.px, p.py) < 48);
  return intent({ action: near });
};

describe('mission zombies', () => {
  it('est valide et proposée dès le début, en plus de la première mission', () => {
    const def = readJson('missions/story.json').missions.find((m: any) => m.id === ID);
    expect(validateMission(def, city()).errors).toEqual([]);
    const w = makeWorld(1);
    const ids = w.missions.available().map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['story-01-colis', ID]));
    expect(w.missions.givers.has(ID)).toBe(true);
  });

  it('les zombies poursuivent le joueur à pied', () => {
    const { w } = start();
    const z = zombies(w)[0];
    w.player.x = z.x + 70; w.player.y = z.y; w.player.state = 'foot';
    const d0 = dist(z.x, z.y, w.player.x, w.player.y);
    run(w, 1);
    expect(dist(z.x, z.y, w.player.x, w.player.y)).toBeLessThan(d0 - 15);
    expect(z.look.zombie).toBe(true);
  });

  it('trois morsures font échouer la mission', () => {
    const { w } = start();
    const z = zombies(w)[0];
    w.player.x = z.x + 20; w.player.y = z.y;
    run(w, 25, intent(), () => !w.missions.active);
    expect(w.missions.active).toBeNull();
    expect(w.missions.history[0]).toMatchObject({ id: ID, result: 'failed' });
  });

  it('crier fait reculer les zombies proches', () => {
    const { w } = start();
    const z = zombies(w)[0];
    w.player.x = z.x + 30; w.player.y = z.y;
    run(w, 0.3);
    const d0 = dist(z.x, z.y, w.player.x, w.player.y);
    w.update(DT, intent({ action: true }));
    expect((z.ai as any).stun).toBeGreaterThan(1.5);
    run(w, 1);
    expect(dist(z.x, z.y, w.player.x, w.player.y)).toBeGreaterThan(d0 + 20);
    expect(w.missions.active!.bites).toBe(0);
  });

  it('renverser un zombie en voiture n’attire pas la police, et il se relève', () => {
    const { w } = start();
    const v = giveCar(w);
    const z = zombies(w)[0];
    z.x = v.x + Math.cos(v.angle) * 14; z.y = v.y + Math.sin(v.angle) * 14;
    v.vx = Math.cos(v.angle) * 110; v.vy = Math.sin(v.angle) * 110;
    w.update(DT, intent());
    expect(z.state).toBe('down');
    expect(w.wanted.level).toBe(0);
    expect(w.economy.stats.pedsHit ?? 0).toBe(0);
    run(w, 5);
    expect(z.state).toBe('seek');
  });

  it('les caisses se ramassent à pied, pas en voiture', () => {
    const { w, def, r } = start();
    giveCar(w);
    expect(r().stepIndex).toBe(1);
    const crate = resolveLoc(w.map, (def.steps[1] as any).targets[0]);
    const v = w.player.vehicle!;
    v.x = crate.x; v.y = crate.y; v.vx = 0; v.vy = 0;
    run(w, 0.2);
    expect(r().collectedNow()).toEqual([]);
    expect(r().hint).toMatch(/Descends/);
    w.update(DT, intent({ interact: true }));
    run(w, 0.6, intent(), () => w.player.state === 'foot');
    w.player.x = crate.x; w.player.y = crate.y;
    run(w, 0.2);
    expect(r().collectedNow()).toEqual([0]);
  });

  it('mission complète : antidote, défense de la mairie, guérison et récompense', () => {
    const { w, def, r } = start(7);
    const money = w.economy.money;
    giveCar(w);
    w.update(DT, intent({ interact: true }));
    run(w, 0.6, intent(), () => w.player.state === 'foot');
    for (const t of (def.steps[1] as any).targets) {
      const c = resolveLoc(w.map, t);
      w.player.x = c.x; w.player.y = c.y;
      run(w, 0.4, careful(w));
    }
    expect(r().stepIndex).toBe(2);
    const hall = resolveLoc(w.map, (def.steps[2] as any).target);
    w.player.x = hall.x; w.player.y = hall.y;
    run(w, 0.3, careful(w));
    expect(r().stepIndex).toBe(3);
    // Défense : 40 secondes d'infusion, trois vagues.
    run(w, 60, careful(w), () => r().stepIndex !== 3);
    expect(r().bites).toBeLessThan(3);
    expect(r().stepIndex).toBe(4);
    expect(zombies(w)).toHaveLength(0);
    const cured = w.peds.filter((q) => q.role === 'civil' && dist(q.x, q.y, hall.x, hall.y) < 400);
    expect(cured.some((q) => !q.look.zombie)).toBe(true);
    expect(w.peds.some((q) => q.look.zombie)).toBe(false);
    // Retour auprès de la Docteure Fiole.
    const mk = r().markers[0];
    w.player.x = mk.x + 6; w.player.y = mk.y + 6;
    run(w, 0.2);
    w.update(DT, intent({ interact: true }));
    run(w, 0.5);
    expect(w.missions.isDone(ID)).toBe(true);
    expect(w.economy.money).toBeGreaterThanOrEqual(money + def.reward.money); // + bonus éventuels (niveau, lieu secret)
  });
});
