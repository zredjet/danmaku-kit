import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { Difficulty, GameDefinition, PatternId } from "@danmaku-kit/core";

import { expandInputScript, runHeadlessReplay } from "../test-support/headless-replay.ts";
import { createSampleTitleCore, loadSampleTitleDefinition } from "../test-support/sample-title-game.ts";

// docs/sample-content-spec.md の「機械で読める仕様」（Phase 2B-13）を、sample content と stage 1 の headless replay golden に照らして
// 確かめる。content か golden を変えたら spec も合わせて変える。

const SPEC_URL = new URL("../../../../docs/sample-content-spec.md", import.meta.url);
const GOLDEN_URL = new URL("./stage-01-replay.golden.json", import.meta.url);
/** 撃たない敵と撃たない自機で、すべての敵が退場するまで進める上限（tick）。 */
const IDLE_TICK_LIMIT = 6_000;
const SILENT_PATTERN_ID: PatternId = "pattern.spec_silent";

type Spec = Readonly<{
  stage: string;
  difficulties: readonly Difficulty[];
  player: Readonly<{ id: string; movement: unknown; collision: unknown; life: unknown; shot: string }>;
  playerShot: Readonly<{ id: string; collision: unknown; damage: number; fire: unknown; projectile: unknown }>;
  bullets: Readonly<Record<string, Readonly<{ radius: number }>>>;
  enemies: Readonly<Record<string, Readonly<{ hp: number; score: number; radius: number; drops: Readonly<Record<string, number>> }>>>;
  pickups: Readonly<Record<string, Readonly<{ score: number; collectRadius: number; magnetRadius?: number; velocity: unknown }>>>;
  patterns: Readonly<Record<string, readonly unknown[]>>;
  waves: readonly Readonly<{
    wave: number;
    ticks: readonly [number, number];
    spawns: Readonly<Record<string, number>>;
    paths: readonly string[];
    patterns: readonly string[];
  }>[];
  idleClearTick: number;
  golden: Readonly<Record<string, unknown>>;
}>;

type Golden = Readonly<{
  seed: string;
  weavePeriodTicks: number;
  end: Readonly<{ tick: number; status: string; score: number; lives: number }>;
  defeats: readonly Readonly<{ enemy: string }>[];
  pickups: Readonly<{ dropped: number; collected: number; score: number }>;
  playerHits: readonly number[];
  firstThreeWay: Readonly<{ tick: number }> | null;
  firstRadial: Readonly<{ tick: number }> | null;
}>;

const SPEC_KEYS = [
  "bullets",
  "difficulties",
  "enemies",
  "golden",
  "idleClearTick",
  "patterns",
  "pickups",
  "player",
  "playerShot",
  "stage",
  "waves",
];
const WAVE_KEYS = ["paths", "patterns", "spawns", "ticks", "wave"];

