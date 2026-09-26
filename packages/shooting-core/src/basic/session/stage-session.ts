import type { ReadonlyGameState, ReadonlyPlayerState, StageSession } from "../api-types.ts";
import type {
  BulletDefinition,
  EnemyDefinition,
  PatternDefinition,
  PlayerDefinition,
  PlayerId,
  PlayerShotDefinition,
  StageDefinition,
} from "../content/types.ts";
import { parseInputFrame } from "../input/parse-input-frame.ts";
import { createHeadlessDebugTickMetrics, serializeHeadlessDebugState } from "../internal/debug-state.ts";
import type { HeadlessDebugTickMetrics } from "../internal/debug-state.ts";
import { deepFreezeClone, deepFreezePlainData } from "../internal/immutable.ts";
import {
  createSerializeSourceState,
  failAfterWorkingMutationForTesting,
} from "../internal/stage-session-testing-hooks.ts";
import type { ActiveStageSessionTestingHooks } from "../internal/stage-session-testing-hooks.ts";
import { coreError, errorResult, okResult } from "../result.ts";
import type { CoreError, CoreResult } from "../result.ts";
import type { StageSessionSerializationMetadata } from "../serialization/metadata.ts";
import { resolveCollisionAndScoring } from "../simulation/collision-system.ts";
import { spawnEnemyBulletsOnSpawn } from "../simulation/enemy-bullet-system.ts";
import { advancePlayerMovement } from "../simulation/player-movement-system.ts";
import { advancePlayerShotLifecycle } from "../simulation/player-shot-lifecycle-system.ts";
import { spawnPlayerShotFromInput } from "../simulation/player-shot-system.ts";
import { createEnemyRuntimeEntity, toReadonlyEntityState } from "../simulation/runtime-entity.ts";
import type { EnemyRuntimeEntity, PlayerRuntimeEntity, RuntimeEntityState } from "../simulation/runtime-entity.ts";
import { freezeEntitiesInIdOrder } from "../simulation/system-order.ts";
import { createCommittedStageState, createWorkingStageState } from "../state/committed-state.ts";
import type { CommittedStageState, UntrustedCommittedStageState } from "../state/committed-state.ts";
import { createHashableGameState } from "../state/hashable-projection.ts";
import { serializeCommittedStageState } from "../state/serialize-projection.ts";

export type StageSessionContext = {
  debugSeed: string | null;
  initialState: CommittedStageState;
  serializationMetadata: StageSessionSerializationMetadata;
  bulletsById: ReadonlyMap<string, BulletDefinition>;
  enemiesById: ReadonlyMap<string, EnemyDefinition>;
  patternsById: ReadonlyMap<string, PatternDefinition>;
  playerShotsById: ReadonlyMap<string, PlayerShotDefinition>;
  stage: StageDefinition;
  player: PlayerDefinition;
  testingHooks: ActiveStageSessionTestingHooks;
};

/**
 * 1 stage の simulation session を作る。
 *
 * 各 system は working state 上で実行し、frame 構築直前に成功時だけ session state へ
 * commit する。これにより ID 採番、collision、score、event 順序を deterministic に保つ。
 */
