// createShootingCore / load / startStage / restore / tick / serialize の呼び出し形と CoreErrorCode を固定する。

import { createShootingCore } from "@shooting-sample/shooting-core";
import type {
  CoreError,
  CoreErrorCode,
  CoreResult,
  CoreWarning,
  InputFrame,
  LoadedGame,
  SerializedGameState,
  ShootingCore,
  StageSession,
  StartStageOptions,
} from "@shooting-sample/shooting-core";
import { definition } from "./content-definitions.ts";
import { serializedInitialGameState } from "./serialized-state.ts";

const core: ShootingCore = createShootingCore("type-contract");

const input: InputFrame = {
  tick: 0,
  axes: { moveX: 0, moveY: 0 },
  held: [],
  pressed: [],
  released: [],
};
const loaded = core.load(definition);
const loadedAsResult: CoreResult<unknown> = loaded;
const contextualCoreError: CoreError = {
  code: "enemy.notFound",
  message: "Enemy not found: enemy.missing",
  schemaPath: "content.stages[0].timeline[0].action.enemy",
  referrerId: "stage.stage_01",
  targetId: "enemy.missing",
};
// load の warning は error と同じく content の位置を持てる（pattern の意味の検証など）。
const contextualCoreWarning: CoreWarning = {
  code: "pattern.unreachableStep",
  message: "pattern.steps[4] is never executed from the spawn",
  schemaPath: "content.patterns[1].steps[4]",
  referrerId: "pattern.scout_three_way",
};
const errorCode: CoreErrorCode = "input.invalidShape";
const bulletErrorCode: CoreErrorCode = "bullet.notFound";
const enemyBulletBudgetErrorCode: CoreErrorCode = "enemyBullet.budgetExceeded";
const patternBudgetErrorCode: CoreErrorCode = "pattern.budgetExceeded";
const invalidConstraintErrorCode: CoreErrorCode = "definition.invalidConstraint";
const playerShotErrorCode: CoreErrorCode = "playerShot.notFound";
const fatalStageSessionErrorCode: CoreErrorCode = "stageSession.fatal";
const endedStageSessionErrorCode: CoreErrorCode = "stageSession.ended";
const testHookFailureErrorCode: CoreErrorCode = "testHook.failure";
const restoreInvalidShapeErrorCode: CoreErrorCode = "state.invalidShape";
const restoreCoreVersionMismatchErrorCode: CoreErrorCode = "state.coreVersionMismatch";
const restoreSchemaVersionMismatchErrorCode: CoreErrorCode = "state.schemaVersionMismatch";
const restoreInputFormatVersionMismatchErrorCode: CoreErrorCode = "state.inputFormatVersionMismatch";
const restoreStateHashVersionMismatchErrorCode: CoreErrorCode = "state.stateHashVersionMismatch";
const restoreContentMismatchErrorCode: CoreErrorCode = "state.contentMismatch";
const restoreFeatureMismatchErrorCode: CoreErrorCode = "state.featureMismatch";
const restorePrngInvalidErrorCode: CoreErrorCode = "state.prngInvalid";
const restoreRegistryInvalidErrorCode: CoreErrorCode = "state.registryInvalid";

const startOptions: StartStageOptions = {
  stageId: "stage.stage_01",
  difficulty: "normal",
  seed: "seed-1",
};

if (loaded.ok) {
  const publicLoadedGame: LoadedGame = loaded.value;
  const restoredFromPublicLoaded: CoreResult<StageSession> = publicLoadedGame.restore(serializedInitialGameState);
  void restoredFromPublicLoaded;

  const restoredFromSerialized: CoreResult<StageSession> = loaded.value.restore(serializedInitialGameState);
  if (restoredFromSerialized.ok) {
    const serializedAfterRestore: CoreResult<SerializedGameState> = restoredFromSerialized.value.serialize();
    void serializedAfterRestore;
  }

  const started = loaded.value.startStage(startOptions);
  if (started.ok) {
    started.value.tick(input);
    const publicStageSession: StageSession = started.value;
    const serializedFromSession: CoreResult<SerializedGameState> = publicStageSession.serialize();
    const serializedFromInferredSession: CoreResult<SerializedGameState> = started.value.serialize();
    void serializedFromSession;
    void serializedFromInferredSession;
  }
}

// @ts-expect-error load requires a GameDefinition at the public type boundary.
core.load(null);

if (loaded.ok) {
  // @ts-expect-error startStage requires StartStageOptions at the public type boundary.
  loaded.value.startStage(null);
  // @ts-expect-error restore requires SerializedGameState at the public type boundary.
  loaded.value.restore(null);
}

// @ts-expect-error stageId must use the stage.* namespace.
const invalidStartOptions: StartStageOptions = { stageId: "enemy.scout", difficulty: "normal", seed: "seed-1" };

// @ts-expect-error entity.notFound is an internal invariant, not a public CoreErrorCode.
const invalidCoreErrorCode: CoreErrorCode = "entity.notFound";

// @ts-expect-error debugState.hashFailed は内部test helperの結果型に限定する。
const invalidDebugStateHashErrorCode: CoreErrorCode = "debugState.hashFailed";

// @ts-expect-error entityAllocator restore failures are normalized before becoming public restore errors.
const invalidEntityAllocatorRestoreErrorCode: CoreErrorCode = "state.entityAllocatorInvalid";

if (loaded.ok) {
  const maybeStarted = loaded.value.startStage(startOptions);
  if (maybeStarted.ok) {
    // @ts-expect-error tick requires an InputFrame at the public type boundary.
    maybeStarted.value.tick({ tick: 0 });
    // @ts-expect-error serialize は引数を受け取らない。
    maybeStarted.value.serialize(input);
  }
}

void input;
void loaded;
void loadedAsResult;
void errorCode;
void bulletErrorCode;
void enemyBulletBudgetErrorCode;
void patternBudgetErrorCode;
void invalidConstraintErrorCode;
void playerShotErrorCode;
void fatalStageSessionErrorCode;
void endedStageSessionErrorCode;
void testHookFailureErrorCode;
void restoreInvalidShapeErrorCode;
void restoreCoreVersionMismatchErrorCode;
void restoreSchemaVersionMismatchErrorCode;
void restoreInputFormatVersionMismatchErrorCode;
void restoreStateHashVersionMismatchErrorCode;
void restoreContentMismatchErrorCode;
void restoreFeatureMismatchErrorCode;
void invalidStartOptions;
void invalidCoreErrorCode;
void invalidDebugStateHashErrorCode;
void contextualCoreError;
void contextualCoreWarning;
void invalidEntityAllocatorRestoreErrorCode;
void restorePrngInvalidErrorCode;
void restoreRegistryInvalidErrorCode;
