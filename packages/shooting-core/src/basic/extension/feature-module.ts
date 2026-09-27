import { KNOWN_ENABLED_FEATURES } from "../content/types.ts";
import type { Difficulty, EnabledFeature, GameDefinition, PlayerDefinition, StageDefinition } from "../content/types.ts";
import type { CoreError, CoreResult, CoreWarning } from "../result.ts";
import type { SerializedJsonValue } from "../serialization/types.ts";

/**
 * tick の中で feature の system を実行する位置（design 7.1）。
 *
 * `spawn` は spawn bullets / player shots の後で update movement の前、`scoring` は collision resolution と basic の scoring の後で
 * cleanup destroyed entities の前。同じ位置の system は canonical feature order で実行する。
 */
export const FEATURE_TICK_SLOTS = Object.freeze(["spawn", "scoring"] as const);
export type FeatureTickSlot = (typeof FEATURE_TICK_SLOTS)[number];

/** feature の state を作るときと restore するときに渡す stage の文脈。 */
export type FeatureStageContext = Readonly<{
  definition: GameDefinition;
  stage: StageDefinition;
  player: PlayerDefinition;
  difficulty: Difficulty;
}>;

/** feature の system に渡す 1 tick の文脈。entity の採番、event、score のような basic の state は、使う feature を足す slice で足す。 */
export type FeatureTickContext = FeatureStageContext & Readonly<{ tick: number }>;

/** restore で feature の state を作るときの文脈。`expectedTick` は snapshot が次に受け付ける tick。 */
export type FeatureRestoreContext = FeatureStageContext & Readonly<{ expectedTick: number }>;

/** 1 tick の決まった位置で feature の state を進める。error を返すと stage session は fatal になる。 */
export type FeatureSystem<State> = (state: State, context: FeatureTickContext) => CoreResult<State>;

export type FeatureContentDiagnostics = Readonly<{
  errors: readonly CoreError[];
  warnings: readonly CoreWarning[];
}>;

/**
 * optional feature が basic core に差し込む処理（design 20）。
 *
 * Core は `enabledFeatures` にある feature の module を canonical feature order（`KNOWN_ENABLED_FEATURES`）で呼ぶ。feature の state は
 * JSON 互換の plain data とし、Core は committed state に feature ごとに 1 つ持って freeze する。serialize は
 * `SerializedEnabledFeatureState`、state hash は feature state として canonical encoding に入れる。
 */
export type FeatureModule<State extends SerializedJsonValue> = Readonly<{
  feature: EnabledFeature;
  /** serialize する state の version（正の safe integer）。restore は同じ version の state だけを受け付ける。 */
  stateVersion: number;
  /** basic の検証に通った definition を feature の規則で検証する。error があれば load は失敗する。 */
  validateContent(definition: GameDefinition): FeatureContentDiagnostics;
  /** `startStage()` で feature の state の初期値を作る。 */
  createInitialState(context: FeatureStageContext): State;
  /** tick の位置ごとの system。 */
  systems: Readonly<Partial<Record<FeatureTickSlot, FeatureSystem<State>>>>;
  /** public serialize の payload。 */
  serializeState(state: State): SerializedJsonValue;
  /** state hash に入れる値。serialize と契約が異なるため、本文が同じでも別に持つ。 */
  hashState(state: State): SerializedJsonValue;
  /**
   * JSON の形を検証済みの payload から state を作る。payload の形と、spawn から `expectedTick` までに到達できる state であることを
   * 検証し、受け付けない state は `state.invalidShape` などの error にする。
   */
  restoreState(payload: SerializedJsonValue, context: FeatureRestoreContext): CoreResult<State>;
}>;

/** state の型を消した feature module。Core の中ではこの形で持つ。 */
export type AnyFeatureModule = FeatureModule<SerializedJsonValue>;

const FEATURE_MODULE: unique symbol = Symbol("shooting-core.featureModule");

/**
 * `createShootingCore()` に渡す feature。feature の package entry が `defineFeature()` で作り、module の中身は Core だけが読む。
 */
export type ShootingCoreFeature = Readonly<{
  feature: EnabledFeature;
  readonly [FEATURE_MODULE]: AnyFeatureModule;
}>;

/** feature module を `createShootingCore()` に渡せる形にする。feature の package entry だけが使う。 */
export function defineFeature<State extends SerializedJsonValue>(module: FeatureModule<State>): ShootingCoreFeature {
  return Object.freeze({
    feature: module.feature,
    [FEATURE_MODULE]: Object.freeze({ ...module, systems: Object.freeze({ ...module.systems }) }) as unknown as AnyFeatureModule,
  });
}

/**
 * `createShootingCore()` に渡された feature を canonical feature order の module にする。
 *
 * `defineFeature()` で作っていない値、既知でない feature、同じ feature の重複、正の safe integer でない `stateVersion` は host の
 * 組み立ての誤りなので TypeError を投げる。
 */
export function resolveFeatureModules(features: unknown): readonly AnyFeatureModule[] {
  if (!Array.isArray(features)) {
    throw new TypeError("ShootingCoreOptions.features must be an array");
  }
  const modules = new Map<EnabledFeature, AnyFeatureModule>();
  for (const feature of features) {
    const module = typeof feature === "object" && feature !== null && FEATURE_MODULE in feature
      ? (feature as ShootingCoreFeature)[FEATURE_MODULE]
      : null;
    if (!module) {
      throw new TypeError("ShootingCoreOptions.features must contain features made by defineFeature()");
    }
    if (!KNOWN_ENABLED_FEATURES.includes(module.feature)) {
      throw new TypeError(`Unknown optional feature module: ${String(module.feature)}`);
    }
    if (modules.has(module.feature)) {
      throw new TypeError(`Duplicate optional feature module: ${module.feature}`);
    }
    if (!Number.isSafeInteger(module.stateVersion) || module.stateVersion < 1) {
      throw new TypeError(`Feature module stateVersion must be a positive safe integer: ${module.feature}`);
    }
    modules.set(module.feature, module);
  }
  return Object.freeze(KNOWN_ENABLED_FEATURES.flatMap((feature) => {
    const module = modules.get(feature);
    return module ? [module] : [];
  }));
}

/** 登録された module のうち、definition の `enabledFeatures` にある feature の module（canonical feature order）。 */
export function selectEnabledFeatureModules(
  modules: readonly AnyFeatureModule[],
  enabledFeatures: readonly EnabledFeature[],
): readonly AnyFeatureModule[] {
  return Object.freeze(modules.filter((module) => enabledFeatures.includes(module.feature)));
}