async function readSpec(): Promise<Spec> {
  const markdown = await readFile(SPEC_URL, "utf8");
  const blocks = [...markdown.matchAll(/^```json sample-content-spec\r?\n([\s\S]*?)^```\r?$/gmu)];
  assert.equal(blocks.length, 1, "the spec must have one sample-content-spec block");
  const spec = JSON.parse(blocks[0]![1]!) as Spec;
  assert.deepEqual(Object.keys(spec).sort(), SPEC_KEYS);
  spec.waves.forEach((wave) => assert.deepEqual(Object.keys(wave).sort(), WAVE_KEYS, `wave ${wave.wave} keys`));
  return spec;
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function stageOf(definition: GameDefinition, spec: Spec) {
  const stage = definition.content.stages.find((candidate) => candidate.id === spec.stage);
  assert.ok(stage, `${spec.stage} must be in the sample content`);
  return stage;
}

test("matches the waves of the spec with the stage timeline", async () => {
  const [spec, definition] = [await readSpec(), await loadSampleTitleDefinition()];
  const stage = stageOf(definition, spec);

  assert.deepEqual(stage.difficulties, spec.difficulties);
  for (const [index, wave] of spec.waves.entries()) {
    assert.equal(wave.wave, index + 1);
    assert.ok(wave.ticks[0] <= wave.ticks[1] && (index === 0 || spec.waves[index - 1]!.ticks[1] < wave.ticks[0]));
  }
  const unassigned = stage.timeline.filter((step) => !spec.waves.some((wave) => wave.ticks[0] <= step.tick && step.tick <= wave.ticks[1]));
  assert.deepEqual(unassigned.map((step) => step.tick), [], "every spawn must belong to a wave");
  for (const wave of spec.waves) {
    const steps = stage.timeline.filter((step) => wave.ticks[0] <= step.tick && step.tick <= wave.ticks[1]);
    assert.deepEqual(
      {
        ticks: [steps[0]?.tick, steps.at(-1)?.tick],
        spawns: countBy(steps.map((step) => step.action.enemy)),
        paths: sortedUnique(steps.map((step) => step.action.path)),
        patterns: sortedUnique(steps.map((step) => step.action.pattern)),
      },
      { ticks: wave.ticks, spawns: wave.spawns, paths: [...wave.paths].sort(), patterns: [...wave.patterns].sort() },
      `wave ${wave.wave}`,
    );
  }
});

test("matches the player, shot, bullets, enemies, pickups and patterns of the spec with the content", async () => {
  const [spec, definition] = [await readSpec(), await loadSampleTitleDefinition()];
  const { content } = definition;
  const stage = stageOf(definition, spec);
  const byId = <T extends { id: string }>(values: readonly T[], id: string): T => {
    const found = values.find((value) => value.id === id);
    assert.ok(found, `${id} must be in the sample content`);
    return found;
  };

  const player = byId(content.players, definition.defaultPlayerId);
  assert.deepEqual(
    { id: player.id, movement: player.movement, collision: player.collision, life: player.life, shot: player.shot.definition },
    spec.player,
  );
  const shot = byId(content.playerShots, player.shot.definition);
  assert.deepEqual(
    { id: shot.id, collision: shot.collision, damage: shot.damage, fire: shot.fire, projectile: shot.projectile },
    spec.playerShot,
  );
  const usedPatterns = content.patterns.filter((pattern) => stage.timeline.some((step) => step.action.pattern === pattern.id));
  const usedBullets = sortedUnique(JSON.stringify(usedPatterns).match(/"bullet\.[^"]+"/gu)?.map((id) => JSON.parse(id) as string) ?? []);
  assert.deepEqual(
    Object.fromEntries(usedBullets.map((id) => [id, { radius: byId(content.bullets, id).collision.radius }])),
    spec.bullets,
  );
  const spawned = sortedUnique(stage.timeline.map((step) => step.action.enemy));
  assert.deepEqual(
    Object.fromEntries(spawned.map((id) => {
      const enemy = byId(content.enemies, id);
      const drops = Object.fromEntries((enemy.drops ?? []).map((drop) => [drop.pickup, drop.count]));
      return [id, { hp: enemy.hp, score: enemy.score, radius: enemy.collision.radius, drops }];
    })),
    spec.enemies,
  );
  assert.deepEqual(
    Object.fromEntries((content.features?.pickups ?? []).map((pickup) => [pickup.id, {
      score: pickup.score,
      collectRadius: pickup.collectRadius,
      ...(pickup.magnetRadius === undefined ? {} : { magnetRadius: pickup.magnetRadius }),
      velocity: pickup.velocity,
    }])),
    spec.pickups,
  );
  assert.deepEqual(Object.fromEntries(usedPatterns.map((pattern) => [pattern.id, pattern.steps])), spec.patterns);
});

test("clears the stage on every difficulty with no defeats when no enemy fires and the player does nothing", async () => {
  const [spec, definition] = [await readSpec(), await loadSampleTitleDefinition()];
  const stage = stageOf(definition, spec);
  // どの敵も撃たない pattern に差し替え、何もしない自機で、すべての path が敵を画面の外まで運んで clear になることを確かめる。
  const silent: GameDefinition = {
    ...definition,
    content: {
      ...definition.content,
      patterns: [...definition.content.patterns, { id: SILENT_PATTERN_ID, version: 1 }],
      stages: definition.content.stages.map((candidate) => candidate.id !== stage.id ? candidate : {
        ...candidate,
        timeline: candidate.timeline.map((step) => ({ ...step, action: { ...step.action, pattern: SILENT_PATTERN_ID } })),
      }),
    },
  };
  const loaded = createSampleTitleCore().load(silent);
  assert.ok(loaded.ok, JSON.stringify(loaded.ok ? null : loaded.errors));
  for (const difficulty of spec.difficulties) {
    const { frames } = runHeadlessReplay(
      loaded.value,
      { stageId: stage.id, difficulty, seed: "idle" },
      expandInputScript([{ fromTick: 0 }], IDLE_TICK_LIMIT),
    );
    const last = frames.at(-1)!;
    assert.deepEqual([last.state.status, last.tick, last.state.score], ["stageCleared", spec.idleClearTick, 0], difficulty);
  }
});

test("matches the golden values of the spec with the stage 1 replay golden", async () => {
  const spec = await readSpec();
  const golden = JSON.parse(await readFile(GOLDEN_URL, "utf8")) as Golden;

  assert.deepEqual(
    {
      seed: golden.seed,
      weavePeriodTicks: golden.weavePeriodTicks,
      clearTick: golden.end.status === "stageCleared" ? golden.end.tick : null,
      score: golden.end.score,
      lives: golden.end.lives,
      defeats: countBy(golden.defeats.map((defeat) => defeat.enemy)),
      pickups: golden.pickups,
      playerHits: golden.playerHits,
      firstThreeWayTick: golden.firstThreeWay?.tick,
      firstRadialTick: golden.firstRadial?.tick,
    },
    spec.golden,
  );
  // 撃破した敵は wave の spawn の数と一致する（golden の入力は全滅させて clear する）。
  const spawned: Record<string, number> = {};
  for (const wave of spec.waves) {
    for (const [enemy, count] of Object.entries(wave.spawns)) {
      spawned[enemy] = (spawned[enemy] ?? 0) + count;
    }
  }
  assert.deepEqual(spec.golden.defeats, spawned);
});
