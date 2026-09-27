import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { createDanmakuCore } from "../core.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import { createShotInputFrame } from "../test-support/input-frames.ts";
import { startMinimumStage } from "../test-support/stage-harness.ts";

test("spawns enemy bullets from fireOnSpawn patterns deterministically", () => {
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
            pattern: "pattern.spawn_bullet",
            position: { x: 192, y: 80 },
          },
        }],
      }],
      patterns: [{
        id: "pattern.spawn_bullet",
        version: 1,
        fireOnSpawn: {
          bullet: "bullet.red_small",
          offset: { x: 4, y: 8 },
        },
      }],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game with fireOnSpawn pattern");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected fireOnSpawn stage session");
  }

  const frame = started.value.tick(createEmptyInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected fireOnSpawn frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "enemyBulletsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame.value.events[2], {
    type: "enemyBulletsSpawnedBatch",
    tick: 0,
    bullets: [
      {
        entityId: 3,
        definitionId: "bullet.red_small",
        position: { x: 196, y: 88 },
      },
    ],
  });
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
    {
      id: 2,
      kind: "enemy",
      definitionId: "enemy.scout",
      position: { x: 192, y: 80 },
    },
    {
      id: 3,
      kind: "enemyBullet",
      definitionId: "bullet.red_small",
      position: { x: 196, y: 88 },
    },
  ]);
  assert.equal(Object.isFrozen(frame.value.events[2]), true);
  if (frame.value.events[2]?.type !== "enemyBulletsSpawnedBatch") {
    assert.fail("expected enemyBulletsSpawnedBatch event");
  }
  assert.equal(Object.isFrozen(frame.value.events[2].bullets), true);
  assert.equal(Object.isFrozen(frame.value.events[2].bullets[0]), true);
  assert.equal(Object.isFrozen(frame.value.events[2].bullets[0]?.position), true);

  const nextFrame = started.value.tick(createEmptyInputFrame(1));
  assert.equal(nextFrame.ok, true);
  if (!nextFrame.ok) {
    assert.fail("expected next frame without repeated fireOnSpawn");
  }
  assert.deepEqual(nextFrame.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(nextFrame.value.state.entities.filter((entity) => entity.kind === "enemyBullet"), [
    {
      id: 3,
      kind: "enemyBullet",
      definitionId: "bullet.red_small",
      position: { x: 196, y: 88 },
    },
  ]);
});

test("orders timeline enemy spawn and enemy bullet batch before player shot batch on the same tick", () => {
  const definition = createMinimumDefinition();
  const baseStage = definition.content.stages[0]!;
  const spawnStep = baseStage.timeline[0]!;
  const loaded = createDanmakuCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...baseStage,
          timeline: [
            {
              ...spawnStep,
              tick: 0,
              action: {
                ...spawnStep.action,
                pattern: "pattern.spawn_bullet",
              },
            },
          ],
        },
      ],
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.spawn_bullet",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.red_small",
            offset: { x: 0, y: 8 },
          },
        },
      ],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

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
    assert.fail("expected frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "enemyBulletsSpawnedBatch",
    "playerShotsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame.value.events[1], {
    type: "entitySpawned",
    tick: 0,
    entityId: 2,
    entityKind: "enemy",
    definitionId: "enemy.scout",
    path: "path.none",
    pattern: "pattern.spawn_bullet",
    position: { x: 192, y: -16 },
  });
  assert.deepEqual(frame.value.events[2], {
    type: "enemyBulletsSpawnedBatch",
    tick: 0,
    bullets: [
      {
        entityId: 3,
        definitionId: "bullet.red_small",
        position: { x: 192, y: -8 },
      },
    ],
  });
  assert.deepEqual(frame.value.events[3], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 4,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(frame.value.state.entities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    definitionId: entity.definitionId,
    position: entity.position,
  })), [
    { id: 1, kind: "player", definitionId: "player.default", position: { x: 192, y: 400 } },
    { id: 2, kind: "enemy", definitionId: "enemy.scout", position: { x: 192, y: -16 } },
    { id: 3, kind: "enemyBullet", definitionId: "bullet.red_small", position: { x: 192, y: -8 } },
    { id: 4, kind: "playerShot", definitionId: "playerShot.basic", position: { x: 192, y: 392 } },
  ]);
});

test("orders multiple timeline enemy bullet batches before player shot batch on the same tick", () => {
  const definition = createMinimumDefinition();
  const baseStage = definition.content.stages[0]!;
  const loaded = createDanmakuCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...baseStage,
          timeline: [
            {
              tick: 0,
              action: {
                type: "spawnEnemy",
                enemy: "enemy.scout",
                path: "path.none",
                pattern: "pattern.fire_a",
                position: { x: 180, y: -16 },
              },
            },
            {
              tick: 0,
              action: {
                type: "spawnEnemy",
                enemy: "enemy.scout",
                path: "path.none",
                pattern: "pattern.fire_b",
                position: { x: 204, y: -12 },
              },
            },
          ],
        },
      ],
      patterns: [
        ...definition.content.patterns,
        {
          id: "pattern.fire_a",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.red_small",
            offset: { x: 1, y: 2 },
          },
        },
        {
          id: "pattern.fire_b",
          version: 1,
          fireOnSpawn: {
            bullet: "bullet.red_small",
            offset: { x: -3, y: 4 },
          },
        },
      ],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

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
    assert.fail("expected frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "entitySpawned",
    "enemyBulletsSpawnedBatch",
    "playerShotsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame.value.events[3], {
    type: "enemyBulletsSpawnedBatch",
    tick: 0,
    bullets: [
      {
        entityId: 4,
        definitionId: "bullet.red_small",
        position: { x: 181, y: -14 },
      },
      {
        entityId: 5,
        definitionId: "bullet.red_small",
        position: { x: 201, y: -8 },
      },
    ],
  });
  assert.deepEqual(frame.value.events[4], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 6,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(frame.value.state.entities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    definitionId: entity.definitionId,
    position: entity.position,
  })), [
    { id: 1, kind: "player", definitionId: "player.default", position: { x: 192, y: 400 } },
    { id: 2, kind: "enemy", definitionId: "enemy.scout", position: { x: 180, y: -16 } },
    { id: 3, kind: "enemy", definitionId: "enemy.scout", position: { x: 204, y: -12 } },
    { id: 4, kind: "enemyBullet", definitionId: "bullet.red_small", position: { x: 181, y: -14 } },
    { id: 5, kind: "enemyBullet", definitionId: "bullet.red_small", position: { x: 201, y: -8 } },
    { id: 6, kind: "playerShot", definitionId: "playerShot.basic", position: { x: 192, y: 392 } },
  ]);
});

