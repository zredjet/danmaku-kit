# Implementation Plan

この文書は `docs/design.md` を実装タスクへ接続するための作業計画です。設計書は判断の正本、この文書は実装順序と完了条件の入口として扱います。

## 現在の実装スライス

Phase 1A の renderer 非依存 Core minimum contract、Phase 1B-1 の committed / working state boundary、Phase 1B-2 の fatal latch minimum、Phase 1B-3 の serialized DTO contract、Phase 1B-4 の serialize minimum、Phase 1B-5A の restore API / error boundary、Phase 1B-5B の deterministic payload shape / registry / runtime budget validation と accepted committed state 変換準備、Phase 1B-5C の extension state / JSON guard / feature mismatch、Phase 1B-5D の transactional restore / roundtrip determinism、Phase 1B-6A の HashableGameState projection、Phase 1B-6B の canonical encoder / adapter / xxHash64 / comparison minimum は完了済みである。現在の実装スライスでは Phase 1B-6B の gameplay smoke digest golden を追加する。replay metadata は後続スライスで扱う。

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
- `SerializedGameState` / `SerializedDeterministicState` / `SerializedRuntimeEntityState` / `SerializedPrngSnapshot` の public DTO と root export 境界を固定する
- serialized runtime entity は kind 別 discriminated union にし、restore に不要な render-only field、object pool state、view id を含めない
- deterministic payload を `SerializedGameState.state` 配下に閉じ込め、top-level は互換性 metadata と session 復元に必要な field に限定する
- pending event は frame 通知用 `GameEvent` と別の `SerializedPendingEvent` として定義する
- pattern runner / optional feature の serialized state は空配列型に固定せず、後続 module が拡張できる DTO 型を置く
- serialized entity id は内部 `EntityId` を root export へ漏らさず、公開 DTO 用 `SerializedEntityId` として定義する
- root export 済みの `StageSession` に `serialize(): CoreResult<SerializedGameState>` を追加する
- `StageSession.serialize()` で session metadata、`expectedTick`、`nextEntityId`、PRNG、score、timeline cursor、runtime entity、pending event を deep immutable snapshot へ写す
- serialize 結果で startStage 直後の `stageStarted` pending event、tick 後の drain 済み pending event、basic core の空 feature state、runtime entity field mapping を test する
- fatal 後の `serialize()` が同じ fatal reason を返すことを test する
- root export 済みの `LoadedGame` に `restore(state): CoreResult<StageSession>` を追加する
- restore 用 `CoreErrorCode` として `state.invalidShape`、version mismatch、content mismatch、feature mismatch の public union を固定する
- restore 5A で top-level shape、`prngState` / `state` の object container guard、top-level `enabledFeatures` の dense array / canonical order / duplicate guard、version mismatch、`contentVersion` / `stageId` / `difficulty` / `playerId` mismatch、top-level `enabledFeatures` mismatch を `CoreResult` error に閉じ込める
- compatible snapshot の deep deterministic payload validation は 5B 以降へ送り、5A では一時的な未対応境界として返す
- runtime budget 定数を `content/runtime-budgets.ts` へ切り出し、content validation と restore validation が同じ値を参照できるようにする
- restore 5B 前半で `state.prngInvalid`、`state.registryInvalid` を public `CoreErrorCode` として固定する
- restore 5B 前半で PRNG snapshot、EntityAllocator と共有する `nextEntityId` bound、deterministic payload shape、初期 snapshot の一意性、score、timeline cursor、pending event contract、basic core の空 extension state contract、runtime entity ID order / kind 別 shape / registry reference / runtime budget / 処理済み timeline 由来上限と位置一致を検証する
- restore 5B 後半で検証済み deterministic payload を `CommittedStageState` へ変換し、既存 serialize 経路へ通せる accepted committed state の前段 DTO を作る。compatible snapshot の session 化は 5D に残す
- restore 5C で extension state の field shape、runner / feature stateVersion、UTF-8 byte order、JSON payload guard を追加し、shape が正しい非空 extension state は `state.featureMismatch` として分類する
- restore 5D で compatible snapshot から `StageSession` を作成し、restore 直後の serialize、後続 tick、失敗 restore 後の既存 session 不変性を固定する
- state hash 6A で committed state と session metadata から `HashableGameState` を生成する helper を追加し、public serialize DTO と hash DTO が runtime state から別々に明示コピーされることを固定する
- state hash 6A で `HashableGameState` / nested DTO / kind 別 runtime entity の canonical field order 定数を追加し、型変更時の不足・重複・kind 追加漏れを検出できるようにする。定数は凍結し、全順序を golden で固定する。順序を変えるときは `stateHashVersion` も更新する
- state hash 6B 前半で internal canonical encoder を追加し、type tag、u32 little-endian length / count、finite binary64 little-endian number、`-0` 正規化、lone surrogate 拒否、UTF-8 key sort、array / fixedStruct / object bytes を golden で固定する。文字列 8 KiB、単一 container 10,000 entries、全 container 100,000 entries、object key 合計 256 KiB、全 byte stream 2 MiB の resource budget を設け、xxHash64 が中間 byte stream を全量保持せず更新できる streaming sink もここで用意する
- state hash 6B 後半で `HashableGameState` adapter、fixed seed xxHash64、lower-case 16 桁 digest を追加し、Core が生成した hash DTO の restore roundtrip でも digest が一致することを固定する
- state hash 6B 後半で test-only の hash comparison を追加し、同一 simulation の tick 列は一致し、入力差分は最初の divergent tick として検出されることを固定する

