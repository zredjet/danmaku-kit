import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import {
  errorsOf,
  fanFire,
  loadWithPattern,
  loadWithPatternForDifficulties,
  warningsOf,
} from "../test-support/pattern-loading.ts";
import { validateGameDefinitionWithWarnings } from "./validation.ts";

test("accepts difficulty branches in steps and inside repeat", () => {
  const loaded = loadWithPatternForDifficulties({
    steps: [
      { if: { difficulty: ["hard"], then: [fanFire(5)], else: [fanFire(3)] } },
      { wait: 30 },
      { repeat: { count: 2, steps: [{ if: { difficulty: ["normal", "hard"], then: [fanFire(1), { wait: 5 }] } }] } },
      { loop: 0 },
    ],
  }, ["normal", "hard"]);

  assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? null : loaded.errors));
  assert.deepEqual(warningsOf(loaded), []);
});

test("rejects malformed difficulty branches with nested schema paths", () => {
  const loaded = loadWithPattern({
    steps: [
      { if: { difficulty: [], then: [fanFire(1)] } },
      { if: { difficulty: ["easy"], then: [fanFire(1)], extra: true } },
      { if: { difficulty: ["hard", "hard"], then: [] } },
      { if: { difficulty: ["hard"], then: [{ loop: 0 }], else: "fire" } },
      { if: "hard" },
    ],
  });

  assert.deepEqual(errorsOf(loaded), [
    ["definition.invalidShape", "content.patterns[0].steps[0].if.difficulty", "pattern.steps[].if.difficulty must be a non-empty array"],
    ["definition.unknownField", "content.patterns[0].steps[1].if.extra", "Unknown field at pattern.steps[].if.extra"],
    ["definition.invalidShape", "content.patterns[0].steps[1].if.difficulty", "pattern.steps[].if.difficulty must contain only normal or hard"],
    ["definition.invalidShape", "content.patterns[0].steps[2].if.difficulty", "pattern.steps[].if.difficulty must not contain duplicates"],
    ["definition.invalidShape", "content.patterns[0].steps[2].if.then", "pattern.steps[].if.then must contain at least 1 step"],
    ["definition.invalidShape", "content.patterns[0].steps[3].if.then[0].loop", "pattern.steps[].if.then[].loop must not be placed inside repeat or if"],
    ["definition.invalidShape", "content.patterns[0].steps[3].if.else", "pattern.steps[].if.else must be an array"],
    ["definition.invalidShape", "content.patterns[0].steps[4].if", "pattern.steps[].if must be an object"],
  ]);
});

test("requires a wait on both branches of an if for a loop range and nests if and repeat at most four deep", () => {
  const oneSidedWait = loadWithPattern({
    steps: [{ wait: 1 }, { if: { difficulty: ["hard"], then: [{ wait: 5 }], else: [fanFire(1)] } }, { loop: 1 }],
  });
  const nest = (depth: number): Record<string, unknown> => depth === 0
    ? { wait: 1 }
    : { if: { difficulty: ["normal"], then: [{ repeat: { count: 1, steps: [nest(depth - 1)] } }] } };

  assert.deepEqual(errorsOf(oneSidedWait).map(([code, schemaPath]) => [code, schemaPath]), [
    ["definition.invalidConstraint", "content.patterns[0].steps[2].loop"],
  ]);
  assert.equal(loadWithPattern({ steps: [nest(2), fanFire(1)] }).ok, true);
  assert.deepEqual(errorsOf(loadWithPattern({ steps: [nest(3), fanFire(1)] })).map(([, schemaPath, message]) => [schemaPath, message]), [[
    "content.patterns[0].steps[0].if.then[0].repeat.steps[0].if.then[0].repeat.steps[0].if",
    "pattern.steps[].if.then[].repeat.steps[].if.then[].repeat.steps[].if must be nested at most 4 deep",
  ]]);
});

test("checks the bullet and command budgets for each difficulty of the stages using the pattern", () => {
  // hard だけが 1 tick に 2,048 発を撃つ。normal だけの stage が使う pattern なら hard の枝は実行されない。
  const hardBurst = {
    steps: [{ if: { difficulty: ["hard"], then: Array.from({ length: 32 }, () => fanFire(64)), else: [fanFire(1)] } }, { wait: 60 }],
  };
  // hard だけが 1 tick に 2,049 命令を実行する（fire 2,048 回と wait）。
  const hardCommands = {
    steps: [{ if: { difficulty: ["hard"], then: [{ repeat: { count: 256, steps: Array.from({ length: 8 }, () => fanFire(1)) } }] } }, { wait: 60 }],
  };

  assert.deepEqual(errorsOf(loadWithPatternForDifficulties(hardBurst, ["normal", "hard"])), [[
    "definition.invalidConstraint",
    "content.patterns[0].steps",
    "pattern.steps fire 2048 bullets in one tick on hard, over the active enemy bullet budget 2000",
  ]]);
  assert.deepEqual(errorsOf(loadWithPatternForDifficulties(hardCommands, ["normal", "hard"])).map(([, , message]) => message), [
    "pattern.steps fire 2048 bullets in one tick on hard, over the active enemy bullet budget 2000",
    "pattern.steps execute 2049 commands in one tick on hard, over the pattern command budget 2000",
  ]);
  assert.deepEqual(warningsOf(loadWithPatternForDifficulties(hardBurst, ["normal"])), [{
    code: "pattern.unusedBranch",
    message: "pattern.steps[].if.difficulty lists a difficulty this step never runs on: hard",
    schemaPath: "content.patterns[0].steps[0].if.difficulty",
    referrerId: "pattern.none",
  }]);
});

