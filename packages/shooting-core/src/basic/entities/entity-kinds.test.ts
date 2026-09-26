import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { AssertTrue, IsExactly } from "../../../../../tests/support/type-assertions.ts";
import type { HashableRuntimeEntityState } from "../hash/hashable-state.ts";
import type { SerializedRuntimeEntityState } from "../serialization/types.ts";
import { RUNTIME_ENTITY_KINDS } from "./entity-kinds.ts";
import type { RuntimeEntityKind } from "./entity-kinds.ts";
import type { ReadonlyEntityState, RuntimeEntityState } from "./runtime-entity.ts";

/** runtime / 公開 snapshot / serialize DTO / hash DTO の kind が canonical 一覧と過不足なく一致することを型で固定する。 */
type EntityKindAssertions = readonly [
  AssertTrue<IsExactly<RuntimeEntityState["kind"], RuntimeEntityKind>>,
  AssertTrue<IsExactly<ReadonlyEntityState["kind"], RuntimeEntityKind>>,
  AssertTrue<IsExactly<SerializedRuntimeEntityState["kind"], RuntimeEntityKind>>,
  AssertTrue<IsExactly<HashableRuntimeEntityState["kind"], RuntimeEntityKind>>,
];

test("keeps the canonical runtime entity kind order stable", () => {
  assert.equal(Object.isFrozen(RUNTIME_ENTITY_KINDS), true);
  assert.deepEqual(RUNTIME_ENTITY_KINDS, ["player", "enemy", "enemyBullet", "playerShot"]);
});

test("keeps one entity directory with model, snapshot, and restore modules per kind", async () => {
  const entitiesRoot = fileURLToPath(new URL(".", import.meta.url));
  const directories = (await readdir(entitiesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(directories, RUNTIME_ENTITY_KINDS.map(toKebabCase).sort());
  for (const directory of directories) {
    const modules = (await readdir(path.join(entitiesRoot, directory)))
      .filter((file) => !file.endsWith(".test.ts"))
      .sort();
    assert.deepEqual(modules, ["model.ts", "restore.ts", "snapshot.ts"], directory);
  }
});

/** kind 名（camelCase）を entity directory 名（kebab-case）へ変換する。 */
function toKebabCase(kind: string): string {
  return kind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
