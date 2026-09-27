// root package と deep subpath から内部 API を import できないことを型検査で固定する。

// @ts-expect-error 内部 replay/hash snapshot は root public contract に含めない。
import type { HashableGameState } from "@danmaku-kit/core";

// @ts-expect-error headless debug dump は test-only で root public contract に含めない。
import type { HeadlessDebugStateDump } from "@danmaku-kit/core";

// @ts-expect-error headless debug entity count は test-only で root public contract に含めない。
import type { HeadlessDebugEntityCounts } from "@danmaku-kit/core";

// @ts-expect-error headless debug event count は test-only で root public contract に含めない。
import type { HeadlessDebugEventCounts } from "@danmaku-kit/core";

// @ts-expect-error headless debug tick metrics は test-only で root public contract に含めない。
import type { HeadlessDebugTickMetrics } from "@danmaku-kit/core";

// @ts-expect-error headless debug result は test-only で root public contract に含めない。
import type { HeadlessDebugStateResult } from "@danmaku-kit/core";

// @ts-expect-error headless debug error は test-only で root public contract に含めない。
import type { HeadlessDebugStateError } from "@danmaku-kit/core";

// @ts-expect-error headless debug serializer type は test-only で root public contract に含めない。
import type { HeadlessDebugStateSerializer } from "@danmaku-kit/core";

// @ts-expect-error headless debug serializer register type は test-only で root public contract に含めない。
import type { RegisterHeadlessDebugStateSerializer } from "@danmaku-kit/core";

// @ts-expect-error digest 計算前の headless debug checkpoint は root public contract に含めない。
import type { HeadlessDebugCheckpoint } from "@danmaku-kit/core";

// @ts-expect-error headless debug serializer は test-only で root public contract に含めない。
import { serializeDebugStateForTest } from "@danmaku-kit/core";

// @ts-expect-error debug artifact path helper は test-only で root public contract に含めない。
import { createHeadlessDebugStateArtifactPathForTest } from "@danmaku-kit/core";

// @ts-expect-error debug artifact formatter は test-only で root public contract に含めない。
import { formatHeadlessDebugStateJsonForTest } from "@danmaku-kit/core";

// @ts-expect-error test-only debug helper は deep package subpath からも公開しない。
import { serializeDebugStateForTest as DeepDebugSerializer } from "@danmaku-kit/core/src/basic/testing/debug-state.ts";