test("counts the expanded commands of the branch each difficulty takes", () => {
  // difficulty ごとに 2,100 命令 + 1 命令。長い方の枝を足し合わせると 4,201 命令になるが、どの difficulty でも 2,101 命令。
  const longBranch = { repeat: { count: 210, steps: [...Array.from({ length: 9 }, () => fanFire(1)), { wait: 1 }] } };
  const loaded = loadWithPatternForDifficulties({
    steps: [
      { if: { difficulty: ["normal"], then: [longBranch] } },
      { if: { difficulty: ["hard"], then: [longBranch] } },
      { wait: 1 },
    ],
  }, ["normal", "hard"]);

  assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? null : loaded.errors));
});

test("warns about firing only when no difficulty fires and about branches no difficulty takes", () => {
  const hardOnlyFire = { steps: [{ wait: 5 }, { if: { difficulty: ["hard"], then: [fanFire(1)] } }, { loop: 0 }] };
  const unusedPattern = createMinimumDefinition();
  const nested = {
    steps: [
      {
        repeat: {
          count: 2,
          steps: [{
            if: {
              difficulty: ["hard"],
              then: [{ if: { difficulty: ["normal"], then: [fanFire(1)] } }, { wait: 1 }],
              else: [{ if: { difficulty: ["normal", "hard"], then: [fanFire(1)], else: [fanFire(2)] } }, { wait: 1 }],
            },
          }],
        },
      },
    ],
  };

  assert.deepEqual(warningsOf(loadWithPatternForDifficulties(hardOnlyFire, ["normal", "hard"])), []);
  assert.deepEqual(warningsOf(loadWithPatternForDifficulties(hardOnlyFire, ["normal"])).map((warning) => warning.code), [
    "pattern.neverFires",
    "pattern.unusedBranch",
  ]);
  // hard の中の normal と、normal と hard の両方が then を使う else は、どの difficulty でも使われない。
  assert.deepEqual(warningsOf(loadWithPatternForDifficulties(nested, ["normal", "hard"])).map((warning) => [warning.schemaPath, warning.message]), [
    [
      "content.patterns[0].steps[0].repeat.steps[0].if.then[0].if.difficulty",
      "pattern.steps[].if.difficulty lists a difficulty this step never runs on: normal",
    ],
    [
      "content.patterns[0].steps[0].repeat.steps[0].if.else[0].if.difficulty",
      "pattern.steps[].if.difficulty lists a difficulty this step never runs on: hard",
    ],
    [
      "content.patterns[0].steps[0].repeat.steps[0].if.else[0].if.else",
      "pattern.steps[].if.else is never used: every difficulty this step runs on takes then",
    ],
  ]);
  // どの stage も使わない pattern は、既知の difficulty すべてで見る。
  assert.deepEqual(validateGameDefinitionWithWarnings({
    ...unusedPattern,
    content: {
      ...unusedPattern.content,
      patterns: [...unusedPattern.content.patterns, { id: "pattern.unused", version: 1, ...hardOnlyFire }],
    },
  }, []).warnings, []);
});

test("rejects missing bullets and invalid values inside difficulty branches with their nested schema paths", () => {
  const loaded = loadWithPattern({
    steps: [
      {
        repeat: {
          count: 2,
          steps: [{
            if: {
              difficulty: ["hard"],
              then: [{ fire: { bullet: "bullet.missing", aim: "player", speed: 2 } }, { wait: 1 }],
              else: [{ fire: { bullet: "bullet.red_small", aim: "player", speed: 9 } }, { wait: 1 }],
            },
          }],
        },
      },
    ],
  });

  assert.deepEqual(errorsOf(loaded), [[
    "definition.invalidShape",
    "content.patterns[0].steps[0].repeat.steps[0].if.else[0].fire.speed",
    "pattern.steps[].repeat.steps[].if.else[].fire.speed must be less than or equal to 8",
  ]]);
  const missing = loadWithPattern({
    steps: [{ if: { difficulty: ["hard"], then: [{ fire: { bullet: "bullet.missing", aim: "player", speed: 2 } }] } }, { wait: 1 }],
  });
  assert.deepEqual(!missing.ok && missing.errors.map((error) => [error.code, error.schemaPath, error.targetId]), [[
    "bullet.notFound",
    "content.patterns[0].steps[0].if.then[0].fire.bullet",
    "bullet.missing",
  ]]);
});
