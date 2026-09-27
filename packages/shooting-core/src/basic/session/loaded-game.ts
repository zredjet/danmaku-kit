import type { LoadedGame, StageSession } from "../api-types.ts";
import { patternProgramsForDifficulty } from "../content/content-index.ts";
import type { LoadedContentIndex } from "../content/content-index.ts";
import type { PlayerDefinition, StageDefinition } from "../content/types.ts";
import { deepFreezePlainData } from "../shared/immutable.ts";
import { createActiveStageSessionTestingHooks } from "../instrumentation/stage-session-testing-hooks.ts";
import type { StageSessionTestingHookOptions } from "../instrumentation/stage-session-testing-hooks.ts";
import { coreError, okResult } from "../result.ts";
import {
  SERIALIZED_INPUT_FORMAT_VERSION,
  SERIALIZED_STATE_HASH_VERSION,
  canonicalizeEnabledFeatures,
} from "../serialization/metadata.ts";
import { restoreStageState } from "../serialization/restore/restore-stage-state.ts";
import { EntityAllocator } from "../simulation/entity.ts";
import { XorShift32 } from "../simulation/prng.ts";
import { createPlayerRuntimeEntity } from "../entities/player/model.ts";
import { createCommittedStageState } from "../state/committed-state.ts";
import { parseStartStageOptions } from "./start-stage-options.ts";
import { createStageSession } from "./stage-session.ts";
import type { StageSessionContext } from "./stage-session.ts";

/**
 * 検証済み snapshot から `LoadedGame` を作る。
 *
 * この関数へ渡る `definition` は `load()` 済みで freeze されている前提。
 * そのため startStage ごとに再 validation せず、ID 解決と session 初期化だけを行う。
 */
export function createLoadedGame(
  content: LoadedContentIndex,
  coreVersion: string,
  testingHooks: StageSessionTestingHookOptions,
): LoadedGame {
  return Object.freeze({
    restore(rawState) {
      const restoredState = restoreStageState(rawState, content, coreVersion);
      if (!restoredState.ok) {
        return restoredState;
      }
      testingHooks.recordRestoreSerializedSnapshot?.(restoredState.value.serializedSnapshot);

      const stage = content.stagesById.get(restoredState.value.serializationMetadata.stageId);
      const player = content.playersById.get(restoredState.value.serializationMetadata.playerId);
      if (!stage || !player) {
        return coreError("state.contentMismatch", "serialized content metadata does not match the loaded content");
      }

      return okResult(createStageSessionFromContent(content, stage, player, testingHooks, {
        debugSeed: null,
        initialState: restoredState.value.committedState,
        serializationMetadata: restoredState.value.serializationMetadata,
      }));
    },
    startStage(rawOptions) {
      const plainOptions = deepFreezePlainData(rawOptions);
      if (!plainOptions) {
        return coreError("startStage.invalidShape", "StartStageOptions must be JSON-compatible plain data");
      }
      const options = parseStartStageOptions(plainOptions);
      if (!options.ok) {
        return options;
      }
      // startStage の入力は runtime 側から来るため、stage/player/difficulty は毎回確認する。
      const stage = content.stagesById.get(options.value.stageId);
      const playerId = options.value.playerId ?? content.definition.defaultPlayerId;
      const player = content.playersById.get(playerId);

      if (!stage) {
        return coreError("stage.notFound", `Stage not found: ${options.value.stageId}`);
      }
      if (!player) {
        return coreError("player.notFound", `Player not found: ${playerId}`);
      }
      if (!stage.difficulties.includes(options.value.difficulty)) {
        return coreError("difficulty.notSupported", `Difficulty not supported: ${options.value.difficulty}`);
      }

      const entityAllocator = new EntityAllocator();
      const playerEntity = createPlayerRuntimeEntity(entityAllocator, player);
      if (!playerEntity.ok) {
        return playerEntity;
      }

      // stageStarted は最初の GameFrame で renderer/debug が初期状態を同期するための event。
      const initialState = createCommittedStageState({
        activeEntities: [playerEntity.value],
        patternRunners: [],
        expectedTick: 0,
        nextEntityId: entityAllocator.snapshot(),
        pendingEvents: [{ type: "stageStarted", tick: 0, stageId: stage.id }],
        prngState: new XorShift32(options.value.seed).snapshot(),
        score: 0,
        timelineCursor: 0,
        stageStatus: "playing",
      });
      return okResult(createStageSessionFromContent(content, stage, player, testingHooks, {
        debugSeed: options.value.seed,
        initialState,
        serializationMetadata: {
          coreVersion,
          schemaVersion: content.definition.schemaVersion,
          contentVersion: content.definition.content.version,
          inputFormatVersion: SERIALIZED_INPUT_FORMAT_VERSION,
          stateHashVersion: SERIALIZED_STATE_HASH_VERSION,
          enabledFeatures: canonicalizeEnabledFeatures(content.definition.enabledFeatures),
          stageId: stage.id,
          difficulty: options.value.difficulty,
          playerId,
        },
      }));
    },
  });
}

/**
 * load 済み content と session ごとの初期値から stage session を作る。
 *
 * testing hook の消費状態は session ごとに新しく作り、同じ `LoadedGame` から作った別 session へ持ち越さない。
 */
function createStageSessionFromContent(
  content: LoadedContentIndex,
  stage: StageDefinition,
  player: PlayerDefinition,
  testingHooks: StageSessionTestingHookOptions,
  initial: Pick<StageSessionContext, "debugSeed" | "initialState" | "serializationMetadata">,
): StageSession {
  return createStageSession({
    content: {
      bulletsById: content.bulletsById,
      enemiesById: content.enemiesById,
      pathsById: content.pathsById,
      patternsById: content.patternsById,
      patternProgramsById: patternProgramsForDifficulty(content, initial.serializationMetadata.difficulty),
      playerShotsById: content.playerShotsById,
      stage,
      player,
    },
    debugSeed: initial.debugSeed,
    initialState: initial.initialState,
    serializationMetadata: initial.serializationMetadata,
    testingHooks: createActiveStageSessionTestingHooks(testingHooks),
  });
}
