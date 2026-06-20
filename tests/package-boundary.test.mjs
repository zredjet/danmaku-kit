import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createMinimumDefinition } from "./fixtures/minimum-game-definition.ts";

const packageRoot = fileURLToPath(new URL("../packages/shooting-core", import.meta.url));

test("imports shooting core through the workspace package export", async () => {
  const core = await import("@shooting-sample/shooting-core");

  assert.deepEqual(Object.keys(core).sort(), ["createShootingCore"]);
  assert.equal(typeof core.createShootingCore, "function");
});

test("exposes only the root package export", async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));

  assert.deepEqual(Object.keys(packageJson.exports).sort(), ["."]);
});

test("rejects deep package imports outside the public export map", async () => {
  const forbiddenSubpaths = [
    "package.json",
    ...await listBasicSourceSubpaths(),
  ];

  for (const subpath of forbiddenSubpaths) {
    await assert.rejects(
      import(`@shooting-sample/shooting-core/${subpath}`),
      (error) => {
        assert.equal(error && typeof error, "object");
        assert.equal("code" in error && error.code, "ERR_PACKAGE_PATH_NOT_EXPORTED");
        return true;
      },
    );
  }
});

async function listBasicSourceSubpaths() {
  const sourceRoot = path.join(packageRoot, "src", "basic");
  const files = await collectTypeScriptFiles(sourceRoot);
  return files.map((file) => path.relative(packageRoot, file).split(path.sep).join("/")).sort();
}

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

test("runs the minimum gameplay flow through the workspace package export", async () => {
  const { createShootingCore } = await import("@shooting-sample/shooting-core");

  const loaded = createShootingCore("0.0.0").load(createMinimumDefinition());
  assert.equal(loaded.ok, true);

  if (!loaded.ok) {
    assert.fail("expected package import to load minimum content");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);

  if (!started.ok) {
    assert.fail("expected package import to start minimum stage");
  }

  const frame = started.value.tick({ tick: 0, axes: { moveX: 0, moveY: 0 }, held: [], pressed: [], released: [] });
  assert.equal(frame.ok, true);
  assert.equal(frame.ok && frame.value.tick, 0);

  const serialized = started.value.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected package import to serialize minimum stage");
  }

  const restored = loaded.value.restore(serialized.value);
  assert.equal(restored.ok, false);
  assert.equal(!restored.ok && restored.errors[0]?.code, "state.unsupportedSnapshot");

  const mismatched = loaded.value.restore({ ...serialized.value, coreVersion: "other.core" });
  assert.equal(mismatched.ok, false);
  assert.equal(!mismatched.ok && mismatched.errors[0]?.code, "state.coreVersionMismatch");
});
