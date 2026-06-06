import { deepFreezeClone } from "../internal/immutable.ts";
import type { EnemyId, PathId, PatternId, StageId } from "../content/types.ts";
import type { EntityId } from "../simulation/entity.ts";

/**
 * Core が生成する gameplay event。
 *
 * 描画・音声・DOM の都合で発生する runtime event はここに混ぜない。
 */
export type GameEvent =
  | Readonly<{
    type: "stageStarted";
    tick: number;
    stageId: StageId;
  }>
  | Readonly<{
    type: "tickAdvanced";
    tick: number;
  }>
  | Readonly<{
    type: "entitySpawned";
    tick: number;
    entityId: EntityId;
    entityKind: "enemy";
    definitionId: EnemyId;
    path: PathId;
    pattern: PatternId;
    position: Readonly<{
      x: number;
      y: number;
    }>;
  }>;

/**
 * 1 frame 分の event を集める小さな buffer。
 *
 * replay/debug で過去 frame が汚染されないよう、push と drain の両方で immutable
 * snapshot を作る。
 */
export class EventLog {
  #events: GameEvent[] = [];

  /** 現在 tick で発生した gameplay event を追加する。 */
  push(event: GameEvent): void {
    this.#events.push(deepFreezeClone(event));
  }

  /** 蓄積済み event を immutable array として返し、buffer を空にする。 */
  drain(): ReadonlyArray<GameEvent> {
    const drained = deepFreezeClone(this.#events);
    this.#events = [];
    return drained;
  }
}
