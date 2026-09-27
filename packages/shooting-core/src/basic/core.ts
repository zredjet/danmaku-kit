import type { ShootingCore, ShootingCoreOptions } from "./api-types.ts";
import { createLoadedContentIndex } from "./content/content-index.ts";
import type { GameDefinition } from "./content/types.ts";
import { validateGameDefinitionWithWarnings } from "./content/validation.ts";
import { resolveFeatureModules, selectEnabledFeatureModules } from "./extension/feature-module.ts";
import type { AnyFeatureModule, ShootingCoreFeature } from "./extension/feature-module.ts";
import type { StageSessionTestingHookOptions } from "./instrumentation/stage-session-testing-hooks.ts";
import { assertInternalTestHooksEnabled } from "./instrumentation/test-hooks-guard.ts";
import { coreError, errorResult, okResult } from "./result.ts";
import { createLoadedGame } from "./session/loaded-game.ts";
import { deepFreezePlainData } from "./shared/immutable.ts";

/**
 * Core を生成する。
 *
 * 引数は `ShootingCoreOptions`（文字列なら `coreVersion`）。`features` には optional feature の package entry が公開する feature を
 * 渡し、`GameDefinition.enabledFeatures` はここで渡した feature だけを受け付ける。Phaser / Vite / DOM には依存せず、Node の test
 * runner だけで load / startStage / tick を検証できる。
 */
export function createShootingCore(options: string | ShootingCoreOptions = {}): ShootingCore {
  const resolved = typeof options === "string" ? { coreVersion: options } : options;
  return createShootingCoreInternal(resolved.coreVersion ?? "0.0.0", {}, resolveFeatureModules(resolved.features ?? []));
}

/**
 * Core の fault-injection 付きインスタンスを作る内部テスト専用 API。
 *
 * root package export には出さず、通常 runtime からは参照できない形に留める。
 */
export function createShootingCoreWithTestingHooksForInternalTest(
  coreVersion = "0.0.0",
  testingHooks: StageSessionTestingHookOptions = {},
  features: readonly ShootingCoreFeature[] = [],
): ShootingCore {
  assertInternalTestHooksEnabled("create a hook-enabled shooting core");
  return createShootingCoreInternal(coreVersion, testingHooks, resolveFeatureModules(features));
}

function createShootingCoreInternal(
  coreVersion: string,
  testingHooks: StageSessionTestingHookOptions,
  registeredFeatures: readonly AnyFeatureModule[],
): ShootingCore {
  const registeredFeatureNames = registeredFeatures.map((module) => module.feature);
  return Object.freeze({
    coreVersion,
    load(definition) {
      const plainDefinition = deepFreezePlainData(definition);
      if (!plainDefinition) {
        return coreError("definition.invalidShape", "GameDefinition must be JSON-compatible plain data");
      }
      const basic = validateGameDefinitionWithWarnings(plainDefinition, registeredFeatureNames);
      if (basic.errors.length > 0) {
        return errorResult(basic.errors);
      }
      const validated = plainDefinition as GameDefinition;
      const features = selectEnabledFeatureModules(registeredFeatures, validated.enabledFeatures);
      // feature の規則は basic の検証に通った definition だけに、canonical feature order で当てる。
      const featureDiagnostics = features.map((module) => module.validateContent(validated));
      const featureErrors = featureDiagnostics.flatMap((diagnostics) => diagnostics.errors);
      if (featureErrors.length > 0) {
        return errorResult(featureErrors);
      }
      return okResult(
        createLoadedGame(createLoadedContentIndex(validated), coreVersion, testingHooks, features),
        [...basic.warnings, ...featureDiagnostics.flatMap((diagnostics) => diagnostics.warnings)],
      );
    },
  });
}
