import {
  createToolErrorRunResult,
  createValidationRunResult,
  formatValidateContentHuman,
  formatValidateContentJson,
} from "@shooting-sample/validate-content";
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
  ValidateContentExitCode,
  ValidateContentJsonOutput,
  ValidateContentRunResult,
} from "@shooting-sample/validate-content";

// @ts-expect-error validate-content internal types are not importable through a deep package subpath.
import type { ContentDiagnostic as DeepContentDiagnostic } from "@shooting-sample/validate-content/src/types.ts";

// @ts-expect-error validate-content internal functions are not importable through a deep package subpath.
import { createValidationRunResult as DeepCreateValidationRunResult } from "@shooting-sample/validate-content/src/output.ts";

type IsExactly<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type AssertTrue<Value extends true> = Value;

type ExpectedBase = Readonly<{
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
}>;
type ExpectedSourceEnd =
  | Readonly<{ endLine?: never; endColumn?: never }>
  | Readonly<{ endLine: number; endColumn: number }>;
type ExpectedSourceSpan = Readonly<{ path: string; line: number; column: number }> & ExpectedSourceEnd;
type ExpectedParseOrSchemaDiagnostic = ExpectedBase & ExpectedSourceSpan & Readonly<{
  kind: "parse" | "schema";
  schemaPath: string;
  sourceId?: string;
}>;
type ExpectedReferenceDiagnostic = ExpectedBase & ExpectedSourceSpan & Readonly<{
  kind: "reference";
  referrerId: string;
  targetId: string;
  schemaPath?: string;
  sourceId?: string;
}>;
type ExpectedFeatureGateDiagnostic = ExpectedBase & Readonly<{
  kind: "featureGate";
  sourceId: string;
  schemaPath: string;
}>;
type ExpectedToolDiagnostic = ExpectedBase & Readonly<{ kind: "tool" }>;
type ExpectedDiagnostic =
  | ExpectedParseOrSchemaDiagnostic
  | ExpectedReferenceDiagnostic
  | ExpectedFeatureGateDiagnostic
  | ExpectedToolDiagnostic;
type ExpectedValidationDiagnostic = Exclude<ExpectedDiagnostic, ExpectedToolDiagnostic>;
type ExpectedSummary = Readonly<{ errors: number; warnings: number; infos: number }>;
type ExpectedOutputBase = Readonly<{
  schemaVersion: "1";
  contentRoot: string;
  diagnostics: readonly ExpectedDiagnostic[];
  summary: ExpectedSummary;
}>;
type ExpectedOutput =
  | (ExpectedOutputBase & Readonly<{ ok: true }>)
  | (ExpectedOutputBase & Readonly<{ ok: false }>);
type ExpectedRunResult =
  | Readonly<{ exitCode: 0; output: ExpectedOutput & Readonly<{ ok: true }> }>
  | Readonly<{ exitCode: 1; output: ExpectedOutput & Readonly<{ ok: false }> }>
  | Readonly<{ exitCode: 2; output: ExpectedOutput & Readonly<{ ok: false }> }>;

type ValidateContentContractAssertions = readonly [
  AssertTrue<IsExactly<ContentDiagnosticKind, "parse" | "schema" | "reference" | "featureGate" | "tool">>,
  AssertTrue<IsExactly<ContentDiagnosticSeverity, "error" | "warning" | "info">>,
  AssertTrue<IsExactly<ParseOrSchemaContentDiagnostic, ExpectedParseOrSchemaDiagnostic>>,
  AssertTrue<IsExactly<ReferenceContentDiagnostic, ExpectedReferenceDiagnostic>>,
  AssertTrue<IsExactly<FeatureGateContentDiagnostic, ExpectedFeatureGateDiagnostic>>,
  AssertTrue<IsExactly<ToolContentDiagnostic, ExpectedToolDiagnostic>>,
  AssertTrue<IsExactly<ContentDiagnostic, ExpectedDiagnostic>>,
  AssertTrue<IsExactly<ValidationContentDiagnostic, ExpectedValidationDiagnostic>>,
  AssertTrue<IsExactly<ContentDiagnosticSummary, ExpectedSummary>>,
  AssertTrue<IsExactly<ValidateContentJsonOutput, ExpectedOutput>>,
  AssertTrue<IsExactly<ValidateContentExitCode, 0 | 1 | 2>>,
  AssertTrue<IsExactly<ValidateContentRunResult, ExpectedRunResult>>,
  AssertTrue<
    IsExactly<
      typeof createValidationRunResult,
      (contentRoot: string, diagnostics: readonly ValidationContentDiagnostic[]) => ValidateContentRunResult
    >
  >,
  AssertTrue<
    IsExactly<
      typeof createToolErrorRunResult,
      (contentRoot: string, code: string, message: string) => ValidateContentRunResult
    >
  >,
  AssertTrue<IsExactly<typeof formatValidateContentJson, (output: ValidateContentJsonOutput) => string>>,
  AssertTrue<IsExactly<typeof formatValidateContentHuman, (output: ValidateContentJsonOutput) => string>>,
];

