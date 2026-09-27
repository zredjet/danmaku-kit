import { normalizeDiagnostics, snapshotOwnDataRecord } from "./diagnostic-normalization.ts";
import { createOwnToolErrorRunResult, createValidationRunResult, reemitToolDiagnostic } from "./output.ts";
import type {
  ContentDiagnostic,
  ContentDiagnosticSummary,
  ValidationContentDiagnostic,
  ValidateContentJsonOutput,
} from "./types.ts";

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
      return createOwnToolErrorRunResult("", "tool.invalidOutput", "Validate-content output is invalid").output;
    }
    const normalized = normalizeDiagnostics(output.diagnostics);
    if (!normalized.ok) {
      return createOwnToolErrorRunResult(output.contentRoot, "tool.invalidOutput", normalized.message).output;
    }
    const toolDiagnostics = normalized.value.filter((diagnostic) => diagnostic.kind === "tool");
    if (toolDiagnostics.length > 0) {
      if (toolDiagnostics.length === 1 && normalized.value.length === 1) {
        return reemitToolDiagnostic(output.contentRoot, toolDiagnostics[0]!).output;
      }
      return createOwnToolErrorRunResult(
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
    return createOwnToolErrorRunResult("", "tool.invalidOutput", "Validate-content output could not be read safely").output;
  }
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
