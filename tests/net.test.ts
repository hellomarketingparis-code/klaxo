import { describe, it, expect } from 'vitest';
import { makeWorld, readJson, DT, intent } from './helpers';
import { NetSystem } from '../src/net/NetSystem';
import { memoryHub } from '../src/net/transport';
import {
  autoName, decodeCoop, decodeHello, decodeState, encodeState, makeGroupCode, mustLeave, normalizeGroupCode, RateLimiter, validateLook, ROOM_CAP, PROTO,
} from '../src/net/protocol';
import { DEFAULT_LOOK } from '../src/npc/looks';
import { resolveLoc } from '../src/missions/validate';
import type { World } from '../src/world/World';

describe('protocole réseau', () => {
  const st = { x: 1200.4, y: 900.6, a: 1.234, mode: 1 as const, vt: 'taxi' as const, vc: 0xffd84a, sp: 88.2, wanted: 2, moving: true, sid: 'abc123' };
  it('encode et décode une position', () => {
    const d = decodeState(JSON.parse(JSON.stringify(encodeState(st))))!;
    expect(d).toMatchObject({ x: 1200, y: 901, a: 1.23, mode: 1, vt: 'taxi', vc: 0xffd84a, wanted: 2, moving: true, sid: 'abc123' });
  });
  it('refuse les positions invalides ou piégées', () => {
    const ok = encodeState(st);
    const bad = (i: number, v: unknown) => { const c = [...ok] as unknown[]; c[i] = v; return decodeState(c); };
    expect(bad(0, -5)).toBeNull();
    expect(bad(1, 1e9)).toBeNull();
    expect(bad(2, Number.NaN)).toBeNull();
    expect(bad(4, 99)).toBeNull();
    expect(bad(7, 9)).toBeNull();
    expect(bad(9, '<img src=x onerror=alert(1)>')).toBeNull();
    expect(decodeState([...ok, 'extra'])).toBeNull();
    expect(decodeState({ x: 1 })).toBeNull();
    expect(decodeState(null)).toBeNull();
  });
  it('n’accepte que les couleurs des palettes du jeu pour l’apparence', () => {
    expect(validateLook(DEFAULT_LOOK)).toEqual(expect.objectContaining({ skin: DEFAULT_LOOK.skin }));
    expect(validateLook({ ...DEFAULT_LOOK, top: 0x123456 })).toBeNull();
    expect(validateLook({ ...DEFAULT_LOOK, acc: 6 })).toBeNull();
    expect(decodeHello({ v: PROTO, look: DEFAULT_LOOK, joined: 5 })).not.toBeNull();
    expect(decodeHello({ v: PROTO + 1, look: DEFAULT_LOOK, joined: 5 })).toBeNull();
  });
  it('valide les messages de coopération', () => {
    expect(decodeCoop({ k: 'inv', sid: 'abcd1', m: 'story-01-colis', s: 0 })).not.toBeNull();
    expect(decodeCoop({ k: 'inv', sid: 'abcd1', m: '../../etc', s: 0 })).toBeNull();
    expect(decodeCoop({ k: 'col', sid: 'abcd1', s: 0, i: 99 })).toBeNull();
    expect(decodeCoop({ k: 'sync', sid: 'abcd1', m: 'x', s: 1, c: [0, 'a'] })).toBeNull();
    expect(decodeCoop({ k: 'chat', sid: 'abcd1', text: 'salut' })).toBeNull(); // aucune discussion possible
  });
  it('fabrique les noms localement, de façon stable', () => {
    expect(autoName('peer-1')).toBe(autoName('peer-1'));
    expect(autoName('peer-1')).toMatch(/^[\p{L} ]+ \d{2}$/u);
  });
  it('codes de groupe', () => {
    const c = makeGroupCode(() => 0.5);
    expect(c).toMatch(/^[A-Z2-9]{5}$/);
    expect(normalizeGroupCode(' ab-c7d ')).toBe('ABC7D');
    expect(normalizeGroupCode('ab')).toBeNull();
  });
  it('une ville trop pleine renvoie les derniers arrivés vers la suivante', () => {
    const others = Array.from({ length: ROOM_CAP }, (_, i) => ({ id: 'p' + i, joined: i }));
    expect(mustLeave('moi', 100, others)).toBe(true); // arrivé en dernier
    expect(mustLeave('moi', -1, others)).toBe(false); // arrivé en premier : un autre partira
    expect(mustLeave('moi', 100, others.slice(1))).toBe(false); // place libre
  });
  it('limite le débit de messages par joueur', () => {
    let t = 0;
    const rl = new RateLimiter({ hi: 2, st: 10, hn: 2, co: 5 }, () => t);
    let n = 0;
    for (let i = 0; i < 100; i++) if (rl.allow('a', 'st')) n++;
    expect(n).toBe(10);
    t = 1000;
    expect(rl.allow('a', 'st')).toBe(true);
  });
});