test("spawns enemy entities from the stage timeline deterministically", () => {
  const started = startMinimumStage();

  for (let tick = 0; tick < 60; tick += 1) {
    const frame = started.tick(createEmptyInputFrame(tick));
    assert.equal(frame.ok, true);
    assert.deepEqual(frame.ok && frame.value.state.entities.map((entity) => entity.kind), ["player"]);
  }

  const spawnFrame = started.tick(createEmptyInputFrame(60));
  assert.equal(spawnFrame.ok, true);
  if (!spawnFrame.ok) {
    assert.fail("expected spawn frame");
  }

  assert.deepEqual(spawnFrame.value.events.map((event) => event.type), ["entitySpawned", "tickAdvanced"]);
  assert.deepEqual(spawnFrame.value.events[0], {
    type: "entitySpawned",
    tick: 60,
    entityId: 2,
    entityKind: "enemy",
    definitionId: "enemy.scout",
    path: "path.none",
    pattern: "pattern.none",
    position: { x: 192, y: -16 },
  });
  assert.deepEqual(spawnFrame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
    {
      id: 2,
      kind: "enemy",
      definitionId: "enemy.scout",
      position: { x: 192, y: -16 },
    },
  ]);
  assert.equal(Object.isFrozen(spawnFrame.value.state.entities), true);
  assert.equal(Object.isFrozen(spawnFrame.value.state.entities[0]), true);
  assert.equal(Object.isFrozen(spawnFrame.value.state.entities[0]?.position), true);
  assert.equal(Object.isFrozen(spawnFrame.value.events[0]), true);
  if (spawnFrame.value.events[0]?.type !== "entitySpawned") {
    assert.fail("expected entitySpawned event");
  }
  assert.equal(Object.isFrozen(spawnFrame.value.events[0].position), true);

  const nextFrame = started.tick(createEmptyInputFrame(61));
  assert.equal(nextFrame.ok, true);
  assert.deepEqual(nextFrame.ok && nextFrame.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.equal(nextFrame.ok && nextFrame.value.state.entities.length, 2);
});

test("spawns multiple enemies on the same tick in timeline order", () => {
  const definition = createMinimumDefinition();
  const baseStage = definition.content.stages[0]!;
  const spawnStep = baseStage.timeline[0]!;
  const loaded = createDanmakuCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      assetKeys: {
        keys: [...definition.content.assetKeys.keys, "enemy.heavy"],
      },
      enemies: [
        ...definition.content.enemies,
        { id: "enemy.heavy", version: 1, asset: "enemy.heavy", collision: { radius: 20 }, hp: 30, score: 300 },
      ],
      stages: [
        {
          ...baseStage,
          timeline: [
            { ...spawnStep, tick: 0, action: { ...spawnStep.action, position: { x: 96, y: -16 } } },
            {
              ...spawnStep,
              tick: 0,
              action: {
                ...spawnStep.action,
                enemy: "enemy.heavy",
                path: "path.swoop",
                pattern: "pattern.spread",
                position: { x: 288, y: -16 },
              },
            },
          ],
        },
      ],
      patterns: [...definition.content.patterns, { id: "pattern.spread", version: 1 }],
      paths: [...definition.content.paths, { id: "path.swoop", version: 1 }],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const frame = started.value.tick(createEmptyInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), ["stageStarted", "entitySpawned", "entitySpawned", "tickAdvanced"]);
  assert.deepEqual(frame.value.events.flatMap((event) => (
    event.type === "entitySpawned" && event.entityKind === "enemy"
      ? [{
        entityId: event.entityId,
        definitionId: event.definitionId,
        path: event.path,
        pattern: event.pattern,
        position: event.position,
      }]
      : []
  )), [
    { entityId: 2, definitionId: "enemy.scout", path: "path.none", pattern: "pattern.none", position: { x: 96, y: -16 } },
    { entityId: 3, definitionId: "enemy.heavy", path: "path.swoop", pattern: "pattern.spread", position: { x: 288, y: -16 } },
  ]);
  assert.deepEqual(frame.value.state.entities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    definitionId: entity.definitionId,
    position: entity.position,
  })), [
    { id: 1, kind: "player", definitionId: "player.default", position: { x: 192, y: 400 } },
    { id: 2, kind: "enemy", definitionId: "enemy.scout", position: { x: 96, y: -16 } },
    { id: 3, kind: "enemy", definitionId: "enemy.heavy", position: { x: 288, y: -16 } },
  ]);
});
