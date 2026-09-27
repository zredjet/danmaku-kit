import type { Difficulty, GameDefinition, PlayerId, StageId } from "./content/types.ts";
import type { ReadonlyEntityState } from "./entities/runtime-entity.ts";
import type { ReadonlyFeatureFrameState } from "./extension/feature-frame.ts";
import type { ShootingCoreFeature } from "./extension/feature-module.ts";
import type { GameEvent } from "./events/game-event.ts";
import type { InputFrame } from "./input/input-frame.ts";
import type { CoreResult } from "./result.ts";
import type { SerializedGameState } from "./serialization/types.ts";
import type { StageStatus } from "./simulation/stage-status.ts";

/**
 * ステージ開始時に runtime adapter から渡すオプション。
 *
 * `seed` は replay determinism の入口なので、タイトル側の乱数とは分けて
 * Core に明示的に渡す。
 */
export type StartStageOptions = {
  stageId: StageId;
  difficulty: Difficulty;
  playerId?: PlayerId;
  seed: string;
};

/**
 * 1 tick 終了時点の gameplay state。
 *
 * renderer / debug HUD が読む表示用 snapshot。HP や pattern cursor のような内部 component は、
 * serialize / state hash 用の内部 DTO 側で扱い、この型へは直接混ぜない。
 */
export type ReadonlyGameState = Readonly<{
  tick: number;
  stageId: StageId;
  playerId: PlayerId;
  /** tick の終わりの stage の状態。`stageCleared` / `gameOver` の frame が stage の最後の frame になる。 */
  status: StageStatus;
  player: ReadonlyPlayerState;
  score: number;
  entities: ReadonlyArray<ReadonlyEntityState>;
  /** 有効な optional feature が出す state（pickup など）。frame に出す feature がなければ持たない。 */
  features?: ReadonlyFeatureFrameState;
}>;

/** HUD / debug が event fold なしで参照できる自機の現在状態。 */
export type ReadonlyPlayerState = Readonly<{
  lives: number;
  invincibleTicksRemaining: number;
}>;

/**
 * Core から renderer / debug / replay へ渡す 1 tick 分の出力。
 *
 * `events` はこの frame で発生した gameplay event のみを含み、DOM や audio の
 * runtime event とは混ぜない。
 */
export type GameFrame = Readonly<{
  tick: number;
  state: ReadonlyGameState;
  events: ReadonlyArray<GameEvent>;
}>;

/** `createShootingCore()` の設定。 */
export type ShootingCoreOptions = Readonly<{
  /** `ShootingCore.coreVersion` と serialize する `coreVersion`。省略すると `"0.0.0"`。 */
  coreVersion?: string;
  /**
   * 有効にできる optional feature。feature の package entry（`@shooting-sample/shooting-core/features/<feature>`）が公開する値を渡す。
   * `GameDefinition.enabledFeatures` は、ここにある feature だけを受け付ける。
   */
  features?: readonly ShootingCoreFeature[];
}>;

/**
 * renderer 非依存の shooting core 入口。
 *
 * `load()` は型上は `GameDefinition` を受けるが、JS や unsafe cast からの呼び出しも
 * runtime validation に通して immutable snapshot を保持する。
 */
export type ShootingCore = {
  coreVersion: string;
  load(definition: GameDefinition): CoreResult<LoadedGame>;
};

/**
 * 検証済みの game definition から stage session を開始する API。
 *
 * `LoadedGame` は load 後の content mutation に影響されない snapshot を参照する。
 */
export type LoadedGame = {
  /** serialized snapshot から stage session を復元し、不整合や未対応 snapshot は `CoreResult` error として返す。 */
  restore(state: SerializedGameState): CoreResult<StageSession>;
  /** stage id / difficulty / player / seed から新しい stage session を開始する。 */
  startStage(options: StartStageOptions): CoreResult<StageSession>;
};

/**
 * gameplay simulation の実行単位。
 *
 * 現時点では playing 中の fixed tick だけを扱う。pause / result / replay UI は
 * runtime lifecycle 側で管理する。`serialize()` は simulation を進めない読み取り API であり、
 * 成功時は restore 用の deep immutable snapshot を返す。state hash は committed state から
 * 別の内部 DTO を生成して計算する。
 * fatal state に入った後は `tick()` と同じ fatal error を返す。
 */
export type StageSession = {
  /** 次の fixed tick を実行し、frame state とその tick の event を返す。 */
  tick(input: InputFrame): CoreResult<GameFrame>;
  /** 現在の committed state を serialized snapshot として返す。 */
  serialize(): CoreResult<SerializedGameState>;
};
