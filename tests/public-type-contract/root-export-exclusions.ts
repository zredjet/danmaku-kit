// root package と deep subpath から内部 API を import できないことを型検査で固定する。

// @ts-expect-error 内部 replay/hash snapshot は root public contract に含めない。
import type { HashableGameState } from "@shooting-sample/shooting-core";

// @ts-expect-error headless debug dump は test-only で root public contract に含めない。
import type { HeadlessDebugStateDump } from "@shooting-sample/shooting-core";

// @ts-expect-error headless debug entity count は test-only で root public contract に含めない。
import type { HeadlessDebugEntityCounts } from "@shooting-sample/shooting-core";

// @ts-expect-error headless debug event count は test-only で root public contract に含めない。
import type { HeadlessDebugEventCounts } from "@shooting-sample/shooting-core";

// @ts-expect-error headless debug tick metrics は test-only で root public contract に含めない。
import type { HeadlessDebugTickMetrics } from "@shooting-sample/shooting-core";

// @ts-expect-error headless debug result は test-only で root public contract に含めない。
import type { HeadlessDebugStateResult } from "@shooting-sample/shooting-core";

// @ts-expect-error headless debug error は test-only で root public contract に含めない。
import type { HeadlessDebugStateError } from "@shooting-sample/shooting-core";

// @ts-expect-error headless debug serializer type は test-only で root public contract に含めない。
import type { HeadlessDebugStateSerializer } from "@shooting-sample/shooting-core";

// @ts-expect-error headless debug serializer register type は test-only で root public contract に含めない。
import type { RegisterHeadlessDebugStateSerializer } from "@shooting-sample/shooting-core";

// @ts-expect-error digest 計算前の headless debug checkpoint は root public contract に含めない。
import type { HeadlessDebugCheckpoint } from "@shooting-sample/shooting-core";

// @ts-expect-error headless debug serializer は test-only で root public contract に含めない。
import { serializeDebugStateForTest } from "@shooting-sample/shooting-core";

// @ts-expect-error debug artifact path helper は test-only で root public contract に含めない。
import { createHeadlessDebugStateArtifactPathForTest } from "@shooting-sample/shooting-core";

// @ts-expect-error debug artifact formatter は test-only で root public contract に含めない。
import { formatHeadlessDebugStateJsonForTest } from "@shooting-sample/shooting-core";

// @ts-expect-error test-only debug helper は deep package subpath からも公開しない。
import { serializeDebugStateForTest as DeepDebugSerializer } from "@shooting-sample/shooting-core/src/basic/testing/debug-state.ts";

