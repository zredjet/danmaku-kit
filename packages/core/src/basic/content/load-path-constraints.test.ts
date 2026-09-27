import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { loadUnknown } from "../test-support/stage-harness.ts";

function loadWithPath(path: Record<string, unknown>) {
  const definition = createMinimumDefinition();
  return loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      paths: [{ id: "path.none", version: 1, ...path }],
    },
  });
}

test("accepts paths without segments, with no segments, and with velocity segments at the budget boundaries", () => {
  for (const segments of [undefined, [], [
    { type: "velocity", duration: 1, velocity: { x: 0, y: 0 } },
    { type: "velocity", duration: 3_600, velocity: { x: -16, y: 16 } },
  ]]) {
    const loaded = loadWithPath(segments === undefined ? {} : { segments });

    assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? null : loaded.errors));
  }
  assert.equal(
    loadWithPath({ segments: Array.from({ length: 64 }, () => ({ type: "velocity", duration: 1, velocity: { x: 0, y: 1 } })) }).ok,
    true,
  );
});

test("rejects malformed path segments with the segment index in the schema path", () => {
  const loaded = loadWithPath({
    segments: [
      { type: "velocity", duration: 30, velocity: { x: 0, y: 1 } },
      { type: "sine", duration: 0, velocity: { x: 17, y: "fast" }, phase: 0 },
      "segment",
      { type: "velocity", duration: 3_601, velocity: null },
    ],
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => [error.code, error.schemaPath, error.message]), [
    ["definition.invalidShape", "content.paths[0].segments[2]", "path.segments must contain objects"],
    ["definition.unknownField", "content.paths[0].segments[1].phase", "Unknown field at path.segments[].phase"],
    ["definition.invalidShape", "content.paths[0].segments[1].type", "path.segments[].type must be velocity"],
    [
      "definition.invalidShape",
      "content.paths[0].segments[1].duration",
      "path.segments[].duration must be a positive integer",
    ],
    [
      "definition.invalidShape",
      "content.paths[0].segments[1].velocity.x",
      "path.segments[].velocity.x must be between -16 and 16",
    ],
    [
      "definition.invalidShape",
      "content.paths[0].segments[1].velocity.y",
      "path.segments[].velocity.y must be a finite number",
    ],
    [
      "definition.invalidShape",
      "content.paths[0].segments[3].duration",
      "path.segments[].duration must be at most 3600",
    ],
    [
      "definition.invalidShape",
      "content.paths[0].segments[3].velocity",
      "path.segments[].velocity must be an object",
    ],
  ]);
});

test("rejects paths whose segments are not an array or exceed the segment budget", () => {
  const notArray = loadWithPath({ segments: { type: "velocity" } });
  const tooMany = loadWithPath({
    segments: Array.from({ length: 65 }, () => ({ type: "velocity", duration: 1, velocity: { x: 0, y: 1 } })),
  });

  assert.deepEqual(!notArray.ok && notArray.errors.map((error) => [error.schemaPath, error.message]), [
    ["content.paths[0].segments", "path.segments must be an array"],
  ]);
  assert.deepEqual(!tooMany.ok && tooMany.errors.map((error) => [error.schemaPath, error.message]), [
    ["content.paths[0].segments", "path.segments must contain at most 64 segments"],
  ]);
});

test("accepts sine offsets within the runtime budget", () => {
  const loaded = loadWithPath({
    segments: [
      { type: "velocity", duration: 120, velocity: { x: 0, y: 1 }, offset: { type: "sine", axis: "x", amplitude: 32, periodTicks: 120 } },
      { type: "velocity", duration: 60, velocity: { x: 0, y: 0 }, offset: { type: "sine", axis: "y", amplitude: -256, periodTicks: 3_600 } },
      { type: "velocity", duration: 7, velocity: { x: 0, y: 0 }, offset: { type: "sine", axis: "x", amplitude: 256, periodTicks: 7 } },
    ],
  });

  assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? null : loaded.errors));
});

test("rejects malformed sine offsets with the segment index in the schema path", () => {
  const loaded = loadWithPath({
    segments: [
      { type: "velocity", duration: 30, velocity: { x: 0, y: 1 }, offset: { type: "cosine", axis: "z", amplitude: 257, periodTicks: 0, phase: 1 } },
      { type: "velocity", duration: 30, velocity: { x: 0, y: 1 }, offset: { type: "sine", axis: "x", amplitude: "large", periodTicks: 3_601 } },
      { type: "velocity", duration: 30, velocity: { x: 0, y: 1 }, offset: "sine" },
    ],
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => [error.schemaPath, error.message]), [
    ["content.paths[0].segments[0].offset.phase", "Unknown field at path.segments[].offset.phase"],
    ["content.paths[0].segments[0].offset.type", "path.segments[].offset.type must be sine"],
    ["content.paths[0].segments[0].offset.axis", "path.segments[].offset.axis must be x or y"],
    ["content.paths[0].segments[0].offset.amplitude", "path.segments[].offset.amplitude must be between -256 and 256"],
    ["content.paths[0].segments[0].offset.periodTicks", "path.segments[].offset.periodTicks must be a positive integer"],
    ["content.paths[0].segments[1].offset.amplitude", "path.segments[].offset.amplitude must be a finite number"],
    ["content.paths[0].segments[1].offset.periodTicks", "path.segments[].offset.periodTicks must be at most 3600"],
    ["content.paths[0].segments[2].offset", "path.segments[].offset must be an object"],
  ]);
});
