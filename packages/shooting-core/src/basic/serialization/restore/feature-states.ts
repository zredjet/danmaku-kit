import { freezeFeatureState } from "../../extension/feature-module.ts";
import type { AnyFeatureModule, FeatureRestoreContext } from "../../extension/feature-module.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import type { CommittedFeatureState } from "../../state/committed-state.ts";
import type { SerializedEnabledFeatureState } from "../types.ts";

/**
 * 形を検証済みの `enabledFeatureStates` を、有効な feature の module で committed の feature state にする。
 *
 * 重複と canonical feature order の違反は `parseRestoreDeterministicPayload()` が `state.invalidShape` にしている。ここでは有効な feature
 * ごとにちょうど 1 つの state があり（余分、欠落、module のない feature は `state.featureMismatch`）、`stateVersion` が module と一致する
 * （違えば `state.featureMismatch`）ことを確かめる。payload の形と spawn から到達できるかは module の `restoreState()` が検証する。
 */
export function restoreFeatureStates(
  states: readonly SerializedEnabledFeatureState[],
  features: readonly AnyFeatureModule[],
  context: FeatureRestoreContext,
): CoreResult<readonly CommittedFeatureState[]> {
  if (states.length !== features.length || states.some((state, index) => state.feature !== features[index]!.feature)) {
    return coreError(
      "state.featureMismatch",
      "state.enabledFeatureStates must have one state for each enabled feature module",
    );
  }
  const restored: CommittedFeatureState[] = [];
  for (const [index, module] of features.entries()) {
    const state = states[index]!;
    if (state.stateVersion !== module.stateVersion) {
      return coreError("state.featureMismatch", `unsupported ${module.feature} feature stateVersion: ${state.stateVersion}`);
    }
    const value = module.restoreState(state.payload, context);
    if (!value.ok) {
      return value;
    }
    const restoredState = freezeFeatureState(value.value);
    if (restoredState === undefined) {
      return coreError("state.invalidShape", `restored ${module.feature} feature state must be JSON-compatible plain data`);
    }
    restored.push(Object.freeze({ feature: module.feature, state: restoredState }));
  }
  return okResult(Object.freeze(restored));
}
