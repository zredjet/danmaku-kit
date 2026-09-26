import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { isPlainObjectContainer } from "../shared/guards.ts";
import { compareUtf8Lexicographic } from "../shared/utf8-order.ts";
import type { SerializedJsonValue } from "./types.ts";

const MAX_RESTORE_JSON_PAYLOAD_DEPTH = 32;
const MAX_RESTORE_JSON_PAYLOAD_NODES = 8_192;
const MAX_RESTORE_JSON_PAYLOAD_BYTES = 262_144;
const MAX_RESTORE_JSON_STRING_BYTES = 8_192;

export type RestoreJsonBudget = {
  bytes: number;
  nodes: number;
};

/** extension payload 全体で共有する JSON guard 用 budget を作る。 */
export function createRestoreJsonBudget(): RestoreJsonBudget {
  return { bytes: 0, nodes: 0 };
}

/** extension payload を public SerializedJsonValue と同じ実データだけに制限する。 */
export function validateRestoreJsonPayload(
  value: unknown,
  fieldName: string,
  budget: RestoreJsonBudget,
  depth = 0,
): CoreResult<SerializedJsonValue> {
  try {
    return validateRestoreJsonPayloadInner(value, fieldName, budget, depth);
  } catch {
    return coreError("state.invalidShape", `${fieldName} must be JSON-compatible data`);
  }
}

function validateRestoreJsonPayloadInner(
  value: unknown,
  fieldName: string,
  budget: RestoreJsonBudget,
  depth: number,
): CoreResult<SerializedJsonValue> {
  budget.nodes += 1;
  if (budget.nodes > MAX_RESTORE_JSON_PAYLOAD_NODES || depth > MAX_RESTORE_JSON_PAYLOAD_DEPTH) {
    return coreError("state.invalidShape", `${fieldName} exceeds the JSON payload budget`);
  }
  if (value === null || typeof value === "boolean") {
    return okResult(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return coreError("state.invalidShape", `${fieldName} must be finite JSON data`);
    }
    return okResult(value);
  }
  if (typeof value === "string") {
    const string = validateRestoreJsonString(value, fieldName, budget);
    if (!string.ok) {
      return string;
    }
    return okResult(string.value);
  }
  if (Array.isArray(value)) {
    const array = cloneRestoreJsonArray(value, fieldName, budget);
    if (!array.ok) {
      return array;
    }
    const clone: SerializedJsonValue[] = [];
    for (let index = 0; index < array.value.length; index += 1) {
      const item = validateRestoreJsonPayload(array.value[index], `${fieldName}[${index}]`, budget, depth + 1);
      if (!item.ok) {
        return item;
      }
      clone.push(item.value);
    }
    return okResult(Object.freeze(clone));
  }
  if (typeof value === "object" && value !== null) {
    const object = cloneRestoreJsonObject(value, fieldName, budget);
    if (!object.ok) {
      return object;
    }
    const clone = Object.create(null) as Record<string, SerializedJsonValue>;
    const sortedKeys = Object.keys(object.value).sort(compareUtf8Lexicographic);
    for (const key of sortedKeys) {
      const keyContract = validateRestoreJsonString(key, `${fieldName} object key`, budget);
      if (!keyContract.ok) {
        return keyContract;
      }
      const child = object.value[key];
      const item = validateRestoreJsonPayload(child, `${fieldName}.${key}`, budget, depth + 1);
      if (!item.ok) {
        return item;
      }
      clone[key] = item.value;
    }
    return okResult(Object.freeze(clone));
  }

  return coreError("state.invalidShape", `${fieldName} must be JSON-compatible data`);
}

/** extension state の runnerId など、payload 外の文字列にも同じ単体 byte budget を適用する。 */
export function isRestoreJsonStringWithinSingleValueBudget(value: string): boolean {
  const byteLength = validateUtf8StringByteLength(value);
  return byteLength.ok && byteLength.value <= MAX_RESTORE_JSON_STRING_BYTES;
}

