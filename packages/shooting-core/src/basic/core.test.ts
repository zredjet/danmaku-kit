import assert from "node:assert/strict";
import test from "node:test";

import { createShootingCore } from "./core.ts";
import type { LoadedGame, StageSession, StartStageOptions } from "./core.ts";
import type { GameDefinition } from "./content/types.ts";
import { validateGameDefinition } from "./content/validation.ts";
import { createEmptyInputFrame } from "./input/input-frame.ts";
import type { InputFrame } from "./input/input-frame.ts";
import { createMinimumDefinition } from "../../../../tests/fixtures/minimum-game-definition.ts";

test("loads valid minimum content and advances deterministic ticks", () => {
  const loaded = createShootingCore("0.0.0").load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(loaded.ok && Object.isFrozen(loaded.warnings), true);

  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  assert.equal(Object.isFrozen(loaded.value), true);

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  assert.equal(Object.isFrozen(started), true);

  if (!started.ok) {
    assert.fail("expected stage session");
  }
  assert.equal(Object.isFrozen(started.value), true);

  const frame0 = started.value.tick(createEmptyInputFrame(0));
  assert.equal(frame0.ok, true);
  assert.equal(Object.isFrozen(frame0), true);
  assert.equal(frame0.ok && frame0.value.tick, 0);
  assert.deepEqual(frame0.ok && frame0.value.events.map((event) => event.type), [
    "stageStarted",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame0.ok && frame0.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
  ]);

  const frame1 = started.value.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  assert.equal(frame1.ok && frame1.value.state.score, 0);
});

test("returns identical frames for identical seed and input sequence", () => {
  const first = startMinimumStage();
  const second = startMinimumStage();

  for (let tick = 0; tick <= 60; tick += 1) {
    const input = tick % 10 === 0 ? createShotInputFrame(tick) : createEmptyInputFrame(tick);
    const firstFrame = first.tick(input);
    const secondFrame = second.tick(input);

    assert.equal(firstFrame.ok, true);
    assert.equal(secondFrame.ok, true);
    assert.deepEqual(firstFrame.ok && firstFrame.value, secondFrame.ok && secondFrame.value);
  }
});

test("moves player by input axes and clamps the center inside the playfield", () => {
  const started = startMinimumStage();

  const frame0 = started.tick(createMoveInputFrame(0, 1, -1, []));
  assert.equal(frame0.ok, true);
  if (!frame0.ok) {
    assert.fail("expected moved player frame");
  }
  assert.deepEqual(frame0.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192 + 4 * Math.SQRT1_2, y: 400 - 4 * Math.SQRT1_2 },
    },
  ]);

  const frame1 = started.tick(createMoveInputFrame(1, -1, 1, ["focus"]));
  assert.equal(frame1.ok, true);
  if (!frame1.ok) {
    assert.fail("expected focus moved player frame");
  }
  assert.deepEqual(frame1.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: {
        x: 192 + 4 * Math.SQRT1_2 - 1.8 * Math.SQRT1_2,
        y: 400 - 4 * Math.SQRT1_2 + 1.8 * Math.SQRT1_2,
      },
    },
  ]);

  let lastFrame: ReturnType<StageSession["tick"]> = frame1;
  for (let tick = 2; tick <= 20; tick += 1) {
    lastFrame = started.tick(createMoveInputFrame(tick, 1, 1, []));
    assert.equal(lastFrame.ok, true);
  }
  const playerAfterClamp = lastFrame.ok && lastFrame.value.state.entities[0];
  assert.equal(playerAfterClamp && playerAfterClamp.kind, "player");
  assert.equal(playerAfterClamp && playerAfterClamp.definitionId, "player.default");
  assert.equal(playerAfterClamp && playerAfterClamp.position.y, 448);
  assert.equal(
    playerAfterClamp && Math.abs(playerAfterClamp.position.x - (192 + 4 * Math.SQRT1_2 - 1.8 * Math.SQRT1_2 + 19 * 4 * Math.SQRT1_2)) < 1e-12,
    true,
  );
});

test("spawns player shots from the pre-movement player position on the same tick", () => {
  const started = startMinimumStage();

  const frame = started.tick(createMoveAndPressedShotInputFrame(0, 1, 0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected moving shot frame");
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
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 196, y: 400 },
    },
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
});