const parseDiagnostic: ContentDiagnostic = {
  kind: "parse",
  code: "yaml.parse",
  severity: "error",
  message: "Invalid YAML",
  path: "game.yaml",
  line: 1,
  column: 2,
  schemaPath: "$",
};
const schemaDiagnostic: ContentDiagnostic = {
  kind: "schema",
  code: "definition.invalidShape",
  severity: "warning",
  message: "Invalid field",
  path: "player.yaml",
  line: 2,
  column: 3,
  endLine: 2,
  endColumn: 8,
  schemaPath: "content.players[0]",
  sourceId: "player.default",
};
const referenceDiagnostic: ContentDiagnostic = {
  kind: "reference",
  code: "enemy.notFound",
  severity: "error",
  message: "Enemy not found",
  path: "stage.yaml",
  line: 3,
  column: 4,
  referrerId: "stage.stage_01",
  targetId: "enemy.missing",
};
const featureDiagnostic: ContentDiagnostic = {
  kind: "featureGate",
  code: "feature.unsupported",
  severity: "info",
  message: "Feature is disabled",
  sourceId: "player.default",
  schemaPath: "content.players[0].bomb",
};
const toolDiagnostic: ContentDiagnostic = {
  kind: "tool",
  code: "tool.readFailed",
  severity: "error",
  message: "Read failed",
};
// @ts-expect-error tool/runtime diagnostics must use createToolErrorRunResult.
createValidationRunResult("fixtures/content-minimum", [toolDiagnostic]);
const summary: ContentDiagnosticSummary = { errors: 2, warnings: 1, infos: 1 };
const successOutput: ValidateContentJsonOutput = {
  schemaVersion: "1",
  contentRoot: "fixtures/content-minimum",
  ok: true,
  diagnostics: [],
  summary: { errors: 0, warnings: 0, infos: 0 },
};
const failureOutput: ValidateContentJsonOutput = {
  schemaVersion: "1",
  contentRoot: "fixtures/content-minimum",
  ok: false,
  diagnostics: [parseDiagnostic, schemaDiagnostic, referenceDiagnostic, featureDiagnostic, toolDiagnostic],
  summary,
};
const successRunResult: ValidateContentRunResult = { exitCode: 0, output: successOutput };
const validationFailureRunResult: ValidateContentRunResult = { exitCode: 1, output: failureOutput };
const toolFailureRunResult: ValidateContentRunResult = { exitCode: 2, output: failureOutput };

declare let readonlyDiagnostic: ContentDiagnostic;
declare const sameMessage: ContentDiagnostic["message"];
// @ts-expect-error public diagnostic fields are immutable.
readonlyDiagnostic.message = sameMessage;
declare let readonlySummary: ContentDiagnosticSummary;
declare const sameErrorCount: ContentDiagnosticSummary["errors"];
// @ts-expect-error public summary fields are immutable.
readonlySummary.errors = sameErrorCount;
declare let readonlyOutput: ValidateContentJsonOutput;
declare const sameOk: ValidateContentJsonOutput["ok"];
// @ts-expect-error public output fields are immutable.
readonlyOutput.ok = sameOk;
// @ts-expect-error public diagnostics are immutable.
readonlyOutput.diagnostics.push(toolDiagnostic);
declare let readonlyRunResult: ValidateContentRunResult;
declare const sameExitCode: ValidateContentRunResult["exitCode"];
// @ts-expect-error public run result fields are immutable.
readonlyRunResult.exitCode = sameExitCode;

// @ts-expect-error severity is limited to the public union.
const invalidSeverity: ContentDiagnosticSeverity = "fatal";
// @ts-expect-error diagnostic kind is limited to the public union.
const invalidKind: ContentDiagnosticKind = "runtime";
// @ts-expect-error JSON output schema version is fixed.
const invalidSchemaVersion: ValidateContentJsonOutput = { ...successOutput, schemaVersion: "2" };
// @ts-expect-error parse diagnostics require schemaPath.
const invalidParseDiagnostic: ContentDiagnostic = {
  kind: "parse",
  code: "yaml.parse",
  severity: "error",
  message: "Invalid YAML",
  path: "game.yaml",
  line: 1,
  column: 2,
};
// @ts-expect-error source span end position requires both endLine and endColumn.
const invalidSourceEnd: ContentDiagnostic = { ...schemaDiagnostic, endColumn: undefined };
// @ts-expect-error reference diagnostics require targetId.
const invalidReferenceDiagnostic: ContentDiagnostic = {
  kind: "reference",
  code: "enemy.notFound",
  severity: "error",
  message: "Enemy not found",
  path: "stage.yaml",
  line: 3,
  column: 4,
  referrerId: "stage.stage_01",
};
// @ts-expect-error feature gate diagnostics require sourceId.
const invalidFeatureDiagnostic: ContentDiagnostic = {
  kind: "featureGate",
  code: "feature.unsupported",
  severity: "error",
  message: "Feature is disabled",
  schemaPath: "content.players[0].bomb",
};
// @ts-expect-error exit code 2 cannot carry successful output.
const invalidToolSuccess: ValidateContentRunResult = { exitCode: 2, output: successOutput };
// @ts-expect-error exit code 0 cannot carry failed output.
const invalidValidationSuccess: ValidateContentRunResult = { exitCode: 0, output: failureOutput };
// @ts-expect-error validate-content exit codes are limited to 0, 1, and 2.
const invalidExitCode: ValidateContentExitCode = 3;

void (undefined as unknown as ValidateContentContractAssertions);
void successRunResult;
void validationFailureRunResult;
void toolFailureRunResult;
void invalidSeverity;
void invalidKind;
void invalidSchemaVersion;
void invalidParseDiagnostic;
void invalidSourceEnd;
void invalidReferenceDiagnostic;
void invalidFeatureDiagnostic;
void invalidToolSuccess;
void invalidValidationSuccess;
void invalidExitCode;
void (undefined as unknown as DeepContentDiagnostic);
void DeepCreateValidationRunResult;
