import { expect, test } from "@playwright/test";

import { waitForLifecycle } from "./support.ts";

// screenshot diff は視覚崩れを見つける補助で、判定の正本は dump と replay にする（design 21.5）。font の描画は OS で違うため、
// baseline は platform ごとに持つ（playwright.config.ts）。debug HUD は mask し、差分は画素の 2% まで許す。
test.use({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });

test("keeps the title screen layout", async ({ page }) => {
  await page.goto("/?seed=screenshot");
  await waitForLifecycle(page, "title");

  await expect(page).toHaveScreenshot("title.png", { mask: [page.locator(".hud-debug")] });
});