test("spawns player shot entities from shot input deterministically", () => {
  const started = startMinimumStage();

  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected shot frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), ["stageStarted", "playerShotsSpawnedBatch", "tickAdvanced"]);
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
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
  assert.equal(Object.isFrozen(frame.value.events), true);
  assert.equal(Object.isFrozen(frame.value.events[1]), true);
  if (frame.value.events[1]?.type !== "playerShotsSpawnedBatch") {
    assert.fail("expected playerShotsSpawnedBatch event");
  }
  assert.equal(Object.isFrozen(frame.value.events[1].shots), true);
  assert.equal(Object.isFrozen(frame.value.events[1].shots[0]), true);
  assert.equal(Object.isFrozen(frame.value.events[1].shots[0]?.position), true);
  assert.equal(Object.isFrozen(frame.value.state.entities[1]), true);
  assert.equal(Object.isFrozen(frame.value.state.entities[1]?.position), true);

  const nextFrame = started.tick(createShotInputFrame(1));
  assert.equal(nextFrame.ok, true);
  assert.deepEqual(nextFrame.ok && nextFrame.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(nextFrame.ok && nextFrame.value.state.entities.map((entity) => entity.id), [1, 2]);
  assert.deepEqual(nextFrame.ok && nextFrame.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 384 },
    },
  ]);

  const intervalFrame2 = started.tick(createShotInputFrame(2));
  assert.equal(intervalFrame2.ok, true);
  assert.deepEqual(intervalFrame2.ok && intervalFrame2.value.events.map((event) => event.type), ["tickAdvanced"]);

  const intervalFrame3 = started.tick(createShotInputFrame(3));
  assert.equal(intervalFrame3.ok, true);
  assert.deepEqual(intervalFrame3.ok && intervalFrame3.value.events.map((event) => event.type), [
    "playerShotsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(intervalFrame3.ok && intervalFrame3.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 3,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
});

test("moves player shots by content velocity and cleans them up after lifetime", () => {
  const started = startMinimumStage();

  const frame0 = started.tick(createShotInputFrame(0));
  assert.equal(frame0.ok, true);
  if (!frame0.ok) {
    assert.fail("expected first shot frame");
  }
  assert.deepEqual(frame0.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);

  const frame1 = started.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  if (!frame1.ok) {
    assert.fail("expected moved shot frame");
  }
  assert.deepEqual(frame1.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 384 },
    },
  ]);

  const frame2 = started.tick(createEmptyInputFrame(2));
  assert.equal(frame2.ok, true);
  if (!frame2.ok) {
    assert.fail("expected last visible shot frame");
  }
  assert.deepEqual(frame2.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 376 },
    },
  ]);

  const frame3 = started.tick(createEmptyInputFrame(3));
  assert.equal(frame3.ok, true);
  if (!frame3.ok) {
    assert.fail("expected cleanup frame");
  }
  assert.deepEqual(frame3.value.state.entities.map((entity) => entity.kind), ["player"]);
});