// @ts-expect-error 内部 hash PRNG DTO は root public contract に含めない。
import type { HashablePrngState } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash vector DTO は root public contract に含めない。
import type { HashableVector2 } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash player movement DTO は root public contract に含めない。
import type { HashablePlayerMovement } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash player DTO は root public contract に含めない。
import type { HashablePlayerRuntimeEntityState } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash enemy DTO は root public contract に含めない。
import type { HashableEnemyRuntimeEntityState } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash enemy bullet DTO は root public contract に含めない。
import type { HashableEnemyBulletRuntimeEntityState } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash player shot DTO は root public contract に含めない。
import type { HashablePlayerShotRuntimeEntityState } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash runtime entity DTO は root public contract に含めない。
import type { HashableRuntimeEntityState } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash pending event DTO は root public contract に含めない。
import type { HashablePendingEvent } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash pattern runner DTO は root public contract に含めない。
import type { HashablePatternRunnerState } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash feature state DTO は root public contract に含めない。
import type { HashableEnabledFeatureState } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash JSON DTO は root public contract に含めない。
import type { HashableJsonValue } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash PRNG field order table は root public contract に含めない。
import { HASHABLE_PRNG_STATE_FIELD_ORDER } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash vector field order table は root public contract に含めない。
import { HASHABLE_VECTOR2_FIELD_ORDER } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash movement field order table は root public contract に含めない。
import { HASHABLE_PLAYER_MOVEMENT_FIELD_ORDER } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash field order table は root public contract に含めない。
import { HASHABLE_GAME_STATE_FIELD_ORDER } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash runtime entity order table は root public contract に含めない。
import { HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash pending event order table は root public contract に含めない。
import { HASHABLE_PENDING_EVENT_FIELD_ORDER } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash pattern runner order table は root public contract に含めない。
import { HASHABLE_PATTERN_RUNNER_STATE_FIELD_ORDER } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 hash feature state order table は root public contract に含めない。
import { HASHABLE_ENABLED_FEATURE_STATE_FIELD_ORDER } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 PRNG snapshot は root public contract に含めない。
import type { SerializedPrngState } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 feature order value は root public contract に含めない。
import { KNOWN_ENABLED_FEATURES } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 difficulty 一覧は root public contract に含めない。
import { KNOWN_DIFFICULTIES } from "@shooting-sample/shooting-core";

// @ts-expect-error 内部 difficulty guard は root public contract に含めない。
import { isKnownDifficulty } from "@shooting-sample/shooting-core";

// @ts-expect-error serialized runner id helper は root public contract に含めない。
import type { SerializedPatternRunnerId } from "@shooting-sample/shooting-core";

// @ts-expect-error test-only hook factory is not part of the root public contract.
import { createShootingCoreWithTestingHooksForTest } from "@shooting-sample/shooting-core";

// @ts-expect-error replay playback API is not part of the Phase 1B root public contract.
import { createReplayPlayback } from "@shooting-sample/shooting-core";

// @ts-expect-error replay playback session is not part of the Phase 1B root public contract.
import type { ReplayPlayback } from "@shooting-sample/shooting-core";

// @ts-expect-error runtime timing diagnostics are not replay metadata.
import type { RuntimeDroppedTicks } from "@shooting-sample/shooting-core";

// @ts-expect-error test-only core factory is not part of the root public contract.
import { createShootingCoreWithTestingHooks } from "@shooting-sample/shooting-core";

// @ts-expect-error internal test-only core factory is not part of the root public contract.
import { createShootingCoreWithTestingHooksForInternalTest } from "@shooting-sample/shooting-core";

// @ts-expect-error test-only hook options are not part of the root public contract.
import type { StageSessionTestingHooks } from "@shooting-sample/shooting-core";

// @ts-expect-error internal stage session hook options are not part of the root public contract.
import type { StageSessionTestingHookOptions } from "@shooting-sample/shooting-core";

// @ts-expect-error per-session hook consumption state is not part of the root public contract.
import type { ActiveStageSessionTestingHooks } from "@shooting-sample/shooting-core";

// @ts-expect-error internal runtime component is not part of the root public contract.
import type { EnemyRuntimeEntity } from "@shooting-sample/shooting-core";

// @ts-expect-error internal enemy bullet runtime component is not part of the root public contract.
import type { EnemyBulletRuntimeEntity } from "@shooting-sample/shooting-core";

// @ts-expect-error internal runtime state is not part of the root public contract.
import type { RuntimeEntityState } from "@shooting-sample/shooting-core";

// @ts-expect-error internal player shot system result is not part of the root public contract.
import type { PlayerShotSpawnResult } from "@shooting-sample/shooting-core";

// @ts-expect-error internal enemy bullet system result is not part of the root public contract.
import type { EnemyBulletSpawnResult } from "@shooting-sample/shooting-core";

// @ts-expect-error internal collision system result is not part of the root public contract.
import type { CollisionResolutionResult } from "@shooting-sample/shooting-core";

// @ts-expect-error internal enemy bullet system is not importable through a deep package subpath.
import type { EnemyBulletSpawnResult as DeepEnemyBulletSpawnResult } from "@shooting-sample/shooting-core/src/basic/simulation/enemy-bullet-system.ts";

// @ts-expect-error internal collision system is not importable through a deep package subpath.
import type { CollisionResolutionResult as DeepCollisionResolutionResult } from "@shooting-sample/shooting-core/src/basic/simulation/collision-system.ts";

// @ts-expect-error internal hash state module is not importable through a deep package subpath.
import type { HashableGameState as DeepHashableGameState } from "@shooting-sample/shooting-core/src/basic/hash/hashable-state.ts";

// @ts-expect-error internal serialization module is not importable through a deep package subpath.
import type { SerializedGameState as DeepSerializedGameState } from "@shooting-sample/shooting-core/src/basic/serialization/types.ts";

// @ts-expect-error internal validation module is not importable through a deep package subpath.
import type { validateGameDefinition as DeepValidateGameDefinition } from "@shooting-sample/shooting-core/src/basic/content/validation.ts";

// @ts-expect-error internal event module is not importable through a deep package subpath.
import type { EventLog as DeepEventLog } from "@shooting-sample/shooting-core/src/basic/events/game-event.ts";

// @ts-expect-error internal input module is not importable through a deep package subpath.
import type { GameplayActionId as DeepGameplayActionId } from "@shooting-sample/shooting-core/src/basic/input/input-frame.ts";

// @ts-expect-error internal runtime entity module is not importable through a deep package subpath.
import type { EnemyBulletRuntimeEntity as DeepEnemyBulletRuntimeEntity } from "@shooting-sample/shooting-core/src/basic/entities/enemy-bullet/model.ts";

// @ts-expect-error internal system order contract is not part of the root public contract.
import type { StageTickSystemStep } from "@shooting-sample/shooting-core";

// @ts-expect-error internal vector helper is not part of the root public contract.
import type { Vector2 } from "@shooting-sample/shooting-core";

// @ts-expect-error committed stage state は session 内部の transactional state で root public contract に含めない。
import type { CommittedStageState } from "@shooting-sample/shooting-core";

// @ts-expect-error tick pipeline の結果型は session 内部 API で root public contract に含めない。
import type { StageTickOutcome } from "@shooting-sample/shooting-core";

// @ts-expect-error loaded content index は session 内部 API で root public contract に含めない。
import type { LoadedContentIndex } from "@shooting-sample/shooting-core";

// @ts-expect-error restore 検証済み state は restore 内部 API で root public contract に含めない。
import type { RestoredStageState } from "@shooting-sample/shooting-core";

// @ts-expect-error stage session 生成は deep package subpath からも公開しない。
import { createStageSession as DeepCreateStageSession } from "@shooting-sample/shooting-core/src/basic/session/stage-session.ts";

// @ts-expect-error committed state は deep package subpath からも公開しない。
import type { CommittedStageState as DeepCommittedStageState } from "@shooting-sample/shooting-core/src/basic/state/committed-state.ts";

// @ts-expect-error restore 検証 orchestration は deep package subpath からも公開しない。
import { restoreStageState as DeepRestoreStageState } from "@shooting-sample/shooting-core/src/basic/serialization/restore/restore-stage-state.ts";

// @ts-expect-error replay divergence report は test-only で root public contract に含めない。
import type { ReplayDivergenceReport } from "@shooting-sample/shooting-core";

// @ts-expect-error replay trace recorder は test-only で root public contract に含めない。
import { recordReplayTraceForTest } from "@shooting-sample/shooting-core";

// @ts-expect-error replay trace comparator は test-only で root public contract に含めない。
import { compareReplayTracesForTest } from "@shooting-sample/shooting-core";

// @ts-expect-error replay trace comparator は deep package subpath からも公開しない。
import { compareReplayTracesForTest as DeepCompareReplayTraces } from "@shooting-sample/shooting-core/src/basic/testing/replay-divergence.ts";

void KNOWN_ENABLED_FEATURES;
void KNOWN_DIFFICULTIES;
void isKnownDifficulty;
void (undefined as unknown as HashableGameState);
void (undefined as unknown as HashablePrngState);
void (undefined as unknown as HashableVector2);
void (undefined as unknown as HashablePlayerMovement);
void (undefined as unknown as HashablePlayerRuntimeEntityState);
void (undefined as unknown as HashableEnemyRuntimeEntityState);
void (undefined as unknown as HashableEnemyBulletRuntimeEntityState);
void (undefined as unknown as HashablePlayerShotRuntimeEntityState);
void (undefined as unknown as HashableRuntimeEntityState);
void (undefined as unknown as HashablePendingEvent);
void (undefined as unknown as HashablePatternRunnerState);
void (undefined as unknown as HashableEnabledFeatureState);
void (undefined as unknown as HashableJsonValue);
void HASHABLE_PRNG_STATE_FIELD_ORDER;
void HASHABLE_VECTOR2_FIELD_ORDER;
void HASHABLE_PLAYER_MOVEMENT_FIELD_ORDER;
void HASHABLE_GAME_STATE_FIELD_ORDER;
void HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND;
void HASHABLE_PENDING_EVENT_FIELD_ORDER;
void HASHABLE_PATTERN_RUNNER_STATE_FIELD_ORDER;
void HASHABLE_ENABLED_FEATURE_STATE_FIELD_ORDER;
void (undefined as unknown as SerializedPrngState);
void (undefined as unknown as SerializedPatternRunnerId);
void (undefined as unknown as ReplayPlayback);
void (undefined as unknown as RuntimeDroppedTicks);
void (undefined as unknown as EnemyRuntimeEntity);
void (undefined as unknown as EnemyBulletRuntimeEntity);
void (undefined as unknown as RuntimeEntityState);
void (undefined as unknown as PlayerShotSpawnResult);
void (undefined as unknown as EnemyBulletSpawnResult);
void (undefined as unknown as CollisionResolutionResult);
void (undefined as unknown as DeepEnemyBulletSpawnResult);
void (undefined as unknown as DeepCollisionResolutionResult);
void (undefined as unknown as DeepHashableGameState);
void (undefined as unknown as DeepSerializedGameState);
void (undefined as unknown as DeepValidateGameDefinition);
void (undefined as unknown as DeepEventLog);
void (undefined as unknown as DeepGameplayActionId);
void (undefined as unknown as DeepEnemyBulletRuntimeEntity);
void (undefined as unknown as StageTickSystemStep);
void (undefined as unknown as Vector2);
void (undefined as unknown as CommittedStageState);
void (undefined as unknown as StageTickOutcome);
void (undefined as unknown as LoadedContentIndex);
void (undefined as unknown as RestoredStageState);
void DeepCreateStageSession;
void (undefined as unknown as DeepCommittedStageState);
void DeepRestoreStageState;
void (undefined as unknown as ReplayDivergenceReport);
void recordReplayTraceForTest;
void compareReplayTracesForTest;
void DeepCompareReplayTraces;
