import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testPath = fileURLToPath(new URL("../src/cli-golden.test.ts", import.meta.url));
const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", testPath],
  {
    env: { ...process.env, UPDATE_VALIDATE_CONTENT_GOLDENS: "1" },
    stdio: "inherit",
    timeout: 120_000,
    windowsHide: true,
  },
);

if (result.error !== undefined) {
  console.error(`validate-content golden update failed: ${result.error.message}`);
  process.exitCode = 2;
} else if (result.signal !== null) {
  console.error(`validate-content golden update stopped by signal: ${result.signal}`);
  process.exitCode = 2;
} else {
  process.exitCode = result.status ?? 2;
}
