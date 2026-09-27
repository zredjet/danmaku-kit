import type { GameDefinition, ShootingCore } from "@shooting-sample/shooting-core";

import type { AssetManifest } from "../assets/asset-manifest.ts";
import type { GameShellContent } from "../lifecycle/game-shell.ts";
import { selectStartStage } from "../lifecycle/stage-difficulty.ts";
import { collectCollisionRadii } from "../view/collision-radii.ts";
import { collectDefinitionAssets } from "../view/definition-assets.ts";
import { planViewPoolCapacities } from "../view/view-pool-plan.ts";
import type { ContentUpdate } from "./content-update.ts";

/** hot reload の判断に使う、今動いている content。 */
export type HotReloadContext = Readonly<{
  core: Pick<ShootingCore, "load">;
  definition: GameDefinition;
  assetManifest: AssetManifest;
  /** `?difficulty=` の値。 */
  requestedDifficulty: string | null;
}>;

/**
 * content の変更に対して app がすること。
 *
 * - `clearError`: 直前の検証の error の表示を消す（content は変わらない）。
 * - `showError`: 検証の error を出し、古い content のまま動かし続ける。
 * - `reloadTextures`: asset manifest の sprite の path だけが変わったので、その texture を読み直して stage は続ける。
 * - `restartStage`: 新しい content の `LoadedGame` で stage を始め直す（view と texture はそのまま使える）。
 * - `reloadPage`: 読み込み済みの texture や view pool では足りない変更なので、page を読み込み直す。
 */
export type HotReloadAction =
  | Readonly<{ type: "clearError" }>
  | Readonly<{ type: "showError"; message: string }>
  | Readonly<{ type: "reloadTextures"; assetManifest: AssetManifest; keys: readonly string[] }>
  | Readonly<{ type: "restartStage"; definition: GameDefinition; content: GameShellContent }>
  | Readonly<{ type: "reloadPage"; reason: string }>;

/**
 * dev server から届いた content の変更を、今の content と比べて app がすることを決める（design 19）。Phaser に依存しない。
 *
 * `GameDefinition` の変更は、新しい content の definition が使う asset、collision の半径、view pool の大きさが今のものに収まれば stage を
 * 始め直し、収まらなければ page を読み込み直す。asset manifest だけの変更は、sprite の path だけなら texture を読み直し、asset の増減や
 * type、fallback の変更なら page を読み込み直す。
 */
export function decideHotReload(update: ContentUpdate, context: HotReloadContext): HotReloadAction {
  switch (update.kind) {
    case "error":
      return Object.freeze({ type: "showError", message: update.message });
    case "unchanged":
      return Object.freeze({ type: "clearError" });
    case "assets":
      return decideAssetReload(context.assetManifest, update.assetManifest);
    case "content":
      return decideContentReload(update.definition, update.assetManifest, context);
  }
}

function decideContentReload(
  definition: GameDefinition,
  assetManifest: AssetManifest,
  context: HotReloadContext,
): HotReloadAction {
  if (!sameJson(assetManifest, context.assetManifest)) {
    return reloadPage("the content change also changed the asset manifest");
  }
  if (!sameJson([...collectDefinitionAssets(definition)], [...collectDefinitionAssets(context.definition)])) {
    return reloadPage("the content change needs other sprites");
  }
  if (!sameJson([...collectCollisionRadii(definition)], [...collectCollisionRadii(context.definition)])) {
    return reloadPage("the content change changed a collision radius shown by the colliders");
  }
  const stage = selectStartStage(definition, context.requestedDifficulty);
  const current = selectStartStage(context.definition, context.requestedDifficulty);
  if (!stage || !current) {
    return Object.freeze({ type: "showError", message: "the content must define a stage with at least one difficulty" });
  }
  const plan = planViewPoolCapacities(definition, stage.stageId, definition.defaultPlayerId);
  const currentPlan = planViewPoolCapacities(context.definition, current.stageId, context.definition.defaultPlayerId);
  if (!plan.ok || !currentPlan.ok) {
    return plan.ok ? reloadPage("the current view pools cannot be sized") : Object.freeze({ type: "showError", message: plan.error });
  }
  const larger = (Object.keys(plan.capacities) as (keyof typeof plan.capacities)[])
    .filter((kind) => plan.capacities[kind] > currentPlan.capacities[kind]);
  if (larger.length > 0) {
    return reloadPage(`the content change needs larger view pools for ${larger.join(", ")}`);
  }
  const loaded = context.core.load(definition);
  if (!loaded.ok) {
    return Object.freeze({
      type: "showError",
      message: ["Core rejected the content", ...loaded.errors.map((error) => `${error.code}: ${error.message}`)].join("\n"),
    });
  }
  return Object.freeze({ type: "restartStage", definition, content: Object.freeze({ loadedGame: loaded.value, stage }) });
}

function decideAssetReload(current: AssetManifest, next: AssetManifest): HotReloadAction {
  const keys = Object.keys(next.assets).sort();
  if (!sameJson(keys, Object.keys(current.assets).sort())) {
    return reloadPage("the asset manifest added or removed assets");
  }
  const changed: string[] = [];
  for (const key of keys) {
    const before = current.assets[key]!;
    const after = next.assets[key]!;
    if (sameJson(before, after)) {
      continue;
    }
    if (before.type !== "sprite" || !sameJson({ ...before, path: after.path }, after)) {
      return reloadPage(`the asset manifest changed more than the path of ${key}`);
    }
    changed.push(key);
  }
  return changed.length === 0
    ? Object.freeze({ type: "clearError" })
    : Object.freeze({ type: "reloadTextures", assetManifest: next, keys: Object.freeze(changed) });
}

function reloadPage(reason: string): HotReloadAction {
  return Object.freeze({ type: "reloadPage", reason });
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
