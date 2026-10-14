import type { VehicleType } from '../vehicles/specs';
import type { ProfileKey } from '../npc/looks';

/**
 * Format des missions (histoire, actualité hebdomadaire, événements de rue).
 * Le moteur n'interprète QUE ces mécaniques : aucun code n'est exécuté depuis les fichiers de données.
 */
export const MISSION_SCHEMA = 1;

/** Lieu : un point d'intérêt nommé (avec décalage optionnel en tuiles) ou des coordonnées en tuiles. */
export type Loc = { poi: string; dx?: number; dy?: number } | { x: number; y: number };

export interface DialogDef { who: string; text: string; }
export interface NpcDef { name: string; profile: ProfileKey; at: Loc; }
export interface ItemDef { id: string; name: string; }

export const ACTION_TYPES = ['toast', 'say', 'dialog', 'reveal', 'spawn_npc', 'spawn_vehicle', 'spawn_guards', 'despawn', 'wanted', 'sfx', 'world', 'zombies', 'cure_zombies'] as const;
export type Action =
  | { do: 'toast'; text: string }
  | { do: 'say'; who: string; text: string }
  | { do: 'dialog'; lines: DialogDef[] }
  | { do: 'reveal'; title: string; text: string }
  | { do: 'spawn_npc'; tag: string; npc: NpcDef }
  | { do: 'spawn_vehicle'; tag: string; vehicle: VehicleType; at: Loc; broken?: boolean }
  | { do: 'spawn_guards'; routes: string }
  | { do: 'despawn'; tag: string }
  | { do: 'wanted'; level: number }
  | { do: 'sfx'; name: string }
  | { do: 'world'; set: 'traffic' | 'pedestrians' | 'lights_blink' | 'robots'; value: number; seconds: number }
  /** Fait apparaître `count` zombies autour d'un lieu. `spread` : dispersion en tuiles. `aggro` : distance (tuiles) à laquelle ils repèrent le joueur. */
  | { do: 'zombies'; at: Loc; count: number; spread?: number; aggro?: number }
  /** Guérit tous les zombies de la mission : ils redeviennent des habitants ordinaires. */
  | { do: 'cure_zombies' };

export const STEP_TYPES = ['talk', 'goto', 'pickup', 'get_vehicle', 'deliver', 'tail', 'observe', 'leave', 'lose_wanted', 'collect', 'checkpoints', 'passengers', 'wait'] as const;
export type StepType = (typeof STEP_TYPES)[number];
export const FAIL_CONDS = ['detected', 'wanted'] as const;
export type FailCond = (typeof FAIL_CONDS)[number];
export type MoveMode = 'any' | 'foot' | 'vehicle';

export interface StepBase {
  type: StepType;
  objective: string;
  /** Durée maximale en secondes. */
  timeLimit?: number;
  failIf?: FailCond[];
  onStart?: Action[];
  onComplete?: Action[];
  /** Événements déclenchés après `at` secondes dans l'étape. */
  events?: { at: number; do: Action[] }[];
  /** Point de reprise après rechargement. */
  checkpoint?: boolean;
}
export interface TalkStep extends StepBase { type: 'talk'; npc: NpcDef; tag?: string; lines: DialogDef[]; }
export interface GotoStep extends StepBase { type: 'goto'; target: Loc; radius?: number; mode?: MoveMode; }
export interface PickupStep extends StepBase { type: 'pickup'; target: Loc; item: ItemDef; }
export interface GetVehicleStep extends StepBase { type: 'get_vehicle'; vehicle?: VehicleType; }
export interface DeliverStep extends StepBase { type: 'deliver'; target: Loc; radius?: number; mode?: MoveMode; item?: ItemDef; fragile?: { max: number }; }
export interface TailStep extends StepBase {
  type: 'tail'; vehicle: VehicleType; color?: string; route: Loc[]; speed: number;
  /** Distances limites en pixels. */
  min: number; max: number;
  objectiveFollow?: string;
}
export interface ObserveStep extends StepBase { type: 'observe'; target: Loc; radius?: number; seconds: number; mode?: MoveMode; /** Nom de la jauge (par défaut « Observation »). */ label?: string; }
export interface LeaveStep extends StepBase { type: 'leave'; target: Loc; radius: number; }
export interface LoseWantedStep extends StepBase { type: 'lose_wanted'; }
export interface CollectStep extends StepBase { type: 'collect'; targets: Loc[]; item: ItemDef; radius?: number; mode?: MoveMode; }
export interface CheckpointsStep extends StepBase { type: 'checkpoints'; targets: Loc[]; radius?: number; mode?: MoveMode; }
export interface PassengersStep extends StepBase { type: 'passengers'; fares: { name: string; from: Loc; to: Loc; line?: string; profile?: ProfileKey }[]; }
export interface WaitStep extends StepBase { type: 'wait'; seconds: number; }
export type Step = TalkStep | GotoStep | PickupStep | GetVehicleStep | DeliverStep | TailStep | ObserveStep | LeaveStep | LoseWantedStep | CollectStep | CheckpointsStep | PassengersStep | WaitStep;

export interface MissionDef {
  schema: 1;
  id: string;
  kind: 'story' | 'weekly' | 'side';
  title: string;
  /** Résumé affiché dans les menus. */
  summary: string;
  giver: NpcDef;
  intro: DialogDef[];
  /** Actions exécutées au lancement et à chaque reprise (ex. placer les gardes). */
  setup?: Action[];
  steps: Step[];
  outro?: DialogDef[];
  /** Texte de chute affiché en grand à la réussite. */
  punchline?: { title: string; text: string };
  reward: { money: number; xp: number };
  /** Morsures de zombies tolérées avant l'échec (3 par défaut s'il y a des zombies). */
  bites?: number;
  requires?: { missions?: string[]; level?: number };
  /** Mission d'actualité : fait réel qui l'a inspirée. */
  news?: { headline: string; source: string; url: string; date: string; category: string };
  publishedAt?: string;
  expiresAt?: string;
}

export interface MissionFile { schema: 1; generatedAt?: string; missions: MissionDef[]; }
export interface ArchiveIndex { schema: 1; items: { id: string; title: string; week: string; file: string; headline?: string }[]; }

export const isPoiLoc = (l: Loc): l is { poi: string; dx?: number; dy?: number } => typeof (l as any).poi === 'string';
