const UINT32_MODULUS = 0x1_0000_0000;
const XXHASH64_BLOCK_BYTES = 32;

const PRIME64_1 = uint64(0x9e37_79b1, 0x85eb_ca87);
const PRIME64_2 = uint64(0xc2b2_ae3d, 0x27d4_eb4f);
const PRIME64_3 = uint64(0x1656_67b1, 0x9e37_79f9);
const PRIME64_4 = uint64(0x85eb_ca77, 0xc2b2_ae63);
const PRIME64_5 = uint64(0x27d4_eb2f, 0x1656_67c5);
const ZERO_UINT64 = uint64(0, 0);

/** JavaScript number だけで表現する unsigned 64-bit 値。 */
export type Uint64Parts = Readonly<{
  hi: number;
  lo: number;
}>;

/**
 * state hash で固定する xxHash64 seed。値は ASCII の "SHOOTING"（旧名称の shooting-core から）で、変えると state hash の byte 列と
 * golden がすべて変わるため、名称を danmaku-kit に変えた後もこの値のまま固定する。
 */
export const STATE_HASH_XXHASH64_SEED = Object.freeze(uint64(0x5348_4f4f, 0x5449_4e47));

/**
 * canonical byte stream 用の incremental xxHash64。
 *
 * `write()` は `CanonicalByteSink` と同じ規約で callback 中に byte を消費する。digest は状態を変更しないため、
 * 同じ入力列に対して何度呼んでも同じ値を返し、その後も追加 write を受け付ける。
 */
export class XxHash64 {
  readonly #seed: Uint64Parts;
  #totalLength = 0;
  #v1: Uint64Parts;
  #v2: Uint64Parts;
  #v3: Uint64Parts;
  #v4: Uint64Parts;
  #memory = new Uint8Array(XXHASH64_BLOCK_BYTES);
  #memoryLength = 0;

  constructor(seed: Uint64Parts = ZERO_UINT64) {
    this.#seed = assertUint64Parts(seed, "xxHash64 seed");
    this.#v1 = add64(this.#seed, PRIME64_1, PRIME64_2);
    this.#v2 = add64(this.#seed, PRIME64_2);
    this.#v3 = this.#seed;
    this.#v4 = subtract64(this.#seed, PRIME64_1);
  }

  /** byte 列の先頭 `length` byte を取り込み、32 byte block 単位で内部 state を更新する。 */
  write(bytes: Uint8Array, length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length) {
      throw new RangeError("xxHash64 write length must be within the supplied byte array");
    }
    if (this.#totalLength > Number.MAX_SAFE_INTEGER - length) {
      throw new RangeError("xxHash64 input length must be a safe integer");
    }
    this.#totalLength += length;

    let offset = 0;
    if (this.#memoryLength + length < XXHASH64_BLOCK_BYTES) {
      this.#memory.set(bytes.subarray(0, length), this.#memoryLength);
      this.#memoryLength += length;
      return;
    }

    if (this.#memoryLength > 0) {
      const required = XXHASH64_BLOCK_BYTES - this.#memoryLength;
      this.#memory.set(bytes.subarray(0, required), this.#memoryLength);
      this.processBlock(this.#memory, 0);
      this.#memoryLength = 0;
      offset = required;
    }

    const blockEnd = length - ((length - offset) % XXHASH64_BLOCK_BYTES);
    while (offset < blockEnd) {
      this.processBlock(bytes, offset);
      offset += XXHASH64_BLOCK_BYTES;
    }

    const remainder = length - offset;
    if (remainder > 0) {
      this.#memory.set(bytes.subarray(offset, length), 0);
      this.#memoryLength = remainder;
    }
  }

