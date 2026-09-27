import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { loadUnknown } from "../test-support/stage-harness.ts";
import { validateGameDefinitionWithWarnings } from "./validation.ts";

const aimedFire = Object.freeze({ bullet: "bullet.red_small", aim: "player", speed: 2.5 });

function loadWithPattern(pattern: Record<string, unknown>) {
  const definition = createMinimumDefinition();
  return loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      patterns: [{ id: "pattern.none", version: 1, ...pattern }],
    },
  });
}

function errorsOf(loaded: ReturnType<typeof loadWithPattern>): ReadonlyArray<readonly [string, string | undefined, string]> {
  assert.equal(loaded.ok, false);
  return loaded.ok ? [] : loaded.errors.map((error) => [error.code, error.schemaPath, error.message] as const);
}

test("accepts wait, fire and loop steps within the runtime budget", () => {
  const cases: readonly (readonly Record<string, unknown>[])[] = [
    [{ fire: aimedFire }],
    [
      { wait: 20 },
      { fire: { ...aimedFire, origin: "self", fan: { count: 3, spreadDeg: 24 } } },
      { wait: 50 },
      { loop: 0 },
    ],
    [
      { fire: { bullet: "bullet.red_small", angleDeg: 90, speed: 8 } },
      { fire: { bullet: "bullet.red_small", angleDeg: -360, speed: 0.25, fan: { count: 64, spreadDeg: 315 } } },
      { fire: { bullet: "bullet.red_small", angleDeg: 359.75, speed: 1, fan: { count: 4, spreadDeg: 1.5 } } },
      { fire: { bullet: "bullet.red_small", angleDeg: 0, speed: 1, fan: { count: 1, spreadDeg: 0 } } },
      { wait: 3_600 },
      { wait: 1 },
      { loop: 5 },
      { loop: 0 },
    ],
    Array.from({ length: 64 }, () => ({ wait: 1 })),
  ];

  for (const steps of cases) {
    const loaded = loadWithPattern({ steps });

    assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? null : loaded.errors));
  }
});

test("rejects malformed steps with the step index in the schema path", () => {
  const loaded = loadWithPattern({
    steps: [
      { wait: 0 },
      { wait: 3_601, fire: aimedFire },
      "wait",
      { repeat: 3 },
      { fire: "bullet.red_small" },
      { wait: 1.5 },
    ],
  });

  assert.deepEqual(errorsOf(loaded), [
    ["definition.invalidShape", "content.patterns[0].steps[2]", "pattern.steps must contain objects"],
    ["definition.invalidShape", "content.patterns[0].steps[0].wait", "pattern.steps[].wait must be a positive integer"],
    ["definition.invalidShape", "content.patterns[0].steps[1]", "pattern.steps[] must have exactly one of wait, fire or loop"],
    ["definition.invalidShape", "content.patterns[0].steps[1].wait", "pattern.steps[].wait must be at most 3600"],
    ["definition.unknownField", "content.patterns[0].steps[3].repeat", "Unknown field at pattern.steps[].repeat"],
    ["definition.invalidShape", "content.patterns[0].steps[3]", "pattern.steps[] must have exactly one of wait, fire or loop"],
    ["definition.invalidShape", "content.patterns[0].steps[4].fire", "pattern.steps[].fire must be an object"],
    ["definition.invalidShape", "content.patterns[0].steps[5].wait", "pattern.steps[].wait must be a positive integer"],
  ]);
});

test("rejects empty, oversized and non-array steps and steps combined with fireOnSpawn", () => {
  assert.deepEqual(errorsOf(loadWithPattern({ steps: [] })), [
    ["definition.invalidShape", "content.patterns[0].steps", "pattern.steps must contain at least 1 step"],
  ]);
  assert.deepEqual(errorsOf(loadWithPattern({ steps: Array.from({ length: 65 }, () => ({ wait: 1 })) })), [
    ["definition.invalidShape", "content.patterns[0].steps", "pattern.steps must contain at most 64 steps"],
  ]);
  assert.deepEqual(errorsOf(loadWithPattern({ steps: { wait: 1 } })), [
    ["definition.invalidShape", "content.patterns[0].steps", "pattern.steps must be an array"],
  ]);
  assert.deepEqual(
    errorsOf(loadWithPattern({ steps: [{ fire: aimedFire }], fireOnSpawn: { bullet: "bullet.red_small", offset: { x: 0, y: 8 } } })),
    [["definition.invalidShape", "content.patterns[0].steps", "pattern.steps must not be combined with pattern.fireOnSpawn"]],
  );
});

