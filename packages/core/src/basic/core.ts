import type { DanmakuCore, DanmakuCoreOptions } from "./api-types.ts";
import { createLoadedContentIndex } from "./content/content-index.ts";
import type { GameDefinition } from "./content/types.ts";
import { validateGameDefinitionWithWarnings } from "./content/validation.ts";
import { resolveFeatureModules, selectEnabledFeatureModules } from "./extension/feature-module.ts";
import type { AnyFeatureModule, DanmakuCoreFeature, LoadedFeature } from "./extension/feature-module.ts";
import type { StageSessionTestingHookOptions } from "./instrumentation/stage-session-testing-hooks.ts";
import { assertInternalTestHooksEnabled } from "./instrumentation/test-hooks-guard.ts";
import { coreError, errorResult, okResult } from "./result.ts";
import type { CoreError } from "./result.ts";
import { createLoadedGame } from "./session/loaded-game.ts";
import { deepFreezePlainData } from "./shared/immutable.ts";

/**
 * Core を生成する。
 *
 * 引数は `DanmakuCoreOptions`（文字列なら `coreVersion`）。`features` には optional feature の package entry が公開する feature を
 * 渡し、`GameDefinition.enabledFeatures` はここで渡した feature だけを受け付ける。Phaser / Vite / DOM には依存せず、Node の test
 * runner だけで load / startStage / tick を検証できる。
 */
export function createDanmakuCore(options: string | DanmakuCoreOptions = {}): DanmakuCore {
  const resolved = typeof options === "string" ? { coreVersion: options } : options ?? {};
  return createDanmakuCoreInternal(resolved.coreVersion ?? "0.0.0", {}, resolveFeatureModules(resolved.features ?? []));
}

/**
 * Core の fault-injection 付きインスタンスを作る内部テスト専用 API。
 *
 * root package export には出さず、通常 runtime からは参照できない形に留める。
 */
export function createDanmakuCoreWithTestingHooksForInternalTest(
  coreVersion = "0.0.0",
  testingHooks: StageSessionTestingHookOptions = {},
  features: readonly DanmakuCoreFeature[] = [],
): DanmakuCore {
  assertInternalTestHooksEnabled("create a hook-enabled danmaku-kit core");
  return createDanmakuCoreInternal(coreVersion, testingHooks, resolveFeatureModules(features));
}

function createDanmakuCoreInternal(
  coreVersion: string,
  testingHooks: StageSessionTestingHookOptions,
  registeredFeatures: readonly AnyFeatureModule[],
): DanmakuCore {
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
      // feature の規則は basic の検証に通った definition だけに、canonical feature order で当てる。
      const features: LoadedFeature[] = [];
      const featureErrors: CoreError[] = [];
      const warnings = [...basic.warnings];
      for (const module of selectEnabledFeatureModules(registeredFeatures, validated.enabledFeatures)) {
        const content = module.loadContent(validated);
        if (!content.ok) {
          featureErrors.push(...content.errors);
          continue;
        }
        warnings.push(...content.warnings);
        features.push(Object.freeze({ module, content: content.value }));
      }
      if (featureErrors.length > 0) {
        return errorResult(featureErrors);
      }
      return okResult(createLoadedGame(createLoadedContentIndex(validated), coreVersion, testingHooks, features), warnings);
    },
  });
}
