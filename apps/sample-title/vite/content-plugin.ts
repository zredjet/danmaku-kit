import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  formatValidateContentHuman,
  loadValidatedGameDefinition,
  type ValidateContentSourcePaths,
} from "@shooting-sample/validate-content";
import type { Plugin, ViteDevServer } from "vite";

import type { AssetManifest as RuntimeAssetManifest } from "../src/runtime/assets/asset-manifest.ts";

/** browser source が検証済み `GameDefinition` を default import し、asset manifest を `assetManifest` として import する virtual module の ID。 */
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
 * build では同じ file を watch 対象に登録し、`vite build --watch` が content の変更で再 build するようにする。
 */
export function sampleTitleContentPlugin(paths: ValidateContentSourcePaths): Plugin {
  let isBuild = false;
  return {
    name: "sample-title-content",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    resolveId(id) {
      return id === GAME_DEFINITION_MODULE_ID ? RESOLVED_GAME_DEFINITION_MODULE_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_GAME_DEFINITION_MODULE_ID) {
        return null;
      }
      if (isBuild) {
        // validation error で build が止まっても、content を直したときに watch mode が再 build できるよう先に登録する。
        for (const file of await listContentSourcePaths(paths)) {
          this.addWatchFile(file);
        }
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

/**
 * content を検証し、成功時は `GameDefinition` を default export、検証済みの asset manifest を `assetManifest` として export する
 * module source を返す。manifest は runtime の型へ代入して、validate-content と app の型のずれを型検査で検出する。
 */
export async function createGameDefinitionModule(paths: ValidateContentSourcePaths): Promise<GameDefinitionModule> {
  const loaded = await loadValidatedGameDefinition(paths);
  const report = formatValidateContentHuman(loaded.runResult.output);
  if (!loaded.ok) {
    return Object.freeze({ ok: false, error: report });
  }
  const assetManifest: RuntimeAssetManifest = loaded.assetManifest;
  return Object.freeze({
    ok: true,
    code: `export default ${JSON.stringify(loaded.definition)};\nexport const assetManifest = ${JSON.stringify(assetManifest)};\n`,
    warning: loaded.runResult.output.diagnostics.length > 0 ? report : null,
  });
}

/** dev server の watcher が通知した file が、game-definition file か content root 配下なら true を返す。 */
export function isContentSourceFile(paths: ValidateContentSourcePaths, file: string): boolean {
  if (path.resolve(file) === path.resolve(paths.gameDefinitionPath)) {
    return true;
  }
  const relative = path.relative(paths.contentRoot, file);
  // `..notes.yaml` のように `..` で始まる名前は content root の中なので、親 directory を指す `..` の segment だけを外と判定する。
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

/**
 * build の watch mode に登録する path を返す。game-definition file、content root、その配下の全 file と directory を含む。
 *
 * content root を読めない場合は game-definition file だけを返し、読めない理由は validation の diagnostic に任せる。
 */
export async function listContentSourcePaths(paths: ValidateContentSourcePaths): Promise<readonly string[]> {
  let contentPaths: string[];
  try {
    const entries = await readdir(paths.contentRoot, { recursive: true, withFileTypes: true });
    contentPaths = [paths.contentRoot, ...entries.map((entry) => path.join(entry.parentPath, entry.name))];
  } catch {
    contentPaths = [];
  }
  return Object.freeze([paths.gameDefinitionPath, ...contentPaths.sort()]);
}

function reloadGameDefinitionModule(server: ViteDevServer): void {
  const client = server.environments.client;
  const module = client.moduleGraph.getModuleById(RESOLVED_GAME_DEFINITION_MODULE_ID);
  if (module) {
    client.moduleGraph.invalidateModule(module);
  }
  client.hot.send({ type: "full-reload" });
}
