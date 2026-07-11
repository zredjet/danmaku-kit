import assert from "node:assert/strict";
import test from "node:test";

import {
  SHOOTING_XXHASH64_SEED,
  XxHash64,
  formatUint64Hex,
  xxHash64,
} from "./xxhash64.ts";

function utf8Bytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "utf8"));
}

test("matches known xxHash64 vectors with the zero seed", () => {
  assert.equal(formatUint64Hex(xxHash64(utf8Bytes(""))), "ef46db3751d8e999");
  assert.equal(formatUint64Hex(xxHash64(utf8Bytes("a"))), "d24ec4f1a98c6e5b");
  assert.equal(formatUint64Hex(xxHash64(utf8Bytes("abc"))), "44bc2cf5ad770999");
  assert.equal(formatUint64Hex(xxHash64(utf8Bytes("hello"))), "26c7827d889f6da3");
  assert.equal(formatUint64Hex(xxHash64(utf8Bytes("123456789"))), "8cb841db40e6ae83");
});

test("uses the fixed shooting seed and supports chunked canonical sink writes", () => {
  const bytes = utf8Bytes("0123456789".repeat(4));
  assert.deepEqual(SHOOTING_XXHASH64_SEED, { hi: 0x5348_4f4f, lo: 0x5449_4e47 });
  assert.equal(formatUint64Hex(xxHash64(bytes)), "ca6fc80cbde1a931");
  assert.equal(formatUint64Hex(xxHash64(bytes, SHOOTING_XXHASH64_SEED)), "760ba0d45d5a6a70");

  const hasher = new XxHash64(SHOOTING_XXHASH64_SEED);
  hasher.write(bytes.subarray(0, 7), 7);
  hasher.write(bytes.subarray(7, 33), 26);
  hasher.write(bytes.subarray(33), 7);
  assert.equal(hasher.digestHex(), "760ba0d45d5a6a70");
  assert.equal(hasher.digestHex(), "760ba0d45d5a6a70");
});

test("formats uint64 pairs and rejects invalid hash inputs", () => {
  assert.equal(formatUint64Hex({ hi: 0, lo: 1 }), "0000000000000001");
  assert.throws(() => new XxHash64({ hi: -1, lo: 0 }), RangeError);

  const hasher = new XxHash64();
  assert.throws(() => hasher.write(utf8Bytes("a"), 2), RangeError);
});
