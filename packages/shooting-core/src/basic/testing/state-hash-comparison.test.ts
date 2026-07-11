import assert from "node:assert/strict";
import test from "node:test";

import { findFirstStateHashDivergence } from "./state-hash-comparison.ts";

test("returns null for matching tick hash sequences", () => {
  const samples = [
    { tick: 0, hash: "0000000000000000" },
    { tick: 1, hash: "1111111111111111" },
  ] as const;
  assert.equal(findFirstStateHashDivergence(samples, samples), null);
});

test("reports the earliest hash, tick, and sequence-length divergence", () => {
  assert.deepEqual(findFirstStateHashDivergence(
    [
      { tick: 0, hash: "0000000000000000" },
      { tick: 1, hash: "1111111111111111" },
      { tick: 2, hash: "2222222222222222" },
    ],
    [
      { tick: 0, hash: "0000000000000000" },
      { tick: 1, hash: "aaaaaaaaaaaaaaaa" },
      { tick: 2, hash: "2222222222222222" },
    ],
  ), {
    tick: 1,
    expectedHash: "1111111111111111",
    actualHash: "aaaaaaaaaaaaaaaa",
  });
  assert.deepEqual(findFirstStateHashDivergence(
    [{ tick: 0, hash: "0000000000000000" }],
    [{ tick: 0, hash: "0000000000000000" }, { tick: 1, hash: "1111111111111111" }],
  ), {
    tick: 1,
    expectedHash: null,
    actualHash: "1111111111111111",
  });
});
