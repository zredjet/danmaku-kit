import path from "node:path";

import {
  formatValidateContentHuman,
  loadValidatedGameDefinition,
  type ValidateContentSourcePaths,
} from "@shooting-sample/validate-content";
import type { Plugin, ViteDevServer } from "vite";

/** browser source が検証済み `GameDefinition` を default import する virtual module の ID。 */
export const GAME_DEFINITION_MODULE_ID = "virtual:sample-title/game-definition";
const RESOLVED_GAME_DEFINITION_MODULE_ID = `\0${GAME_DEFINITION_MODULE_ID}`;

/** virtual module の source と、Vite へ渡す warning / error の human 形式 diagnostic。 */
export type GameDefinitionModule =
  | Readonly<{ ok: true; code: string; warning: string | null }>
  | Readonly<{ ok: false; error: string }>;

/**
 * sample title の content を dev server / build 時に validate-content で検証し、`GameDefinition` を virtual module で渡す。
 *
 * validation error は build を失敗させ、dev server では error overlay に出す。warning / info は Vite の warning にする。
 * browser へ YAML parser と filesystem access を持ち込まないよう、検証済みの plain data だけを module にする。
 * dev server では game-definition と content root の変更で module を無効化し、page を再読み込みして stage を最初から始める。
 */
export function sampleTitleContentPlugin(paths: ValidateContentSourcePaths): Plugin {
  return {
    name: "sample-title-content",
    resolveId(id) {
      return id === GAME_DEFINITION_MODULE_ID ? RESOLVED_GAME_DEFINITION_MODULE_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_GAME_DEFINITION_MODULE_ID) {
        return null;
      }
      const module = await createGameDefinitionModule(paths);
      if (!module.ok) {
        return this.error(module.error);
      }
      if (module.warning !== null) {
        this.warn(module.warning);
      }
      return module.code;
    },
    configureServer(server) {
      const reloadOnContentChange = (file: string): void => {
        if (isContentSourceFile(paths, file)) {
          reloadGameDefinitionModule(server);
        }
      };
      server.watcher.add([paths.gameDefinitionPath, paths.contentRoot]);
      server.watcher.on("add", reloadOnContentChange);
      server.watcher.on("change", reloadOnContentChange);
      server.watcher.on("unlink", reloadOnContentChange);
    },
  };
}

/** content を検証し、成功時は `GameDefinition` を default export する module source を返す。 */
export async function createGameDefinitionModule(paths: ValidateContentSourcePaths): Promise<GameDefinitionModule> {
  const loaded = await loadValidatedGameDefinition(paths);
  const report = formatValidateContentHuman(loaded.runResult.output);
  if (!loaded.ok) {
    return Object.freeze({ ok: false, error: report });
  }
  return Object.freeze({
    ok: true,
    code: `export default ${JSON.stringify(loaded.definition)};\n`,
    warning: loaded.runResult.output.diagnostics.length > 0 ? report : null,
  });
}

/** dev server の watcher が通知した file が、game-definition file か content root 配下なら true を返す。 */
export function isContentSourceFile(paths: ValidateContentSourcePaths, file: string): boolean {
  if (path.resolve(file) === path.resolve(paths.gameDefinitionPath)) {
    return true;
  }
  const relative = path.relative(paths.contentRoot, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function reloadGameDefinitionModule(server: ViteDevServer): void {
  const client = server.environments.client;
  const module = client.moduleGraph.getModuleById(RESOLVED_GAME_DEFINITION_MODULE_ID);
  if (module) {
    client.moduleGraph.invalidateModule(module);
  }
  client.hot.send({ type: "full-reload" });
}
