import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { loadUnknown } from "../test-support/stage-harness.ts";

function loadWithFireOnSpawn(fireOnSpawn: Record<string, unknown>) {
  const definition = createMinimumDefinition();
  return loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      patterns: [{ id: "pattern.none", version: 1, fireOnSpawn }],
    },
  });
}

test("accepts fireOnSpawn bullets without velocity and with velocity at the runtime budget", () => {
  for (const velocity of [undefined, { x: 0, y: 0 }, { x: -8, y: 8 }, { x: 2.5, y: -0.5 }]) {
    const loaded = loadWithFireOnSpawn({
      bullet: "bullet.red_small",
      offset: { x: 0, y: 8 },
      ...(velocity === undefined ? {} : { velocity }),
    });

    assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? null : loaded.errors));
  }
});

test("rejects fireOnSpawn velocities that are malformed or exceed the runtime budget", () => {
  const cases: ReadonlyArray<readonly [unknown, readonly string[]]> = [
    [{ x: 8.5, y: 0 }, ["pattern.fireOnSpawn.velocity.x must be between -8 and 8"]],
    [{ x: 0, y: -9 }, ["pattern.fireOnSpawn.velocity.y must be between -8 and 8"]],
    [{ x: "fast", y: null }, [
      "pattern.fireOnSpawn.velocity.x must be a finite number",
      "pattern.fireOnSpawn.velocity.y must be a finite number",
    ]],
    [{ x: 0, y: 1, z: 0 }, ["Unknown field at pattern.fireOnSpawn.velocity.z"]],
    [3, ["pattern.fireOnSpawn.velocity must be an object"]],
  ];

  for (const [velocity, messages] of cases) {
    const loaded = loadWithFireOnSpawn({ bullet: "bullet.red_small", offset: { x: 0, y: 8 }, velocity });

    assert.equal(loaded.ok, false);
    assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), messages);
    assert.equal(
      !loaded.ok && loaded.errors.every((error) => error.schemaPath?.startsWith("content.patterns[0].fireOnSpawn.velocity")),
      true,
    );
  }
});
