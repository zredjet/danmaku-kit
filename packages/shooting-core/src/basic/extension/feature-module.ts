import { KNOWN_ENABLED_FEATURES } from "../content/types.ts";
import type { Difficulty, EnabledFeature, GameDefinition, PlayerDefinition, StageDefinition } from "../content/types.ts";
import type { CoreResult } from "../result.ts";
import type { SerializedJsonValue } from "../serialization/types.ts";
import { deepFreezeClone, deepFreezePlainData } from "../shared/immutable.ts";

/**
 * tick の中で feature の system を実行する位置（design 7.1）。
 *
 * `spawn` は spawn bullets / player shots の後で update movement の前、`scoring` は collision resolution と basic の scoring の後で
 * cleanup destroyed entities の前。同じ位置の system は canonical feature order で実行する。
 */
export const FEATURE_TICK_SLOTS = Object.freeze(["spawn", "scoring"] as const);
export type FeatureTickSlot = (typeof FEATURE_TICK_SLOTS)[number];

/** stage の文脈（base）。Core は feature ごとに、その feature が load 時に作った `content` を足して hook に渡す。 */
export type FeatureStageBase = Readonly<{
  definition: GameDefinition;
  stage: StageDefinition;
  player: PlayerDefinition;
  difficulty: Difficulty;
}>;

/** feature の state を作るときと restore するときに渡す stage の文脈。`content` は feature の `loadContent()` が作った値。 */
export type FeatureStageContext<Content> = FeatureStageBase & Readonly<{ content: Content }>;

/** feature の system に渡す 1 tick の文脈。entity の採番、event、score のような basic の state は、使う feature を足す slice で足す。 */
export type FeatureTickContext<Content> = FeatureStageContext<Content> & Readonly<{ tick: number }>;

/** restore で feature の state を作るときの文脈。`expectedTick` は snapshot が次に受け付ける tick。 */
export type FeatureRestoreContext<Content> = FeatureStageContext<Content> & Readonly<{ expectedTick: number }>;

/** 1 tick の決まった位置で feature の state を進める。error を返すと stage session は fatal になる。 */
export type FeatureSystem<State, Content> = (state: State, context: FeatureTickContext<Content>) => CoreResult<State>;

/**
 * optional feature が basic core に差し込む処理（design 20）。
 *
 * Core は `enabledFeatures` にある feature の module を canonical feature order（`KNOWN_ENABLED_FEATURES`）で呼ぶ。feature の state は
 * JSON 互換の plain data とし（実行時の状態を持たない feature は `null`）、Core は committed state に有効な feature ごとに必ず 1 つ持って
 * freeze する。hook が返した state が plain data でなければ、startStage と tick は `stageSession.fatal`、restore は
 * `state.invalidShape` にする。serialize は `SerializedEnabledFeatureState`、state hash は feature state として canonical encoding に入れる。
 * `Content` は load 時に 1 度だけ作る feature の content（id の索引など）で、Core は読まずに hook の文脈へ渡す。hook は変更しない。
 */
export type FeatureModule<State extends SerializedJsonValue, Content> = Readonly<{
  feature: EnabledFeature;
  /** serialize する state の version（正の safe integer）。restore は同じ version の state だけを受け付ける。 */
  stateVersion: number;
  /**
   * basic の検証に通った definition を feature の規則で検証し、stage と tick が使う feature の content を作る。error を返せば load は
   * 失敗し、成功の warning は load の warning に足す。
   */
  loadContent(definition: GameDefinition): CoreResult<Content>;
  /** `startStage()` で feature の state の初期値を作る。 */
  createInitialState(context: FeatureStageContext<Content>): State;
  /** tick の位置ごとの system。 */
  systems: Readonly<Partial<Record<FeatureTickSlot, FeatureSystem<State, Content>>>>;
  /** public serialize の payload。 */
  serializeState(state: State): SerializedJsonValue;
  /** state hash に入れる値。serialize と契約が異なるため、本文が同じでも別に持つ。 */
  hashState(state: State): SerializedJsonValue;
  /**
   * JSON の形を検証済みの payload から state を作る。payload の形と、spawn から `expectedTick` までに到達できる state であることを
   * 検証し、受け付けない state は `state.invalidShape` などの error にする。
   */
  restoreState(payload: SerializedJsonValue, context: FeatureRestoreContext<Content>): CoreResult<State>;
}>;

/** state と content の型を消した feature module。Core の中ではこの形で持つ。 */
export type AnyFeatureModule = FeatureModule<SerializedJsonValue, unknown>;

