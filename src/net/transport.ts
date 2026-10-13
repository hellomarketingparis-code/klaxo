/**
 * Transports réseau. Le jeu ne parle qu'à cette interface :
 * - `trysteroTransport` (fichier trystero.ts) : vrai pair-à-pair WebRTC entre navigateurs, en production ;
 * - `localTransport` : onglets d'un même navigateur (BroadcastChannel), pour le développement et les tests ;
 * - `memoryHub` : en mémoire, pour les tests automatisés sans navigateur.
 */
import type { Channel } from './protocol';
import { CHANNELS } from './protocol';

export type Handler = (data: unknown, from: string) => void;
export interface NetRoom {
  readonly selfId: string;
  send(ch: Channel, data: unknown, to?: string): void;
  on(ch: Channel, cb: Handler): void;
  onJoin(cb: (peerId: string) => void): void;
  onLeave(cb: (peerId: string) => void): void;
  peers(): string[];
  leave(): Promise<void>;
}
export interface Transport { readonly kind: string; join(roomId: string): Promise<NetRoom>; }

const randomId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

/** Petite base commune : gestion des abonnés. */
class Listeners {
  handlers = new Map<Channel, Handler[]>();
  joins: ((id: string) => void)[] = [];
  leaves: ((id: string) => void)[] = [];
  emit(ch: Channel, data: unknown, from: string): void { for (const h of this.handlers.get(ch) ?? []) { try { h(data, from); } catch (e) { console.warn('[net] message ignoré', e); } } }
  on(ch: Channel, cb: Handler): void { const l = this.handlers.get(ch) ?? []; l.push(cb); this.handlers.set(ch, l); }
}

// ---------- En mémoire (tests) ----------
interface HubMember { id: string; room: string; l: Listeners; }
/** Réseau simulé : tous les membres d'une même salle se voient. Les messages arrivent de façon asynchrone. */
export function memoryHub(): { transport: () => Transport; flush: () => Promise<void> } {
  const members: HubMember[] = [];
  let pending: (() => void)[] = [];
  const later = (fn: () => void) => { pending.push(fn); };
  const flush = async () => { for (let k = 0; k < 20 && pending.length; k++) { const p = pending; pending = []; for (const f of p) f(); await Promise.resolve(); } };
  const transport = (): Transport => ({
    kind: 'memory',
    async join(room) {
      const me: HubMember = { id: randomId(), room, l: new Listeners() };
      const others = () => members.filter((m) => m.room === room && m !== me);
      for (const o of others()) { later(() => o.l.joins.forEach((f) => f(me.id))); later(() => me.l.joins.forEach((f) => f(o.id))); }
      members.push(me);
      return {
        selfId: me.id,
        send(ch, data, to) {
          const copy = JSON.parse(JSON.stringify(data ?? null));
          for (const o of others()) if (!to || o.id === to) later(() => o.l.emit(ch, copy, me.id));
        },
        on: (ch, cb) => me.l.on(ch, cb),
        onJoin: (cb) => { me.l.joins.push(cb); },
        onLeave: (cb) => { me.l.leaves.push(cb); },
        peers: () => others().map((o) => o.id),
        async leave() {
          const i = members.indexOf(me);
          if (i >= 0) members.splice(i, 1);
          for (const o of members.filter((m) => m.room === room)) later(() => o.l.leaves.forEach((f) => f(me.id)));
        },
      };
    },
  });
  return { transport, flush };
}

// ---------- Onglets d'un même navigateur ----------
interface LocalPacket { room: string; from: string; to?: string; kind: 'hello' | 'beat' | 'bye' | 'msg'; ch?: Channel; data?: unknown; }
/** Plusieurs onglets du même navigateur jouent ensemble (développement, tests de bout en bout). */
export function localTransport(busName = 'klaxo-local'): Transport {
  return {
    kind: 'local',
    async join(room) {
      const id = randomId();
      const bc = new BroadcastChannel(busName);
      const l = new Listeners();
      const seen = new Map<string, number>();
      const post = (p: Omit<LocalPacket, 'room' | 'from'>) => bc.postMessage({ room, from: id, ...p });
      const touch = (peer: string) => {
        const isNew = !seen.has(peer);
        seen.set(peer, Date.now());
        if (isNew) { l.joins.forEach((f) => f(peer)); post({ kind: 'hello', to: peer }); }
      };
      bc.onmessage = (ev: MessageEvent<LocalPacket>) => {
        const p = ev.data;
        if (!p || p.room !== room || p.from === id || (p.to && p.to !== id)) return;
        if (p.kind === 'bye') { if (seen.delete(p.from)) l.leaves.forEach((f) => f(p.from)); return; }
        touch(p.from);
        if (p.kind === 'msg' && p.ch && CHANNELS.includes(p.ch)) l.emit(p.ch, p.data, p.from);
      };
      const beat = setInterval(() => {
        post({ kind: 'beat' });
        const now = Date.now();
        for (const [peer, t] of seen) if (now - t > 4000) { seen.delete(peer); l.leaves.forEach((f) => f(peer)); }
      }, 1000);
      post({ kind: 'hello' });
      return {
        selfId: id,
        send: (ch, data, to) => post({ kind: 'msg', ch, data, to }),
        on: (ch, cb) => l.on(ch, cb),
        onJoin: (cb) => { l.joins.push(cb); },
        onLeave: (cb) => { l.leaves.push(cb); },
        peers: () => [...seen.keys()],
        async leave() { clearInterval(beat); post({ kind: 'bye' }); bc.close(); },
      };
    },
  };
}
