import assert from "node:assert/strict";
import test from "node:test";

import { ViewPool } from "./view-pool.ts";

function createPool(capacity: number) {
  let nextId = 0;
  return new ViewPool(capacity, () => ({ id: nextId++ }));
}

test("warms views up to the capacity in bounded batches", () => {
  const pool = createPool(5);

  assert.deepEqual([pool.warm(2), pool.warm(2), pool.warm(2), pool.warm(2)], [2, 2, 1, 0]);
  assert.equal(pool.created, 5);
  assert.equal(pool.capacity, 5);
});

test("reuses released views and reports exhaustion with null", () => {
  const pool = createPool(2);
  pool.warm(2);

  const first = pool.acquire();
  const second = pool.acquire();
  assert.notEqual(first, null);
  assert.notEqual(second, null);
  assert.equal(pool.acquire(), null);
  pool.release(first!);
  assert.equal(pool.acquire(), first);
  assert.equal(pool.created, 2);
});

test("creates views on demand until the capacity when warm-up has not finished", () => {
  const pool = createPool(2);

  assert.deepEqual([pool.acquire(), pool.acquire(), pool.acquire()], [{ id: 0 }, { id: 1 }, null]);
  assert.throws(() => createPool(-1), RangeError);
});
