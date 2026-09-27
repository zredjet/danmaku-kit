import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { collectModuleReferences, isRelativeReferenceInside, MODULE_IMPORT_KINDS } from "./support/module-references.mjs";
import { collectTypeScriptFiles, isTestCodeFile } from "./support/source-files.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const shootingCoreSourceRoot = path.join(repositoryRoot, "packages/shooting-core/src");
const sampleTitleSourceRoot = path.join(repositoryRoot, "apps/sample-title/src");
const sourceRoots = [
  shootingCoreSourceRoot,
  path.join(repositoryRoot, "tools/validate-content/src"),
  sampleTitleSourceRoot,
];
const shootingCoreBasicRoot = path.join(repositoryRoot, "packages/shooting-core/src/basic");

/**
 * shooting-core `src/basic/` の依存方向。`target` を import してよいのは同じ layer と `allowedImporters` だけ。
 *
 * 型 import も依存方向に含める。path は `src/basic/` からの相対で、末尾 `/` は directory 全体を表す。
 */
const SHOOTING_CORE_LAYER_RULES = Object.freeze([
  { target: "core.ts", allowedImporters: ["index.ts", "testing/testing-hooks.ts"] },
  { target: "session/", allowedImporters: ["core.ts"] },
  { target: "serialization/restore/", allowedImporters: ["session/"] },
  { target: "serialization/restore-plain-data.ts", allowedImporters: ["serialization/restore/", "entities/restore-common.ts", "entities/*/restore.ts"] },
  { target: "entities/*/snapshot.ts", allowedImporters: ["serialization/types.ts", "state/", "hash/", "entities/*/restore.ts"] },
  { target: "entities/*/restore.ts", allowedImporters: ["serialization/restore/"] },
  { target: "entities/restore-common.ts", allowedImporters: ["serialization/restore/", "entities/*/restore.ts"] },
  { target: "state/", allowedImporters: ["session/", "serialization/restore/", "instrumentation/"] },
  { target: "instrumentation/", allowedImporters: ["core.ts", "session/", "testing/"] },
  { target: "hash/", allowedImporters: ["state/hashable-projection.ts", "instrumentation/", "testing/"] },
  { target: "testing/", allowedImporters: [] },
]);

/**
 * shooting-core `src/basic/` の最下層 layer。`importer` 配下の module は同じ layer と `allowedTargets` 以外を import しない。
 *
 * 型 import も含める。path の表記は `SHOOTING_CORE_LAYER_RULES` と同じ。
 */
const SHOOTING_CORE_LEAF_LAYER_RULES = Object.freeze([
  { importer: "shared/", allowedTargets: [] },
]);

/** root export から runtime import で到達させない test / tooling 専用 module。state hash と debug dump は test 側で計算する。 */
const SHOOTING_CORE_RUNTIME_EXCLUDED_MODULES = Object.freeze(["hash/", "testing/"]);

/**
 * sample app の `src/` が package 名で import してよい package と、それを import してよい module。
 *
 * `src/` は browser bundle に入るため、ここに無い package、`node:`、Core の deep import、validate-content は型 import も含めて
 * import しない。`phaser` は Phaser adapter と entry に閉じ込め、それ以外の runtime module を node:test で検査できるようにする。
 * Vite の virtual module は `import.meta` と同じく entry だけが読み、他の module へは引数で渡す。
 * path は `apps/sample-title/src/` からの相対で、表記は `SHOOTING_CORE_LAYER_RULES` と同じ。
 */
const SAMPLE_TITLE_PACKAGE_IMPORT_RULES = Object.freeze([
  { specifier: "@shooting-sample/shooting-core", allowedImporters: ["main.ts", "runtime/", "virtual-modules.d.ts"] },
  { specifier: "phaser", allowedImporters: ["main.ts", "runtime/phaser/"] },
  { specifier: "virtual:sample-title/game-definition", allowedImporters: ["main.ts"] },
]);

/** `import.meta`（Vite 固有の `import.meta.env` など）を読んでよい sample app の module。他の module へは引数で渡す。 */
const SAMPLE_TITLE_IMPORT_META_READERS = Object.freeze(["main.ts"]);

/**
 * sample app `src/` の依存方向。`target` を import してよいのは同じ layer と `allowedImporters` だけ。
 *
 * DOM の overlay（`ui/`）、dev / test build 専用の debug hook（`debug/`）、Phaser adapter（`runtime/phaser/`）は entry だけが組み立て、
 * それ以外の runtime module は DOM と Phaser なしで node:test から検査できる形に保つ。型 import も含め、path の表記は
 * `SHOOTING_CORE_LAYER_RULES` と同じ。
 */
