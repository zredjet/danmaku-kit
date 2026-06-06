/** basic core が直接扱う難易度。 */
export type Difficulty = "normal" | "hard";

/**
 * optional module の feature 名。
 *
 * basic core では型として名前だけ共有し、実行時は `enabledFeatures: []` のみ許可する。
 */
export const KNOWN_ENABLED_FEATURES = ["bomb", "graze", "affinity", "rank", "pickup", "advancedScoring"] as const;
export type EnabledFeature = (typeof KNOWN_ENABLED_FEATURES)[number];

/** 自機定義の namespace 付き ID。 */
export type PlayerId = `player.${string}`;
/** ステージ定義の namespace 付き ID。 */
export type StageId = `stage.${string}`;
/** 敵定義の namespace 付き ID。 */
export type EnemyId = `enemy.${string}`;
/** 敵弾定義の namespace 付き ID。 */
export type BulletId = `bullet.${string}`;
/** プレイヤーショット定義の namespace 付き ID。 */
export type PlayerShotId = `playerShot.${string}`;
/** pattern 定義の namespace 付き ID。 */
export type PatternId = `pattern.${string}`;
/** path 定義の namespace 付き ID。 */
export type PathId = `path.${string}`;

/**
 * runtime adapter が解決できる asset key の一覧。
 *
 * Core は画像や音声をロードしないが、content が存在しない asset を参照していないかは検証する。
 */
export type AssetKeyRegistry = {
  keys: readonly string[];
};

/**
 * 自機性能の最小 content 定義。
 *
 * Bomb / Graze は optional feature 側へ隔離し、basic core では移動・当たり判定・
 * ライフ・通常ショットだけを必須にする。
 */
export type PlayerDefinition = {
  id: PlayerId;
  version: number;
  asset: string;
  movement: {
    speed: number;
    focusSpeed: number;
  };
  collision: {
    radius: number;
  };
  life: {
    initialLives: number;
    invincibleTicksAfterHit: number;
  };
  shot: {
    definition: PlayerShotId;
  };
};

/**
 * ステージの最小 content 定義。
 *
 * basic core では clear 条件や boss phase は持たず、timeline から敵の spawn 参照を
 * 解決できることを最低ラインにする。
 */
export type StageDefinition = {
  id: StageId;
  version: number;
  difficulties: readonly Difficulty[];
  timeline: readonly StageTimelineStep[];
};

/** 固定 tick 上で実行される stage timeline の 1 手順。 */
export type StageTimelineStep = {
  tick: number;
  action: StageTimelineAction;
};

/**
 * basic core の timeline action。
 *
 * まずは敵 spawn のみを許可し、enemy / path / pattern の参照検証を Core 側で行う。
 */
export type StageTimelineAction = {
  type: "spawnEnemy";
  enemy: EnemyId;
  path: PathId;
  pattern: PatternId;
  position: {
    x: number;
    y: number;
  };
};

/** 敵の最小 content 定義。score は basic scoreOnKill で使う固定値。 */
export type EnemyDefinition = {
  id: EnemyId;
  version: number;
  asset: string;
  collision: {
    radius: number;
  };
  hp: number;
  score: number;
};

/** 敵弾の最小 content 定義。弾速や弾幕は pattern 側で拡張する。 */
export type BulletDefinition = {
  id: BulletId;
  version: number;
  asset: string;
  collision: {
    radius: number;
  };
};

/** プレイヤーショットの最小 content 定義。 */
export type PlayerShotDefinition = {
  id: PlayerShotId;
  version: number;
  asset: string;
  collision: {
    radius: number;
  };
  damage: number;
};

/** 弾幕・移動命令の参照先。命令本体は Phase 2A 以降で追加する。 */
export type PatternDefinition = {
  id: PatternId;
  version: number;
};

/** enemy spawn 時に使う path の参照先。path 本体は後続スライスで追加する。 */
export type PathDefinition = {
  id: PathId;
  version: number;
};

/**
 * 1 title / 1 content pack が Core へ渡す registry。
 *
 * 配列順は deterministic な処理順へ影響しうるため、load 時に validated snapshot として固定する。
 */
export type ContentRegistry = {
  version: string;
  assetKeys: AssetKeyRegistry;
  players: readonly PlayerDefinition[];
  stages: readonly StageDefinition[];
  enemies: readonly EnemyDefinition[];
  bullets: readonly BulletDefinition[];
  playerShots: readonly PlayerShotDefinition[];
  patterns: readonly PatternDefinition[];
  paths: readonly PathDefinition[];
};

/**
 * Core にロードする game definition の最上位構造。
 *
 * `schemaVersion` と `content.version` は replay 互換性の判断材料になる。
 */
export type GameDefinition = {
  schemaVersion: string;
  enabledFeatures: readonly EnabledFeature[];
  defaultPlayerId: PlayerId;
  content: ContentRegistry;
};
