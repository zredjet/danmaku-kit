import { expect, type Page } from "@playwright/test";

import type {} from "../src/debug/debug-state-hook.ts";
import type { BrowserDebugStateDump } from "../src/runtime/debug/browser-debug-state.ts";
import type { BrowserReplayRecord } from "../src/runtime/debug/browser-replay-record.ts";
import type { GameLifecycleState } from "../src/runtime/lifecycle/game-lifecycle.ts";

/** 背景色（sample-title-game.ts の backgroundColor）。canvas に何も描かれていない画素の色。 */
export const BACKGROUND_RGB = Object.freeze([0x0b, 0x0d, 0x1a] as const);

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

/** lifecycle が `state` になるまで待つ。loading は view pool の準備を含むので長めに待つ。 */
export async function waitForLifecycle(page: Page, state: GameLifecycleState): Promise<void> {
  await expect.poll(async () => (await readDump(page)).lifecycle, { timeout: 30_000 }).toBe(state);
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