  /** 現在までに取り込んだ byte 列の xxHash64 digest を返す。 */
  digest(): Uint64Parts {
    let hash = this.#totalLength >= XXHASH64_BLOCK_BYTES
      ? add64(
        rotateLeft64(this.#v1, 1),
        rotateLeft64(this.#v2, 7),
        rotateLeft64(this.#v3, 12),
        rotateLeft64(this.#v4, 18),
      )
      : add64(this.#seed, PRIME64_5);

    if (this.#totalLength >= XXHASH64_BLOCK_BYTES) {
      hash = mergeRound(hash, this.#v1);
      hash = mergeRound(hash, this.#v2);
      hash = mergeRound(hash, this.#v3);
      hash = mergeRound(hash, this.#v4);
    }

    hash = add64(hash, uint64FromSafeInteger(this.#totalLength));
    let offset = 0;
    while (offset + 8 <= this.#memoryLength) {
      const lane = round64(ZERO_UINT64, readUint64LittleEndian(this.#memory, offset));
      hash = xor64(hash, lane);
      hash = add64(multiply64(rotateLeft64(hash, 27), PRIME64_1), PRIME64_4);
      offset += 8;
    }
    if (offset + 4 <= this.#memoryLength) {
      hash = xor64(hash, multiply64(uint64FromUint32(readUint32LittleEndian(this.#memory, offset)), PRIME64_1));
      hash = add64(multiply64(rotateLeft64(hash, 23), PRIME64_2), PRIME64_3);
      offset += 4;
    }
    while (offset < this.#memoryLength) {
      hash = xor64(hash, multiply64(uint64FromUint32(this.#memory[offset]!), PRIME64_5));
      hash = multiply64(rotateLeft64(hash, 11), PRIME64_1);
      offset += 1;
    }
    return avalanche64(hash);
  }

  /** 現在までに取り込んだ byte 列の lower-case 16 桁 hex digest を返す。 */
  digestHex(): string {
    return formatUint64Hex(this.digest());
  }

  private processBlock(bytes: Uint8Array, offset: number): void {
    this.#v1 = round64(this.#v1, readUint64LittleEndian(bytes, offset));
    this.#v2 = round64(this.#v2, readUint64LittleEndian(bytes, offset + 8));
    this.#v3 = round64(this.#v3, readUint64LittleEndian(bytes, offset + 16));
    this.#v4 = round64(this.#v4, readUint64LittleEndian(bytes, offset + 24));
  }
}

/** 一回限りの byte 列を xxHash64 で hash する。 */
export function xxHash64(bytes: Uint8Array, seed: Uint64Parts = ZERO_UINT64): Uint64Parts {
  const hasher = new XxHash64(seed);
  hasher.write(bytes, bytes.length);
  return hasher.digest();
}

/** uint32 pair を lower-case 16 桁 hex 表記へ変換する。 */
export function formatUint64Hex(value: Uint64Parts): string {
  const normalized = assertUint64Parts(value, "uint64 value");
  return `${normalized.hi.toString(16).padStart(8, "0")}${normalized.lo.toString(16).padStart(8, "0")}`;
}

function uint64(hi: number, lo: number): Uint64Parts {
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

function assertUint64Parts(value: Uint64Parts, fieldName: string): Uint64Parts {
  if (!isUint32(value.hi) || !isUint32(value.lo)) {
    throw new RangeError(`${fieldName} must contain uint32 hi and lo parts`);
  }
  return uint64(value.hi, value.lo);
}

function isUint32(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value < UINT32_MODULUS;
}

function uint64FromUint32(value: number): Uint64Parts {
  return uint64(0, value);
}

function uint64FromSafeInteger(value: number): Uint64Parts {
  return uint64(Math.floor(value / UINT32_MODULUS), value >>> 0);
}

function add64(...values: readonly Uint64Parts[]): Uint64Parts {
  let hi = 0;
  let lo = 0;
  for (const value of values) {
    const nextLo = lo + value.lo;
    lo = nextLo >>> 0;
    hi = (hi + value.hi + Math.floor(nextLo / UINT32_MODULUS)) >>> 0;
  }
  return uint64(hi, lo);
}

function subtract64(left: Uint64Parts, right: Uint64Parts): Uint64Parts {
  const low = left.lo - right.lo;
  return uint64(left.hi - right.hi - (low < 0 ? 1 : 0), low);
}

function xor64(left: Uint64Parts, right: Uint64Parts): Uint64Parts {
  return uint64(left.hi ^ right.hi, left.lo ^ right.lo);
}

function shiftRight64(value: Uint64Parts, amount: number): Uint64Parts {
  if (amount === 0) {
    return value;
  }
  if (amount < 32) {
    return uint64(value.hi >>> amount, (value.lo >>> amount) | (value.hi << (32 - amount)));
  }
  if (amount === 32) {
    return uint64(0, value.hi);
  }
  return uint64(0, value.hi >>> (amount - 32));
}

function rotateLeft64(value: Uint64Parts, amount: number): Uint64Parts {
  const shift = amount % 64;
  if (shift === 0) {
    return value;
  }
  if (shift === 32) {
    return uint64(value.lo, value.hi);
  }
  if (shift < 32) {
    return uint64(
      (value.hi << shift) | (value.lo >>> (32 - shift)),
      (value.lo << shift) | (value.hi >>> (32 - shift)),
    );
  }
  return rotateLeft64(uint64(value.lo, value.hi), shift - 32);
}

function multiply64(left: Uint64Parts, right: Uint64Parts): Uint64Parts {
  const leftLow16 = left.lo & 0xffff;
  const leftHigh16 = left.lo >>> 16;
  const rightLow16 = right.lo & 0xffff;
  const rightHigh16 = right.lo >>> 16;
  const lowProduct = leftLow16 * rightLow16;
  const middle = (lowProduct >>> 16) + (leftLow16 * rightHigh16) + (leftHigh16 * rightLow16);
  const low = (lowProduct & 0xffff) | ((middle & 0xffff) << 16);
  const lowProductHigh = (leftHigh16 * rightHigh16) + Math.floor(middle / 0x1_0000);
  const crossHigh = Math.imul(left.lo, right.hi) + Math.imul(left.hi, right.lo);
  return uint64(lowProductHigh + crossHigh, low);
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function readUint64LittleEndian(bytes: Uint8Array, offset: number): Uint64Parts {
  return uint64(
    readUint32LittleEndian(bytes, offset + 4),
    readUint32LittleEndian(bytes, offset),
  );
}

function round64(accumulator: Uint64Parts, input: Uint64Parts): Uint64Parts {
  return multiply64(rotateLeft64(add64(accumulator, multiply64(input, PRIME64_2)), 31), PRIME64_1);
}

function mergeRound(hash: Uint64Parts, value: Uint64Parts): Uint64Parts {
  return add64(multiply64(xor64(hash, round64(ZERO_UINT64, value)), PRIME64_1), PRIME64_4);
}

function avalanche64(value: Uint64Parts): Uint64Parts {
  let hash = xor64(value, shiftRight64(value, 33));
  hash = multiply64(hash, PRIME64_2);
  hash = xor64(hash, shiftRight64(hash, 29));
  hash = multiply64(hash, PRIME64_3);
  return xor64(hash, shiftRight64(hash, 32));
}
