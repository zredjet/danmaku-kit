import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { loadUnknown } from "../test-support/stage-harness.ts";

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

test("rejects unknown stage difficulties", () => {
  const definition = createMinimumDefinition();
  const loaded = loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: [
        {
          ...definition.content.stages[0],
          difficulties: ["normal", "lunatic", "Hard", 1],
        },
      ],
    },
  });

  assert.equal(loaded.ok, false);
  assert.deepEqual(!loaded.ok && loaded.errors.map((error) => [error.code, error.message]), [
    ["definition.invalidShape", "stage.difficulties must contain supported difficulties"],
    ["definition.invalidShape", "stage.difficulties must contain supported difficulties"],
    ["definition.invalidShape", "stage.difficulties must contain supported difficulties"],
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
