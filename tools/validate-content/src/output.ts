import type { ValidateContentToolDiagnosticCode } from "./diagnostic-codes.ts";
import { normalizeDiagnostics } from "./diagnostic-normalization.ts";
import type {
  ContentDiagnostic,
  ContentDiagnosticSummary,
  ToolContentDiagnostic,
  ValidationContentDiagnostic,
  ValidateContentJsonOutput,
  ValidateContentRunResult,
} from "./types.ts";

/**
 * schema / reference validation の診断から CLI 実行結果を生成する。
 *
 * error が1件以上なら exit code 1、warning / info だけなら exit code 0 とする。
 * runtime で不正な診断を受け取った場合は成功扱いせず、tool error の exit code 2 へ変換する。
 * 診断は公開 field だけへ投影して canonical order で freeze し、呼び出し元 mutation と未知 field を遮断する。
 */
export function createValidationRunResult(
  contentRoot: string,
  diagnostics: readonly ValidationContentDiagnostic[],
): ValidateContentRunResult {
  if (typeof contentRoot !== "string") {
    return createOwnToolErrorRunResult("", "tool.invalidInput", "contentRoot must be a string");
  }
  const normalized = normalizeDiagnostics(diagnostics);
  if (!normalized.ok) {
    return createOwnToolErrorRunResult(contentRoot, "tool.invalidDiagnostic", normalized.message);
  }
  const toolDiagnostic = normalized.value.find((diagnostic) => diagnostic.kind === "tool");
  if (toolDiagnostic) {
    return createToolErrorRunResult(contentRoot, toolDiagnostic.code, toolDiagnostic.message);
  }

  const output = createJsonOutput(contentRoot, normalized.value as readonly ValidationContentDiagnostic[]);
  if (output.ok) {
    return Object.freeze({ exitCode: 0, output });
  }
  return Object.freeze({ exitCode: 1, output });
}

/**
 * validate-content 自身の tool error。code を `VALIDATE_CONTENT_DIAGNOSTIC_CODES` の tool の code に限る（公開の
 * `createToolErrorRunResult()` は、受け取った tool 診断の code をそのまま出し直すため string を受ける）。
 */
export function createOwnToolErrorRunResult(
  contentRoot: string,
  code: ValidateContentToolDiagnosticCode,
  message: string,
): ValidateContentRunResult {
  return createToolErrorRunResult(contentRoot, code, message);
}

/**
 * file read、parser 起動、予期しない例外など、validation を完了できない失敗を生成する。
 * validation error と区別するため、diagnostic の severity にかかわらず exit code 2 を返す。
 */
export function createToolErrorRunResult(
  contentRoot: string,
  code: string,
  message: string,
): ValidateContentRunResult {
  const safeContentRoot = typeof contentRoot === "string" ? contentRoot : "";
  const diagnostic: ToolContentDiagnostic = Object.freeze({
    kind: "tool",
    code: typeof code === "string" ? code : "tool.invalidInput",
    severity: "error",
    message: typeof message === "string" ? message : "Tool error message must be a string",
  });
  const output = Object.freeze({
    schemaVersion: "1" as const,
    contentRoot: safeContentRoot,
    ok: false as const,
    diagnostics: Object.freeze([diagnostic]),
    summary: Object.freeze({ errors: 1, warnings: 0, infos: 0 }),
  });
  return Object.freeze({ exitCode: 2, output });
}

/** immutable JSON output と severity 集計を構築する。 */
function createJsonOutput(
  contentRoot: string,
  diagnostics: readonly ContentDiagnostic[],
): ValidateContentJsonOutput {
  const frozenDiagnostics = Object.freeze([...diagnostics]);
  const summary = summarizeDiagnostics(frozenDiagnostics);
  if (summary.errors === 0) {
    return Object.freeze({
      schemaVersion: "1" as const,
      contentRoot,
      ok: true as const,
      diagnostics: frozenDiagnostics,
      summary,
    });
  }
  return Object.freeze({
    schemaVersion: "1" as const,
    contentRoot,
    ok: false as const,
    diagnostics: frozenDiagnostics,
    summary,
  });
}

/** severity ごとの件数を数え、JSON output と human output で共有する。 */
function summarizeDiagnostics(diagnostics: readonly ContentDiagnostic[]): ContentDiagnosticSummary {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const diagnostic of diagnostics) {
    switch (diagnostic.severity) {
      case "error":
        errors += 1;
        break;
      case "warning":
        warnings += 1;
        break;
      case "info":
        infos += 1;
        break;
    }
  }
  return Object.freeze({ errors, warnings, infos });
}