Next:

- gameplay smoke fixture の tick ごとの digest golden を追加する

このスライスでは Phaser、Vite、DOM、asset loader、YAML parser、replay metadata、replay playback UI は扱わない。

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
| `docs/design.md` Replay determinism | serialized DTO contract | Done | `packages/shooting-core/src/basic/serialization/types.ts`, `packages/shooting-core/src/basic/index.ts` | `tests/public-type-contract.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | serialize minimum | Done | `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/serialization/types.ts` | metadata / field mapping / pendingEvents / empty feature state / deep immutable / fatal 後 error を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | restore API / error boundary | Done | `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/result.ts` | restore method contract、restore error code、version / content / top-level feature mismatch を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | deterministic payload restore shape / registry / runtime budget validation | Done | `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/content/runtime-budgets.ts`, `packages/shooting-core/src/basic/result.ts` | PRNG snapshot、pending event、runtime entity、registry reference、runtime budget validation を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | accepted committed state 変換準備 | Done | `packages/shooting-core/src/basic/core.ts` | validated restore DTO を `CommittedStageState` へ変換し、既存 serialize 経路へ通す | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | extension state / JSON guard / feature mismatch | Done | `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/serialization/restore-json.ts` | extension payload guard と feature mismatch 分類を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | transactional restore / roundtrip determinism | Done | `packages/shooting-core/src/basic/core.ts` | restore 後 serialize / 後続 tick 一致、失敗 restore の transactionality を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | state hash minimum: `HashableGameState` projection | Done | `packages/shooting-core/src/basic/core.ts` | committed state から hash DTO を生成し、public serialize DTO と型結合しない direct projection を固定 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | state hash minimum: canonical encoding / digest | In progress: Phase 1B-6B | `packages/shooting-core/src/basic/hash/canonical-encoder.ts`, `hashable-game-state-adapter.ts`, `xxhash64.ts`, `state-hash.ts`, `testing/state-hash-comparison.ts` | canonical encoder、adapter、xxHash64、PRNG / game-state digest golden、first divergent tick test は完了。gameplay smoke の tick digest golden を追加 | `npm test`, `npm run typecheck` |
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

3. Phase 1B-3: serialized DTO contract
   - Done: `SerializedGameState` の top-level は `coreVersion`、`schemaVersion`、`contentVersion`、`inputFormatVersion`、`stateHashVersion`、`enabledFeatures`、`stageId`、`difficulty`、`playerId`、`expectedTick`、`nextEntityId`、`prngState`、`state` に合わせる
   - Done: deterministic payload は `state: SerializedDeterministicState` 配下に置き、`runtimeEntities`、`pendingEvents`、`score`、`timelineCursor`、将来の pattern runner state / feature state を top-level へ出さない
   - Done: `SerializedDeterministicState` は public DTO として root export し、`runtimeEntities`、`pendingEvents`、`score`、`timelineCursor`、`patternRunnerStates`、`enabledFeatureStates` の required field と nested readonly contract を固定する
   - Done: `prngState` と `runtimeEntities` は内部 state 型を直接公開せず、public 用 plain-data DTO として `SerializedPrngSnapshot` / `SerializedRuntimeEntityState` を定義する。`docs/design.md` の public shape も `SerializedPrngSnapshot` に統一する
   - Done: `SerializedRuntimeEntityState` は common base と kind 別 payload の discriminated union にする。common base は `id`、`kind`、`definitionId`、`position`、`collisionRadius` を持つ
   - Done: Player payload は `lives`、`invincibleTicksRemaining`、`nextShotAllowedTick`、movement snapshot、`shotDefinitionId` を持つ
   - Done: Enemy payload は `hp`、`scoreOnKill`、`pathId`、`patternId` を持つ
   - Done: EnemyBullet payload は現行 runtime state から生成できる bullet definition id、position、collision radius に限定する。enemy bullet の `velocity`、`damage`、lifetime state は runtime 側へ正本を追加する slice まで public DTO に含めない
   - Done: PlayerShot payload は shot definition id、`velocity`、`remainingLifetimeTicks`、`damage` を持つ
   - Done: `pendingEvents` は `GameEvent` 直参照ではなく `SerializedPendingEvent` として分離し、Phase 1B では serialize / restore をまたいで未処理になり得る tick 0 の `stageStarted` に限定する。tick 内で drain される `entitySpawned`、`playerShotsSpawnedBatch`、`enemyBulletsSpawnedBatch`、`entityDestroyed`、`scoreChanged` などの frame 通知 event は pending queue に入れない
   - Done: `runtimeEntities` は entity id 昇順、positive safe integer、strict ascending / unique / `id < nextEntityId` の設計契約を DTO コメントと設計書で固定する。serialize での出力と restore での runtime validation は Phase 1B-4 / 1B-5 で扱う
   - Done: `patternRunnerStates` / `enabledFeatureStates` は空配列型ではなく、schema version 付き extension payload の public DTO として型境界を固定する。`runnerId` は `patternRunner.${string}` とし、空 suffix 拒否、非空時の canonical order、重複拒否、feature state 欠落可否は module contract で扱う方針を設計書に固定する。実際の basic core serialize 出力は Phase 1B-4、restore 時の top-level `enabledFeatures` と feature state の整合検証は Phase 1B-5 で扱う
   - Done: restore に不要な render-only field、object pool state、view id は serialized runtime entity に含めない
   - Done: `SerializedPrngSnapshot` は public DTO として field 名、uint32 値域、0 を許可しない制約、PRNG algorithm 変更時は `coreVersion` 互換性で扱う方針を固定する
   - Done: 既存の内部 `SerializedPrngState` は Core 内部型として残し、root export する公開名は `SerializedPrngSnapshot` に統一する
   - Done: `SerializedGameState`、`SerializedDeterministicState`、`SerializedRuntimeEntityState`、`SerializedPrngSnapshot`、`SerializedPendingEvent`、`SerializedEntityId`、serialized extension state は root export し、`tests/public-type-contract.ts` で positive import、required field、kind 別 required field、namespace id、JSON-compatible payload、nested readonly contract を固定する

Done:

4. Phase 1B-4: serialize 最小実装
   - Phase 1B-4A: public API と metadata snapshot
   - 作業: root export 済みの `StageSession` 自体へ `serialize(): CoreResult<SerializedGameState>` を stable public API として追加する。別名の public export は増やさない。`packages/shooting-core/src/basic/index.ts` の root export と `tests/public-type-contract.ts` の method contract で固定する
   - 作業: `startStage()` 時点で session context に保持した `coreVersion`、`schemaVersion`、`contentVersion`、`inputFormatVersion`、`stateHashVersion`、`enabledFeatures`、`stageId`、`difficulty`、`playerId` をそのまま `SerializedGameState` の top-level metadata に出力する。serialize 実装内で difficulty や version を推測しない
   - 作業: `expectedTick`、`nextEntityId`、`prngState`、`state.score`、`state.timelineCursor`、`state.pendingEvents` を committed state から生成する
   - Phase 1B-4B: runtime entity mapping と ordering
   - 作業: 各 `SerializedRuntimeEntityState` payload を committed state から生成する。field ごとの小さい assertion で共通 `id` / `kind` / `definitionId` / `position` / `collisionRadius`、player `lives` / `invincibleTicksRemaining` / `nextShotAllowedTick` / `movement` / `shotDefinitionId`、enemy `hp` / `scoreOnKill` / `pathId` / `patternId`、enemy bullet `definitionId` / `position` / `collisionRadius`、player shot `velocity` / `remainingLifetimeTicks` / `damage`、score、timeline cursor、PRNG state、next entity id を固定し、別途複数 tick の統合 golden smoke を置く
   - 作業: `runtimeEntities` は entity id 昇順で出力する。通常経路では committed state が `freezeEntitiesInIdOrder()` 済みのため、順序揺れは serialize mapper を小さく切り出した source-level test、または test-only hook で unsorted input を与えて検証する
   - Phase 1B-4C: extension state / pending event / immutability / fatal
   - 作業: `enabledFeatures` は Phase 1B-4 では basic core の通常経路で空配列だけを出力する。非空 feature set の canonical order は serialize 経路ではなく、`content/types.ts` の `KNOWN_ENABLED_FEATURES` を source-level test で直接 import し、`["bomb", "graze", "affinity", "rank", "pickup", "advancedScoring"]` と一致することを regression 固定する。root package の value export は増やさない。feature module 有効化時に matrix test を追加する
   - 作業: basic core の `patternRunnerStates` と `enabledFeatureStates` は空配列として出力する。後続 module が非空にする場合に備え、serialize helper の contract は `patternRunnerStates` を `runnerId` の UTF-8 byte lexicographic order 昇順、`enabledFeatureStates` を canonical feature order に固定する
   - 作業: `pendingEvents` は startStage 直後だけ tick 0 の `stageStarted` を `SerializedPendingEvent` として出力し、1 tick 進んだ後は drain 済み frame event を保存しないことを test する。Phase 1B では `expectedTick === 0` の snapshot は同一 `stageId` の `stageStarted` 1 件だけ、`expectedTick > 0` の snapshot は空配列だけを valid とする。未知 pending event が committed state に残っていた場合は committed state invariant failure として `stageSession.fatal` に latch し、以後の `tick()` / `serialize()` が同じ fatal reason を返すことを test する。この invariant failure は session-scoped test-only hook `overrideCommittedPendingEventsTicks` を `StageSessionTestingHookOptions` に追加し、public API からは作れない committed state clone の pending queue を差し替えて再現する。期待 error は `stageSession.fatal`、message は現行 `freezeFatalErrors()` の wrapper に合わせて `Stage session entered a fatal state:` で始まり、detail に `unsupported pending event in committed state` を含むことを固定する
   - 作業: serialize 結果は deep immutable plain data とする。戻り値の mutation が失敗すること、clone を mutate しても session と次回 serialize 結果に影響しないことを別々の期待値として固定する
   - 作業: fatal 後の `serialize()` は error を返すことを test する

5. Phase 1B-5: restore 最小実装
   - Done: Phase 1B-5D transactional restore / roundtrip determinism
   - Phase 1B-5A: API / error boundary
   - Done: `LoadedGame.restore(state): CoreResult<StageSession>` を stable public API として追加する。Phase 1B-4 後の root exported `StageSession` は `serialize()` を持つ。type contract では restore 戻り値に対して `value.serialize(): CoreResult<SerializedGameState>` を呼べることまで positive に固定する
   - Done: restore 用 `CoreErrorCode` として `state.invalidShape`、`state.coreVersionMismatch`、`state.schemaVersionMismatch`、`state.inputFormatVersionMismatch`、`state.stateHashVersionMismatch`、`state.contentMismatch`、`state.featureMismatch` を追加し、`tests/public-type-contract.ts` で public union を固定する。`state.invalidShape` は top-level object / required metadata field / primitive field type / top-level `enabledFeatures` の dense array・canonical order・duplicate guard / deterministic payload container の最小 shape guard に限定し、runtime entity や registry 参照などの深い validation は 5B で追加する。`state.registryInvalid`、`state.prngInvalid` は 5B の validation 実装と同時に public union へ追加する。EntityAllocator の restorable bound 違反は `state.invalidShape` に正規化し、低レベル code は public restore error として露出しない
   - Done: snapshot restore は `coreVersion` 完全一致だけを受け付ける。minor mismatch の best-effort playback は replay playback 専用であり、snapshot restore には適用しない negative test を追加する。PRNG algorithm 変更は major version 変更として扱う
   - Done: `state.contentMismatch` は `contentVersion`、`stageId`、`difficulty`、`playerId` の不一致を包括する。より細かい user-facing 表示が必要になった場合だけ専用 code を追加する
   - Done: version / stage / player / top-level feature mismatch を `CoreResult` error にする
   - Done: version / content / feature mismatch がない snapshot は 5A 時点では一時的な未対応境界として返し、valid snapshot を `state.invalidShape` として誤分類しない
   - Phase 1B-5B: deterministic payload shape / registry / runtime budget validation
   - Done: deterministic payload 内の serialized entity、stage、player、content reference が現在の registry で解決不能な場合は `state.registryInvalid` にする。top-level `stageId` / `playerId` / `difficulty` の不一致は 5A の `state.contentMismatch` に残し、5B の `state.registryInvalid` へ分類変更しない
   - Done: top-level `nextEntityId` の primitive shape は 5A で `state.invalidShape` として拒否済み。5B では EntityAllocator と同じ restorable upper bound を共有定数へ切り出し、範囲違反は `state.invalidShape` として正規化する。runtime entity 側の ID/order/`id < nextEntityId` 違反も serialized shape 契約違反として `state.invalidShape` にする
   - Done: top-level `prngState` の object container shape は 5A で `state.invalidShape` として拒否済み。5B では `prngState` object 内の `state` が不正な場合は `state.prngInvalid` にする。restore 内で `XorShift32.restore()` の `prng.invalidState` を受け取った場合は `state.prngInvalid` に包み直し、低レベル code を `LoadedGame.restore()` の public error として漏らさない
   - Done: Phase 1B の serialized enemy bullet は `definitionId`、`position`、`collisionRadius` だけを受け付ける。`projectile` のような未実装 runtime state field は unknown field として `state.invalidShape` にする
   - Done: `SerializedPendingEvent` は tick 0 の `stageStarted` だけを受け付ける。top-level `expectedTick === 0` では top-level `stageId` と一致する `stageStarted` 1 件だけを要求し、0 件、複数件、別 `stageId` は `state.invalidShape` にする。top-level `expectedTick > 0` では `pendingEvents` は空配列だけを許可し、非空なら `state.invalidShape` にする。negative test は `expectedTick 0 + empty`、`expectedTick 0 + multiple`、`expectedTick 0 + stageId mismatch`、`expectedTick > 0 + stageStarted` を含める
   - Done: restore 用 budget 定数は `content/validation.ts` や `simulation/entity.ts` の private const を複製せず、Phase 1B-5B の前半で `content/runtime-budgets.ts` などの共有 domain constants へ切り出す。`MAX_PLAYER_SHOT_SPEED_PER_AXIS = 64`、`MAX_PLAYER_MOVEMENT_SPEED = 16`、`MAX_PLAYER_SHOT_LIFETIME_TICKS = 300`、EntityAllocator の restorable upper bound は validation と restore が同じ定数を参照する
   - Done: top-level `expectedTick` の non-negative safe integer と `nextEntityId` の positive safe integer は 5A で検証済み。5B では `nextEntityId` の restorable upper bound を EntityAllocator と共有し、`runtimeEntities` の ID が positive safe integer / strict ascending / unique / `id < nextEntityId` を満たさない場合は `state.invalidShape` にする。さらに processed timeline と入力由来 player shot の最大生成数から到達不能な `nextEntityId`、同 tick の enemy / enemyBullet / playerShot 生成順から作れない ID 並びも `state.invalidShape` にする。player entity は runtime 初期採番に合わせて `id === 1` を必須にする。`expectedTick === 0` の snapshot は score、player position、lives、invincible tick、shot cooldown が `startStage()` 直後の一意な初期値と一致することを要求する。enemy / enemyBullet は `timelineCursor` より前の処理済み timeline step から生成され得る数と位置を上限にし、未処理 timeline 由来や異なる spawn 位置の混入を `state.invalidShape` にする。position / velocity は finite number とし、player shot velocity と lifetime、player movement speed は共有 domain constants の上限を使う。Phase 1B-5 では runtime entity の `collisionRadius`、player shot の `damage`、player movement speed、active enemy hp は positive finite number、score / scoreOnKill / lives / invincibleTicksRemaining は用途に応じた non-negative safe integer として検証する。player position は playfield 内、lives は initialLives 以下、invincibleTicksRemaining は invincibleTicksAfterHit 以下、nextShotAllowedTick は expectedTick と shot fire interval から到達可能な範囲に制限する。valid gameplay から serialize された score が restore で拒否されない roundtrip test を Phase 1B-5D に含める。`timelineCursor` は stage timeline length 以下で、かつ `expectedTick` 時点で未処理であるべき最初の timeline index と一致することを検証する。範囲違反はすべて `state.invalidShape` に統一する
   - Done: player / enemy / enemyBullet / playerShot の kind ごとの unknown field / registry / budget regression matrix を拡充する
   - Done: 検証済み PRNG、pending event、runtime entity、score、timeline cursor を `CommittedStageState` へ変換し、既存 `serializeCommittedStageState()` に通す。5B 時点では public restore 成功はまだ返さず、5D 完了後の現在契約では compatible snapshot から `StageSession` を返す
   - Done: Phase 1B-5C extension state / JSON guard / feature mismatch
   - Done: feature module が非空 `patternRunnerStates` / `enabledFeatureStates` を許可する段階で、field shape、重複、順序違反、`patternRunner.` のような空 suffix runner id、正の safe integer でない stateVersion、任意 extension payload の `NaN` / `Infinity`、lone surrogate、非 JSON 互換値は `state.invalidShape` にする。field shape が正しい非空 extension state については module / top-level `enabledFeatures` との整合性として扱い、basic core では `state.featureMismatch` に統一する
   - Done: extension payload の runtime guard は unknown field、`undefined`、`symbol`、`bigint`、Date、Map、sparse array、getter、revoked / throwing trap proxy、prototype 継承 property を `state.invalidShape` に閉じ込める。transparent Proxy の完全検出は JavaScript runtime 上保証しない。top-level と `enabledFeatures` の guard は 5A、runtime entity / pending event の guard は 5B で扱う
   - Phase 1B-5D: transactional restore / roundtrip determinism
   - Done: 失敗した restore は `LoadedGame` と既存 `StageSession` に副作用を残さない。invalid restore の前に別の active session を進め、失敗後の次 tick / serialize 結果が baseline session と一致すること、さらに valid snapshot の restore と `startStage()` が成功することを negative test にする
   - Done: restore 直後の再 serialize が元 snapshot と一致する test を追加する
   - Done: serialize 前 session と restore session に同じ入力を流し、各 `GameFrame` と再 serialize 結果が一致する test を追加する

6. Phase 1B-6: state hash 最小実装
   - Done: `HashableGameState` を committed state と session metadata から生成する helper を追加する。`HashableGameState` は public serialize DTO と型結合せず、hash version ごとの内部 DTO として `stateHashVersion`、`coreVersion`、`schemaVersion`、`expectedTick`、`nextEntityId`、`timelineCursor`、`prngState`、`score`、runtime entities、pending events、pattern runner states、enabled feature states を持つ
   - Done: internal canonical encoder で type tag、u32 little-endian length / count、finite binary64 little-endian number、`-0` 正規化、lone surrogate 拒否、UTF-8 key sort、array / fixedStruct / object bytes を golden で固定する。Core 所有 DTO と validation 済み extension payload だけを入力とし、accessor / symbol / non-enumerable / additional property を拒否する。循環・過剰な nesting・反射 proxy failure・文字列 8 KiB・単一 container 10,000 entries・全 container 100,000 entries・object key 合計 256 KiB・全 byte stream 2 MiB も `CanonicalEncodingError` に閉じ込める。xxHash64 用 streaming sink で中間 byte stream の全量保持を避ける
   - Done: `HashableGameState` adapter は field-order / `HASHABLE_FIXED_STRUCT_NAME_BY_DTO` table から schema-defined fixedStruct tree を構築し、runtime entity は id 昇順、pattern runner state は runnerId の UTF-8 byte 順、enabled feature state は canonical feature 順へ正規化する。adapter は caller-owned array を変更しない
   - Done: `xxhash64.ts` は vendored / self-contained な uint32 pair 実装として、zero seed の既知 vector、`0x53484f4f54494e47n` 相当の固定 seed、32 byte をまたぐ chunk write、lower-case 16 桁 hex を golden で固定する。`state-hash.ts` は canonical streaming sink と adapter を結び、game state / PRNG state digest を中間 byte stream 全量なしで計算する
   - Done: test-only の `findFirstStateHashDivergence()` は tick/hash 列の最初の hash・tick・列長の不一致を返す。同一 seed / input の Core session は tick ごとの hash 列が一致し、shot input の差分は tick 0 の divergence として検出する
   - 作業: canonical byte sequence または digest 表記を変え得る変更は `stateHashVersion` を更新する。field order、fixedStruct name、type tag、length / endian、UTF-8 key sort、`-0` 正規化、number encoding、algorithm、seed、hex 表記を対象にし、golden で byte / digest 不変を確認できる内部リファクタだけを例外にする
   - Done: fixedStruct name は `HASHABLE_FIXED_STRUCT_NAME_BY_DTO` で `hashableGameState`、`prngState`、`vector2`、`playerMovement`、`playerRuntimeEntity`、`enemyRuntimeEntity`、`enemyBulletRuntimeEntity`、`playerShotRuntimeEntity`、`pendingEvent`、`patternRunnerState`、`enabledFeatureState` に固定する。field order または struct name を変更するときは `stateHashVersion` を更新する
   - 作業: hash 比較は replay / snapshot metadata 検証済みの同一 `contentVersion`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId` 文脈内に限定し、debug artifact 単体では metadata を併記する
   - 作業: canonical encoding の対象を `HashableGameState` の単一 DTO に限定する。runtime entity DTO には entity id と component values を一度だけ含め、`entity ids` / `component values` / `runtime entities` を別投影として重ねて encode しない。`ReadonlyGameState` / render-facing `visible` snapshot は hash DTO に含めず encode しない
   - Done: runtime entity の deterministic field projection は `StageSession.serialize()` と state hash で public DTO 型を共有しない。public serialize DTO と `HashableGameState` はそれぞれ runtime state / committed pending event から明示コピーし、hash schema の変更が public snapshot へ漏れないようにする
   - Done: runtime entities は entity id 昇順、pattern runner states は `runnerId` の UTF-8 byte lexicographic order 昇順、enabled feature states は canonical feature order で encode する
   - Done: fixed DTO field order を immutable table fixture と golden test で固定する。`HashableGameState` は `stateHashVersion`, `coreVersion`, `schemaVersion`, `expectedTick`, `nextEntityId`, `timelineCursor`, `prngState`, `score`, `runtimeEntities`, `pendingEvents`, `patternRunnerStates`, `enabledFeatureStates`。nested vector は `fixedStruct("vector2", [x, y])`、player movement は `fixedStruct("playerMovement", [speed, focusSpeed])` として flatten しない。player entity は `id`, `kind`, `definitionId`, `position`, `collisionRadius`, `lives`, `invincibleTicksRemaining`, `nextShotAllowedTick`, `movement`, `shotDefinitionId`。enemy entity は `id`, `kind`, `definitionId`, `position`, `collisionRadius`, `hp`, `scoreOnKill`, `pathId`, `patternId`。enemy bullet は `id`, `kind`, `definitionId`, `position`, `collisionRadius`。player shot は `id`, `kind`, `definitionId`, `position`, `collisionRadius`, `velocity`, `remainingLifetimeTicks`, `damage`。pending event は `type`, `tick`, `stageId`。pattern runner state は `runnerId`, `patternId`, `stateVersion`, `payload`。enabled feature state は `feature`, `stateVersion`, `payload`。この順序を変更するときは `stateHashVersion` も更新する
   - 作業: current tick の `GameFrame.events` と drain 済み events は hash 対象外にする。hash 対象にするのは serialize / restore をまたいで残る pending queue だけとする
   - 作業: MVP では active pattern runner states と enabled feature states を空配列として encode し、feature 追加時に hash 対象へ入る契約を残す
   - 作業: golden smoke fixture は shot 発射、player shot cooldown、敵撃破、score 変化、enemy bullet / player hit、lives 減少、invincibility decrement、`entityDestroyed` / `scoreChanged` event、pending event drain を通す
   - 作業: internal hash helper の export 境界を `packages/shooting-core/src/basic/testing` または test-only internal import に限定する。比較順は初期 pending event を含む hash、tick 後 drain 済み hash、restore 直後 hash、restore 後 tick hash とする
   - 作業: emitted `entityDestroyed` / `scoreChanged` events が pending queue drain 後の hash に影響しない golden case を追加する
   - 作業: 同一 seed / input と restore 後 session の state hash が複数 tick で一致する test を追加する
   - 作業: Phase 1B は test assertion 内の hash 比較と first divergent tick の最小報告までに留める。entity diff / event diff / PRNG diff artifact、debug state dump、validate-content CLI 連携は Phase 1C で扱う

7. Phase 1B-7: replay metadata 最小実装
   - 作業: `ReplayMetadata` の minimum DTO として `coreVersion`、`schemaVersion`、`contentVersion`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId`、platform-independent `seed` を定義する。PRNG state hash は独立 field として追加せず、Replay 検証 artifact が必要な場合は Phase 1B-6 の state hash format 内の `prngState` field を使う
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
