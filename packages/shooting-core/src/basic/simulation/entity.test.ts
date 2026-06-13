import assert from "node:assert/strict";
import test from "node:test";

import { EntityAllocator } from "./entity.ts";

test("allocates monotonic entity ids and restores next id", () => {
  const allocator = new EntityAllocator();
  const first = allocator.create();
  const second = allocator.create();
  assert.equal(first.ok && first.value.id, 1);
  assert.equal(second.ok && second.value.id, 2);

  const restored = EntityAllocator.restore(allocator.snapshot());
  assert.equal(restored.ok, true);
  const third = restored.ok && restored.value.create();
  assert.equal(third && third.ok && third.value.id, 3);
});

test("rejects invalid entity allocator snapshots", () => {
  const restored = EntityAllocator.restore(0);

  assert.equal(restored.ok, false);
  assert.equal(!restored.ok && restored.errors[0]?.code, "entityAllocator.invalidState");

  const unsafeUpperBound = EntityAllocator.restore(Number.MAX_SAFE_INTEGER + 1);
  assert.equal(unsafeUpperBound.ok, false);
  assert.equal(!unsafeUpperBound.ok && unsafeUpperBound.errors[0]?.code, "entityAllocator.invalidState");
});

test("restores the post-max snapshot without allocating duplicate ids", () => {
  const restored = EntityAllocator.restore(Number.MAX_SAFE_INTEGER);

  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected restorable post-max snapshot");
  }
  const allocated = restored.value.create();
  assert.equal(allocated.ok, false);
  assert.equal(!allocated.ok && allocated.errors[0]?.code, "entityAllocator.invalidState");
});

test("checks batch allocation capacity without consuming ids", () => {
  const allocator = new EntityAllocator();

  const canAllocate = allocator.canAllocate(2);
  const canAllocateZero = allocator.canAllocate(0);

  assert.equal(canAllocate.ok, true);
  assert.equal(canAllocateZero.ok, true);
  assert.equal(allocator.snapshot(), 1);
});

test("accepts an exact remaining batch allocation without consuming ids", () => {
  const restored = EntityAllocator.restore(Number.MAX_SAFE_INTEGER - 1);

  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected allocator with exactly one remaining id");
  }

  const canAllocate = restored.value.canAllocate(1);

  assert.equal(canAllocate.ok, true);
  assert.equal(restored.value.snapshot(), Number.MAX_SAFE_INTEGER - 1);
});

test("rejects impossible batch allocation without consuming ids", () => {
  const restored = EntityAllocator.restore(Number.MAX_SAFE_INTEGER - 1);

  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected allocator near max id");
  }

  const canAllocate = restored.value.canAllocate(2);

  assert.equal(canAllocate.ok, false);
  assert.equal(!canAllocate.ok && canAllocate.errors[0]?.code, "entityAllocator.invalidState");
  assert.equal(restored.value.snapshot(), Number.MAX_SAFE_INTEGER - 1);
});

test("rejects invalid batch allocation counts", () => {
  const allocator = new EntityAllocator();

  for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const result = allocator.canAllocate(count);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.errors[0]?.code, "entityAllocator.invalidState");
  }
  assert.equal(allocator.snapshot(), 1);
});
