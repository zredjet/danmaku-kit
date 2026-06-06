import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "./fixtures/minimum-game-definition.ts";

test("imports shooting core through the workspace package export", async () => {
  const core = await import("@shooting-sample/shooting-core");

  assert.deepEqual(Object.keys(core).sort(), ["createShootingCore"]);
  assert.equal(typeof core.createShootingCore, "function");
});

test("rejects deep package imports outside the public export map", async () => {
  const forbiddenSubpaths = [
    "package.json",
    "src/basic/core.ts",
    "src/basic/content/types.ts",
    "src/basic/input/input-frame.ts",
    "src/basic/simulation/entity.ts",
    "src/basic/simulation/prng.ts",
    "src/basic/simulation/runtime-entity.ts",
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
});
