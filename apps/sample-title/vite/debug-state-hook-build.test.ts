import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build, type Rolldown } from "vite";

const sampleTitleRoot = fileURLToPath(new URL("../", import.meta.url));
const HOOK_NAMES = ["__SHOOTING_DEBUG_STATE__", "__SHOOTING_DEBUG_REPLAY__"];

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

test("defines the browser debug hooks in test builds but not in production builds", async () => {
  const [production, testBuild] = [await buildJavaScript("production"), await buildJavaScript("test")];

  for (const name of HOOK_NAMES) {
    assert.equal(production.includes(name), false, `production build must not define ${name}`);
    assert.equal(testBuild.includes(name), true, `test build must define ${name}`);
  }
});
