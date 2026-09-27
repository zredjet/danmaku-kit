import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { errorsOf, fanFire, loadWithPattern, warningsOf } from "../test-support/pattern-loading.ts";
import { validateGameDefinitionWithWarnings } from "./validation.ts";

const aimedFire = Object.freeze({ bullet: "bullet.red_small", aim: "player", speed: 2.5 });


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
    ["definition.invalidShape", "content.patterns[0].steps[1]", "pattern.steps[] must have exactly one of wait, fire, loop, repeat or if"],
    ["definition.invalidShape", "content.patterns[0].steps[1].wait", "pattern.steps[].wait must be at most 3600"],
    ["definition.invalidShape", "content.patterns[0].steps[3].repeat", "pattern.steps[].repeat must be an object"],
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
  }, []);
  const brokenReference = validateGameDefinitionWithWarnings({
    ...definition,
    content: {
      ...definition.content,
      patterns: [{ id: "pattern.none", version: 1, ...afterLoop }],
      stages: [{ ...stage, timeline: [{ ...stage.timeline[0]!, action: { ...stage.timeline[0]!.action, enemy: "enemy.missing" } }] }],
    },
  }, []);

  assert.deepEqual(
    [overBudgetAndAfterLoop, brokenReference].map(({ errors, warnings }) => [errors.map((error) => error.code), warnings]),
    [[["definition.invalidConstraint"], []], [["enemy.notFound"], []]],
  );
  assert.deepEqual(validateGameDefinitionWithWarnings({
    ...definition,
    content: { ...definition.content, patterns: [{ id: "pattern.none", version: 1, ...afterLoop }] },
  }, []).warnings.map((warning) => warning.code), ["pattern.unreachableStep"]);
});

test("accepts repeat, radial and stream within their budgets", () => {
  const loaded = loadWithPattern({
    steps: [
      { wait: 2 },
      {
        repeat: {
          count: 256,
          steps: [
            { fire: { bullet: "bullet.red_small", angleDeg: 0, radial: { count: 48 }, stream: { count: 16, speedStep: 0.5 }, speed: 0.5 } },
            { repeat: { count: 1, steps: [{ repeat: { count: 1, steps: [{ repeat: { count: 1, steps: [{ wait: 1 }] } }] } }] } },
          ],
        },
      },
      { loop: 1 },
    ],
  });

  assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? null : loaded.errors));
});

test("rejects malformed repeat, radial and stream with nested schema paths", () => {
  const loaded = loadWithPattern({
    steps: [
      { wait: 1 },
      { repeat: { count: 0, steps: [{ loop: 0 }, { fire: { ...aimedFire, speed: 9 } }], extra: true } },
      { fire: { ...aimedFire, fan: { count: 3, spreadDeg: 24 }, radial: { count: 7 } } },
      { fire: { ...aimedFire, speed: 7, stream: { count: 3, speedStep: 1 } } },
      { fire: { ...aimedFire, stream: { count: 17, speedStep: -3 } } },
    ],
  });

  assert.deepEqual(errorsOf(loaded), [
    ["definition.unknownField", "content.patterns[0].steps[1].repeat.extra", "Unknown field at pattern.steps[].repeat.extra"],
    ["definition.invalidShape", "content.patterns[0].steps[1].repeat.count", "pattern.steps[].repeat.count must be a positive integer"],
    [
      "definition.invalidShape",
      "content.patterns[0].steps[1].repeat.steps[0].loop",
      "pattern.steps[].repeat.steps[].loop must not be placed inside repeat or if",
    ],
    [
      "definition.invalidShape",
      "content.patterns[0].steps[1].repeat.steps[1].fire.speed",
      "pattern.steps[].repeat.steps[].fire.speed must be less than or equal to 8",
    ],
    ["definition.invalidShape", "content.patterns[0].steps[2].fire", "pattern.steps[].fire must not have both fan and radial"],
    [
      "definition.invalidShape",
      "content.patterns[0].steps[2].fire.radial.count",
      "pattern.steps[].fire.radial.count must divide 360 degrees into 0.25 degree steps",
    ],
    [
      "definition.invalidConstraint",
      "content.patterns[0].steps[3].fire.stream",
      "pattern.steps[].fire.stream must keep every bullet speed above 0 and at most 8",
    ],
    ["definition.invalidShape", "content.patterns[0].steps[4].fire.stream.count", "pattern.steps[].fire.stream.count must be at most 16"],
  ]);
});

test("rejects repeat nested too deep and patterns that expand past the command budget", () => {
  let nested: Record<string, unknown> = { wait: 1 };
  for (let depth = 0; depth < 5; depth += 1) {
    nested = { repeat: { count: 1, steps: [nested] } };
  }
  const tooDeep = loadWithPattern({ steps: [nested] });
  const tooLong = loadWithPattern({ steps: [{ repeat: { count: 256, steps: Array.from({ length: 17 }, () => ({ wait: 1 })) } }] });

  assert.deepEqual(errorsOf(tooDeep).map(([code, schemaPath]) => [code, schemaPath]), [
    ["definition.invalidShape", "content.patterns[0].steps[0].repeat.steps[0].repeat.steps[0].repeat.steps[0].repeat.steps[0].repeat"],
  ]);
  assert.deepEqual(errorsOf(tooLong), [
    ["definition.invalidConstraint", "content.patterns[0].steps", "pattern.steps must expand to at most 4096 commands"],
  ]);
});

test("counts a wait inside repeat for the loop range and reports a repeat after a loop as unreachable", () => {
  const loaded = loadWithPattern({
    steps: [{ repeat: { count: 2, steps: [fanFire(1), { wait: 3 }] } }, { loop: 0 }, { repeat: { count: 2, steps: [{ wait: 1 }] } }],
  });

  assert.deepEqual(warningsOf(loaded).map((warning) => [warning.code, warning.schemaPath]), [
    ["pattern.unreachableStep", "content.patterns[0].steps[2]"],
  ]);
});

