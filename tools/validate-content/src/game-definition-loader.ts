import type { GameDefinition } from "@shooting-sample/shooting-core";

import { createNodeContentFileSystem, type ContentFileSystem } from "./content-file-system.ts";
import { loadContentSource, type LoadContentSourceResult } from "./content-loader.ts";
import { validateContentDefinition } from "./core-diagnostic-adapter.ts";
import { createToolErrorRunResult, createValidationRunResult } from "./output.ts";
import type { ValidateContentRunResult } from "./types.ts";

/** validate-content が読む game-definition file と content root の path。 */
export type ValidateContentSourcePaths = Readonly<{
  gameDefinitionPath: string;
  contentRoot: string;
}>;

/**
 * content の検証結果と、検証に通った `GameDefinition`。
 *
 * `ok: true` になるのは `runResult.exitCode` が 0 のときだけで、`definition` は Core の `load()` を通った
 * plain data を呼び出しごとに新しく組み立てたものとする。warning / info は `runResult` の diagnostics に残る。
 */
export type LoadValidatedGameDefinitionResult =
  | Readonly<{ ok: true; definition: GameDefinition; runResult: ValidateContentRunResult }>
  | Readonly<{ ok: false; runResult: ValidateContentRunResult }>;

/** filesystem と content loader の差し替え口。CLI test が使い、public export には含めない。 */
export type GameDefinitionLoaderDependencies = Readonly<{
  fileSystem?: ContentFileSystem;
  loadSource?: (
    gameDefinitionPath: string,
    contentRoot: string,
    fileSystem: ContentFileSystem,
  ) => Promise<LoadContentSourceResult>;
}>;

/**
 * game-definition YAML と content root を読み、CLI と同じ診断で検証して `GameDefinition` を返す。
 *
 * file read failure、JS caller からの不正な引数、予期しない例外は throw せず、exit code 2 の tool error として `runResult` に入れる。
 */
export function loadValidatedGameDefinition(
  paths: ValidateContentSourcePaths,
): Promise<LoadValidatedGameDefinitionResult> {
  return loadValidatedGameDefinitionWith(paths, {});
}

/** `loadValidatedGameDefinition()` の本体。filesystem と loader を差し替えられる。 */
export async function loadValidatedGameDefinitionWith(
  paths: ValidateContentSourcePaths,
  dependencies: GameDefinitionLoaderDependencies,
): Promise<LoadValidatedGameDefinitionResult> {
  const sourcePaths = readSourcePaths(paths);
  if (!sourcePaths) {
    return Object.freeze({
      ok: false,
      runResult: createToolErrorRunResult(
        "",
        "tool.invalidInput",
        "paths must be an object with string gameDefinitionPath and contentRoot",
      ),
    });
  }
  const fileSystem = dependencies.fileSystem ?? createNodeContentFileSystem();
  const loadSource = dependencies.loadSource ?? loadContentSource;
  try {
    const loaded = await loadSource(sourcePaths.gameDefinitionPath, sourcePaths.contentRoot, fileSystem);
    const diagnostics = loaded.ok
      ? [...loaded.diagnostics, ...validateContentDefinition(loaded.definition, loaded.sourceIndex)]
      : loaded.diagnostics;
    const runResult = createValidationRunResult(sourcePaths.contentRoot, diagnostics);
    if (loaded.ok && runResult.exitCode === 0) {
      return Object.freeze({ ok: true, definition: loaded.definition as GameDefinition, runResult });
    }
    return Object.freeze({ ok: false, runResult });
  } catch (cause) {
    const runResult = createToolErrorRunResult(
      sourcePaths.contentRoot,
      isFileSystemError(cause) ? "tool.readFailed" : "tool.unexpected",
      safeErrorMessage(cause),
    );
    return Object.freeze({ ok: false, runResult });
  }
}

/** 型の保証がない JS caller の引数から path を一度だけ読み、文字列の組でなければ null を返す。getter の例外も null にする。 */
function readSourcePaths(value: unknown): ValidateContentSourcePaths | null {
  try {
    if (value === null || typeof value !== "object") {
      return null;
    }
    const { gameDefinitionPath, contentRoot } = value as Readonly<Record<string, unknown>>;
    return typeof gameDefinitionPath === "string" && typeof contentRoot === "string"
      ? Object.freeze({ gameDefinitionPath, contentRoot })
      : null;
  } catch {
    return null;
  }
}

/** 例外objectからstackを出力せず、content制作者向けmessageだけを取り出す。 */
export function safeErrorMessage(value: unknown): string {
  return value instanceof Error && value.message.length > 0
    ? value.message
    : "Unexpected validate-content failure";
}

/** Node filesystem errorだけをread failureへ分類する。 */
function isFileSystemError(value: unknown): boolean {
  return value !== null
    && typeof value === "object"
    && "code" in value
    && typeof value.code === "string"
    && "syscall" in value
    && typeof value.syscall === "string";
}
