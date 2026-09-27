import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { MAX_ALLOCATED_ENTITY_ID, MAX_RESTORABLE_NEXT_ENTITY_ID } from "./entity-id-budget.ts";

/** Core 内で deterministic order を作るための entity ID。 */
export type EntityId = number;

/** Core minimum の entity 共通部分。component は後続スライスで増やす。 */
export type Entity = {
  id: EntityId;
};

/**
 * monotonic な entity ID 採番器。
 *
 * ID は collision resolution や event order の tie-breaker になるため、再利用せず昇順で採番する。
 */
export class EntityAllocator {
  #nextEntityId = 1;

  /** 新しい entity ID を割り当てる。 */
  create(): CoreResult<Entity> {
    if (this.#nextEntityId > MAX_ALLOCATED_ENTITY_ID) {
      return coreError("entityAllocator.invalidState", "nextEntityId exceeded the safe deterministic range");
    }
    return okResult({ id: this.#nextEntityId++ });
  }

  /**
   * count 件の ID を副作用なしで割り当て可能か検査する。
   *
   * batch spawn は途中まで採番してから失敗すると replay order が崩れるため、
   * 実際に `create()` を呼ぶ前にこの検査で全件分の余地を確認する。
   */
  canAllocate(count: number): CoreResult<null> {
    if (!Number.isSafeInteger(count) || count < 0) {
      return coreError("entityAllocator.invalidState", "allocation count must be a non-negative safe integer");
    }

    const remaining = MAX_ALLOCATED_ENTITY_ID - this.#nextEntityId + 1;
    if (count > remaining) {
      return coreError("entityAllocator.invalidState", "nextEntityId exceeded the safe deterministic range");
    }

    return okResult(null);
  }

  /** serialize / state hash 用に次に割り当てる ID を取り出す。 */
  snapshot(): number {
    return this.#nextEntityId;
  }

  /** snapshot から採番器を復元する。 */
  static restore(nextEntityId: number): CoreResult<EntityAllocator> {
    if (!Number.isSafeInteger(nextEntityId) || nextEntityId < 1 || nextEntityId > MAX_RESTORABLE_NEXT_ENTITY_ID) {
      return coreError("entityAllocator.invalidState", "nextEntityId must be a positive safe integer");
    }

    const allocator = new EntityAllocator();
    allocator.#nextEntityId = nextEntityId;
    return okResult(allocator);
  }
}
