import type { EnabledFeature } from "../content/types.ts";
import { defineFeature } from "../extension/feature-module.ts";
import type {
  FeatureContentDiagnostics,
  FeatureSystem,
  FeatureTickSlot,
  ShootingCoreFeature,
} from "../extension/feature-module.ts";
import { coreError, okResult } from "../result.ts";
import type { CoreError } from "../result.ts";
import type { SerializedJsonValue } from "../serialization/types.ts";

/** counter feature の state。tick ごとに slot ごとの system が 1 ずつ数える。 */
type CounterState = Readonly<{ spawns: number; scorings: number }>;

export type CounterFeatureOptions = Readonly<{
  /** system を呼んだ順の記録（`<feature>:<slot>:<tick>`）。 */
  calls?: string[];
  content?: FeatureContentDiagnostics;
  /** この tick の scoring system を失敗させる。 */
  failScoringAtTick?: number;
}>;

/**
 * feature registration の test に使う feature。basic の feature 名を借り、spawn と scoring の system が呼ばれた回数だけを state に
 * 持つ。restore は回数が `expectedTick` と一致する state だけを受け付ける（spawn から到達できる state）。
 */
export function createCounterFeature(feature: EnabledFeature, options: CounterFeatureOptions = {}): ShootingCoreFeature {
  const count = (slot: FeatureTickSlot, field: keyof CounterState): FeatureSystem<CounterState> => (state, context) => {
    options.calls?.push(`${feature}:${slot}:${context.tick}`);
    if (slot === "scoring" && context.tick === options.failScoringAtTick) {
      return coreError("stageSession.fatal", `${feature} counter failed at tick ${context.tick}`);
    }
    return okResult<CounterState>({ ...state, [field]: state[field] + 1 });
  };
  return defineFeature<CounterState>({
    feature,
    stateVersion: 1,
    validateContent: () => options.content ?? { errors: [], warnings: [] },
    createInitialState: () => ({ spawns: 0, scorings: 0 }),
    systems: { spawn: count("spawn", "spawns"), scoring: count("scoring", "scorings") },
    serializeState: (state) => state,
    hashState: (state) => state,
    restoreState: (payload, context) => {
      if (!isCounterState(payload) || payload.spawns !== context.expectedTick || payload.scorings !== context.expectedTick) {
        return coreError("state.invalidShape", `${feature} counter state must count every tick before expectedTick`);
      }
      return okResult(payload);
    },
  });
}

function isCounterState(value: SerializedJsonValue): value is CounterState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Readonly<Record<string, SerializedJsonValue>>;
  return Object.keys(record).length === 2 && typeof record.spawns === "number" && typeof record.scorings === "number";
}

/** feature の検証 error の例。 */
export const COUNTER_CONTENT_ERROR: CoreError = Object.freeze({
  code: "definition.invalidConstraint",
  message: "counter feature rejects this content",
  schemaPath: "content",
});