test("resolves bullet references inside repeat bodies with their nested schema path", () => {
  const loaded = loadWithPattern({
    steps: [{ repeat: { count: 2, steps: [{ repeat: { count: 1, steps: [{ fire: { ...aimedFire, bullet: "bullet.missing" } }] } }, { wait: 1 }] } }],
  });

  assert.deepEqual(
    loaded.ok ? null : loaded.errors.map((error) => [error.code, error.schemaPath, error.targetId]),
    [["bullet.notFound", "content.patterns[0].steps[0].repeat.steps[0].repeat.steps[0].fire.bullet", "bullet.missing"]],
  );
});

test("rejects a pattern whose single tick runs more commands than the pattern command budget", () => {
  const fires = (count: number) => Array.from({ length: count }, () => fanFire(1));
  // repeat を展開すると 1 run が 2,001 命令（2,000 発と wait）になり、弾数は上限内でも命令数の上限を超える。
  const overBudget = loadWithPattern({ steps: [{ repeat: { count: 250, steps: fires(8) } }, { wait: 1 }] });
  const atBudget = loadWithPattern({ steps: [{ repeat: { count: 249, steps: fires(8) } }, ...fires(7), { wait: 1 }] });

  assert.deepEqual(errorsOf(overBudget), [[
    "definition.invalidConstraint",
    "content.patterns[0].steps",
    "pattern.steps execute 2001 commands in one tick, over the pattern command budget 2000",
  ]]);
  assert.equal(atBudget.ok, true);
});

test("rejects a stream that stacks identical bullets with a zero speed step", () => {
  assert.deepEqual(errorsOf(loadWithPattern({ steps: [{ fire: { ...aimedFire, stream: { count: 3, speedStep: 0 } } }] })), [[
    "definition.invalidShape",
    "content.patterns[0].steps[0].fire.stream.speedStep",
    "pattern.steps[].fire.stream.speedStep must not be 0 when stream.count is more than 1",
  ]]);
  assert.equal(loadWithPattern({ steps: [{ fire: { ...aimedFire, stream: { count: 1, speedStep: 0 } } }] }).ok, true);
});

/** `ticks` の各 tick に 1 体ずつ、`pattern.none` を撃つ敵を出す stage にし、pattern を差し替えた定義を読む。 */
function loadWithSpawnTicks(ticks: readonly number[], pattern: Record<string, unknown>, difficulties: readonly string[] = ["normal"]) {
  const definition = createMinimumDefinition();
  const [stage] = definition.content.stages;
  const spawn = stage!.timeline[0]!;
  return validateGameDefinitionWithWarnings({
    ...definition,
    content: {
      ...definition.content,
      stages: [{ ...stage!, difficulties, timeline: ticks.map((tick) => ({ ...spawn, tick })) }],
      patterns: [{ id: "pattern.none", version: 1, ...pattern }],
    },
  }, []);
}

test("rejects enemies spawned in the same tick whose spawn-tick runs exceed a runtime budget together", () => {
  // 64 発の run は 1 体なら予算に収まるが、同じ tick に 32 体出すと、spawn の tick に 2,048 発になって必ず fatal になる。
  const volley = { steps: [fanFire(64), { wait: 60 }, { loop: 0 }] };

  assert.deepEqual(loadWithSpawnTicks(Array.from({ length: 31 }, () => 60), volley).errors, []);
  assert.deepEqual(loadWithSpawnTicks(Array.from({ length: 32 }, () => 60), volley).errors.map((error) => [error.code, error.schemaPath, error.message]), [[
    "definition.invalidConstraint",
    "content.stages[0].timeline",
    "stage.timeline spawns at tick 60 fire 2048 bullets in that tick on normal, over the active enemy bullet budget 2000",
  ]]);
  // spawn の tick を分けるか、最初の発射を spawn の後にすれば、敵が倒されて撃たないこともあるので error にしない。
  assert.deepEqual(loadWithSpawnTicks(Array.from({ length: 32 }, (_, index) => 60 + Math.floor(index / 16)), volley).errors, []);
  assert.deepEqual(loadWithSpawnTicks(Array.from({ length: 32 }, () => 60), { steps: [{ wait: 1 }, fanFire(64), { wait: 60 }, { loop: 1 }] }).errors, []);
});

test("counts the spawn-tick runs of each difficulty and the command budget", () => {
  const branched = {
    steps: [{ if: { difficulty: ["hard"], then: [fanFire(64)], else: [fanFire(8)] } }, { wait: 60 }, { loop: 0 }],
  };
  assert.deepEqual(
    loadWithSpawnTicks(Array.from({ length: 32 }, () => 60), branched, ["normal", "hard"]).errors.map((error) => error.message),
    ["stage.timeline spawns at tick 60 fire 2048 bullets in that tick on hard, over the active enemy bullet budget 2000"],
  );

  // 1 発ずつの fire を並べた run は、同じ tick の命令の合計も 1 tick の命令数の上限を超える（run は最後の wait も 1 命令と数える）。
  const singleShots = { steps: [{ repeat: { count: 21, steps: [fanFire(1)] } }, { wait: 60 }, { loop: 0 }] };
  assert.deepEqual(loadWithSpawnTicks(Array.from({ length: 100 }, () => 60), singleShots).errors.map((error) => error.message), [
    "stage.timeline spawns at tick 60 fire 2100 bullets in that tick on normal, over the active enemy bullet budget 2000",
    "stage.timeline spawns at tick 60 execute 2200 pattern commands in that tick on normal, over the pattern command budget 2000",
  ]);
});