test("auto-fires held shot input by content fire interval", () => {
  const started = startMinimumStage();

  const frames = [
    started.tick(createHeldShotInputFrame(0)),
    started.tick(createHeldShotInputFrame(1)),
    started.tick(createHeldShotInputFrame(2)),
    started.tick(createHeldShotInputFrame(3)),
  ];
  for (const frame of frames) {
    assert.equal(frame.ok, true);
  }

  const [frame0, frame1, frame2, frame3] = frames;
  if (!frame0?.ok || !frame1?.ok || !frame2?.ok || !frame3?.ok) {
    assert.fail("expected held shot frames");
  }
  assert.deepEqual(frame0.value.events.map((event) => event.type), ["stageStarted", "playerShotsSpawnedBatch", "tickAdvanced"]);
  assert.deepEqual(frame1.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(frame2.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(frame3.value.events.map((event) => event.type), ["playerShotsSpawnedBatch", "tickAdvanced"]);
  assert.deepEqual(frame3.value.events[0], {
    type: "playerShotsSpawnedBatch",
    tick: 3,
    shots: [
      {
        entityId: 3,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(frame3.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 3,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
});

test("uses player shot content fire interval instead of a fixed cooldown", () => {
  const definition = createMinimumDefinition();
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0]!,
        fire: { intervalTicks: 2 },
      }],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game with interval two shot");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected interval two stage session");
  }

  const frame0 = started.value.tick(createHeldShotInputFrame(0));
  const frame1 = started.value.tick(createHeldShotInputFrame(1));
  const frame2 = started.value.tick(createHeldShotInputFrame(2));
  assert.equal(frame0.ok, true);
  assert.equal(frame1.ok, true);
  assert.equal(frame2.ok, true);
  if (!frame0.ok || !frame1.ok || !frame2.ok) {
    assert.fail("expected interval two held shot frames");
  }

  assert.deepEqual(frame0.value.events.map((event) => event.type), ["stageStarted", "playerShotsSpawnedBatch", "tickAdvanced"]);
  assert.deepEqual(frame1.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(frame2.value.events.map((event) => event.type), ["playerShotsSpawnedBatch", "tickAdvanced"]);
  assert.deepEqual(frame2.value.events[0], {
    type: "playerShotsSpawnedBatch",
    tick: 2,
    shots: [
      {
        entityId: 3,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
});

test("keeps a lifetime one player shot visible on its spawn frame", () => {
  const definition = createMinimumDefinition();
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0]!,
        fire: { intervalTicks: 3 },
        projectile: { velocity: { x: 0, y: -8 }, lifetimeTicks: 1 },
      }],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected lifetime one content to load");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected lifetime one stage session");
  }

  const frame0 = started.value.tick(createShotInputFrame(0));
  assert.equal(frame0.ok, true);
  if (!frame0.ok) {
    assert.fail("expected lifetime one spawn frame");
  }
  assert.deepEqual(frame0.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);

  const frame1 = started.value.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  if (!frame1.ok) {
    assert.fail("expected lifetime one cleanup frame");
  }
  assert.deepEqual(frame1.value.state.entities.map((entity) => entity.kind), ["player"]);
});

test("spawns one player shot batch from pressed-only shot input", () => {
  const started = startMinimumStage();

  const frame = started.tick(createPressedShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected pressed shot frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "playerShotsSpawnedBatch",
    "tickAdvanced",
  ]);
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
});

test("spawns one player shot batch when shot is both held and pressed", () => {
  const started = startMinimumStage();

  const frame = started.tick(createHeldAndPressedShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected held and pressed shot frame");
  }

  assert.deepEqual(frame.value.events.filter((event) => event.type === "playerShotsSpawnedBatch"), [
    {
      type: "playerShotsSpawnedBatch",
      tick: 0,
      shots: [
        {
          entityId: 2,
          definitionId: "playerShot.basic",
          position: { x: 192, y: 400 },
        },
      ],
    },
  ]);
  if (frame.value.events[1]?.type !== "playerShotsSpawnedBatch") {
    assert.fail("expected playerShotsSpawnedBatch event");
  }
  assert.equal(frame.value.events[1].shots.length, 1);
  assert.deepEqual(frame.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
});

test("uses the selected player's shot definition when spawning player shots", () => {
  const definition = createMinimumDefinition();
  const basePlayer = definition.content.players[0]!;
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      assetKeys: {
        keys: [
          ...definition.content.assetKeys.keys,
          "player.alt",
          "shot.player_alt",
        ],
      },
      players: [
        ...definition.content.players,
        {
          ...basePlayer,
          id: "player.alt",
          asset: "player.alt",
          shot: { definition: "playerShot.alt" },
        },
      ],
      playerShots: [
        ...definition.content.playerShots,
        {
          id: "playerShot.alt",
          version: 1,
          asset: "shot.player_alt",
          collision: { radius: 7 },
          damage: 9,
          fire: { intervalTicks: 3 },
          projectile: { velocity: { x: 0, y: -12 }, lifetimeTicks: 3 },
        },
      ],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game with alternate player");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    playerId: "player.alt",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected alternate player stage");
  }

  const frame = started.value.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected alternate player shot frame");
  }

  assert.deepEqual(frame.value.events[1], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 2,
        definitionId: "playerShot.alt",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.alt",
      position: { x: 192, y: 400 },
    },
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.alt",
      position: { x: 192, y: 388 },
    },
  ]);
});

