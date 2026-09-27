import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { createDanmakuCore } from "../core.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import { createShotInputFrame } from "../test-support/input-frames.ts";
import { loadUnknown } from "../test-support/stage-harness.ts";
import { validateGameDefinition } from "./validation.ts";

test("rejects non-finite enemy bullet positions during load", () => {
  const definition = createMinimumDefinition();
  const loaded = createDanmakuCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.overflow",
            position: { x: Number.MAX_VALUE, y: 80 },
          },
        }],
      }],
      patterns: [{
        id: "pattern.overflow",
        version: 1,
        fireOnSpawn: {
          bullet: "bullet.red_small",
          offset: { x: Number.MAX_VALUE, y: 8 },
        },
      }],
    },
  });
  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), [
    "definition.invalidConstraint",
  ]);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "stage.timeline[].action.position + pattern.fireOnSpawn.offset must produce a finite position",
  ]);
});

test("keeps a validated content snapshot after load", () => {
  const definition = createMinimumDefinition();
  const originalPlayerShot = definition.content.playerShots[0] as unknown as Record<string, unknown>;
  const originalSpawnPosition = definition.content.stages[0]!.timeline[0]!.action.position;
  const loaded = loadUnknown(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  (definition.content.stages as unknown[]).length = 0;
  (definition.content.players as unknown[]).length = 0;
  definition.content.assetKeys.keys = [];
  originalPlayerShot.id = "playerShot.mutated";
  originalPlayerShot.damage = 999;
  originalPlayerShot.collision = { radius: 99 };
  (originalSpawnPosition as { x: number; y: number }).x = 999;
  (originalSpawnPosition as { x: number; y: number }).y = 999;
  (definition.content.playerShots as unknown as Record<string, unknown>[])[0] = {
    id: "playerShot.mutated",
    version: 1,
    asset: "shot.player_basic",
    damage: 5,
  };

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const frame = started.value.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected shot frame");
  }
  assert.deepEqual(frame.value.events[1], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 2,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });

  for (let tick = 1; tick < 60; tick += 1) {
    const emptyFrame = started.value.tick(createEmptyInputFrame(tick));
    assert.equal(emptyFrame.ok, true);
  }
  const spawnFrame = started.value.tick(createEmptyInputFrame(60));
  assert.equal(spawnFrame.ok, true);
  if (!spawnFrame.ok) {
    assert.fail("expected enemy spawn frame");
  }
  assert.deepEqual(spawnFrame.value.events[0], {
    type: "entitySpawned",
    tick: 60,
    entityId: 3,
    entityKind: "enemy",
    definitionId: "enemy.scout",
    path: "path.none",
    pattern: "pattern.none",
    position: { x: 192, y: -16 },
  });
});

test("loads minimum content after crossing a JSON parse boundary", () => {
  const parsed = JSON.parse(JSON.stringify(createMinimumDefinition()));
  const loaded = loadUnknown(parsed);

  assert.equal(loaded.ok, true);
});

