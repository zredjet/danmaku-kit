import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import type { GameFrame, SerializedGameState, StageSession } from "@shooting-sample/shooting-core";

import {
  expandInputScript,
  runHeadlessReplay,
  serializedStateDigest,
  weavingShotScript,
} from "../test-support/headless-replay.ts";
import { loadSampleTitleGame } from "../test-support/sample-title-game.ts";
import { countGameStateEntities } from "../runtime/view/entity-counts.ts";

const GOLDEN_URL = new URL("./stage-01-replay.golden.json", import.meta.url);
const UPDATE_GOLDENS = process.env.UPDATE_SAMPLE_TITLE_GOLDENS === "1";
const SEED = "stage-01-golden";
/** 80 tick ごとに左右へ往復しながら撃ち続けると、sample stage 1 を 1 機失うだけで全滅させて clear できる。 */
const WEAVE_PERIOD_TICKS = 80;
const MAX_TICKS = 3_600;
const CHECKPOINT_TICKS = [599, 1_199, 1_799];

type Checkpoint = Readonly<{
  tick: number;
  score: number;
  lives: number;
  entityCounts: Readonly<Record<string, number>>;
  player: Readonly<{ x: number; y: number }> | null;
  stateDigest: string;
}>;

/** 敵弾の生成位置が同じ 1 回の発射（fan か radial）。 */
type FanShot = Readonly<{ tick: number; count: number; angleDeg: readonly number[] }>;

/** gunship の radial の輪の弾数。 */
const RADIAL_COUNT = 16;

type ReplaySummary = Readonly<{
  seed: string;
  weavePeriodTicks: number;
  end: Readonly<{ tick: number; status: string; score: number; lives: number }>;
  checkpoints: readonly Checkpoint[];
  defeats: readonly Readonly<{ tick: number; enemy: string; score: number }>[];
  /** drone が落とした pickup の数と、回収した pickup の score。 */
  pickups: Readonly<{ dropped: number; collected: number; score: number }>;
  playerHits: readonly number[];
  firstThreeWay: FanShot | null;
  firstRadial: FanShot | null;
}>;

async function runStage01(seed: string): Promise<ReplaySummary> {
  const inputs = expandInputScript(weavingShotScript(WEAVE_PERIOD_TICKS, MAX_TICKS), MAX_TICKS);
  const checkpoints: Checkpoint[] = [];
  let firstThreeWay: FanShot | null = null;
  let firstRadial: FanShot | null = null;
  const { frames, session } = runHeadlessReplay(
    await loadSampleTitleGame(),
    { stageId: "stage.stage_01", difficulty: "normal", seed },
    inputs,
    (frame, current) => {
      if (CHECKPOINT_TICKS.includes(frame.tick)) {
        checkpoints.push(checkpointOf(frame, current));
      }
      firstThreeWay ??= findVolley(frame, current, 3);
      firstRadial ??= findVolley(frame, current, RADIAL_COUNT);
    },
  );
  const last = frames.at(-1)!;
  checkpoints.push(checkpointOf(last, session));
  const events = frames.flatMap((frame) => frame.events);
  return {
    seed,
    weavePeriodTicks: WEAVE_PERIOD_TICKS,
    end: { tick: last.tick, status: last.state.status, score: last.state.score, lives: last.state.player.lives },
    checkpoints,
    defeats: events.flatMap((event) => event.type === "scoreChanged" && event.reason === "enemyDefeated"
      ? [{ tick: event.tick, enemy: event.enemyId, score: event.delta }]
      : []),
    pickups: {
      dropped: events.reduce((total, event) => total + (event.type === "pickupsSpawnedBatch" ? event.pickups.length : 0), 0),
      collected: events.filter((event) => event.type === "pickupCollected").length,
      score: events.reduce((total, event) => total + (event.type === "scoreChanged" && event.reason === "pickupCollected" ? event.delta : 0), 0),
    },
    playerHits: events.flatMap((event) => event.type === "playerHit" ? [event.tick] : []),
    firstThreeWay,
    firstRadial,
  };
}

function checkpointOf(frame: GameFrame, session: StageSession): Checkpoint {
  const player = frame.state.entities.find((entity) => entity.kind === "player");
  return {
    tick: frame.tick,
    score: frame.state.score,
    lives: frame.state.player.lives,
    entityCounts: countGameStateEntities(frame.state),
    player: player ? { x: player.position.x, y: player.position.y } : null,
    stateDigest: serializedStateDigest(session),
  };
}

/** frame で同じ位置から `count` 発まとめて撃たれた敵弾（3-way や radial）を探し、serialize した速度から向きを求める。 */
function findVolley(frame: GameFrame, session: StageSession, count: number): FanShot | null {
  const batch = frame.events.find((event) => event.type === "enemyBulletsSpawnedBatch");
  if (batch?.type !== "enemyBulletsSpawnedBatch") {
    return null;
  }
  const byOrigin = Map.groupBy(batch.bullets, (bullet) => `${bullet.position.x},${bullet.position.y}`);
  const fan = [...byOrigin.values()].find((bullets) => bullets.length === count);
  if (!fan) {
    return null;
  }
  const serialized = session.serialize();
  assert.equal(serialized.ok, true);
  const state = (serialized as Extract<typeof serialized, { ok: true }>).value as SerializedGameState;
  const angleDeg = fan.map((bullet) => {
    const entity = state.state.runtimeEntities.find((candidate) => candidate.id === bullet.entityId);
    assert.ok(entity?.kind === "enemyBullet");
    // Core の角度は 0.25° 刻みなので、速度から戻した向きもその刻みに丸める。
    return Math.round((Math.atan2(entity.velocity.y, entity.velocity.x) * 180 / Math.PI) * 4) / 4;
  });
  return { tick: frame.tick, count: fan.length, angleDeg };
}

test("replays sample stage 1 to the golden clear with defeats, score, a 3-way and a radial ring", async () => {
  const summary = await runStage01(SEED);
  if (UPDATE_GOLDENS) {
    await writeFile(GOLDEN_URL, `${JSON.stringify(summary, null, 2)}\n`);
  }
  const golden = JSON.parse(await readFile(GOLDEN_URL, "utf8")) as ReplaySummary;

  assert.deepEqual(summary, golden);
  // golden の値に頼らず、milestone の条件（design 21.6 / 23）をこの run で確かめる。
  assert.equal(summary.end.status, "stageCleared");
  assert.equal(summary.end.score, summary.defeats.reduce((total, defeat) => total + defeat.score, 0) + summary.pickups.score);
  assert.ok(summary.pickups.collected > 0 && summary.pickups.collected <= summary.pickups.dropped);
  assert.ok(summary.defeats.some((defeat) => defeat.enemy === "enemy.gunship"));
  assert.ok(summary.firstThreeWay !== null);
  const [left, center, right] = summary.firstThreeWay.angleDeg;
  assert.deepEqual([center! - left!, right! - center!], [15, 15]);
  // radial は 1 周を 16 等分した向き（22.5° 間隔）に並ぶ。
  assert.ok(summary.firstRadial !== null);
  const ring = [...summary.firstRadial.angleDeg].map((angle) => (angle + 360) % 360).sort((a, b) => a - b);
  assert.deepEqual(new Set(ring.map((angle, index) => ((ring[(index + 1) % ring.length]! - angle + 360) % 360))), new Set([22.5]));
});

test("reproduces the same run for the same seed", async () => {
  assert.deepEqual(await runStage01(SEED), await runStage01(SEED));
});
