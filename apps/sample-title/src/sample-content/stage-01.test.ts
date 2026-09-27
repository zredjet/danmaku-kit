import assert from "node:assert/strict";
import test from "node:test";

import { createShootingCore, type EnemyId, type GameDefinition, type GameEvent } from "@shooting-sample/shooting-core";

import { expandInputScript, runHeadlessReplay } from "../test-support/headless-replay.ts";
import { loadSampleTitleDefinition } from "../test-support/sample-title-game.ts";

/** sample の敵を自機の正面に 1 体だけ止めて置く stage に差し替えた definition。敵、shot、自機は sample の定義のまま使う。 */
async function loadSingleEnemyDefinition(enemy: EnemyId): Promise<GameDefinition> {
  const sample = await loadSampleTitleDefinition();
  return {
    ...sample,
    content: {
      ...sample.content,
      paths: [...sample.content.paths, { id: "path.test_hold", version: 1 }],
      stages: [{
        id: "stage.test_single_enemy",
        version: 1,
        difficulties: ["normal"],
        timeline: [{
          tick: 1,
          action: { type: "spawnEnemy", enemy, path: "path.test_hold", pattern: "pattern.scout_three_way", position: { x: 192, y: 250 } },
        }],
      }],
    },
  };
}

/** 自機を動かさずに撃ち続け、敵の HP を tick ごとに serialize した state から読む。 */
async function shootSingleEnemy(enemy: EnemyId) {
  const loaded = createShootingCore().load(await loadSingleEnemyDefinition(enemy));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return assert.fail("expected the test definition to load");
  }
  const hpByTick: (readonly [number, number])[] = [];
  const { frames } = runHeadlessReplay(
    loaded.value,
    { stageId: "stage.test_single_enemy", difficulty: "normal", seed: "defeat" },
    expandInputScript([{ fromTick: 0, held: ["shot"] }], 120),
    (frame, session) => {
      const serialized = session.serialize();
      assert.equal(serialized.ok, true);
      const target = serialized.ok ? serialized.value.state.runtimeEntities.find((entity) => entity.kind === "enemy") : undefined;
      const lastHp = hpByTick.at(-1)?.[1];
      if (target?.kind === "enemy" && target.hp !== lastHp) {
        hpByTick.push([frame.tick, target.hp]);
      }
    },
  );
  const events = frames.flatMap((frame) => frame.events);
  const destroyed = events.find((event): event is Extract<GameEvent, { type: "entityDestroyed" }> => (
    event.type === "entityDestroyed" && event.entityKind === "enemy"
  ));
  const scored = events.find((event) => event.type === "scoreChanged");
  return { hpByTick, destroyed, scored, frames };
}

test("defeats a sample scout in two shots, emitting the defeat and adding its score", async () => {
  const { hpByTick, destroyed, scored, frames } = await shootSingleEnemy("enemy.scout");

  // scout は HP 10、自機 shot は 1 発 5 damage なので、1 発目で 5 に減り、2 発目で倒れる。
  assert.deepEqual(hpByTick.map(([, hp]) => hp), [10, 5]);
  assert.equal(destroyed?.reason, "defeated");
  assert.ok(destroyed !== undefined && destroyed.tick > hpByTick[1]![0]);
  assert.deepEqual(
    scored?.type === "scoreChanged" ? [scored.tick, scored.enemyId, scored.delta, scored.total] : null,
    [destroyed.tick, "enemy.scout", 100, 100],
  );
  // 敵が timeline を終えて全滅したので、倒した tick で stage が clear になる。
  assert.deepEqual([frames.at(-1)?.tick, frames.at(-1)?.state.status, frames.at(-1)?.state.score], [destroyed.tick, "stageCleared", 100]);
});

test("defeats a sample drone with a single shot", async () => {
  const { hpByTick, destroyed, scored } = await shootSingleEnemy("enemy.drone");

  assert.deepEqual(hpByTick.map(([, hp]) => hp), [5]);
  assert.equal(destroyed?.reason, "defeated");
  assert.deepEqual(scored?.type === "scoreChanged" ? [scored.enemyId, scored.delta] : null, ["enemy.drone", 50]);
});