test("rejects inherited or throwing content data without leaking exceptions", () => {
  const inheritedDefinition = Object.create(createMinimumDefinition());
  const inherited = loadUnknown(inheritedDefinition);
  assert.equal(inherited.ok, false);
  assert.equal(!inherited.ok && inherited.errors[0]?.code, "definition.invalidShape");

  const throwingDefinition = Object.defineProperty({}, "schemaVersion", {
    enumerable: true,
    get() {
      throw new Error("unexpected getter access");
    },
  });
  const throwing = loadUnknown(throwingDefinition);
  assert.equal(throwing.ok, false);
  assert.equal(!throwing.ok && throwing.errors[0]?.code, "definition.invalidShape");
  assert.deepEqual(validateGameDefinition(throwingDefinition).map((error) => error.code), ["definition.invalidShape"]);

  const definitionWithProto = createMinimumDefinition() as Record<string, unknown>;
  Object.defineProperty(definitionWithProto, "__proto__", {
    enumerable: true,
    value: { polluted: true },
  });
  const protoResult = loadUnknown(definitionWithProto);
  assert.equal(protoResult.ok, false);
  assert.equal(!protoResult.ok && protoResult.errors.some((error) => error.code === "definition.unknownField"), true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("rejects invalid content shapes without throwing", () => {
  const invalidCases: readonly unknown[] = [
    null,
    { schemaVersion: "1", content: null },
    { ...createMinimumDefinition(), extra: true },
    {
      ...createMinimumDefinition(),
      content: { ...createMinimumDefinition().content, players: [null] },
    },
  ];

  for (const invalidDefinition of invalidCases) {
    const loaded = loadUnknown(invalidDefinition);
    assert.equal(loaded.ok, false);
    assert.equal(Object.isFrozen(loaded), true);
    assert.equal(!loaded.ok && Object.isFrozen(loaded.errors), true);
    assert.equal(!loaded.ok && Object.isFrozen(loaded.errors[0]), true);
    assert.equal(
      !loaded.ok
        && loaded.errors.some((error) => error.code === "definition.invalidShape" || error.code === "definition.unknownField"),
      true,
    );
  }
});

test("rejects unsupported schema versions", () => {
  const loaded = loadUnknown({ ...createMinimumDefinition(), schemaVersion: "2" });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "schema.unsupportedVersion");
});

test("rejects optional feature usage in the basic core", () => {
  for (const feature of ["bomb", "graze", "affinity", "rank", "pickup", "advancedScoring"]) {
    const loaded = loadUnknown({
      ...createMinimumDefinition(),
      enabledFeatures: [feature],
    });

    assert.equal(loaded.ok, false);
    assert.equal(!loaded.ok && loaded.errors[0]?.code, "feature.unsupported");
  }
});

test("distinguishes unknown optional feature names from unsupported known features", () => {
  const loaded = loadUnknown({
    ...createMinimumDefinition(),
    enabledFeatures: ["bmob"],
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "feature.unknown");
});

test("rejects duplicate optional feature names before module setup", () => {
  const loaded = loadUnknown({
    ...createMinimumDefinition(),
    enabledFeatures: ["bomb", "bomb"],
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), [
    "feature.duplicate",
    "feature.unsupported",
  ]);
});

test("rejects disabled feature fields", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          graze: { radius: 12 },
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "definition.unknownField");
});

test("rejects duplicate ids and missing assets", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      enemies: [
        ...definition.content.enemies,
        { id: "enemy.scout", version: 1, asset: "enemy.missing", collision: { radius: 12 }, hp: 10, score: 10 },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(
    !loaded.ok && loaded.errors.map((error) => error.code),
    ["id.duplicate", "asset.notFound"],
  );
});

test("rejects missing player shot and stage timeline references", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          shot: { definition: "playerShot.missing" },
        },
      ],
      stages: [
        {
          ...definition.content.stages[0],
          timeline: [
            {
              tick: 0,
              action: {
                type: "spawnEnemy",
                enemy: "enemy.missing",
                path: "path.missing",
                pattern: "pattern.missing",
                position: { x: 0, y: 0 },
              },
            },
          ],
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(
    !loaded.ok && loaded.errors.map((error) => error.code),
    ["playerShot.notFound", "enemy.notFound", "pattern.notFound", "path.notFound"],
  );
});

test("rejects missing pattern bullet references", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.missing_bullet",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.missing",
            offset: { x: 0, y: 0 },
          },
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), ["bullet.notFound"]);
});

