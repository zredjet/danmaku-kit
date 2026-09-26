import { createShootingCore } from "@shooting-sample/shooting-core";
import gameDefinition from "virtual:sample-title/game-definition";

import { startSampleTitleGame } from "./runtime/phaser/sample-title-game.ts";

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

startSampleTitleGame({
  parent,
  coreVersion: core.coreVersion,
  contentVersion: gameDefinition.content.version,
});
