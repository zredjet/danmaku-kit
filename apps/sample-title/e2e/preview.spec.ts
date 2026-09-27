import { expect, test, type Page } from "@playwright/test";

import { readDump, readReplay, waitForLifecycle } from "./support.ts";

// Preview（design 19、Phase 2B-9）。test build でも `?preview` で開ける（production build には入らない）。

/** Preview が URL に書いた選択。 */
function previewParameters(page: Page): Readonly<Record<string, string | null>> {
  const parameters = new URL(page.url()).searchParams;
  return { preview: parameters.get("preview"), seed: parameters.get("seed"), difficulty: parameters.get("difficulty") };
}

test("previews a pattern alone, steps it while paused and restarts it with another seed and target", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/?preview=pattern:pattern.gunship_barrage&seed=preview-e2e");
  // Preview は title で止めずに、選んだ対象をすぐ始め、選択を URL に書く。
  await waitForLifecycle(page, "playing");
  expect((await readReplay(page)).stage).toEqual({ stageId: "stage.preview", difficulty: "normal", seed: "preview-e2e" });
  expect(previewParameters(page)).toEqual({ preview: "pattern:pattern.gunship_barrage", seed: "preview-e2e", difficulty: "normal" });
  await expect(page.locator(".preview-panel")).toBeVisible();
  await expect(page.locator(".preview-info")).toContainText("seed preview-e2e  normal");

  // 合成した stage は対象の enemy を 1 体だけ出し、overlay は player と enemy の id、panel は pattern runner の cursor を出す。
  await expect.poll(async () => (await readDump(page)).entityCounts.enemy).toBe(1);
  await expect.poll(() => page.locator(".preview-entity-id").count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".preview-info")).toContainText("pattern.gunship_barrage cursor");

  // pause した frame の tick と PRNG state を、そのまま panel に出す。
  await page.locator(".preview-pause").click();
  await waitForLifecycle(page, "paused");
  const pausedTick = (await readDump(page)).tick;
  await expect(page.locator(".preview-info")).toContainText(`next tick ${pausedTick}  prng`);
  await page.locator(".preview-step").click();
  await page.locator(".preview-step").click();
  await page.keyboard.press("n");
  await expect.poll(async () => (await readDump(page)).tick).toBe(pausedTick + 3);
  await expect(page.locator(".preview-info")).toContainText(`next tick ${pausedTick + 3}  prng`);

  // 入力欄に打った文字は game の入力にならず（P で pause が解けない）、Restart は入力中の seed で始め直す。
  await page.locator(".preview-seed").fill("");
  await page.locator(".preview-seed").pressSequentially("preview-p");
  // 打った key が game に届いていれば、次の render frame で pause が解ける。
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect((await readDump(page)).lifecycle).toBe("paused");
  await page.locator(".preview-restart").click();
  await expect.poll(async () => (await readDump(page)).seed).toBe("preview-p");
  await waitForLifecycle(page, "playing");
  expect(previewParameters(page).seed).toBe("preview-p");

  // stage を選ぶと content の stage をそのまま始め、R でも始め直す。
  await page.locator(".preview-kind").selectOption("stage");
  await expect.poll(async () => (await readReplay(page)).stage.stageId).toBe("stage.stage_01");
  expect(previewParameters(page)).toEqual({ preview: "stage:stage.stage_01", seed: "preview-p", difficulty: "normal" });
  await waitForLifecycle(page, "playing");
  await expect.poll(async () => (await readDump(page)).tick).toBeGreaterThan(30);
  await page.keyboard.press("r");
  await expect.poll(async () => (await readDump(page)).lifecycle).toBe("stageStarting");
  expect(pageErrors).toEqual([]);
});

test("jumps into the stage with an invincible player and reopens the same cheats after a reload", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/?preview=stage:stage.stage_01&seed=preview-cheat");
  await waitForLifecycle(page, "playing");
  await expect(page.locator(".hud-lives")).toHaveText("LIVES ▲▲▲");

  // invincible は自機の lives を大きくした definition で始め直す（入力には混ぜない）。
  await page.locator(".preview-invincible").check();
  await waitForLifecycle(page, "playing");
  await expect(page.locator(".hud-lives")).toHaveText("LIVES ▲×60000");
  expect((await readReplay(page)).stage.stageId).toBe("stage.stage_01");

  // stage jump は選んだ tick より前の spawn を除いて詰めた stage を始める。
  const jumpTick = (await page.locator(".preview-jump option").allTextContents())[2]!;
  await page.locator(".preview-jump").selectOption(jumpTick);
  await expect.poll(async () => (await readReplay(page)).stage.stageId).toBe("stage.stage_01_jump");
  await waitForLifecycle(page, "playing");
  await expect.poll(async () => (await readDump(page)).entityCounts.enemy).toBeGreaterThan(0);
  await expect(page.locator(".preview-info")).toContainText(`invincible  jump ${jumpTick}`);
  expect(previewParameters(page)).toEqual({ preview: "stage:stage.stage_01", seed: "preview-cheat", difficulty: "normal" });
  expect(new URL(page.url()).searchParams.get("invincible")).toBe("1");
  expect(new URL(page.url()).searchParams.get("jump")).toBe(jumpTick);

  await page.reload();
  await waitForLifecycle(page, "playing");
  expect((await readReplay(page)).stage).toEqual({ stageId: "stage.stage_01_jump", difficulty: "normal", seed: "preview-cheat" });
  await expect(page.locator(".preview-invincible")).toBeChecked();
  await expect(page.locator(".preview-jump")).toHaveValue(jumpTick);
  expect(pageErrors).toEqual([]);
});
