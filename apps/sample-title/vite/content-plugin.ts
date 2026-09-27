import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  formatValidateContentHuman,
  loadValidatedGameDefinition,
  type ValidateContentSourcePaths,
} from "@shooting-sample/validate-content";
import type { GameDefinition } from "@shooting-sample/shooting-core";
import type { Plugin, ViteDevServer } from "vite";

import type { AssetManifest as RuntimeAssetManifest } from "../src/runtime/assets/asset-manifest.ts";
import { CONTENT_UPDATE_EVENT, type ContentUpdate } from "../src/runtime/content/content-update.ts";

/** browser source が検証済み `GameDefinition` を default import し、asset manifest を `assetManifest` として import する virtual module の ID。 */
export const GAME_DEFINITION_MODULE_ID = "virtual:sample-title/game-definition";
const RESOLVED_GAME_DEFINITION_MODULE_ID = `\0${GAME_DEFINITION_MODULE_ID}`;

/** virtual module の source と、Vite へ渡す warning / error の human 形式 diagnostic。 */
export type GameDefinitionModule =
  | Readonly<{ ok: true; code: string; warning: string | null }>
  | Readonly<{ ok: false; error: string }>;

/** 検証済みの content と、Vite へ渡す warning / error の human 形式 diagnostic。 */
export type ValidatedContent =
  | Readonly<{ ok: true; definition: GameDefinition; assetManifest: RuntimeAssetManifest; warning: string | null }>
  | Readonly<{ ok: false; error: string }>;

/**
 * sample title の content を dev server / build 時に validate-content で検証し、`GameDefinition` を virtual module で渡す。
 *
 * validation error は build を失敗させ、dev server の最初の読み込みでは Vite の error overlay に出す。warning / info は Vite の warning
 * にする。browser へ YAML parser と filesystem access を持ち込まないよう、検証済みの plain data だけを module にする。
 * dev server では game-definition と content root の変更で content を検証し直し、結果（`ContentUpdate`）を HMR の custom event で
 * app へ送る（design 19）。page は再読み込みせず、app が今の content と比べて stage の restart や texture の読み直しを決め、検証の error
 * は HUD に出す。module も無効化するので、page を読み込み直せば新しい content になる。page が content を読み込めていない（最初の
 * 読み込みが検証の error だった）間は event を受ける app がないので、page を読み込み直させる。
 * build では同じ file を watch 対象に登録し、`vite build --watch` が content の変更で再 build するようにする。
 */
export function sampleTitleContentPlugin(paths: ValidateContentSourcePaths): Plugin {
  let isBuild = false;
  // page が最後に読み込んだ module が content を渡せたか。渡せていなければ、変更の event を受ける app が動いていない。
  let moduleLoaded = false;
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
      const content = await loadValidatedContent(paths);
      moduleLoaded = content.ok;
      if (!content.ok) {
        return this.error(content.error);
      }
      if (content.warning !== null) {
        this.warn(content.warning);
      }
      return gameDefinitionModuleCode(content);
    },
    configureServer(server) {
      let pending = Promise.resolve();
      const reloadOnContentChange = (file: string): void => {
        if (!isContentSourceFile(paths, file)) {
          return;
        }
        // 続けて届いた変更は順に検証し、app へ送る順を変更の順にそろえる。
        pending = pending.then(async () => {
          invalidateGameDefinitionModule(server);
          const next = await loadValidatedContent(paths);
          if (next.ok && next.warning !== null) {
            server.config.logger.warn(next.warning);
          }
          if (!moduleLoaded) {
            server.environments.client.hot.send({ type: "full-reload" });
            return;
          }
          server.environments.client.hot.send(CONTENT_UPDATE_EVENT, toContentUpdate(next));
        }).catch((error: unknown) => {
          server.config.logger.error(`[sample-title] content hot reload failed: ${String(error)}`);
        });
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
 * module source を返す。
 */
export async function createGameDefinitionModule(paths: ValidateContentSourcePaths): Promise<GameDefinitionModule> {
  const loaded = await loadValidatedContent(paths);
  if (!loaded.ok) {
    return loaded;
  }
  return Object.freeze({ ok: true, code: gameDefinitionModuleCode(loaded), warning: loaded.warning });
}

function gameDefinitionModuleCode(content: Extract<ValidatedContent, { ok: true }>): string {
  return `export default ${JSON.stringify(content.definition)};\nexport const assetManifest = ${JSON.stringify(content.assetManifest)};\n`;
}

/**
 * content を validate-content で検証する。manifest は runtime の型へ代入して、validate-content と app の型のずれを型検査で検出する。
 */
export async function loadValidatedContent(paths: ValidateContentSourcePaths): Promise<ValidatedContent> {
  const loaded = await loadValidatedGameDefinition(paths);
  const report = formatValidateContentHuman(loaded.runResult.output);
  if (!loaded.ok) {
    return Object.freeze({ ok: false, error: report });
  }
  const assetManifest: RuntimeAssetManifest = loaded.assetManifest;
  return Object.freeze({
    ok: true,
    definition: loaded.definition,
    assetManifest,
    warning: loaded.runResult.output.diagnostics.length > 0 ? report : null,
  });
}

/** 検証の結果を app へ送る変更にする。 */
export function toContentUpdate(content: ValidatedContent): ContentUpdate {
  return content.ok
    ? Object.freeze({ kind: "validated", definition: content.definition, assetManifest: content.assetManifest })
    : Object.freeze({ kind: "error", message: content.error });
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

function invalidateGameDefinitionModule(server: ViteDevServer): void {
  const client = server.environments.client;
  const module = client.moduleGraph.getModuleById(RESOLVED_GAME_DEFINITION_MODULE_ID);
  if (module) {
    client.moduleGraph.invalidateModule(module);
  }
}
