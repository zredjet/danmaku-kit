import type {
  BulletId,
  Difficulty,
  EnabledFeature,
  EnemyId,
  PathId,
  PatternId,
  PlayerId,
  PlayerShotId,
  StageId,
} from "../content/types.ts";

/**
 * serialize 用 DTO で共有する座標・速度の plain-data 表現。
 *
 * Phase 1B-5 で追加する restore は各 field を finite number として検証する。position / velocity の
 * ように小数が自然に発生する値は整数化を要求せず、state hash では finite number の
 * canonical binary encoding に任せる。
 */
type SerializedVector2 = Readonly<{
  x: number;
  y: number;
}>;

/**
 * serialized schema 上の entity ID。Core 内部の採番実装型には依存させない。
 *
 * Phase 1B-5 で追加する restore は正の safe integer だけを受け付ける。`runtimeEntities` 内では
 * strict ascending / unique / `id < nextEntityId` を満たす必要があり、0、負数、
 * 小数、重複、`nextEntityId` 以上の値は restore 用の shape error として拒否する。
 */
export type SerializedEntityId = number;

/**
 * Pattern runner の serialized state に使う namespace 付き ID。
 *
 * Template literal 型だけでは `patternRunner.` の空 suffix を表現上排除できないため、
 * Phase 1B-5 で追加する restore runtime validation で拒否する。
 * 補助型名は root package に公開しない。将来の内部 module が runner id 型だけを
 * 再利用したい場合は、public DTO の `SerializedPatternRunnerState["runnerId"]` から取り出す。
 */
type SerializedPatternRunnerId = `patternRunner.${string}`;

/**
 * replay restore 用に公開する PRNG snapshot。
 *
 * `state` は 1..0xffffffff の uint32 として扱う。0 は xorshift の停止状態に
 * なるため不正値とし、実際の値域検証は serialize / restore 実装側で行う。
 *
 * PRNG algorithm の変更は snapshot shape ではなく `coreVersion` の互換性で扱う。
 */
export type SerializedPrngSnapshot = Readonly<{
  state: number;
}>;

/**
 * serialize DTO の extension payload で使う JSON 互換値。
 *
 * `number` は JSON として安全に永続化できる finite number だけを許可する。
 * 型だけでは `NaN` / `Infinity` を表現上排除できないため、serialize / restore の
 * runtime validation で有限値に限定する。state hash では `-0` を `+0` に正規化し、
 * finite number を IEEE-754 binary64 little-endian bytes として encode する。
 * string value と object key は lone surrogate を含まないことを Phase 1B-5 の
 * runtime validation で検証する。
 */
export type SerializedJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly SerializedJsonValue[]
  | { readonly [key: string]: SerializedJsonValue };

/**
 * serialize / restore 対象の pending event DTO。
 *
 * frame 通知用の `GameEvent` とは用途が違う。`pendingEvents` は serialize / restore を
 * またいで再通知が必要な未処理 queue だけを表すため、Phase 1B では startStage 直後に
 * 残り得る tick 0 の `stageStarted` に限定する。tick 内で発生して同 frame で drain
 * される `entitySpawned` や `scoreChanged` は `GameFrame.events` の責務に残す。
 * Phase 1B-5 で追加する restore は、top-level `expectedTick` が 0 なら top-level `stageId` と
 * 一致する `stageStarted` 1 件だけを要求し、`expectedTick` が 1 以上なら空配列だけを許可する。
 */
export type SerializedPendingEvent = Readonly<{
  type: "stageStarted";
  tick: 0;
  stageId: StageId;
}>;

/**
 * serialize 対象 entity が共通して持つ deterministic な runtime 情報。
 *
 * Phase 1B-5 で追加する restore は common field の shape に加え、position が有限座標、
 * collisionRadius が正の有限値であることを検証する。collisionRadius の上限は
 * content validation 側に同じ上限を導入する slice まで restore 専用には持たせない。
 */
type SerializedRuntimeEntityBase = Readonly<{
  id: SerializedEntityId;
  kind: "player" | "enemy" | "enemyBullet" | "playerShot";
  definitionId: string;
  position: SerializedVector2;
  collisionRadius: number;
}>;

/**
 * restore に必要な player runtime state。render-only 情報は含めない。
 *
 * Phase 1B-5 で追加する restore は lives / invincibleTicksRemaining / nextShotAllowedTick を
 * 非負 safe integer、movement speed を有限かつ content validation と同じ budget 内の値として
 * 検証する。
 */
type SerializedPlayerRuntimeEntityState = SerializedRuntimeEntityBase & Readonly<{
  kind: "player";
  definitionId: PlayerId;
  lives: number;
  invincibleTicksRemaining: number;
  nextShotAllowedTick: number;
  movement: Readonly<{
    speed: number;
    focusSpeed: number;
  }>;
  shotDefinitionId: PlayerShotId;
}>;

/**
 * restore に必要な enemy runtime state。sprite / view id は adapter 側の責務に残す。
 *
 * Phase 1B-5 で追加する restore は hp を非負 finite number、scoreOnKill を非負 safe integer として
 * 検証する。PathRunner が segment state を持つ slice では、この payload に schema version 付きの
 * path runner state を追加し、現在座標から movement state を逆算しない。
 */
type SerializedEnemyRuntimeEntityState = SerializedRuntimeEntityBase & Readonly<{
  kind: "enemy";
  definitionId: EnemyId;
  hp: number;
  scoreOnKill: number;
  pathId: PathId;
  patternId: PatternId;
}>;

/**
 * restore に必要な enemy bullet runtime state。
 *
 * Phase 1B-3 では現行 `EnemyBulletRuntimeEntity` に存在する state だけに限定する。
 * velocity / damage / lifetime を Core が所有するまでは、public DTO に未復元の
 * `projectile` state を受け入れない。
 */
