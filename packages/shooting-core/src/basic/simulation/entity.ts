import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";

const MAX_ALLOCATED_ENTITY_ID = Number.MAX_SAFE_INTEGER - 1;
const MAX_RESTORABLE_NEXT_ENTITY_ID = MAX_ALLOCATED_ENTITY_ID + 1;

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
