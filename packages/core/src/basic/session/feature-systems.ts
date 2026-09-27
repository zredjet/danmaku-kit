import type { ReadonlyEntityState, RuntimeEntityState } from "../entities/runtime-entity.ts";
import { toReadonlyEntityState } from "../entities/runtime-entity.ts";
import type { GameEvent } from "../events/game-event.ts";
import type { ReadonlyFeatureFrameState } from "../extension/feature-frame.ts";
import { freezeFeatureState } from "../extension/feature-module.ts";
import type {
  AnyFeatureModule,
  FeatureDefeatedEnemy,
  FeatureStageBase,
  FeatureTickContext,
  FeatureTickSlot,
  LoadedFeature,
} from "../extension/feature-module.ts";
import { okResult } from "../result.ts";
import type { CoreError, CoreResult } from "../result.ts";
import { deepFreezeClone } from "../shared/immutable.ts";
import type { WorkingStageState } from "../state/committed-state.ts";

// tick pipeline が有効な optional feature を呼ぶ口（design 7.1 / 20）。feature がなければどれも何もしない。

export const NO_DEFEATED_ENEMIES: readonly FeatureDefeatedEnemy[] = Object.freeze([]);

/**
 * `slot` に system を持つ feature の state を canonical feature order で進める。失敗した feature があれば stage session を fatal にする
 * error を、なければ null を返す。feature が足した score は `working.score` に、event は working の event log に入る。`scoring` の
 * 文脈だけが score を足せる。feature が文脈と違う tick の event を出すか、不正な score を足せば fatal にする。
 */
export function advanceFeatureSystems(
  working: WorkingStageState,
  features: readonly LoadedFeature[],
  base: FeatureStageBase,
  slot: FeatureTickSlot,
  entities: readonly RuntimeEntityState[],
  defeatedEnemies: readonly FeatureDefeatedEnemy[],
): readonly CoreError[] | null {
  let readonlyEntities: readonly ReadonlyEntityState[] | null = null;
  for (const [index, { module, content }] of features.entries()) {
    const system = module.systems[slot];
    if (!system) {
      continue;
    }
    const current = working.featureStates[index];
    if (current?.feature !== module.feature) {
      return [{ code: "stageSession.fatal", message: `Feature state not found: ${module.feature}` }];
    }
    readonlyEntities ??= Object.freeze(entities.map((entity) => toReadonlyEntityState(entity)));
    const misuse: CoreError[] = [];
    const tickContext: FeatureTickContext<unknown> = {
      ...base,
      content,
      tick: working.expectedTick,
      entities: readonlyEntities,
      allocateEntityIds: (count) => allocateEntityIds(working, count),
      emitEvent: (event) => {
        if (event.tick !== working.expectedTick) {
          misuse.push({ code: "stageSession.fatal", message: `${module.feature} feature emitted an event for tick ${event.tick}` });
          return;
        }
        working.eventLog.push(event);
      },
    };
    const advanced = slot === "scoring"
      ? (system as NonNullable<AnyFeatureModule["systems"]["scoring"]>)(current.state, {
        ...tickContext,
        defeatedEnemies,
        addScore: (delta) => {
          if (!Number.isSafeInteger(delta) || delta < 0 || !Number.isSafeInteger(working.score + delta)) {
            misuse.push({ code: "stageSession.fatal", message: `${module.feature} feature added an invalid score: ${delta}` });
            return working.score;
          }
          working.score += delta;
          return working.score;
        },
      })
      : (system as NonNullable<AnyFeatureModule["systems"]["spawn"]>)(current.state, tickContext);
    if (!advanced.ok) {
      return advanced.errors;
    }
    if (misuse.length > 0) {
      return misuse;
    }
    const state = freezeFeatureState(advanced.value);
    if (state === undefined) {
      return [{ code: "stageSession.fatal", message: `Feature state must be JSON-compatible plain data: ${module.feature}` }];
    }
    working.featureStates[index] = Object.freeze({ feature: module.feature, state });
  }
  return null;
}

/** frame を出す feature の state を `features` にまとめる。出す feature がなければ何も足さない。 */
export function projectFeatureFrameState(
  working: WorkingStageState,
  loadedFeatures: readonly LoadedFeature[],
  base: FeatureStageBase,
): Readonly<{ features?: ReadonlyFeatureFrameState }> {
  let features: ReadonlyFeatureFrameState | null = null;
  for (const [index, { module, content: featureContent }] of loadedFeatures.entries()) {
    const current = working.featureStates[index];
    if (module.projectFrameState && current?.feature === module.feature) {
      const frame = module.projectFrameState(current.state, {
        ...base,
        content: featureContent,
        tick: working.expectedTick,
      });
      features = { ...(features ?? {}), ...frame };
    }
  }
  return features === null ? {} : { features: deepFreezeClone(features) };
}

/** feature のために `count` 個の entity id を採番する。足りなければ何も採番しない。 */
function allocateEntityIds(working: WorkingStageState, count: number): CoreResult<readonly number[]> {
  const capacity = working.entityAllocator.canAllocate(count);
  if (!capacity.ok) {
    return capacity;
  }
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const entity = working.entityAllocator.create();
    if (!entity.ok) {
      return entity;
    }
    ids.push(entity.value.id);
  }
  return okResult(Object.freeze(ids));
}

/** collision resolution で撃破された enemy を、event の順に撃破された位置と一緒に集める。 */
export function collectDefeatedEnemies(
  events: readonly GameEvent[],
  entitiesBeforeCollision: readonly RuntimeEntityState[],
): readonly FeatureDefeatedEnemy[] {
  const defeated: FeatureDefeatedEnemy[] = [];
  for (const event of events) {
    if (event.type !== "entityDestroyed" || event.entityKind !== "enemy") {
      continue;
    }
    const enemy = entitiesBeforeCollision.find((entity) => entity.id === event.entityId);
    if (enemy?.kind === "enemy") {
      defeated.push(Object.freeze({ id: enemy.id, definitionId: enemy.definitionId, position: enemy.position }));
    }
  }
  return Object.freeze(defeated);
}
