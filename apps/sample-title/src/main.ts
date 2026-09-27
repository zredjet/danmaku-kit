import { createShootingCore } from "@shooting-sample/shooting-core";
import gameDefinition, { assetManifest } from "virtual:sample-title/game-definition";

import { PHASE_2A_AUDIO_STATUS } from "./runtime/audio/audio-status.ts";
import { KeyboardInputAdapter } from "./runtime/input/keyboard-input.ts";
import { GameShell } from "./runtime/lifecycle/game-shell.ts";
import { applyRenderScale } from "./runtime/phaser/render-scale.ts";
import { startSampleTitleGame } from "./runtime/phaser/sample-title-game.ts";
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

const core = createShootingCore();
const loaded = core.load(gameDefinition);
if (!loaded.ok) {
  // content plugin が同じ Core で検証済みのため、ここで失敗するのは Core と content の組み合わせ自体の不整合だけになる。
  throw new Error(`Core rejected the validated game definition: ${loaded.errors.map((error) => error.code).join(", ")}`);
}

// stage select を置くまでは、title から最初の stage を最初の difficulty で始める。
const stage = gameDefinition.content.stages[0];
const difficulty = stage?.difficulties[0];
if (!stage || !difficulty) {
  throw new Error("sample title content must define a stage with at least one difficulty");
}

const requestedSeed = readRequestedSeed();
const shell = new GameShell({
  loadedGame: loaded.value,
  stage: { stageId: stage.id, difficulty },
  nextSeed: () => requestedSeed ?? createRandomSeed(),
  input: new KeyboardInputAdapter(),
});

const game = startSampleTitleGame({
  parent: stageRoot,
  renderScale: initialLayout.renderScale,
  boot: {
    assetManifest,
    baseUrl: import.meta.env.BASE_URL,
    definitionAssets: collectDefinitionAssets(gameDefinition),
    viewPoolPlan: planViewPoolCapacities(gameDefinition, stage.id, gameDefinition.defaultPlayerId),
    svgRasterScale: svgRasterScaleFor(initialLayout.renderScale),
    shell,
    hud,
  },
  stage: {
    shell,
    hud,
    collisionRadii: collectCollisionRadii(gameDefinition),
    versionLabel: `shooting-core ${core.coreVersion} / content ${gameDefinition.content.version}`,
    audioStatus: PHASE_2A_AUDIO_STATUS,
  },
});
viewport.onLayoutChange((layout) => applyRenderScale(game, layout.renderScale));

/** `?seed=` があれば毎回その seed で stage を始める。seed は debug HUD に出し、同じ入力の再現に使う。 */
function readRequestedSeed(): string | null {
  const requested = new URLSearchParams(window.location.search).get("seed");
  return requested !== null && requested.trim().length > 0 ? requested : null;
}

/** `?seed=` がないときに stage を始めるたびに使う乱数の seed。 */
function createRandomSeed(): string {
  return crypto.getRandomValues(new Uint32Array(1))[0]!.toString(16).padStart(8, "0");
}
