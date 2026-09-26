import assert from "node:assert/strict";
import test from "node:test";

import { ANGLE_STEPS_PER_TURN, angleStepsFromDegrees } from "../shared/angle-steps.ts";
import {
  cosOfAngleSteps,
  directionToward,
  rotateByAngleSteps,
  sinOfAngleSteps,
  unitVectorAtAngleSteps,
} from "./deterministic-trig.ts";
import { QUARTER_WAVE_SINE_TABLE, SINE_TABLE_SCALE } from "./sine-table.ts";

test("fixes the generated quarter-wave sine table with golden vectors", () => {
  assert.equal(SINE_TABLE_SCALE, 2 ** 30);
  assert.equal(QUARTER_WAVE_SINE_TABLE.length, 361);
  assert.equal(Object.isFrozen(QUARTER_WAVE_SINE_TABLE), true);
  assert.deepEqual(
    [0, 1, 120, 180, 240, 359, 360].map((step) => QUARTER_WAVE_SINE_TABLE[step]),
    [0, 4_685_068, 536_870_912, 759_250_125, 929_887_697, 1_073_731_603, 1_073_741_824],
  );
  assert.equal(QUARTER_WAVE_SINE_TABLE.reduce((sum, entry) => sum + entry, 0), 246_619_979_695);
  assert.equal(QUARTER_WAVE_SINE_TABLE.every((entry, step) => step === 0 || entry > QUARTER_WAVE_SINE_TABLE[step - 1]!), true);
});

test("keeps every table entry within half a fixed-point unit of the mathematical sine", () => {
  // 表は生成時の丸めだけを含む。tick は Math.sin を使わないが、表の妥当性はここで host の Math.sin と比べて確かめる。
  const tolerance = 2 ** -31 + 2 ** -50;
  for (let step = 0; step <= 360; step += 1) {
    assert.ok(
      Math.abs(QUARTER_WAVE_SINE_TABLE[step]! / SINE_TABLE_SCALE - Math.sin((step * Math.PI) / 720)) <= tolerance,
      `step ${step}`,
    );
  }
});

test("extends the quarter wave to a full turn by symmetry with exact axis values", () => {
  assert.deepEqual([0, 120, 360, 600, 720, 1080, 1440, -360, 2880 + 120].map(sinOfAngleSteps), [0, 0.5, 1, 0.5, 0, -1, 0, -1, 0.5]);
  assert.deepEqual([0, 360, 480, 720, 1080].map(cosOfAngleSteps), [1, 0, -0.5, -1, 0]);
  assert.equal(Object.is(sinOfAngleSteps(720), -0), false);
  for (let step = 0; step < ANGLE_STEPS_PER_TURN; step += 1) {
    assert.equal(sinOfAngleSteps(step) + sinOfAngleSteps(-step), 0, `odd symmetry at ${step}`);
    assert.equal(sinOfAngleSteps(720 - step), sinOfAngleSteps(step), `supplementary symmetry at ${step}`);
    assert.equal(sinOfAngleSteps(step), sinOfAngleSteps(step + ANGLE_STEPS_PER_TURN), `period at ${step}`);
  }
  assert.throws(() => sinOfAngleSteps(0.5), RangeError);
});

test("converts only quarter-degree multiples to angle steps", () => {
  assert.deepEqual(
    [0, 0.25, 30, 90, -45, 359.75, 720].map(angleStepsFromDegrees),
    [0, 1, 120, 360, -180, 1439, 2880],
  );
  assert.deepEqual([0.1, 0.3, 12.125, Number.NaN, Number.POSITIVE_INFINITY].map(angleStepsFromDegrees), [null, null, null, null, null]);
});

test("builds and rotates direction vectors from the table", () => {
  assert.deepEqual(unitVectorAtAngleSteps(360), { x: 0, y: 1 });
  assert.deepEqual(unitVectorAtAngleSteps(0), { x: 1, y: 0 });
  assert.deepEqual(rotateByAngleSteps({ x: 0, y: 1 }, 360), { x: -1, y: 0 });
  const rotated = rotateByAngleSteps({ x: 0, y: 2 }, 48);
  assert.deepEqual(rotated, {
    x: 0 * cosOfAngleSteps(48) - 2 * sinOfAngleSteps(48),
    y: 0 * sinOfAngleSteps(48) + 2 * cosOfAngleSteps(48),
  });
  assert.equal(Object.isFrozen(rotated), true);
});

test("aims with a correctly rounded square root and points down when the target overlaps", () => {
  assert.deepEqual(directionToward({ x: 192, y: 100 }, { x: 192, y: 400 }), { x: 0, y: 1 });
  assert.deepEqual(directionToward({ x: 0, y: 0 }, { x: 3, y: -4 }), { x: 0.6, y: -0.8 });
  const diagonal = directionToward({ x: 10, y: 10 }, { x: 20, y: 20 });
  assert.deepEqual(diagonal, { x: 10 / Math.sqrt(200), y: 10 / Math.sqrt(200) });
  assert.deepEqual(directionToward({ x: 5, y: 5 }, { x: 5, y: 5 }), { x: 0, y: 1 });
});
