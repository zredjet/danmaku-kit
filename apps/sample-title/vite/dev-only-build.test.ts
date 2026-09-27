import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build, type Rolldown } from "vite";

const sampleTitleRoot = fileURLToPath(new URL("../", import.meta.url));
/** debug state dump の hook と、Preview（panel の class 名と合成する stage の id）と、その dev-only の cheat（Phase 2B-10）。 */
const DEV_ONLY_MARKERS = [
  "__SHOOTING_DEBUG_STATE__",
  "__SHOOTING_DEBUG_REPLAY__",
  "preview-panel",
  "stage.preview",
  "preview-invincible",
  "_jump",
];

/** sample app を `mode` で build し、出力した JavaScript をつなげて返す（file には書かない）。 */
async function buildJavaScript(mode: string): Promise<string> {
  const result = await build({
    root: sampleTitleRoot,
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    mode,
    logLevel: "silent",
    build: { write: false },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  return outputs
    .flatMap((output) => output.output)
    .flatMap((item) => item.type === "chunk" ? [item.code] : [])
    .join("\n");
}

test("puts the browser debug hooks and the preview in test builds but not in production builds", async () => {
  const [production, testBuild] = [await buildJavaScript("production"), await buildJavaScript("test")];

  for (const marker of DEV_ONLY_MARKERS) {
    assert.equal(production.includes(marker), false, `production build must not contain ${marker}`);
    assert.equal(testBuild.includes(marker), true, `test build must contain ${marker}`);
  }
});
