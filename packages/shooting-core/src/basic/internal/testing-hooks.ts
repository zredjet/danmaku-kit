import { createShootingCoreWithTestingHooksForInternalTest } from "../core.ts";
import type { ShootingCore } from "../core.ts";
import { registerHeadlessDebugStateSerializerForTest } from "../testing/debug-state.ts";

const INTERNAL_TEST_HOOKS_ENV = "SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS";

type InternalStageSessionTestingHooks = NonNullable<
  Parameters<typeof createShootingCoreWithTestingHooksForInternalTest>[1]
>;
type StageSessionTestingHooks = Omit<InternalStageSessionTestingHooks, "registerHeadlessDebugStateSerializer">;

/**
 * Core 内部テスト用に fault-injection 付き Core を作る。
 *
 * hook の消費状態は stage session ごとに作られるため、同一プロセス内の別 session へ
 * 影響しない。root package export からは公開しない。
 */
export function createShootingCoreWithTestingHooksForTest(
  coreVersion: string,
  hooks: StageSessionTestingHooks,
): ShootingCore {
  assertInternalTestHooksEnabled();
  return createShootingCoreWithTestingHooksForInternalTest(coreVersion, {
    ...hooks,
    registerHeadlessDebugStateSerializer: registerHeadlessDebugStateSerializerForTest,
  });
}

function assertInternalTestHooksEnabled(): void {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (env?.[INTERNAL_TEST_HOOKS_ENV] !== "1") {
    throw new Error(`${INTERNAL_TEST_HOOKS_ENV}=1 is required to create a hook-enabled shooting core`);
  }
}
