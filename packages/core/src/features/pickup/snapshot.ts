import type { SerializedJsonValue } from "../../basic/serialization/types.ts";
import type { PickupFeatureState } from "./model.ts";

/** pickup feature の state を public serialize の payload に写す。 */
export function serializePickupState(state: PickupFeatureState): SerializedJsonValue {
  return {
    pickups: state.pickups.map((pickup) => ({
      id: pickup.id,
      definitionId: pickup.definitionId,
      spawnTick: pickup.spawnTick,
      spawnPosition: { x: pickup.spawnPosition.x, y: pickup.spawnPosition.y },
      attractedTick: pickup.attractedTick,
    })),
  };
}

/** pickup feature の state を state hash の値に写す。serialize と契約が異なるため、本文が同じでも別に持つ。 */
export function hashPickupState(state: PickupFeatureState): SerializedJsonValue {
  return {
    pickups: state.pickups.map((pickup) => ({
      id: pickup.id,
      definitionId: pickup.definitionId,
      spawnTick: pickup.spawnTick,
      spawnPosition: { x: pickup.spawnPosition.x, y: pickup.spawnPosition.y },
      attractedTick: pickup.attractedTick,
    })),
  };
}