const SAMPLE_TITLE_LAYER_RULES = Object.freeze([
  { target: "main.ts", allowedImporters: [] },
  { target: "ui/", allowedImporters: ["main.ts"] },
  { target: "debug/", allowedImporters: ["main.ts"] },
  { target: "runtime/phaser/", allowedImporters: ["main.ts"] },
]);

test("matches dependency rule paths by file, directory, and single-segment wildcard", () => {
  const cases = [
    ["core.ts", "core.ts", true],
    ["core.test.ts", "core.ts", false],
    ["state/committed-state.ts", "state/", true],
    ["statefoo/committed-state.ts", "state/", false],
    ["entities/player/restore.ts", "entities/*/restore.ts", true],
    ["entities/restore.ts", "entities/*/restore.ts", false],
    ["entities/player/nested/restore.ts", "entities/*/restore.ts", false],
    ["entities/player/restore.test.ts", "entities/*/restore.ts", false],
    ["entities/player/model.ts", "entities/*/", true],
    ["entities/model-common.ts", "entities/*/", false],
  ];

  assert.deepEqual(
    cases.map(([modulePath, rulePath]) => matchesModulePath(modulePath, rulePath)),
    cases.map(([, , expected]) => expected),
  );
});

test("collects every module reference form and accepts only relative paths inside shooting-core src", () => {
  const file = path.join(shootingCoreBasicRoot, "session/example.ts");
  const sourceText = [
    "/// <reference types=\"node\" />",
    "/// <reference lib=\"dom\" />",
    "import { a } from \"./a.ts\";",
    "import type { B } from \"phaser\";",
    "export { c } from \"../shared/c.ts\";",
    "export type { D } from \"node:fs\";",
    "import e = require(\"vite\");",
    "const f = await import(\"../../../../../node_modules/phaser/src/phaser.js\");",
    "const g = await import(name);",
    "type H = import(\"../api-types.ts\").GameFrame;",
    "export { i } from \"./..hidden.ts\";",
  ].join("\n");

  assert.deepEqual(
    collectModuleReferences(file, sourceText)
      .map((reference) => [reference.kind, reference.specifier, isRelativeReferenceInside(file, reference, shootingCoreSourceRoot)]),
    [
      ["referenceTypes", "node", false],
      ["referenceLib", "dom", false],
      ["import", "./a.ts", true],
      ["import", "phaser", false],
      ["export", "../shared/c.ts", true],
      ["export", "node:fs", false],
      ["importEquals", "vite", false],
      ["dynamicImport", "../../../../../node_modules/phaser/src/phaser.js", false],
      ["dynamicImport", null, false],
      ["importType", "../api-types.ts", true],
      ["export", "./..hidden.ts", true],
    ],
  );
});

test("keeps shooting-core source free of package and platform imports", async () => {
  // apps が phaser / vite を root node_modules へ hoist しても、Core から bare specifier で解決させない。
  const files = (await collectTypeScriptFiles(shootingCoreSourceRoot))
    .filter((file) => !isTestCodeFile(shootingCoreSourceRoot, file));
  const violations = [];

  for (const file of files) {
    const sourceText = await readFile(file, "utf8");
    for (const reference of collectModuleReferences(file, sourceText)) {
      if (!isRelativeReferenceInside(file, reference, shootingCoreSourceRoot)) {
        violations.push(`${toRepositoryPath(file)} -> ${reference.kind} ${reference.specifier ?? "(non-literal)"}`);
      }
    }
  }

  assert.deepEqual(violations, [], "shooting-core source must import only its own modules by relative path");
});

test("keeps sample app source on the shooting-core root export and its allowed packages", async () => {
  const violations = [];

  for (const file of await collectSampleTitleSourceFiles()) {
    const importer = toSampleTitlePath(file);
    const sourceText = await readFile(file, "utf8");
    for (const reference of collectModuleReferences(file, sourceText)) {
      if (isRelativeReferenceInside(file, reference, sampleTitleSourceRoot)) {
        continue;
      }
      const rule = MODULE_IMPORT_KINDS.includes(reference.kind)
        ? SAMPLE_TITLE_PACKAGE_IMPORT_RULES.find((candidate) => candidate.specifier === reference.specifier)
        : undefined;
      if (!rule?.allowedImporters.some((allowed) => matchesModulePath(importer, allowed))) {
        violations.push(`${importer} -> ${reference.kind} ${reference.specifier ?? "(non-literal)"}`);
      }
    }
  }

  assert.deepEqual(violations, [], "sample app source must import Core by its root export and only the allowed packages");
});

