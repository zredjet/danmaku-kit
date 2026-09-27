import type { Difficulty, EnabledFeature, PatternId, PlayerId, StageId } from "../content/types.ts";
import type { SerializedEnemyBulletRuntimeEntityState } from "../entities/enemy-bullet/snapshot.ts";
import type { SerializedEnemyRuntimeEntityState } from "../entities/enemy/snapshot.ts";
import type { SerializedPlayerShotRuntimeEntityState } from "../entities/player-shot/snapshot.ts";
import type { SerializedPlayerRuntimeEntityState } from "../entities/player/snapshot.ts";
import type { StageStatus } from "../simulation/stage-status.ts";

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
 * `runtimeEntities` は serialize 時に entity id 昇順で出力する。Phase 1B-5 の restore は順序違反、
 * 重複、`nextEntityId` 以上の ID、同 tick の system order から作れない ID 並び、
 * 到達不能な `nextEntityId` envelope を restore 用の shape error として拒否し、
 * collision / event order の tie-breaker を保つ。`score` は fixed scoreOnKill の合計なので、
 * non-negative safe integer として検証する。
 *
 * `patternRunnerStates` は `steps` を持つ pattern の enemy ごとの runner を `runnerId` の UTF-8 byte lexicographic order 昇順に、
 * `enabledFeatureStates` は有効な feature ごとに 1 つの state を top-level `enabledFeatures` と同じ canonical feature order に並べる
 * （Phase 2B-4）。restore は feature state の重複と順序違反を `state.invalidShape`、余分、欠落、module のない feature、`stateVersion`
 * の不一致を `state.featureMismatch` にし、payload は feature module が検証する。
 */
export type SerializedDeterministicState = Readonly<{
  runtimeEntities: ReadonlyArray<SerializedRuntimeEntityState>;
  pendingEvents: ReadonlyArray<SerializedPendingEvent>;
  score: number;
  timelineCursor: number;
  /** 直前の tick の終わりの stage の状態。player の残機、timeline と active enemy から決まる値と一致する。 */
  stageStatus: StageStatus;
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
