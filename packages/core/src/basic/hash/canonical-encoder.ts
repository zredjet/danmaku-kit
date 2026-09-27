/** canonical encoding の値 tag。数値は設計書の byte format と対応させる。 */
export const CANONICAL_VALUE_TAG = Object.freeze({
  null: 0x00,
  false: 0x01,
  true: 0x02,
  number: 0x03,
  string: 0x04,
  array: 0x05,
  object: 0x06,
  fixedStruct: 0x07,
} as const);

const FIXED_STRUCT_MARKER: unique symbol = Symbol("canonicalFixedStruct");
const MAX_U32 = 0xffff_ffff;
const MAX_CANONICAL_NESTING_DEPTH = 128;
const MAX_CANONICAL_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_CANONICAL_CONTAINER_ENTRIES = 10_000;
const MAX_CANONICAL_TOTAL_CONTAINER_ENTRIES = 100_000;
const MAX_CANONICAL_STRING_BYTES = 8_192;
const MAX_CANONICAL_SORTED_KEY_BYTES = 256 * 1024;
const UTF8_CHUNK_SIZE = 4_096;
const fixedStructInstances = new WeakSet<object>();

type CanonicalObjectEntry = Readonly<{
  key: string;
  bytes: Uint8Array;
  value: CanonicalValue;
}>;

type CanonicalFixedStructSnapshot = Readonly<{
  source: object;
  name: string;
  fields: readonly CanonicalValue[];
}>;

/** canonical byte stream に含められる、Core 内部で正規化済みの JSON 互換 object。 */
export interface CanonicalObject {
  readonly [key: string]: CanonicalValue;
}

/** canonical byte stream の fixedStruct。schema-defined DTO だけがこの表現を使う。 */
export type CanonicalFixedStruct = Readonly<{
  readonly [FIXED_STRUCT_MARKER]: true;
  name: string;
  fields: readonly CanonicalValue[];
}>;

/** canonical encoder が受け付ける値。 */
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | CanonicalObject
  | CanonicalFixedStruct;

/**
 * canonical byte stream の受け取り先。
 *
 * `write()` は callback 中に `bytes` の先頭 `length` byte を消費する。後続 write で同じ buffer が
 * 再利用されるため、callback の外へ参照を保持してはならない。
 */
export type CanonicalByteSink = Readonly<{
  write(bytes: Uint8Array, length: number): void;
}>;

/** canonical input が byte format の前提を満たさないときに送出する error。 */
export class CanonicalEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalEncodingError";
  }
}

/**
 * fixedStruct 値を作る。
 *
 * fields は schema で定めた順序のまま shallow copy / freeze するため、呼び出し元の配列変更で
 * canonical byte sequence が変化しない。
 */
export function fixedStruct(name: string, fields: readonly CanonicalValue[]): CanonicalFixedStruct {
  const structure = Object.freeze({
    [FIXED_STRUCT_MARKER]: true as const,
    name,
    fields: Object.freeze(snapshotCanonicalArray(fields, "canonical fixedStruct fields")),
  });
  fixedStructInstances.add(structure);
  return structure;
}

/**
 * canonical value を設計書で定めた byte sequence に変換する。
 *
 * object key は UTF-8 byte lexicographic order、number は finite IEEE-754 binary64 little-endian、
 * `-0` は `+0` として出力する。
 * この internal helper は untrusted content loader ではなく、Core 所有 DTO と validation 済み extension payload だけを受け取る。
 */
export function encodeCanonicalValue(value: CanonicalValue): Uint8Array {
  const budget = new CanonicalEncodingBudget();
  const writer = new ByteWriter(undefined, budget);
  writeCanonicalValue(writer, value, new WeakSet<object>(), 0, budget);
  return writer.finish();
}

/**
 * canonical value を byte collector を作らずに sink へ書き出す。
 *
 * xxHash64 のような incremental digest はこの API を使い、大きな state hash で中間 byte stream の
 * 全量コピーを避ける。
 *
 * encoding error が起きた場合、既に sink へ渡した byte 列は未完了であり、呼び出し側は破棄する。
 * sink の `write()` が送出した例外は変換せずに伝播する。この場合も、既に渡した byte 列と sink を破棄し、
 * 新しい sink で先頭から再試行する。
 * `write()` を持たない sink は、byte を書く前に `TypeError` として拒否する。
 *
 * この internal helper は untrusted content loader ではなく、Core 所有 DTO と validation 済み extension payload だけを受け取る。
 */