export function createStageSession(options: StageSessionContext): StageSession {
  let committedState = options.initialState;
  const debugMetricsEnabled = options.testingHooks.registerHeadlessDebugStateSerializer !== undefined;
  let debugTickMetrics: HeadlessDebugTickMetrics | null = null;
  let fatalErrors: readonly CoreError[] | null = null;
  const latchFatalErrors = <T>(errors: readonly CoreError[]): CoreResult<T> => {
    options.testingHooks.recordCommittedStateOnFatal?.(deepFreezeClone(committedState));
    fatalErrors = freezeFatalErrors(errors);
    return errorResult(fatalErrors);
  };

  const session: StageSession = {
    serialize() {
      if (fatalErrors) {
        return errorResult(fatalErrors);
      }
      const serializedState = createSerializeSourceState(committedState, options.testingHooks);
      const serialized = serializeCommittedStageState(options.serializationMetadata, serializedState);
      if (!serialized.ok) {
        return latchFatalErrors(serialized.errors);
      }
      if (options.testingHooks.recordHashableStateOnSerialize) {
        const hashableState = createHashableGameState(options.serializationMetadata, committedState);
        if (!hashableState.ok) {
          return latchFatalErrors(hashableState.errors);
        }
        options.testingHooks.recordHashableStateOnSerialize(hashableState.value);
      }
      return serialized;
    },
    tick(rawInput) {
      if (fatalErrors) {
        return errorResult(fatalErrors);
      }
      const plainInput = deepFreezePlainData(rawInput);
      if (!plainInput) {
        return coreError("input.invalidShape", "InputFrame must be JSON-compatible plain data");
      }
      const input = parseInputFrame(plainInput);
      if (!input.ok) {
        return input;
      }
      // system order の applyInput。入力 tick のズレは状態を進める前に拒否する。
      if (input.value.tick !== committedState.expectedTick) {
        return coreError("input.tickMismatch", `Expected tick ${committedState.expectedTick}, got ${input.value.tick}`);
      }

      if (options.testingHooks.corruptCommittedPrngStateTicks.delete(committedState.expectedTick)) {
        committedState = {
          ...committedState,
          prngState: Object.freeze({ state: 0 }),
        };
      }
      if (options.testingHooks.overrideCommittedNextEntityIdByTick.has(committedState.expectedTick)) {
        const nextEntityId = options.testingHooks.overrideCommittedNextEntityIdByTick.get(committedState.expectedTick)!;
        options.testingHooks.overrideCommittedNextEntityIdByTick.delete(committedState.expectedTick);
        committedState = {
          ...committedState,
          nextEntityId,
        };
      }
      let workingStateSource: UntrustedCommittedStageState = committedState;
      if (options.testingHooks.overrideCommittedPendingEventsByTick.has(committedState.expectedTick)) {
        const pendingEvents = options.testingHooks.overrideCommittedPendingEventsByTick.get(committedState.expectedTick)!;
        options.testingHooks.overrideCommittedPendingEventsByTick.delete(committedState.expectedTick);
        workingStateSource = {
          ...committedState,
          pendingEvents: deepFreezeClone(pendingEvents),
        };
      }

      const working = createWorkingStageState(workingStateSource, options.stage.id);
      if (!working.ok) {
        return latchFatalErrors(working.errors);
      }
      const spawnedEnemyEntities: EnemyRuntimeEntity[] = [];

      // system order の updateStageTimeline。timeline 順に spawn event を生成する。
      while (
        working.value.timelineCursor < options.stage.timeline.length
        && options.stage.timeline[working.value.timelineCursor]!.tick === working.value.expectedTick
      ) {
        const step = options.stage.timeline[working.value.timelineCursor]!;
        if (step.action.type === "spawnEnemy") {
          const enemyDefinition = options.enemiesById.get(step.action.enemy);
          if (!enemyDefinition) {
            return latchFatalErrors([{ code: "enemy.notFound", message: `Enemy not found: ${step.action.enemy}` }]);
          }
          const entity = createEnemyRuntimeEntity(working.value.entityAllocator, enemyDefinition, step.action);
          if (!entity.ok) {
            return latchFatalErrors(entity.errors);
          }
          working.value.activeEntities.push(entity.value);
          spawnedEnemyEntities.push(entity.value);
          working.value.eventLog.push({
            type: "entitySpawned",
            tick: working.value.expectedTick,
            entityId: entity.value.id,
            entityKind: "enemy",
            definitionId: step.action.enemy,
            path: step.action.path,
            pattern: step.action.pattern,
            position: step.action.position,
          });
        }
        working.value.timelineCursor += 1;
      }

      // system order の spawnBulletsPlayerShots。enemy pattern の弾生成を player shot より先に確定する。
      const enemyBulletSpawn = spawnEnemyBulletsOnSpawn(
        working.value.entityAllocator,
        working.value.expectedTick,
        spawnedEnemyEntities,
        options.patternsById,
        options.bulletsById,
      );
      if (!enemyBulletSpawn.ok) {
        return latchFatalErrors(enemyBulletSpawn.errors);
      }
      if (enemyBulletSpawn.value) {
        working.value.activeEntities.push(...enemyBulletSpawn.value.entities);
        working.value.eventLog.push(enemyBulletSpawn.value.event);
      }

      // system order の spawnBulletsPlayerShots。pressed / held の shot intent を fire interval で間引く。
      const spawnedPlayerShotEntityIds = new Set<number>();
      const playerEntity = findPlayerEntity(working.value.activeEntities, options.player.id);
      if (!playerEntity) {
        return latchFatalErrors([{ code: "player.notFound", message: `Player entity not found: ${options.player.id}` }]);
      }
      const playerShotDefinition = options.playerShotsById.get(playerEntity.shotDefinitionId);
      if (!playerShotDefinition) {
        return latchFatalErrors([
          { code: "playerShot.notFound", message: `Player shot not found: ${playerEntity.shotDefinitionId}` },
        ]);
      }
      const playerShotSpawn = spawnPlayerShotFromInput(
        working.value.entityAllocator,
        input.value,
        playerEntity,
        playerShotDefinition,
      );
      if (!playerShotSpawn.ok) {
        return latchFatalErrors(playerShotSpawn.errors);
      }
      if (playerShotSpawn.value) {
        if (!replaceRuntimeEntity(working.value.activeEntities, playerShotSpawn.value.player)) {
          return latchFatalErrors([
            { code: "player.notFound", message: `Player entity not found: ${playerShotSpawn.value.player.definitionId}` },
          ]);
        }
        working.value.activeEntities.push(...playerShotSpawn.value.entities);
        for (const entity of playerShotSpawn.value.entities) {
          spawnedPlayerShotEntityIds.add(entity.id);
        }
        working.value.eventLog.push(playerShotSpawn.value.event);
      }

      if (options.testingHooks.failAfterWorkingMutationTicks.delete(working.value.expectedTick)) {
        return failAfterWorkingMutationForTesting(working.value);
      }

      // system order の updateMovement / updateLifetime。player は入力で、player shot は projectile 定義で進める。
      const movedEntities = advancePlayerMovement(working.value.activeEntities, input.value);
      const advancedEntities = advancePlayerShotLifecycle(movedEntities, {
        spawnedThisTickEntityIds: spawnedPlayerShotEntityIds,
      });
      const collision = resolveCollisionAndScoring(advancedEntities, {
        collectMetrics: debugMetricsEnabled,
        playerInvincibleTicksAfterHit: options.player.life.invincibleTicksAfterHit,
        score: working.value.score,
        tick: working.value.expectedTick,
      });
      for (const event of collision.events) {
        working.value.eventLog.push(event);
      }
      const resolvedEntities = collision.entities;
      const resolvedScore = collision.score;

      // PRNG はまだ event payload に出していないが、tick ごとの消費順を先に固定しておく。
      working.value.prng.nextUint32();
      working.value.eventLog.push({ type: "tickAdvanced", tick: working.value.expectedTick });

      // frame に載せる state は renderer が保持しても安全な immutable snapshot にする。
      const orderedEntities = freezeEntitiesInIdOrder(resolvedEntities);
      const resolvedPlayer = findPlayerEntity(orderedEntities, options.player.id);
      if (!resolvedPlayer) {
        return latchFatalErrors([{ code: "player.notFound", message: `Player entity not found: ${options.player.id}` }]);
      }
      const state: ReadonlyGameState = Object.freeze({
        tick: working.value.expectedTick,
        stageId: options.stage.id,
        playerId: options.player.id,
        player: toReadonlyPlayerState(resolvedPlayer),
        score: resolvedScore,
        entities: Object.freeze(orderedEntities.map((entity) => toReadonlyEntityState(entity))),
      });
      const frameEvents = working.value.eventLog.drain();
      const frame = Object.freeze({
        tick: working.value.expectedTick,
        state,
        events: frameEvents,
      });

      committedState = createCommittedStageState({
        activeEntities: orderedEntities,
        expectedTick: working.value.expectedTick + 1,
        nextEntityId: working.value.entityAllocator.snapshot(),
        pendingEvents: [],
        prngState: working.value.prng.snapshot(),
        score: resolvedScore,
        timelineCursor: working.value.timelineCursor,
      });
      if (debugMetricsEnabled && collision.collisionCandidates !== null) {
        debugTickMetrics = createHeadlessDebugTickMetrics(collision.collisionCandidates, frameEvents);
      }
      return okResult(frame);
    },
  };
  options.testingHooks.registerHeadlessDebugStateSerializer?.(
    session,
    () => fatalErrors
      ? errorResult(fatalErrors)
      : serializeHeadlessDebugState(
        options.serializationMetadata,
        committedState,
        options.debugSeed,
        debugTickMetrics,
        options.testingHooks.failHeadlessDebugStateSerialization,
      ),
  );
  return Object.freeze(session);
}

/** 内部 invariant 破壊を fatal reason として latch できる public error に畳む。 */
function freezeFatalErrors(errors: readonly CoreError[]): readonly CoreError[] {
  const detail = errors.map((error) => `${error.code}: ${error.message}`).join("; ");
  return Object.freeze([
    Object.freeze({
      code: "stageSession.fatal" as const,
      message: `Stage session entered a fatal state: ${detail}`,
    }),
  ]);
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
