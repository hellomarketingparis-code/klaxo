/** Bus d'événements minimal et typé : la simulation émet, l'affichage/l'audio/l'interface écoutent. */
export type Handler<T> = (payload: T) => void;
export class Bus<Events extends Record<string, any>> {
  private map = new Map<keyof Events, Set<Handler<any>>>();
  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) { set = new Set(); this.map.set(type, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.map.get(type);
    if (set) for (const fn of [...set]) fn(payload);
  }
  clear(): void { this.map.clear(); }
}
