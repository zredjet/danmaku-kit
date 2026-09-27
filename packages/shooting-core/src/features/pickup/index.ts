import { defineFeature } from "../../basic/extension/feature-module.ts";
import { loadPickupContent } from "./content.ts";
import { INITIAL_PICKUP_FEATURE_STATE } from "./model.ts";
import type { PickupContent, PickupFeatureState } from "./model.ts";
import { maxPickupAllocations, restorePickupState } from "./restore.ts";
import { hashPickupState, serializePickupState } from "./snapshot.ts";
import { advancePickups, projectPickupFrame } from "./systems.ts";

/**
 * pickup feature（design 9.9 / 20）。`createShootingCore({ features: [pickupFeature] })` に渡すと、`enabledFeatures: [pickup]` の
 * content で `content.features.pickups` と enemy の `drops` を使え、撃破した enemy が pickup を落とし、自機が回収して score を得る。
 */
export const pickupFeature = defineFeature<PickupFeatureState, PickupContent>({
  feature: "pickup",
  // 2: Phase 2B-6 で active な pickup を持つようにした（Phase 2B-5 の state は null）。
  stateVersion: 2,
  loadContent: loadPickupContent,
  createInitialState: () => INITIAL_PICKUP_FEATURE_STATE,
  systems: { scoring: advancePickups },
  serializeState: serializePickupState,
  hashState: hashPickupState,
  restoreState: restorePickupState,
  maxAllocations: maxPickupAllocations,
  projectFrameState: projectPickupFrame,
});