test("orders timeline enemy spawn before player shot batch on the same tick", () => {
  const definition = createMinimumDefinition();
  const baseStage = definition.content.stages[0]!;
  const spawnStep = baseStage.timeline[0]!;
  const loaded = createShootingCore("0.0.0").load({
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
            },
          ],
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
    pattern: "pattern.none",
    position: { x: 192, y: -16 },
  });
  assert.deepEqual(frame.value.events[2], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 3,
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
    { id: 3, kind: "playerShot", definitionId: "playerShot.basic", position: { x: 192, y: 392 } },
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
  const loaded = createShootingCore("0.0.0").load({
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

test("rejects invalid numeric content constraints", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          collision: { radius: 0 },
        },
      ],
      stages: [
        {
          ...definition.content.stages[0],
          timeline: [
            {
              ...definition.content.stages[0]!.timeline[0]!,
              tick: 1.5,
            },
          ],
        },
      ],
      enemies: [{ ...definition.content.enemies[0], collision: { radius: -2 }, hp: -10 }],
      bullets: [{ ...definition.content.bullets[0], collision: { radius: 0 } }],
      playerShots: [{
        ...definition.content.playerShots[0],
        collision: { radius: -1 },
        projectile: { velocity: { x: Number.NaN, y: -8 }, lifetimeTicks: 0 },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors.every((error) => error.code === "definition.invalidShape"), true);
});

test("rejects player focus speed that exceeds normal movement speed", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          movement: { speed: 4, focusSpeed: 8 },
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "player.movement.focusSpeed must be less than or equal to player.movement.speed",
  ]);
});

test("rejects player movement speeds that exceed runtime budgets", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          movement: { speed: 17, focusSpeed: 16.5 },
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "player.movement.speed must be less than or equal to 16",
    "player.movement.focusSpeed must be less than or equal to 16",
  ]);
});

test("rejects invalid player shot projectile constraints in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0],
        projectile: { velocity: { x: "fast", y: -8 }, lifetimeTicks: 0 },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.projectile.velocity.x must be a finite number",
    "playerShot.projectile.lifetimeTicks must be a positive integer",
  ]);
});

test("rejects invalid player shot fire interval constraints in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  for (const intervalTicks of [undefined, 0, 1.5, "3"] as const) {
    const loaded = loadUnknown({
      ...definition,
      content: {
        ...definition.content,
        playerShots: [{
          ...definition.content.playerShots[0],
          fire: intervalTicks === undefined ? {} : { intervalTicks },
        }],
      },
    });

    assert.equal(loaded.ok, false);
    assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
      "playerShot.fire.intervalTicks must be a positive integer",
    ]);
  }
});

test("rejects unknown player shot fire fields in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0],
        fire: { intervalTicks: 3, extra: true },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "Unknown field at playerShot.fire.extra",
  ]);
});

test("rejects player shot fire intervals that exceed runtime budgets", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0],
        fire: { intervalTicks: 61 },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.fire.intervalTicks must be at most 60",
  ]);
});

test("accepts player shot fire interval budget boundaries", () => {
  const definition = createMinimumDefinition();
  for (const intervalTicks of [1, 60] as const) {
    const loaded = loadUnknown({
      ...definition,
      content: {
        ...definition.content,
        playerShots: [{
          ...definition.content.playerShots[0],
          fire: { intervalTicks },
        }],
      },
    });

    assert.equal(loaded.ok, true);
  }
});

test("rejects missing player shot fire objects in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  const playerShotWithoutFire = { ...definition.content.playerShots[0] } as Record<string, unknown>;
  delete playerShotWithoutFire.fire;
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [playerShotWithoutFire],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.fire must be an object",
  ]);
});

test("rejects missing player shot projectile objects in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  const playerShotWithoutProjectile = { ...definition.content.playerShots[0] } as Record<string, unknown>;
  delete playerShotWithoutProjectile.projectile;
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [playerShotWithoutProjectile],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.projectile must be an object",
  ]);
});

test("rejects missing player shot projectile velocity in otherwise valid content", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0],
        projectile: { lifetimeTicks: 3 },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.projectile.velocity must be an object",
  ]);
});

test("rejects player shot projectile values that exceed runtime budgets", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      playerShots: [{
        ...definition.content.playerShots[0],
        projectile: { velocity: { x: 65, y: -65 }, lifetimeTicks: 301 },
      }],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.message), [
    "playerShot.projectile.velocity.x must be between -64 and 64",
    "playerShot.projectile.velocity.y must be between -64 and 64",
    "playerShot.projectile.lifetimeTicks must be at most 300",
  ]);
});