export function writeCanonicalValueToSink(value: CanonicalValue, sink: CanonicalByteSink): void {
  assertCanonicalByteSink(sink);
  const budget = new CanonicalEncodingBudget();
  const writer = new ByteWriter(sink, budget);
  writeCanonicalValue(writer, value, new WeakSet<object>(), 0, budget);
  writer.flush();
}

function writeCanonicalValue(
  writer: ByteWriter,
  value: CanonicalValue,
  activeObjects: WeakSet<object>,
  depth: number,
  budget: CanonicalEncodingBudget,
): void {
  if (depth > MAX_CANONICAL_NESTING_DEPTH) {
    throw new CanonicalEncodingError(`canonical value must not exceed nesting depth ${MAX_CANONICAL_NESTING_DEPTH}`);
  }
  if (value === null) {
    writer.writeByte(CANONICAL_VALUE_TAG.null);
    return;
  }
  if (value === false) {
    writer.writeByte(CANONICAL_VALUE_TAG.false);
    return;
  }
  if (value === true) {
    writer.writeByte(CANONICAL_VALUE_TAG.true);
    return;
  }
  if (typeof value === "number") {
    writeNumber(writer, value);
    return;
  }
  if (typeof value === "string") {
    writeString(writer, value);
    return;
  }
  if (typeof value !== "object") {
    throw new CanonicalEncodingError("canonical value must be a plain object, array, primitive, or fixedStruct");
  }
  const fixedStructValue = readCanonicalFixedStruct(value);
  if (fixedStructValue) {
    writeFixedStruct(writer, fixedStructValue, activeObjects, depth, budget);
    return;
  }
  if (readCanonicalArray(value)) {
    writeArray(writer, value, activeObjects, depth, budget);
    return;
  }
  if (isPlainRecord(value)) {
    writeObject(writer, value, activeObjects, depth, budget);
    return;
  }
  throw new CanonicalEncodingError("canonical value must be a plain object, array, primitive, or fixedStruct");
}

function writeNumber(writer: ByteWriter, value: number): void {
  if (!Number.isFinite(value)) {
    throw new CanonicalEncodingError("canonical number must be finite");
  }
  writer.writeByte(CANONICAL_VALUE_TAG.number);
  writer.writeFloat64LittleEndian(Object.is(value, -0) ? 0 : value);
}

function writeString(writer: ByteWriter, value: string): void {
  const byteLength = measureUtf8ByteLength(value, "canonical string");
  writer.writeByte(CANONICAL_VALUE_TAG.string);
  writer.writeUint32(byteLength, "canonical string byte length");
  writeUtf8(writer, value);
}

function writeArray(
  writer: ByteWriter,
  value: readonly CanonicalValue[],
  activeObjects: WeakSet<object>,
  depth: number,
  budget: CanonicalEncodingBudget,
): void {
  enterObject(value, activeObjects, "canonical array");
  try {
    const entries = snapshotCanonicalArray(value, "canonical array", budget);
    writer.writeByte(CANONICAL_VALUE_TAG.array);
    writer.writeUint32(entries.length, "canonical array length");
    for (const entry of entries) {
      writeCanonicalValue(writer, entry, activeObjects, depth + 1, budget);
    }
  } finally {
    activeObjects.delete(value);
  }
}

function writeObject(
  writer: ByteWriter,
  value: CanonicalObject,
  activeObjects: WeakSet<object>,
  depth: number,
  budget: CanonicalEncodingBudget,
): void {
  enterObject(value, activeObjects, "canonical object");
  try {
    const entries = snapshotCanonicalObject(value, budget);
    entries.sort((left, right) => compareUtf8Bytes(left.bytes, right.bytes));

    writer.writeByte(CANONICAL_VALUE_TAG.object);
    writer.writeUint32(entries.length, "canonical object property count");
    for (const { key, bytes, value: entryValue } of entries) {
      writer.writeUint32(bytes.length, "canonical object key byte length");
      writer.writeBytes(bytes);
      writeCanonicalValue(writer, entryValue, activeObjects, depth + 1, budget);
    }
  } finally {
    activeObjects.delete(value);
  }
}

function writeFixedStruct(
  writer: ByteWriter,
  value: CanonicalFixedStructSnapshot,
  activeObjects: WeakSet<object>,
  depth: number,
  budget: CanonicalEncodingBudget,
): void {
  enterObject(value.source, activeObjects, "canonical fixedStruct");
  try {
    const nameByteLength = measureUtf8ByteLength(value.name, "canonical fixedStruct name");
    budget.consumeContainerEntries(value.fields.length, "canonical fixedStruct fields");
    writer.writeByte(CANONICAL_VALUE_TAG.fixedStruct);
    writer.writeUint32(nameByteLength, "canonical fixedStruct name byte length");
    writeUtf8(writer, value.name);
    writer.writeUint32(value.fields.length, "canonical fixedStruct field count");
    for (const field of value.fields) {
      writeCanonicalValue(writer, field, activeObjects, depth + 1, budget);
    }
  } finally {
    activeObjects.delete(value.source);
  }
}

