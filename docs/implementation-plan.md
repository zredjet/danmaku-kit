# Implementation Plan

この文書は `docs/design.md` を実装タスクへ接続するための作業計画です。設計書は判断の正本、この文書は実装順序と完了条件の入口として扱います。

## 現在の実装スライス

Phase 1A の renderer 非依存 Core minimum contract、Phase 1B-1 の committed / working state boundary、Phase 1B-2 の fatal latch minimum は完了済みである。現在の実装スライスは Phase 1B-3 の serialized DTO contract に限定する。Phase 1B-4 以降の serialize / restore / state hash / replay metadata は後続スライスとして順に扱う。

Done:

- root npm workspace を用意する
- `packages/shooting-core` を TypeScript package として作る
- Core basic の public API を置く
- public API 境界で `load()` / `startStage()` / `tick()` の runtime guard を入れる
- 最小 `GameDefinition` / `ContentRegistry` 型を置く
- `enabledFeatures: []` の basic core validation を入れる
- schema version と数値 domain constraint を検証する
- Player minimum schema に movement、collision、life、shot reference を入れる
- Stage minimum schema に spawn enemy timeline と enemy/path/pattern reference を入れる
- registry の最小 validation を実装する
- `load()` 成功時に validated content snapshot を保持する
- `InputFrame`、deep immutable event log、PRNG、entity id allocator を置く
- tick 成功時のみ PRNG、entity allocator、active entities、timeline cursor、pending event、expected tick を更新する最小 commit 境界を作る
- `CoreResult` / `CoreError` / `CoreErrorCode` を `result.ts` に分離し、下位モジュールが `core.ts` に依存しない形へ寄せる
- package export 経由の minimum gameplay flow test を追加する
- `tsc --noEmit` による public type contract 検査を追加する
- `InputFrame` action の重複禁止、pressed/released の同 tick tap 許可、canonical order 化を追加する
- content validation で未知 feature、空 asset key、重複 asset key、空 difficulty、重複 difficulty を拒否する
- public API 入力を JSON 互換の plain data に正規化し、getter / Proxy / 継承 property 由来の例外を `CoreResult` に閉じ込める
- Core 本体は DOM 型を含めず、テスト TypeScript は `tsconfig.test.json` で別途型検査する
- renderer なしの `node:test` で load / startStage / tick / empty tick deterministic smoke / package boundary を検証する
- Stage timeline の `spawnEnemy` から deterministic な enemy entity と `entitySpawned` event を生成する
- Player / Enemy / EnemyBullet / PlayerShot の runtime entity component 型を定義する
- stage start 時に player runtime entity を生成し、公開 `GameFrame.state.entities` に投影する
- Enemy runtime entity に path / pattern / hp / scoreOnKill を保持し、後続 system が参照できるようにする
- Enemy / EnemyBullet / PlayerShot の collision radius を content schema から runtime entity へ流す
- PlayerShot 入力から deterministic な PlayerShot entity と `playerShotsSpawnedBatch` event を生成する
- tick 内 system order と entity id 昇順 tie-breaker を内部契約として固定する
- PlayerShotDefinition に最小 projectile velocity / lifetime schema と validation を追加する
- content 定義に基づく player shot movement / lifetime / cleanup を入れる
- player input axes と focus held に基づく自機 movement / playfield clamp を入れる
- PlayerShotDefinition の `fire.intervalTicks` に基づく held 連射を有効化する
- PatternDefinition の `fireOnSpawn` から deterministic な EnemyBullet entity と `enemyBulletsSpawnedBatch` event を生成する
- player shot と enemy、enemy bullet と player、player と enemy contact の最小 collision を入れる
- enemy HP、player shot damage、enemy defeated、fixed `scoreOnKill` を event と state に接続する
- collision / score を含む deterministic smoke test を追加する
- `CommittedStageState` / `WorkingStageState` を導入し、session 内の状態変数を committed snapshot に集約する
- committed state から `EntityAllocator` / `XorShift32` の mutable handle を外し、`nextEntityId` / `prngState` snapshot から working state を復元する
- working state mutation 後 failure の rollback regression test を追加する
- rollback regression test で baseline との一致、entity id 昇順、event / collision tie-break order の復帰を確認する
- fatal latch minimum を追加する
- committed snapshot restore 不整合と tick 内 runtime invariant failure を `stageSession.fatal` に畳む
- fatal 後の `tick()` が同じ fatal reason を返し、committed state を進めないことを test する
- fatal 系 `CoreErrorCode` と precondition error の境界を固定する
- test-only hook は session-scoped factory として root package export へ出さず、通常 runtime の global state へ影響させない

