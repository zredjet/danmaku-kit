import { devices, expect, test, type Page, type PlaywrightTestOptions } from "@playwright/test";

import { computeViewportLayout } from "../src/runtime/view/viewport-layout.ts";
import { readDump, waitForLifecycle } from "./support.ts";

type ViewportCase = Readonly<{ name: string; use: Partial<PlaywrightTestOptions> }>;

// device の descriptor の `defaultBrowserType` は worker を分けるため describe の中では指定できない。project と同じ chromium なので外す。
const { defaultBrowserType: _pixel7Browser, ...PIXEL_7 } = devices["Pixel 7"];

const CASES: readonly ViewportCase[] = [
  { name: "desktop at DPR 1", use: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
  { name: "desktop at high DPI", use: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 } },
  { name: "mobile (Pixel 7)", use: PIXEL_7 },
  { name: "smaller than the playfield", use: { viewport: { width: 320, height: 400 }, deviceScaleFactor: 1 } },
];

/** dump、canvas の実際の位置と画素数、window の大きさ、scroll の有無を読む。 */
async function measure(page: Page) {
  const dump = await readDump(page);
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const rect = canvas.getBoundingClientRect();
    return {
      canvasRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      canvasPixels: { width: canvas.width, height: canvas.height },
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      scrollable: document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight,
    };
  });
  return { dump, ...layout };
}

/**
 * 画面の大きさと DPR から期待する配置で表示され、canvas と overlay の座標が一致することを確かめる。DOMRect から求めた値は layout の
 * 丸めを含むため、小数の比較には誤差を許す。
 */
async function expectFitted(page: Page): Promise<void> {
  await expect.poll(async () => {
    const { dump, viewport } = await measure(page);
    const expected = computeViewportLayout(viewport);
    return dump.viewport.scale === expected.scale && dump.viewport.devicePixelRatio === expected.devicePixelRatio;
  }).toBe(true);
  const { dump, canvasRect, canvasPixels, viewport, scrollable } = await measure(page);
  const { renderScale, ...layout } = computeViewportLayout(viewport);

  expect(dump.viewport).toEqual(layout);
  expect(canvasPixels).toEqual({ width: 384 * renderScale, height: 448 * renderScale });
  expect(dump.overlayTransform.x).toBeCloseTo(layout.letterboxX, 3);
  expect(dump.overlayTransform.y).toBeCloseTo(layout.letterboxY, 3);
  expect(dump.overlayTransform.scale).toBeCloseTo(layout.scale, 3);
  expect(canvasRect.x).toBeCloseTo(dump.overlayTransform.x, 3);
  expect(canvasRect.y).toBeCloseTo(dump.overlayTransform.y, 3);
  expect(canvasRect.width / 384).toBeCloseTo(dump.overlayTransform.scale, 3);
  expect(canvasRect.height / 448).toBeCloseTo(dump.overlayTransform.scale, 3);
  expect(scrollable).toBe(false);
}

async function openTitle(page: Page): Promise<void> {
  await page.goto("/?seed=viewport");
  await waitForLifecycle(page, "title");
}

for (const viewportCase of CASES) {
  test.describe(viewportCase.name, () => {
    test.use(viewportCase.use);

    test("fits the playfield and aligns the canvas with the overlay", async ({ page }) => {
      await openTitle(page);
      await expectFitted(page);
    });
  });
}

test.describe("resize", () => {
  test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  test("refits the playfield and the canvas resolution after a resize", async ({ page }) => {
    await openTitle(page);
    await expectFitted(page);
    expect((await measure(page)).canvasPixels.width).toBe(768);

    await page.setViewportSize({ width: 360, height: 420 });
    await expectFitted(page);
    expect((await measure(page)).dump.viewport.scale).toBeLessThan(1);

    await page.setViewportSize({ width: 800, height: 600 });
    await expectFitted(page);
    expect((await measure(page)).canvasPixels.width).toBe(384);
  });
});
