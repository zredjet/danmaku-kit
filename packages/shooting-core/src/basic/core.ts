import type { ShootingCore } from "./api-types.ts";
import { createLoadedContentIndex } from "./content/content-index.ts";
import type { GameDefinition } from "./content/types.ts";
import { validateGameDefinition } from "./content/validation.ts";
import type { StageSessionTestingHookOptions } from "./internal/stage-session-testing-hooks.ts";
import { assertInternalTestHooksEnabled } from "./internal/test-hooks-guard.ts";
import { coreError, errorResult, okResult } from "./result.ts";
import { createLoadedGame } from "./session/loaded-game.ts";
import { deepFreezePlainData } from "./shared/immutable.ts";

/**
 * Core minimum 実装を生成する。
 *
 * Phase 1A では Phaser / Vite / DOM に依存せず、Node の test runner だけで
 * load / startStage / tick を検証できることを優先している。
 */
export function createShootingCore(coreVersion = "0.0.0"): ShootingCore {
  return createShootingCoreInternal(coreVersion, {});
}

/**
 * Core の fault-injection 付きインスタンスを作る内部テスト専用 API。
 *
 * root package export には出さず、通常 runtime からは参照できない形に留める。
 */
export function createShootingCoreWithTestingHooksForInternalTest(
  coreVersion = "0.0.0",
  testingHooks: StageSessionTestingHookOptions = {},
): ShootingCore {
  assertInternalTestHooksEnabled("create a hook-enabled shooting core");
  return createShootingCoreInternal(coreVersion, testingHooks);
}

function createShootingCoreInternal(
  coreVersion: string,
  testingHooks: StageSessionTestingHookOptions,
): ShootingCore {
  return Object.freeze({
    coreVersion,
    load(definition) {
      const plainDefinition = deepFreezePlainData(definition);
      if (!plainDefinition) {
        return coreError("definition.invalidShape", "GameDefinition must be JSON-compatible plain data");
      }
      const errors = validateGameDefinition(plainDefinition);
      if (errors.length > 0) {
        return errorResult(errors);
      }
      return okResult(createLoadedGame(createLoadedContentIndex(plainDefinition as GameDefinition), coreVersion, testingHooks));
    },
  });
}