test("detects import.meta reads but not dynamic import or ordinary meta properties", () => {
  const file = path.join(sampleTitleSourceRoot, "runtime/example.ts");
  const sourceTexts = [
    "const base = import.meta.env.BASE_URL;",
    "const url = new URL(\"./a.svg\", import.meta.url);",
    "const loaded = await import(\"./a.ts\");",
    "const meta = { env: {} };\nconst env = meta.env;",
  ];

  assert.deepEqual(sourceTexts.map((sourceText) => readsImportMeta(file, sourceText)), [true, true, false, false]);
});

test("reads import.meta only in the sample app entry", async () => {
  const violations = [];

  for (const file of await collectSampleTitleSourceFiles()) {
    const importer = toSampleTitlePath(file);
    if (SAMPLE_TITLE_IMPORT_META_READERS.some((allowed) => matchesModulePath(importer, allowed))) {
      continue;
    }
    if (readsImportMeta(file, await readFile(file, "utf8"))) {
      violations.push(importer);
    }
  }

  assert.deepEqual(violations, [], "only the sample app entry may read import.meta");
});

test("points sample app import rules at existing modules", async () => {
  const modulePaths = (await collectSampleTitleSourceFiles()).map(toSampleTitlePath);
  const rulePaths = [
    ...SAMPLE_TITLE_PACKAGE_IMPORT_RULES.flatMap((rule) => rule.allowedImporters),
    ...SAMPLE_TITLE_IMPORT_META_READERS,
    ...SAMPLE_TITLE_LAYER_RULES.flatMap((rule) => [rule.target, ...rule.allowedImporters]),
  ];
  const stale = [...new Set(rulePaths)]
    .filter((rulePath) => !modulePaths.some((modulePath) => matchesModulePath(modulePath, rulePath)));

  assert.deepEqual(stale, [], "sample app import rules must name existing modules");
});

