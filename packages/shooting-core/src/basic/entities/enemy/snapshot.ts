import type { EnemyDefinition, EnemyId, PathId, PatternDefinition, PatternId } from "../../content/types.ts";
import { defineFieldOrder } from "../../shared/field-order.ts";
import type { PathRunnerState } from "../../simulation/path-runner.ts";
import type { HashableVector2, SerializedRuntimeEntityBase, SerializedVector2 } from "../snapshot-common.ts";
import type { EnemyRuntimeEntity } from "./model.ts";

/**
 * enemy の path 上の進行状態（PathRunner）。
 *
 * restore は現在座標から path movement を逆算せず、この state が処理済み timeline の spawn 位置と経過 tick から path を
 * 進めた結果と一致することを検証する。
 */
export type SerializedEnemyPathRunnerState = Readonly<{
  segmentIndex: number;
  segmentStart: SerializedVector2;
  segmentElapsedTicks: number;
}>;

/**
 * restore に必要な enemy runtime state。sprite / view id は adapter 側の責務に残す。
 *
 * restore は active enemy hp を正の finite number かつ EnemyDefinition の初期 hp 以下、scoreOnKill / collisionRadius /
 * pathId / patternId は loaded EnemyDefinition と同じ immutable field として検証する。position と pathRunnerState は、
 * 処理済み timeline の spawn から path を進めた結果と一致することを要求する。
 */
export type SerializedEnemyRuntimeEntityState = SerializedRuntimeEntityBase & Readonly<{
  kind: "enemy";
  definitionId: EnemyId;
  hp: number;
  scoreOnKill: number;
  pathId: PathId;
  patternId: PatternId;
  pathRunnerState: SerializedEnemyPathRunnerState;
}>;

/** enemy runtime entity を public serialize 用 DTO に写す。 */
export function projectEnemyRuntimeEntityForSerializedState(
  entity: EnemyRuntimeEntity,
): SerializedEnemyRuntimeEntityState {
  return {
    id: entity.id,
    kind: "enemy",
    definitionId: entity.definitionId,
    position: { x: entity.position.x, y: entity.position.y },
    collisionRadius: entity.collisionRadius,
    hp: entity.hp,
    scoreOnKill: entity.scoreOnKill,
    pathId: entity.pathId,
    patternId: entity.patternId,
    pathRunnerState: {
      segmentIndex: entity.pathRunnerState.segmentIndex,
      segmentStart: {
        x: entity.pathRunnerState.segmentStart.x,
        y: entity.pathRunnerState.segmentStart.y,
      },
      segmentElapsedTicks: entity.pathRunnerState.segmentElapsedTicks,
    },
  };
}

/** Hash 対象の enemy path runner state。vector と別 fixedStruct として encode する。 */
export type HashableEnemyPathRunnerState = Readonly<{
  segmentIndex: number;
  segmentStart: HashableVector2;
  segmentElapsedTicks: number;
}>;

/** HashableEnemyPathRunnerState の canonical encoding 順を固定する。 */
export const HASHABLE_ENEMY_PATH_RUNNER_STATE_FIELD_ORDER = defineFieldOrder<
  HashableEnemyPathRunnerState,
  PathRunnerState
>()([
  "segmentIndex",
  "segmentStart",
  "segmentElapsedTicks",
]);

/** HashableGameState に含める enemy runtime entity の内部 hash 専用 DTO。 */
export type HashableEnemyRuntimeEntityState = Readonly<{
  id: number;
  kind: "enemy";
  definitionId: EnemyDefinition["id"];
  position: HashableVector2;
  collisionRadius: number;
  hp: number;
  scoreOnKill: number;
  pathId: PathId;
  patternId: PatternDefinition["id"];
  pathRunnerState: HashableEnemyPathRunnerState;
}>;

/** enemy runtime entity の hash DTO field を canonical encoding 順に固定する。 */
export const HASHABLE_ENEMY_RUNTIME_ENTITY_FIELD_ORDER = defineFieldOrder<
  HashableEnemyRuntimeEntityState,
  EnemyRuntimeEntity
>()([
  "id",
  "kind",
  "definitionId",
  "position",
  "collisionRadius",
  "hp",
  "scoreOnKill",
  "pathId",
  "patternId",
  "pathRunnerState",
]);

/** enemy runtime entity を hash 専用 DTO へ明示的に写す。 */
export function projectEnemyRuntimeEntityForHashableState(entity: EnemyRuntimeEntity): HashableEnemyRuntimeEntityState {
  return {
    id: entity.id,
    kind: "enemy",
    definitionId: entity.definitionId,
    position: { x: entity.position.x, y: entity.position.y },
    collisionRadius: entity.collisionRadius,
    hp: entity.hp,
    scoreOnKill: entity.scoreOnKill,
    pathId: entity.pathId,
    patternId: entity.patternId,
    pathRunnerState: {
      segmentIndex: entity.pathRunnerState.segmentIndex,
      segmentStart: {
        x: entity.pathRunnerState.segmentStart.x,
        y: entity.pathRunnerState.segmentStart.y,
      },
      segmentElapsedTicks: entity.pathRunnerState.segmentElapsedTicks,
    },
  };
}
