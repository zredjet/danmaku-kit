import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoots = [
  path.join(repositoryRoot, "packages/shooting-core/src"),
  path.join(repositoryRoot, "tools/validate-content/src"),
];

test("keeps package source free of runtime import cycles", async () => {
  for (const sourceRoot of sourceRoots) {
    const graph = await collectRuntimeImportGraph(sourceRoot);
    const cycles = findCycles(graph).map((cycle) => cycle.map((file) => toRepositoryPath(file)));

    assert.deepEqual(cycles, [], `${toRepositoryPath(sourceRoot)} has runtime import cycles`);
  }
});

/**
 * test 以外の source から、実行時に module 読み込みを発生させる相対 import だけの graph を作る。
 *
 * `import type` / `export type` は type stripping で消えるため除外する。`import { type X }` は
 * 空の import として残り得るため、保守的に runtime edge として扱う。
 */
async function collectRuntimeImportGraph(sourceRoot) {
  const files = (await collectTypeScriptFiles(sourceRoot)).filter((file) => !isTestCodeFile(file));
  const graph = new Map();

  for (const file of files) {
    const sourceText = await readFile(file, "utf8");
    const edges = collectRuntimeRelativeSpecifiers(file, sourceText)
      .map((specifier) => path.resolve(path.dirname(file), specifier))
      .filter((target) => files.includes(target));
    graph.set(file, [...new Set(edges)].sort());
  }

  return graph;
}

function collectRuntimeRelativeSpecifiers(file, sourceText) {
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) {
        continue;
      }
      specifiers.push(statement.moduleSpecifier.text);
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }

  return specifiers.filter((specifier) => specifier.startsWith("."));
}

/** 各 strongly connected component を、最小 path から始まる安定した順の cycle として返す。 */
function findCycles(graph) {
  const indexByFile = new Map();
  const lowLinkByFile = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let nextIndex = 0;

  const visit = (file) => {
    indexByFile.set(file, nextIndex);
    lowLinkByFile.set(file, nextIndex);
    nextIndex += 1;
    stack.push(file);
    onStack.add(file);

    for (const target of graph.get(file) ?? []) {
      if (!indexByFile.has(target)) {
        visit(target);
        lowLinkByFile.set(file, Math.min(lowLinkByFile.get(file), lowLinkByFile.get(target)));
      } else if (onStack.has(target)) {
        lowLinkByFile.set(file, Math.min(lowLinkByFile.get(file), indexByFile.get(target)));
      }
    }

    if (lowLinkByFile.get(file) === indexByFile.get(file)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== file);
      const isSelfImport = component.length === 1 && (graph.get(file) ?? []).includes(file);
      if (component.length > 1 || isSelfImport) {
        components.push(component.sort());
      }
    }
  };

  for (const file of [...graph.keys()].sort()) {
    if (!indexByFile.has(file)) {
      visit(file);
    }
  }

  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

/** `*.test.ts` と test 専用 helper の `test-support/` は package runtime source から除く。 */
function isTestCodeFile(file) {
  return file.endsWith(".test.ts") || file.split(path.sep).includes("test-support");
}

function toRepositoryPath(file) {
  return path.relative(repositoryRoot, file).split(path.sep).join("/");
}

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}