test("keeps sample app modules inside their dependency layers", async () => {
  const graph = await collectImportGraph(sampleTitleSourceRoot, { includeTypeOnly: true });
  const violations = [];

  for (const [file, targets] of graph) {
    const importer = toSampleTitlePath(file);
    for (const target of targets.map(toSampleTitlePath)) {
      for (const rule of SAMPLE_TITLE_LAYER_RULES) {
        if (!matchesModulePath(target, rule.target) || matchesModulePath(importer, rule.target)) {
          continue;
        }
        if (!rule.allowedImporters.some((allowed) => matchesModulePath(importer, allowed))) {
          violations.push(`${importer} -> ${target}`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], "sample app imports cross a dependency layer rule");
});

test("keeps package source free of runtime import cycles", async () => {
  for (const sourceRoot of sourceRoots) {
    const graph = await collectRuntimeImportGraph(sourceRoot);
    const cycles = findCycles(graph).map((cycle) => cycle.map((file) => toRepositoryPath(file)));

    assert.deepEqual(cycles, [], `${toRepositoryPath(sourceRoot)} has runtime import cycles`);
  }
});

test("keeps shooting-core source free of type-level import cycles", async () => {
  const graph = await collectImportGraph(shootingCoreBasicRoot, { includeTypeOnly: true });
  const cycles = findCycles(graph).map((cycle) => cycle.map((file) => toRepositoryPath(file)));

  assert.deepEqual(cycles, [], "shooting-core has import cycles including type-only imports");
});

test("keeps package source from importing test code", async () => {
  const violations = [];

  for (const sourceRoot of sourceRoots) {
    const files = (await collectTypeScriptFiles(sourceRoot)).filter((file) => !isTestCodeFile(sourceRoot, file));
    for (const file of files) {
      const sourceText = await readFile(file, "utf8");
      for (const specifier of collectRelativeSpecifiers(file, sourceText, { includeTypeOnly: true })) {
        const target = path.resolve(path.dirname(file), specifier);
        if (isTestCodeFile(sourceRoot, target)) {
          violations.push(`${toRepositoryPath(file)} -> ${toRepositoryPath(target)}`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], "package source imports test-only code");
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
      for (const rule of SHOOTING_CORE_LEAF_LAYER_RULES) {
        if (!matchesModulePath(importer, rule.importer) || matchesModulePath(target, rule.importer)) {
          continue;
        }
        if (!rule.allowedTargets.some((allowed) => matchesModulePath(target, allowed))) {
          violations.push(`${importer} -> ${target}`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], "shooting-core imports cross a dependency layer rule");
});

test("keeps entity kind directories independent of each other", async () => {
  const graph = await collectImportGraph(shootingCoreBasicRoot, { includeTypeOnly: true });
  const violations = [];

  for (const [file, targets] of graph) {
    const importer = toBasicPath(file);
    const importerKind = entityKindDirectory(importer);
    if (importerKind === null) {
      continue;
    }
    for (const target of targets.map(toBasicPath)) {
      const targetKind = entityKindDirectory(target);
      if (targetKind !== null && targetKind !== importerKind) {
        violations.push(`${importer} -> ${target}`);
      }
    }
  }

  assert.deepEqual(violations, [], "entity kind directories must not import another kind");
});

test("points shooting-core dependency rules at existing modules", async () => {
  const modulePaths = (await collectTypeScriptFiles(shootingCoreBasicRoot))
    .filter((file) => !isTestCodeFile(shootingCoreBasicRoot, file))
    .map(toBasicPath);
  const rulePaths = [
    ...SHOOTING_CORE_LAYER_RULES.flatMap((rule) => [rule.target, ...rule.allowedImporters]),
    ...SHOOTING_CORE_LEAF_LAYER_RULES.flatMap((rule) => [rule.importer, ...rule.allowedTargets]),
    ...SHOOTING_CORE_RUNTIME_EXCLUDED_MODULES,
  ];
  const stale = [...new Set(rulePaths)]
    .filter((rulePath) => !modulePaths.some((modulePath) => matchesModulePath(modulePath, rulePath)));

  assert.deepEqual(stale, [], "dependency rules must name existing shooting-core modules");
});

test("keeps test-only diagnostics out of the shooting-core runtime import graph", async () => {
  const graph = await collectImportGraph(shootingCoreBasicRoot, { includeTypeOnly: false });
  const reachable = collectReachableFiles(graph, path.join(shootingCoreBasicRoot, "index.ts"));
  const leaked = reachable
    .map(toBasicPath)
    .filter((modulePath) => SHOOTING_CORE_RUNTIME_EXCLUDED_MODULES.some((excluded) => matchesModulePath(modulePath, excluded)));

  assert.deepEqual(leaked, [], "root export loads test-only modules at runtime");
});

/** `entities/<kind>/` 配下の module なら kind directory 名を、それ以外なら null を返す。 */
function entityKindDirectory(modulePath) {
  return /^entities\/([^/]+)\//.exec(modulePath)?.[1] ?? null;
}

/** entry から graph の edge をたどって到達できる file を path 順に返す。 */
function collectReachableFiles(graph, entry) {
  const reachable = new Set([entry]);
  const pending = [entry];
  while (pending.length > 0) {
    for (const target of graph.get(pending.pop()) ?? []) {
      if (!reachable.has(target)) {
        reachable.add(target);
        pending.push(target);
      }
    }
  }
  return [...reachable].sort();
}

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
  const files = (await collectTypeScriptFiles(sourceRoot)).filter((file) => !isTestCodeFile(sourceRoot, file));
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

/** source が `import.meta` を読むかを返す。dynamic `import()` は含めない。 */
function readsImportMeta(file, sourceText) {
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node) =>
    (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) || ts.forEachChild(node, visit);
  return ts.forEachChild(sourceFile, visit) === true;
}

/** sample app の `src/` から test 以外の source を path 順に返す。 */
async function collectSampleTitleSourceFiles() {
  return (await collectTypeScriptFiles(sampleTitleSourceRoot)).filter((file) => !isTestCodeFile(sampleTitleSourceRoot, file));
}

function toSampleTitlePath(file) {
  return path.relative(sampleTitleSourceRoot, file).split(path.sep).join("/");
}

/**
 * layer rule の path（file、または末尾 `/` の directory）に module path が含まれるか判定する。
 *
 * `*` は `/` を含まない1 segment に一致し、entity kind ごとの directory をまとめて指定するのに使う。
 */
function matchesModulePath(modulePath, rulePath) {
  if (!rulePath.includes("*")) {
    return rulePath.endsWith("/") ? modulePath.startsWith(rulePath) : modulePath === rulePath;
  }
  const pattern = rulePath.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+");
  return new RegExp(rulePath.endsWith("/") ? `^${pattern}` : `^${pattern}$`).test(modulePath);
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

function toRepositoryPath(file) {
  return path.relative(repositoryRoot, file).split(path.sep).join("/");
}
