import type { LoadedContentIndex } from "../../content/content-index.ts";
import { MAX_ACTIVE_ENEMY_BULLETS } from "../../content/runtime-budgets.ts";
import type { StageDefinition } from "../../content/types.ts";
import { RESTORE_RUNTIME_ENEMY_BULLET_KEYS, validateRestoreEnemyBulletRuntimeEntity } from "../../entities/enemy-bullet/restore.ts";
import { RESTORE_RUNTIME_ENEMY_KEYS, validateRestoreEnemyRuntimeEntity } from "../../entities/enemy/restore.ts";
import { RUNTIME_ENTITY_KINDS } from "../../entities/entity-kinds.ts";
import type { RuntimeEntityKind } from "../../entities/entity-kinds.ts";
import { RESTORE_RUNTIME_PLAYER_SHOT_KEYS, validateRestorePlayerShotRuntimeEntity } from "../../entities/player-shot/restore.ts";
import {
  RESTORE_RUNTIME_PLAYER_KEYS,
  validateRestoreInitialPlayerEntity,
  validateRestorePlayerRuntimeEntity,
} from "../../entities/player/restore.ts";
import { validateRestoreRuntimeEntityCommon } from "../../entities/restore-common.ts";
import type { RuntimeEntityState } from "../../entities/runtime-entity.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { assertNever } from "../../shared/guards.ts";
import { cloneRestorePlainRecord } from "../restore-plain-data.ts";
import {
  consumeRestoreEnemyBulletBudget,
  consumeRestoreEnemySpawnBudget,
  createRestoreSpawnBudget,
  validateRestoreAllocationEnvelope,
  validateRestoreSameTickAllocationOrder,
} from "./allocation-order.ts";
import type { RestoreMatchedPlayerShot, RestoreMatchedSpawn } from "./allocation-order.ts";
import type { RestoreTopLevelState } from "./top-level-state.ts";

/** kind 別の restore key 一覧。kind を追加したら型検査がここへの登録を要求する。 */
const RESTORE_RUNTIME_ENTITY_KEYS_BY_KIND = Object.freeze({
  player: RESTORE_RUNTIME_PLAYER_KEYS,
  enemy: RESTORE_RUNTIME_ENEMY_KEYS,
  enemyBullet: RESTORE_RUNTIME_ENEMY_BULLET_KEYS,
  playerShot: RESTORE_RUNTIME_PLAYER_SHOT_KEYS,
} satisfies Readonly<Record<RuntimeEntityKind, readonly string[]>>);

/** kind を判定する前の entity shell で受け付ける全 kind の key。 */
const RESTORE_RUNTIME_ENTITY_ALL_KEYS = Object.freeze([
  ...new Set(RUNTIME_ENTITY_KINDS.flatMap((kind) => RESTORE_RUNTIME_ENTITY_KEYS_BY_KIND[kind])),
]);

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
        const budget = consumeRestoreEnemySpawnBudget(
          spawnBudget.value.enemySpawnCandidates,
          enemy.value,
          content.pathsById.get(enemy.value.pathId)?.segments ?? [],
          state.expectedTick,
        );
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
        const budget = consumeRestoreEnemyBulletBudget(
          spawnBudget.value.enemyBulletCandidates,
          bullet.value,
          state.expectedTick,
        );
        if (!budget.ok) {
          return budget;
        }
        if (activeEnemyBulletMatches.length >= MAX_ACTIVE_ENEMY_BULLETS) {
          return coreError("state.invalidShape", `state.runtimeEntities must contain at most ${MAX_ACTIVE_ENEMY_BULLETS} enemy bullets`);
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
