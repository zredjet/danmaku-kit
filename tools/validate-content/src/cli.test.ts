import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../tests/fixtures/minimum-game-definition.ts";
import type { LoadContentSourceResult } from "./content-loader.ts";
import type { ContentSourceIndex } from "./content-source-index.ts";
import {
  parseValidateContentArguments,
  runValidateContentCli,
  VALIDATE_CONTENT_USAGE,
  type ValidateContentCliIo,
} from "./cli.ts";

test("parses required CLI options and defaults to human output", () => {
  assert.deepEqual(parseValidateContentArguments([
    "--content-root", "content",
    "--game-definition", "game.yaml",
  ]), {
    ok: true,
    kind: "run",
    options: {
      gameDefinitionPath: "game.yaml",
      contentRoot: "content",
      format: "human",
    },
  });
});

test("rejects unknown, duplicate, missing, and unsupported CLI arguments", () => {
  const cases = [
    { argv: ["--wat"], message: "Unknown option: --wat" },
    { argv: ["--content-root", "a", "--content-root", "b"], message: "Duplicate option: --content-root" },
    { argv: ["--game-definition"], message: "Missing value for --game-definition" },
    { argv: ["--format", "xml"], message: "Unsupported format: xml" },
    { argv: [], message: "--game-definition is required" },
  ];

  for (const { argv, message } of cases) {
    const result = parseValidateContentArguments(argv);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, message);
    }
  }
});

test("prints help without loading content", async () => {
  const capture = createIoCapture();

  const exitCode = await runValidateContentCli(["--help"], capture.io, {
    loadSource: async () => { throw new Error("must not load"); },
  });

  assert.equal(exitCode, 0);
  assert.equal(capture.stdout(), VALIDATE_CONTENT_USAGE);
  assert.equal(capture.stderr(), "");
});

test("prints JSON argument errors with tool exit code two", async () => {
  const capture = createIoCapture();

  const exitCode = await runValidateContentCli(
    ["--format", "json", "--content-root", "content"],
    capture.io,
  );

  assert.equal(exitCode, 2);
  const output = JSON.parse(capture.stdout());
  assert.equal(output.ok, false);
  assert.equal(output.diagnostics[0].code, "tool.invalidArguments");
  assert.equal(capture.stderr(), "");
});

test("keeps JSON argument errors independent from option order", async () => {
  const capture = createIoCapture();

  const exitCode = await runValidateContentCli(["--wat", "--format", "json"], capture.io);

  assert.equal(exitCode, 2);
  assert.equal(JSON.parse(capture.stdout()).diagnostics[0].code, "tool.invalidArguments");
  assert.equal(capture.stderr(), "");
});

test("runs Core validation and emits canonical validation output", async () => {
  const capture = createIoCapture();
  const minimum = createMinimumDefinition();
  const invalid = { ...minimum, schemaVersion: "2" };

  const exitCode = await runValidateContentCli(
    [
      "--game-definition", "game.yaml",
      "--content-root", "content",
      "--format", "json",
    ],
    capture.io,
    { loadSource: async () => loadedSource(invalid) },
  );

  assert.equal(exitCode, 1);
  const output = JSON.parse(capture.stdout());
  assert.equal(output.diagnostics[0].code, "schema.unsupportedVersion");
  assert.equal(output.diagnostics[0].path, "game.yaml");
  assert.deepEqual(output.summary, { errors: 1, warnings: 0, infos: 0 });
});

test("normalizes filesystem failures to tool exit code two", async () => {
  const capture = createIoCapture();
  const error = Object.assign(new Error("game.yaml could not be read"), { code: "EACCES", syscall: "open" });

  const exitCode = await runValidateContentCli(
    ["--game-definition", "game.yaml", "--content-root", "content"],
    capture.io,
    { loadSource: async () => { throw error; } },
  );

  assert.equal(exitCode, 2);
  assert.match(capture.stdout(), /\[ERROR\] tool\.readFailed: game\.yaml could not be read/);
  assert.equal(capture.stderr(), "");
});

test("does not misclassify coded programmer errors as filesystem failures", async () => {
  const capture = createIoCapture();
  const error = Object.assign(new TypeError("invalid internal argument"), { code: "ERR_INVALID_ARG_TYPE" });

  const exitCode = await runValidateContentCli(
    ["--game-definition", "game.yaml", "--content-root", "content"],
    capture.io,
    { loadSource: async () => { throw error; } },
  );

  assert.equal(exitCode, 2);
  assert.match(capture.stdout(), /\[ERROR\] tool\.unexpected: invalid internal argument/);
});

test("uses one-line stderr fallback when stdout cannot be written", async () => {
  const stderr: string[] = [];

  const exitCode = await runValidateContentCli(["--help"], {
    writeStdout() { throw new Error("closed\npipe\u001b"); },
    writeStderr(text) { stderr.push(text); },
  });

  assert.equal(exitCode, 2);
  assert.equal(stderr.join(""), "validate-content could not write stdout: closed\\u000apipe\\u001b\n");
});

test("handles asynchronously rejected stdout writes with the same fallback contract", async () => {
  const stderr: string[] = [];

  const exitCode = await runValidateContentCli(["--help"], {
    async writeStdout() { throw new Error("asynchronous pipe failure"); },
    async writeStderr(text) { stderr.push(text); },
  });

  assert.equal(exitCode, 2);
  assert.equal(stderr.join(""), "validate-content could not write stdout: asynchronous pipe failure\n");
});

function createIoCapture(): Readonly<{
  io: ValidateContentCliIo;
  stdout: () => string;
  stderr: () => string;
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return Object.freeze({
    io: Object.freeze({
      writeStdout(text: string) { stdout.push(text); },
      writeStderr(text: string) { stderr.push(text); },
    }),
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
  });
}

function loadedSource(definition: ReturnType<typeof createMinimumDefinition>): LoadContentSourceResult {
  return Object.freeze({
    ok: true,
    definition,
    assetManifest: Object.freeze({ version: 1, assets: Object.freeze({}) }),
    diagnostics: Object.freeze([]),
    sourceIndex: sourceIndexStub(),
  });
}

function sourceIndexStub(): ContentSourceIndex {
  return Object.freeze({
    locateSchemaPath(schemaPath) {
      return Object.freeze({
        span: Object.freeze({ path: "game.yaml", line: 1, column: 16, endLine: 1, endColumn: 19 }),
        sourceId: "gameDefinition",
        schemaPath,
      });
    },
  });
}
