import { KNOWN_ENABLED_FEATURES } from "../content/types.ts";
import type { Difficulty, EnabledFeature, EnemyId, GameDefinition, PlayerDefinition, StageDefinition } from "../content/types.ts";
import type { ReadonlyEntityState } from "../entities/runtime-entity.ts";
import type { GameEvent } from "../events/game-event.ts";
import type { CoreResult } from "../result.ts";
import type { SerializedJsonValue } from "../serialization/types.ts";
import type { ReadonlyFeatureFrameState } from "./feature-frame.ts";
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

/** この tick に撃破された enemy（collision resolution の順）。位置は撃破された tick の移動の後の位置。 */
export type FeatureDefeatedEnemy = Readonly<{
  id: number;
  definitionId: EnemyId;
  position: Readonly<{ x: number; y: number }>;
}>;

/**
 * feature が出せる gameplay event。basic の event（stage の終了、`tickAdvanced`、enemy の score など）は出せない。event の `tick` は
 * 文脈の `tick` と同じにする（違えば stage session は fatal になる）。
 */
export type FeatureGameEvent = Extract<
  GameEvent,
  { type: "pickupsSpawnedBatch" | "pickupCollected" } | { type: "scoreChanged"; reason: "pickupCollected" }
>;

/**
 * feature の system に渡す 1 tick の文脈（`spawn` と `scoring` の共通部分）。
 *
 * `entities` は basic の entity（`spawn` では spawn の後、`scoring` では collision resolution の後で cleanup の前、id の順）。entity id は
 * basic と同じ allocator から採番し、event は basic の event に続けて frame の event の順に並ぶ。
 */
export type FeatureTickContext<Content> = FeatureStageContext<Content> & Readonly<{
  tick: number;
  entities: readonly ReadonlyEntityState[];
  /** `count` 個の entity id を採番する。足りなければ何も採番せずに error を返す。 */
  allocateEntityIds(count: number): CoreResult<readonly number[]>;
  emitEvent(event: FeatureGameEvent): void;
}>;

/**
 * `scoring` の system に渡す文脈。`defeatedEnemies` はこの tick に撃破された enemy で、score は basic の scoring の後に足す（design 7.1
 * の scoring より前の `spawn` では score を足せない）。
 */
export type FeatureScoringContext<Content> = FeatureTickContext<Content> & Readonly<{
  defeatedEnemies: readonly FeatureDefeatedEnemy[];
  /** score に `delta`（0 以上の safe integer）を足し、足した後の合計を返す。不正な `delta` は stage session を fatal にする。 */
  addScore(delta: number): number;
}>;

/**
 * restore で feature の state を作るときの文脈。`expectedTick` は snapshot が次に受け付ける tick、`nextEntityId` は snapshot の次に
 * 採番する id、`entityAllocationTicks` は restore した basic の entity の id と、その id を採番した tick（自機は stage の開始前の -1）。
 * feature が同じ tick に採番した id は、その tick の basic の採番の後に来る。
 */
export type FeatureRestoreContext<Content> = FeatureStageContext<Content> & Readonly<{
  expectedTick: number;
  nextEntityId: number;
  entityAllocationTicks: ReadonlyMap<number, number>;
}>;

/** restore の allocation envelope を見積もるときの文脈。 */
export type FeatureAllocationContext<Content> = FeatureStageContext<Content> & Readonly<{ expectedTick: number }>;

/** frame に feature の state を出すときの文脈。`tick` はその frame の tick。 */
export type FeatureFrameContext<Content> = FeatureStageContext<Content> & Readonly<{ tick: number }>;

/** 1 tick の決まった位置で feature の state を進める。error を返すと stage session は fatal になる。 */
export type FeatureSystem<State, Context> = (state: State, context: Context) => CoreResult<State>;