test("rejects empty asset keys and duplicate difficulties", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      assetKeys: {
        keys: [...definition.content.assetKeys.keys, "", "player.default"],
      },
      stages: [
        {
          ...definition.content.stages[0],
          difficulties: ["normal", "normal"],
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), [
    "asset.invalidKey",
    "asset.duplicate",
    "definition.invalidShape",
  ]);
});

test("rejects stages that cannot be started because no difficulty is supported", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...definition.content.stages[0],
          difficulties: [],
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "definition.invalidShape");
});

test("rejects unsorted stage timeline ticks", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...definition.content.stages[0],
          timeline: [
            { ...definition.content.stages[0]!.timeline[0]!, tick: 60 },
            { ...definition.content.stages[0]!.timeline[0]!, tick: 30 },
          ],
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "timeline.invalidOrder");
});

test("rejects stage timeline content that exceeds runtime budgets", () => {
  const definition = createMinimumDefinition();
  const spawnStep = definition.content.stages[0]!.timeline[0]!;
  const tooManySameTickSpawns = Array.from({ length: 101 }, () => ({ ...spawnStep, tick: 0 }));
  const sameTickLoaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...definition.content.stages[0],
          timeline: tooManySameTickSpawns,
        },
      ],
    },
  });

  assert.equal(sameTickLoaded.ok, false);
  assert.equal(
    !sameTickLoaded.ok && sameTickLoaded.errors.some((error) => error.code === "timeline.tooManySpawnsPerTick"),
    true,
  );

  const tooManySteps = Array.from({ length: 4_097 }, (_, index) => ({ ...spawnStep, tick: index }));
  const tooLongLoaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...definition.content.stages[0],
          timeline: tooManySteps,
        },
      ],
    },
  });

  assert.equal(tooLongLoaded.ok, false);
  assert.equal(!tooLongLoaded.ok && tooLongLoaded.errors.some((error) => error.code === "timeline.tooManySteps"), true);
});

test("rejects malformed namespace ids and asset keys", () => {
  const definition = createMinimumDefinition();
  const invalidAsset = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      assetKeys: {
        keys: [...definition.content.assetKeys.keys, "asset/unsafe"],
      },
    },
  });
  assert.equal(invalidAsset.ok, false);
  assert.deepEqual(!invalidAsset.ok && invalidAsset.errors.map((error) => error.code), ["asset.invalidKey"]);

  const invalidId = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          id: "player.",
        },
      ],
    },
  });
  assert.equal(invalidId.ok, false);
  assert.equal(!invalidId.ok && invalidId.errors.some((error) => error.code === "id.invalidNamespace"), true);
});

test("uses the same full-length id constraint during load and startStage", () => {
  const stageId = `stage.${"a".repeat(128)}`;
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...definition.content.stages[0],
          id: stageId,
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors.some((error) => error.code === "id.invalidNamespace"), true);
});

test("rejects malformed asset references before lookup", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      players: [
        {
          ...definition.content.players[0],
          asset: "player/unsafe",
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => error.code), ["asset.invalidKey"]);
});

test("rejects external input that exceeds plain-data clone budgets", () => {
  const tooDeep: Record<string, unknown> = {};
  let cursor = tooDeep;
  for (let depth = 0; depth < 64; depth += 1) {
    cursor.next = {};
    cursor = cursor.next as Record<string, unknown>;
  }

  const loaded = loadUnknown(tooDeep);
  assert.equal(loaded.ok, false);
  assert.equal(!loaded.ok && loaded.errors[0]?.code, "definition.invalidShape");
});

test("rejects out-of-order input ticks without advancing the session", () => {
  const started = startMinimumStage();

  const mismatch = started.tick(createEmptyInputFrame(1));
  assert.equal(mismatch.ok, false);
  assert.equal(!mismatch.ok && mismatch.errors[0]?.code, "input.tickMismatch");

  const recovered = started.tick(createEmptyInputFrame(0));
  assert.equal(recovered.ok, true);
  assert.equal(recovered.ok && recovered.value.tick, 0);
});

