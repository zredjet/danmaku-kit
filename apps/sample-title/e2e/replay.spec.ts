import { expect, test } from "@playwright/test";

import { countGameStateEntities } from "../src/runtime/view/entity-counts.ts";
import { digestSerializedState, runHeadlessReplay, serializedStateDigest } from "../src/test-support/headless-replay.ts";
import { loadSampleTitleGame } from "../src/test-support/sample-title-game.ts";
import { readDump, readReplay, startStage, waitForLifecycle, waitForTicks } from "./support.ts";

test("replays the browser's inputs headlessly to the same state, tick, entities, pickups and player position", async ({ page }) => {
  await startStage(page, "replay-smoke");
  await page.keyboard.down("KeyZ");
  await page.keyboard.down("ArrowLeft");
  await waitForTicks(page, 40);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.down("ArrowRight");
  await waitForTicks(page, 50);
  await page.keyboard.down("Shift");
  await waitForTicks(page, 30);
  await page.keyboard.up("Shift");
  await page.keyboard.up("ArrowRight");
  await waitForTicks(page, 60);
  // pause で tick を止めてから、dump と再生記録を同じ時点で読む。
  await page.keyboard.press("KeyP");
  await waitForLifecycle(page, "paused");
  await page.keyboard.up("KeyZ");
  const dump = await readDump(page);
  const record = await readReplay(page);

  const replay = runHeadlessReplay(await loadSampleTitleGame(), record.stage, record.inputs);
  const last = replay.frames.at(-1)!;
  const player = last.state.entities.find((entity) => entity.kind === "player");

  expect(record.stage).toEqual({ stageId: "stage.stage_01", difficulty: "normal", seed: "replay-smoke" });
  expect(record.inputs.length).toBe(dump.tick);
  expect(last.tick + 1).toBe(dump.tick);
  expect(countGameStateEntities(last.state)).toEqual(dump.entityCounts);
  expect(player ? { x: player.position.x, y: player.position.y } : null).toEqual(dump.playerPosition);
  expect(serializedStateDigest(replay.session)).toBe(digestSerializedState(record.state));
  // 入力が実際に効いている（移動と低速移動と shot を含む）ことも確かめる。
  expect(record.inputs.some((input) => input.axes.moveX === -1)).toBe(true);
  expect(record.inputs.some((input) => input.held.includes("focus"))).toBe(true);
  expect(record.inputs.some((input) => input.pressed.includes("shot"))).toBe(true);
});
