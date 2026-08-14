import type {
  ContentDiagnostic,
  ContentDiagnosticKind,
  ContentDiagnosticSeverity,
  ContentDiagnosticSummary,
  FeatureGateContentDiagnostic,
  ParseOrSchemaContentDiagnostic,
  ReferenceContentDiagnostic,
  ToolContentDiagnostic,
  ValidationContentDiagnostic,
  ValidateContentJsonOutput,
  ValidateContentRunResult,
} from "./types.ts";

const DIAGNOSTIC_KIND_ORDER: Readonly<Record<ContentDiagnosticKind, number>> = Object.freeze({
  parse: 0,
  schema: 1,
  reference: 2,
  featureGate: 3,
  tool: 4,
});
const DIAGNOSTIC_SEVERITY_ORDER: Readonly<Record<ContentDiagnosticSeverity, number>> = Object.freeze({
  error: 0,
  warning: 1,
  info: 2,
});

type NormalizedDiagnosticResult =
  | Readonly<{ ok: true; value: readonly ContentDiagnostic[] }>
  | Readonly<{ ok: false; message: string }>;

type NormalizedSourceSpan = Readonly<{
  path: string;
  line: number;
  column: number;
}> & (
  | Readonly<{ endLine?: never; endColumn?: never }>
  | Readonly<{ endLine: number; endColumn: number }>
);

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
    return createToolErrorRunResult("", "tool.invalidInput", "contentRoot must be a string");
  }
  const normalized = normalizeDiagnostics(diagnostics);
  if (!normalized.ok) {
    return createToolErrorRunResult(contentRoot, "tool.invalidDiagnostic", normalized.message);
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

/** CI / editor integration 用の canonical JSON text を末尾改行付きで生成する。 */
export function formatValidateContentJson(output: ValidateContentJsonOutput): string {
  const normalizedOutput = normalizeOutputForFormatting(output);
  const canonicalOutput = {
    schemaVersion: "1",
    contentRoot: normalizedOutput.contentRoot,
    ok: normalizedOutput.ok,
    diagnostics: normalizedOutput.diagnostics,
    summary: {
      errors: normalizedOutput.summary.errors,
      warnings: normalizedOutput.summary.warnings,
      infos: normalizedOutput.summary.infos,
    },
  };
  return `${JSON.stringify(canonicalOutput, null, 2)}\n`;
}

/** content 制作者向けに、位置、severity、code、message、診断 context と集計を1行ずつ表示する。 */
export function formatValidateContentHuman(output: ValidateContentJsonOutput): string {
  const normalizedOutput = normalizeOutputForFormatting(output);
  const lines = normalizedOutput.diagnostics.map((diagnostic) => formatHumanDiagnostic(diagnostic));
  if (lines.length === 0) {
    lines.push(`Validation passed: ${escapeHumanText(normalizedOutput.contentRoot)}`);
  }
  lines.push(formatHumanSummary(normalizedOutput.summary));
  return `${lines.join("\n")}\n`;
}

/** 公開DTOを直接構築した呼び出し元にも、factoryと同じprojection、集計、順序を適用する。 */
function normalizeOutputForFormatting(value: unknown): ValidateContentJsonOutput {
  try {
    const output = snapshotOwnDataRecord(value);
    if (!output || output.schemaVersion !== "1" || typeof output.contentRoot !== "string") {
      return createToolErrorRunResult("", "tool.invalidOutput", "Validate-content output is invalid").output;
    }
    const normalized = normalizeDiagnostics(output.diagnostics);
    if (!normalized.ok) {
      return createToolErrorRunResult(output.contentRoot, "tool.invalidOutput", normalized.message).output;
    }
    const toolDiagnostics = normalized.value.filter((diagnostic) => diagnostic.kind === "tool");
    if (toolDiagnostics.length > 0) {
      if (toolDiagnostics.length === 1 && normalized.value.length === 1) {
        const toolDiagnostic = toolDiagnostics[0]!;
        return createToolErrorRunResult(output.contentRoot, toolDiagnostic.code, toolDiagnostic.message).output;
      }
      return createToolErrorRunResult(
        output.contentRoot,
        "tool.invalidOutput",
        "Tool diagnostics cannot be mixed with validation diagnostics",
      ).output;
    }
    return createValidationRunResult(
      output.contentRoot,
      normalized.value as readonly ValidationContentDiagnostic[],
    ).output;
  } catch {
    return createToolErrorRunResult("", "tool.invalidOutput", "Validate-content output could not be read safely").output;
  }
}

/** 外部入力を公開診断 field だけへ投影し、canonical order へ揃える。 */
function normalizeDiagnostics(value: unknown): NormalizedDiagnosticResult {
  try {
    if (!Array.isArray(value)) {
      return Object.freeze({ ok: false, message: "diagnostics must be an array" });
    }
    const diagnostics: ContentDiagnostic[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const diagnostic = projectDiagnostic(value[index]);
      if (!diagnostic) {
        return Object.freeze({ ok: false, message: `diagnostics[${index}] is invalid` });
      }
      diagnostics.push(diagnostic);
    }
    diagnostics.sort(compareDiagnostics);
    return Object.freeze({ ok: true, value: Object.freeze(diagnostics) });
  } catch {
    return Object.freeze({ ok: false, message: "diagnostics could not be read safely" });
  }
}

/** kind ごとの必須 field を検証し、追加 property を持たない immutable DTO を返す。 */
function projectDiagnostic(value: unknown): ContentDiagnostic | null {
  const record = snapshotOwnDataRecord(value);
  if (!record || !isDiagnosticKind(record.kind) || !isDiagnosticSeverity(record.severity)) {
    return null;
  }
  if (typeof record.code !== "string" || typeof record.message !== "string") {
    return null;
  }
  const common = {
    code: record.code,
    severity: record.severity,
    message: record.message,
  } as const;

  switch (record.kind) {
    case "parse":
    case "schema": {
      const span = normalizeSourceSpan(record);
      const sourceId = normalizeOptionalString(record.sourceId);
      if (!span || typeof record.schemaPath !== "string" || sourceId === null) {
        return null;
      }
      const diagnostic: ParseOrSchemaContentDiagnostic = {
        kind: record.kind,
        ...common,
        ...span,
        schemaPath: record.schemaPath,
        ...(sourceId === undefined ? {} : { sourceId }),
      };
      return Object.freeze(diagnostic);
    }
    case "reference": {
      const span = normalizeSourceSpan(record);
      const schemaPath = normalizeOptionalString(record.schemaPath);
      const sourceId = normalizeOptionalString(record.sourceId);
      if (
        !span
        || typeof record.referrerId !== "string"
        || typeof record.targetId !== "string"
        || schemaPath === null
        || sourceId === null
      ) {
        return null;
      }
      const diagnostic: ReferenceContentDiagnostic = {
        kind: "reference",
        ...common,
        ...span,
        referrerId: record.referrerId,
        targetId: record.targetId,
        ...(schemaPath === undefined ? {} : { schemaPath }),
        ...(sourceId === undefined ? {} : { sourceId }),
      };
      return Object.freeze(diagnostic);
    }
    case "featureGate": {
      if (typeof record.sourceId !== "string" || typeof record.schemaPath !== "string") {
        return null;
      }
      const diagnostic: FeatureGateContentDiagnostic = {
        kind: "featureGate",
        ...common,
        sourceId: record.sourceId,
        schemaPath: record.schemaPath,
      };
      return Object.freeze(diagnostic);
    }
    case "tool": {
      const diagnostic: ToolContentDiagnostic = { kind: "tool", ...common };
      return Object.freeze(diagnostic);
    }
  }
}

/** source span の開始位置と、省略または一組で指定する終了位置を検証する。 */
function normalizeSourceSpan(record: Readonly<Record<string, unknown>>): NormalizedSourceSpan | null {
  if (
    typeof record.path !== "string"
    || !isPositiveInteger(record.line)
    || !isPositiveInteger(record.column)
  ) {
    return null;
  }
  const hasEndLine = record.endLine !== undefined;
  const hasEndColumn = record.endColumn !== undefined;
  if (hasEndLine !== hasEndColumn) {
    return null;
  }
  if (hasEndLine && (!isPositiveInteger(record.endLine) || !isPositiveInteger(record.endColumn))) {
    return null;
  }
  if (
    hasEndLine
    && (
      (record.endLine as number) < record.line
      || ((record.endLine as number) === record.line && (record.endColumn as number) < record.column)
    )
  ) {
    return null;
  }
  if (hasEndLine) {
    return Object.freeze({
      path: record.path,
      line: record.line,
      column: record.column,
      endLine: record.endLine as number,
      endColumn: record.endColumn as number,
    });
  }
  return Object.freeze({ path: record.path, line: record.line, column: record.column });
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

/** source position、kind、severity、本文、schema / reference context の順で診断を deterministic に並べる。 */
function compareDiagnostics(left: ContentDiagnostic, right: ContentDiagnostic): number {
  return compareOptionalStrings(getDiagnosticSource(left), getDiagnosticSource(right))
    || compareOptionalNumbers(getDiagnosticLine(left), getDiagnosticLine(right))
    || compareOptionalNumbers(getDiagnosticColumn(left), getDiagnosticColumn(right))
    || compareOptionalNumbers(getDiagnosticEndLine(left), getDiagnosticEndLine(right))
    || compareOptionalNumbers(getDiagnosticEndColumn(left), getDiagnosticEndColumn(right))
    || DIAGNOSTIC_KIND_ORDER[left.kind] - DIAGNOSTIC_KIND_ORDER[right.kind]
    || DIAGNOSTIC_SEVERITY_ORDER[left.severity] - DIAGNOSTIC_SEVERITY_ORDER[right.severity]
    || compareStrings(left.code, right.code)
    || compareStrings(left.message, right.message)
    || compareOptionalStrings(getDiagnosticSchemaPath(left), getDiagnosticSchemaPath(right))
    || compareOptionalStrings(getDiagnosticSourceId(left), getDiagnosticSourceId(right))
    || compareOptionalStrings(getDiagnosticReferrerId(left), getDiagnosticReferrerId(right))
    || compareOptionalStrings(getDiagnosticTargetId(left), getDiagnosticTargetId(right));
}

/** optional source span と参照 context を含む human diagnostic 1行を組み立てる。 */
function formatHumanDiagnostic(diagnostic: ContentDiagnostic): string {
  const location = formatDiagnosticLocation(diagnostic);
  const prefix = location ? `${location} ` : "";
  const context = formatDiagnosticContext(diagnostic);
  const suffix = context.length > 0 ? ` (${context.join(", ")})` : "";
  return `${prefix}[${diagnostic.severity.toUpperCase()}] ${escapeHumanText(diagnostic.code)}: ${escapeHumanText(diagnostic.message)}${suffix}`;
}

/** source span または feature source ID を1行の location 表記へ整形する。 */
function formatDiagnosticLocation(diagnostic: ContentDiagnostic): string {
  if ("path" in diagnostic) {
    const start = `${escapeHumanText(diagnostic.path)}:${diagnostic.line}:${diagnostic.column}`;
    if (diagnostic.endLine !== undefined && diagnostic.endColumn !== undefined) {
      return `${start}-${diagnostic.endLine}:${diagnostic.endColumn}`;
    }
    return start;
  }
  if (diagnostic.kind === "featureGate") {
    return escapeHumanText(diagnostic.sourceId);
  }
  return "";
}

/** schema path、source ID、参照元 ID、target ID をhuman出力へ残す。 */
function formatDiagnosticContext(diagnostic: ContentDiagnostic): string[] {
  const context: string[] = [];
  if ("schemaPath" in diagnostic && diagnostic.schemaPath !== undefined) {
    context.push(`schema=${escapeHumanText(diagnostic.schemaPath)}`);
  }
  if ("sourceId" in diagnostic && diagnostic.sourceId !== undefined && diagnostic.kind !== "featureGate") {
    context.push(`source=${escapeHumanText(diagnostic.sourceId)}`);
  }
  if (diagnostic.kind === "reference") {
    context.push(`referrer=${escapeHumanText(diagnostic.referrerId)}`);
    context.push(`target=${escapeHumanText(diagnostic.targetId)}`);
  }
  return context;
}

/** human output の最終行を固定順で生成する。 */
function formatHumanSummary(summary: ContentDiagnosticSummary): string {
  return `Summary: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} info(s)`;
}

/** 改行、ANSI escape、制御文字を可視化し、1 diagnostic を必ず1行に保つ。 */
function escapeHumanText(value: string): string {
  let escaped = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    switch (character) {
      case "\\":
        escaped += "\\\\";
        break;
      case "\b":
        escaped += "\\b";
        break;
      case "\f":
        escaped += "\\f";
        break;
      case "\n":
        escaped += "\\n";
        break;
      case "\r":
        escaped += "\\r";
        break;
      case "\t":
        escaped += "\\t";
        break;
      default:
        if (
          codePoint <= 0x1f
          || (codePoint >= 0x7f && codePoint <= 0x9f)
          || codePoint === 0x2028
          || codePoint === 0x2029
        ) {
          escaped += `\\u${codePoint.toString(16).padStart(4, "0")}`;
        } else {
          escaped += character;
        }
    }
  }
  return escaped;
}

function getDiagnosticSource(diagnostic: ContentDiagnostic): string | undefined {
  if ("path" in diagnostic) {
    return diagnostic.path;
  }
  return diagnostic.kind === "featureGate" ? diagnostic.sourceId : undefined;
}

function getDiagnosticLine(diagnostic: ContentDiagnostic): number | undefined {
  return "line" in diagnostic ? diagnostic.line : undefined;
}

function getDiagnosticColumn(diagnostic: ContentDiagnostic): number | undefined {
  return "column" in diagnostic ? diagnostic.column : undefined;
}

function getDiagnosticEndLine(diagnostic: ContentDiagnostic): number | undefined {
  return "endLine" in diagnostic ? diagnostic.endLine : undefined;
}

function getDiagnosticEndColumn(diagnostic: ContentDiagnostic): number | undefined {
  return "endColumn" in diagnostic ? diagnostic.endColumn : undefined;
}

function getDiagnosticSchemaPath(diagnostic: ContentDiagnostic): string | undefined {
  return "schemaPath" in diagnostic ? diagnostic.schemaPath : undefined;
}

function getDiagnosticSourceId(diagnostic: ContentDiagnostic): string | undefined {
  return "sourceId" in diagnostic ? diagnostic.sourceId : undefined;
}

function getDiagnosticReferrerId(diagnostic: ContentDiagnostic): string | undefined {
  return diagnostic.kind === "reference" ? diagnostic.referrerId : undefined;
}

function getDiagnosticTargetId(diagnostic: ContentDiagnostic): string | undefined {
  return diagnostic.kind === "reference" ? diagnostic.targetId : undefined;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareOptionalStrings(left: string | undefined, right: string | undefined): number {
  if (left === undefined) {
    return right === undefined ? 0 : 1;
  }
  return right === undefined ? -1 : compareStrings(left, right);
}

function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  if (left === undefined) {
    return right === undefined ? 0 : 1;
  }
  return right === undefined ? -1 : left - right;
}

function normalizeOptionalString(value: unknown): string | undefined | null {
  return value === undefined ? undefined : typeof value === "string" ? value : null;
}

function isDiagnosticKind(value: unknown): value is ContentDiagnosticKind {
  return value === "parse" || value === "schema" || value === "reference" || value === "featureGate" || value === "tool";
}

function isDiagnosticSeverity(value: unknown): value is ContentDiagnosticSeverity {
  return value === "error" || value === "warning" || value === "info";
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function snapshotOwnDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return null;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return null;
  }
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return null;
    }
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}
