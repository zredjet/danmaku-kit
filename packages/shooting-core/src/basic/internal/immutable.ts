/**
 * 値を deep clone し、object / array を再帰的に freeze する。
 *
 * load 済み content、GameFrame、GameEvent が呼び出し元の mutation に影響されないようにする。
 */
export function deepFreezeClone<T>(value: T): T {
  return cloneInternalData(value, new WeakSet<object>()) as T;
}

type PlainDataBudget = Readonly<{
  maxArrayLength: number;
  maxDepth: number;
  maxNodes: number;
  maxObjectKeys: number;
  maxStringLength: number;
}>;

const DEFAULT_PLAIN_DATA_BUDGET: PlainDataBudget = Object.freeze({
  maxArrayLength: 10_000,
  maxDepth: 48,
  maxNodes: 100_000,
  maxObjectKeys: 128,
  maxStringLength: 8_192,
});

type CloneContext = {
  budget: PlainDataBudget;
  nodeCount: number;
  seen: WeakSet<object>;
};

/**
 * public API 境界で受け取った unknown 値を JSON 互換の plain data として clone / freeze する。
 *
 * getter、Proxy、prototype 継承 property を validation の中へ持ち込むと例外漏れや
 * clone 後の値消失につながるため、own data property だけを許可する。巨大入力による
 * validation 前の CPU / memory 消費を避けるため、構造サイズにも上限を設ける。
 */
export function deepFreezePlainData(value: unknown): unknown | null {
  try {
    return clonePlainData(value, { budget: DEFAULT_PLAIN_DATA_BUDGET, nodeCount: 0, seen: new WeakSet<object>() }, 0);
  } catch {
    return null;
  }
}

function clonePlainData(value: unknown, context: CloneContext, depth: number): unknown {
  registerNode(context, depth);
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && value.length > context.budget.maxStringLength) {
      throw new TypeError("Plain data strings must stay within budget");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Plain data number must be finite");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Plain data must not contain unsupported primitives");
  }
  if (context.seen.has(value)) {
    throw new TypeError("Plain data must not contain cycles");
  }
  context.seen.add(value);
  try {
    if (Array.isArray(value)) {
      return clonePlainArray(value, context, depth + 1);
    }
    return clonePlainObject(value as Record<string, unknown>, context, depth + 1);
  } finally {
    context.seen.delete(value);
  }
}

function clonePlainArray(value: readonly unknown[], context: CloneContext, depth: number): readonly unknown[] {
  if (value.length > context.budget.maxArrayLength) {
    throw new TypeError("Plain data arrays must stay within budget");
  }
  const keys = Object.keys(value);
  if (keys.length > context.budget.maxArrayLength) {
    throw new TypeError("Plain data arrays must stay within budget");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Plain data must not contain symbol keys");
  }
  const clone: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Plain data arrays must be dense data arrays");
    }
    clone.push(clonePlainData(descriptor.value, context, depth));
  }
  for (const key of keys) {
    if (!isArrayIndexKey(key, value.length)) {
      throw new TypeError("Plain data arrays must not contain custom properties");
    }
  }
  return Object.freeze(clone);
}

function clonePlainObject(
  value: Record<string, unknown>,
  context: CloneContext,
  depth: number,
): Readonly<Record<string, unknown>> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Plain data objects must use Object.prototype or null");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Plain data must not contain symbol keys");
  }

  const clone = Object.create(null) as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.length > context.budget.maxObjectKeys) {
    throw new TypeError("Plain data objects must stay within budget");
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Plain data objects must contain only enumerable data properties");
    }
    Object.defineProperty(clone, key, {
      configurable: false,
      enumerable: true,
      value: clonePlainData(descriptor.value, context, depth),
      writable: false,
    });
  }
  return Object.freeze(clone);
}

function isArrayIndexKey(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function registerNode(context: CloneContext, depth: number): void {
  if (depth > context.budget.maxDepth) {
    throw new TypeError("Plain data nesting must stay within budget");
  }
  context.nodeCount += 1;
  if (context.nodeCount > context.budget.maxNodes) {
    throw new TypeError("Plain data node count must stay within budget");
  }
}

function cloneInternalData(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    throw new TypeError("Internal immutable data must not contain cycles");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => cloneInternalData(item, seen)));
    }

    const clone = {} as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Internal immutable data must use enumerable data properties");
      }
      Object.defineProperty(clone, key, {
        configurable: false,
        enumerable: true,
        value: cloneInternalData(descriptor.value, seen),
        writable: false,
      });
    }
    return Object.freeze(clone);
  } finally {
    seen.delete(value);
  }
}
