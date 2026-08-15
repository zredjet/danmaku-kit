import {
  createShootingCore,
  type CoreError,
  type CoreWarning,
  type GameDefinition,
} from "@shooting-sample/shooting-core";

import type { ContentSourceContext, ContentSourceIndex } from "./content-loader.ts";
import type {
  FeatureGateContentDiagnostic,
  ParseOrSchemaContentDiagnostic,
  ReferenceContentDiagnostic,
  ValidationContentDiagnostic,
} from "./types.ts";

const REFERENCE_ERROR_CODES = new Set<string>([
  "asset.notFound",
  "bullet.notFound",
  "enemy.notFound",
  "path.notFound",
  "pattern.notFound",
  "player.defaultNotFound",
  "playerShot.notFound",
]);

/**
 * 組み立て済みGameDefinitionをCore公開load境界で検証し、authoring診断へ変換する。
 * Core validatorを複製せず、CLIはerror codeの分類とsource位置の付与だけを担当する。
 */
export function validateContentDefinition(
  definition: unknown,
  sourceIndex: ContentSourceIndex,
): readonly ValidationContentDiagnostic[] {
  const result = createShootingCore("validate-content").load(definition as GameDefinition);
  if (!result.ok) {
    return Object.freeze(result.errors.map((error) => mapCoreError(error, sourceIndex)));
  }
  return Object.freeze(result.warnings.map((warning) => mapCoreWarning(warning, sourceIndex)));
}

/** Core error codeをreference / feature gate / schemaの公開diagnostic kindへ分類する。 */
function mapCoreError(error: CoreError, sourceIndex: ContentSourceIndex): ValidationContentDiagnostic {
  if (error.code.startsWith("feature.")) {
    return createFeatureGateDiagnostic(error.code, "error", error.message);
  }
  if (REFERENCE_ERROR_CODES.has(error.code)) {
    return createReferenceDiagnostic(error, sourceIndex);
  }
  return createSchemaDiagnostic(error, "error", sourceIndex);
}

/** Core warningはblockingしないschema diagnosticとして同じsource lookupを適用する。 */
function mapCoreWarning(
  warning: CoreWarning,
  sourceIndex: ContentSourceIndex,
): ParseOrSchemaContentDiagnostic {
  return createSchemaDiagnostic(warning, "warning", sourceIndex);
}

/** 参照errorのtarget IDをmessageから取り出し、該当scalarをreferrer位置として使う。 */
function createReferenceDiagnostic(error: CoreError, sourceIndex: ContentSourceIndex): ReferenceContentDiagnostic {
  const targetId = error.targetId ?? extractTrailingValue(error.message) ?? "<unknown>";
  const schemaPath = error.schemaPath ?? inferSchemaPath(error.code, error.message);
  const context = sourceIndex.locateSchemaPath(schemaPath, error.referrerId);
  return freezeReferenceDiagnostic({
    kind: "reference",
    code: error.code,
    severity: "error",
    message: error.message,
    path: context.span.path,
    line: context.span.line,
    column: context.span.column,
    ...(context.span.endLine === undefined
      ? {}
      : { endLine: context.span.endLine, endColumn: context.span.endColumn! }),
    schemaPath,
    referrerId: error.referrerId ?? context.sourceId,
    targetId,
  });
}

/** feature validationはGameDefinition.enabledFeaturesを正本位置として表す。 */
function createFeatureGateDiagnostic(
  code: string,
  severity: "error" | "warning",
  message: string,
): FeatureGateContentDiagnostic {
  return Object.freeze({
    kind: "featureGate",
    code,
    severity,
    message,
    sourceId: "gameDefinition",
    schemaPath: "enabledFeatures",
  });
}

/** shape / constraint errorを推定schema pathとsource spanへ接続する。 */
function createSchemaDiagnostic(
  error: Readonly<Pick<CoreError, "code" | "message" | "schemaPath" | "referrerId">> | CoreWarning,
  severity: "error" | "warning",
  sourceIndex: ContentSourceIndex,
): ParseOrSchemaContentDiagnostic {
  const schemaPath = "schemaPath" in error && error.schemaPath !== undefined
    ? error.schemaPath
    : inferSchemaPath(error.code, error.message);
  const referrerId = "referrerId" in error ? error.referrerId : undefined;
  return freezeSchemaDiagnostic(
    error.code,
    severity,
    error.message,
    schemaPath,
    sourceIndex.locateSchemaPath(schemaPath, referrerId),
  );
}

/** Core messageのpath表現を可能な範囲で抽出し、code別fallbackを必ず返す。 */
function inferSchemaPath(code: string, message: string): string {
  const unknownField = /^Unknown field at (.+)$/.exec(message);
  if (unknownField) {
    return unknownField[1]!;
  }
  const constraintPath = /^([A-Za-z][A-Za-z0-9.[\]]*) (?:must|exceeds|is )/.exec(message);
  if (constraintPath) {
    return constraintPath[1]!;
  }
  switch (code) {
    case "schema.unsupportedVersion": return "schemaVersion";
    case "feature.duplicate":
    case "feature.unknown":
    case "feature.unsupported": return "enabledFeatures";
    case "player.defaultNotFound": return "defaultPlayerId";
    case "playerShot.notFound": return "player.shot.definition";
    case "bullet.notFound": return "pattern.fireOnSpawn.bullet";
    case "enemy.notFound": return "stage.timeline[].action.enemy";
    case "pattern.notFound": return "stage.timeline[].action.pattern";
    case "path.notFound": return "stage.timeline[].action.path";
    case "timeline.invalidOrder":
    case "timeline.tooManySpawnsPerTick":
    case "timeline.tooManySteps": return "stage.timeline";
    case "asset.duplicate":
    case "asset.invalidKey":
    case "asset.notFound": return "content.assetKeys.keys";
    case "id.duplicate":
    case "id.invalidNamespace": return "id";
    default: return "$";
  }
}

/** `Label: value`形式のCore messageから参照値・重複値を抽出する。 */
function extractTrailingValue(message: string): string | null {
  const separator = message.lastIndexOf(": ");
  if (separator < 0 || separator + 2 >= message.length) {
    return null;
  }
  return message.slice(separator + 2);
}

/** optional end spanのunionを崩さずreference diagnosticをfreezeする。 */
function freezeReferenceDiagnostic(
  value: Omit<ReferenceContentDiagnostic, "endLine" | "endColumn"> &
    Partial<Pick<ReferenceContentDiagnostic, "endLine" | "endColumn">>,
): ReferenceContentDiagnostic {
  const { endLine, endColumn, ...base } = value;
  if (endLine !== undefined && endColumn !== undefined) {
    return Object.freeze({ ...base, endLine, endColumn });
  }
  return Object.freeze(base) as ReferenceContentDiagnostic;
}

/** source contextをschema diagnosticのpaired end spanへ投影する。 */
function freezeSchemaDiagnostic(
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
