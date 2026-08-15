import assert from "node:assert/strict";
import test from "node:test";

import { parseYamlSource } from "./yaml-source.ts";

test("parses one YAML 1.2 document and resolves source spans", () => {
  const result = parseYamlSource(
    "content/players/default.yaml",
    [
      "id: player.default",
      "movement:",
      "  speed: 4",
      "  focusSpeed: 1.8",
      "",
    ].join("\n"),
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.source.value, {
    id: "player.default",
    movement: { speed: 4, focusSpeed: 1.8 },
  });
  assert.deepEqual(result.source.locate(["movement", "speed"]), {
    path: "content/players/default.yaml",
    line: 3,
    column: 10,
    endLine: 3,
    endColumn: 11,
  });
  assert.deepEqual(result.source.findScalar("player.default"), {
    path: "content/players/default.yaml",
    line: 1,
    column: 5,
    endLine: 1,
    endColumn: 19,
  });
});

test("returns a positioned diagnostic for malformed YAML without throwing", () => {
  const result = parseYamlSource("content/stages/bad.yaml", "id: stage.bad\nid: stage.duplicate\n");

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.kind, "parse");
  assert.equal(result.diagnostics[0]?.code, "yaml.parse.duplicate_key");
  assert.equal(result.diagnostics[0]?.path, "content/stages/bad.yaml");
  assert.equal(result.diagnostics[0]?.line, 2);
  assert.equal(result.diagnostics[0]?.column, 1);
});

test("rejects multiple YAML documents at the parser boundary", () => {
  const result = parseYamlSource("content/enemies/multiple.yaml", "---\nid: enemy.a\n---\nid: enemy.b\n");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.diagnostics[0]?.code, "yaml.parse.multiple_docs");
  }
});

test("rejects non-string mapping keys and aliases", () => {
  const nonStringKey = parseYamlSource("content/non-string-key.yaml", "? [one, two]\n: value\n");
  const aliased = parseYamlSource(
    "content/aliases.yaml",
    "base: &base [1]\nitems: [*base]\n",
  );

  assert.equal(nonStringKey.ok, false);
  assert.equal(nonStringKey.diagnostics[0]?.code, "yaml.parse.non_string_key");
  assert.equal(nonStringKey.diagnostics[0]?.line, 1);
  assert.equal(aliased.ok, false);
  assert.equal(aliased.diagnostics[0]?.code, "yaml.parse.alias_not_supported");
  assert.equal(aliased.diagnostics[0]?.line, 2);
});

test("rejects an explicit YAML version other than 1.2", () => {
  const result = parseYamlSource("content/yaml-1.1.yaml", "%YAML 1.1\n---\nvalue: 012\n");

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0]?.code, "yaml.parse.unsupported_version");
  assert.equal(result.diagnostics[0]?.line, 1);
  assert.match(result.diagnostics[0]?.message ?? "", /Only YAML 1\.2 is supported/);
});

test("rejects known non-core tags instead of creating non-plain values", () => {
  const tags = [
    "!!timestamp 2020-01-01",
    "!!binary SGVsbG8=",
    "!!omap [{a: 1}]",
    "!!set {a: null}",
  ];

  for (const tag of tags) {
    const result = parseYamlSource("content/tagged.yaml", `value: ${tag}\n`);
    assert.equal(result.ok, false, tag);
    assert.equal(result.diagnostics[0]?.code, "yaml.parse.tag_resolve_failed", tag);
    assert.equal(result.diagnostics[0]?.line, 1, tag);
  }
});

test("enforces source byte, AST node, and collection depth budgets", () => {
  const tooManyBytes = parseYamlSource("content/large-scalar.yaml", `value: ${"a".repeat(1_048_576)}\n`);
  const tooManyNodes = parseYamlSource(
    "content/many-nodes.yaml",
    `${Array.from({ length: 20_000 }, (_, index) => `key${index}: ${index}`).join("\n")}\n`,
  );
  const tooDeep = parseYamlSource(
    "content/deep.yaml",
    `value: ${"[".repeat(65)}0${"]".repeat(65)}\n`,
  );

  for (const result of [tooManyBytes, tooManyNodes, tooDeep]) {
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0]?.code, "yaml.resource");
    assert.equal(result.diagnostics[0]?.line !== undefined, true);
    assert.equal(result.diagnostics[0]?.column !== undefined, true);
  }
});
