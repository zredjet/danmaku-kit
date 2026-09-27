/** basic core が直接扱う難易度。 */
export type Difficulty = "normal" | "hard";

/** `Difficulty` の実行時一覧。validator は未検証の値をこの一覧で判定する。 */
export const KNOWN_DIFFICULTIES = Object.freeze(["normal", "hard"] as const satisfies readonly Difficulty[]);

/** 未検証の値が basic core の難易度かを判定する。 */
export function isKnownDifficulty(value: unknown): value is Difficulty {
  return (KNOWN_DIFFICULTIES as readonly unknown[]).includes(value);
}

/**
 * optional module の feature 名。
 *
 * basic core では型として名前だけ共有し、実行時は `enabledFeatures: []` のみ許可する。
 */
export const KNOWN_ENABLED_FEATURES = Object.freeze(["bomb", "graze", "affinity", "rank", "pickup", "advancedScoring"] as const);
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
  fire: {
    intervalTicks: number;
  };
  projectile: {
    velocity: {
      x: number;
      y: number;
    };
    lifetimeTicks: number;
  };
};

/**
 * 敵 pattern の content 定義。
 *
 * `fireOnSpawn` は spawn 直後に 1 batch だけ敵弾を生成する最小形、`steps` は `wait` / `fire` / `loop` / `repeat` の命令列
 * （PatternProgram）で、1 つの pattern ではどちらか一方だけを使う。`parallel`、`set`、`move`、`randomSpread` などは後続の DSL で扱う。
 */
export type PatternDefinition = {
  id: PatternId;
  version: number;
  /** spawn tick から実行する命令列。`fireOnSpawn` とは同時に指定できない。 */
  steps?: readonly PatternStepDefinition[];
  fireOnSpawn?: {
    bullet: BulletId;
    offset: {
      x: number;
      y: number;
    };
    /** 敵弾の速度（px / tick）。省略した敵弾は動かない。 */
    velocity?: {
      x: number;
      y: number;
    };
  };
};

/** pattern の 1 命令。1 step は `wait`、`fire`、`loop`、`repeat` のどれか 1 つの key だけを持つ。 */
export type PatternStepDefinition =
  | {
    /** 次の命令を実行するまで待つ tick 数。 */
    wait: number;
  }
  | {
    fire: PatternFireDefinition;
  }
  | {
    /**
     * 同じ tick のうちに戻る top-level の step index。戻った先から loop までの間に `wait` を含む必要がある。`repeat` の `steps` の中には
     * 置けない。
     */
    loop: number;
  }
  | {
    repeat: PatternRepeatDefinition;
  };

/**
 * `steps` を `count` 回続けて実行する命令。load 時に展開して PatternProgram の run に正規化するため、runner の状態は増えない。
 *
 * `steps` には `wait`、`fire`、`repeat` を置ける（`loop` は置けない）。
 */
export type PatternRepeatDefinition = {
  count: number;
  steps: readonly PatternStepDefinition[];
};

/**
 * pattern の発射命令。
 *
 * 向きは自機を狙う `aim: player` か、+x を 0°、+y（下）へ回る向きを正とする `angleDeg` のどちらか一方で指定し、0.25° 刻みの角度
 * step にそろえる。`fan` は基準の向きを中心に `count` 発を、最初と最後の弾の間が `spreadDeg` になるよう等間隔に並べ、`radial` は
 * 基準の向きから 1 周を `count` 等分した向きに並べる（`fan` と `radial` はどちらか一方）。`stream` は各向きに、`speed` から
 * `speedStep` ずつ変えた速さの弾を `count` 発重ねる。
 */
export type PatternFireDefinition = {
  bullet: BulletId;
  /** 発射元。現在は発射する enemy の位置だけを扱う。 */
  origin?: "self";
  /** 敵弾の速さ（px / tick）。`stream` では最初の弾の速さ。 */
  speed: number;
  fan?: {
    count: number;
    spreadDeg: number;
  };
  radial?: {
    /** 1 周を等分する弾数。360° を `count` で割った角度が 0.25° の倍数になる数だけを受け付ける。 */
    count: number;
  };
  stream?: {
    count: number;
    /** 次の弾へ足す速さ（px / tick）。負なら遅くなる。すべての弾の速さが正で上限以下になる必要がある。 */
    speedStep: number;
  };
} & (
  | {
    aim: "player";
    angleDeg?: never;
  }
  | {
    angleDeg: number;
    aim?: never;
  }
);

/**
 * enemy の移動 path。
 *
 * `segments` を先頭から順に実行し、各 segment は `duration` tick の間 `velocity` で等速移動する。segment 内の位置は
 * segment 開始位置 `p0` と経過 tick `t` から `p0 + velocity * t` として求め、`offset` を持つ segment はその sine の変位を足す。
 * `segments` を省略するか空にした path は動かない。
 */
export type PathDefinition = {
  id: PathId;
  version: number;
  segments?: readonly PathSegmentDefinition[];
};

/** path の 1 区間。 */
export type PathSegmentDefinition = {
  type: "velocity";
  duration: number;
  velocity: {
    x: number;
    y: number;
  };
  offset?: PathSineOffsetDefinition;
};

/**
 * segment の基本位置に足す sine の相対変位（design 9.8）。速度は変えない。
 *
 * segment 内経過 tick `t` の変位は `amplitude * sin(floor(t * 1440 / periodTicks) step)` で、sine は決定的な表から引く。
 */
export type PathSineOffsetDefinition = {
  type: "sine";
  axis: "x" | "y";
  amplitude: number;
  periodTicks: number;
};

/**
 * 1 title / 1 content pack が Core へ渡す registry。
 *
 * 配列順は deterministic な処理順へ影響しうるため、load 時に validated snapshot として固定する。
 */
export type ContentRegistry = {
  /**
   * title / content pack をまたいで一意な immutable release identity。
   * 単なるローカル連番は使わず、同じ値を異なる content payload に再利用しない。
   */
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
