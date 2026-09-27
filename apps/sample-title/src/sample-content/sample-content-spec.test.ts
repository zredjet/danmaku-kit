import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { GameDefinition, PatternDefinition } from "@shooting-sample/shooting-core";

import { loadSampleTitleDefinition } from "../test-support/sample-title-game.ts";

// docs/sample-content-spec.md の「機械で読める仕様」（Phase 2B-13）を、sample content と stage 1 の headless replay golden に照らして
// 確かめる。content か golden を変えたら spec も合わせて変える。

const SPEC_URL = new URL("../../../../docs/sample-content-spec.md", import.meta.url);
const GOLDEN_URL = new URL("./stage-01-replay.golden.json", import.meta.url);

type Spec = Readonly<{
  stage: string;
  difficulties: readonly string[];
  player: string;
  waves: readonly Readonly<{
    wave: number;
    ticks: readonly [number, number];
    spawns: Readonly<Record<string, number>>;
    patterns: readonly string[];
  }>[];
  enemies: Readonly<Record<string, Readonly<{ hp: number; score: number; drops: Readonly<Record<string, number>> }>>>;
  patterns: Readonly<Record<string, readonly string[]>>;
  pickups: Readonly<Record<string, Readonly<{ score: number }>>>;
  golden: Readonly<{
    seed: string;
    weavePeriodTicks: number;
    clearTick: number;
    score: number;
    lives: number;
    defeats: Readonly<Record<string, number>>;
    pickups: Readonly<{ dropped: number; collected: number; score: number }>;
    playerHits: readonly number[];
    firstThreeWayTick: number;
    firstRadialTick: number;
  }>;
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

async function readSpec(): Promise<Spec> {
  const markdown = await readFile(SPEC_URL, "utf8");
  const blocks = [...markdown.matchAll(/^```json sample-content-spec\n([\s\S]*?)^```$/gmu)];
  assert.equal(blocks.length, 1, "the spec must have one sample-content-spec block");
  return JSON.parse(blocks[0]![1]!) as Spec;
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/** pattern が使う Pattern DSL の命令と fire の修飾（`wait` と `fire` そのもの、`bullet`、`speed` などの必須の値は除く）。 */
function patternFeatures(pattern: PatternDefinition): readonly string[] {
  const features = new Set<string>();
  const visit = (steps: readonly object[]): void => {
    for (const step of steps) {
      if ("fire" in step) {
        const fire = step.fire as object;
        for (const key of ["aim", "angleDeg", "fan", "radial", "stream"]) {
          if (key in fire) {
            features.add(key);
          }
        }
      }
      if ("loop" in step) {
        features.add("loop");
      }
      if ("repeat" in step) {
        features.add("repeat");
        visit((step.repeat as { steps: readonly object[] }).steps);
      }
      if ("if" in step) {
        features.add("if");
        const branch = step.if as { then: readonly object[]; else?: readonly object[] };
        visit([...branch.then, ...branch.else ?? []]);
      }
    }
  };
  visit(pattern.steps ?? []);
  return [...features].sort();
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
  assert.equal(definition.defaultPlayerId, spec.player);
  for (const [index, wave] of spec.waves.entries()) {
    assert.equal(wave.wave, index + 1);
    assert.ok(wave.ticks[0] <= wave.ticks[1] && (index === 0 || spec.waves[index - 1]!.ticks[1] < wave.ticks[0]));
  }
  const unassigned = stage.timeline.filter((step) => !spec.waves.some((wave) => wave.ticks[0] <= step.tick && step.tick <= wave.ticks[1]));
  assert.deepEqual(unassigned.map((step) => step.tick), [], "every spawn must belong to a wave");
  for (const wave of spec.waves) {
    const steps = stage.timeline.filter((step) => wave.ticks[0] <= step.tick && step.tick <= wave.ticks[1]);
    assert.deepEqual(countBy(steps.map((step) => step.action.enemy)), wave.spawns, `wave ${wave.wave} spawns`);
    assert.deepEqual([...new Set(steps.map((step) => step.action.pattern))].sort(), [...wave.patterns].sort(), `wave ${wave.wave} patterns`);
    assert.equal(steps[0]?.tick, wave.ticks[0], `wave ${wave.wave} starts with a spawn`);
    assert.equal(steps.at(-1)?.tick, wave.ticks[1], `wave ${wave.wave} ends with a spawn`);
  }
});

test("matches the enemies, patterns and pickups of the spec with the content", async () => {
  const [spec, definition] = [await readSpec(), await loadSampleTitleDefinition()];
  const stage = stageOf(definition, spec);
  const { content } = definition;
  const spawned = new Set(stage.timeline.map((step) => step.action.enemy));
  const usedPatterns = new Set(stage.timeline.map((step) => step.action.pattern));

  assert.deepEqual(Object.keys(spec.enemies).sort(), [...spawned].sort());
  for (const [id, expected] of Object.entries(spec.enemies)) {
    const enemy = content.enemies.find((candidate) => candidate.id === id)!;
    const drops = Object.fromEntries((enemy.drops ?? []).map((drop) => [drop.pickup, drop.count]));
    assert.deepEqual({ hp: enemy.hp, score: enemy.score, drops }, expected, id);
  }
  assert.deepEqual(Object.keys(spec.patterns).sort(), [...usedPatterns].sort());
  for (const [id, features] of Object.entries(spec.patterns)) {
    const pattern = content.patterns.find((candidate) => candidate.id === id)!;
    assert.deepEqual(patternFeatures(pattern), [...features].sort(), id);
  }
  const pickups = content.features?.pickups ?? [];
  assert.deepEqual(Object.fromEntries(pickups.map((pickup) => [pickup.id, { score: pickup.score }])), spec.pickups);
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
