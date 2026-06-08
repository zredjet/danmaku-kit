# Implementation Plan

この文書は `docs/design.md` を実装タスクへ接続するための作業計画です。設計書は判断の正本、この文書は実装順序と完了条件の入口として扱います。

## 現在の実装スライス

Phase 1A のうち、renderer 非依存の Core minimum contract から着手する。

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

Next:

- enemy bullet runtime entity の生成を入れる
- player shot と enemy の最小 collision を入れる
- enemy bullet と player の最小 collision を入れる
- fixed `scoreOnKill` を event と state に接続する

このスライスでは Phaser、Vite、DOM、asset loader、YAML parser、serialize / restore は扱わない。

## 設計から実装への対応表

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
| `docs/design.md` Transactional tick contract | fatal state、serialize / restore 失敗契約、汎用 working / committed state 境界 | Later | 未実装 | Phase 1B / collision / score 導入時に追加 | `npm test` |
| `docs/design.md` Replay determinism | serialize / restore / state hash（Player runtime component の `nextShotAllowedTick` を含む） | Later | 未実装 | Phase 1B golden test で追加 | `npm test`, `npm run typecheck` |

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
   - Next: EnemyBullet entity の生成経路を作る
   - Next: player shot と enemy の hit
   - Next: enemy bullet と player の hit
   - Next: fixed `scoreOnKill`

5. Phase 1A-5: Core minimum completion test
   - Done: 同一 seed と入力で同じ frame event を返す smoke test を追加する
   - Next: collision と score を含む deterministic smoke test へ拡張する
   - Next: object pool や renderer state を Core minimum へ入れないことを確認する

## 後続で明示対応するレビュー指摘

- `StageSession.tick()` は PRNG、entity allocator、active entities、timeline cursor、pending event、expected tick の commit 境界へ寄せた。collision / pattern / budget failure 追加時は `CommittedStageState` と `WorkingStageState` を明示し、成功時だけ committed state へ swap する。
- `EntityAllocator` は restore 経路を追加済み。Phase 1B の `SerializedGameState` に `nextEntityId` を含める。
- `XorShift32.restore()` は invalid state を `CoreResult` として返す API に見直し済み。
- root package export の minimum gameplay flow test は追加済み。`npm install` による workspace symlink 作成を開発手順に含める。
- TypeScript 型検査は `npm run typecheck` で実行する。Phase 1A の package export は source TS export で、配布用 `dist` は後続で判断する。

## Phase 1B へ進む条件

- renderer なしで `StageSession.tick()` が 1 tick 単位で成功する
- minimum content fixture から player / enemy / player shot を生成でき、bullet の runtime entity 型境界が用意されている
- collision と score の最小 event が deterministic に並ぶ
- `npm install` 後の `npm test` が通る
- `npm run typecheck` が通る

Phase 1B では serialize / restore、state hash、replay metadata、golden test を追加する。

## Phase 2A へ進む条件

- Core が Phaser / Vite に依存していない
- sample app が Core の `GameFrame` を読むだけで描画できる
- keyboard input は runtime adapter で `InputFrame` に変換される
- Core event と render-only event が混ざっていない

Phase 2A で初期 playable を目標にする。