function snapshotCanonicalObject(value: CanonicalObject, budget: CanonicalEncodingBudget): CanonicalObjectEntry[] {
  rejectSymbolProperties(value, "canonical object");
  const names = readCanonicalReflection(() => Object.getOwnPropertyNames(value));
  budget.consumeContainerEntries(names.length, "canonical object property count");
  let totalKeyBytes = 0;
  return names.map((key) => {
    const descriptor = readCanonicalReflection(() => Object.getOwnPropertyDescriptor(value, key));
    const entryValue = readEnumerableDataProperty(descriptor, `canonical object property ${key}`);
    const bytes = encodeUtf8(key, "canonical object key");
    totalKeyBytes += bytes.length;
    budget.consumeSortedKeyBytes(totalKeyBytes);
    return {
      key,
      bytes,
      value: entryValue,
    };
  });
}

function snapshotCanonicalArray(
  value: readonly CanonicalValue[],
  fieldName: string,
  budget?: CanonicalEncodingBudget,
): CanonicalValue[] {
  rejectSymbolProperties(value, fieldName);
  const ownNames = readCanonicalReflection(() => Object.getOwnPropertyNames(value));
  const lengthDescriptor = readCanonicalReflection(() => Object.getOwnPropertyDescriptor(value, "length"));
  if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    throw new CanonicalEncodingError(`${fieldName} must have a stable length property`);
  }
  const length = lengthDescriptor.value;
  if (length > MAX_CANONICAL_CONTAINER_ENTRIES) {
    throw new CanonicalEncodingError(`${fieldName} must not contain more than ${MAX_CANONICAL_CONTAINER_ENTRIES} entries`);
  }
  budget?.consumeContainerEntries(length, fieldName);
  for (const name of ownNames) {
    if (name === "length") {
      continue;
    }
    const index = Number(name);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== name) {
      throw new CanonicalEncodingError(`${fieldName} must not contain additional properties`);
    }
  }

  const entries = new Array<CanonicalValue>(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = readCanonicalReflection(() => Object.getOwnPropertyDescriptor(value, String(index)));
    entries[index] = readEnumerableDataProperty(descriptor, `${fieldName} index ${index}`);
  }
  return entries;
}

function readCanonicalFixedStruct(value: object): CanonicalFixedStructSnapshot | null {
  if (!fixedStructInstances.has(value)) {
    return null;
  }
  const marker = readCanonicalReflection(() => Object.getOwnPropertyDescriptor(value, FIXED_STRUCT_MARKER));
  if (!marker || !("value" in marker) || marker.value !== true) {
    return null;
  }
  const names = readCanonicalReflection(() => Object.getOwnPropertyNames(value));
  const symbols = readCanonicalReflection(() => Object.getOwnPropertySymbols(value));
  if (names.length !== 2 || !names.includes("name") || !names.includes("fields") || symbols.length !== 1 || symbols[0] !== FIXED_STRUCT_MARKER) {
    throw new CanonicalEncodingError("canonical fixedStruct must not contain additional properties");
  }
  const name = readEnumerableDataProperty(
    readCanonicalReflection(() => Object.getOwnPropertyDescriptor(value, "name")),
    "canonical fixedStruct name",
  );
  const fields = readEnumerableDataProperty(
    readCanonicalReflection(() => Object.getOwnPropertyDescriptor(value, "fields")),
    "canonical fixedStruct fields",
  );
  if (typeof name !== "string" || !readCanonicalArray(fields)) {
    throw new CanonicalEncodingError("canonical fixedStruct must contain a string name and an array of fields");
  }
  return { source: value, name, fields: fields as readonly CanonicalValue[] };
}

function readEnumerableDataProperty(descriptor: PropertyDescriptor | undefined, fieldName: string): CanonicalValue {
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
    throw new CanonicalEncodingError(`${fieldName} must be an enumerable data property`);
  }
  return descriptor.value as CanonicalValue;
}

function rejectSymbolProperties(value: object, fieldName: string): void {
  if (readCanonicalReflection(() => Object.getOwnPropertySymbols(value)).length > 0) {
    throw new CanonicalEncodingError(`${fieldName} must not contain symbol properties`);
  }
}

