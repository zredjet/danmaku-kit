import { defineFeature } from "../../basic/extension/feature-module.ts";
import { coreError, okResult } from "../../basic/result.ts";
import { loadPickupContent } from "./content.ts";
import type { PickupContent } from "./content.ts";

/**
 * pickup feature（design 9.9 / 20）。`createShootingCore({ features: [pickupFeature] })` に渡すと、`enabledFeatures: [pickup]` の
 * content で `content.features.pickups` と enemy の `drops` を使える。
 *
 * Phase 2B-5 は content の検証だけを持ち、pickup の生成、移動、回収と state（`null`）は Phase 2B-6 で足す。
 */
export const pickupFeature = defineFeature<null, PickupContent>({
  feature: "pickup",
  stateVersion: 1,
  loadContent: loadPickupContent,
  createInitialState: () => null,
  systems: {},
  serializeState: () => null,
  hashState: () => null,
  restoreState: (payload) => payload === null
    ? okResult(null)
    : coreError("state.invalidShape", "pickup feature state must be null"),
});
