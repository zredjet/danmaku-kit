import { existsSync } from "node:fs";

import { expect, test, type Locator, type Page, type PageAssertionsToHaveScreenshotOptions } from "@playwright/test";

import type {} from "../src/debug/debug-state-hook.ts";
import type { BrowserDebugStateDump } from "../src/runtime/debug/browser-debug-state.ts";
import type { BrowserReplayRecord } from "../src/runtime/debug/browser-replay-record.ts";
import type { GameLifecycleState } from "../src/runtime/lifecycle/game-lifecycle.ts";
import { PLAYFIELD_BACKGROUND_COLOR } from "../src/runtime/view/playfield.ts";
import { decodePng, rgbAt } from "./png.ts";

/** playfield の背景色の RGB。canvas に何も描かれていない画素の色。 */
export const BACKGROUND_RGB: readonly [number, number, number] = Object.freeze([1, 3, 5].map((start) => (
  Number.parseInt(PLAYFIELD_BACKGROUND_COLOR.slice(start, start + 2), 16)
)) as [number, number, number]);

/** `window.__SHOOTING_DEBUG_STATE__()` を読む。 */
export function readDump(page: Page): Promise<BrowserDebugStateDump> {
  return page.evaluate(() => {
    const read = window.__SHOOTING_DEBUG_STATE__;
    if (!read) {
      throw new Error("the debug state hook is not installed; run the test build");
    }
    return read();
  });
}

/** `window.__SHOOTING_DEBUG_REPLAY__()` を読む。 */
export async function readReplay(page: Page): Promise<BrowserReplayRecord> {
  const record = await page.evaluate(() => window.__SHOOTING_DEBUG_REPLAY__?.() ?? null);
  if (!record) {
    throw new Error("no replay record: the stage has not started or inputs are not recorded");
  }
  return record;
}

/**
 * lifecycle が `state` になるまで待つ。loading は view pool の準備を含むので長めに待つ。page を読み込み直している間は debug hook がまだ
 * ないので、hook ができるまで待ち続ける。
 */
export async function waitForLifecycle(page: Page, state: GameLifecycleState): Promise<void> {
  await expect.poll(
    // 読み込み直しの途中で page の context が入れ替わると evaluate が失敗するので、そのときも待ち続ける。
    async () => page.evaluate(() => window.__SHOOTING_DEBUG_STATE__?.().lifecycle ?? null).catch(() => null),
    { timeout: 30_000 },
  ).toBe(state);
}

/** 今の tick から `ticks` だけ進むまで待ち、進んだ後の dump を返す。 */
export async function waitForTicks(page: Page, ticks: number): Promise<BrowserDebugStateDump> {
  const target = (await readDump(page)).tick + ticks;
  await expect.poll(async () => (await readDump(page)).tick).toBeGreaterThanOrEqual(target);
  return readDump(page);
}

/** `seed` を指定して開き、title で Enter を押して開始演出を終え、playing になるまで待つ。 */
export async function startStage(page: Page, seed: string): Promise<void> {
  await page.goto(`/?seed=${encodeURIComponent(seed)}`);
  await waitForLifecycle(page, "title");
  await page.keyboard.press("Enter");
  await waitForLifecycle(page, "playing");
}

/** playfield の座標を、dump の overlay の配置から viewport の CSS px に変える。 */
export function toViewportPoint(dump: BrowserDebugStateDump, point: Readonly<{ x: number; y: number }>): { x: number; y: number } {
  return {
    x: dump.overlayTransform.x + point.x * dump.overlayTransform.scale,
    y: dump.overlayTransform.y + point.y * dump.overlayTransform.scale,
  };
}

/** 自機の中心の画素の色を screenshot から読む。 */
export async function playerCenterRgb(page: Page): Promise<[number, number, number]> {
  const dump = await readDump(page);
  if (!dump.playerPosition) {
    throw new Error("no player in the frame");
  }
  const center = toViewportPoint(dump, dump.playerPosition);
  return rgbAt(decodePng(await page.screenshot()), center.x, center.y);
}

/**
 * screenshot を platform ごとの baseline と比べる（補助の検査、design 21.5）。CI で今の platform の baseline がまだなければ、比べずに
 * skip して baseline を作る workflow（`.github/workflows/browser-baselines.yml`）を案内する。その workflow（`UPDATE_BROWSER_BASELINES=1`）
 * と手元では Playwright の既定どおり、baseline がなければ書き出して失敗する（中身を確かめてから commit する）。
 */
export async function expectScreenshot(
  target: Page | Locator,
  name: string,
  options: PageAssertionsToHaveScreenshotOptions = {},
): Promise<void> {
  const baseline = test.info().snapshotPath(name);
  if (process.env.CI && process.env.UPDATE_BROWSER_BASELINES !== "1" && !existsSync(baseline)) {
    test.info().annotations.push({ type: "missing baseline", description: `${baseline}: run the browser-baselines workflow` });
    test.skip(true, `no ${process.platform} baseline for ${name}`);
    return;
  }
  await expect(target).toHaveScreenshot(name, options);
}
