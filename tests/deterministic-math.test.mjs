import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { collectTypeScriptFiles, isTestCodeFile } from "./support/source-files.mjs";

const shootingCoreSourceRoot = fileURLToPath(new URL("../packages/shooting-core/src", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * ECMAScript が implementation-approximated と定め、host によって結果が変わり得る Math function。
 *
 * `Math.sqrt`、`Math.abs`、`Math.floor`、`Math.round` などは正確な値（𝔽）を返すため使ってよい。`Math.random` は seed を持たない。
 */
const HOST_DEPENDENT_MATH_FUNCTIONS = Object.freeze(new Set([
  "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh", "cbrt", "cos", "cosh", "exp", "expm1", "hypot",
  "log", "log10", "log1p", "log2", "pow", "random", "sin", "sinh", "tan", "tanh",
]));

test("detects host-dependent Math calls and exponentiation but not exact Math functions", () => {
  const sourceText = [
    "const a = Math.sin(x);",
    "const b = Math.sqrt(x) + Math.abs(y) + Math.floor(z);",
    "const c = x ** 2;",
    "let d = 2; d **= 3;",
    "const e = Math[\"cos\"](x);",
    "const f = Math.random();",
    "/** 2 ** 30 in a comment */",
  ].join("\n");

  assert.deepEqual(findHostDependentMath("example.ts", sourceText), [
    "Math.sin",
    "** operator",
    "**= operator",
    "Math.cos",
    "Math.random",
  ]);
});

test("keeps shooting-core source free of host-dependent math", async () => {
  // replay と state hash を host 間で一致させるため、tick に入り得る Core の source は正確な演算だけを使う（design 9.8 / 10）。
  const files = (await collectTypeScriptFiles(shootingCoreSourceRoot))
    .filter((file) => !isTestCodeFile(shootingCoreSourceRoot, file));
  const violations = [];

  for (const file of files) {
    for (const finding of findHostDependentMath(file, await readFile(file, "utf8"))) {
      violations.push(`${path.relative(repositoryRoot, file)}: ${finding}`);
    }
  }

  assert.deepEqual(violations, [], "use the deterministic sine table and exact operations instead of host-dependent math");
});

/** source 中の host 依存の Math 呼び出しと `**` / `**=` 演算子を出現順に返す。 */
function findHostDependentMath(file, sourceText) {
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = [];
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && isMathIdentifier(node.expression) && HOST_DEPENDENT_MATH_FUNCTIONS.has(node.name.text)) {
      findings.push(`Math.${node.name.text}`);
    } else if (
      ts.isElementAccessExpression(node)
      && isMathIdentifier(node.expression)
      && ts.isStringLiteralLike(node.argumentExpression)
      && HOST_DEPENDENT_MATH_FUNCTIONS.has(node.argumentExpression.text)
    ) {
      findings.push(`Math.${node.argumentExpression.text}`);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken) {
      findings.push("** operator");
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken) {
      findings.push("**= operator");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function isMathIdentifier(node) {
  return ts.isIdentifier(node) && node.text === "Math";
}
