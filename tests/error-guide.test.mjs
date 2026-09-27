import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { VALIDATE_CONTENT_DIAGNOSTIC_CODES } from "@shooting-sample/validate-content";

import { collectTypeScriptFiles, isTestCodeFile } from "./support/source-files.mjs";

// content authoring の error guide（design 19、Phase 2B-12）の見出しが診断の code の一覧と過不足なく一致し、各節が重要度、原因、
// 直し方（content の診断なら schema path も）を持つことを確かめる。

const guidePath = fileURLToPath(new URL("../docs/content-authoring/error-guide.md", import.meta.url));
const coreSourceRoot = fileURLToPath(new URL("../packages/shooting-core/src", import.meta.url));
const coreResultPath = path.join(coreSourceRoot, "basic/result.ts");
const validateContentSourceRoot = fileURLToPath(new URL("../tools/validate-content/src", import.meta.url));
/**
 * test と tooling 専用の診断（headless replay の検査と debug dump の `replay.*` / `debugState.*`）を出す directory。package の export
 * にも app にも出ないので、content の guide には載せない。
 */
const TEST_TOOLING_DIRECTORIES = Object.freeze(["basic/testing"]);
/** YAML parser の error code から作る `yaml.parse.<code>` を 1 つにまとめた見出し。 */
const YAML_PARSER_HEADING = "yaml.parse.*";
/**
 * content の検証ではなく、Core API の呼び出し（stage の開始、tick、restore）と validate-content の tool error の code。これら以外の
 * 節は `- schema path:` を持つ。
 */
const CALLER_CODE_PREFIXES = Object.freeze(["startStage.", "input.", "stageSession.", "state.", "testHook.", "tool."]);
const CALLER_CODES = Object.freeze([
  "stage.notFound",
  "player.notFound",
  "difficulty.notSupported",
  "enemyBullet.budgetExceeded",
  "pickup.budgetExceeded",
  "pattern.budgetExceeded",
  "entityAllocator.invalidState",
  "prng.invalidState",
]);

function parseSource(file, sourceText) {
  return ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** `as`、`satisfies`、括弧、`!` を外した式。 */
function unwrapExpression(node) {
  let current = node;
  while (
    ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** 式が取り得る文字列 literal（三項演算子は両方の枝）。 */
function stringLiteralsOf(node) {
  const expression = unwrapExpression(node);
  if (ts.isStringLiteralLike(expression)) {
    return [expression.text];
  }
  if (ts.isConditionalExpression(expression)) {
    return [...stringLiteralsOf(expression.whenTrue), ...stringLiteralsOf(expression.whenFalse)];
  }
  return [];
}

/** `result.ts` の `CoreErrorCode` の union の文字列 literal。 */
async function readCoreErrorCodes() {
  const source = parseSource(coreResultPath, await readFile(coreResultPath, "utf8"));
  const alias = source.statements.find((statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === "CoreErrorCode");
  assert.ok(alias && ts.isUnionTypeNode(alias.type), "CoreErrorCode must be a union of string literals");
  return alias.type.types.map((member) => {
    assert.ok(ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal));
    return member.literal.text;
  });
}

/** `root` 以下の非 test source の、`skip` に当たらない file を AST で返す。 */
async function readSources(root, skip = () => false) {
  const sources = [];
  for (const file of await collectTypeScriptFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (!isTestCodeFile(root, file) && !skip(relative)) {
      sources.push(parseSource(file, await readFile(file, "utf8")));
    }
  }
  return sources;
}

function visitAll(sources, visit) {
  const walk = (node) => {
    visit(node);
    ts.forEachChild(node, walk);
  };
  sources.forEach(walk);
}

/**
 * Core の非 test source で、object literal の `code` に書いた文字列 literal（error と warning）。warning の code は string のままの型
 * なので、source から集める。
 */
async function collectCoreLiteralCodes() {
  const codes = new Set();
  const sources = await readSources(
    coreSourceRoot,
    (relative) => TEST_TOOLING_DIRECTORIES.some((directory) => relative.startsWith(`${directory}/`)),
  );
  visitAll(sources, (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === "code") {
      stringLiteralsOf(node.initializer).forEach((code) => codes.add(code));
    }
  });
  return codes;
}

/** validate-content の非 test source（code の一覧の file を除く）の文字列 literal。 */
async function collectValidateContentStringLiterals() {
  const literals = new Set();
  visitAll(await readSources(validateContentSourceRoot, (relative) => relative === "diagnostic-codes.ts"), (node) => {
    if (ts.isStringLiteralLike(node)) {
      literals.add(node.text);
    }
  });
  return literals;
}

/** guide の `### \`code\`` の見出しと、その節の本文（code fence の外の行）。 */
async function readGuideSections() {
  const guide = await readFile(guidePath, "utf8");
  const sections = new Map();
  let current = null;
  let inFence = false;
  for (const line of guide.split("\n")) {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const heading = /^### `([^`]+)`$/u.exec(line);
    if (heading) {
      assert.ok(!sections.has(heading[1]), `duplicate heading ${heading[1]}`);
      current = [];
      sections.set(heading[1], current);
    } else if (/^#{1,6} /u.test(line)) {
      current = null;
    } else {
      current?.push(line);
    }
  }
  assert.equal(inFence, false, "the guide must close every code fence");
  return sections;
}

/** 節の `- <label>: <value>` の value。なければ null。 */
function itemValue(lines, label) {
  const line = lines.find((candidate) => candidate.startsWith(`- ${label}:`));
  return line === undefined ? null : line.slice(`- ${label}:`.length).trim();
}

async function readExpectedSeverities() {
  const coreErrorCodes = await readCoreErrorCodes();
  const coreWarningCodes = [...await collectCoreLiteralCodes()].filter((code) => !coreErrorCodes.includes(code));
  assert.ok(coreWarningCodes.includes("pattern.neverFires"), "the Core warning codes must be collected from the source");
  return new Map([
    ...coreErrorCodes.map((code) => [code, "error"]),
    ...coreWarningCodes.map((code) => [code, "warning"]),
    ...VALIDATE_CONTENT_DIAGNOSTIC_CODES.map((code) => [code, "error"]),
    [YAML_PARSER_HEADING, "error"],
  ]);
}

test("has a heading for every Core error, Core warning and validate-content code and no other", async () => {
  const expected = [...(await readExpectedSeverities()).keys()].sort();

  assert.deepEqual([...(await readGuideSections()).keys()].sort(), expected);
});

test("lists only the validate-content codes that its source still emits", async () => {
  const literals = await collectValidateContentStringLiterals();

  assert.deepEqual(VALIDATE_CONTENT_DIAGNOSTIC_CODES.filter((code) => !literals.has(code)), []);
});

test("gives every code its severity, the cause, the fix and the schema path of content diagnostics", async () => {
  const severities = await readExpectedSeverities();
  const problems = [];
  for (const [code, lines] of await readGuideSections()) {
    const severity = itemValue(lines, "重要度");
    if (severity === null || !severity.startsWith(severities.get(code) ?? "?")) {
      problems.push(`${code} must start its severity with ${severities.get(code)}: ${severity}`);
    }
    for (const label of ["原因", "直し方"]) {
      if (!itemValue(lines, label)) {
        problems.push(`${code} needs ${label}`);
      }
    }
    const callerCode = CALLER_CODES.includes(code) || CALLER_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
    if (!callerCode && !itemValue(lines, "schema path")) {
      problems.push(`${code} needs schema path`);
    }
  }

  assert.deepEqual(problems, []);
});
