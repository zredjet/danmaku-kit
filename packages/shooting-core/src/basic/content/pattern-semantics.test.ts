import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { createShootingCore } from "../core.ts";
import type { GameDefinition, PatternStepDefinition } from "./types.ts";
import { validateGameDefinition } from "./validation.ts";

/** minimum definition に `steps` の pattern を 1 つ足して load する。 */
function loadWithPattern(steps: readonly PatternStepDefinition[]) {
  const definition = createMinimumDefinition();
  const withPattern: GameDefinition = {
    ...definition,
    content: {
      ...definition.content,
      patterns: [...definition.content.patterns, { id: "pattern.checked", version: 1, steps }],
    },
  };
  return { loaded: createShootingCore().load(withPattern), definition: withPattern };
}

const fire = (count: number): PatternStepDefinition => ({
  fire: { bullet: "bullet.red_small", angleDeg: 90, speed: 2, ...(count > 1 ? { fan: { count, spreadDeg: count - 1 } } : {}) },
});

test("loads a pattern without semantic issues with no warnings", () => {
  const { loaded } = loadWithPattern([{ wait: 20 }, fire(3), { wait: 50 }, { loop: 1 }]);

  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.ok && loaded.warnings, []);
});

test("warns about steps no run reaches and patterns that never fire, at the pattern's steps", () => {
  const unreachable = loadWithPattern([{ wait: 10 }, fire(1), { wait: 5 }, { loop: 0 }, { wait: 3 }, fire(1)]).loaded;
  const silent = loadWithPattern([{ wait: 10 }, { loop: 0 }]).loaded;
  const patternIndex = createMinimumDefinition().content.patterns.length;

  assert.deepEqual(unreachable.ok && unreachable.warnings, [
    {
      code: "pattern.unreachableStep",
      message: "pattern.steps[4] is never executed from the spawn",
      schemaPath: `content.patterns[${patternIndex}].steps[4]`,
      referrerId: "pattern.checked",
    },
    {
      code: "pattern.unreachableStep",
      message: "pattern.steps[5] is never executed from the spawn",
      schemaPath: `content.patterns[${patternIndex}].steps[5]`,
      referrerId: "pattern.checked",
    },
  ]);
  assert.deepEqual(silent.ok && silent.warnings, [{
    code: "pattern.neverFires",
    message: "pattern.steps never fire a bullet",
    schemaPath: `content.patterns[${patternIndex}].steps`,
    referrerId: "pattern.checked",
  }]);
  assert.equal(Object.isFrozen(unreachable.ok && unreachable.warnings[0]), true);
});

test("rejects a pattern whose single tick fires more bullets than the active enemy bullet budget", () => {
  // fan 64 発を 32 回続けて撃つと、1 tick に 2,048 発になる。
  const { loaded, definition } = loadWithPattern([...Array.from({ length: 32 }, () => fire(64)), { wait: 60 }]);
  const patternIndex = definition.content.patterns.length - 1;

  assert.deepEqual(loaded.ok ? null : loaded.errors, [{
    code: "definition.invalidConstraint",
    message: "pattern.steps fire 2048 bullets in one tick, over the active enemy bullet budget 2000",
    schemaPath: `content.patterns[${patternIndex}].steps`,
    referrerId: "pattern.checked",
  }]);
  assert.deepEqual(validateGameDefinition(definition).map((error) => error.code), ["definition.invalidConstraint"]);
  assert.equal(loadWithPattern([...Array.from({ length: 31 }, () => fire(64)), { wait: 60 }]).loaded.ok, true);
});
