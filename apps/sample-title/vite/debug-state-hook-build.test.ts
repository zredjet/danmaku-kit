import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build, type Rolldown } from "vite";

const sampleTitleRoot = fileURLToPath(new URL("../", import.meta.url));
const HOOK_NAME = "__SHOOTING_DEBUG_STATE__";

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

test("defines the browser debug state hook in test builds but not in production builds", async () => {
  const [production, testBuild] = [await buildJavaScript("production"), await buildJavaScript("test")];

  assert.equal(production.includes(HOOK_NAME), false, "production build must not define the debug state hook");
  assert.equal(testBuild.includes(HOOK_NAME), true, "test build must define the debug state hook");
});
