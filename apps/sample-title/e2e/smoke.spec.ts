import { expect, test, type Page } from "@playwright/test";

import { decodePng, rgbAt } from "./png.ts";
import { BACKGROUND_RGB, readDump, startStage, toViewportPoint, waitForLifecycle, waitForTicks } from "./support.ts";

// 等倍（scale 1、DPR 1）で表示し、playfield の 1 px が screenshot の 1 px になるようにする。
test.use({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });

/** 自機の中心の画素の色を screenshot から読む。 */
async function playerCenterRgb(page: Page): Promise<[number, number, number]> {
  const dump = await readDump(page);
  if (!dump.playerPosition) {
    throw new Error("no player in the frame");
  }
  const center = toViewportPoint(dump, dump.playerPosition);
  return rgbAt(decodePng(await page.screenshot()), center.x, center.y);
}

const isWhite = ([red, green, blue]: readonly number[]) => red! > 230 && green! > 230 && blue! > 230;

test("boots to the title with the assets loaded and the debug overlay hidden", async ({ page }) => {
  await page.goto("/?seed=smoke");
  await waitForLifecycle(page, "title");

  expect(await readDump(page)).toMatchObject({
    schemaVersion: "1",
    kind: "browser",
    tick: 0,
    seed: null,
    assetStatus: "ready",
    audioStatus: "muted",
    debugOverlay: false,
    playerPosition: null,
  });
  await expect(page.locator(".hud-banner-title")).toHaveText("SHOOTING SAMPLE");
  await expect(page.locator(".hud-debug")).toHaveText("");
});

test("draws the player, moves it with the arrow keys and shows the hitbox at the focus speed", async ({ page }) => {
  await startStage(page, "smoke-move");
  await waitForTicks(page, 2);
  // canvas に自機が描かれ、背景色だけではない。
  const idle = await playerCenterRgb(page);
  expect(idle).not.toEqual([...BACKGROUND_RGB]);
  expect(isWhite(idle)).toBe(false);

  await page.keyboard.down("ArrowLeft");
  const leftFrom = await waitForTicks(page, 3);
  const leftTo = await waitForTicks(page, 10);
  await page.keyboard.up("ArrowLeft");
  // 押している間の tick はすべて通常速度（4 px / tick）で動く。
  expect(leftFrom.playerPosition!.x - leftTo.playerPosition!.x).toBe(4 * (leftTo.tick - leftFrom.tick));

  await page.keyboard.down("Shift");
  await page.keyboard.down("ArrowRight");
  const focusFrom = await waitForTicks(page, 3);
  const focusTo = await waitForTicks(page, 10);
  // 低速移動は 1.8 px / tick。
  expect(focusTo.playerPosition!.x - focusFrom.playerPosition!.x).toBeCloseTo(1.8 * (focusTo.tick - focusFrom.tick), 6);
  // focus 中は自機の中心に当たり判定（白）を重ねる。dump を読んでから screenshot を撮るまでに動かないよう、Shift だけを押したまま止める。
  await page.keyboard.up("ArrowRight");
  await waitForTicks(page, 2);
  expect(isWhite(await playerCenterRgb(page))).toBe(true);
  await page.keyboard.up("Shift");
});

test("updates the HUD score when the player shoots down a drone", async ({ page }) => {
  await startStage(page, "smoke-hud");
  await expect(page.locator(".hud-score")).toHaveText("SCORE 0000000");
  await expect(page.locator(".hud-lives")).toHaveText("LIVES ▲▲▲");

  // wave 1 の drone の 1 体は自機の真上（x = 192）に降りてくる。
  await page.keyboard.down("KeyZ");
  await expect(page.locator(".hud-score")).not.toHaveText("SCORE 0000000");
  await page.keyboard.up("KeyZ");
  expect(await page.locator(".hud-score").textContent()).toMatch(/^SCORE \d{7}$/);
});

test("toggles the debug overlay and its colliders with the backquote and F3 keys", async ({ page }) => {
  await startStage(page, "smoke-debug");
  await waitForTicks(page, 2);
  // pause して自機を止め、collider の表示だけを切り替えて比べる。
  await page.keyboard.press("KeyP");
  await waitForLifecycle(page, "paused");
  const hidden = decodePng(await page.screenshot());

  await page.keyboard.press("Backquote");
  await expect.poll(async () => (await readDump(page)).debugOverlay).toBe(true);
  await expect(page.locator(".hud-debug")).toContainText("paused  audio muted");
  const shown = decodePng(await page.screenshot());

  // 自機の collider（半径 3 の円）が中心のまわりに描かれ、周囲の画素が変わる。
  const dump = await readDump(page);
  const center = toViewportPoint(dump, dump.playerPosition!);
  let changed = 0;
  for (let dy = -6; dy <= 6; dy += 1) {
    for (let dx = -6; dx <= 6; dx += 1) {
      const before = rgbAt(hidden, center.x + dx, center.y + dy);
      const after = rgbAt(shown, center.x + dx, center.y + dy);
      changed += before.some((value, index) => Math.abs(value - after[index]!) > 24) ? 1 : 0;
    }
  }
  expect(changed).toBeGreaterThan(6);

  await page.keyboard.press("F3");
  await expect.poll(async () => (await readDump(page)).debugOverlay).toBe(false);
  await expect(page.locator(".hud-debug")).toHaveText("");
});