// @ts-expect-error 内部 hash PRNG DTO は root public contract に含めない。
import type { HashablePrngState } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash vector DTO は root public contract に含めない。
import type { HashableVector2 } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash player movement DTO は root public contract に含めない。
import type { HashablePlayerMovement } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash player DTO は root public contract に含めない。
import type { HashablePlayerRuntimeEntityState } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash enemy DTO は root public contract に含めない。
import type { HashableEnemyRuntimeEntityState } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash enemy bullet DTO は root public contract に含めない。
import type { HashableEnemyBulletRuntimeEntityState } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash player shot DTO は root public contract に含めない。
import type { HashablePlayerShotRuntimeEntityState } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash runtime entity DTO は root public contract に含めない。
import type { HashableRuntimeEntityState } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash pending event DTO は root public contract に含めない。
import type { HashablePendingEvent } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash pattern runner DTO は root public contract に含めない。
import type { HashablePatternRunnerState } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash feature state DTO は root public contract に含めない。
import type { HashableEnabledFeatureState } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash JSON DTO は root public contract に含めない。
import type { HashableJsonValue } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash PRNG field order table は root public contract に含めない。
import { HASHABLE_PRNG_STATE_FIELD_ORDER } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash vector field order table は root public contract に含めない。
import { HASHABLE_VECTOR2_FIELD_ORDER } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash movement field order table は root public contract に含めない。
import { HASHABLE_PLAYER_MOVEMENT_FIELD_ORDER } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash field order table は root public contract に含めない。
import { HASHABLE_GAME_STATE_FIELD_ORDER } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash runtime entity order table は root public contract に含めない。
import { HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash pending event order table は root public contract に含めない。
import { HASHABLE_PENDING_EVENT_FIELD_ORDER } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash pattern runner order table は root public contract に含めない。
import { HASHABLE_PATTERN_RUNNER_STATE_FIELD_ORDER } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash feature state order table は root public contract に含めない。
import { HASHABLE_ENABLED_FEATURE_STATE_FIELD_ORDER } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash player runtime entity field order は root public contract に含めない。
import { HASHABLE_PLAYER_RUNTIME_ENTITY_FIELD_ORDER } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash enemy runtime entity field order は root public contract に含めない。
import { HASHABLE_ENEMY_RUNTIME_ENTITY_FIELD_ORDER } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash enemy bullet runtime entity field order は root public contract に含めない。
import { HASHABLE_ENEMY_BULLET_RUNTIME_ENTITY_FIELD_ORDER } from "@danmaku-kit/core";

// @ts-expect-error 内部 hash player shot runtime entity field order は root public contract に含めない。
import { HASHABLE_PLAYER_SHOT_RUNTIME_ENTITY_FIELD_ORDER } from "@danmaku-kit/core";

// @ts-expect-error 内部 PRNG snapshot は root public contract に含めない。
import type { SerializedPrngState } from "@danmaku-kit/core";

// @ts-expect-error 内部 feature order value は root public contract に含めない。
import { KNOWN_ENABLED_FEATURES } from "@danmaku-kit/core";

// @ts-expect-error 内部 difficulty 一覧は root public contract に含めない。
import { KNOWN_DIFFICULTIES } from "@danmaku-kit/core";

// @ts-expect-error 内部 difficulty guard は root public contract に含めない。
import { isKnownDifficulty } from "@danmaku-kit/core";

// @ts-expect-error serialized runner id helper は root public contract に含めない。
import type { SerializedPatternRunnerId } from "@danmaku-kit/core";

// @ts-expect-error serialized runtime entity の共通部分は root public contract に含めない。
import type { SerializedRuntimeEntityBase } from "@danmaku-kit/core";

// @ts-expect-error serialized vector2 helper は root public contract に含めない。
import type { SerializedVector2 } from "@danmaku-kit/core";

// @ts-expect-error kind 別 serialized DTO は union だけを root public contract に含める。
import type { SerializedPlayerRuntimeEntityState } from "@danmaku-kit/core";

// @ts-expect-error kind 別 serialized DTO は union だけを root public contract に含める。
import type { SerializedEnemyRuntimeEntityState } from "@danmaku-kit/core";

// @ts-expect-error kind 別 serialized DTO は union だけを root public contract に含める。
import type { SerializedEnemyBulletRuntimeEntityState } from "@danmaku-kit/core";

// @ts-expect-error kind 別 serialized DTO は union だけを root public contract に含める。
import type { SerializedPlayerShotRuntimeEntityState } from "@danmaku-kit/core";

// @ts-expect-error test-only hook factory is not part of the root public contract.
import { createDanmakuCoreWithTestingHooksForTest } from "@danmaku-kit/core";

// @ts-expect-error replay playback API is not part of the Phase 1B root public contract.
import { createReplayPlayback } from "@danmaku-kit/core";

// @ts-expect-error replay playback session is not part of the Phase 1B root public contract.
import type { ReplayPlayback } from "@danmaku-kit/core";

// @ts-expect-error runtime timing diagnostics are not replay metadata.
import type { RuntimeDroppedTicks } from "@danmaku-kit/core";

// @ts-expect-error test-only core factory is not part of the root public contract.
import { createDanmakuCoreWithTestingHooks } from "@danmaku-kit/core";

// @ts-expect-error internal test-only core factory is not part of the root public contract.
import { createDanmakuCoreWithTestingHooksForInternalTest } from "@danmaku-kit/core";

// @ts-expect-error test-only hook options are not part of the root public contract.
import type { StageSessionTestingHooks } from "@danmaku-kit/core";

// @ts-expect-error internal stage session hook options are not part of the root public contract.
import type { StageSessionTestingHookOptions } from "@danmaku-kit/core";

// @ts-expect-error per-session hook consumption state is not part of the root public contract.
import type { ActiveStageSessionTestingHooks } from "@danmaku-kit/core";

// @ts-expect-error internal runtime component is not part of the root public contract.
import type { EnemyRuntimeEntity } from "@danmaku-kit/core";

// @ts-expect-error internal enemy bullet runtime component is not part of the root public contract.
import type { EnemyBulletRuntimeEntity } from "@danmaku-kit/core";

// @ts-expect-error internal runtime state is not part of the root public contract.
import type { RuntimeEntityState } from "@danmaku-kit/core";

// @ts-expect-error internal runtime entity kind list is not part of the root public contract.
import { RUNTIME_ENTITY_KINDS } from "@danmaku-kit/core";

// @ts-expect-error internal runtime entity kind union is not part of the root public contract.
import type { RuntimeEntityKind } from "@danmaku-kit/core";

// @ts-expect-error internal player shot system result is not part of the root public contract.
import type { PlayerShotSpawnResult } from "@danmaku-kit/core";

// @ts-expect-error internal enemy bullet system result is not part of the root public contract.
import type { EnemyBulletSpawnResult } from "@danmaku-kit/core";

// @ts-expect-error internal collision system result is not part of the root public contract.
import type { CollisionResolutionResult } from "@danmaku-kit/core";

// @ts-expect-error internal enemy bullet system is not importable through a deep package subpath.
import type { EnemyBulletSpawnResult as DeepEnemyBulletSpawnResult } from "@danmaku-kit/core/src/basic/simulation/enemy-bullet-system.ts";

// @ts-expect-error internal collision system is not importable through a deep package subpath.
import type { CollisionResolutionResult as DeepCollisionResolutionResult } from "@danmaku-kit/core/src/basic/simulation/collision-system.ts";

// @ts-expect-error internal hash state module is not importable through a deep package subpath.
import type { HashableGameState as DeepHashableGameState } from "@danmaku-kit/core/src/basic/hash/hashable-state.ts";

// @ts-expect-error internal serialization module is not importable through a deep package subpath.
import type { SerializedGameState as DeepSerializedGameState } from "@danmaku-kit/core/src/basic/serialization/types.ts";

// @ts-expect-error internal validation module is not importable through a deep package subpath.
import type { validateGameDefinition as DeepValidateGameDefinition } from "@danmaku-kit/core/src/basic/content/validation.ts";

// @ts-expect-error internal event module is not importable through a deep package subpath.
import type { EventLog as DeepEventLog } from "@danmaku-kit/core/src/basic/events/game-event.ts";

// @ts-expect-error internal input module is not importable through a deep package subpath.
import type { GameplayActionId as DeepGameplayActionId } from "@danmaku-kit/core/src/basic/input/input-frame.ts";

// @ts-expect-error internal runtime entity module is not importable through a deep package subpath.
import type { EnemyBulletRuntimeEntity as DeepEnemyBulletRuntimeEntity } from "@danmaku-kit/core/src/basic/entities/enemy-bullet/model.ts";

// @ts-expect-error feature modules define themselves through the internal extension layer, not the root export.
import { defineFeature } from "@danmaku-kit/core";

// @ts-expect-error the feature module interface is internal to the Core and its feature packages.
import type { FeatureModule } from "@danmaku-kit/core";

// @ts-expect-error the internal extension layer is not importable through a deep package subpath.
import { defineFeature as DeepDefineFeature } from "@danmaku-kit/core/src/basic/extension/feature-module.ts";

// @ts-expect-error internal system order contract is not part of the root public contract.
import type { StageTickSystemStep } from "@danmaku-kit/core";

// @ts-expect-error internal vector helper is not part of the root public contract.
import type { Vector2 } from "@danmaku-kit/core";

// @ts-expect-error committed stage state は session 内部の transactional state で root public contract に含めない。
import type { CommittedStageState } from "@danmaku-kit/core";

// @ts-expect-error tick pipeline の結果型は session 内部 API で root public contract に含めない。
import type { StageTickOutcome } from "@danmaku-kit/core";

// @ts-expect-error loaded content index は session 内部 API で root public contract に含めない。
import type { LoadedContentIndex } from "@danmaku-kit/core";

// @ts-expect-error restore 検証済み state は restore 内部 API で root public contract に含めない。
import type { RestoredStageState } from "@danmaku-kit/core";

// @ts-expect-error stage session 生成は deep package subpath からも公開しない。
import { createStageSession as DeepCreateStageSession } from "@danmaku-kit/core/src/basic/session/stage-session.ts";

// @ts-expect-error committed state は deep package subpath からも公開しない。
import type { CommittedStageState as DeepCommittedStageState } from "@danmaku-kit/core/src/basic/state/committed-state.ts";

// @ts-expect-error restore 検証 orchestration は deep package subpath からも公開しない。
import { restoreStageState as DeepRestoreStageState } from "@danmaku-kit/core/src/basic/serialization/restore/restore-stage-state.ts";

// @ts-expect-error replay divergence report は test-only で root public contract に含めない。
import type { ReplayDivergenceReport } from "@danmaku-kit/core";

// @ts-expect-error replay trace recorder は test-only で root public contract に含めない。
import { recordReplayTraceForTest } from "@danmaku-kit/core";

// @ts-expect-error replay trace comparator は test-only で root public contract に含めない。
import { compareReplayTracesForTest } from "@danmaku-kit/core";

// @ts-expect-error replay trace comparator は deep package subpath からも公開しない。
import { compareReplayTracesForTest as DeepCompareReplayTraces } from "@danmaku-kit/core/src/basic/testing/replay-divergence.ts";

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
void HASHABLE_PLAYER_RUNTIME_ENTITY_FIELD_ORDER;
void HASHABLE_ENEMY_RUNTIME_ENTITY_FIELD_ORDER;
void HASHABLE_ENEMY_BULLET_RUNTIME_ENTITY_FIELD_ORDER;
void HASHABLE_PLAYER_SHOT_RUNTIME_ENTITY_FIELD_ORDER;
void (undefined as unknown as SerializedPrngState);
void (undefined as unknown as SerializedPatternRunnerId);
void (undefined as unknown as SerializedRuntimeEntityBase);
void (undefined as unknown as SerializedVector2);
void (undefined as unknown as SerializedPlayerRuntimeEntityState);
void (undefined as unknown as SerializedEnemyRuntimeEntityState);
void (undefined as unknown as SerializedEnemyBulletRuntimeEntityState);
void (undefined as unknown as SerializedPlayerShotRuntimeEntityState);
void RUNTIME_ENTITY_KINDS;
void (undefined as unknown as RuntimeEntityKind);
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
void defineFeature;
void (undefined as unknown as FeatureModule<null>);
void DeepDefineFeature;
