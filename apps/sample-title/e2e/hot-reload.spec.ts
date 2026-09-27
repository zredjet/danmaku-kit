import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

import { sampleTitleContentPlugin } from "../vite/content-plugin.ts";
import { playerCenterRgb, readDump, readReplay, waitForLifecycle, waitForTicks } from "./support.ts";

// content の hot reload（design 19、Phase 2B-8）は dev server だけの機能なので、この file は content を一時 directory へ写した dev
// server を自分で起こして試す（他の test が使う test build の preview server とは別）。
test.describe.configure({ mode: "serial" });

const appRoot = fileURLToPath(new URL("../", import.meta.url));
let server: ViteDevServer;
let contentRoot: string;
let workRoot: string;

test.beforeAll(async () => {
  workRoot = await mkdtemp(path.join(tmpdir(), "sample-title-hot-reload-"));
  contentRoot = path.join(workRoot, "content");
  await cp(path.join(appRoot, "content"), contentRoot, { recursive: true });
  await cp(path.join(appRoot, "config"), path.join(workRoot, "config"), { recursive: true });
  server = await createServer({
    root: appRoot,
    configFile: false,
    // 壊れた content を試す間の Vite の error log は想定どおりなので出さない。
    logLevel: "silent",
    plugins: [sampleTitleContentPlugin({ gameDefinitionPath: path.join(workRoot, "config/game-definition.yaml"), contentRoot })],
    server: { host: "127.0.0.1", port: 4190, strictPort: false },
  });
  await server.listen();
});

test.afterAll(async () => {
  await server?.close();
  await rm(workRoot, { recursive: true, force: true });
});

/** 一時 content の file の最初の `search` を `replace` に置き換える。 */
async function editContent(file: string, search: string, replace: string): Promise<void> {
  const target = path.join(contentRoot, file);
  const source = await readFile(target, "utf8");
  expect(source).toContain(search);
  await writeFile(target, source.replace(search, replace));
}

test("restarts the stage, keeps running on errors and reloads sprites when the content changes", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${server.resolvedUrls!.local[0]!}?seed=hot-reload`);
  await waitForLifecycle(page, "title");
  await page.keyboard.press("Enter");
  await waitForLifecycle(page, "playing");
  await waitForTicks(page, 60);
  // page を読み込み直していないことを、読み込み直すと消える印で確かめる。
  await page.evaluate(() => Object.assign(window, { hotReloadMarker: true }));

  // gameplay の content を変えると、同じ page のまま新しい content で stage を最初から始め直す（入力の記録も新しい stage から）。
  await editContent("enemies/drone.yaml", "score: 50", "score: 70");
  await expect.poll(async () => (await readDump(page)).tick, { timeout: 15_000 }).toBeLessThan(30);
  await waitForLifecycle(page, "playing");
  expect((await readReplay(page)).inputs.length).toBeLessThan(60);

  // 検証に失敗した変更は HUD に出し、古い content のまま動かし続ける。直すと消える。
  await editContent("enemies/drone.yaml", "hp: 5", "hp: fast");
  await expect(page.locator(".hud-content-error")).toContainText("enemy.hp", { timeout: 15_000 });
  const whileBroken = await waitForTicks(page, 30);
  expect(whileBroken.lifecycle).toBe("playing");
  await editContent("enemies/drone.yaml", "hp: fast", "hp: 5");
  await expect(page.locator(".hud-content-error")).toBeHidden({ timeout: 15_000 });

  // sprite の path だけの変更は texture を読み直し、stage を続ける。表示中の自機の sprite を scout の sprite に替えると、自機の中心が
  // 自機の濃い青から scout の中心の黄色になる。
  expect((await playerCenterRgb(page))[0]).toBeLessThan(100);
  await editContent("assets/manifest.yaml", "path: assets/sprites/player.svg", "path: assets/sprites/enemy-scout.svg");
  await expect.poll(async () => (await playerCenterRgb(page))[0], { timeout: 15_000 }).toBeGreaterThan(200);
  expect((await waitForTicks(page, 30)).lifecycle).toBe("playing");
  expect(await page.evaluate(() => (window as unknown as { hotReloadMarker?: boolean }).hotReloadMarker)).toBe(true);

  // 読み込み済みの view pool に収まらない変更（enemy を足す）は page を読み込み直す。
  await editContent("stages/stage_01.yaml", "timeline:\n", "timeline:\n  - tick: 1\n    action:\n      type: spawnEnemy\n      enemy: enemy.drone\n      path: path.drone_dive\n      pattern: pattern.drone_aimed_shot\n      position: { x: 40, y: -16 }\n");
  await expect.poll(async () => page.evaluate(() => (window as unknown as { hotReloadMarker?: boolean }).hotReloadMarker ?? false)
    // 読み込み直しの途中は context がないので、読み込み終わるまで待ち続ける。
    .catch(() => "navigating"), { timeout: 15_000 }).toBe(false);
  await waitForLifecycle(page, "title");
  expect(pageErrors).toEqual([]);
});

test("reloads a page that loaded broken content once the content is fixed", async ({ page }) => {
  await page.goto(`${server.resolvedUrls!.local[0]!}?seed=hot-reload-broken`);
  await waitForLifecycle(page, "title");
  await editContent("enemies/drone.yaml", "hp: 5", "hp: fast");
  await expect(page.locator(".hud-content-error")).toContainText("enemy.hp", { timeout: 15_000 });

  // 壊れた content のまま page を読み込み直すと app は動かない（Vite の error overlay）が、直すと page を読み込み直して戻る。
  await page.reload();
  await expect(page.locator("vite-error-overlay")).toHaveCount(1, { timeout: 15_000 });
  await editContent("enemies/drone.yaml", "hp: fast", "hp: 5");
  await waitForLifecycle(page, "title");
});
