import { createDanmakuCoreWithTestingHooksForInternalTest } from "../core.ts";
import type { DanmakuCore } from "../api-types.ts";
import type { DanmakuCoreFeature } from "../extension/feature-module.ts";
import { registerHeadlessDebugStateSerializerForTest } from "./debug-state.ts";
import { assertInternalTestHooksEnabled } from "../instrumentation/test-hooks-guard.ts";

type InternalStageSessionTestingHooks = NonNullable<
  Parameters<typeof createDanmakuCoreWithTestingHooksForInternalTest>[1]
>;
type StageSessionTestingHooks = Omit<InternalStageSessionTestingHooks, "registerHeadlessDebugStateSerializer">;

/**
 * Core 内部テスト用に fault-injection 付き Core を作る。
 *
 * hook の消費状態は stage session ごとに作られるため、同一プロセス内の別 session へ
 * 影響しない。root package export からは公開しない。
 */
export function createDanmakuCoreWithTestingHooksForTest(
  coreVersion: string,
  hooks: StageSessionTestingHooks,
  features: readonly DanmakuCoreFeature[] = [],
): DanmakuCore {
  assertInternalTestHooksEnabled("create a hook-enabled danmaku-kit core");
  return createDanmakuCoreWithTestingHooksForInternalTest(coreVersion, {
    ...hooks,
    registerHeadlessDebugStateSerializer: registerHeadlessDebugStateSerializerForTest,
  }, features);
}
