import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

/**
 * browser smoke test（design 21.5、Phase 2A-12）。`npm run test:browser` で実行し、node:test の `npm test` とは分ける。
 *
 * debug state dump の hook は production build に入らないため、`vite build --mode test` の bundle を `vite preview` で配って試す。
 * 古い bundle や別の app を試さないよう、実行のたびに build して server を起こし、port が塞がっていれば `--strictPort` で失敗させる。
 * screenshot diff は補助で、font の描画が OS で違うため baseline は platform ごとに commit する。baseline のない platform では、手元の
 * 最初の実行が失敗して baseline を書き出すので、中身を確かめてから commit する（`npm run test:browser -- --update-snapshots` でも
 * 作れる）。Linux の baseline は `.github/workflows/browser-baselines.yml` を手動で実行して artifact から commit する。CI は Linux の
 * baseline と比べ、baseline のない screenshot は失敗する（`ALLOW_MISSING_BROWSER_BASELINES=1` で一時的に skip できる、`e2e/support.ts`
 * の `expectScreenshot()`）。
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" },
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: "npm run build:test && npm run preview:test",
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
