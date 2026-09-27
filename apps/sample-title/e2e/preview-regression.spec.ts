import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { expectScreenshot, readDump, readReplay, waitForLifecycle } from "./support.ts";

// browser regression（design 21.5、Phase 2B-14）。Preview を start paused（`paused=1`）で開き、tick 0 から 1 tick ずつ進めた決定的な
// 画面を screenshot の baseline と比べる。判定の正本は dump の値で、screenshot は補助にする。
test.use({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });

/** Preview を開き、開始演出の後に tick を進めずに pause するまで待つ。 */
async function openPaused(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}&seed=regression&paused=1`);
  await waitForLifecycle(page, "paused");
  expect((await readDump(page)).tick).toBe(0);
}

/** pause 中に N を押して、次に実行する tick が `tick` になるまで 1 tick ずつ進める。 */
async function stepTo(page: Page, tick: number): Promise<void> {
  const from = (await readDump(page)).tick;
  for (let step = from; step < tick; step += 1) {
    await page.keyboard.press("n");
  }
  await expect.poll(async () => (await readDump(page)).tick).toBe(tick);
}

/** playfield（transform root）だけを写す。panel（fixed で重なり得る）、debug HUD、状態の見出し（PAUSED）は写す間だけ隠す。 */
async function expectPlayfield(page: Page, name: string): Promise<void> {
  await expectScreenshot(page.locator(".stage-root"), name, {
    stylePath: fileURLToPath(new URL("./playfield-screenshot.css", import.meta.url)),
  });
}

test("keeps the gunship barrage of fan, aimed 3-way and radial ring at a fixed tick", async ({ page }) => {
  await openPaused(page, "preview=pattern:pattern.gunship_barrage");
  // tick 30 に出た gunship は 90 tick 後に 7-way、その 30 tick 後に 3-way、さらに 30 tick 後に 16 方向の輪を撃つ。
  await stepTo(page, 200);

  expect((await readDump(page)).entityCounts).toMatchObject({ enemy: 1, enemyBullet: 7 + 3 + 16 });
  await expectPlayfield(page, "preview-pattern.png");
});

test("keeps a scout moving on its path and firing its 3-way at a fixed tick", async ({ page }) => {
  await openPaused(page, "preview=enemy:enemy.scout,path.scout_sweep_left,pattern.scout_three_way");
  // tick 30 に出た scout は 60 tick 後から 40 tick ごとに 3-way を撃つ。
  await stepTo(page, 175);

  expect((await readDump(page)).entityCounts).toMatchObject({ enemy: 1, enemyBullet: 9 });
  await expectPlayfield(page, "preview-enemy.png");
});

test("keeps the pickups a shot-down drone drops at a fixed tick", async ({ page }) => {
  // stage 1 の wave 1 へ jump し、invincible の自機が撃ち続けて、中央に降りてくる drone を落とす。
  await openPaused(page, "preview=stage:stage.stage_01&jump=90&invincible=1");
  await page.keyboard.down("z");
  await stepTo(page, 80);
  await page.keyboard.up("z");

  const dump = await readDump(page);
  expect(dump.entityCounts.pickup).toBeGreaterThan(0);
  expect(dump.entityCounts).toEqual({ player: 1, enemy: 4, enemyBullet: 2, playerShot: 20, pickup: 2 });
  await expectPlayfield(page, "preview-pickup.png");
});

test("switches the difficulty of the previewed pattern and restarts it paused", async ({ page }) => {
  await openPaused(page, "preview=pattern:pattern.gunship_barrage");
  await stepTo(page, 200);
  expect((await readDump(page)).entityCounts.enemyBullet).toBe(7 + 3 + 16);

  // hard の gunship は輪を 24 方向で撃つ（difficulty の `if`）。difficulty を変えると、start paused のまま tick 0 から始め直す。
  await page.locator(".preview-difficulty").selectOption("hard");
  await expect.poll(async () => (await readReplay(page)).stage.difficulty).toBe("hard");
  await waitForLifecycle(page, "paused");
  expect((await readDump(page)).tick).toBe(0);
  await stepTo(page, 200);
  expect((await readDump(page)).entityCounts.enemyBullet).toBe(7 + 3 + 24);
  expect(new URL(page.url()).searchParams.get("difficulty")).toBe("hard");
});