/** tick の位置ごとの system。 */
export type FeatureSystems<State, Content> = Readonly<{
  spawn?: FeatureSystem<State, FeatureTickContext<Content>>;
  scoring?: FeatureSystem<State, FeatureScoringContext<Content>>;
}>;

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
  systems: FeatureSystems<State, Content>;
  /** public serialize の payload。 */
  serializeState(state: State): SerializedJsonValue;
  /** state hash に入れる値。serialize と契約が異なるため、本文が同じでも別に持つ。 */
  hashState(state: State): SerializedJsonValue;
  /**
   * JSON の形を検証済みの payload から state を作る。payload の形と、spawn から `expectedTick` までに到達できる state であることを
   * 検証し、受け付けない state は `state.invalidShape` などの error にする。
   */
  restoreState(payload: SerializedJsonValue, context: FeatureRestoreContext<Content>): CoreResult<State>;
  /**
   * spawn から `expectedTick` までに feature が採番し得る entity id の数の上限。restore は basic の上限に足して `nextEntityId` を
   * 検証する。entity を持たない feature は省略する（0）。
   */
  maxAllocations?(context: FeatureAllocationContext<Content>): number;
  /** frame の `state.features` に出す値。出さない feature は省略する。 */
  projectFrameState?(state: State, context: FeatureFrameContext<Content>): ReadonlyFeatureFrameState;
  /**
   * timeline を処理し終えて enemy がいなくなっても、feature の entity が残っている間は stage を clear にしない（pickup が回収か cleanup
   * されるまで待つ）。gameOver は待たない。restore も同じ規則で stage の状態を検証する。
   */
  holdsStageClear?(state: State): boolean;
}>;

/** state と content の型を消した feature module。Core の中ではこの形で持つ。 */
export type AnyFeatureModule = FeatureModule<SerializedJsonValue, unknown>;

/** load した有効な feature。module と、その module が load 時に作った content。 */
export type LoadedFeature = Readonly<{ module: AnyFeatureModule; content: unknown }>;

const FEATURE_MODULE: unique symbol = Symbol("danmaku-kit.core.featureModule");
const MODULE_FUNCTIONS = Object.freeze(["loadContent", "createInitialState", "serializeState", "hashState", "restoreState"] as const);
/** `defineFeature()` が作った feature。symbol を取り出して作った偽の feature を受け付けないために使う。 */
const definedFeatures = new WeakSet<object>();

/**
 * `createDanmakuCore()` に渡す feature。feature の package entry が `defineFeature()` で作り、module の中身は Core だけが読む。
 */
export type DanmakuCoreFeature = Readonly<{
  feature: EnabledFeature;
  readonly [FEATURE_MODULE]: AnyFeatureModule;
}>;

/**
 * feature module を `createDanmakuCore()` に渡せる形にする。feature の package entry だけが使う。
 *
 * 既知でない feature、正の safe integer でない `stateVersion`、関数でない hook は feature の実装の誤りなので TypeError を投げる。
 */
export function defineFeature<State extends SerializedJsonValue, Content>(module: FeatureModule<State, Content>): DanmakuCoreFeature {
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
  for (const name of ["maxAllocations", "projectFrameState", "holdsStageClear"] as const) {
    if (module[name] !== undefined && typeof module[name] !== "function") {
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
 * `createDanmakuCore()` に渡された feature を canonical feature order の module にする。
 *
 * 配列でない値、`defineFeature()` で作っていない値、同じ feature の重複は host の組み立ての誤りなので TypeError を投げる。
 */
export function resolveFeatureModules(features: unknown): readonly AnyFeatureModule[] {
  if (!Array.isArray(features)) {
    throw new TypeError("DanmakuCoreOptions.features must be an array");
  }
  const modules = new Map<EnabledFeature, AnyFeatureModule>();
  for (const feature of features) {
    if (typeof feature !== "object" || feature === null || !definedFeatures.has(feature)) {
      throw new TypeError("DanmakuCoreOptions.features must contain features made by defineFeature()");
    }
    const module = (feature as DanmakuCoreFeature)[FEATURE_MODULE];
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

/** timeline を処理し終えて enemy がいなくなっても stage の clear を待たせる feature の entity が残っているか。 */
export function featuresHoldStageClear(
  featureStates: readonly Readonly<{ state: SerializedJsonValue }>[],
  features: readonly LoadedFeature[],
): boolean {
  return features.some(({ module }, index) => module.holdsStageClear?.(featureStates[index]!.state) ?? false);
}
