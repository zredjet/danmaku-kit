import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_VALUE_TAG,
  CanonicalEncodingError,
  encodeCanonicalValue,
  fixedStruct,
  writeCanonicalValueToSink,
} from "./canonical-encoder.ts";
import type { CanonicalValue } from "./canonical-encoder.ts";

function encodeHex(value: Parameters<typeof encodeCanonicalValue>[0]): string {
  return Array.from(encodeCanonicalValue(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("encodes primitive tags and scalar values with canonical bytes", () => {
  assert.deepEqual(CANONICAL_VALUE_TAG, {
    null: 0x00,
    false: 0x01,
    true: 0x02,
    number: 0x03,
    string: 0x04,
    array: 0x05,
    object: 0x06,
    fixedStruct: 0x07,
  });
  assert.equal(encodeHex(null), "00");
  assert.equal(encodeHex(false), "01");
  assert.equal(encodeHex(true), "02");
  assert.equal(encodeHex(1), "03000000000000f03f");
  assert.equal(encodeHex(-1.5), "03000000000000f8bf");
  assert.equal(encodeHex(""), "0400000000");
  assert.equal(encodeHex("A"), "040100000041");
  assert.equal(encodeHex("¢"), "0402000000c2a2");
  assert.equal(encodeHex("€"), "0403000000e282ac");
  assert.equal(encodeHex("😀"), "0404000000f09f9880");
  assert.equal(encodeHex(fixedStruct("😀", [null])), "0704000000f09f98800100000000");
});

test("normalizes negative zero and preserves finite binary64 values", () => {
  assert.equal(encodeHex(0), "030000000000000000");
  assert.equal(encodeHex(-0), "030000000000000000");
  assert.equal(encodeHex(0.1), "039a9999999999b93f");
  assert.equal(encodeHex(Math.SQRT1_2), "03cd3b7f669ea0e63f");
  assert.equal(encodeHex(Number.MIN_VALUE), "030100000000000000");
  assert.equal(encodeHex(Number.MAX_VALUE), "03ffffffffffffef7f");
});

test("encodes arrays and fixedStruct fields in the supplied schema order", () => {
  assert.equal(encodeHex([]), "0500000000");
  assert.equal(encodeHex({}), "0600000000");
  assert.equal(encodeHex(fixedStruct("x", [])), "07010000007800000000");
  assert.equal(encodeHex([null, true, "A"]), "05030000000002040100000041");
  assert.equal(
    encodeHex(fixedStruct("vector2", [1, -1.5])),
    "0707000000766563746f72320200000003000000000000f03f03000000000000f8bf",
  );
  assert.notDeepEqual(
    encodeCanonicalValue(fixedStruct("vector2", [1, -1.5])),
    encodeCanonicalValue(fixedStruct("vector2", [-1.5, 1])),
  );
});

test("snapshots caller-owned fixedStruct field arrays", () => {
  const fields: CanonicalValue[] = [1];
  const structure = fixedStruct("x", fields);
  fields[0] = 2;
  assert.equal(encodeHex(structure), "0701000000780100000003000000000000f03f");
});

test("preserves nested fixedStruct tags, names, and field order", () => {
  const player = fixedStruct("playerRuntimeEntity", [
    fixedStruct("vector2", [1, 2]),
    fixedStruct("playerMovement", [3, 4]),
  ]);
  assert.equal(encodeHex(player), [
    "0713000000706c6179657252756e74696d65456e7469747902000000",
    "0707000000766563746f72320200000003000000000000f03f030000000000000040",
    "070e000000706c617965724d6f76656d656e7402000000030000000000000840030000000000001040",
  ].join(""));
});

test("sorts object keys by UTF-8 byte sequence rather than insertion or UTF-16 order", () => {
  const object = {
    "\u{10000}": 2,
    "\uE000": 1,
  };
  assert.equal(
    encodeHex(object),
    "060200000003000000ee808003000000000000f03f04000000f0908080030000000000000040",
  );
  assert.deepEqual(
    encodeCanonicalValue({ b: 2, a: 1 }),
    encodeCanonicalValue({ a: 1, b: 2 }),
  );
  assert.equal(
    encodeHex({ "\u00bf": 1, "\u0080": 2 }),
    "060200000002000000c28003000000000000004002000000c2bf03000000000000f03f",
  );
  assert.equal(
    encodeHex({ aa: 2, a: 1 }),
    "0602000000010000006103000000000000f03f020000006161030000000000000040",
  );
});

test("encodes u32 length and count boundaries", () => {
  const string255 = encodeCanonicalValue("a".repeat(255));
  const string256 = encodeCanonicalValue("😀".repeat(64));
  assert.equal(bytesToHex(string255.slice(0, 5)), "04ff000000");
  assert.equal(string255.length, 260);
  assert.equal(bytesToHex(string256.slice(0, 5)), "0400010000");
  assert.equal(string256.length, 261);

  const object255 = encodeCanonicalValue({ ["a".repeat(255)]: null });
  const object256 = encodeCanonicalValue({ ["😀".repeat(64)]: null });
  assert.equal(bytesToHex(object255.slice(0, 9)), "0601000000ff000000");
  assert.equal(bytesToHex(object256.slice(0, 9)), "060100000000010000");

  const array255 = encodeCanonicalValue(new Array(255).fill(null));
  const array256 = encodeCanonicalValue(new Array(256).fill(null));
  assert.equal(bytesToHex(array255.slice(0, 5)), "05ff000000");
  assert.equal(bytesToHex(array256.slice(0, 5)), "0500010000");

  const named255 = encodeCanonicalValue(fixedStruct("a".repeat(255), []));
  const named256 = encodeCanonicalValue(fixedStruct("😀".repeat(64), []));
  assert.equal(bytesToHex(named255.slice(0, 5)), "07ff000000");
  assert.equal(bytesToHex(named256.slice(0, 5)), "0700010000");

  const fields255 = encodeCanonicalValue(fixedStruct("x", new Array(255).fill(null)));
  const fields256 = encodeCanonicalValue(fixedStruct("x", new Array(256).fill(null)));
  assert.equal(bytesToHex(fields255.slice(0, 10)), "070100000078ff000000");
  assert.equal(bytesToHex(fields256.slice(0, 10)), "07010000007800010000");
});

test("streams canonical bytes without retaining a full byte collector", () => {
  const value = [fixedStruct("vector2", [1, -1.5]), "a".repeat(5_000)] as const;
  const chunks: number[] = [];
  writeCanonicalValueToSink(value, {
    write(bytes, length) {
      chunks.push(...bytes.slice(0, length));
    },
  });
  assert.deepEqual(Uint8Array.from(chunks), encodeCanonicalValue(value));

  const multiByteBoundaryValue = `${"a".repeat(4_095)}😀`;
  const multiByteChunks: number[] = [];
  writeCanonicalValueToSink(multiByteBoundaryValue, {
    write(bytes, length) {
      multiByteChunks.push(...bytes.slice(0, length));
    },
  });
  assert.deepEqual(Uint8Array.from(multiByteChunks), encodeCanonicalValue(multiByteBoundaryValue));
});

test("flushes and reuses the streaming sink buffer for many small values", () => {
  const value = new Array<CanonicalValue>(10_000).fill(null);
  const chunks: number[] = [];
  const callbackLengths: number[] = [];
  const backingBuffers: ArrayBufferLike[] = [];
  writeCanonicalValueToSink(value, {
    write(bytes, length) {
      assert.ok(length > 0);
      assert.ok(length <= 4_096);
      callbackLengths.push(length);
      backingBuffers.push(bytes.buffer);
      chunks.push(...bytes.slice(0, length));
    },
  });
  assert.ok(callbackLengths.length > 1);
  assert.ok(new Set(backingBuffers).size < backingBuffers.length);
  assert.deepEqual(Uint8Array.from(chunks), encodeCanonicalValue(value));
});

test("propagates sink failures without writing any later canonical bytes", () => {
  const bufferedFailure = new RangeError("buffered sink failure");
  let bufferedWrites = 0;
  assert.throws(() => writeCanonicalValueToSink(new Array<CanonicalValue>(4_097).fill(null), {
    write() {
      bufferedWrites += 1;
      throw bufferedFailure;
    },
  }), (error: unknown) => error === bufferedFailure);
  assert.equal(bufferedWrites, 1);

  const directFailure = new RangeError("direct sink failure");
  let directWrites = 0;
  assert.throws(() => writeCanonicalValueToSink("a".repeat(5_000), {
    write() {
      directWrites += 1;
      if (directWrites === 2) {
        throw directFailure;
      }
    },
  }), (error: unknown) => error === directFailure);
  assert.equal(directWrites, 2);
});

test("rejects invalid canonical byte sinks before encoding begins", () => {
  for (const sink of [null, undefined, false, 0, "", {}, { write: 1 }]) {
    assert.throws(() => writeCanonicalValueToSink("x", sink as never), TypeError);
  }
});

test("enforces canonical encoding resource budget boundaries", () => {
  const maximumString = "a".repeat(8_192);
  assert.equal(encodeCanonicalValue(maximumString).length, 8_197);

  const maximumObject = Object.fromEntries(
    Array.from({ length: 10_000 }, (_, index) => [`property${index}`, null]),
  );
  assert.doesNotThrow(() => encodeCanonicalValue(maximumObject));
  assert.doesNotThrow(() => encodeCanonicalValue(fixedStruct("x", new Array<CanonicalValue>(10_000).fill(null))));

  const exactContainerTotal = new Array<CanonicalValue>(10).fill(new Array<CanonicalValue>(9_999).fill(null));
  assert.doesNotThrow(() => encodeCanonicalValue(exactContainerTotal));

  const maximumObjectEntries = Object.fromEntries(
    Array.from({ length: 9_999 }, (_, index) => [`property${index}`, null]),
  );
  const maximumFixedStructFields = fixedStruct("x", new Array<CanonicalValue>(9_999).fill(null));
  const exactMixedContainerTotal = Array.from({ length: 10 }, (_, index) => (
    index % 2 === 0 ? maximumObjectEntries : maximumFixedStructFields
  ));
  assert.doesNotThrow(() => encodeCanonicalValue(exactMixedContainerTotal));

  const keyWithLength = (index: number): string => `${index.toString().padStart(2, "0")}${"a".repeat(8_190)}`;
  const exactKeyTotal = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [keyWithLength(index), null]));
  assert.doesNotThrow(() => encodeCanonicalValue(exactKeyTotal));

  const exactStream = [
    ...new Array<CanonicalValue>(255).fill(maximumString),
    "a".repeat(6_907),
  ];
  assert.equal(encodeCanonicalValue(exactStream).length, 2 * 1024 * 1024);
  let exactStreamedLength = 0;
  writeCanonicalValueToSink(exactStream, {
    write(_bytes, length) {
      exactStreamedLength += length;
    },
  });
  assert.equal(exactStreamedLength, 2 * 1024 * 1024);

  const excessiveString = "a".repeat(8_193);
  assert.throws(() => encodeCanonicalValue(excessiveString), CanonicalEncodingError);

  let sinkWriteCount = 0;
  assert.throws(() => writeCanonicalValueToSink(excessiveString, {
    write() {
      sinkWriteCount += 1;
    },
  }), CanonicalEncodingError);
  assert.equal(sinkWriteCount, 0);

  assert.throws(() => encodeCanonicalValue(new Array<CanonicalValue>(10_001).fill(null)), CanonicalEncodingError);
  assert.throws(() => encodeCanonicalValue(Object.fromEntries(
    Array.from({ length: 10_001 }, (_, index) => [`property${index}`, null]),
  )), CanonicalEncodingError);
  assert.throws(() => fixedStruct("x", new Array<CanonicalValue>(10_001).fill(null)), CanonicalEncodingError);
  assert.throws(() => encodeCanonicalValue(fixedStruct("a".repeat(8_193), [])), CanonicalEncodingError);
  assert.throws(() => encodeCanonicalValue({ ["a".repeat(8_193)]: null }), CanonicalEncodingError);
  assert.throws(() => encodeCanonicalValue(new Array<CanonicalValue>(10).fill(new Array<CanonicalValue>(10_000).fill(null))), CanonicalEncodingError);
  assert.throws(() => encodeCanonicalValue([...exactMixedContainerTotal, null]), CanonicalEncodingError);
  assert.throws(() => encodeCanonicalValue(Object.fromEntries(
    Array.from({ length: 33 }, (_, index) => [keyWithLength(index), null]),
  )), CanonicalEncodingError);

  const excessiveStream = [...exactStream.slice(0, -1), "a".repeat(6_908)];
  assert.throws(() => encodeCanonicalValue(excessiveStream), CanonicalEncodingError);
  assert.throws(() => writeCanonicalValueToSink(excessiveStream, { write() {} }), CanonicalEncodingError);
});

test("rejects values that cannot have stable canonical bytes", () => {
  assert.throws(() => encodeCanonicalValue(Number.NaN), CanonicalEncodingError);
  assert.throws(() => encodeCanonicalValue(Number.POSITIVE_INFINITY), CanonicalEncodingError);
  assert.throws(() => encodeCanonicalValue("\uD800"), CanonicalEncodingError);
  assert.throws(() => encodeCanonicalValue({ "\uDC00": 1 }), CanonicalEncodingError);
  const sparse = new Array<Parameters<typeof encodeCanonicalValue>[0]>(2);
  sparse[1] = 1;
  assert.throws(() => encodeCanonicalValue(sparse), CanonicalEncodingError);
  assert.throws(() => encodeCanonicalValue(new Date() as never), CanonicalEncodingError);

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => encodeCanonicalValue(cyclic as never), CanonicalEncodingError);

  let getterReads = 0;
  const accessorObject = {};
  Object.defineProperty(accessorObject, "value", {
    enumerable: true,
    get() {
      getterReads += 1;
      return 1;
    },
  });
  assert.throws(() => encodeCanonicalValue(accessorObject as never), CanonicalEncodingError);
  assert.equal(getterReads, 0);

  const accessorArray: unknown[] = [];
  Object.defineProperty(accessorArray, "0", {
    enumerable: true,
    get() {
      getterReads += 1;
      return 1;
    },
  });
  assert.throws(() => encodeCanonicalValue(accessorArray as never), CanonicalEncodingError);
  assert.equal(getterReads, 0);

  const symbolObject = { value: 1 };
  Object.defineProperty(symbolObject, Symbol("hidden"), { value: 2 });
  assert.throws(() => encodeCanonicalValue(symbolObject), CanonicalEncodingError);

  const nonEnumerableObject = { value: 1 };
  Object.defineProperty(nonEnumerableObject, "hidden", { value: 2 });
  assert.throws(() => encodeCanonicalValue(nonEnumerableObject), CanonicalEncodingError);

  const arrayWithExtraProperty = [1];
  Object.defineProperty(arrayWithExtraProperty, "extra", { value: 2, enumerable: true });
  assert.throws(() => encodeCanonicalValue(arrayWithExtraProperty), CanonicalEncodingError);

  const sparseFields = new Array<Parameters<typeof encodeCanonicalValue>[0]>(1);
  assert.throws(() => fixedStruct("sparse", sparseFields), CanonicalEncodingError);

  const forgedFixedStruct = Object.create(fixedStruct("template", []));
  Object.defineProperties(forgedFixedStruct, {
    name: { value: "forged", enumerable: true },
    fields: { value: [1], enumerable: true },
  });
  assert.throws(() => encodeCanonicalValue(forgedFixedStruct as never), CanonicalEncodingError);

  const throwingObjectProxy = new Proxy({}, {
    getPrototypeOf() {
      throw new RangeError("object proxy trap");
    },
  });
  assert.throws(() => encodeCanonicalValue(throwingObjectProxy as never), CanonicalEncodingError);

  const throwingArrayProxy = new Proxy([], {
    ownKeys() {
      throw new RangeError("array proxy trap");
    },
  });
  assert.throws(() => encodeCanonicalValue(throwingArrayProxy as never), CanonicalEncodingError);

  const hostileThrownValue = new Proxy({}, {
    getPrototypeOf() {
      throw new RangeError("thrown value proxy trap");
    },
  });
  const proxyThrowingHostileValue = new Proxy([], {
    ownKeys() {
      throw hostileThrownValue;
    },
  });
  assert.throws(() => encodeCanonicalValue(proxyThrowingHostileValue as never), CanonicalEncodingError);

  const getTrappingArray = new Proxy([], {
    get(target, property, receiver) {
      if (property === "length") {
        throw new RangeError("array length access");
      }
      return Reflect.get(target, property, receiver);
    },
  });
  assert.equal(encodeHex(getTrappingArray as never), "0500000000");

  const revocableArray = Proxy.revocable([], {});
  revocableArray.revoke();
  assert.throws(() => encodeCanonicalValue(revocableArray.proxy as never), CanonicalEncodingError);

  let deeplyNested: Parameters<typeof encodeCanonicalValue>[0] = null;
  for (let index = 0; index < 129; index += 1) {
    deeplyNested = [deeplyNested];
  }
  assert.throws(() => encodeCanonicalValue(deeplyNested), CanonicalEncodingError);
});
