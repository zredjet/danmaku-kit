import type { LoadedContentIndex } from "../../content/content-index.ts";
import type { StageDefinition } from "../../content/types.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { assertNever } from "../../shared/guards.ts";
import { DEFAULT_PLAYER_START_POSITION } from "../../simulation/runtime-entity.ts";
import type { PlayerRuntimeEntity, RuntimeEntityState } from "../../simulation/runtime-entity.ts";
import {
  consumeRestoreEnemyBulletBudget,
  consumeRestoreEnemySpawnBudget,
  createRestoreSpawnBudget,
  isSameRestorePosition,
  validateRestoreAllocationEnvelope,
  validateRestoreSameTickAllocationOrder,
} from "./allocation-order.ts";
import type { RestoreMatchedPlayerShot, RestoreMatchedSpawn } from "./allocation-order.ts";
import { cloneRestorePlainRecord } from "./plain-data.ts";
import {
  RESTORE_RUNTIME_ENTITY_ALL_KEYS,
  validateRestoreEnemyBulletRuntimeEntity,
  validateRestoreEnemyRuntimeEntity,
  validateRestorePlayerRuntimeEntity,
  validateRestorePlayerShotRuntimeEntity,
  validateRestoreRuntimeEntityCommon,
} from "./runtime-entity-kinds.ts";
import type { RestoreTopLevelState } from "./top-level-state.ts";

/** runtimeEntities の ID order、kind 別 shape、registry reference を検証する。 */
export function validateRestoreRuntimeEntities(
  state: RestoreTopLevelState,
  entities: readonly unknown[],
  content: LoadedContentIndex,
  stage: StageDefinition,
  timelineCursor: number,
): CoreResult<readonly RuntimeEntityState[]> {
  const spawnBudget = createRestoreSpawnBudget(stage, timelineCursor, content);
  if (!spawnBudget.ok) {
    return spawnBudget;
  }
  const allocationEnvelope = validateRestoreAllocationEnvelope(state, spawnBudget.value);
  if (!allocationEnvelope.ok) {
    return allocationEnvelope;
  }
  let previousEntityId = 0;
  let playerEntityCount = 0;
  let matchingPlayerEntityCount = 0;
  const activeEnemyMatches: RestoreMatchedSpawn[] = [];
  const activeEnemyBulletMatches: RestoreMatchedSpawn[] = [];
  const activePlayerShotMatches: RestoreMatchedPlayerShot[] = [];
  const activeEntities: RuntimeEntityState[] = [];
  for (let index = 0; index < entities.length; index += 1) {
    const entity = cloneRestorePlainRecord(entities[index], `state.runtimeEntities[${index}]`, RESTORE_RUNTIME_ENTITY_ALL_KEYS);
    if (!entity.ok) {
      return entity;
    }
    const common = validateRestoreRuntimeEntityCommon(entity.value, previousEntityId, state.nextEntityId, index);
    if (!common.ok) {
      return common;
    }
    previousEntityId = common.value.id;

    const entityKind = common.value.kind;
    switch (entityKind) {
      case "player": {
        playerEntityCount += 1;
        if (entity.value.definitionId === state.playerId) {
          matchingPlayerEntityCount += 1;
        }
        if (common.value.id !== 1) {
          return coreError("state.invalidShape", "player runtime entity id must be the initial entity id");
        }
        const player = validateRestorePlayerRuntimeEntity(entity.value, common.value, content, state.expectedTick);
        if (!player.ok) {
          return player;
        }
        if (state.expectedTick === 0) {
          const initialPlayer = validateRestoreInitialPlayerEntity(player.value, content);
          if (!initialPlayer.ok) {
            return initialPlayer;
          }
        }
        activeEntities.push(player.value);
        break;
      }
      case "enemy": {
        const enemy = validateRestoreEnemyRuntimeEntity(entity.value, common.value, content);
        if (!enemy.ok) {
          return enemy;
        }
        const budget = consumeRestoreEnemySpawnBudget(spawnBudget.value.enemySpawnCandidates, entity.value, common.value.position);
        if (!budget.ok) {
          return budget;
        }
        activeEnemyMatches.push(budget.value);
        activeEntities.push(enemy.value);
        break;
      }
      case "enemyBullet": {
        const bullet = validateRestoreEnemyBulletRuntimeEntity(entity.value, common.value, content);
        if (!bullet.ok) {
          return bullet;
        }
        const budget = consumeRestoreEnemyBulletBudget(spawnBudget.value.enemyBulletCandidates, entity.value, common.value.position);
        if (!budget.ok) {
          return budget;
        }
        activeEnemyBulletMatches.push(budget.value);
        activeEntities.push(bullet.value);
        break;
      }
      case "playerShot": {
        const shot = validateRestorePlayerShotRuntimeEntity(entity.value, common.value, content, state.expectedTick);
        if (!shot.ok) {
          return shot;
        }
        activePlayerShotMatches.push(Object.freeze({ id: common.value.id, spawnTick: shot.value.spawnTick }));
        activeEntities.push(shot.value.entity);
        break;
      }
      default:
        assertNever(entityKind);
    }
  }
  if (playerEntityCount !== 1 || matchingPlayerEntityCount !== 1) {
    return coreError("state.invalidShape", "state.runtimeEntities must contain exactly one player matching playerId");
  }
  const sameTickOrder = validateRestoreSameTickAllocationOrder(
    activeEnemyMatches,
    activeEnemyBulletMatches,
    activePlayerShotMatches,
  );
  if (!sameTickOrder.ok) {
    return sameTickOrder;
  }

  return okResult(Object.freeze(activeEntities));
}

/** startStage 直後の player snapshot が一意な初期値と一致することを検証する。 */
function validateRestoreInitialPlayerEntity(
  entity: PlayerRuntimeEntity,
  content: LoadedContentIndex,
): CoreResult<null> {
  const player = content.playersById.get(entity.definitionId);
  if (!player) {
    return coreError("state.registryInvalid", "player runtime entity references an unknown player");
  }
  if (
    !isSameRestorePosition(DEFAULT_PLAYER_START_POSITION, entity.position)
    || entity.lives !== player.life.initialLives
    || entity.invincibleTicksRemaining !== 0
    || entity.nextShotAllowedTick !== 0
  ) {
    return coreError("state.invalidShape", "initial player runtime entity must match startStage defaults");
  }

  return okResult(null);
}
