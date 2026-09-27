import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { formatValidateContentHuman, loadValidatedGameDefinition } from "@shooting-sample/validate-content";

// content 制作者向けの minimal YAML examples（design 19 / 21.6、Phase 2B-11）を validate-content に通し、docs の例と schema の
// ずれを検出する。
const examplesRoot = fileURLToPath(new URL("../docs/content-authoring/examples/", import.meta.url));

async function loadExamples() {
  const loaded = await loadValidatedGameDefinition({
    gameDefinitionPath: path.join(examplesRoot, "game-definition.yaml"),
    contentRoot: path.join(examplesRoot, "content"),
  });
  assert.ok(loaded.ok, formatValidateContentHuman(loaded.runResult.output));
  return loaded;
}

/** examples の file（README 以外）を examples root からの相対 path で返す。 */
async function listExampleFiles(): Promise<readonly string[]> {
  const entries = await readdir(examplesRoot, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name !== "README.md")
    .map((entry) => path.relative(examplesRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

test("validates the examples without errors, warnings or infos", async () => {
  const loaded = await loadExamples();

  assert.deepEqual(loaded.runResult.output.diagnostics, [], formatValidateContentHuman(loaded.runResult.output));
});

test("gives every content collection, the enabled features and the asset manifest an example", async () => {
  const { definition, assetManifest } = await loadExamples();
  // content の collection（配列）と feature の collection に、空のものがない。collection が増えたら例も足す。
  const { features, version: _version, assetKeys: _assetKeys, ...collections } = definition.content;
  const empty = [
    ...Object.entries(collections).filter(([, values]) => values.length === 0).map(([name]) => name),
    ...Object.entries(features ?? {}).filter(([, values]) => values.length === 0).map(([name]) => `features.${name}`),
  ];

  assert.deepEqual(empty, []);
  assert.deepEqual(definition.enabledFeatures, ["pickup"]);
  assert.ok(Object.keys(assetManifest.assets).length > 0);
});

test("shows every Pattern DSL instruction and fire modifier and both branches of a difficulty if", async () => {
  const { definition } = await loadExamples();
  const stepKeys = new Set<string>();
  const fireKeys = new Set<string>();
  const ifDifficulties: (readonly string[])[] = [];
  const visit = (steps: readonly object[]): void => {
    for (const step of steps) {
      for (const [key, value] of Object.entries(step)) {
        stepKeys.add(key);
        if (key === "fire") {
          Object.keys(value as object).forEach((fireKey) => fireKeys.add(fireKey));
        } else if (key === "repeat") {
          visit((value as { steps: readonly object[] }).steps);
        } else if (key === "if") {
          const branch = value as { difficulty: readonly string[]; then: readonly object[]; else?: readonly object[] };
          ifDifficulties.push(branch.difficulty);
          if (branch.else) {
            stepKeys.add("if.else");
          }
          visit([...branch.then, ...branch.else ?? []]);
        }
      }
    }
  };
  visit(definition.content.patterns.flatMap((pattern) => pattern.steps ?? []));

  assert.deepEqual([...stepKeys].sort(), ["fire", "if", "if.else", "loop", "repeat", "wait"]);
  for (const key of ["aim", "angleDeg", "fan", "radial", "stream"]) {
    assert.ok(fireKeys.has(key), `the examples must show fire.${key}`);
  }
  // stage の difficulty に、`if` の条件に入るものと入らないものがあり、両方の枝が使われる。
  const difficulties = definition.content.stages.flatMap((stage) => stage.difficulties);
  for (const selected of ifDifficulties) {
    assert.ok(difficulties.some((difficulty) => selected.includes(difficulty)), `a stage must use the then branch of ${selected}`);
    assert.ok(difficulties.some((difficulty) => !selected.includes(difficulty)), `a stage must use the else branch of ${selected}`);
  }
});

test("lists every example file in the README and no file that does not exist", async () => {
  const readme = await readFile(path.join(examplesRoot, "README.md"), "utf8");
  const listed = [...readme.matchAll(/^\| `([^`]+)` \|/gmu)].map((match) => match[1]!).sort();

  assert.deepEqual(listed, await listExampleFiles());
});
