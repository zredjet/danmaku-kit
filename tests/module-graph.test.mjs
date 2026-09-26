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
const shootingCoreBasicRoot = path.join(repositoryRoot, "packages/shooting-core/src/basic");

/**
 * shooting-core `src/basic/` の依存方向。`target` を import してよいのは同じ layer と `allowedImporters` だけ。
 *
 * 型 import も依存方向に含める。path は `src/basic/` からの相対で、末尾 `/` は directory 全体を表す。
 */
const SHOOTING_CORE_LAYER_RULES = Object.freeze([
  { target: "core.ts", allowedImporters: ["index.ts", "internal/testing-hooks.ts"] },
  { target: "session/", allowedImporters: ["core.ts"] },
  { target: "serialization/restore/", allowedImporters: ["session/"] },
  { target: "state/", allowedImporters: ["session/", "serialization/restore/", "internal/"] },
]);

test("keeps package source free of runtime import cycles", async () => {
  for (const sourceRoot of sourceRoots) {
    const graph = await collectRuntimeImportGraph(sourceRoot);
    const cycles = findCycles(graph).map((cycle) => cycle.map((file) => toRepositoryPath(file)));

    assert.deepEqual(cycles, [], `${toRepositoryPath(sourceRoot)} has runtime import cycles`);
  }
});

test("keeps shooting-core modules inside their dependency layers", async () => {
  const graph = await collectImportGraph(shootingCoreBasicRoot, { includeTypeOnly: true });
  const violations = [];

  for (const [file, targets] of graph) {
    const importer = toBasicPath(file);
    for (const target of targets.map(toBasicPath)) {
      for (const rule of SHOOTING_CORE_LAYER_RULES) {
        if (!matchesModulePath(target, rule.target) || matchesModulePath(importer, rule.target)) {
          continue;
        }
        if (!rule.allowedImporters.some((allowed) => matchesModulePath(importer, allowed))) {
          violations.push(`${importer} -> ${target}`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], "shooting-core imports cross a dependency layer rule");
});

/**
 * test 以外の source から、実行時に module 読み込みを発生させる相対 import だけの graph を作る。
 *
 * `import type` / `export type` は type stripping で消えるため除外する。`import { type X }` は
 * 空の import として残り得るため、保守的に runtime edge として扱う。
 */
async function collectRuntimeImportGraph(sourceRoot) {
  return collectImportGraph(sourceRoot, { includeTypeOnly: false });
}

/** test 以外の source の相対 import graph を作る。`includeTypeOnly` で型だけの依存も含める。 */
async function collectImportGraph(sourceRoot, { includeTypeOnly }) {
  const files = (await collectTypeScriptFiles(sourceRoot)).filter((file) => !isTestCodeFile(file));
  const graph = new Map();

  for (const file of files) {
    const sourceText = await readFile(file, "utf8");
    const edges = collectRelativeSpecifiers(file, sourceText, { includeTypeOnly })
      .map((specifier) => path.resolve(path.dirname(file), specifier))
      .filter((target) => files.includes(target));
    graph.set(file, [...new Set(edges)].sort());
  }

  return graph;
}

function collectRelativeSpecifiers(file, sourceText, { includeTypeOnly }) {
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly && !includeTypeOnly) {
        continue;
      }
      specifiers.push(statement.moduleSpecifier.text);
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && (includeTypeOnly || !statement.isTypeOnly)) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }

  return specifiers.filter((specifier) => specifier.startsWith("."));
}

/** layer rule の path（file、または末尾 `/` の directory）に module path が含まれるか判定する。 */
function matchesModulePath(modulePath, rulePath) {
  return rulePath.endsWith("/") ? modulePath.startsWith(rulePath) : modulePath === rulePath;
}

function toBasicPath(file) {
  return path.relative(shootingCoreBasicRoot, file).split(path.sep).join("/");
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
