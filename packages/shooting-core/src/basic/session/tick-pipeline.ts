import type { GameFrame, ReadonlyGameState, ReadonlyPlayerState } from "../api-types.ts";
import type {
  BulletDefinition,
  EnemyDefinition,
  PatternDefinition,
  PlayerDefinition,
  PlayerId,
  PlayerShotDefinition,
  StageDefinition,
} from "../content/types.ts";
import type { InputFrame } from "../input/input-frame.ts";
import { failAfterWorkingMutationForTesting } from "../instrumentation/stage-session-testing-hooks.ts";
import type { ActiveStageSessionTestingHooks } from "../instrumentation/stage-session-testing-hooks.ts";
import type { CoreError, CoreResult } from "../result.ts";
import { resolveCollisionAndScoring } from "../simulation/collision-system.ts";
import { spawnEnemyBulletsOnSpawn } from "../simulation/enemy-bullet-system.ts";
import { advancePlayerMovement } from "../simulation/player-movement-system.ts";
import { advancePlayerShotLifecycle } from "../simulation/player-shot-lifecycle-system.ts";
import { spawnPlayerShotFromInput } from "../simulation/player-shot-system.ts";
import { createEnemyRuntimeEntity, toReadonlyEntityState } from "../simulation/runtime-entity.ts";
import type { EnemyRuntimeEntity, PlayerRuntimeEntity, RuntimeEntityState } from "../simulation/runtime-entity.ts";
import { freezeEntitiesInIdOrder } from "../simulation/system-order.ts";
import { createCommittedStageState } from "../state/committed-state.ts";
import type { CommittedStageState, WorkingStageState } from "../state/committed-state.ts";

/** tick pipeline が参照する load 済み content と、session ごとに消費する test hook。 */
export type StageTickContext = Readonly<{
  bulletsById: ReadonlyMap<string, BulletDefinition>;
  enemiesById: ReadonlyMap<string, EnemyDefinition>;
  patternsById: ReadonlyMap<string, PatternDefinition>;
  playerShotsById: ReadonlyMap<string, PlayerShotDefinition>;
  stage: StageDefinition;
  player: PlayerDefinition;
  testingHooks: ActiveStageSessionTestingHooks;
}>;

/**
 * 1 tick の実行結果。
 *
 * `committed` は次の committed state と frame、`fatal` は content / invariant 破壊として session を
 * fatal latch すべき失敗、`rejected` は working state を捨てるだけの失敗（rollback 検証用 test hook）を表す。
 */
export type StageTickOutcome =
  | Readonly<{
    kind: "committed";
    frame: GameFrame;
    committedState: CommittedStageState;
    collisionCandidates: number | null;
  }>
  | Readonly<{ kind: "fatal"; errors: readonly CoreError[] }>
  | Readonly<{ kind: "rejected"; result: CoreResult<never> }>;

/**
 * working state 上で system order に沿って 1 tick を進め、次の committed state と frame を組み立てる。
 *
 * input の検証、tick 番号の照合、committed state の差し替えは stage session 側の責務とし、ここでは
 * working state だけを変更する。失敗時の working state は呼び出し側で破棄する。
 */
