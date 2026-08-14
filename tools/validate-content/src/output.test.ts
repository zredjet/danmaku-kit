import assert from "node:assert/strict";
import test from "node:test";

import {
  createToolErrorRunResult,
  createValidationRunResult,
  formatValidateContentHuman,
  formatValidateContentJson,
} from "./index.ts";
import type { ContentDiagnostic, ValidationContentDiagnostic, ValidateContentJsonOutput } from "./index.ts";

test("normalizes every diagnostic kind and counts severity", () => {
  const callerOwnedSchemaDiagnostic = {
    kind: "schema" as const,
    code: "definition.invalidShape",
    severity: "error" as const,
    message: "player.speed must be a number",
    sourceId: "player.default",
    path: "fixtures/player.yaml",
    line: 4,
    column: 10,
    endLine: 4,
    endColumn: 15,
    schemaPath: "content.players[0].movement.speed",
    internalValue: 1n,
    toJSON: () => ({ severity: "info", message: "forged" }),
  };
  const diagnostics: ValidationContentDiagnostic[] = [
    {
      kind: "featureGate",
      code: "content.loaded",
      severity: "info",
      message: "Loaded content",
      sourceId: "player.extra",
      schemaPath: "content.players[1]",
    },
    {
      kind: "parse",
      code: "yaml.parse",
      severity: "error",
      message: "Invalid YAML",
      path: "fixtures/game.yaml",
      line: 1,
      column: 2,
      schemaPath: "$",
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
      schemaPath: "content.stages[0].timeline[0].action.enemy",
      sourceId: "stage.stage_01",
    },
    callerOwnedSchemaDiagnostic,
  ];

  const result = createValidationRunResult("fixtures/content-minimum", diagnostics);

  assert.equal(result.exitCode, 1);
  assert.equal(result.output.ok, false);
  assert.deepEqual(result.output.summary, { errors: 2, warnings: 1, infos: 1 });
  assert.deepEqual(result.output.diagnostics, [
    {
      kind: "parse",
      code: "yaml.parse",
      severity: "error",
      message: "Invalid YAML",
      path: "fixtures/game.yaml",
      line: 1,
      column: 2,
      schemaPath: "$",
    },
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
      schemaPath: "content.stages[0].timeline[0].action.enemy",
      sourceId: "stage.stage_01",
    },
    {
      kind: "featureGate",
      code: "content.loaded",
      severity: "info",
      message: "Loaded content",
      sourceId: "player.extra",
      schemaPath: "content.players[1]",
    },
  ]);
  assert.equal(Object.isFrozen(callerOwnedSchemaDiagnostic), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.output), true);
  assert.equal(Object.isFrozen(result.output.diagnostics), true);
  assert.equal(result.output.diagnostics.every((diagnostic) => Object.isFrozen(diagnostic)), true);
  assert.equal(Object.isFrozen(result.output.summary), true);

  callerOwnedSchemaDiagnostic.message = "changed";
  assert.equal(result.output.diagnostics[1]?.message, "player.speed must be a number");
});

test("sorts equivalent diagnostic sets into one canonical order", () => {
  const first: ValidationContentDiagnostic = {
    kind: "schema",
    code: "z.error",
    severity: "error",
    message: "Later source position",
    path: "b.yaml",
    line: 2,
    column: 1,
    schemaPath: "b",
  };
  const second: ValidationContentDiagnostic = {
    kind: "schema",
    code: "a.error",
    severity: "error",
    message: "Earlier source position",
    path: "a.yaml",
    line: 1,
    column: 1,
    schemaPath: "a",
  };

  const forward = createValidationRunResult("content", [first, second]);
  const reverse = createValidationRunResult("content", [second, first]);

  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.output.diagnostics.map((diagnostic) => diagnostic.code), ["a.error", "z.error"]);
});

test("uses reference context as a canonical ordering tie-breaker", () => {
  const createReference = (targetId: string): ValidationContentDiagnostic => ({
    kind: "reference",
    code: "enemy.notFound",
    severity: "error",
    message: "Enemy not found",
    path: "stage.yaml",
    line: 3,
    column: 4,
    referrerId: "stage.stage_01",
    targetId,
  });

  const forward = createValidationRunResult("content", [createReference("enemy.z"), createReference("enemy.a")]);
  const reverse = createValidationRunResult("content", [createReference("enemy.a"), createReference("enemy.z")]);

  assert.deepEqual(forward, reverse);
  assert.deepEqual(
    forward.output.diagnostics.map((diagnostic) => diagnostic.kind === "reference" && diagnostic.targetId),
    ["enemy.a", "enemy.z"],
  );
});