function readCanonicalArray(value: unknown): value is readonly CanonicalValue[] {
  return readCanonicalReflection(() => Array.isArray(value));
}

function readCanonicalReflection<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    // catch 節の error 自体が hostile Proxy でも、instanceof で再び trap を起動しない。
    throw new CanonicalEncodingError("canonical value reflection failed");
  }
}

function assertCanonicalByteSink(sink: CanonicalByteSink): void {
  if (
    (typeof sink !== "object" && typeof sink !== "function")
    || sink === null
    || typeof sink.write !== "function"
  ) {
    throw new TypeError("canonical sink must provide a write method");
  }
}

function compareUtf8Bytes(left: Uint8Array, right: Uint8Array): number {
  const comparedLength = Math.min(left.length, right.length);
  for (let index = 0; index < comparedLength; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function encodeUtf8(value: string, fieldName: string): Uint8Array {
  const byteLength = measureUtf8ByteLength(value, fieldName);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  forEachUtf8CodePoint(value, (codePoint) => {
    offset = writeUtf8CodePoint(bytes, offset, codePoint);
  });
  return bytes;
}

function writeUtf8(writer: ByteWriter, value: string): void {
  const chunk = writer.getUtf8ScratchBuffer();
  let length = 0;
  forEachUtf8CodePoint(value, (codePoint) => {
    const codePointLength = utf8CodePointLength(codePoint);
    if (length + codePointLength > chunk.length) {
      writer.writeBytes(chunk.subarray(0, length));
      length = 0;
    }
    length = writeUtf8CodePoint(chunk, length, codePoint);
  });
  if (length > 0) {
    writer.writeBytes(chunk.subarray(0, length));
  }
}

function measureUtf8ByteLength(value: string, fieldName: string): number {
  let byteLength = 0;
  forEachUtf8CodePoint(value, (codePoint) => {
    byteLength += utf8CodePointLength(codePoint);
    if (byteLength > MAX_CANONICAL_STRING_BYTES) {
      throw new CanonicalEncodingError(`${fieldName} must not exceed ${MAX_CANONICAL_STRING_BYTES} UTF-8 bytes`);
    }
  }, fieldName);
  return byteLength;
}

function forEachUtf8CodePoint(value: string, callback: (codePoint: number) => void, fieldName = "canonical string"): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!Number.isFinite(nextCodeUnit) || nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        throw new CanonicalEncodingError(`${fieldName} must not contain lone surrogate code units`);
      }
      callback(((codeUnit - 0xd800) * 0x400) + (nextCodeUnit - 0xdc00) + 0x10000);
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new CanonicalEncodingError(`${fieldName} must not contain lone surrogate code units`);
    }
    callback(codeUnit);
  }
}

function utf8CodePointLength(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

function writeUtf8CodePoint(bytes: Uint8Array, offset: number, codePoint: number): number {
  if (codePoint <= 0x7f) {
    bytes[offset] = codePoint;
    return offset + 1;
  }
  if (codePoint <= 0x7ff) {
    bytes[offset] = 0xc0 | (codePoint >> 6);
    bytes[offset + 1] = 0x80 | (codePoint & 0x3f);
    return offset + 2;
  }
  if (codePoint <= 0xffff) {
    bytes[offset] = 0xe0 | (codePoint >> 12);
    bytes[offset + 1] = 0x80 | ((codePoint >> 6) & 0x3f);
    bytes[offset + 2] = 0x80 | (codePoint & 0x3f);
    return offset + 3;
  }
  bytes[offset] = 0xf0 | (codePoint >> 18);
  bytes[offset + 1] = 0x80 | ((codePoint >> 12) & 0x3f);
  bytes[offset + 2] = 0x80 | ((codePoint >> 6) & 0x3f);
  bytes[offset + 3] = 0x80 | (codePoint & 0x3f);
  return offset + 4;
}

function enterObject(value: object, activeObjects: WeakSet<object>, fieldName: string): void {
  if (activeObjects.has(value)) {
    throw new CanonicalEncodingError(`${fieldName} must not contain cyclic references`);
  }
  activeObjects.add(value);
}

function isPlainRecord(value: object): value is CanonicalObject {
  const prototype = readCanonicalReflection(() => Object.getPrototypeOf(value));
  return prototype === null || prototype === Object.prototype;
}

class CanonicalEncodingBudget {
  #totalBytes = 0;
  #containerEntries = 0;

  /** validation 済み canonical tree の配列・object・fixedStruct fields 総数を制限する。 */
  consumeContainerEntries(count: number, fieldName: string): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_CANONICAL_CONTAINER_ENTRIES) {
      throw new CanonicalEncodingError(`${fieldName} must not contain more than ${MAX_CANONICAL_CONTAINER_ENTRIES} entries`);
    }
    this.#containerEntries += count;
    if (this.#containerEntries > MAX_CANONICAL_TOTAL_CONTAINER_ENTRIES) {
      throw new CanonicalEncodingError(`canonical value must not exceed ${MAX_CANONICAL_TOTAL_CONTAINER_ENTRIES} container entries`);
    }
  }

  /** key sort 用の UTF-8 byte を object ごとに固定上限へ制限する。 */
  consumeSortedKeyBytes(totalBytes: number): void {
    if (totalBytes > MAX_CANONICAL_SORTED_KEY_BYTES) {
      throw new CanonicalEncodingError(`canonical object keys must not exceed ${MAX_CANONICAL_SORTED_KEY_BYTES} UTF-8 bytes`);
    }
  }

  /** 出力全体を bounded にし、collector の伸長上限も一緒に固定する。 */
  consumeBytes(count: number): void {
    this.#totalBytes += count;
    if (this.#totalBytes > MAX_CANONICAL_TOTAL_BYTES) {
      throw new CanonicalEncodingError(`canonical byte stream must not exceed ${MAX_CANONICAL_TOTAL_BYTES} bytes`);
    }
  }
}