type SerializedEnemyBulletRuntimeEntityState = SerializedRuntimeEntityBase & Readonly<{
  kind: "enemyBullet";
  definitionId: BulletId;
}>;

/**
 * restore に必要な player shot runtime state。
 *
 * Phase 1B-5 で追加する restore は velocity を有限値、remainingLifetimeTicks を正の safe integer、
 * damage を正の有限値として検証する。
 */
type SerializedPlayerShotRuntimeEntityState = SerializedRuntimeEntityBase & Readonly<{
  kind: "playerShot";
  definitionId: PlayerShotId;
  velocity: SerializedVector2;
  remainingLifetimeTicks: number;
  damage: number;
}>;

/**
 * serialize された runtime entity の公開 DTO。
 *
 * kind ごとの discriminated union にして、復元に不要な object pool state、
 * render-only field、view id を public contract から除外する。
 */
export type SerializedRuntimeEntityState =
  | SerializedPlayerRuntimeEntityState
  | SerializedEnemyRuntimeEntityState
  | SerializedEnemyBulletRuntimeEntityState
  | SerializedPlayerShotRuntimeEntityState;

/**
 * 将来の Pattern DSL runner が保持する deterministic state。
 *
 * Phase 1B-3 では配列を空にするが、空配列型で固定せず、schema version 付きの
 * extension payload として拡張できる余地を残す。Phase 1B-5 で追加する restore は
 * `patternRunner.` のような空 suffix の runner id を restore 用の shape error として拒否する。stateVersion は
 * 正の safe integer とし、未対応 version は module ごとの互換性 error にする。
 */
export type SerializedPatternRunnerState = Readonly<{
  runnerId: SerializedPatternRunnerId;
  patternId: PatternId;
  stateVersion: number;
  payload: SerializedJsonValue;
}>;

/**
 * optional feature module が保持する deterministic state。
 *
 * basic core では生成しないが、feature module ごとの serialized state を同じ
 * top-level contract に載せられるようにする。Phase 1B-5 で追加する restore は top-level
 * `enabledFeatures` と feature state の feature 名が一致することを検証する。feature state の欠落可否は
 * module ごとの serialized-state contract で宣言し、stateful feature は欠落を拒否する。
 * stateVersion は正の safe integer とし、未対応 version は module ごとの互換性 error にする。
 */
export type SerializedEnabledFeatureState = Readonly<{
  feature: EnabledFeature;
  stateVersion: number;
  payload: SerializedJsonValue;
}>;

/**
 * `SerializedGameState.state` 配下に閉じ込める deterministic payload。
 *
 * `runtimeEntities` は serialize 時に entity id 昇順で出力する。Phase 1B-5 で追加する restore は順序違反、
 * 重複、`nextEntityId` 以上の ID を restore 用の shape error として拒否し、
 * collision / event order の tie-breaker を保つ。
 *
 * `patternRunnerStates` と `enabledFeatureStates` はこの slice では空配列として
 * 生成するが、型は後続 module が serialized state を追加できる形にしておく。
 * Phase 1B-5 の basic core restore は両配列とも空配列だけを受け付け、非空なら
 * restore 用の shape error として拒否する。feature module 導入後に非空 state を許可する場合は、
 * `patternRunnerStates` を `runnerId` の UTF-8 byte lexicographic order 昇順、
 * `enabledFeatureStates` を top-level `enabledFeatures` と同じ canonical feature order にし、
 * 重複、順序違反、module contract 不一致を restore validation で拒否する。
 */
export type SerializedDeterministicState = Readonly<{
  runtimeEntities: ReadonlyArray<SerializedRuntimeEntityState>;
  pendingEvents: ReadonlyArray<SerializedPendingEvent>;
  score: number;
  timelineCursor: number;
  patternRunnerStates: ReadonlyArray<SerializedPatternRunnerState>;
  enabledFeatureStates: ReadonlyArray<SerializedEnabledFeatureState>;
}>;

/**
 * replay / restore の top-level serialized state。
 *
 * runtimeEntities や score などの deterministic payload は `state` 配下に置き、
 * top-level は互換性判定と session 復元に必要な metadata に限定する。
 */
export type SerializedGameState = Readonly<{
  coreVersion: string;
  schemaVersion: string;
  contentVersion: string;
  inputFormatVersion: string;
  /**
   * state hash schema の version。
   *
   * Phase 1B-4 の serialize は hash 計算実装前でも fixed version として `1` を出力する。
   * Phase 1B-6 で hash 本体を追加し、Phase 1B-5 で追加する restore は version 不一致を互換性 error にする。
   */
  stateHashVersion: number;
  /**
   * 有効 feature の canonical order。
   *
   * Phase 1B-5 の basic core restore は loaded content の `enabledFeatures` と完全一致を要求する。
   * 現行 basic content では `[]` のみが有効である。feature module 導入後も、重複を拒否し、
   * `["bomb", "graze", "affinity", "rank", "pickup", "advancedScoring"]` の canonical order に従う。
   */
  enabledFeatures: ReadonlyArray<EnabledFeature>;
  stageId: StageId;
  difficulty: Difficulty;
  playerId: PlayerId;
  /**
   * 次に受け付ける input tick。
   *
   * Phase 1B-5 で追加する restore は non-negative safe integer として検証し、小数、負数、`NaN`、
   * `Infinity`、unsafe integer を restore 用の shape error として拒否する。
   */
  expectedTick: number;
  nextEntityId: number;
  prngState: SerializedPrngSnapshot;
  state: SerializedDeterministicState;
}>;
