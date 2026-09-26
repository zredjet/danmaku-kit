export { loadValidatedGameDefinition } from "./game-definition-loader.ts";
export type { LoadValidatedGameDefinitionResult, ValidateContentSourcePaths } from "./game-definition-loader.ts";
export { formatValidateContentHuman, formatValidateContentJson } from "./output-format.ts";
export { createToolErrorRunResult, createValidationRunResult } from "./output.ts";
export type {
  ContentDiagnostic,
  ContentDiagnosticKind,
  ContentDiagnosticSeverity,
  ContentDiagnosticSummary,
  FeatureGateContentDiagnostic,
  ParseOrSchemaContentDiagnostic,
  ReferenceContentDiagnostic,
  ToolContentDiagnostic,
  ValidationContentDiagnostic,
  ValidateContentExitCode,
  ValidateContentJsonOutput,
  ValidateContentRunResult,
} from "./types.ts";
