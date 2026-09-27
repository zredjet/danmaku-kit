import { devices, expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";

import { computeViewportLayout } from "../src/runtime/view/viewport-layout.ts";
import { readDump, waitForLifecycle } from "./support.ts";

type ViewportCase = Readonly<{ name: string; context: BrowserContextOptions }>;

const CASES: readonly ViewportCase[] = [
  { name: "desktop at DPR 1", context: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
  { name: "desktop at high DPI", context: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 } },
  { name: "mobile (Pixel 7)", context: { ...devices["Pixel 7"] } },
  { name: "smaller than the playfield", context: { viewport: { width: 320, height: 400 }, deviceScaleFactor: 1 } },
];

/** dump、canvas と overlay の実際の位置、canvas の画素数、scroll の有無を読む。 */
async function measure(page: Page) {
  const dump = await readDump(page);
  const page_ = await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const rect = canvas.getBoundingClientRect();
    return {
      canvasRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      canvasPixels: { width: canvas.width, height: canvas.height },
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      scrollable: document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight,
    };
  });
  return { dump, ...page_ };
}

/** 画面の大きさと DPR から期待する配置で表示され、canvas と overlay の座標が一致することを確かめる。 */
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
  expect(canvasRect.x).toBeCloseTo(dump.overlayTransform.x, 3);
  expect(canvasRect.y).toBeCloseTo(dump.overlayTransform.y, 3);
  expect(canvasRect.width / 384).toBeCloseTo(dump.overlayTransform.scale, 3);
  expect(canvasRect.height / 448).toBeCloseTo(dump.overlayTransform.scale, 3);
  expect(dump.overlayTransform).toEqual({ x: layout.letterboxX, y: layout.letterboxY, scale: layout.scale });
  expect(scrollable).toBe(false);
}

async function openTitle(browser: Browser, context: BrowserContextOptions): Promise<Page> {
  const page = await (await browser.newContext(context)).newPage();
  await page.goto("/?seed=viewport");
  await waitForLifecycle(page, "title");
  return page;
}

for (const viewportCase of CASES) {
  test(`fits the playfield and aligns the canvas with the overlay: ${viewportCase.name}`, async ({ browser }) => {
    const page = await openTitle(browser, viewportCase.context);
    await expectFitted(page);
    await page.context().close();
  });
}

test("refits the playfield and the canvas resolution after a resize", async ({ browser }) => {
  const page = await openTitle(browser, { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await expectFitted(page);
  expect((await measure(page)).canvasPixels.width).toBe(768);

  await page.setViewportSize({ width: 360, height: 420 });
  await expectFitted(page);
  expect((await measure(page)).dump.viewport.scale).toBeLessThan(1);

  await page.setViewportSize({ width: 800, height: 600 });
  await expectFitted(page);
  expect((await measure(page)).canvasPixels.width).toBe(384);
  await page.context().close();
});
