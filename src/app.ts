import type { World, SaveData } from './world/World';
import type { GameScene } from './scenes/GameScene';
import type { InputSystem } from './input/Input';
import type { AudioSystem } from './audio/AudioSystem';
import type { SaveSystem, Settings } from './save/SaveSystem';
import type { Look } from './npc/looks';
import type { MissionDef, ArchiveIndex } from './missions/schema';
import type { WeeklyChangesFile } from './weekly/WorldModifiers';
import type { NetSystem, NetTarget } from './net/NetSystem';

/** Ce que l'interface connaît de l'application. */
export interface App {
  world: World;
  scene: GameScene | null;
  input: InputSystem;
  audio: AudioSystem;
  save: SaveSystem;
  settings: Settings;
  /** Sauvegarde trouvée au démarrage (null si aucune). */
  saveInfo: SaveData | null;
  weekly: { mission: MissionDef | null; changes: WeeklyChangesFile | null; archive: ArchiveIndex; online: boolean };
  touchMode: boolean;
  /** Vrai si le navigateur autorise le téléchargement de fichiers (faux dans certains cadres intégrés). */
  canDownload: boolean;
  playing: boolean;
  newGame(look: Look, name: string): void;
  continueGame(): void;
  toMenu(): void;
  saveNow(reason: string): Promise<void>;
  applySettings(): void;
  importSave(data: SaveData): Promise<void>;
  resetSave(): Promise<void>;
  fetchArchive(file: string): Promise<MissionDef | null>;
  setPaused(on: boolean): void;
  /** Jeu en ligne. */
  net: NetSystem;
  goOnline(target: NetTarget): void;
  goOffline(): void;
  /** Code de groupe reçu par un lien d'invitation (?groupe=CODE), en attente d'entrée en jeu. */
  pendingInvite: string | null;
  /** Image de la scène actuelle (pour les cartes de partage). */
  snapshot(): Promise<HTMLImageElement | null>;
}
