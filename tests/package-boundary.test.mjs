import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { createMinimumDefinition } from "./fixtures/minimum-game-definition.ts";
import { collectTypeScriptFiles } from "./support/source-files.mjs";

const packageRoot = fileURLToPath(new URL("../packages/core", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const workspacePackageRoots = Object.freeze({
  "@danmaku-kit/core": packageRoot,
  "@danmaku-kit/validate-content": fileURLToPath(new URL("../tools/validate-content", import.meta.url)),
});

test("imports the core through the workspace package export", async () => {
  const core = await import("@danmaku-kit/core");

  assert.deepEqual(Object.keys(core).sort(), ["createDanmakuCore"]);
  assert.equal(typeof core.createDanmakuCore, "function");
});

test("exposes the root export and one entry per optional feature module directory", async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const featureDirectories = await listFeatureDirectories();

  // optional feature は `src/features/<feature>/index.ts` を `./features/<feature>` で公開し、app が `createDanmakuCore()` に渡す。
  assert.deepEqual(packageJson.exports, Object.fromEntries([
    [".", "./src/basic/index.ts"],
    ...featureDirectories.map((name) => [`./features/${name}`, `./src/features/${name}/index.ts`]),
  ]));
  assert.deepEqual(featureDirectories.filter((name) => !FEATURE_DIRECTORIES.includes(name)), []);
});

test("imports each optional feature through its subpath export as the only value it exports", async () => {
  for (const name of await listFeatureDirectories()) {
    const feature = await import(`@danmaku-kit/core/features/${name}`);
    const exportName = `${name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}Feature`;

    assert.deepEqual(Object.keys(feature), [exportName], `features/${name} must export only ${exportName}`);
    const { createDanmakuCore } = await import("@danmaku-kit/core");
    assert.doesNotThrow(() => createDanmakuCore({ features: [feature[exportName]] }));
  }
});

test("rejects deep package imports outside the public export map", async () => {
  const forbiddenSubpaths = [
    "package.json",
    ...await listBasicSourceSubpaths(),
    ...await listFeatureSourceSubpaths(),
  ];

  for (const subpath of forbiddenSubpaths) {
    await assert.rejects(
      import(`@danmaku-kit/core/${subpath}`),
      (error) => {
        assert.equal(error && typeof error, "object");
        assert.equal("code" in error && error.code, "ERR_PACKAGE_PATH_NOT_EXPORTED");
        return true;
      },
    );
  }
});

test("points type contract deep import checks at existing internal exports", async () => {
  const contractFiles = [
    ...await collectTypeScriptFiles(path.join(repositoryRoot, "tests", "public-type-contract")),
    path.join(repositoryRoot, "tests", "validate-content-type-contract.ts"),
  ];
  const staleChecks = [];

  for (const contractFile of contractFiles) {
    for (const { packageName, subpath, importedNames } of collectDeepWorkspaceImports(contractFile, await readFile(contractFile, "utf8"))) {
      const targetFile = path.join(workspacePackageRoots[packageName], subpath);
      let exportedNames;
      try {
        exportedNames = collectExportedNames(targetFile, await readFile(targetFile, "utf8"));
      } catch {
        staleChecks.push(`${path.relative(repositoryRoot, contractFile)} -> ${packageName}/${subpath} (missing file)`);
        continue;
      }
      for (const name of importedNames.filter((importedName) => !exportedNames.has(importedName))) {
        staleChecks.push(`${path.relative(repositoryRoot, contractFile)} -> ${packageName}/${subpath} (missing export ${name})`);
      }
    }
  }

  // deep subpath は exports map で必ず拒否されるため、型契約の `@ts-expect-error` だけでは path の stale を検出できない。
  assert.deepEqual(staleChecks, [], "type contract deep import checks must name real internal modules and exports");
});

/** workspace package の deep subpath を import する宣言と、import している元の export 名を集める。 */
function collectDeepWorkspaceImports(file, sourceText) {
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const packageName = Object.keys(workspacePackageRoots)
      .find((name) => statement.moduleSpecifier.text.startsWith(`${name}/`));
    if (!packageName) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    imports.push({
      packageName,
      subpath: statement.moduleSpecifier.text.slice(packageName.length + 1),
      importedNames: bindings && ts.isNamedImports(bindings)
        ? bindings.elements.map((element) => (element.propertyName ?? element.name).text)
        : [],
    });
  }
  return imports;
}

/** 対象 source の top-level export 名を集める。 */
function collectExportedNames(file, sourceText) {
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        names.add(element.name.text);
      }
      continue;
    }
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        names.add(declaration.name.getText(sourceFile));
      }
    } else if (statement.name) {
      names.add(statement.name.text);
    }
  }
  return names;
}

async function listBasicSourceSubpaths() {
  const sourceRoot = path.join(packageRoot, "src", "basic");
  const files = await collectTypeScriptFiles(sourceRoot);
  return files.map((file) => path.relative(packageRoot, file).split(path.sep).join("/")).sort();
}

/** feature id（design 20）ごとの `src/features/` の directory 名。 */
const FEATURE_DIRECTORIES = Object.freeze(["bomb", "graze", "affinity", "rank", "pickup", "advanced-scoring"]);

/** `src/features/` の directory 名。feature がまだなければ空。 */
async function listFeatureDirectories() {
  try {
    const entries = await readdir(path.join(packageRoot, "src", "features"), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/** feature の source の package 内 path（package の export 名でも、実 file の path でも公開しない）。 */
async function listFeatureSourceSubpaths() {
  const subpaths = [];
  for (const name of await listFeatureDirectories()) {
    const files = await collectTypeScriptFiles(path.join(packageRoot, "src", "features", name));
    subpaths.push(...files.map((file) => path.relative(packageRoot, file).split(path.sep).join("/")));
  }
  return subpaths.sort();
}

test("runs the minimum gameplay flow through the workspace package export", async () => {
  const { createDanmakuCore } = await import("@danmaku-kit/core");

  const loaded = createDanmakuCore("0.0.0").load(createMinimumDefinition());
  assert.equal(loaded.ok, true);

  if (!loaded.ok) {
    assert.fail("expected package import to load minimum content");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);

  if (!started.ok) {
    assert.fail("expected package import to start minimum stage");
  }

  const frame = started.value.tick({ tick: 0, axes: { moveX: 0, moveY: 0 }, held: [], pressed: [], released: [] });
  assert.equal(frame.ok, true);
  assert.equal(frame.ok && frame.value.tick, 0);

  const serialized = started.value.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected package import to serialize minimum stage");
  }

  const restored = loaded.value.restore(serialized.value);
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected package import to restore serialized minimum stage");
  }
  assert.deepEqual(restored.value.serialize(), serialized);

  const mismatched = loaded.value.restore({ ...serialized.value, coreVersion: "other.core" });
  assert.equal(mismatched.ok, false);
  assert.equal(!mismatched.ok && mismatched.errors[0]?.code, "state.coreVersionMismatch");
});
