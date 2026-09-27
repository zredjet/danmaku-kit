import type { GameDefinition, ShootingCore } from "@shooting-sample/shooting-core";

import type { AssetManifest } from "../assets/asset-manifest.ts";
import type { GameShellContent } from "../lifecycle/game-shell.ts";
import { selectStartStage } from "../lifecycle/stage-difficulty.ts";
import { collectCollisionRadii } from "../view/collision-radii.ts";
import { collectDefinitionAssets } from "../view/definition-assets.ts";
import { planViewPoolCapacities, type ViewPoolPlan } from "../view/view-pool-plan.ts";
import type { ContentUpdate } from "./content-update.ts";

/** hot reload の判断に使う、今動いている content と view。 */
export type HotReloadContext = Readonly<{
  core: Pick<ShootingCore, "load">;
  definition: GameDefinition;
  assetManifest: AssetManifest;
  /** loading で作った view pool の大きさ。新しい content の見積もりがこれを超えれば page を読み込み直す。 */
  viewPoolCapacities: Extract<ViewPoolPlan, { ok: true }>["capacities"];
  /** `?difficulty=` の値。 */
  requestedDifficulty: string | null;
  /** Core の error や view pool の枯渇で stage scene が止まっているか。止まっていれば stage を始め直せない。 */
  halted: boolean;
}>;

/**
 * content の変更に対して app がすること。
 *
 * - `clearError`: content は変わらない（書式や key の順だけの変更、design 19 の schema-only）。直前の検証の error の表示を消す。
 * - `showError`: 検証の error か、今の app では使えない content を出し、古い content のまま動かし続ける。
 * - `reloadTextures`: asset manifest の sprite の path だけが変わったので、その texture を読み直して stage は続ける。
 * - `restartStage`: 新しい content の `LoadedGame` で stage を始め直す（view と texture はそのまま使える）。
 * - `reloadPage`: 読み込み済みの texture や view pool では足りない変更か、stage が止まっているので、page を読み込み直す。
 */
export type HotReloadAction =
  | Readonly<{ type: "clearError" }>
  | Readonly<{ type: "showError"; message: string }>
  | Readonly<{ type: "reloadTextures"; assetManifest: AssetManifest; keys: readonly string[] }>
  | Readonly<{ type: "restartStage"; definition: GameDefinition; content: GameShellContent }>
  | Readonly<{ type: "reloadPage"; reason: string }>;

/**
 * dev server から届いた content を今の content と比べて、app がすることを決める（design 19）。Phaser に依存しない。
 *
 * 比べるときは object の key の順を無視する。`GameDefinition` の変更は、新しい content の definition が使う asset、collision の半径、
 * view pool の大きさが今の view に収まれば stage を始め直し、収まらなければ page を読み込み直す。asset manifest だけの変更は、sprite
 * の path だけ（拡張子の種類は同じ）なら texture を読み直し、asset の増減や type、fallback の変更なら page を読み込み直す。
 */
export function decideHotReload(update: ContentUpdate, context: HotReloadContext): HotReloadAction {
  if (update.kind === "error") {
    return Object.freeze({ type: "showError", message: update.message });
  }
  const definitionChanged = !sameCanonicalJson(update.definition, context.definition);
  const manifestChanged = !sameCanonicalJson(update.assetManifest, context.assetManifest);
  if (definitionChanged) {
    return manifestChanged
      ? reloadPage("the content change also changed the asset manifest")
      : decideContentReload(update.definition, context);
  }
  return manifestChanged
    ? decideAssetReload(context.assetManifest, update.assetManifest, context.halted)
    : Object.freeze({ type: "clearError" });
}

function decideContentReload(definition: GameDefinition, context: HotReloadContext): HotReloadAction {
  if (!sameCanonicalJson([...collectDefinitionAssets(definition)], [...collectDefinitionAssets(context.definition)])) {
    return reloadPage("the content change needs other sprites");
  }
  if (!sameCanonicalJson([...collectCollisionRadii(definition)], [...collectCollisionRadii(context.definition)])) {
    return reloadPage("the content change changed a collision radius shown by the colliders");
  }
  const stage = selectStartStage(definition, context.requestedDifficulty);
  if (!stage) {
    return Object.freeze({ type: "showError", message: "the content must define a stage with at least one difficulty" });
  }
  const plan = planViewPoolCapacities(definition, stage.stageId, definition.defaultPlayerId);
  if (!plan.ok) {
    return Object.freeze({ type: "showError", message: plan.error });
  }
  const larger = (Object.keys(plan.capacities) as (keyof typeof plan.capacities)[])
    .filter((kind) => plan.capacities[kind] > context.viewPoolCapacities[kind]);
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
  if (context.halted) {
    return reloadPage("the stage stopped on an error");
  }
  return Object.freeze({ type: "restartStage", definition, content: Object.freeze({ loadedGame: loaded.value, stage }) });
}

function decideAssetReload(current: AssetManifest, next: AssetManifest, halted: boolean): HotReloadAction {
  const keys = Object.keys(next.assets).sort();
  if (!sameCanonicalJson(keys, Object.keys(current.assets).sort())) {
    return reloadPage("the asset manifest added or removed assets");
  }
  const changed: string[] = [];
  for (const key of keys) {
    const before = current.assets[key]!;
    const after = next.assets[key]!;
    if (sameCanonicalJson(before, after)) {
      continue;
    }
    if (before.type !== "sprite" || !sameCanonicalJson({ ...before, path: after.path }, after)) {
      return reloadPage(`the asset manifest changed more than the path of ${key}`);
    }
    // SVG と画像では描く大きさの倍率が違うため、読み直しでは変えられない。
    if (isSvg(before.path) !== isSvg(after.path)) {
      return reloadPage(`the asset manifest changed the image format of ${key}`);
    }
    changed.push(key);
  }
  if (halted) {
    return reloadPage("the stage stopped on an error");
  }
  return Object.freeze({ type: "reloadTextures", assetManifest: next, keys: Object.freeze(changed) });
}

function isSvg(path: string): boolean {
  return path.toLowerCase().endsWith(".svg");
}

function reloadPage(reason: string): HotReloadAction {
  return Object.freeze({ type: "reloadPage", reason });
}

/** object の key の順を無視して、JSON の値として同じか。 */
function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}
