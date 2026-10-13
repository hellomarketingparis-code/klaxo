import { validateSave } from '../world/World';
import type { SaveData } from '../world/World';

/** Stockage clé/valeur asynchrone. */
export interface KV {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  del(key: string): Promise<void>;
  readonly kind: string;
}

/** IndexedDB : stockage principal, persistant et hors ligne. */
export class IndexedDBStore implements KV {
  readonly kind = 'indexeddb';
  private db: Promise<IDBDatabase>;
  constructor(name = 'klaxo', private store = 'kv') {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB bloquée'));
    });
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(this.store, mode);
      const req = fn(t.objectStore(this.store));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  get(key: string) { return this.tx('readonly', (s) => s.get(key)); }
  async set(key: string, value: any) { await this.tx('readwrite', (s) => s.put(value, key)); }
  async del(key: string) { await this.tx('readwrite', (s) => s.delete(key)); }
}

/** Secours si IndexedDB est indisponible (navigation privée, stockage bloqué). */
export class LocalStorageStore implements KV {
  readonly kind = 'localstorage';
  async get(key: string) { const v = localStorage.getItem('klaxo:' + key); return v ? JSON.parse(v) : undefined; }
  async set(key: string, value: any) { localStorage.setItem('klaxo:' + key, JSON.stringify(value)); }
  async del(key: string) { localStorage.removeItem('klaxo:' + key); }
}
export class MemoryStore implements KV {
  readonly kind = 'memory';
  private m = new Map<string, any>();
  async get(key: string) { const v = this.m.get(key); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  async set(key: string, value: any) { this.m.set(key, JSON.parse(JSON.stringify(value))); }
  async del(key: string) { this.m.delete(key); }
}

/** Choisit le meilleur stockage disponible en le testant réellement. */
export async function openStore(): Promise<KV> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const s = new IndexedDBStore();
      await s.set('__probe', 1); await s.del('__probe');
      return s;
    }
  } catch { /* on essaie la suite */ }
  try {
    const s = new LocalStorageStore();
    await s.set('__probe', 1); await s.del('__probe');
    return s;
  } catch { /* stockage refusé */ }
  return new MemoryStore();
}

const SLOT = 'save-1';
const SETTINGS = 'settings';

export interface Settings {
  sound: boolean; music: boolean; volume: number; quality: 'auto' | 'low' | 'medium' | 'high'; touch: 'auto' | 'on' | 'off'; shownStorageNotice: boolean;
  /** Jeu en ligne : 'ask' tant que le joueur n'a pas choisi. */
  online: 'ask' | 'on' | 'off';
  /** Code du groupe privé ('' = ville publique). */
  netGroup: string;
}
export const DEFAULT_SETTINGS: Settings = { sound: true, music: true, volume: 0.7, quality: 'auto', touch: 'auto', shownStorageNotice: false, online: 'ask', netGroup: '' };

/** Sauvegarde automatique locale + export/import de fichier. Aucun compte, aucun serveur. */
export class SaveSystem {
  lastSavedAt = 0;
  lastError: string | null = null;
  private writing: Promise<void> = Promise.resolve();
  constructor(public store: KV) {}

  get persistent(): boolean { return this.store.kind !== 'memory'; }

  async load(): Promise<SaveData | null> {
    try {
      const s = await this.store.get(SLOT);
      return validateSave(s) ? s : null;
    } catch (e) { this.lastError = String(e); return null; }
  }
  /** Les écritures sont mises en file : jamais deux transactions concurrentes. */
  save(data: SaveData): Promise<void> {
    this.writing = this.writing.then(async () => {
      try { await this.store.set(SLOT, data); this.lastSavedAt = Date.now(); this.lastError = null; }
      catch (e) { this.lastError = String(e); }
    });
    return this.writing;
  }
  async clear(): Promise<void> { await this.writing; try { await this.store.del(SLOT); } catch (e) { this.lastError = String(e); } }
  async loadSettings(): Promise<Settings> {
    try { return { ...DEFAULT_SETTINGS, ...((await this.store.get(SETTINGS)) ?? {}) }; } catch { return { ...DEFAULT_SETTINGS }; }
  }
  async saveSettings(s: Settings): Promise<void> { try { await this.store.set(SETTINGS, s); } catch (e) { this.lastError = String(e); } }

  exportText(data: SaveData): string { return JSON.stringify({ game: 'klaxo', exportedAt: new Date().toISOString(), save: data }, null, 2); }
  /** Analyse un fichier de sauvegarde importé. Lève une erreur lisible s'il est invalide. */
  parseImport(text: string): SaveData {
    let obj: any;
    try { obj = JSON.parse(text); } catch { throw new Error('Ce fichier n’est pas un JSON valide.'); }
    const save = obj?.game === 'klaxo' ? obj.save : obj;
    if (!validateSave(save)) throw new Error('Ce fichier n’est pas une sauvegarde KLAXO valide.');
    return save;
  }
}