test("rejects invalid startStage and tick inputs without throwing", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const invalidStart = startStageUnknown(loaded.value, null);
  assert.equal(invalidStart.ok, false);
  assert.equal(!invalidStart.ok && invalidStart.errors[0]?.code, "startStage.invalidShape");

  const started = startMinimumStage();
  const invalidInput = tickUnknown(started, { tick: 0, axes: { moveX: 2, moveY: 0 }, held: [], pressed: [], released: [] });
  assert.equal(invalidInput.ok, false);
  assert.equal(!invalidInput.ok && invalidInput.errors[0]?.code, "input.invalidShape");

  const recovered = started.tick(createEmptyInputFrame(0));
  assert.equal(recovered.ok, true);
});

test("rejects throwing runtime inputs without leaking exceptions", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const throwingStartOptions = Object.defineProperty({}, "stageId", {
    enumerable: true,
    get() {
      throw new Error("unexpected startStage getter access");
    },
  });
  const invalidStart = startStageUnknown(loaded.value, throwingStartOptions);
  assert.equal(invalidStart.ok, false);
  assert.equal(!invalidStart.ok && invalidStart.errors[0]?.code, "startStage.invalidShape");

  const started = startMinimumStage();
  const throwingInput = new Proxy(createEmptyInputFrame(0), {
    getOwnPropertyDescriptor() {
      throw new Error("unexpected input proxy access");
    },
  });
  const invalidInput = tickUnknown(started, throwingInput);
  assert.equal(invalidInput.ok, false);
  assert.equal(!invalidInput.ok && invalidInput.errors[0]?.code, "input.invalidShape");
});

test("validates startStage seed before creating a PRNG", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const blankSeed = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "   ",
  });
  assert.equal(blankSeed.ok, false);
  assert.equal(!blankSeed.ok && blankSeed.errors[0]?.code, "startStage.invalidShape");
});

test("rejects malformed startStage ids before content lookup", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const invalidStageId = loaded.value.startStage({
    stageId: "stage.",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(invalidStageId.ok, false);
  assert.equal(!invalidStageId.ok && invalidStageId.errors[0]?.code, "startStage.invalidShape");

  const invalidPlayerId = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    playerId: "player/unsafe" as never,
    seed: "seed-1",
  });
  assert.equal(invalidPlayerId.ok, false);
  assert.equal(!invalidPlayerId.ok && invalidPlayerId.errors[0]?.code, "startStage.invalidShape");
});

test("rejects valid startStage ids that are not available in loaded content", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const missingStage = loaded.value.startStage({
    stageId: "stage.missing",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(missingStage.ok, false);
  assert.equal(!missingStage.ok && missingStage.errors[0]?.code, "stage.notFound");

  const missingPlayer = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    playerId: "player.missing",
    seed: "seed-1",
  });
  assert.equal(missingPlayer.ok, false);
  assert.equal(!missingPlayer.ok && missingPlayer.errors[0]?.code, "player.notFound");

  const unsupportedDifficulty = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "hard",
    seed: "seed-1",
  });
  assert.equal(unsupportedDifficulty.ok, false);
  assert.equal(!unsupportedDifficulty.ok && unsupportedDifficulty.errors[0]?.code, "difficulty.notSupported");
});

test("canonicalizes input actions and accepts same-tick tap edges", () => {
  const sorted = startMinimumStage();
  const sortedFrame = sorted.tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: ["focus", "shot"],
    pressed: ["focus"],
    released: [],
  });
  assert.equal(sortedFrame.ok, true);

  const duplicated = startMinimumStage().tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: ["shot", "shot"],
    pressed: [],
    released: [],
  });
  assert.equal(duplicated.ok, false);
  assert.equal(!duplicated.ok && duplicated.errors[0]?.code, "input.invalidShape");

  const crossed = startMinimumStage().tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: [],
    pressed: ["shot"],
    released: ["shot"],
  });
  assert.equal(crossed.ok, true);
  if (!crossed.ok) {
    assert.fail("expected crossed tap edge frame");
  }
  assert.deepEqual(crossed.ok && crossed.value.events.map((event) => event.type), [
    "stageStarted",
    "playerShotsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(crossed.value.events[1], {
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
  assert.deepEqual(crossed.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);

  const heldReleased = startMinimumStage().tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: ["shot"],
    pressed: ["shot"],
    released: ["shot"],
  });
  assert.equal(heldReleased.ok, false);
  assert.equal(!heldReleased.ok && heldReleased.errors[0]?.code, "input.invalidShape");
});