/** Deux joueurs (ou plus) reliés par un réseau simulé. */
function setup(n: number, opts: { weekly?: any } = {}) {
  const hub = memoryHub();
  let clock = 1_000_000;
  const worlds: World[] = [], nets: NetSystem[] = [];
  for (let i = 0; i < n; i++) {
    const w = makeWorld(i + 1, { traffic: false });
    if (opts.weekly) w.missions.load(readJson('missions/story.json').missions, opts.weekly, null);
    worlds.push(w);
    nets.push(new NetSystem(w, hub.transport, () => clock));
  }
  const tick = async (seconds = 0.2) => {
    for (let t = 0; t < seconds; t += 0.1) {
      clock += 100;
      for (let i = 0; i < n; i++) { worlds[i].update(0.1, intent()); nets[i].update(0.1, true); }
      await hub.flush();
    }
  };
  return { hub, worlds, nets, tick, advance: (ms: number) => { clock += ms; } };
}

describe('jeu en ligne (réseau simulé)', () => {
  it('deux joueurs de la ville publique se voient et suivent leurs déplacements', async () => {
    const { worlds, nets, tick } = setup(2);
    await Promise.all(nets.map((n) => n.connect({ kind: 'public' })));
    await tick(0.5);
    expect(nets[0].status).toBe('online');
    expect(nets[0].count).toBe(1);
    expect(nets[0].city).toBe(1);
    const other = [...nets[0].peers.values()][0];
    expect(other.name).toBe(autoName(nets[1].selfId));
    expect(other.look).toEqual(expect.objectContaining({ top: worlds[1].player.look.top }));
    worlds[1].player.x += 64;
    await tick(1);
    expect(Math.abs([...nets[0].peers.values()][0].x - worlds[1].player.x)).toBeLessThan(2);
  });

  it('les groupes privés sont séparés de la ville publique', async () => {
    const { nets, tick } = setup(3);
    await nets[0].connect({ kind: 'group', code: 'AB3CD' });
    await nets[1].connect({ kind: 'group', code: 'AB3CD' });
    await nets[2].connect({ kind: 'public' });
    await tick(0.5);
    expect(nets[0].count).toBe(1);
    expect(nets[2].count).toBe(0);
  });

  it('une ville publique pleine envoie le dernier arrivé dans la ville suivante', async () => {
    const n = ROOM_CAP + 1;
    const { nets, tick, advance } = setup(n);
    for (const net of nets) { await net.connect({ kind: 'public' }); advance(50); }
    await tick(1);
    await tick(3);
    const cities = nets.map((x) => x.city);
    expect(cities.filter((c) => c === 1)).toHaveLength(ROOM_CAP);
    expect(cities[n - 1]).toBe(2);
  });

  it('un joueur silencieux disparaît, un départ est signalé', async () => {
    const { nets, tick } = setup(2);
    await Promise.all(nets.map((x) => x.connect({ kind: 'public' })));
    await tick(0.5);
    await nets[1].disconnect();
    await tick(0.3);
    expect(nets[0].count).toBe(0);
  });

  it('mission en coopération : invitation, objets partagés, étapes partagées, récompense pour chacun', async () => {
    const weekly = readJson('missions/archive/2026-W41.json').missions[0];
    const { worlds, nets, tick } = setup(2, { weekly });
    const [A, B] = worlds;
    await Promise.all(nets.map((x) => x.connect({ kind: 'public' })));
    await tick(0.5);
    const moneyA = A.economy.money, moneyB = B.economy.money;

    // A lance la mission : B reçoit une invitation et l'accepte.
    A.missions.begin(A.missions.weekly!, 0);
    await tick(0.3);
    expect(nets[1].invite?.def.id).toBe(weekly.id);
    expect(nets[1].acceptInvite()).toBe(true);
    await tick(0.3);
    expect(B.missions.active?.def.id).toBe(weekly.id);
    expect(nets[0].partners()).toHaveLength(1);

    // Étape 1 (collecte) : chacun ramasse des fusibles, l'autre les voit disparaître.
    const targets = weekly.steps[0].targets.map((t: any) => resolveLoc(A.map, t));
    const grab = async (w: World, i: number) => { w.player.x = targets[i].x; w.player.y = targets[i].y; w.update(DT, intent()); await tick(0.3); };
    await grab(A, 0);
    expect(B.missions.active!.collectedNow()).toContain(0);
    await grab(B, 1);
    expect(A.missions.active!.collectedNow()).toEqual(expect.arrayContaining([0, 1]));
    await grab(A, 2); await grab(A, 3); await grab(B, 4);
    expect(A.missions.active!.stepIndex).toBe(1);
    expect(B.missions.active!.stepIndex).toBe(1);

    // Étape 2 (livraison) : B livre, A avance aussi.
    const usine = resolveLoc(B.map, weekly.steps[1].target);
    B.player.x = usine.x; B.player.y = usine.y; B.update(DT, intent());
    await tick(0.3);
    expect(A.missions.active!.stepIndex).toBe(2);

    // Étape 3 (parler à l'ingénieure) : A parle, la mission se termine pour les deux.
    const npc = resolveLoc(A.map, weekly.steps[2].npc.at);
    A.player.x = npc.x + 6; A.player.y = npc.y;
    A.update(DT, intent()); A.update(DT, intent({ interact: true }));
    await tick(0.5);
    expect(A.missions.isDone(weekly.id)).toBe(true);
    expect(B.missions.isDone(weekly.id)).toBe(true);
    expect(A.economy.money).toBeGreaterThan(moneyA);
    expect(B.economy.money).toBeGreaterThan(moneyB);
    expect(nets[0].session).toBeNull();
  });

  it('un échec ne concerne que le joueur qui échoue', async () => {
    const weekly = readJson('missions/archive/2026-W41.json').missions[0];
    const { worlds, nets, tick } = setup(2, { weekly });
    await Promise.all(nets.map((x) => x.connect({ kind: 'public' })));
    await tick(0.5);
    worlds[0].missions.begin(worlds[0].missions.weekly!, 0);
    await tick(0.3);
    nets[1].acceptInvite();
    await tick(0.3);
    worlds[1].missions.abort();
    await tick(0.3);
    expect(worlds[1].missions.active).toBeNull();
    expect(worlds[0].missions.active?.state).toBe('running');
  });

  it('une invitation pour une mission inconnue est ignorée', async () => {
    const { nets, tick, worlds } = setup(2);
    await Promise.all(nets.map((x) => x.connect({ kind: 'public' })));
    await tick(0.5);
    (nets[0] as any).room.send('co', { k: 'inv', sid: 'zzzz1', m: 'mission-inventee', s: 0 });
    await tick(0.2);
    expect(nets[1].invite).toBeNull();
    expect(worlds[1].missions.active).toBeNull();
  });

  it('sans transport (version intégrée), le jeu reste en solo', async () => {
    const w = makeWorld(3);
    const net = new NetSystem(w, null);
    expect(net.status).toBe('unavailable');
    await net.connect({ kind: 'public' });
    expect(net.status).toBe('unavailable');
  });
});
