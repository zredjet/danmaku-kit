import { createShootingCore } from "@shooting-sample/shooting-core";
import gameDefinition, { assetManifest } from "virtual:sample-title/game-definition";

import { startSampleTitleGame } from "./runtime/phaser/sample-title-game.ts";
import { collectCollisionRadii } from "./runtime/view/collision-radii.ts";
import { collectDefinitionAssets } from "./runtime/view/definition-assets.ts";
import { planViewPoolCapacities } from "./runtime/view/view-pool-plan.ts";

const parent = document.getElementById("game");
if (!parent) {
  throw new Error("index.html must contain the #game element");
}

const core = createShootingCore();
const loaded = core.load(gameDefinition);
if (!loaded.ok) {
  // content plugin が同じ Core で検証済みのため、ここで失敗するのは Core と content の組み合わせ自体の不整合だけになる。
  throw new Error(`Core rejected the validated game definition: ${loaded.errors.map((error) => error.code).join(", ")}`);
}

// title / stage select を置くまでは、最初の stage を最初の difficulty で始める。
const stage = gameDefinition.content.stages[0];
const difficulty = stage?.difficulties[0];
if (!stage || !difficulty) {
  throw new Error("sample title content must define a stage with at least one difficulty");
}

startSampleTitleGame({
  parent,
  boot: {
    assetManifest,
    baseUrl: import.meta.env.BASE_URL,
    definitionAssets: collectDefinitionAssets(gameDefinition),
    viewPoolPlan: planViewPoolCapacities(gameDefinition, stage.id, gameDefinition.defaultPlayerId),
  },
  stage: {
    loadedGame: loaded.value,
    stage: { stageId: stage.id, difficulty, seed: readSeed() },
    collisionRadii: collectCollisionRadii(gameDefinition),
    versionLabel: `shooting-core ${core.coreVersion} / content ${gameDefinition.content.version}`,
  },
});

/** `?seed=` があればその seed で、なければ起動ごとの乱数で stage を始める。seed は画面に出し、同じ入力の再現に使う。 */
function readSeed(): string {
  const requested = new URLSearchParams(window.location.search).get("seed");
  if (requested !== null && requested.trim().length > 0) {
    return requested;
  }
  return crypto.getRandomValues(new Uint32Array(1))[0]!.toString(16).padStart(8, "0");
}
