import type {
  ContentDiagnostic,
  ContentDiagnosticKind,
  ContentDiagnosticSeverity,
  FeatureGateContentDiagnostic,
  ParseOrSchemaContentDiagnostic,
  ReferenceContentDiagnostic,
  ToolContentDiagnostic,
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

/** 外部入力を公開診断 field だけへ投影し、canonical order へ揃える。 */
export function normalizeDiagnostics(value: unknown): NormalizedDiagnosticResult {
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

export function snapshotOwnDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
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
