const ID_SUFFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ASSET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** namespace prefix を含む content ID の最大長。 */
export const MAX_IDENTIFIER_LENGTH = 128;

/** asset key の最大長。 */
export const MAX_ASSET_KEY_LENGTH = 128;

/** namespace 付き ID が Core 全体の ID 規則を満たすか判定する。 */
export function isNamespacedId(value: string, namespace: string): boolean {
  const prefix = `${namespace}.`;
  const suffix = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  return value.length <= MAX_IDENTIFIER_LENGTH && suffix.length > 0 && isSafeIdentifierSuffix(suffix);
}

/** namespace prefix を除いた ID suffix が安全な形式か判定する。 */
export function isSafeIdentifierSuffix(value: string): boolean {
  return value.length > 0 && ID_SUFFIX_PATTERN.test(value) && !value.includes("..");
}

/** asset manifest と asset 参照で共通利用する key 規則。 */
export function isSafeAssetKey(value: string): boolean {
  return value.length <= MAX_ASSET_KEY_LENGTH && ASSET_KEY_PATTERN.test(value) && !value.includes("..");
}
