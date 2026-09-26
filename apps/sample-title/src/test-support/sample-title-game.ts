import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createShootingCore,
  type GameDefinition,
  type StageSession,
} from "@shooting-sample/shooting-core";
import { formatValidateContentHuman, loadValidatedGameDefinition } from "@shooting-sample/validate-content";

const sampleTitleRoot = fileURLToPath(new URL("../../", import.meta.url));

/** sample title の content を content plugin と同じ validate-content の API で検証して返す。 */
export async function loadSampleTitleDefinition(): Promise<GameDefinition> {
  const loaded = await loadValidatedGameDefinition({
    gameDefinitionPath: path.join(sampleTitleRoot, "config/game-definition.yaml"),
    contentRoot: path.join(sampleTitleRoot, "content"),
  });
  if (!loaded.ok) {
    throw new Error(formatValidateContentHuman(loaded.runResult.output));
  }
  return loaded.definition;
}

/** sample title の content を Core に load し、`stage.stage_01` を指定 seed で開始した session を返す。 */
export async function startSampleTitleStage(seed: string): Promise<StageSession> {
  const game = createShootingCore().load(await loadSampleTitleDefinition());
  if (!game.ok) {
    throw new Error(JSON.stringify(game.errors));
  }
  const session = game.value.startStage({ stageId: "stage.stage_01", difficulty: "normal", seed });
  if (!session.ok) {
    throw new Error(JSON.stringify(session.errors));
  }
  return session.value;
}