test("locks every canonical diagnostic ordering tie-breaker", () => {
  const schema = (overrides: Record<string, unknown> = {}): ValidationContentDiagnostic => ({
    kind: "schema",
    code: "same.code",
    severity: "warning",
    message: "same message",
    path: "same.yaml",
    line: 2,
    column: 3,
    endLine: 2,
    endColumn: 4,
    schemaPath: "same.schema",
    sourceId: "same.source",
    ...overrides,
  } as ValidationContentDiagnostic);
  const reference = (overrides: Record<string, unknown> = {}): ValidationContentDiagnostic => ({
    kind: "reference",
    code: "same.code",
    severity: "warning",
    message: "same message",
    path: "same.yaml",
    line: 2,
    column: 3,
    endLine: 2,
    endColumn: 4,
    schemaPath: "same.schema",
    sourceId: "same.source",
    referrerId: "same.referrer",
    targetId: "same.target",
    ...overrides,
  } as ValidationContentDiagnostic);
  const cases: Array<Readonly<{
    name: string;
    first: ValidationContentDiagnostic;
    second: ValidationContentDiagnostic;
    select: (diagnostic: ContentDiagnostic) => unknown;
    expected: unknown;
  }>> = [
    { name: "source", first: schema({ path: "a.yaml" }), second: schema({ path: "b.yaml" }), select: (d) => "path" in d && d.path, expected: "a.yaml" },
    { name: "line", first: schema({ line: 1, endLine: 2 }), second: schema({ line: 2, endLine: 2 }), select: (d) => "line" in d && d.line, expected: 1 },
    { name: "column", first: schema({ column: 2 }), second: schema({ column: 3 }), select: (d) => "column" in d && d.column, expected: 2 },
    { name: "endLine", first: schema({ endLine: 2 }), second: schema({ endLine: 3 }), select: (d) => "endLine" in d && d.endLine, expected: 2 },
    { name: "endColumn", first: schema({ endColumn: 4 }), second: schema({ endColumn: 5 }), select: (d) => "endColumn" in d && d.endColumn, expected: 4 },
    { name: "kind", first: schema({ kind: "parse" }), second: schema({ kind: "schema" }), select: (d) => d.kind, expected: "parse" },
    { name: "severity", first: schema({ severity: "error" }), second: schema({ severity: "info" }), select: (d) => d.severity, expected: "error" },
    { name: "code", first: schema({ code: "a.code" }), second: schema({ code: "b.code" }), select: (d) => d.code, expected: "a.code" },
    { name: "message", first: schema({ message: "a message" }), second: schema({ message: "b message" }), select: (d) => d.message, expected: "a message" },
    { name: "schemaPath", first: schema({ schemaPath: "a.schema" }), second: schema({ schemaPath: "b.schema" }), select: (d) => "schemaPath" in d && d.schemaPath, expected: "a.schema" },
    { name: "sourceId", first: schema({ sourceId: "a.source" }), second: schema({ sourceId: "b.source" }), select: (d) => "sourceId" in d && d.sourceId, expected: "a.source" },
    { name: "referrerId", first: reference({ referrerId: "a.referrer" }), second: reference({ referrerId: "b.referrer" }), select: (d) => d.kind === "reference" && d.referrerId, expected: "a.referrer" },
    { name: "targetId", first: reference({ targetId: "a.target" }), second: reference({ targetId: "b.target" }), select: (d) => d.kind === "reference" && d.targetId, expected: "a.target" },
  ];

  for (const { name, first, second, select, expected } of cases) {
    const result = createValidationRunResult("content", [second, first]);
    const expectedExitCode = first.severity === "error" || second.severity === "error" ? 1 : 0;
    assert.equal(result.exitCode, expectedExitCode, `${name} case returned an unexpected exit code`);
    assert.equal(select(result.output.diagnostics[0]!), expected, `${name} tie-breaker changed`);
  }
});