test("rejects mismatch after a successful tick without duplicating pending events", () => {
  const started = startMinimumStage();

  const frame0 = started.tick(createEmptyInputFrame(0));
  assert.equal(frame0.ok, true);

  const mismatch = started.tick(createEmptyInputFrame(2));
  assert.equal(mismatch.ok, false);

  const frame1 = started.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  assert.deepEqual(frame1.ok && frame1.value.events.map((event) => event.type), ["tickAdvanced"]);
});

test("recovers from a tick mismatch after spawning a player shot without duplicating ids", () => {
  const started = startMinimumStage();

  const frame0 = started.tick(createShotInputFrame(0));
  assert.equal(frame0.ok, true);

  const frame1 = started.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);

  const mismatch = started.tick(createShotInputFrame(3));
  assert.equal(mismatch.ok, false);
  assert.equal(!mismatch.ok && mismatch.errors[0]?.code, "input.tickMismatch");

  const frame2 = started.tick(createEmptyInputFrame(2));
  assert.equal(frame2.ok, true);

  const frame3 = started.tick(createShotInputFrame(3));
  assert.equal(frame3.ok, true);
  if (!frame3.ok) {
    assert.fail("expected recovered shot frame");
  }
  assert.deepEqual(frame3.value.events, [
    {
      type: "playerShotsSpawnedBatch",
      tick: 3,
      shots: [
        {
          entityId: 3,
          definitionId: "playerShot.basic",
          position: { x: 192, y: 400 },
        },
      ],
    },
    { type: "tickAdvanced", tick: 3 },
  ]);
  assert.deepEqual(frame3.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
    {
      id: 3,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);
});

test("returns immutable event frames and drains one-shot events", () => {
  const started = startMinimumStage();

  const frame0 = started.tick(createEmptyInputFrame(0));
  assert.equal(frame0.ok, true);
  if (!frame0.ok) {
    assert.fail("expected frame");
  }
  assert.equal(Object.isFrozen(frame0.value.events), true);
  assert.equal(Object.isFrozen(frame0.value.events[0]), true);

  const frame1 = started.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  assert.deepEqual(frame1.ok && frame1.value.events.map((event) => event.type), ["tickAdvanced"]);
});

function startMinimumStage() {
  const loaded = createShootingCore("0.0.0").load(createMinimumDefinition());
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

  return started.value;
}

function createShotInputFrame(tick: number): InputFrame {
  return createPressedShotInputFrame(tick);
}

function createHeldShotInputFrame(tick: number): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX: 0, moveY: 0 }),
    held: Object.freeze(["shot"] as const),
    pressed: Object.freeze([] as const),
    released: Object.freeze([] as const),
  });
}

function createMoveInputFrame(
  tick: number,
  moveX: -1 | 0 | 1,
  moveY: -1 | 0 | 1,
  held: InputFrame["held"],
): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX, moveY }),
    held: Object.freeze([...held]),
    pressed: Object.freeze([] as const),
    released: Object.freeze([] as const),
  });
}

function createPressedShotInputFrame(tick: number): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX: 0, moveY: 0 }),
    held: Object.freeze([] as const),
    pressed: Object.freeze(["shot"] as const),
    released: Object.freeze([] as const),
  });
}

function createMoveAndPressedShotInputFrame(tick: number, moveX: -1 | 0 | 1, moveY: -1 | 0 | 1): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX, moveY }),
    held: Object.freeze([] as const),
    pressed: Object.freeze(["shot"] as const),
    released: Object.freeze([] as const),
  });
}

function createHeldAndPressedShotInputFrame(tick: number): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX: 0, moveY: 0 }),
    held: Object.freeze(["shot"] as const),
    pressed: Object.freeze(["shot"] as const),
    released: Object.freeze([] as const),
  });
}

function loadUnknown(definition: unknown) {
  return createShootingCore().load(definition as GameDefinition);
}

function startStageUnknown(session: LoadedGame, options: unknown) {
  return session.startStage(options as StartStageOptions);
}

function tickUnknown(session: StageSession, input: unknown) {
  return session.tick(input as InputFrame);
}
