/** Core 内部 test hook と test-only helper を有効化する環境変数。 */
export const INTERNAL_TEST_HOOKS_ENV = "DANMAKU_KIT_ENABLE_INTERNAL_TEST_HOOKS";

/**
 * source import から test hook を誤って有効化しないための最終ガード。
 *
 * `purpose` は error message の `is required to` に続く用途で、呼び出し元ごとの message を保つ。
 */
export function assertInternalTestHooksEnabled(purpose: string): void {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (env?.[INTERNAL_TEST_HOOKS_ENV] !== "1") {
    throw new Error(`${INTERNAL_TEST_HOOKS_ENV}=1 is required to ${purpose}`);
  }
}
