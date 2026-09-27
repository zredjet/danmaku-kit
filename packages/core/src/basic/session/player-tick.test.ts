import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import type { StageSession } from "../api-types.ts";
import { createDanmakuCore } from "../core.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import type { InputFrame } from "../input/input-frame.ts";
import {
  createMoveInputFrame,
  createPressedShotInputFrame,
  createShotInputFrame,
} from "../test-support/input-frames.ts";
import { startMinimumStage } from "../test-support/stage-harness.ts";

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
  const loaded = createDanmakuCore("0.0.0").load({
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
  const loaded = createDanmakuCore("0.0.0").load({
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
  const loaded = createDanmakuCore("0.0.0").load({
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

function createHeldShotInputFrame(tick: number): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX: 0, moveY: 0 }),
    held: Object.freeze(["shot"] as const),
    pressed: Object.freeze([] as const),
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