test("keeps warning-only validation non-blocking", () => {
  const result = createValidationRunResult("fixtures/content-minimum", [
    {
      kind: "schema",
      code: "content.unused",
      severity: "warning",
      message: "Unused definition",
      path: "fixtures/enemy.yaml",
      line: 1,
      column: 1,
      schemaPath: "content.enemies[0]",
    },
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.output.ok, true);
  assert.deepEqual(result.output.summary, { errors: 0, warnings: 1, infos: 0 });
});

test("turns malformed runtime diagnostics into tool errors", () => {
  const unknownSeverity = createValidationRunResult("fixtures/content-minimum", [
    { kind: "tool", code: "x", severity: "fatal", message: "bad" },
  ] as unknown as ValidationContentDiagnostic[]);
  const incompleteReference = createValidationRunResult("fixtures/content-minimum", [
    { kind: "reference", code: "x", severity: "error", message: "bad" },
  ] as unknown as ValidationContentDiagnostic[]);
  const reversedSourceEnd = createValidationRunResult("fixtures/content-minimum", [
    {
      kind: "schema",
      code: "x",
      severity: "error",
      message: "bad",
      path: "bad.yaml",
      line: 2,
      column: 5,
      endLine: 2,
      endColumn: 4,
      schemaPath: "x",
    },
  ]);

  for (const result of [unknownSeverity, incompleteReference, reversedSourceEnd]) {
    assert.equal(result.exitCode, 2);
    assert.equal(result.output.ok, false);
    assert.equal(result.output.diagnostics[0]?.kind, "tool");
    assert.equal(result.output.diagnostics[0]?.code, "tool.invalidDiagnostic");
  }
});

test("rejects each required runtime diagnostic field independently", () => {
  const cases: Array<Readonly<{ diagnostic: Record<string, unknown>; requiredFields: readonly string[] }>> = [
    {
      diagnostic: {
        kind: "parse",
        code: "yaml.parse",
        severity: "error",
        message: "Invalid YAML",
        path: "game.yaml",
        line: 1,
        column: 2,
        schemaPath: "$",
      },
      requiredFields: ["kind", "code", "severity", "message", "path", "line", "column", "schemaPath"],
    },
    {
      diagnostic: {
        kind: "schema",
        code: "definition.invalidShape",
        severity: "error",
        message: "Invalid field",
        path: "player.yaml",
        line: 2,
        column: 3,
        schemaPath: "content.players[0]",
      },
      requiredFields: ["kind", "code", "severity", "message", "path", "line", "column", "schemaPath"],
    },
    {
      diagnostic: {
        kind: "reference",
        code: "enemy.notFound",
        severity: "error",
        message: "Enemy not found",
        path: "stage.yaml",
        line: 3,
        column: 4,
        referrerId: "stage.stage_01",
        targetId: "enemy.missing",
      },
      requiredFields: ["kind", "code", "severity", "message", "path", "line", "column", "referrerId", "targetId"],
    },
    {
      diagnostic: {
        kind: "featureGate",
        code: "feature.unsupported",
        severity: "error",
        message: "Feature disabled",
        sourceId: "player.default",
        schemaPath: "content.players[0].bomb",
      },
      requiredFields: ["kind", "code", "severity", "message", "sourceId", "schemaPath"],
    },
    {
      diagnostic: {
        kind: "tool",
        code: "tool.readFailed",
        severity: "error",
        message: "Read failed",
      },
      requiredFields: ["kind", "code", "severity", "message"],
    },
  ];

  for (const { diagnostic, requiredFields } of cases) {
    for (const field of requiredFields) {
      const candidate = { ...diagnostic };
      delete candidate[field];
      const result = createValidationRunResult(
        "fixtures/content-minimum",
        [candidate] as unknown as ValidationContentDiagnostic[],
      );
      assert.equal(result.exitCode, 2, `${diagnostic.kind}.${field} must be required`);
      assert.equal(result.output.diagnostics[0]?.code, "tool.invalidDiagnostic");
    }
  }
});

test("classifies a runtime tool diagnostic as exit code two", () => {
  const result = createValidationRunResult("fixtures/content-minimum", [
    { kind: "tool", code: "tool.readFailed", severity: "warning", message: "Read failed" },
  ] as unknown as ValidationContentDiagnostic[]);

  assert.equal(result.exitCode, 2);
  assert.equal(result.output.ok, false);
  assert.equal(result.output.diagnostics[0]?.kind, "tool");
  assert.equal(result.output.diagnostics[0]?.code, "tool.readFailed");
  assert.equal(result.output.diagnostics[0]?.severity, "error");
});

test("rejects accessor diagnostics without rereading validated fields", () => {
  let severityReadCount = 0;
  const diagnostic = {
    kind: "schema",
    code: "definition.invalidShape",
    get severity() {
      severityReadCount += 1;
      return severityReadCount === 1 ? "error" : "fatal";
    },
    message: "Invalid field",
    path: "player.yaml",
    line: 1,
    column: 1,
    schemaPath: "content.players[0]",
  };

  const result = createValidationRunResult(
    "fixtures/content-minimum",
    [diagnostic] as unknown as ValidationContentDiagnostic[],
  );

  assert.equal(severityReadCount, 0);
  assert.equal(result.exitCode, 2);
  assert.equal(result.output.diagnostics[0]?.code, "tool.invalidDiagnostic");
});

test("uses exit code two and immutable output for tool runtime errors", () => {
  const result = createToolErrorRunResult(
    "fixtures/content-minimum",
    "tool.readFailed",
    "Could not read game definition",
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.output.ok, false);
  assert.deepEqual(result.output.summary, { errors: 1, warnings: 0, infos: 0 });
  assert.deepEqual(result.output.diagnostics, [
    {
      kind: "tool",
      code: "tool.readFailed",
      severity: "error",
      message: "Could not read game definition",
    },
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.output), true);
  assert.equal(Object.isFrozen(result.output.diagnostics), true);
  assert.equal(Object.isFrozen(result.output.diagnostics[0]), true);
  assert.equal(Object.isFrozen(result.output.summary), true);
});

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
