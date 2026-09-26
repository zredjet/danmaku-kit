/** unknown value を plain object として扱えるか判定する。 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** public API 境界で typo 付き field を silent accept しないための key 検査。 */
export function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

/** nested payload の property は未検証なので読まず、plain object shell かだけを見る。 */
export function isPlainObjectContainer(value: unknown): boolean {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return (prototype === Object.prototype || prototype === null) && Object.getOwnPropertySymbols(value).length === 0;
  } catch {
    return false;
  }
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** union 型の追加時に switch の更新漏れを型エラーとして検出する。 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
