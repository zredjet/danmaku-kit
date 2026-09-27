import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { VALIDATE_CONTENT_DIAGNOSTIC_CODES } from "@shooting-sample/validate-content";

import { collectTypeScriptFiles, isTestCodeFile } from "./support/source-files.mjs";

// content authoring の error guide（design 19、Phase 2B-12）の見出しが、診断の code の一覧と過不足なく一致することを確かめる。

const guidePath = fileURLToPath(new URL("../docs/content-authoring/error-guide.md", import.meta.url));
const coreSourceRoot = fileURLToPath(new URL("../packages/shooting-core/src", import.meta.url));
const coreResultPath = path.join(coreSourceRoot, "basic/result.ts");
/** test と tooling 専用の診断（headless replay、debug dump、test hook の state 検査）を出す directory。content の guide には載せない。 */
const TEST_TOOLING_DIRECTORIES = Object.freeze(["basic/testing", "basic/instrumentation"]);
/** YAML parser の error code から作る `yaml.parse.<code>` を 1 つにまとめた見出し。 */
const YAML_PARSER_HEADING = "yaml.parse.*";
/** 各 code の節に要る項目。 */
const REQUIRED_ITEMS = Object.freeze(["- 重要度:", "- 原因:", "- 直し方:"]);

function parseSource(file, sourceText) {
  return ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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

/**
 * Core の非 test source で、object literal の `code` に書いた文字列 literal（error と warning）。warning の code は string のままの型
 * なので、source から集める。
 */
async function collectCoreLiteralCodes() {
  const codes = new Set();
  for (const file of await collectTypeScriptFiles(coreSourceRoot)) {
    const relative = path.relative(coreSourceRoot, file).split(path.sep).join("/");
    if (isTestCodeFile(coreSourceRoot, file) || TEST_TOOLING_DIRECTORIES.some((directory) => relative.startsWith(`${directory}/`))) {
      continue;
    }
    const visit = (node) => {
      if (
        ts.isPropertyAssignment(node)
        && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
        && node.name.text === "code"
        && ts.isStringLiteralLike(node.initializer)
      ) {
        codes.add(node.initializer.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(parseSource(file, await readFile(file, "utf8")));
  }
  return codes;
}

/** guide の `### \`code\`` の見出しと、その節の本文。 */
async function readGuideSections() {
  const guide = await readFile(guidePath, "utf8");
  const sections = new Map();
  let current = null;
  for (const line of guide.split("\n")) {
    const heading = /^### `([^`]+)`$/u.exec(line);
    if (heading) {
      assert.ok(!sections.has(heading[1]), `duplicate heading ${heading[1]}`);
      current = [];
      sections.set(heading[1], current);
    } else if (/^#{1,3} /u.test(line)) {
      current = null;
    } else {
      current?.push(line);
    }
  }
  return sections;
}

test("has a heading for every Core error, Core warning and validate-content code and no other", async () => {
  const coreErrorCodes = await readCoreErrorCodes();
  const coreWarningCodes = [...await collectCoreLiteralCodes()].filter((code) => !coreErrorCodes.includes(code));
  const expected = [...new Set([...coreErrorCodes, ...coreWarningCodes, ...VALIDATE_CONTENT_DIAGNOSTIC_CODES, YAML_PARSER_HEADING])].sort();

  assert.ok(coreWarningCodes.includes("pattern.neverFires"), "the Core warning codes must be collected from the source");
  assert.deepEqual([...(await readGuideSections()).keys()].sort(), expected);
});

test("gives every code the severity, the cause and the fix", async () => {
  const missing = [...await readGuideSections()].flatMap(([code, lines]) => REQUIRED_ITEMS
    .filter((item) => !lines.some((line) => line.startsWith(item)))
    .map((item) => `${code} ${item}`));

  assert.deepEqual(missing, []);
});