test("rejects loops that do not point back or skip every wait", () => {
  const loaded = loadWithPattern({
    steps: [
      { loop: 0 },
      { wait: 10 },
      { fire: aimedFire },
      { loop: 2 },
      { loop: 4 },
      { loop: 9 },
      { loop: -1 },
      { loop: 1 },
    ],
  });

  assert.deepEqual(errorsOf(loaded), [
    ["definition.invalidShape", "content.patterns[0].steps[0].loop", "pattern.steps[].loop must point to an earlier step"],
    [
      "definition.invalidConstraint",
      "content.patterns[0].steps[3].loop",
      "pattern.steps[].loop must return to a range that contains a wait step",
    ],
    ["definition.invalidShape", "content.patterns[0].steps[4].loop", "pattern.steps[].loop must point to an earlier step"],
    ["definition.invalidShape", "content.patterns[0].steps[5].loop", "pattern.steps[].loop must point to an earlier step"],
    ["definition.invalidShape", "content.patterns[0].steps[6].loop", "pattern.steps[].loop must be a non-negative integer"],
  ]);
});

test("rejects fire commands with an invalid origin, direction, speed or fan", () => {
  const loaded = loadWithPattern({
    steps: [
      { fire: { bullet: "bullet.red_small", origin: "player", aim: "enemy", speed: 0, extra: true } },
      { fire: { bullet: "bullet.red_small", aim: "player", angleDeg: 90, speed: 8.5 } },
      { fire: { bullet: "bullet.red_small", speed: 1 } },
      { fire: { bullet: "bullet.red_small", angleDeg: 12.1, speed: 1 } },
      { fire: { bullet: "bullet.red_small", angleDeg: 360.25, speed: 1 } },
      { fire: { ...aimedFire, fan: { count: 0, spreadDeg: -1 } } },
      { fire: { ...aimedFire, fan: { count: 65, spreadDeg: 360.25 } } },
      { fire: { ...aimedFire, fan: { count: 1, spreadDeg: 10 } } },
      { fire: { ...aimedFire, fan: { count: 3, spreadDeg: 24.1 } } },
      { fire: { ...aimedFire, fan: { count: 2, spreadDeg: 0.25 } } },
      { fire: { ...aimedFire, fan: { count: 4, spreadDeg: 1 } } },
      { fire: { ...aimedFire, fan: 3 } },
    ],
  });

  assert.deepEqual(errorsOf(loaded).map(([, schemaPath, message]) => [schemaPath, message]), [
    ["content.patterns[0].steps[0].fire.extra", "Unknown field at pattern.steps[].fire.extra"],
    ["content.patterns[0].steps[0].fire.origin", "pattern.steps[].fire.origin must be self"],
    ["content.patterns[0].steps[0].fire.aim", "pattern.steps[].fire.aim must be player"],
    ["content.patterns[0].steps[0].fire.speed", "pattern.steps[].fire.speed must be a positive number"],
    ["content.patterns[0].steps[1].fire", "pattern.steps[].fire must have exactly one of aim or angleDeg"],
    ["content.patterns[0].steps[1].fire.speed", "pattern.steps[].fire.speed must be less than or equal to 8"],
    ["content.patterns[0].steps[2].fire", "pattern.steps[].fire must have exactly one of aim or angleDeg"],
    ["content.patterns[0].steps[3].fire.angleDeg", "pattern.steps[].fire.angleDeg must be a multiple of 0.25"],
    ["content.patterns[0].steps[4].fire.angleDeg", "pattern.steps[].fire.angleDeg must be between -360 and 360"],
    ["content.patterns[0].steps[5].fire.fan.count", "pattern.steps[].fire.fan.count must be a positive integer"],
    ["content.patterns[0].steps[5].fire.fan.spreadDeg", "pattern.steps[].fire.fan.spreadDeg must be between 0 and 360"],
    ["content.patterns[0].steps[6].fire.fan.count", "pattern.steps[].fire.fan.count must be at most 64"],
    ["content.patterns[0].steps[6].fire.fan.spreadDeg", "pattern.steps[].fire.fan.spreadDeg must be between 0 and 360"],
    ["content.patterns[0].steps[7].fire.fan.spreadDeg", "pattern.steps[].fire.fan.spreadDeg must be 0 when fan.count is 1"],
    ["content.patterns[0].steps[8].fire.fan.spreadDeg", "pattern.steps[].fire.fan.spreadDeg must be a multiple of 0.25"],
    [
      "content.patterns[0].steps[9].fire.fan.spreadDeg",
      "pattern.steps[].fire.fan.spreadDeg must place every bullet on a 0.25 degree step",
    ],
    [
      "content.patterns[0].steps[10].fire.fan.spreadDeg",
      "pattern.steps[].fire.fan.spreadDeg must place every bullet on a 0.25 degree step",
    ],
    ["content.patterns[0].steps[11].fire.fan", "pattern.steps[].fire.fan must be an object"],
  ]);
});

test("rejects fire commands that reference missing or foreign bullets", () => {
  const loaded = loadWithPattern({
    steps: [
      { fire: { ...aimedFire, bullet: "bullet.missing" } },
      { wait: 1 },
      { fire: { ...aimedFire, bullet: "enemy.scout" } },
    ],
  });

  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => [error.code, error.schemaPath, error.referrerId, error.targetId]), [
    ["bullet.notFound", "content.patterns[0].steps[0].fire.bullet", "pattern.none", "bullet.missing"],
    ["id.invalidNamespace", "content.patterns[0].steps[2].fire.bullet", "pattern.none", "enemy.scout"],
  ]);
});

