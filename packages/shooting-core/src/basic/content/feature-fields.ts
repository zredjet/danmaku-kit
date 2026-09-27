import type { EnabledFeature, EnemyDefinition, FeatureContentRegistry } from "./types.ts";

/**
 * optional feature が持つ content の field（design 20）。
 *
 * basic の shape の検証は、この表で feature の field を知る。feature が有効（`enabledFeatures` にある）なら値の検証を feature の module
 * に任せ、有効でなければ collection は読み込むだけで warning、basic の definition に足す field は error にする。feature の module が
 * Core に登録されていなくても gating できるよう、表は basic に置く。
 */
export const FEATURE_CONTENT_COLLECTIONS = Object.freeze({
  pickups: "pickup",
} as const satisfies Readonly<Record<keyof FeatureContentRegistry, EnabledFeature>>);

/** `EnemyDefinition` に feature が足す field と、その feature。 */
export const FEATURE_ENEMY_FIELDS = Object.freeze({
  drops: "pickup",
} as const satisfies Readonly<Partial<Record<keyof EnemyDefinition, EnabledFeature>>>);