/** JSON 文字列として不安定な lone surrogate を restore payload から除外する。 */
export function containsLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}

function validateRestoreJsonString(
  value: string,
  fieldName: string,
  budget: RestoreJsonBudget,
): CoreResult<string> {
  const byteLength = validateUtf8StringByteLength(value);
  if (!byteLength.ok) {
    return coreError("state.invalidShape", `${fieldName} must not contain lone surrogate code units`);
  }
  if (byteLength.value > MAX_RESTORE_JSON_STRING_BYTES) {
    return coreError("state.invalidShape", `${fieldName} exceeds the JSON string budget`);
  }
  budget.bytes += byteLength.value;
  if (budget.bytes > MAX_RESTORE_JSON_PAYLOAD_BYTES) {
    return coreError("state.invalidShape", `${fieldName} exceeds the JSON payload budget`);
  }
  return okResult(value);
}

function validateUtf8StringByteLength(value: string): CoreResult<number> {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return coreError("state.invalidShape", "string must not contain lone surrogate code units");
      }
      const codePoint = ((code - 0xd800) * 0x400) + (next - 0xdc00) + 0x10000;
      bytes += utf8ByteLengthOfCodePoint(codePoint);
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return coreError("state.invalidShape", "string must not contain lone surrogate code units");
    }
    bytes += utf8ByteLengthOfCodePoint(code);
    if (bytes > MAX_RESTORE_JSON_STRING_BYTES) {
      return okResult(bytes);
    }
  }

  return okResult(bytes);
}

function utf8ByteLengthOfCodePoint(codePoint: number): number {
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

function cloneRestoreJsonArray(
  value: unknown[],
  fieldName: string,
  budget: RestoreJsonBudget,
): CoreResult<readonly unknown[]> {
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return coreError("state.invalidShape", `${fieldName} must be a dense JSON array`);
    }
    const length = value.length;
    if (
      !Number.isSafeInteger(length)
      || length < 0
      || length > MAX_RESTORE_JSON_PAYLOAD_NODES
      || Object.getOwnPropertySymbols(value).length > 0
    ) {
      return coreError("state.invalidShape", `${fieldName} must be a dense JSON array`);
    }
    if (length + budget.nodes > MAX_RESTORE_JSON_PAYLOAD_NODES) {
      return coreError("state.invalidShape", `${fieldName} exceeds the JSON payload budget`);
    }
    const propertyNames = Object.getOwnPropertyNames(value);
    if (propertyNames.length > length + 1) {
      return coreError("state.invalidShape", `${fieldName} must be a dense JSON array`);
    }
    const clone: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return coreError("state.invalidShape", `${fieldName} must be a dense JSON array`);
      }
      clone.push(descriptor.value);
    }
    return okResult(Object.freeze(clone));
  } catch {
    return coreError("state.invalidShape", `${fieldName} must be a dense JSON array`);
  }
}

/** extension payload object を getter / prototype 汚染なしの data property だけに制限する。 */
function cloneRestoreJsonObject(
  value: object,
  fieldName: string,
  budget: RestoreJsonBudget,
): CoreResult<Record<string, unknown>> {
  try {
    if (!isPlainObjectContainer(value)) {
      return coreError("state.invalidShape", `${fieldName} must be a plain JSON object`);
    }
    const propertyNames = Object.getOwnPropertyNames(value);
    if (propertyNames.length + budget.nodes > MAX_RESTORE_JSON_PAYLOAD_NODES) {
      return coreError("state.invalidShape", `${fieldName} exceeds the JSON payload budget`);
    }
    const clone = Object.create(null) as Record<string, unknown>;
    for (const key of propertyNames) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return coreError("state.invalidShape", `${fieldName} must contain only enumerable data properties`);
      }
      clone[key] = descriptor.value;
    }
    return okResult(Object.freeze(clone));
  } catch {
    return coreError("state.invalidShape", `${fieldName} must be a plain JSON object`);
  }
}
