import { createShootingCore } from "@shooting-sample/shooting-core";
import { pickupFeature } from "@shooting-sample/shooting-core/features/pickup";
import gameDefinition, { assetManifest } from "virtual:sample-title/game-definition";

import { installDebugStateHook } from "./debug/debug-state-hook.ts";
import { planAssetLoads, type AssetStatus } from "./runtime/assets/asset-loading.ts";
import { PHASE_2A_AUDIO_STATUS } from "./runtime/audio/audio-status.ts";
import { CONTENT_UPDATE_EVENT, type ContentUpdate } from "./runtime/content/content-update.ts";
import { decideHotReload } from "./runtime/content/hot-reload.ts";
import { KeyboardInputAdapter } from "./runtime/input/keyboard-input.ts";
import { GameShell } from "./runtime/lifecycle/game-shell.ts";
import { selectStartStage } from "./runtime/lifecycle/stage-difficulty.ts";
import { applyRenderScale } from "./runtime/phaser/render-scale.ts";
import { isSampleTitleHalted, reloadSampleTitleTextures, startSampleTitleGame } from "./runtime/phaser/sample-title-game.ts";
import { collectCollisionRadii } from "./runtime/view/collision-radii.ts";
import { collectDefinitionAssets } from "./runtime/view/definition-assets.ts";
import { planViewPoolCapacities } from "./runtime/view/view-pool-plan.ts";
import { svgRasterScaleFor } from "./runtime/view/viewport-layout.ts";
import { HudOverlay } from "./ui/hud-overlay.ts";
import { fitStageToViewport } from "./ui/viewport-fit.ts";

const parent = document.getElementById("game");
if (!parent) {
  throw new Error("index.html must contain the #game element");
}
// canvas と DOM overlay の HUD を同じ transform root に重ね、root ごと viewport へ収める。
const stageRoot = document.createElement("div");
stageRoot.className = "stage-root";
parent.append(stageRoot);
const hud = new HudOverlay(stageRoot);
const viewport = fitStageToViewport({ container: parent, stageRoot });
const initialLayout = viewport.layout();

// sample content は pickup feature を使う（`config/game-definition.yaml` の `enabledFeatures`）。
const core = createShootingCore({ features: [pickupFeature] });
const loaded = core.load(gameDefinition);
if (!loaded.ok) {
  // content plugin が同じ Core で検証済みのため、ここで失敗するのは Core と content の組み合わせ自体の不整合だけになる。
  throw new Error(`Core rejected the validated game definition: ${loaded.errors.map((error) => error.code).join(", ")}`);
}

// stage select を置くまでは、title から最初の stage を `?difficulty=` の difficulty（stage が持たなければ最初の difficulty）で始める。
const requestedDifficulty = readQueryParameter("difficulty");
const stage = selectStartStage(gameDefinition, requestedDifficulty);
if (!stage) {
  throw new Error("sample title content must define a stage with at least one difficulty");
}

const requestedSeed = readRequestedSeed();
const shell = new GameShell({
  loadedGame: loaded.value,
  stage,
  nextSeed: () => requestedSeed ?? createRandomSeed(),
  input: new KeyboardInputAdapter(),
  // dev server では debug overlay を最初から出す。どの build でも ` / F3 で切り替えられる。
  debugOverlay: import.meta.env.DEV,
  // browser の入力を Node の headless replay で再生できるよう、dev と test build だけ Core へ渡した入力を残す。
  recordInputs: import.meta.env.MODE !== "production",
});

let assetStatus: AssetStatus = "loading";
// hot reload で stage を始め直した content。debug HUD の version と、次の変更との比較に使う。
let current = { definition: gameDefinition, assetManifest };
const viewPoolPlan = planViewPoolCapacities(gameDefinition, stage.stageId, gameDefinition.defaultPlayerId);
const game = startSampleTitleGame({
  parent: stageRoot,
  renderScale: initialLayout.renderScale,
  boot: {
    assetManifest,
    baseUrl: import.meta.env.BASE_URL,
    definitionAssets: collectDefinitionAssets(gameDefinition),
    viewPoolPlan,
    svgRasterScale: svgRasterScaleFor(initialLayout.renderScale),
    shell,
    hud,
    reportAssetStatus: (status) => {
      assetStatus = status;
    },
  },
  stage: {
    shell,
    hud,
    collisionRadii: collectCollisionRadii(gameDefinition),
    versionLabel: () => `shooting-core ${core.coreVersion} / content ${current.definition.content.version}`,
    audioStatus: PHASE_2A_AUDIO_STATUS,
  },
});
viewport.onLayoutChange((layout) => applyRenderScale(game, layout.renderScale));

// dev server の content の hot reload（design 19）。content plugin が検証した content を今の content と比べ、stage を新しい content で
// 始め直すか、sprite を読み直すか、page を読み込み直す。検証に失敗した変更は HUD の下端に出し、古い content のまま動かし続ける。
// `current` は app が実際に使っている content だけを指し、使えなかった変更（error）では進めない。
if (import.meta.hot && viewPoolPlan.ok) {
  const viewPoolCapacities = viewPoolPlan.capacities;
  import.meta.hot.on(CONTENT_UPDATE_EVENT, (update: ContentUpdate) => {
    const action = decideHotReload(update, { core, ...current, viewPoolCapacities, requestedDifficulty, halted: isSampleTitleHalted(game) });
    switch (action.type) {
      case "clearError":
        hud.showContentError(null);
        break;
      case "showError":
        hud.showContentError(action.message);
        break;
      case "reloadTextures": {
        const requests = planAssetLoads(action.assetManifest, import.meta.env.BASE_URL, svgRasterScaleFor(initialLayout.renderScale))
          .requests.filter((request) => action.keys.includes(request.key));
        const started = reloadSampleTitleTextures(game, requests, (ok) => {
          if (!ok) {
            console.info("[sample-title] content changed: reloading the page because a sprite could not be loaded");
            window.location.reload();
            return;
          }
          current = { ...current, assetManifest: action.assetManifest };
          hud.showContentError(null);
        });
        if (!started) {
          window.location.reload();
        }
        break;
      }
      case "restartStage":
        console.info("[sample-title] content changed: restarting the stage with the new content");
        shell.replaceContent(action.content);
        current = { ...current, definition: action.definition };
        hud.showContentError(null);
        break;
      case "reloadPage":
        console.info(`[sample-title] content changed: reloading the page because ${action.reason}`);
        window.location.reload();
        break;
    }
  });
}

// debug state dump の hook は dev server と test build（`vite build --mode test`）にだけ置く。production build では MODE が
// "production" に置き換わって分岐ごと消え、hook の module も bundle に入らない（vite/debug-state-hook-build.test.ts）。
if (import.meta.env.MODE !== "production") {
  installDebugStateHook({
    shell,
    layout: viewport.layout,
    assetStatus: () => assetStatus,
    audioStatus: PHASE_2A_AUDIO_STATUS,
    overlay: hud.element,
  });
}

/** `?seed=` があれば毎回その seed で stage を始める。seed は debug HUD に出し、同じ入力の再現に使う。 */
function readRequestedSeed(): string | null {
  return readQueryParameter("seed");
}

/** URL の query parameter。空白だけの値は指定がないものとする。 */
function readQueryParameter(name: string): string | null {
  const requested = new URLSearchParams(window.location.search).get(name);
  return requested !== null && requested.trim().length > 0 ? requested : null;
}

/** `?seed=` がないときに stage を始めるたびに使う乱数の seed。 */
function createRandomSeed(): string {
  return crypto.getRandomValues(new Uint32Array(1))[0]!.toString(16).padStart(8, "0");
}