/** 基準の向きへ `count` 発の fan を撃つ step。 */
function fanFire(count: number): Record<string, unknown> {
  return { fire: { bullet: "bullet.red_small", angleDeg: 90, speed: 2, ...(count > 1 ? { fan: { count, spreadDeg: count - 1 } } : {}) } };
}

function warningsOf(loaded: ReturnType<typeof loadWithPattern>) {
  assert.equal(loaded.ok, true);
  return loaded.ok ? loaded.warnings : [];
}

test("loads a pattern without semantic issues with no warnings", () => {
  assert.deepEqual(warningsOf(loadWithPattern({ steps: [{ wait: 20 }, fanFire(3), { wait: 50 }, { loop: 1 }] })), []);
});

test("warns about steps no run reaches and patterns that never fire, at the pattern's steps", () => {
  const unreachable = loadWithPattern({ steps: [{ wait: 10 }, fanFire(1), { wait: 5 }, { loop: 0 }, { wait: 3 }, fanFire(1)] });
  const silent = loadWithPattern({ steps: [{ wait: 10 }, { loop: 0 }] });

  assert.deepEqual(warningsOf(unreachable), [4, 5].map((step) => ({
    code: "pattern.unreachableStep",
    message: `pattern.steps[${step}] is never executed from the spawn`,
    schemaPath: `content.patterns[0].steps[${step}]`,
    referrerId: "pattern.none",
  })));
  assert.deepEqual(warningsOf(silent), [{
    code: "pattern.neverFires",
    message: "pattern.steps never fire a bullet",
    schemaPath: "content.patterns[0].steps",
    referrerId: "pattern.none",
  }]);
  assert.equal(Object.isFrozen(warningsOf(unreachable)[0]), true);
});

test("rejects a pattern whose single tick fires more bullets than the active enemy bullet budget", () => {
  // fan 64 発を 32 回続けて撃つと、1 tick に 2,048 発になる。
  const overBudget = loadWithPattern({ steps: [...Array.from({ length: 32 }, () => fanFire(64)), { wait: 60 }] });

  assert.deepEqual(errorsOf(overBudget), [[
    "definition.invalidConstraint",
    "content.patterns[0].steps",
    "pattern.steps fire 2048 bullets in one tick, over the active enemy bullet budget 2000",
  ]]);
  assert.equal(loadWithPattern({ steps: [...Array.from({ length: 31 }, () => fanFire(64)), { wait: 60 }] }).ok, true);
});

test("counts only the runs the spawn reaches toward the bullet budget", () => {
  // loop より後ろの run は 1 tick に 2,048 発を撃つが、spawn からは実行されないので load できる（到達しない step は warning）。
  const unreachableBurst = loadWithPattern({
    steps: [{ wait: 1 }, ...Array.from({ length: 31 }, () => fanFire(64)), { wait: 1 }, { loop: 1 }, fanFire(64), { loop: 1 }],
  });

  assert.deepEqual(warningsOf(unreachableBurst).map((warning) => warning.schemaPath), [
    "content.patterns[0].steps[34]",
    "content.patterns[0].steps[35]",
  ]);
});

test("returns no semantic warnings while the content has errors", () => {
  const definition = createMinimumDefinition();
  const stage = definition.content.stages[0]!;
  const afterLoop = { steps: [{ wait: 10 }, fanFire(1), { loop: 0 }, { wait: 3 }] };
  const overBudgetAndAfterLoop = validateGameDefinitionWithWarnings({
    ...definition,
    content: {
      ...definition.content,
      patterns: [
        { id: "pattern.none", version: 1, steps: [...Array.from({ length: 32 }, () => fanFire(64)), { wait: 60 }] },
        { id: "pattern.after_loop", version: 1, ...afterLoop },
      ],
    },
  });
  const brokenReference = validateGameDefinitionWithWarnings({
    ...definition,
    content: {
      ...definition.content,
      patterns: [{ id: "pattern.none", version: 1, ...afterLoop }],
      stages: [{ ...stage, timeline: [{ ...stage.timeline[0]!, action: { ...stage.timeline[0]!.action, enemy: "enemy.missing" } }] }],
    },
  });

  assert.deepEqual(
    [overBudgetAndAfterLoop, brokenReference].map(({ errors, warnings }) => [errors.map((error) => error.code), warnings]),
    [[["definition.invalidConstraint"], []], [["enemy.notFound"], []]],
  );
  assert.deepEqual(validateGameDefinitionWithWarnings({
    ...definition,
    content: { ...definition.content, patterns: [{ id: "pattern.none", version: 1, ...afterLoop }] },
  }).warnings.map((warning) => warning.code), ["pattern.unreachableStep"]);
});
