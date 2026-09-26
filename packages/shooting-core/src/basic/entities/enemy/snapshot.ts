import type { EnemyId, PathId, PatternId } from "../../content/types.ts";
import type { SerializedRuntimeEntityBase } from "../snapshot-common.ts";
import type { EnemyRuntimeEntity } from "./model.ts";

/**
 * restore に必要な enemy runtime state。sprite / view id は adapter 側の責務に残す。
 *
 * Phase 1B-5 で追加する restore は active enemy hp を正の finite number かつ EnemyDefinition
 * の初期 hp 以下、scoreOnKill / collisionRadius / pathId / patternId は loaded EnemyDefinition
 * と同じ immutable field として検証する。PathRunner が segment state を持つ slice では、この payload に
 * schema version 付きの path runner state を追加し、現在座標から movement state を逆算しない。
 */
export type SerializedEnemyRuntimeEntityState = SerializedRuntimeEntityBase & Readonly<{
  kind: "enemy";
  definitionId: EnemyId;
  hp: number;
  scoreOnKill: number;
  pathId: PathId;
  patternId: PatternId;
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
  };
}
