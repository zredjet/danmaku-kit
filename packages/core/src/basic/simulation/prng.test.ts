import assert from "node:assert/strict";
import test from "node:test";

import { XorShift32 } from "./prng.ts";

test("generates identical sequences for identical seeds", () => {
  const first = new XorShift32("seed-1");
  const second = new XorShift32("seed-1");

  assert.deepEqual(
    [first.nextUint32(), first.nextUint32(), first.nextUint32()],
    [second.nextUint32(), second.nextUint32(), second.nextUint32()],
  );
});

test("generates different sequences for different seeds", () => {
  const first = new XorShift32("seed-1");
  const second = new XorShift32("seed-2");

  assert.notDeepEqual(
    [first.nextUint32(), first.nextUint32(), first.nextUint32()],
    [second.nextUint32(), second.nextUint32(), second.nextUint32()],
  );
});

test("uses full unicode code points when hashing seeds", () => {
  const first = new XorShift32("😀");
  const second = new XorShift32("😁");

  assert.notDeepEqual(
    [first.nextUint32(), first.nextUint32(), first.nextUint32()],
    [second.nextUint32(), second.nextUint32(), second.nextUint32()],
  );
});

test("snapshots and restores deterministic state", () => {
  const original = new XorShift32("seed-1");
  const before = original.snapshot();
  assert.equal(Object.isFrozen(before), true);
  original.nextUint32();
  const restored = XorShift32.restore(original.snapshot());

  assert.notEqual(before.state, original.snapshot().state);
  assert.equal(restored.ok, true);
  assert.equal(restored.ok && original.nextUint32(), restored.ok && restored.value.nextUint32());
});

test("rejects invalid restored state", () => {
  const restored = XorShift32.restore({ state: 0 });

  assert.equal(restored.ok, false);
  assert.equal(!restored.ok && restored.errors[0]?.code, "prng.invalidState");
});

test("rejects throwing restored state without leaking exceptions", () => {
  const throwingState = Object.defineProperty({}, "state", {
    enumerable: true,
    get() {
      throw new Error("unexpected getter access");
    },
  });
  const restored = XorShift32.restore(throwingState);

  assert.equal(restored.ok, false);
  assert.equal(!restored.ok && restored.errors[0]?.code, "prng.invalidState");
});
