import type { EnabledFeature } from "../content/types.ts";
import { defineFeature } from "../extension/feature-module.ts";
import type {
  FeatureContentDiagnostics,
  FeatureStageContext,
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
  /** hook を呼んだ順の記録（system は `<feature>:<slot>:<tick>`、ほかは `<feature>:<hook>`）。 */
  calls?: string[];
  /** hook に渡された stage の文脈（`<hook> <stage> <player> <difficulty>`）。 */
  contexts?: string[];
  content?: FeatureContentDiagnostics;
  /** この tick の scoring system を失敗させる。 */
  failScoringAtTick?: number;
  /** この tick の spawn system が JSON 互換でない state を返す。 */
  returnNonPlainStateAtTick?: number;
}>;

/**
 * feature registration の test に使う feature。basic の feature 名を借り、spawn と scoring の system が呼ばれた回数だけを state に
 * 持つ。restore は回数が `expectedTick` と一致する state だけを受け付ける（spawn から到達できる state）。
 */
export function createCounterFeature(feature: EnabledFeature, options: CounterFeatureOptions = {}): ShootingCoreFeature {
  const record = (hook: string, context: FeatureStageContext) => {
    options.contexts?.push(`${hook} ${context.stage.id} ${context.player.id} ${context.difficulty}`);
  };
  const count = (slot: FeatureTickSlot, field: keyof CounterState): FeatureSystem<CounterState> => (state, context) => {
    options.calls?.push(`${feature}:${slot}:${context.tick}`);
    record(slot, context);
    if (slot === "scoring" && context.tick === options.failScoringAtTick) {
      return coreError("stageSession.fatal", `${feature} counter failed at tick ${context.tick}`);
    }
    if (slot === "spawn" && context.tick === options.returnNonPlainStateAtTick) {
      return okResult({ ...state, spawns: Number.NaN });
    }
    return okResult<CounterState>({ ...state, [field]: state[field] + 1 });
  };
  return defineFeature<CounterState>({
    feature,
    stateVersion: 1,
    validateContent: () => options.content ?? { errors: [], warnings: [] },
    createInitialState: (context) => {
      record("createInitialState", context);
      return { spawns: 0, scorings: 0 };
    },
    systems: { spawn: count("spawn", "spawns"), scoring: count("scoring", "scorings") },
    serializeState: (state) => state,
    // hash には serialize と違う形で入れ、serialize と hash の projection の取り違えを test で見分けられるようにする。
    hashState: (state) => [state.spawns, state.scorings],
    restoreState: (payload, context) => {
      record(`restoreState@${context.expectedTick}`, context);
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
