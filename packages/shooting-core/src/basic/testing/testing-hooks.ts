import { createShootingCoreWithTestingHooksForInternalTest } from "../core.ts";
import type { ShootingCore } from "../api-types.ts";
import { registerHeadlessDebugStateSerializerForTest } from "./debug-state.ts";
import { assertInternalTestHooksEnabled } from "../instrumentation/test-hooks-guard.ts";

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
  assertInternalTestHooksEnabled("create a hook-enabled shooting core");
  return createShootingCoreWithTestingHooksForInternalTest(coreVersion, {
    ...hooks,
    registerHeadlessDebugStateSerializer: registerHeadlessDebugStateSerializerForTest,
  });
}
