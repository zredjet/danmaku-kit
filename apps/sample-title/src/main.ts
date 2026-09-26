import { createShootingCore } from "@shooting-sample/shooting-core";

import { startSampleTitleGame } from "./runtime/phaser/sample-title-game.ts";

const parent = document.getElementById("game");
if (!parent) {
  throw new Error("index.html must contain the #game element");
}

const core = createShootingCore();
startSampleTitleGame({ parent, coreVersion: core.coreVersion });