export function runStageTick(
  working: WorkingStageState,
  input: InputFrame,
  options: StageTickContext,
  debugMetricsEnabled: boolean,
): StageTickOutcome {
  const spawnedEnemyEntities: EnemyRuntimeEntity[] = [];

  // system order の updateStageTimeline。timeline 順に spawn event を生成する。
  while (
    working.timelineCursor < options.stage.timeline.length
    && options.stage.timeline[working.timelineCursor]!.tick === working.expectedTick
  ) {
    const step = options.stage.timeline[working.timelineCursor]!;
    if (step.action.type === "spawnEnemy") {
      const enemyDefinition = options.enemiesById.get(step.action.enemy);
      if (!enemyDefinition) {
        return fatalTickOutcome([{ code: "enemy.notFound", message: `Enemy not found: ${step.action.enemy}` }]);
      }
      const entity = createEnemyRuntimeEntity(working.entityAllocator, enemyDefinition, step.action);
      if (!entity.ok) {
        return fatalTickOutcome(entity.errors);
      }
      working.activeEntities.push(entity.value);
      spawnedEnemyEntities.push(entity.value);
      working.eventLog.push({
        type: "entitySpawned",
        tick: working.expectedTick,
        entityId: entity.value.id,
        entityKind: "enemy",
        definitionId: step.action.enemy,
        path: step.action.path,
        pattern: step.action.pattern,
        position: step.action.position,
      });
    }
    working.timelineCursor += 1;
  }

  // system order の spawnBulletsPlayerShots。enemy pattern の弾生成を player shot より先に確定する。
  const enemyBulletSpawn = spawnEnemyBulletsOnSpawn(
    working.entityAllocator,
    working.expectedTick,
    spawnedEnemyEntities,
    options.patternsById,
    options.bulletsById,
  );
  if (!enemyBulletSpawn.ok) {
    return fatalTickOutcome(enemyBulletSpawn.errors);
  }
  if (enemyBulletSpawn.value) {
    working.activeEntities.push(...enemyBulletSpawn.value.entities);
    working.eventLog.push(enemyBulletSpawn.value.event);
  }

  // system order の spawnBulletsPlayerShots。pressed / held の shot intent を fire interval で間引く。
  const spawnedPlayerShotEntityIds = new Set<number>();
  const playerEntity = findPlayerEntity(working.activeEntities, options.player.id);
  if (!playerEntity) {
    return fatalTickOutcome([{ code: "player.notFound", message: `Player entity not found: ${options.player.id}` }]);
  }
  const playerShotDefinition = options.playerShotsById.get(playerEntity.shotDefinitionId);
  if (!playerShotDefinition) {
    return fatalTickOutcome([
      { code: "playerShot.notFound", message: `Player shot not found: ${playerEntity.shotDefinitionId}` },
    ]);
  }
  const playerShotSpawn = spawnPlayerShotFromInput(
    working.entityAllocator,
    input,
    playerEntity,
    playerShotDefinition,
  );
  if (!playerShotSpawn.ok) {
    return fatalTickOutcome(playerShotSpawn.errors);
  }
  if (playerShotSpawn.value) {
    if (!replaceRuntimeEntity(working.activeEntities, playerShotSpawn.value.player)) {
      return fatalTickOutcome([
        { code: "player.notFound", message: `Player entity not found: ${playerShotSpawn.value.player.definitionId}` },
      ]);
    }
    working.activeEntities.push(...playerShotSpawn.value.entities);
    for (const entity of playerShotSpawn.value.entities) {
      spawnedPlayerShotEntityIds.add(entity.id);
    }
    working.eventLog.push(playerShotSpawn.value.event);
  }

  if (options.testingHooks.failAfterWorkingMutationTicks.delete(working.expectedTick)) {
    return Object.freeze({ kind: "rejected", result: failAfterWorkingMutationForTesting(working) });
  }

  // system order の updateMovement / updateLifetime。player は入力で、player shot は projectile 定義で進める。
  const movedEntities = advancePlayerMovement(working.activeEntities, input);
  const advancedEntities = advancePlayerShotLifecycle(movedEntities, {
    spawnedThisTickEntityIds: spawnedPlayerShotEntityIds,
  });
  const collision = resolveCollisionAndScoring(advancedEntities, {
    collectMetrics: debugMetricsEnabled,
    playerInvincibleTicksAfterHit: options.player.life.invincibleTicksAfterHit,
    score: working.score,
    tick: working.expectedTick,
  });
  for (const event of collision.events) {
    working.eventLog.push(event);
  }
  const resolvedEntities = collision.entities;
  const resolvedScore = collision.score;

  // PRNG はまだ event payload に出していないが、tick ごとの消費順を先に固定しておく。
  working.prng.nextUint32();
  working.eventLog.push({ type: "tickAdvanced", tick: working.expectedTick });

  // frame に載せる state は renderer が保持しても安全な immutable snapshot にする。
  const orderedEntities = freezeEntitiesInIdOrder(resolvedEntities);
  const resolvedPlayer = findPlayerEntity(orderedEntities, options.player.id);
  if (!resolvedPlayer) {
    return fatalTickOutcome([{ code: "player.notFound", message: `Player entity not found: ${options.player.id}` }]);
  }
  const state: ReadonlyGameState = Object.freeze({
    tick: working.expectedTick,
    stageId: options.stage.id,
    playerId: options.player.id,
    player: toReadonlyPlayerState(resolvedPlayer),
    score: resolvedScore,
    entities: Object.freeze(orderedEntities.map((entity) => toReadonlyEntityState(entity))),
  });
  const frameEvents = working.eventLog.drain();
  const frame = Object.freeze({
    tick: working.expectedTick,
    state,
    events: frameEvents,
  });

  const committedState = createCommittedStageState({
    activeEntities: orderedEntities,
    expectedTick: working.expectedTick + 1,
    nextEntityId: working.entityAllocator.snapshot(),
    pendingEvents: [],
    prngState: working.prng.snapshot(),
    score: resolvedScore,
    timelineCursor: working.timelineCursor,
  });
  return Object.freeze({
    kind: "committed",
    frame,
    committedState,
    collisionCandidates: collision.collisionCandidates,
  });
}

/** content / invariant 破壊を stage session の fatal latch へ渡す outcome にする。 */
function fatalTickOutcome(errors: readonly CoreError[]): StageTickOutcome {
  return Object.freeze({ kind: "fatal", errors });
}

/** active entity list から現在の自機 runtime component を探す。 */
function findPlayerEntity(
  entities: readonly RuntimeEntityState[],
  playerId: PlayerId,
): PlayerRuntimeEntity | null {
  const entity = entities.find((candidate) => candidate.kind === "player" && candidate.definitionId === playerId);
  return entity?.kind === "player" ? entity : null;
}

/** runtime player component から公開 snapshot に出す状態だけを抜き出す。 */
function toReadonlyPlayerState(player: PlayerRuntimeEntity): ReadonlyPlayerState {
  return Object.freeze({
    lives: player.lives,
    invincibleTicksRemaining: player.invincibleTicksRemaining,
  });
}

/** working entity list 内の同一 ID entity を、更新済み immutable entity へ差し替える。 */
function replaceRuntimeEntity(entities: RuntimeEntityState[], replacement: RuntimeEntityState): boolean {
  const index = entities.findIndex((entity) => entity.id === replacement.id);
  if (index < 0) {
    return false;
  }
  entities[index] = replacement;
  return true;
}