/** load した有効な feature。module と、その module が load 時に作った content。 */
export type LoadedFeature = Readonly<{ module: AnyFeatureModule; content: unknown }>;

const FEATURE_MODULE: unique symbol = Symbol("shooting-core.featureModule");
const MODULE_FUNCTIONS = Object.freeze(["loadContent", "createInitialState", "serializeState", "hashState", "restoreState"] as const);
/** `defineFeature()` が作った feature。symbol を取り出して作った偽の feature を受け付けないために使う。 */
const definedFeatures = new WeakSet<object>();

/**
 * `createShootingCore()` に渡す feature。feature の package entry が `defineFeature()` で作り、module の中身は Core だけが読む。
 */
export type ShootingCoreFeature = Readonly<{
  feature: EnabledFeature;
  readonly [FEATURE_MODULE]: AnyFeatureModule;
}>;

/**
 * feature module を `createShootingCore()` に渡せる形にする。feature の package entry だけが使う。
 *
 * 既知でない feature、正の safe integer でない `stateVersion`、関数でない hook は feature の実装の誤りなので TypeError を投げる。
 */
export function defineFeature<State extends SerializedJsonValue, Content>(module: FeatureModule<State, Content>): ShootingCoreFeature {
  if (!KNOWN_ENABLED_FEATURES.includes(module.feature)) {
    throw new TypeError(`Unknown optional feature module: ${String(module.feature)}`);
  }
  if (!Number.isSafeInteger(module.stateVersion) || module.stateVersion < 1) {
    throw new TypeError(`Feature module stateVersion must be a positive safe integer: ${module.feature}`);
  }
  for (const name of MODULE_FUNCTIONS) {
    if (typeof module[name] !== "function") {
      throw new TypeError(`Feature module ${name} must be a function: ${module.feature}`);
    }
  }
  const systems = Object.entries(module.systems ?? {});
  if (systems.some(([slot, system]) => !(FEATURE_TICK_SLOTS as readonly string[]).includes(slot) || typeof system !== "function")) {
    throw new TypeError(`Feature module systems must be functions keyed by ${FEATURE_TICK_SLOTS.join(" or ")}: ${module.feature}`);
  }
  const feature = Object.freeze({
    feature: module.feature,
    [FEATURE_MODULE]: Object.freeze({ ...module, systems: Object.freeze(Object.fromEntries(systems)) }) as unknown as AnyFeatureModule,
  });
  definedFeatures.add(feature);
  return feature;
}

/**
 * `createShootingCore()` に渡された feature を canonical feature order の module にする。
 *
 * 配列でない値、`defineFeature()` で作っていない値、同じ feature の重複は host の組み立ての誤りなので TypeError を投げる。
 */
export function resolveFeatureModules(features: unknown): readonly AnyFeatureModule[] {
  if (!Array.isArray(features)) {
    throw new TypeError("ShootingCoreOptions.features must be an array");
  }
  const modules = new Map<EnabledFeature, AnyFeatureModule>();
  for (const feature of features) {
    if (typeof feature !== "object" || feature === null || !definedFeatures.has(feature)) {
      throw new TypeError("ShootingCoreOptions.features must contain features made by defineFeature()");
    }
    const module = (feature as ShootingCoreFeature)[FEATURE_MODULE];
    if (modules.has(module.feature)) {
      throw new TypeError(`Duplicate optional feature module: ${module.feature}`);
    }
    modules.set(module.feature, module);
  }
  return Object.freeze(KNOWN_ENABLED_FEATURES.flatMap((feature) => {
    const module = modules.get(feature);
    return module ? [module] : [];
  }));
}

/**
 * feature module が返した state を JSON 互換の plain data として clone / freeze する。plain data でない値（非有限数、`undefined`、
 * Map、cycle など）は undefined を返す。
 */
export function freezeFeatureState(value: unknown): SerializedJsonValue | undefined {
  if (value === null) {
    return null;
  }
  // deepFreezePlainData() は plain data かどうかの検査にだけ使い、committed state と同じ通常の object に clone する。
  return deepFreezePlainData(value) === null ? undefined : deepFreezeClone(value as SerializedJsonValue);
}

/** 登録された module のうち、definition の `enabledFeatures` にある feature の module（canonical feature order）。 */
export function selectEnabledFeatureModules(
  modules: readonly AnyFeatureModule[],
  enabledFeatures: readonly EnabledFeature[],
): readonly AnyFeatureModule[] {
  return Object.freeze(modules.filter((module) => enabledFeatures.includes(module.feature)));
}