Next:

- serialized DTO contract を追加する
- public snapshot 型と internal runtime state 型を分離する
- `SerializedPrngSnapshot` / `SerializedRuntimeEntityState` の root export 境界を固定する
- `tests/public-type-contract.ts` で serialized DTO の positive / negative contract を固定する

このスライスでは Phaser、Vite、DOM、asset loader、YAML parser、serialize、restore、state hash、replay metadata、replay playback UI は扱わない。

## 設計から実装への対応表

Status legend:

- Done: 実装済みで、対象 test / typecheck が通っている。
- Next: 現在の実装スライスで扱う。
- Queued: 同じ Phase 内の後続スライスで扱う。表では `Queued: Phase 1B-2` のように対象 slice id を併記する。
- Later: 現在 Phase の外へ送る。

| Design section | Task | Status | Implementation | Tests | Command |
| --- | --- | --- | --- | --- | --- |
| `docs/design.md` Core package / API | Core basic の公開 API と package export 境界 | Done | `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/index.ts` | `tests/package-boundary.test.mjs`, `tests/public-type-contract.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Content schema minimum | 最小 `GameDefinition` と registry validation | Done | `packages/shooting-core/src/basic/content/types.ts`, `packages/shooting-core/src/basic/content/validation.ts` | `packages/shooting-core/src/basic/core.test.ts` | `npm test` |
| `docs/design.md` Input / fixed tick | `InputFrame` と tick precondition | Done | `packages/shooting-core/src/basic/input/input-frame.ts`, `packages/shooting-core/src/basic/core.ts` | `packages/shooting-core/src/basic/core.test.ts` | `npm test` |
| `docs/design.md` Determinism foundation | PRNG、entity id allocator、timeline spawn cursor | Done | `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/simulation/prng.ts`, `packages/shooting-core/src/basic/simulation/entity.ts` | `packages/shooting-core/src/basic/core.test.ts`, `packages/shooting-core/src/basic/simulation/*.test.ts` | `npm test` |
| `docs/design.md` 7.1 system order | tick system order と entity id tie-breaker の明示 | Done | `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/simulation/system-order.ts` | `packages/shooting-core/src/basic/simulation/system-order.test.ts`, `packages/shooting-core/src/basic/core.test.ts` | `npm test` |
| `docs/design.md` PlayerShot definition | PlayerShot projectile / lifetime と cleanup | Done | `packages/shooting-core/src/basic/content/types.ts`, `packages/shooting-core/src/basic/content/validation.ts`, `packages/shooting-core/src/basic/simulation/player-shot-lifecycle-system.ts` | `packages/shooting-core/src/basic/core.test.ts`, `packages/shooting-core/src/basic/simulation/player-shot-lifecycle-system.test.ts` | `npm test` |
| `docs/design.md` PlayerShot fire interval | `fire.intervalTicks` と held 連射 cooldown | Done | `packages/shooting-core/src/basic/content/types.ts`, `packages/shooting-core/src/basic/content/validation.ts`, `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/simulation/player-shot-system.ts`, `packages/shooting-core/src/basic/simulation/runtime-entity.ts` | `packages/shooting-core/src/basic/core.test.ts`, `packages/shooting-core/src/basic/simulation/player-shot-system.test.ts`, `packages/shooting-core/src/basic/simulation/runtime-entity.test.ts`, `tests/public-type-contract.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Player movement | player input axes / focus movement / playfield clamp | Done | `packages/shooting-core/src/basic/simulation/player-movement-system.ts`, `packages/shooting-core/src/basic/core.ts` | `packages/shooting-core/src/basic/simulation/player-movement-system.test.ts`, `packages/shooting-core/src/basic/core.test.ts` | `npm test` |
| `docs/design.md` Enemy bullet fireOnSpawn | PatternDefinition の最小敵弾生成経路、複数 enemy と player shot の同 tick order 固定 | Done | `packages/shooting-core/src/basic/content/types.ts`, `packages/shooting-core/src/basic/content/validation.ts`, `packages/shooting-core/src/basic/events/game-event.ts`, `packages/shooting-core/src/basic/result.ts`, `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/simulation/entity.ts`, `packages/shooting-core/src/basic/simulation/runtime-entity.ts`, `packages/shooting-core/src/basic/simulation/enemy-bullet-system.ts` | `packages/shooting-core/src/basic/core.test.ts`, `packages/shooting-core/src/basic/simulation/entity.test.ts`, `packages/shooting-core/src/basic/simulation/runtime-entity.test.ts`, `packages/shooting-core/src/basic/simulation/enemy-bullet-system.test.ts`, `tests/public-type-contract.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Collision / score minimum | MVP collision pair と fixed `scoreOnKill` | Done | `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/events/game-event.ts`, `packages/shooting-core/src/basic/simulation/collision-system.ts` | `packages/shooting-core/src/basic/core.test.ts`, `packages/shooting-core/src/basic/simulation/collision-system.test.ts`, `tests/public-type-contract.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Transactional tick contract | 汎用 working / committed state 境界 | Done | `packages/shooting-core/src/basic/core.ts` | `packages/shooting-core/src/basic/core.test.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Transactional tick contract | fatal state と fatal 後 `tick()` の error latch | Done | `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/result.ts`, `packages/shooting-core/src/basic/internal/testing-hooks.ts` | `packages/shooting-core/src/basic/core.test.ts`, `tests/public-type-contract.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | serialized DTO contract | Next | 未実装 | public DTO と export 境界を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | serialize minimum | Queued: Phase 1B-4 | 未実装 | deep immutable serialize と fatal 後 error を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | restore minimum | Queued: Phase 1B-5 | 未実装 | restore error code と複数 tick 一致 test を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | state hash minimum（Player runtime component の `nextShotAllowedTick` を含む） | Queued: Phase 1B-6 | 未実装 | golden test で追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | replay metadata minimum | Queued: Phase 1B-7 | 未実装 | replay file metadata と playback session は作らず、互換性 metadata 型だけ追加 | `npm test`, `npm run typecheck` |

## 次の作業順

1. Phase 1A-1: Core package skeleton
   - Done: package と export 境界を固定する
   - Done: workspace symlink 作成後に package export 経由 minimum gameplay flow test を実行する
   - Done: Node 24 の type stripping でテストを実行できる状態にする
   - Done: `tsc --noEmit` の型検査と public type contract を追加する

2. Phase 1A-2: Content validation minimum
   - Done: content validation を `content/validation.ts` に分離する
   - Done: namespace id、duplicate id、default player、asset reference を検証する
   - Done: Player shot reference を検証する
   - Done: Stage timeline の enemy / path / pattern reference を検証する
   - Done: disabled feature field を unknown field として拒否する
   - Done: schema version、domain number、timeline tick order を検証する
   - Done: optional feature の typo は `feature.unknown`、known but disabled は `feature.unsupported` として分ける
   - Done: asset key と difficulty の空・重複を検証する
   - Later: feature registry 導入時に未使用 feature 定義の warning を追加する

3. Phase 1A-3: Entity / component minimum
   - Done: Player、Enemy、EnemyBullet、PlayerShot の runtime entity component 型を作る
   - Done: stage start 時に Player entity を生成する
   - Done: Stage timeline の spawnEnemy から Enemy entity と `entitySpawned` event を生成する
   - Done: PlayerShot 入力から PlayerShot entity と `playerShotsSpawnedBatch` event を生成する
   - Done: entity id は monotonic に採番する
   - Done: tick 内 system order と id 昇順 tie-breaker を固定する

4. Phase 1A-4: Movement and collision minimum
   - Done: PlayerShotDefinition の最小 projectile velocity / lifetime schema と validation
   - Done: content 定義に基づく player shot movement / lifetime / cleanup
   - Done: player input intent と自機 movement / playfield clamp
   - Done: `fire.intervalTicks` と lifetime / cleanup 実装後に `held` 連射を有効化
   - Done: `fireOnSpawn` による EnemyBullet entity の生成経路を作る
   - Done: player shot と enemy の hit
   - Done: enemy bullet と player の hit
   - Done: player と enemy contact
   - Done: fixed `scoreOnKill`

5. Phase 1A-5: Core minimum completion test
   - Done: 同一 seed と入力で同じ frame event を返す smoke test を追加する
   - Done: collision と score を含む deterministic smoke test へ拡張する
   - Later: object pool や renderer state を Core minimum へ入れないことを Phase 2A 前の性能設計で再確認する

## 後続で明示対応するレビュー指摘

- `StageSession.tick()` は PRNG、entity allocator、active entities、timeline cursor、pending event、expected tick の commit 境界へ寄せた。collision / pattern / internal invariant failure 追加時は `CommittedStageState` と `WorkingStageState` を明示し、成功時だけ committed state へ swap する。
- `EntityAllocator` は restore 経路を追加済み。Phase 1B の `SerializedGameState` に `nextEntityId` を含める。
- `XorShift32.restore()` は invalid state を `CoreResult` として返す API に見直し済み。
- root package export の minimum gameplay flow test は追加済み。`npm install` による workspace symlink 作成を開発手順に含める。
- TypeScript 型検査は `npm run typecheck` で実行する。Phase 1A の package export は source TS export で、配布用 `dist` は後続で判断する。

## Phase 1A 完了条件

- renderer なしで `StageSession.tick()` が 1 tick 単位で成功する
- minimum content fixture から player / enemy / player shot / `fireOnSpawn` enemy bullet を生成でき、`enemyBulletsSpawnedBatch` event と bullet の runtime entity 型境界が用意されている
- collision と score の最小 event が deterministic に並ぶ
- `npm install` 後の `npm test` が通る
- `npm run typecheck` が通る

Phase 1B では fatal latch を固定済みであり、以降は state serialize / restore / state hash と replay metadata minimum の determinism contract を追加する。Replay input list、playback session、optional diagnostics は Phase 1B の外へ分け、ここでは `SerializedGameState` と `ReplayMetadata` の互換性 field として必要な version 情報だけを扱う。

## Phase 1B タスク分割

Done slice:

1. Phase 1B-1: コミット済み / 作業中 state 境界
   - Done: `CommittedStageState` に `expectedTick`、`activeEntities`、`pendingEvents`、`score`、`timelineCursor`、`nextEntityId`、`prngState` を集約する
   - Done: `CommittedStageState` は immutable snapshot だけを保持し、`EntityAllocator` / `XorShift32` の mutable instance を保持しない
   - Done: `activeEntities` と `pendingEvents` は immutable snapshot として保持する
   - Done: tick 中の `WorkingStageState` は `EntityAllocator.restore(nextEntityId)` と `XorShift32.restore(prngState)` で mutable handle を復元し、成功時だけ immutable snapshot として committed state へ swap する
   - Done: committed snapshot 由来の restore は 1B-1 では public `CoreResult` error に露出させず、1B-2 で fatal latch に接続する
   - Done: tick mismatch / invalid input は非 fatal precondition error として扱い、同じ `expectedTick` で継続できることを regression test にする
   - Done: rollback regression test では失敗呼び出しを挟まない baseline session と比較し、その後の成功 tick の `GameFrame` と events が一致することを確認する。public serialize DTO や `StageSession.serialize()` は使わない
   - Done: clone 境界の regression test には、session-scoped の test-only hook `failAfterWorkingMutationTicks` を用意する。この hook は working state 側の `expectedTick`、`activeEntities`、`nextEntityId`、`pendingEvents`、`prngState`、`score`、`timelineCursor` を進めた後に失敗する
   - Done: rollback regression test は、失敗後に元の `expectedTick` の入力を受け付けること、baseline と一致すること、entity snapshot が entity id 昇順に保たれること、event / collision tie-break order の明示期待値が保たれることを確認する

2. Phase 1B-2: fatal latch 最小実装
   - Done: committed snapshot restore 不整合と tick 内 runtime invariant failure を `stageSession.fatal` として latch する。performance budget invariant の具体実装は Phase 2A 以降へ送る
   - Done: fatal trigger は session-scoped の internal test-only hook で再現できる形にする
   - Done: fatal 後の `tick()` は malformed input / future tick より fatal latch を優先し、同じ fatal reason を返して committed state を進めないことを test する
   - Done: fatal 系 `CoreErrorCode` と precondition error の境界を `tests/public-type-contract.ts` で固定する

Next slice:

3. Phase 1B-3: serialized DTO contract
   - 作業: `SerializedGameState` の top-level は `coreVersion`、`schemaVersion`、`contentVersion`、`inputFormatVersion`、`stateHashVersion`、`enabledFeatures`、`stageId`、`difficulty`、`playerId`、`expectedTick`、`nextEntityId`、`prngState`、`state` に合わせる
   - 作業: deterministic payload は `state: SerializedDeterministicState` 配下に置き、`runtimeEntities`、`pendingEvents`、`score`、`timelineCursor`、将来の pattern runner state / feature state を top-level へ出さない
   - 作業: `SerializedDeterministicState` は public DTO として root export し、`runtimeEntities`、`pendingEvents`、`score`、`timelineCursor`、`patternRunnerStates`、`enabledFeatureStates` の required field と nested readonly contract を固定する
   - 作業: `prngState` と `runtimeEntities` は内部 state 型を直接公開せず、public 用 plain-data DTO として `SerializedPrngSnapshot` / `SerializedRuntimeEntityState` を定義する。`docs/design.md` の public shape も `SerializedPrngSnapshot` に統一する
   - 作業: `SerializedRuntimeEntityState` は common base と kind 別 payload の discriminated union にする。common base は `id`、`kind`、`definitionId`、`position`、`collisionRadius` を持つ
   - 作業: Player payload は `lives`、`invincibleTicksRemaining`、`nextShotAllowedTick`、movement snapshot、`shotDefinitionId` を持つ
   - 作業: Enemy payload は `hp`、`scoreOnKill`、`pathId`、`patternId` を持つ
   - 作業: EnemyBullet payload は bullet definition id、`velocity`、`damage`、必要な lifetime state を持つ
   - 作業: PlayerShot payload は shot definition id、`velocity`、`remainingLifetimeTicks`、`damage` を持つ
   - 作業: restore に不要な render-only field、object pool state、view id は serialized runtime entity に含めない
   - 作業: `SerializedPrngSnapshot` は public DTO として field 名、uint32 値域、0 を許可しない制約、PRNG algorithm 変更時は `coreVersion` 互換性で扱う方針を固定する
   - 作業: 既存の内部 `SerializedPrngState` は Core 内部型として残すか、`SerializedPrngSnapshot` へ統合するかをこの slice で決める。root export する公開名は `SerializedPrngSnapshot` に統一する
   - 作業: `SerializedGameState`、`SerializedDeterministicState`、`SerializedRuntimeEntityState`、`SerializedPrngSnapshot` は root export し、`tests/public-type-contract.ts` で positive import、required field、kind 別 required field、nested readonly contract を固定する

Queued slices:

4. Phase 1B-4: serialize 最小実装
   - 作業: `StageSession.serialize(): CoreResult<SerializedGameState>` を stable public API として追加し、`packages/shooting-core/src/basic/index.ts` の root export と `tests/public-type-contract.ts` の method contract を更新する
   - 作業: serialize 結果は deep immutable plain data とし、public 型の nested readonly、runtime の deep freeze / mutation rejection、clone mutation が次 tick / 再 serialize へ影響しないことを別々の期待値として固定する
   - 作業: fatal 後の `serialize()` は error を返すことを test する

5. Phase 1B-5: restore 最小実装
   - 作業: `LoadedGame.restore(state): CoreResult<StageSession>` を stable public API として追加する
   - 作業: restore 用 `CoreErrorCode` として `state.invalidShape`、`state.coreVersionMismatch`、`state.schemaVersionMismatch`、`state.inputFormatVersionMismatch`、`state.stateHashVersionMismatch`、`state.contentMismatch`、`state.featureMismatch`、`state.registryInvalid`、`state.entityAllocatorInvalid`、`state.prngInvalid` を追加し、`tests/public-type-contract.ts` で public union を固定する
   - 作業: `state.contentMismatch` は `contentVersion`、`stageId`、`difficulty`、`playerId` の不一致を包括する。より細かい user-facing 表示が必要になった場合だけ専用 code を追加する
   - 作業: version / stage / player / feature / entity allocator / PRNG state mismatch を `CoreResult` error にする
   - 作業: restore 内で `XorShift32.restore()` の `prng.invalidState` を受け取った場合は `state.prngInvalid` に包み直し、低レベル code を `LoadedGame.restore()` の public error として漏らさない
   - 作業: serialized entity、stage、player、content reference が現在の registry で解決不能な場合は `state.registryInvalid` にする
   - 作業: restore の runtime guard は unknown field、getter / Proxy、非 JSON 互換値、prototype 継承 property を `state.invalidShape` に閉じ込める
   - 作業: 失敗した restore は `LoadedGame` と既存 `StageSession` に副作用を残さない。invalid restore の前に別の active session を進め、失敗後の次 tick / serialize 結果が baseline session と一致すること、さらに valid snapshot の restore または `startStage()` が成功することを negative test にする
   - 作業: `tests/public-type-contract.ts` で `LoadedGame.restore(state): CoreResult<StageSession>` の存在、引数 `SerializedGameState`、戻り値を positive に固定する
   - 作業: restore 直後の再 serialize が元 snapshot と一致する test を追加する
   - 作業: serialize 前 session と restore session に同じ入力列を複数 tick 流し、各 `GameFrame` と再 serialize 結果が一致する test を追加する

6. Phase 1B-6: state hash 最小実装
   - 作業: `HashableGameState` を committed state から生成する helper を追加する
   - 作業: canonical encoding format として key order、配列順、数値表現、hash algorithm、`xxHash64 seed 0x53484f4f54494e47`、output format を実装前に固定し、game seed は PRNG state 側で扱う
   - 作業: hash prefix に `stateHashVersion`、`ShootingCore.coreVersion`、`schemaVersion`、`expectedTick` を含める。`expectedTick` は次に受け付ける input tick であり、最後に完了した frame tick ではない
   - 作業: canonical encoding の対象を `expectedTick`、`nextEntityId`、entity ids、component values、runtime entities、score、lives、timeline cursor、PRNG state、persisted pending deterministic event queue、Player runtime component の `nextShotAllowedTick`、active pattern runner states、enabled feature states に限定する
   - 作業: runtime entities は entity id 昇順、component values は component kind 固定順で encode する
   - 作業: current tick の `GameFrame.events` と drain 済み events は hash 対象外にする。hash 対象にするのは serialize / restore をまたいで残る pending queue だけとする
   - 作業: MVP では active pattern runner states と enabled feature states を空配列として encode し、feature 追加時に hash 対象へ入る契約を残す
   - 作業: golden smoke fixture は shot 発射、player shot cooldown、敵撃破、score 変化、enemy bullet / player hit、lives 減少、invincibility decrement、`entityDestroyed` / `scoreChanged` event、pending event drain を通す
   - 作業: internal hash helper の export 境界を `packages/shooting-core/src/basic/testing` または test-only internal import に限定する。比較順は初期 pending event を含む hash、tick 後 drain 済み hash、restore 直後 hash、restore 後 tick hash とする
   - 作業: emitted `entityDestroyed` / `scoreChanged` events が pending queue drain 後の hash に影響しない golden case を追加する
   - 作業: 同一 seed / input と restore 後 session の state hash が複数 tick で一致する test を追加する
   - 作業: Phase 1B は test assertion 内の hash 比較と first divergent tick の最小報告までに留める。entity diff / event diff / PRNG diff artifact、debug state dump、validate-content CLI 連携は Phase 1C で扱う

7. Phase 1B-7: replay metadata 最小実装
   - 作業: `ReplayMetadata` の minimum DTO として `coreVersion`、`schemaVersion`、`contentVersion`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId`、platform-independent `seed` を定義する
   - 作業: `ReplayMetadata` は root export し、`tests/public-type-contract.ts` で positive import、required readonly field、`seed` の型と値域を固定する
   - 作業: `ReplayMetadata` が共有する互換性 field は `coreVersion`、`schemaVersion`、`contentVersion`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId` に限定する。`SerializedGameState` 専用の `stateHashVersion` と `enabledFeatures` は共有 field ではなく snapshot validation 用 field として扱う
   - 作業: Phase 1B-7 は metadata-only DTO だけを root export する。`ReplayPlayback` type、入力列 validation、`createReplayPlayback()`、`ReplaySession`、runtime dropped tick diagnostics、full replay の `inputs: InputFrame[]` は root export せず Phase 1B の外に残す
   - 作業: `ReplayMetadata` に playback inputs や `RuntimeDroppedTicks` を含めない契約は、Phase 1B では `satisfies ReplayMetadata` と `@ts-expect-error` による type-only negative contract に限定する。runtime guard は replay playback 実装時に追加する

## Phase 2A へ進む条件

- Core が Phaser / Vite に依存していない
- sample app が Core の `GameFrame` を読むだけで描画できる
- keyboard input は runtime adapter で `InputFrame` に変換される
- Core event と render-only event が混ざっていない
- Core state hash に render-only state、view id、object pool state が含まれていない
- object pool sizing と performance budget は runtime adapter / performance design 側で扱う

Phase 2A で初期 playable を目標にする。
