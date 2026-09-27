import type { CoreErrorCode } from "@shooting-sample/shooting-core";

import type { ContentSourceContext } from "./content-source-index.ts";
import type { ValidateContentDiagnosticCode } from "./diagnostic-codes.ts";
import type { ParseOrSchemaContentDiagnostic } from "./types.ts";
import type { YamlSourceSpan } from "./yaml-source.ts";

/** YAML value 変換や source file 読み込みなど、位置を特定できない失敗を document root の parse 診断へ正規化する。 */
export function createRootParseDiagnostic(
  path: string,
  code: ValidateContentDiagnosticCode,
  message: string,
): ParseOrSchemaContentDiagnostic {
  return Object.freeze({
    kind: "parse",
    code,
    severity: "error",
    message,
    path,
    line: 1,
    column: 1,
    schemaPath: "$",
  });
}

/** validate-content が作る schema 診断の code（自分の code と、loader が Core と同じ分類で出す Core の code）。 */
export type OwnSchemaDiagnosticCode = ValidateContentDiagnosticCode | CoreErrorCode;

/** 空documentなどAST rangeがない場合に使う安定したfallback位置。 */
export function defaultSpan(path: string): YamlSourceSpan {
  return Object.freeze({ path, line: 1, column: 1 });
}

/** source contextをschema diagnosticのpaired end spanへ投影する。 */
export function freezeSchemaDiagnostic(
  code: string,
  severity: "error" | "warning",
  message: string,
  schemaPath: string,
  context: ContentSourceContext,
): ParseOrSchemaContentDiagnostic {
  const base = {
    kind: "schema",
    code,
    severity,
    message,
    path: context.span.path,
    line: context.span.line,
    column: context.span.column,
    schemaPath,
    sourceId: context.sourceId,
  } as const;
  if (context.span.endLine !== undefined && context.span.endColumn !== undefined) {
    return Object.freeze({ ...base, endLine: context.span.endLine, endColumn: context.span.endColumn });
  }
  return Object.freeze(base);
}
