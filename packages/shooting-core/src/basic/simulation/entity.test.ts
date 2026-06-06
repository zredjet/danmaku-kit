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