test("rejects malformed pattern fireOnSpawn definitions", () => {
  const definition = createMinimumDefinition();
  const shapeCases: Array<{
    codes: readonly string[];
    label: string;
    fireOnSpawn: unknown;
    messages: readonly string[];
  }> = [
    {
      codes: ["definition.invalidShape"],
      label: "non object fireOnSpawn",
      fireOnSpawn: "bullet.red_small",
      messages: ["pattern.fireOnSpawn must be an object"],
    },
    {
      codes: ["definition.unknownField"],
      label: "unknown fireOnSpawn field",
      fireOnSpawn: {
        bullet: "bullet.red_small",
        offset: { x: 0, y: 0 },
        extra: true,
      },
      messages: ["Unknown field at pattern.fireOnSpawn.extra"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "missing bullet",
      fireOnSpawn: {
        offset: { x: 0, y: 0 },
      },
      messages: ["pattern.fireOnSpawn.bullet must be a string"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "empty bullet",
      fireOnSpawn: {
        bullet: "",
        offset: { x: 0, y: 0 },
      },
      messages: ["pattern.fireOnSpawn.bullet must be a string"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "non string bullet",
      fireOnSpawn: {
        bullet: 1,
        offset: { x: 0, y: 0 },
      },
      messages: ["pattern.fireOnSpawn.bullet must be a string"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "missing offset",
      fireOnSpawn: {
        bullet: "bullet.red_small",
      },
      messages: ["pattern.fireOnSpawn.offset must be an object"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "non object offset",
      fireOnSpawn: {
        bullet: "bullet.red_small",
        offset: "0,0",
      },
      messages: ["pattern.fireOnSpawn.offset must be an object"],
    },
    {
      codes: ["definition.invalidShape"],
      label: "invalid offset y",
      fireOnSpawn: {
        bullet: "bullet.red_small",
        offset: { x: 0, y: "0" },
      },
      messages: ["pattern.fireOnSpawn.offset.y must be a finite number"],
    },
    {
      codes: ["definition.unknownField"],
      label: "unknown offset field",
      fireOnSpawn: {
        bullet: "bullet.red_small",
        offset: { x: 0, y: 0, extra: true },
      },
      messages: ["Unknown field at pattern.fireOnSpawn.offset.extra"],
    },
  ];

  for (const shapeCase of shapeCases) {
    const loaded = loadUnknown({
      ...definition,
      content: {
        ...definition.content,
        patterns: [
          ...definition.content.patterns,
          {
            id: `pattern.bad_fire_${shapeCase.label.replaceAll(" ", "_")}`,
            version: 1,
            fireOnSpawn: shapeCase.fireOnSpawn,
          },
        ],
      },
    });

    assert.equal(loaded.ok, false, shapeCase.label);
    assert.deepEqual(
      !loaded.ok && loaded.errors.map((error) => error.code),
      shapeCase.codes,
      shapeCase.label,
    );
    assert.deepEqual(
      !loaded.ok && loaded.errors.map((error) => error.message),
      shapeCase.messages,
      shapeCase.label,
    );
  }

  const malformedOffset = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.bad_fire",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.red_small",
            offset: { x: "0", y: 0 },
          },
        },
      ],
    },
  });

  assert.equal(malformedOffset.ok, false);
  assert.deepEqual(!malformedOffset.ok && malformedOffset.errors.map((error) => error.code), [
    "definition.invalidShape",
  ]);
  assert.deepEqual(!malformedOffset.ok && malformedOffset.errors.map((error) => error.message), [
    "pattern.fireOnSpawn.offset.x must be a finite number",
  ]);

  for (const nonJsonNumber of [Number.POSITIVE_INFINITY, Number.NaN]) {
    const malformedPlainData = loadUnknown({
      ...definition,
      content: {
        ...definition.content,
        patterns: [
          ...definition.content.patterns,
          {
            id: "pattern.bad_fire_non_json_number",
            version: 1,
            fireOnSpawn: {
              bullet: "bullet.red_small",
              offset: { x: 0, y: nonJsonNumber },
            },
          },
        ],
      },
    });

    assert.equal(malformedPlainData.ok, false);
    assert.deepEqual(!malformedPlainData.ok && malformedPlainData.errors.map((error) => error.code), [
      "definition.invalidShape",
    ]);
    assert.deepEqual(!malformedPlainData.ok && malformedPlainData.errors.map((error) => error.message), [
      "GameDefinition must be JSON-compatible plain data",
    ]);
  }

  const malformedOffsetWithMissingBullet = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.bad_fire",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.missing",
            offset: { x: "0", y: 0 },
          },
        },
      ],
    },
  });

  assert.equal(malformedOffsetWithMissingBullet.ok, false);
  assert.deepEqual(!malformedOffsetWithMissingBullet.ok && malformedOffsetWithMissingBullet.errors.map((error) => error.code), [
    "definition.invalidShape",
  ]);
  assert.equal(
    !malformedOffsetWithMissingBullet.ok
      && malformedOffsetWithMissingBullet.errors.some((error) => error.code === "bullet.notFound"),
    false,
  );

  const malformedBullet = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.bad_fire",
          version: 1,
          fireOnSpawn: {
            bullet: "enemy.scout",
            offset: { x: 0, y: 0 },
          },
        },
      ],
    },
  });

  assert.equal(malformedBullet.ok, false);
  assert.deepEqual(!malformedBullet.ok && malformedBullet.errors.map((error) => error.code), [
    "id.invalidNamespace",
  ]);
  assert.deepEqual(!malformedBullet.ok && malformedBullet.errors.map((error) => error.message), [
    "pattern.fireOnSpawn.bullet must reference a bullet.* id: enemy.scout",
  ]);
});

test("rejects malformed default player id before lookup", () => {
  const malformedDefault = loadUnknown({
    ...createMinimumDefinition(),
    defaultPlayerId: "enemy.scout",
  });
  assert.equal(malformedDefault.ok, false);
  assert.equal(!malformedDefault.ok && malformedDefault.errors[0]?.code, "id.invalidNamespace");

  const missingDefault = loadUnknown({
    ...createMinimumDefinition(),
    defaultPlayerId: "player.missing",
  });
  assert.equal(missingDefault.ok, false);
  assert.equal(!missingDefault.ok && missingDefault.errors[0]?.code, "player.defaultNotFound");
});

test("rejects malformed content reference ids before lookup", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          shot: { definition: "playerShot." },
        },
      ],
      stages: [
        {
          ...definition.content.stages[0],
          timeline: [
            {
              tick: 0,
              action: {
                type: "spawnEnemy",
                enemy: "enemy/unsafe",
                path: "path.",
                pattern: "pattern..unsafe",
                position: { x: 0, y: 0 },
              },
            },
          ],
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), [
    "id.invalidNamespace",
    "id.invalidNamespace",
    "id.invalidNamespace",
    "id.invalidNamespace",
  ]);
});
