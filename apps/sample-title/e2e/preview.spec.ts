import { expect, test } from "@playwright/test";

import { readDump, readReplay, waitForLifecycle } from "./support.ts";

// Preview（design 19、Phase 2B-9）。test build でも `?preview` で開ける（production build には入らない）。

test("previews a pattern alone, steps it while paused and restarts it with another seed and target", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/?preview=pattern:pattern.gunship_barrage&seed=preview-e2e");
  // Preview は title で止めずに、選んだ対象をすぐ始める。
  await waitForLifecycle(page, "playing");
  expect((await readReplay(page)).stage).toEqual({ stageId: "stage.preview", difficulty: "normal", seed: "preview-e2e" });
  await expect(page.locator(".preview-panel")).toBeVisible();
  await expect(page.locator(".preview-hint")).toHaveText("?preview=pattern:pattern.gunship_barrage");
  await expect(page.locator(".preview-info")).toContainText("seed preview-e2e  normal");

  // 合成した stage は対象の enemy を 1 体だけ出し、overlay は player と enemy の id と pattern runner の cursor を出す。
  await expect.poll(async () => (await readDump(page)).entityCounts.enemy).toBe(1);
  await expect.poll(() => page.locator(".preview-entity-id").count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".preview-info")).toContainText("pattern.gunship_barrage cursor");

  await page.locator(".preview-pause").click();
  await waitForLifecycle(page, "paused");
  const pausedTick = (await readDump(page)).tick;
  await page.locator(".preview-step").click();
  await page.locator(".preview-step").click();
  await page.keyboard.press("n");
  await expect.poll(async () => (await readDump(page)).tick).toBe(pausedTick + 3);
  await expect(page.locator(".preview-info")).toContainText(`tick ${pausedTick + 3}  prng`);

  // seed を変えると、その seed で始め直す（入力欄に打った文字は game の入力にならない）。
  await page.locator(".preview-seed").fill("preview-other");
  await page.locator(".preview-seed").press("Enter");
  await expect.poll(async () => (await readDump(page)).seed).toBe("preview-other");
  await waitForLifecycle(page, "playing");

  // stage を選ぶと content の stage をそのまま始め、R でも始め直す。
  await page.locator(".preview-kind").selectOption("stage");
  await expect.poll(async () => (await readReplay(page)).stage.stageId).toBe("stage.stage_01");
  await waitForLifecycle(page, "playing");
  await expect.poll(async () => (await readDump(page)).tick).toBeGreaterThan(30);
  await page.keyboard.press("r");
  await expect.poll(async () => (await readDump(page)).lifecycle).toBe("stageStarting");
  expect(pageErrors).toEqual([]);
});
