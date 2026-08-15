import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = fileURLToPath(new URL("../tools/validate-content", import.meta.url));
const corePackageRoot = fileURLToPath(new URL("../packages/shooting-core", import.meta.url));

test("imports validate-content through the workspace package export", async () => {
  const validateContent = await import("@shooting-sample/validate-content");

  assert.deepEqual(Object.keys(validateContent).sort(), [
    "createToolErrorRunResult",
    "createValidationRunResult",
    "formatValidateContentHuman",
    "formatValidateContentJson",
  ]);
});

test("keeps the validate-content root type export surface explicit", async () => {
  const indexPath = path.join(packageRoot, "src/index.ts");
  const sourceText = await readFile(indexPath, "utf8");

  assert.deepEqual(collectTypeOnlyExportNames(indexPath, sourceText), [
    "ContentDiagnostic",
    "ContentDiagnosticKind",
    "ContentDiagnosticSeverity",
    "ContentDiagnosticSummary",
    "FeatureGateContentDiagnostic",
    "ParseOrSchemaContentDiagnostic",
    "ReferenceContentDiagnostic",
    "ToolContentDiagnostic",
    "ValidateContentExitCode",
    "ValidateContentJsonOutput",
    "ValidateContentRunResult",
    "ValidationContentDiagnostic",
  ]);
});

test("exposes only the validate-content root package export", async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));

  assert.deepEqual(Object.keys(packageJson.exports).sort(), ["."]);
  assert.deepEqual(packageJson.bin, { "validate-content": "./src/cli-entry.ts" });
});

test("runs the declared validate-content bin as a real process", async (context) => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const cliPath = path.join(packageRoot, packageJson.bin["validate-content"]);
  const root = await mkdtemp(path.join(tmpdir(), "validate-content-bin-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const contentRoot = path.join(root, "content");
  const gameDefinitionPath = path.join(root, "game-definition.yaml");
  await mkdir(path.join(contentRoot, "assets"), { recursive: true });
  await writeFile(gameDefinitionPath, [
    'schemaVersion: "1"',
    "enabledFeatures: []",
    "defaultPlayerId: player.missing",
    "contentVersion: sample@content.1",
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(contentRoot, "assets", "manifest.yaml"), "version: 1\nassets: {}\n", "utf8");

  const help = runTypeScriptCli(cliPath, ["--help"]);
  const invalid = runTypeScriptCli(cliPath, [
    "--game-definition", gameDefinitionPath,
    "--content-root", contentRoot,
    "--format", "json",
  ]);

  assert.equal(help.error, undefined, help.error?.message);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage: validate-content/);
  assert.equal(help.stderr, "");
  assert.equal(invalid.error, undefined, invalid.error?.message);
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).diagnostics[0].code, "player.defaultNotFound");
  assert.equal(invalid.stderr, "");
});

/** TypeScript CLIをtest runnerと同じNodeで起動し、OSのshebang対応へ依存させない。 */
function runTypeScriptCli(cliPath, args) {
  return spawnSync(process.execPath, ["--experimental-strip-types", cliPath, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
    windowsHide: true,
  });
}

test("rejects validate-content deep imports outside the public export map", async () => {
  const sourceFiles = await collectTypeScriptFiles(path.join(packageRoot, "src"));
  const forbiddenSubpaths = [
    "package.json",
    ...sourceFiles.map((file) => path.relative(packageRoot, file).split(path.sep).join("/")).sort(),
  ];

  for (const subpath of forbiddenSubpaths) {
    await assert.rejects(
      import(`@shooting-sample/validate-content/${subpath}`),
      (error) => {
        assert.equal(error && typeof error, "object");
        assert.equal("code" in error && error.code, "ERR_PACKAGE_PATH_NOT_EXPORTED");
        return true;
      },
    );
  }
});

test("keeps Core and validate-content package dependencies pointing in the allowed direction", async () => {
  const coreDependencies = await assertPackageDependencies(corePackageRoot, []);
  const validateContentDependencies = await assertPackageDependencies(
    packageRoot,
    ["@shooting-sample/shooting-core", "yaml"],
  );
  await assertSourceImports(corePackageRoot, [], coreDependencies);
  await assertSourceImports(
    packageRoot,
    ["@shooting-sample/shooting-core", "yaml", "node:"],
    validateContentDependencies,
  );
});

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

async function assertPackageDependencies(root, allowedDependencies) {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const declaredDependencies = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ];
  assert.deepEqual(
    declaredDependencies.filter((dependency) => !allowedDependencies.includes(dependency)),
    [],
    `${packageJson.name} has a dependency outside the package boundary allowlist`,
  );
  return declaredDependencies;
}

async function assertSourceImports(root, allowedImports, declaredDependencies) {
  const sourceFiles = (await collectTypeScriptFiles(path.join(root, "src")))
    .filter((file) => !file.endsWith(".test.ts"));
  const violations = [];

  for (const file of sourceFiles) {
    const sourceText = await readFile(file, "utf8");
    for (const specifier of collectModuleSpecifiers(file, sourceText)) {
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        if (!isPathInside(root, target)) {
          violations.push(`${path.relative(root, file)} -> ${specifier}`);
        }
        continue;
      }
      const isAllowedNodeBuiltin = specifier.startsWith("node:") && allowedImports.includes("node:");
      if (!isAllowedNodeBuiltin && !allowedImports.includes(specifier)) {
        violations.push(`${path.relative(root, file)} -> ${specifier}`);
        continue;
      }
      if (!isAllowedNodeBuiltin && !declaredDependencies.includes(specifier)) {
        violations.push(`${path.relative(root, file)} -> ${specifier} (undeclared dependency)`);
      }
    }
  }

  assert.deepEqual(violations, [], `${path.basename(root)} source imports cross an ownership boundary`);
}

function collectTypeOnlyExportNames(file, sourceText) {
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = [];

  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      if (hasExportModifier(statement)) {
        names.push(statement.name.text);
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement)) {
      continue;
    }
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
      names.push(`* from ${getModuleSpecifierText(statement)}`);
      continue;
    }
    for (const element of statement.exportClause.elements) {
      if (statement.isTypeOnly || element.isTypeOnly) {
        names.push(element.name.text);
      }
    }
  }

  return names.sort();
}

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function getModuleSpecifierText(exportDeclaration) {
  return exportDeclaration.moduleSpecifier && ts.isStringLiteral(exportDeclaration.moduleSpecifier)
    ? exportDeclaration.moduleSpecifier.text
    : "<unknown>";
}

function collectModuleSpecifiers(file, sourceText) {
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}
