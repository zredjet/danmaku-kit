import assert from "node:assert/strict";
import test from "node:test";

import {
  createToolErrorRunResult,
  createValidationRunResult,
  formatValidateContentHuman,
  formatValidateContentJson,
} from "./index.ts";
import type { ContentDiagnostic, ValidateContentJsonOutput, ValidationContentDiagnostic } from "./index.ts";

test("formats stable JSON text and omits undeclared properties", () => {
  const result = createToolErrorRunResult(
    "fixtures/content-minimum",
    "tool.readFailed",
    "Could not read game definition",
  );

  assert.equal(
    formatValidateContentJson(result.output),
    [
      "{",
      '  "schemaVersion": "1",',
      '  "contentRoot": "fixtures/content-minimum",',
      '  "ok": false,',
      '  "diagnostics": [',
      "    {",
      '      "kind": "tool",',
      '      "code": "tool.readFailed",',
      '      "severity": "error",',
      '      "message": "Could not read game definition"',
      "    }",
      "  ],",
      '  "summary": {',
      '    "errors": 1,',
      '    "warnings": 0,',
      '    "infos": 0',
      "  }",
      "}",
      "",
    ].join("\n"),
  );
});

test("fixes canonical JSON property order for every validation diagnostic kind", () => {
  const diagnostics: ValidationContentDiagnostic[] = [
    {
      kind: "featureGate",
      code: "feature.unsupported",
      severity: "info",
      message: "Feature disabled",
      sourceId: "d.player",
      schemaPath: "content.players[0].bomb",
    },
    {
      kind: "reference",
      code: "enemy.notFound",
      severity: "warning",
      message: "Enemy missing",
      path: "c.yaml",
      line: 3,
      column: 4,
      referrerId: "stage.stage_01",
      targetId: "enemy.missing",
      schemaPath: "content.stages[0].enemy",
      sourceId: "stage.stage_01",
    },
    {
      kind: "schema",
      code: "definition.invalidShape",
      severity: "error",
      message: "Invalid field",
      path: "b.yaml",
      line: 2,
      column: 3,
      endLine: 2,
      endColumn: 8,
      schemaPath: "content.players[0]",
      sourceId: "player.default",
    },
    {
      kind: "parse",
      code: "yaml.parse",
      severity: "error",
      message: "Invalid YAML",
      path: "a.yaml",
      line: 1,
      column: 2,
      schemaPath: "$",
    },
  ];
  const result = createValidationRunResult("fixtures/content-minimum", diagnostics);
  const expected = {
    schemaVersion: "1",
    contentRoot: "fixtures/content-minimum",
    ok: false,
    diagnostics: [diagnostics[3], diagnostics[2], diagnostics[1], diagnostics[0]],
    summary: { errors: 2, warnings: 1, infos: 1 },
  };

  assert.equal(formatValidateContentJson(result.output), `${JSON.stringify(expected, null, 2)}\n`);
});

test("rebuilds caller-constructed formatter output from diagnostics", () => {
  const later: Extract<ValidationContentDiagnostic, { kind: "reference" }> = {
    kind: "reference",
    code: "enemy.notFound",
    severity: "error",
    message: "Enemy missing",
    path: "b.yaml",
    line: 2,
    column: 1,
    referrerId: "stage.stage_01",
    targetId: "enemy.missing",
  };
  const earlier: Extract<ValidationContentDiagnostic, { kind: "parse" | "schema" }> = {
    kind: "schema",
    code: "definition.invalidShape",
    severity: "error",
    message: "Invalid field",
    path: "a.yaml",
    line: 1,
    column: 1,
    schemaPath: "content.players[0]",
  };
  const inconsistentOutput: ValidateContentJsonOutput = {
    schemaVersion: "1",
    contentRoot: "fixtures/content-minimum",
    ok: true,
    diagnostics: [later, earlier],
    summary: { errors: 0, warnings: 0, infos: 0 },
  };

  const formatted = JSON.parse(formatValidateContentJson(inconsistentOutput));
  assert.equal(formatted.ok, false);
  assert.deepEqual(formatted.summary, { errors: 2, warnings: 0, infos: 0 });
  assert.deepEqual(formatted.diagnostics.map((diagnostic: ContentDiagnostic) => diagnostic.code), [
    "definition.invalidShape",
    "enemy.notFound",
  ]);
  assert.match(formatValidateContentHuman(inconsistentOutput), /^a\.yaml:1:1 \[ERROR]/);

  const malformedOutput = {
    schemaVersion: "1",
    contentRoot: "fixtures/content-minimum",
    ok: true,
    diagnostics: [{ kind: "schema", severity: "error" }],
    summary: { errors: 0, warnings: 0, infos: 0 },
  } as unknown as ValidateContentJsonOutput;
  const malformedFormatted = JSON.parse(formatValidateContentJson(malformedOutput));
  assert.equal(malformedFormatted.ok, false);
  assert.equal(malformedFormatted.diagnostics[0].code, "tool.invalidOutput");
});

test("formats human diagnostics with complete source and reference context", () => {
  const result = createValidationRunResult("fixtures/content-minimum", [
    {
      kind: "schema",
      code: "definition.invalidShape",
      severity: "error",
      message: "player.speed must be a number",
      path: "fixtures/player.yaml",
      line: 4,
      column: 10,
      endLine: 4,
      endColumn: 15,
      schemaPath: "content.players[0].movement.speed",
      sourceId: "player.default",
    },
    {
      kind: "reference",
      code: "enemy.notFound",
      severity: "warning",
      message: "Enemy reference was not found",
      path: "fixtures/stage.yaml",
      line: 8,
      column: 12,
      referrerId: "stage.stage_01",
      targetId: "enemy.missing",
    },
  ]);

  assert.equal(
    formatValidateContentHuman(result.output),
    [
      "fixtures/player.yaml:4:10-4:15 [ERROR] definition.invalidShape: player.speed must be a number (schema=content.players[0].movement.speed, source=player.default)",
      "fixtures/stage.yaml:8:12 [WARNING] enemy.notFound: Enemy reference was not found (referrer=stage.stage_01, target=enemy.missing)",
      "Summary: 1 error(s), 1 warning(s), 0 info(s)",
      "",
    ].join("\n"),
  );
});

test("escapes control characters in every human text field", () => {
  const result = createValidationRunResult("safe", [
    {
      kind: "schema",
      code: "bad\u001b[31m",
      severity: "error",
      message: "first\nsecond",
      path: "file\r.yaml",
      line: 1,
      column: 2,
      schemaPath: "root\tvalue",
      sourceId: "player\\default",
    },
  ]);

  assert.equal(
    formatValidateContentHuman(result.output),
    "file\\r.yaml:1:2 [ERROR] bad\\u001b[31m: first\\nsecond (schema=root\\tvalue, source=player\\\\default)\nSummary: 1 error(s), 0 warning(s), 0 info(s)\n",
  );
});

test("formats a successful human result without diagnostics", () => {
  const result = createValidationRunResult("fixtures/content\nminimum", []);

  assert.equal(
    formatValidateContentHuman(result.output),
    "Validation passed: fixtures/content\\nminimum\nSummary: 0 error(s), 0 warning(s), 0 info(s)\n",
  );
});
