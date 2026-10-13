/**
 * Pair-à-pair réel entre navigateurs (WebRTC), via la bibliothèque Trystero.
 * La mise en relation passe par des relais publics du réseau Nostr ; ensuite, les données de jeu
 * circulent directement d'un appareil à l'autre, chiffrées. Aucun serveur à payer ni à administrer.
 *
 * Chargé à la demande (import dynamique) : le jeu solo ne télécharge pas ce code.
 */
import type { Channel } from './protocol';
import { APP_ID, CHANNELS } from './protocol';
import type { Handler, NetRoom, Transport } from './transport';

export function trysteroTransport(): Transport {
  return {
    kind: 'p2p',
    async join(roomId) {
      const lib = await import('trystero');
      const handlers = new Map<Channel, Handler[]>();
      const joins: ((id: string) => void)[] = [];
      const leaves: ((id: string) => void)[] = [];
      const room = lib.joinRoom({ appId: APP_ID }, roomId, {
        onJoinError: (e) => console.warn('[net] connexion impossible avec un joueur :', e.error),
      });
      const actions = new Map<Channel, { send: (data: any, opts?: any) => Promise<void> }>();
      for (const ch of CHANNELS) {
        const act = room.makeAction<any>(ch);
        act.onMessage = (data, ctx) => { for (const h of handlers.get(ch) ?? []) { try { h(data, ctx.peerId); } catch (e) { console.warn('[net] message ignoré', e); } } };
        actions.set(ch, act);
      }
      room.onPeerJoin = (id) => joins.forEach((f) => f(id));
      room.onPeerLeave = (id) => leaves.forEach((f) => f(id));
      const api: NetRoom = {
        selfId: lib.selfId,
        send(ch, data, to) { actions.get(ch)?.send(data as any, to ? { target: to } : undefined).catch(() => {}); },
        on(ch, cb) { const l = handlers.get(ch) ?? []; l.push(cb); handlers.set(ch, l); },
        onJoin(cb) { joins.push(cb); },
        onLeave(cb) { leaves.push(cb); },
        peers: () => Object.keys(room.getPeers()),
        leave: () => room.leave(),
      };
      return api;
    },
  };
}