class ByteWriter {
  #buffer = new Uint8Array(4_096);
  #view = new DataView(this.#buffer.buffer);
  #length = 0;
  #utf8ScratchBuffer?: Uint8Array;
  readonly #sink?: CanonicalByteSink;
  readonly #budget: CanonicalEncodingBudget;

  constructor(sink: CanonicalByteSink | undefined, budget: CanonicalEncodingBudget) {
    this.#sink = sink;
    this.#budget = budget;
  }

  writeByte(value: number): void {
    this.#budget.consumeBytes(1);
    this.ensureCapacity(1);
    this.#buffer[this.#length] = value;
    this.#length += 1;
  }

  writeUint32(value: number, fieldName: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_U32) {
      throw new CanonicalEncodingError(`${fieldName} must be an unsigned 32-bit integer`);
    }
    this.#budget.consumeBytes(4);
    this.ensureCapacity(4);
    this.#view.setUint32(this.#length, value, true);
    this.#length += 4;
  }

  writeFloat64LittleEndian(value: number): void {
    this.#budget.consumeBytes(8);
    this.ensureCapacity(8);
    this.#view.setFloat64(this.#length, value, true);
    this.#length += 8;
  }

  writeBytes(value: Uint8Array): void {
    this.#budget.consumeBytes(value.length);
    if (this.#sink && value.length >= this.#buffer.length) {
      this.flush();
      this.#sink.write(value, value.length);
      return;
    }
    this.ensureCapacity(value.length);
    this.#buffer.set(value, this.#length);
    this.#length += value.length;
  }

  /** string ごとの一時確保を避けるため、writer の寿命で UTF-8 chunk を再利用する。 */
  getUtf8ScratchBuffer(): Uint8Array {
    if (!this.#utf8ScratchBuffer) {
      this.#utf8ScratchBuffer = new Uint8Array(UTF8_CHUNK_SIZE);
    }
    return this.#utf8ScratchBuffer;
  }

  finish(): Uint8Array {
    if (this.#sink) {
      throw new CanonicalEncodingError("streaming canonical writer cannot finish as a byte array");
    }
    return this.#buffer.slice(0, this.#length);
  }

  flush(): void {
    if (!this.#sink || this.#length === 0) {
      return;
    }
    this.#sink.write(this.#buffer, this.#length);
    this.#length = 0;
  }

  private ensureCapacity(requiredLength: number): void {
    const minimumCapacity = this.#length + requiredLength;
    if (minimumCapacity <= this.#buffer.length) {
      return;
    }
    if (this.#sink) {
      this.flush();
      if (requiredLength <= this.#buffer.length) {
        return;
      }
      this.#buffer = new Uint8Array(requiredLength);
      this.#view = new DataView(this.#buffer.buffer);
      return;
    }
    let nextCapacity = this.#buffer.length;
    while (nextCapacity < minimumCapacity) {
      nextCapacity *= 2;
    }
    const nextBuffer = new Uint8Array(nextCapacity);
    nextBuffer.set(this.#buffer);
    this.#buffer = nextBuffer;
    this.#view = new DataView(this.#buffer.buffer);
  }
}
