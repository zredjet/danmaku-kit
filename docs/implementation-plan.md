# Implementation Plan

この文書は `docs/design.md` を実装タスクへ接続するための作業計画です。設計書は判断の正本、この文書は実装順序と完了条件の入口として扱います。

## 現在の実装スライス

Phase 1A の renderer 非依存 Core minimum contract と Phase 1B の determinism contract は完了済みである。Phase 1C-1 の validate-content output contract、Phase 1C-2 の parser / CLI boundary、Phase 1C-3 の fixture / CLI integration、Phase 1C-4 の headless debug dump と first divergent checkpoint の field-level replay divergence artifact、Phase 1C-R の振る舞いを変えない module 分割リファクタリングも完了し、Phase 1C の tooling minimum を完了した。Phase 2A 着手前の Phase 1C-S（振る舞いを変えない構造整理）で、ディレクトリと依存 layer の対応を整え、entity kind の知識を `entities/<kind>/` へ縦に集めた。「Phase 2A へ進む条件」を確認し、Phase 2A を walking skeleton、Core gameplay、runtime / app、仕上げの slice へ分割した（「Phase 2A タスク分割」）。Phase 2A-0 で Core source の import を同じ package の相対 path に限る guard を固定した。Phase 2A-1a で Vite / Phaser の sample app skeleton と app の import 規則を置いた。Phase 2A-1b で validate-content の Node API と Vite content plugin による content pipeline を置いた。Phase 2A-1c で固定 tick clock と keyboard input adapter を Phaser 非依存の module として置いた。Phase 2A-1d で Phaser Scene と view 同期をつなぎ、ブラウザで自機を動かして撃てる walking skeleton（Phase 2A-1）を完成させた。Phase 2A-2 で敵が path に沿って動き、path を終えて画面外へ出た敵を取り除くようにした。Phase 2A-3 で敵弾を動かし、画面外の敵弾を取り除き、active 2,000 の上限を fatal として固定した。Phase 2A-4 で host の三角関数に依存しない決定的な角度計算を固定し、path に sine offset を加えた。Phase 2A-5 で `wait` / `fire` / `loop` の PatternProgram と enemy ごとの pattern runner を追加し、serialize / hash / restore まで通した。次は Phase 2A-6 の stage の最小終了判定に着手する。

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
- state hash 6B 後半で score、shot cooldown、player hit、lives、invincibility decrement を含む gameplay tick digest golden と、restore 後の複数 tick digest 一致を固定する
- replay metadata 1B-7 で `ReplayMetadata` の readonly DTO と root type export を追加し、未検証 `enabledFeatures` を含む replay 互換性 metadata と、snapshot 専用 `stateHashVersion` / playback API を公開しない境界を exact type contract で固定する。canonical order / 重複禁止は playback validator の責務とする
- validate-content 1C-1 で tooling package、immutable diagnostic / JSON output、human formatter、validation / tool error の exit code contract を追加する
- validate-content 1C-2 で strict YAML parser、source span、CLI / filesystem boundary、Core validation adapter を追加する
- validate-content 1C-3 で静的な最小 content fixture と、valid / content parse / content・game-definition schema / reference / budget / CLI argument の実プロセス CLI golden test を追加する
- debug state 1C-4 foundation で test-only headless schema、state / PRNG hash、entity count、test sessionだけで収集するnullable event / collision metrics、portable artifact path / schema-order JSON formatter、public `CoreErrorCode` を拡張しない内部 hash failure result 境界を追加する
- module 分割 1C-R で `core.ts`（3327行）、`core.test.ts`（5350行）、`tests/public-type-contract.ts`（1449行）、`content/validation.ts`、validate-content loader を責務単位の module へ振る舞いを変えずに分割し、runtime import cycle を解消して、依存方向と cycle を `tests/module-graph.test.mjs` で固定する
- replay divergence 1C-4 で test-only の replay trace recorder / comparator、raw `ReplayMetadata` の検証と互換性分類、first divergent checkpoint の input / entity / component / event / PRNG diff、schema 順 JSON artifact と artifact path を追加する
- 構造整理 1C-S で `internal/` を `shared/` / `instrumentation/` / `testing/` へ layer 別に分け、restore / hash / committed state の配置と依存の向きを直し、session の fault injection と timeline system を整理し、entity kind の runtime / serialize / hash / restore を `entities/<kind>/` へ縦に集めて field 集合の一致と kind の登録漏れを型と test で固定する
- import guard 2A-0 で shooting-core の非 test source が同じ `src/` 配下の module だけを相対 path で import し、npm package、`node:`、triple-slash reference directive を型 import も含めて使わないことを `tests/module-graph.test.mjs` で固定する
- sample app 2A-1a で `apps/sample-title` に Vite 8 / Phaser 4.2.1 の skeleton を置き、browser / Node 用 tsconfig を typecheck に、production build を `npm run check` に加え、app が Core を package root からだけ import し、`phaser` を Phaser adapter と entry に、`import.meta` を entry に閉じ込めることを `tests/module-graph.test.mjs` で固定する
- content pipeline 2A-1b で validate-content に `loadValidatedGameDefinition()` を公開し、CLI をその上に載せ、sample app の Vite content plugin が build / dev server 時に content を検証して `GameDefinition` を virtual module で渡す
- runtime input 2A-1c で固定 tick clock（catch-up 5 tick、超過分の破棄と `RuntimeDroppedTicks`）、既定 key binding、keyboard input adapter（edge ラッチ、tap、catch-up、reset 後の再ラッチ抑止、`UiInputFrame` 分離）を Phaser 非依存の module として置き、`src/runtime/` の Phaser 以外を DOM lib なしで型検査する
- walking skeleton 2A-1d で `StageLoop`（clock → 入力 → `tick()`、error の latch）と entity id 差分による view 同期を Phaser 非依存に置き、Phaser の `StageScene` でブラウザ上の自機移動・低速移動と判定表示・連射・敵撃破を動かす
- enemy path 2A-2 で `PathDefinition.segments`（velocity segment）と PathRunner を追加し、enemy が spawn tick から path に沿って動き、path を終えて playfield 外の余白を越えた enemy を event なしで取り除く。`pathRunnerState` を serialize / hash / restore に加えて state hash version を 2 にし、restore は spawn から path を進めた結果との完全一致で検証する
- enemy bullet 2A-3 で `fireOnSpawn.velocity` と敵弾の `velocity` / `spawnPosition` / `ageTicks` を追加し、敵弾を生成 tick から動かして playfield 外の余白を越えた敵弾を event なしで取り除く。active 2,000 を超える生成は `enemyBullet.budgetExceeded` の fatal にし、state hash version を 3 にして restore は生成からの等速移動との完全一致で検証する
- deterministic angle 2A-4 で角度を 0.25° 刻みの整数 step とし、生成 script が作る quarter-wave の整数 sine 表から sin / cos・回転・狙いの向きを求め、implementation-approximated な `Math` function と `**` を Core から拒否する test を置く。path segment に sine offset を加え、位置を毎 tick 表から求め直す（state hash は不変）
- PatternProgram 2A-5 で `PatternDefinition.steps`（`wait` / `fire` / `loop`）を load 時に cursor ごとの run へ正規化し、enemy ごとの pattern runner を update enemy behavior / pattern で進めて fireOnSpawn と同じ batch に敵弾を出す。aim は最も近い角度 step にそろえ、1 tick 2,000 命令を fatal の budget とする。runner を `patternRunnerStates` に出力し、restore は run の時刻表から runner と pattern の敵弾を spawn から求め直して検証する（state hash version は 3 のまま）

Next:

- Phase 2A-6: 残機切れの gameOver と、timeline 消化後に active enemy が 0 になった stageCleared を Core で判定して event を出し、終了後の `tick()` を caller precondition error にする。stage status を committed state、serialize / hash DTO、restore 検証へ加える

Phase 1C-1 は診断と出力の安定した契約、Phase 1C-2 は実績ある YAML parser と source span 付き診断の CLI 接続、Phase 1C-3 は静的 fixture と実プロセスの JSON / human golden contract を固定した。Phase 1C-4 は renderer / browser field を含まない headless debug state summary と、summary から値を復元せず deterministic snapshot、順序付き frame event、side 別 input、side status を比較する field-level replay divergence artifact を固定した。

## 設計から実装への対応表

Status legend:

- Done: 実装済みで、対象 test / typecheck が通っている。
- Next: 現在の実装スライスで扱う。
- Queued: 同じ Phase 内の後続スライスで扱う。表では `Queued: Phase 1B-2` のように対象 slice id を併記する。
- Later: 現在 Phase の外へ送る。

| Design section | Task | Status | Implementation | Tests | Command |
| --- | --- | --- | --- | --- | --- |
| `docs/design.md` Core package / API | Core basic の公開 API と package export 境界 | Done | `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/api-types.ts`, `packages/shooting-core/src/basic/index.ts` | `tests/package-boundary.test.mjs`, `tests/public-type-contract/core-api.ts`, `tests/public-type-contract/root-export-exclusions.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Content schema minimum | 最小 `GameDefinition` と registry validation | Done | `packages/shooting-core/src/basic/content/types.ts`, `packages/shooting-core/src/basic/content/validation.ts`, `packages/shooting-core/src/basic/content/validation/*.ts` | `packages/shooting-core/src/basic/content/load-validation.test.ts`, `packages/shooting-core/src/basic/content/load-constraints.test.ts` | `npm test` |
| `docs/design.md` Input / fixed tick | `InputFrame` と tick precondition | Done | `packages/shooting-core/src/basic/input/input-frame.ts`, `packages/shooting-core/src/basic/input/parse-input-frame.ts`, `packages/shooting-core/src/basic/session/stage-session.ts` | `packages/shooting-core/src/basic/session/runtime-input.test.ts` | `npm test` |
| `docs/design.md` Determinism foundation | PRNG、entity id allocator、timeline spawn cursor | Done | `packages/shooting-core/src/basic/session/tick-pipeline.ts`, `packages/shooting-core/src/basic/simulation/stage-timeline-system.ts`, `packages/shooting-core/src/basic/state/committed-state.ts`, `packages/shooting-core/src/basic/simulation/prng.ts`, `packages/shooting-core/src/basic/simulation/entity.ts` | `packages/shooting-core/src/basic/core.test.ts`, `packages/shooting-core/src/basic/session/enemy-timeline-tick.test.ts`, `packages/shooting-core/src/basic/simulation/*.test.ts` | `npm test` |
| `docs/design.md` 7.1 system order | tick system order と entity id tie-breaker の明示 | Done | `packages/shooting-core/src/basic/session/tick-pipeline.ts`, `packages/shooting-core/src/basic/simulation/stage-timeline-system.ts`, `packages/shooting-core/src/basic/simulation/system-order.ts` | `packages/shooting-core/src/basic/simulation/system-order.test.ts`, `packages/shooting-core/src/basic/session/enemy-timeline-tick.test.ts` | `npm test` |
| `docs/design.md` PlayerShot definition | PlayerShot projectile / lifetime と cleanup | Done | `packages/shooting-core/src/basic/content/types.ts`, `packages/shooting-core/src/basic/content/validation.ts`, `packages/shooting-core/src/basic/simulation/player-shot-lifecycle-system.ts` | `packages/shooting-core/src/basic/session/player-tick.test.ts`, `packages/shooting-core/src/basic/simulation/player-shot-lifecycle-system.test.ts` | `npm test` |
| `docs/design.md` PlayerShot fire interval | `fire.intervalTicks` と held 連射 cooldown | Done | `packages/shooting-core/src/basic/content/types.ts`, `packages/shooting-core/src/basic/content/validation.ts`, `packages/shooting-core/src/basic/session/tick-pipeline.ts`, `packages/shooting-core/src/basic/simulation/player-shot-system.ts`, `packages/shooting-core/src/basic/entities/player/model.ts` | `packages/shooting-core/src/basic/session/player-tick.test.ts`, `packages/shooting-core/src/basic/simulation/player-shot-system.test.ts`, `packages/shooting-core/src/basic/entities/runtime-entity.test.ts`, `tests/public-type-contract/content-definitions.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Player movement | player input axes / focus movement / playfield clamp | Done | `packages/shooting-core/src/basic/simulation/player-movement-system.ts`, `packages/shooting-core/src/basic/session/tick-pipeline.ts` | `packages/shooting-core/src/basic/simulation/player-movement-system.test.ts`, `packages/shooting-core/src/basic/session/player-tick.test.ts` | `npm test` |
| `docs/design.md` Enemy bullet fireOnSpawn | PatternDefinition の最小敵弾生成経路、複数 enemy と player shot の同 tick order 固定 | Done | `packages/shooting-core/src/basic/content/types.ts`, `packages/shooting-core/src/basic/content/validation.ts`, `packages/shooting-core/src/basic/events/game-event.ts`, `packages/shooting-core/src/basic/result.ts`, `packages/shooting-core/src/basic/session/tick-pipeline.ts`, `packages/shooting-core/src/basic/simulation/entity.ts`, `packages/shooting-core/src/basic/entities/enemy-bullet/model.ts`, `packages/shooting-core/src/basic/simulation/enemy-bullet-system.ts` | `packages/shooting-core/src/basic/session/enemy-timeline-tick.test.ts`, `packages/shooting-core/src/basic/simulation/entity.test.ts`, `packages/shooting-core/src/basic/entities/runtime-entity.test.ts`, `packages/shooting-core/src/basic/simulation/enemy-bullet-system.test.ts`, `tests/public-type-contract/content-definitions.ts`, `tests/public-type-contract/view-state-events.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Collision / score minimum | MVP collision pair と fixed `scoreOnKill` | Done | `packages/shooting-core/src/basic/session/tick-pipeline.ts`, `packages/shooting-core/src/basic/events/game-event.ts`, `packages/shooting-core/src/basic/simulation/collision-system.ts` | `packages/shooting-core/src/basic/session/collision-scoring-tick.test.ts`, `packages/shooting-core/src/basic/simulation/collision-system.test.ts`, `tests/public-type-contract/view-state-events.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Transactional tick contract | 汎用 working / committed state 境界 | Done | `packages/shooting-core/src/basic/session/stage-session.ts`, `packages/shooting-core/src/basic/session/tick-pipeline.ts`, `packages/shooting-core/src/basic/state/committed-state.ts` | `packages/shooting-core/src/basic/session/transactional-tick.test.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Transactional tick contract | fatal state と fatal 後 `tick()` の error latch | Done | `packages/shooting-core/src/basic/session/stage-session.ts`, `packages/shooting-core/src/basic/result.ts`, `packages/shooting-core/src/basic/testing/testing-hooks.ts` | `packages/shooting-core/src/basic/session/transactional-tick.test.ts`, `packages/shooting-core/src/basic/instrumentation/stage-session-testing-hooks.test.ts`, `tests/public-type-contract/core-api.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | serialized DTO contract | Done | `packages/shooting-core/src/basic/serialization/types.ts`, `packages/shooting-core/src/basic/index.ts` | `tests/public-type-contract/serialized-state.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | serialize minimum | Done | `packages/shooting-core/src/basic/session/stage-session.ts`, `packages/shooting-core/src/basic/state/serialize-projection.ts`, `packages/shooting-core/src/basic/serialization/types.ts` | metadata / field mapping / pendingEvents / empty feature state / deep immutable / fatal 後 error を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | restore API / error boundary | Done | `packages/shooting-core/src/basic/session/loaded-game.ts`, `packages/shooting-core/src/basic/serialization/restore/restore-stage-state.ts`, `packages/shooting-core/src/basic/serialization/restore/top-level-state.ts`, `packages/shooting-core/src/basic/result.ts` | restore method contract、restore error code、version / content / top-level feature mismatch を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | deterministic payload restore shape / registry / runtime budget validation | Done | `packages/shooting-core/src/basic/serialization/restore/deterministic-payload.ts`, `packages/shooting-core/src/basic/serialization/restore/runtime-entities.ts`, `packages/shooting-core/src/basic/entities/restore-common.ts`, `packages/shooting-core/src/basic/entities/*/restore.ts`, `packages/shooting-core/src/basic/serialization/restore/allocation-order.ts`, `packages/shooting-core/src/basic/serialization/restore-plain-data.ts`, `packages/shooting-core/src/basic/content/runtime-budgets.ts`, `packages/shooting-core/src/basic/result.ts` | PRNG snapshot、pending event、runtime entity、registry reference、runtime budget validation を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | accepted committed state 変換準備 | Done | `packages/shooting-core/src/basic/serialization/restore/restore-stage-state.ts` | validated restore DTO を `CommittedStageState` へ変換し、既存 serialize 経路へ通す | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | extension state / JSON guard / feature mismatch | Done | `packages/shooting-core/src/basic/serialization/restore/deterministic-payload.ts`, `packages/shooting-core/src/basic/serialization/restore/top-level-state.ts`, `packages/shooting-core/src/basic/serialization/restore/restore-json.ts` | extension payload guard と feature mismatch 分類を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | transactional restore / roundtrip determinism | Done | `packages/shooting-core/src/basic/session/loaded-game.ts`, `packages/shooting-core/src/basic/serialization/restore/restore-stage-state.ts` | restore 後 serialize / 後続 tick 一致、失敗 restore の transactionality を追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | state hash minimum: `HashableGameState` projection | Done | `packages/shooting-core/src/basic/state/hashable-projection.ts`, `packages/shooting-core/src/basic/hash/hashable-state.ts` | committed state から hash DTO を生成し、public serialize DTO と型結合しない direct projection を固定 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | state hash minimum: canonical encoding / digest | Done | `packages/shooting-core/src/basic/hash/canonical-encoder.ts`, `hashable-game-state-adapter.ts`, `xxhash64.ts`, `state-hash.ts`, `testing/state-hash-comparison.ts` | canonical encoder、adapter、xxHash64、PRNG / game-state digest golden、first divergent tick、gameplay smoke、restore 後の hash 一致を固定 | `npm test`, `npm run typecheck` |
| `docs/design.md` Replay determinism | replay metadata minimum | Done | `packages/shooting-core/src/basic/replay/metadata.ts`, `packages/shooting-core/src/basic/index.ts` | replay file metadata と playback session は作らず、互換性 metadata 型だけ追加 | `npm test`, `npm run typecheck` |
| `docs/design.md` Content validation CLI | output contract | Done | `tools/validate-content/src/types.ts`, `tools/validate-content/src/output.ts`, `tools/validate-content/src/diagnostic-normalization.ts`, `tools/validate-content/src/output-format.ts` | immutable diagnostic、JSON / human formatter、exit code correlation を固定 | `npm test`, `npm run typecheck` |
| `docs/design.md` Content validation CLI | parser / filesystem boundary | Done | `tools/validate-content/src/yaml-source.ts`, `tools/validate-content/src/content-loader.ts`, `tools/validate-content/src/core-diagnostic-adapter.ts`, `tools/validate-content/src/cli.ts`, `tools/validate-content/src/cli-entry.ts` | strict YAML、source span、Core diagnostic mapping、実 filesystem を検証 | `npm test`, `npm run typecheck` |
| `docs/design.md` Content validation CLI | minimum fixture / process golden | Done | `fixtures/game-definition.minimum.yaml`, `fixtures/content-minimum/`, `fixtures/validate-content-golden/`, `tools/validate-content/src/cli-golden.test.ts` | valid / content parse / content・game-definition schema / reference / budget / CLI argument を JSON / human の両形式で固定 | `npm test`, `npm run typecheck` |
| `docs/design.md` Debug state dump | headless dump foundation | Done | `packages/shooting-core/src/basic/instrumentation/debug-state.ts`, `packages/shooting-core/src/basic/testing/debug-state.ts`, `packages/shooting-core/src/basic/session/stage-session.ts`, `packages/shooting-core/src/basic/simulation/collision-system.ts` | immutable checkpoint、失敗 tick 不変、restore seed / nullable metrics、collision count、schema-order JSON、hash error、root export 非公開を固定 | `packages/shooting-core/src/basic/testing/debug-state.test.ts`, `packages/shooting-core/src/basic/simulation/collision-system.test.ts`, `tests/public-type-contract/root-export-exclusions.ts`, `tests/public-type-contract/core-api.ts`; `npm test`, `npm run typecheck` |
| `docs/design.md` 21.4 Golden Test | first divergent checkpoint の replay divergence artifact | Done | `packages/shooting-core/src/basic/testing/replay-trace.ts`, `packages/shooting-core/src/basic/testing/replay-metadata.ts`, `packages/shooting-core/src/basic/testing/replay-diff.ts`, `packages/shooting-core/src/basic/testing/replay-divergence.ts` | `packages/shooting-core/src/basic/testing/replay-divergence.test.ts`, `packages/shooting-core/src/basic/testing/replay-metadata.test.ts`, `tests/public-type-contract/root-export-exclusions.ts` | `npm test`, `npm run typecheck` |
| `docs/design.md` 4 ディレクトリ構成 | module 分割と依存方向 | Done | `packages/shooting-core/src/basic/core.ts`, `packages/shooting-core/src/basic/session/`, `packages/shooting-core/src/basic/state/`, `packages/shooting-core/src/basic/serialization/restore/`, `packages/shooting-core/src/basic/instrumentation/`, `packages/shooting-core/src/basic/shared/`, `packages/shooting-core/src/basic/entities/`, `AGENTS.md` | `tests/module-graph.test.mjs` | `npm test` |
| `docs/design.md` 22 Phase 2A | Core の bare specifier / `node:` / reference directive 禁止 | Done | `tests/module-graph.test.mjs`, `AGENTS.md` | module reference の収集と判定の単体 test、違反を注入した copy で検出を確認 | `npm test` |
| `docs/design.md` 5.2 / 19 Content pipeline | validate-content の Node API と sample app の Vite content plugin | Done | `tools/validate-content/src/index.ts`, `apps/sample-title/vite/`, `apps/sample-title/config/`, `apps/sample-title/content/` | Node API の package boundary / 型契約、既存 CLI golden 不変、sample content の validate-content | `npm run check` |
| `docs/design.md` 5.4 / 7 / 11 Runtime adapter | Vite / Phaser skeleton、固定 tick clock、keyboard input adapter、`GameFrame` からの view 同期 | Done | `apps/sample-title/src/runtime/loop/`, `apps/sample-title/src/runtime/input/`, `apps/sample-title/src/runtime/view/`, `apps/sample-title/src/runtime/phaser/` | tap / catch-up / dropped tick / blur 後の再ラッチ抑止を node:test、app の import rule を `tests/module-graph.test.mjs` で検査 | `npm run check`, `npm run dev` |
| `docs/design.md` 9.8 Path | path movement minimum と `pathRunnerState` | Done | `packages/shooting-core/src/basic/content/`, `packages/shooting-core/src/basic/entities/enemy/`, `packages/shooting-core/src/basic/simulation/` | path golden、restore roundtrip、hash golden 更新 | `npm run check` |
| `docs/design.md` 9.7 / 14 Enemy bullet | enemy bullet movement / cleanup / active 上限 | Done | `packages/shooting-core/src/basic/entities/enemy-bullet/`, `packages/shooting-core/src/basic/simulation/`, `packages/shooting-core/src/basic/content/runtime-budgets.ts` | movement、cleanup、上限超過 fatal、hash golden 更新 | `npm run check` |
| `docs/design.md` 9.8 / 10 決定的角度 | sin / cos 表と `aim: player` の方向計算、path の sine offset | Done | `packages/shooting-core/scripts/generate-sine-table.mjs`, `packages/shooting-core/src/basic/shared/angle-steps.ts`, `packages/shooting-core/src/basic/simulation/`, `packages/shooting-core/src/basic/content/validation/path-shape.ts`, `tests/deterministic-math.test.mjs` | 表の golden entry / checksum / 対称性、回転と狙いの golden、sine offset の位置と restore roundtrip、implementation-approximated な `Math` の拒否 | `npm run check` |
| `docs/design.md` 9.6 / 10 PatternProgram | `wait` / `fire` / `loop` の最小 command subset と pattern runner state | Done | `packages/shooting-core/src/basic/patterns/`, `packages/shooting-core/src/basic/content/validation/pattern-shape.ts`, `packages/shooting-core/src/basic/simulation/enemy-pattern-system.ts`, `packages/shooting-core/src/basic/serialization/restore/pattern-fires.ts` | 3-way golden（弾数、角度、seed 再現性）、runner と時刻表の一致、restore roundtrip と改ざんの拒否、state hash golden、validate-content golden | `npm run check` |
| `docs/design.md` 6 / 20 Stage 終了 | 残機切れと timeline 消化後の全滅による最小終了判定 | Queued: Phase 2A-6 | `packages/shooting-core/src/basic/session/`, `packages/shooting-core/src/basic/state/` | 終了 event、終了後 tick の precondition error、serialize / restore | `npm run check` |
| `docs/design.md` 13 Collision broad phase | 固定 grid と layer 別 collision pair | Queued: Phase 2A-7 | `packages/shooting-core/src/basic/simulation/collision-system.ts` | state hash golden と replay trace の不変 | `npm run check` |
| `docs/design.md` 5.4 / 17 Asset / view pool | manifest entry 検証、仮素材 preload、view pool | Queued: Phase 2A-8 | `tools/validate-content/src/`, `apps/sample-title/src/runtime/assets/`, `apps/sample-title/src/runtime/view/`, `apps/sample-title/public/assets/` | manifest diagnostic golden、pool sizing | `npm run check` |
| `docs/design.md` 5.5 / 6 / 16 Lifecycle / HUD | `GameLifecycleState`、DOM HUD、collision event 演出 | Queued: Phase 2A-9 | `apps/sample-title/src/runtime/lifecycle/`, `apps/sample-title/src/ui/` | lifecycle 遷移と focus lost の扱いを node:test | `npm run check` |
| `docs/design.md` 12 / 19 / 21.5 Scaling / debug | scaling、debug overlay、`BrowserDebugStateDump` | Queued: Phase 2A-10 | `apps/sample-title/src/runtime/`, `apps/sample-title/src/ui/`, `apps/sample-title/src/debug/` | scale 計算を node:test、production build での hook 未定義 | `npm run check` |
| `docs/design.md` 21.6 / 23 Sample stage | サンプルステージ 1 | Queued: Phase 2A-11 | `apps/sample-title/content/` | schema test、headless replay golden | `npm run check` |
| `docs/design.md` 21.5 Browser Test | Playwright の browser smoke と deterministic replay smoke | Queued: Phase 2A-12 | `apps/sample-title/e2e/` | 起動、描画、入力、HUD、overlay、viewport / DPR、replay 一致 | `npm run test:browser` |

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

Phase 1B では fatal latch を固定済みであり、以降は state serialize / restore / state hash と replay metadata minimum の determinism contract を追加する。Replay input list、playback session、optional diagnostics は Phase 1B の外へ分け、ここでは `SerializedGameState` と `ReplayMetadata` の互換性 field として必要な version 情報と未検証 `enabledFeatures` だけを扱う。canonical 性の runtime validation は playback 境界へ送る。

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
   - Done: canonical byte sequence または digest 表記を変え得る変更は `stateHashVersion` を更新する。field order、fixedStruct name、type tag、length / endian、UTF-8 key sort、`-0` 正規化、number encoding、algorithm、seed、hex 表記を対象にし、golden で byte / digest 不変を確認できる内部リファクタだけを例外にする
   - Done: fixedStruct name は `HASHABLE_FIXED_STRUCT_NAME_BY_DTO` で `hashableGameState`、`prngState`、`vector2`、`playerMovement`、`playerRuntimeEntity`、`enemyRuntimeEntity`、`enemyBulletRuntimeEntity`、`playerShotRuntimeEntity`、`pendingEvent`、`patternRunnerState`、`enabledFeatureState` に固定する。field order または struct name を変更するときは `stateHashVersion` を更新する
   - Queued: replay playback 実装は hash 比較を metadata 検証済みの同一 `contentVersion`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId`、canonical `enabledFeatures` 文脈内に限定する。raw `ReplayMetadata` の feature 列は canonical 性を型だけでは保証しないため、未知値、重複、順序違反を拒否した検証済み値だけを比較へ渡す。Phase 1B-7 の metadata-only DTO はこの比較を実行・検証せず、debug artifact 単体では metadata を併記する
   - Done: canonical encoding の対象を `HashableGameState` の単一 DTO に限定する。runtime entity DTO には entity id と component values を一度だけ含め、`entity ids` / `component values` / `runtime entities` を別投影として重ねて encode しない。`ReadonlyGameState` / render-facing `visible` snapshot は hash DTO に含めず encode しない
   - Done: runtime entity の deterministic field projection は `StageSession.serialize()` と state hash で public DTO 型を共有しない。public serialize DTO と `HashableGameState` はそれぞれ runtime state / committed pending event から明示コピーし、hash schema の変更が public snapshot へ漏れないようにする
   - Done: runtime entities は entity id 昇順、pattern runner states は `runnerId` の UTF-8 byte lexicographic order 昇順、enabled feature states は canonical feature order で encode する
   - Done: fixed DTO field order を immutable table fixture と golden test で固定する。`HashableGameState` は `stateHashVersion`, `coreVersion`, `schemaVersion`, `expectedTick`, `nextEntityId`, `timelineCursor`, `prngState`, `score`, `runtimeEntities`, `pendingEvents`, `patternRunnerStates`, `enabledFeatureStates`。nested vector は `fixedStruct("vector2", [x, y])`、player movement は `fixedStruct("playerMovement", [speed, focusSpeed])` として flatten しない。player entity は `id`, `kind`, `definitionId`, `position`, `collisionRadius`, `lives`, `invincibleTicksRemaining`, `nextShotAllowedTick`, `movement`, `shotDefinitionId`。enemy entity は `id`, `kind`, `definitionId`, `position`, `collisionRadius`, `hp`, `scoreOnKill`, `pathId`, `patternId`。enemy bullet は `id`, `kind`, `definitionId`, `position`, `collisionRadius`。player shot は `id`, `kind`, `definitionId`, `position`, `collisionRadius`, `velocity`, `remainingLifetimeTicks`, `damage`。pending event は `type`, `tick`, `stageId`。pattern runner state は `runnerId`, `patternId`, `stateVersion`, `payload`。enabled feature state は `feature`, `stateVersion`, `payload`。この順序を変更するときは `stateHashVersion` も更新する
   - Done: current tick の `GameFrame.events` と drain 済み events は hash 対象外にする。hash 対象にするのは serialize / restore をまたいで残る pending queue だけとする
   - Done: MVP では active pattern runner states と enabled feature states を空配列として encode し、feature 追加時に hash 対象へ入る契約を残す
   - Done: golden smoke fixture は shot 発射、player shot cooldown、敵撃破、score 変化、enemy bullet / player hit、lives 減少、invincibility decrement を通る tick digest を固定する。`entityDestroyed` / `scoreChanged` event と pending event drain は既存 Core event / serialize test で検証し、hash には drain 済み frame event を含めない
   - Done: internal hash helper の export 境界を `packages/shooting-core/src/basic/testing` または test-only internal import に限定する。比較順は初期 pending event を含む hash、tick 後 drain 済み hash、restore 直後 hash、restore 後 tick hash とする
   - Done: emitted `entityDestroyed` / `scoreChanged` events が pending queue drain 後の hash に影響しない golden case を追加する。collision tick の frame event を確認した後に empty pending queue を serialize / restore し、両 session の digest 一致を固定する
   - Done: 同一 seed / input と restore 後 session の state hash が複数 tick で一致する test を追加する
   - Done: Phase 1B は test assertion 内の hash 比較と first divergent tick の最小報告までに留める。entity diff / event diff / PRNG diff artifact、debug state dump、validate-content CLI 連携は Phase 1C で扱う

7. Phase 1B-7: replay metadata 最小実装
   - Done: `ReplayMetadata` の minimum DTO として `coreVersion`、`schemaVersion`、`contentVersion`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId`、未検証 `enabledFeatures`、platform-independent `seed` を定義する。PRNG state hash は独立 field として追加せず、Replay 検証 artifact が必要な場合は Phase 1B-6 の state hash format 内の `prngState` field を使う
   - Done: `ReplayMetadata` は root export し、`tests/public-type-contract.ts` で positive import、exact property type、required readonly field、禁止 key、既知 feature の positive case、`seed` の型を固定する。seed の値域と runtime validation は replay playback 実装時に、`StartStageOptions.seed` と同じ runtime contract で追加する
   - Done: `ReplayMetadata` が共有する互換性 field は `coreVersion`、`schemaVersion`、`contentVersion`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId`、未検証 `enabledFeatures` に限定する。`contentVersion` は title / content pack をまたいで一意な immutable release identity とする。`SerializedGameState` 専用の `stateHashVersion` は snapshot validation 用 field として扱う
   - Done: Phase 1B-7 は metadata-only DTO だけを root export する。`ReplayPlayback` type、入力列 validation、`createReplayPlayback()`、`ReplaySession`、runtime dropped tick diagnostics、full replay の `inputs: InputFrame[]` は root export せず Phase 1B の外に残す
   - Done: `ReplayMetadata` に playback inputs や `RuntimeDroppedTicks` を含めない契約は、Phase 1B では `@ts-expect-error` による type-only negative contract に限定する。runtime guard は replay playback 実装時に追加する

## Phase 1C タスク分割

1. Phase 1C-1: validate-content output contract
   - Done: `tools/validate-content` を独立 workspace package として追加し、Core / sample app から package 境界を分ける
   - Done: `ContentDiagnostic` を kind 別必須 field の discriminated union、`ValidateContentJsonOutput` と severity summary を readonly public contract として固定する
   - Done: exit code と `output.ok` を discriminated union で相関させ、warning / info だけなら exit code 0、validation error は 1、tool/runtime error は 2 とする
   - Done: diagnostic の own enumerable data property を一度だけ snapshot して既知 field へ runtime projection し、accessor、symbol property、unknown kind / severity、不完全な必須 field、validation factory への tool diagnostic 混入を tool error にする。caller-owned object は freeze しない
   - Done: validation factory と tool error factory を型で分離し、formatter へ直接渡された公開 DTO も再 projection、canonical sort、summary 再計算して不整合な `ok` / `summary` を出力しない
   - Done: diagnostic を source / position / kind / severity / code / message の canonical order に並べ、JSON text 全体と human formatter の source / reference context、制御文字 escape を test で固定する
   - Done: root の value / type export allowlist、deep import 拒否、package dependency allowlist、source import と依存宣言の一致を package boundary test で固定する
2. Phase 1C-2: parser / CLI boundary
   - Done: `yaml@2.9.0` を tool package dependency として導入し、strict YAML 1.2 single-document parse、YAML 1.1 directive / non-core tag / duplicate / non-string key / alias rejection、strict UTF-8、source byte / AST node / depth budget、parse error / warning の source span 変換を追加する。MVP では JSON 入力を追加しない
   - Done: game-definition の `contentVersion` と、`content-root` 以下の 1 file 1 definition を Core `GameDefinition` へ組み立てる。collection file と asset key は UTF-8 byte order で canonical に並べる
   - Done: `assets/manifest.yaml` を必須にし、`assets` mapping から Core asset key catalog を生成する。完全な Runtime asset manifest validation は後続 slice へ残す
   - Done: `--game-definition`、`--content-root`、`--format human|json`、`--help` の引数契約、Node filesystem adapter、stdout / stderr、exit code、package bin entry を実装する
   - Done: Core validation error に index 付き `schemaPath` / `referrerId` / `targetId` contextを追加し、schema / reference / feature diagnostic と分割 YAML の正確な source span へ mappingする。contextのないerror / warningはschema pathとroot fallbackで必須fieldを満たす
   - Done: Core の Node 非依存 tsconfig と tool の Node 用 tsconfig を分け、package dependency / source import boundary test を維持する
3. Phase 1C-3: fixture / CLI integration
   - Done: `fixtures/game-definition.minimum.yaml` と `fixtures/content-minimum/` を参照完全な最小 content authoring 契約として追加し、valid、content parse error、content / game-definition schema error、reference error、budget error、CLI argument error の実プロセス CLI integration test を追加する
   - Done: JSON output を CI / editor contract、human output を content authoring contract として `fixtures/validate-content-golden/` に固定する。通常実行は golden を読み取り専用とし、`npm run update-validate-content-goldens` の明示時だけ全 case 検証後に一括再生成する
4. Phase 1C-4: headless debug state dump
   - Done: root package へ公開しない test helper から取得する `HeadlessDebugStateDump` schema を実装する。`tick` は次の input tick、start session の `seed` は文字列、restore session は `null`、entity count は current committed state、event / collision metrics は直前の成功 tick とし、start / restore 直後は未計測の `null`、非fatalな失敗 tickでは直前値を保持し、fatal後はdumpを拒否する
   - Done: collision / event metrics は test serializer 登録sessionでだけ収集し、通常runtimeのtick hot pathではcounter更新とcount object生成を省略する
   - Done: state hash、PRNG hash、固定 key の entity / event count、narrow-phase collision candidate count、portable artifact slug / path、schema 固定順 + 2-space indent + LF の JSON formatter、public `CoreErrorCode` を拡張しない hash encoding failure result を実装する
   - Done: test-only の `recordReplayTraceForTest()` で hook-enabled session の初期 checkpoint と各 tick 後の checkpoint（parse 後 input、`HashableGameState`、state hash、summary dump、順序付き frame event、または error）を記録し、`compareReplayTracesForTest()` で expected / actual の `ok | missing | error` side を checkpoint 順に比較する。state hash が同じ event-only 差分、side 別 input 差分、早期終了、tick 失敗も first divergence として検出する
   - Done: 比較前に raw `ReplayMetadata` を SemVer `coreVersion`、namespace、canonical `enabledFeatures` などで検証し、`coreVersion` の同一 major 不一致は warning、他の version / stage / difficulty / player / feature / seed の不一致は `incompatible` として report を作らない
   - Done: 初期 checkpoint を `frameTick: null` / `checkpointTick: 0`、tick 後を `checkpointTick === frameTick + 1` として trace 構造を検証し、report の field-level diff（input / entity / component / event / PRNG）、schema 順 JSON formatter、`artifacts/replay-divergence/<replayId>-tick-<checkpointTick>.json` の artifact path を実装する
   - Queued: browser runtime dump は`apps/sample-title`がpublic `GameFrame`とruntime adapter stateから作る別schemaとしてPhase 2Aへ分離し、Core内部hash/metricsやdeep importへ依存させない

## Phase 1C-R タスク分割（module 分割リファクタリング）

`core.ts`（3327行）は公開 API 型、hash DTO / field order、stage session / tick pipeline、serialize / hashable projection、restore validation、input parse、testing hook、headless debug を1ファイルに持ち、`core.ts` → `hash/state-hash.ts` → `hash/hashable-game-state-adapter.ts` → `core.ts` の runtime import cycle も抱えている。`core.test.ts`（5350行、108 test）と `tests/public-type-contract.ts`（1449行）も同じく肥大化している。Phase 1C-R では gameplay、public API、state hash、CLI output を一切変えずに、これらを責務単位の module へ分割する。

この節の共通ルールの依存方向と module 表は Phase 1C-R 完了時点の記録である。`internal/` は Phase 1C-S1 で `shared/`、`instrumentation/`、`testing/testing-hooks.ts` へ分解したため、現行の構成と依存方向は Phase 1C-S の節、`AGENTS.md`、`tests/module-graph.test.mjs` を正とする。

共通ルール:

- 1 slice 1 commit とし、各 slice で `npm run check` が通り、state hash golden と validate-content golden が無変更であることを確認する。移動部分は `git diff --color-moved=zebra` で本文不変を確認する
- `index.ts` の value / type export、package boundary test、public type contract の意味を変えない
- 移動した内部 API を `core.ts` から re-export せず、import 元を新 path へ更新する
- 完全に同一の helper だけを統合する。`hasOnlyKeys` と `validateAllowedKeys`、shallow / dense array clone 群、lone surrogate の扱いが異なる UTF-8 encoder、entity id 以外でも絞り込む `findPlayerEntity` と collision の `findPlayer`、package をまたぐ重複は統合しない
- 目安は非 test source 約400行、test 約600行とする。超える場合は責務の混在を確認して分割を検討する
- 依存方向: `core.ts` を import してよいのは `index.ts` と `internal/testing-hooks.ts` だけとし、`hash/` は `state/` / `session/` / `serialization/restore/` を、`state/` は `session/` / `serialization/restore/` を import しない。runtime import cycle を作らない

分割後の shooting-core `src/basic/` 構成:

| Module | 内容 |
| --- | --- |
| `core.ts` | `createShootingCore()` と load facade、内部 test factory |
| `api-types.ts` | `StartStageOptions`、`ReadonlyGameState`、`ReadonlyPlayerState`、`GameFrame`、`ShootingCore`、`LoadedGame`、`StageSession` |
| `session/loaded-game.ts`, `session/start-stage-options.ts` | `startStage()` と `restore()` の委譲、start option parse |
| `session/stage-session.ts`, `session/tick-pipeline.ts` | fatal latch / commit / serialize / debug 登録と、system order に沿った 1 tick pipeline |
| `state/committed-state.ts` | committed / working state、entity / pending event invariant |
| `state/serialize-projection.ts`, `state/hashable-projection.ts` | committed state から public serialize DTO / 内部 hash DTO への projection |
| `content/content-index.ts` | `LoadedContentIndex` |
| `input/parse-input-frame.ts` | `InputFrame` の runtime parse |
| `serialization/metadata.ts` | version 定数、serialization metadata、feature canonical order |
| `serialization/restore/*.ts` | restore orchestration、top-level metadata / compatibility、deterministic payload、runtime entity、kind 別 validator、allocation order、plain data clone guard |
| `hash/hashable-state.ts` | `Hashable*` DTO / field order |
| `internal/guards.ts`, `internal/test-hooks-guard.ts`, `internal/stage-session-testing-hooks.ts`, `internal/debug-state.ts` | 共通 guard、test hook 有効化 guard、session testing hook、headless debug serializer |

1. Phase 1C-R1: hashable state 分離と cycle 解消
   - Done: `Hashable*` 型、field order 型 utility、`HASHABLE_*` 定数を `hash/hashable-state.ts` へ移し、hash module から `core.ts` への import をなくす。`HashableGameState` が参照する `SERIALIZED_STATE_HASH_VERSION` と `SERIALIZED_INPUT_FORMAT_VERSION` は先行して `serialization/metadata.ts` へ移した
   - Done: shooting-core / validate-content の非 test source で runtime import cycle を検出する `tests/module-graph.test.mjs` を追加する。`import type` / `export type` だけを erased edge とし、`import { type X }` は保守的に runtime edge として扱う
2. Phase 1C-R2: leaf module 抽出
   - Done: `core.ts` 内の `error()` alias を同一実装の `coreError()` 呼び出しへ置換し、後続 slice で移す関数本文を移動前後で同一に保てるようにする
   - Done: `internal/guards.ts`、3箇所の test hook 有効化 guard を `purpose` 引数で message を保ったまま統合する `internal/test-hooks-guard.ts`、`input/parse-input-frame.ts`、`session/start-stage-options.ts` を抽出し、`serialization/metadata.ts` へ serialization metadata 型と feature canonical order を寄せる。同一実装の `asRecord`（`content/validation.ts`）と `isPlainObjectContainer`（`serialization/restore-json.ts`）は `internal/guards.ts` の1実装にする
   - Done: `StartStageOptions` の parser が `core.ts` へ型 import を戻さないよう、R3 予定だった型だけの `api-types.ts` を先行して抽出し、`index.ts` と内部 module の型 import 元を切り替える。非 test source で `core.ts` を import するのは `index.ts` と `internal/testing-hooks.ts` だけになった
3. Phase 1C-R3: state model 層
   - Done: committed / working state と invariant を `state/committed-state.ts`、serialize / hash projection を `state/serialize-projection.ts` / `state/hashable-projection.ts`、`LoadedContentIndex` を `content/content-index.ts`、testing hook option / 消費状態 / serialize 時 fault injection / working mutation failure を `internal/stage-session-testing-hooks.ts`、headless debug serializer と metrics 集計を既存の `internal/debug-state.ts` へ移す
   - Done: hash projection は committed state model に依存するため、当初予定の `hash/hashable-projection.ts` / `session/committed-state.ts` / `serialization/serialize-state.ts` ではなく、session より下の model 層 `state/` へ置く。`hash/` は DTO / encoder / digest だけを持ち、`state/` / `session/` を import しない
4. Phase 1C-R4: restore validation 分割
   - Done: restore validation を `serialization/restore/` の7 module へ移す。top-level metadata / compatibility は `top-level-state.ts`、deterministic payload / PRNG / pending event / extension state は `deterministic-payload.ts`、entity 列の検証は `runtime-entities.ts`、kind 別 shape と共通 field は `runtime-entity-kinds.ts`、spawn budget と allocation order は `allocation-order.ts`、top-level / nested plain data clone guard は `plain-data.ts` に置く
   - Done: `LoadedGame.restore()` 内の検証手順を本文そのままで `restore-stage-state.ts` の `restoreStageState()` へ抽出する。restore test hook の呼び出しと stage / player の解決は従来どおり `restore()` 側に残し、error 分類順と hook の呼び出し時点を変えない
5. Phase 1C-R5: session 分割
   - Done: Phase 1C-R5a: `createStageSession` と fatal latch / player lookup helper を `session/stage-session.ts`、`createLoadedGame` を `session/loaded-game.ts` へ移し、`core.ts` を `createShootingCore()` / 内部 test factory / `load()` だけの facade にする
   - Done: Phase 1C-R5b: working state 生成後の system step（timeline spawn、enemy bullet、player shot、movement / lifetime、collision / scoring、PRNG、frame / committed state 構築）を `session/tick-pipeline.ts` の `runStageTick()` へ抽出する。input 検証、tick 照合、committed state 向け test hook、fatal latch、commit、debug metrics は `session/stage-session.ts` に残す。pipeline の結果は `committed` / `fatal` / `rejected` の union とし、fatal latch と rollback 検証 hook の非 fatal 失敗を従来どおり区別する。system 本文は `working.value` / `input.value` / fatal helper 名の置換以外を変えず、golden を含む全 test の不変を確認した
   - Done: `core.ts` が facade だけになったため、対応表で tick / session の実装場所を `core.ts` と記載していた行を `session/` / `state/` の実 module へ更新した
6. Phase 1C-R6: core test 分割
   - Done: Phase 1C-R6a: `core.test.ts` の108 test を本文そのままで、facade smoke（`core.test.ts`）、content load（`content/load-validation.test.ts` / `content/load-constraints.test.ts`）、runtime input・player / enemy・timeline / collision・transactional tick（`session/*.test.ts`）、testing hook（`internal/stage-session-testing-hooks.test.ts`）、serialize / hashable projection（`state/*.test.ts`）、hash schema table（`hash/hashable-state.test.ts`）、restore top-level / payload / runtime entity / roundtrip（`serialization/restore/*.test.ts`）の16 file へ分ける。1 file だけで使う helper はその file に残す
   - Done: Phase 1C-R6a: 複数 file で使う stage 起動 / assert helper、definition factory、InputFrame factory を `src/basic/test-support/` へ置く。root `tsconfig.json` から除外して `tsconfig.test.json` で node 型付きの test code として検査し、validate-content package boundary test と module graph test でも runtime source から除く
   - Done: Phase 1C-R6a: hook を使う test file は `test-support/internal-test-hooks.ts` の `enableInternalTestHooksForTestFile()` で `SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS` を設定し、file 完了後に元の値へ戻す。`testing/debug-state.test.ts` の同等処理もこの helper へ寄せた
   - Done: Phase 1C-R6b: 582行の restore payload test を、valid snapshot / error 検証 helper と player 取得 helper を共有する9 test（PRNG・state container、entity envelope、position descriptor clone、player runtime 値、score・timeline cursor、pending event、pattern runner shape、pattern runner JSON payload、enabled feature state）に分ける。各 assertion 行は本文のまま1回ずつ残した
7. Phase 1C-R7: public type contract 分割
   - Done: `tests/public-type-contract.ts` の266 statement と183 `void` を本文そのままで `tests/public-type-contract/` の root export exclusion / replay metadata / content definition / core API / serialized state / view state・event の6 file へ分ける。file をまたぐ `definition`、`stageId`、`playerId`、`serializedInitialGameState` だけを export / import する
   - Done: `IsExactly` / `AssertTrue` を `tests/support/type-assertions.ts` へ移し、`tests/validate-content-type-contract.ts` と共有する
   - Done: 全 `@ts-expect-error` を無効化した状態の diagnostic multiset が分割前後で一致することを確認し、import 漏れなどで期待と異なる error を握りつぶしていないことを固定した
   - Done: R1 で移動した `HashableGameState` の deep import 確認を `hash/hashable-state.ts` へ更新し、refactoring で生まれた `CommittedStageState`、`StageTickOutcome`、`LoadedContentIndex`、`RestoredStageState` の root 非公開と、`session/stage-session.ts`、`state/committed-state.ts`、`serialization/restore/restore-stage-state.ts` の deep import 拒否を追加する
8. Phase 1C-R8: 二次対象
   - Done: Phase 1C-R8: `content/validation.ts` を `validateGameDefinition()` だけの入口にし、root / content item の shape を `content/validation/shape.ts`、ID 一意性と参照解決を `references.ts`、schema path の付け替えを `schema-path.ts`、汎用 field validator を `fields.ts` へ本文そのままで移す。`content/validation.ts` の path は既存 import と deep import 確認のため維持する
   - Done: Phase 1C-R8: validate-content の collection directory map を `content-collections.ts`、filesystem port / Node adapter / file error を `content-file-system.ts`、schema path から source を引く index を `content-source-index.ts` へ移す。loader / YAML parser / Core adapter に同一内容で重複していた root parse diagnostic、schema diagnostic 生成、default span は `diagnostic-factory.ts` の1実装へ寄せた
   - Done: Phase 1C-R8: `output.test.ts` を result 構築・正規化・順序・tool error の10 test と、JSON / human formatter の6 test（`output-format.test.ts`）へ本文そのままで分ける
   - Later: `canonical-encoder.ts`、`runtime-entity.ts`、`collision-system.ts`、`restore-json.ts`、`yaml-source.ts` は単一責務のため分割しない
   - Done: validate-content の `output.ts`（537行）は Phase 1C-S1 で diagnostic 正規化・比較、result 構築、formatter へ分割した。`normalizeOutputForFormatting()` は公開 factory を一方向に import する formatter 側へ置き、cycle を作らない
9. Phase 1C-R9: guardrail と docs
   - Done: Phase 1C-R9: `tests/module-graph.test.mjs` に、型 import も含めて `core.ts`、`session/`、`serialization/restore/`、`state/` を import してよい module を固定する layer rule test を追加する。`hash/` から `state/` への型 import を注入した copy で違反を検出することを確認した
   - Done: Phase 1C-R9: `AGENTS.md` にファイル規模の目安、shooting-core の依存方向、分割時の注意（re-export shim を作らない、同一 helper だけ統合、`test-support/`、`@ts-expect-error` の diagnostic 確認）を追加する
   - Done: Phase 1C-R9: `docs/design.md` の directory 構成と Core module 構成を実装へ合わせ、対応表の path は各 slice で実 module へ更新済みとした

## Phase 1C-S タスク分割（構造整理リファクタリング）

Phase 1C-R で巨大ファイルは責務単位に分割したが、ディレクトリと依存 layer の対応、および変更の波及範囲に歪みが残っている。`internal/` は最下層の guard / immutable から `core.ts` を import する test factory までを同居させ、layer を持たない。`serialization/restore-json.ts` は restore 層の外にあり、`hash/` が UTF-8 順序比較のためだけにこれを import する。`CommittedPendingEvent` は hash DTO の alias で、committed model が hash DTO に依存している。difficulty の列挙は4箇所で重複している。`session/stage-session.ts` の `tick()` は fault injection を直書きし、`StageTickContext` は content lookup と test hook を同居させ、timeline spawn だけが simulation system になっていない。entity kind の知識は runtime / serialize / hash / restore の層を横断して散在し、player の1 field 追加で非 test source 8 file、`"playerShot"` は14 file に出現する。Phase 2A（敵 path runner、敵弾 velocity / lifetime、pattern runner）と Phase 2B（pickup）の追加が1ディレクトリ内の変更と型検査が示す登録で済むよう、Phase 1C-S では gameplay、public API、state hash、CLI output を一切変えずに構造を整理する。

共通ルール:

- Phase 1C-R の共通ルール（1 slice 1 commit、`npm run check`、state hash / validate-content golden 無変更、`git diff --color-moved=zebra`、re-export shim を作らない、同一 helper だけ統合、サイズ目安）をそのまま適用する
- 移動 commit に本文の変更を混ぜない。新たな `export` 付与と import path 更新だけは changed 行として見えるため review で明記する
- S2 / S3 の各 commit では、hook 付き replay trace を全 test definition で記録した JSON を commit 前後で比較し、state / event / fatal 記録の完全一致を確認する
- 型契約 file に触れる commit では、全 `@ts-expect-error` を無効化した diagnostic を親 commit と比較する

整理後の shooting-core `src/basic/` 構成:

| Module | 内容 |
| --- | --- |
| `shared/` | guard、immutable、UTF-8 順序比較、field order 型 utility。basic 内の他 module を import しない |
| `instrumentation/` | test hook 有効化 guard、session testing hook、headless debug checkpoint。`core.ts` / `session/` / `testing/` だけが import する |
| `testing/` | `testing-hooks.ts`（hook 付き Core factory）と既存の test-only helper |
| `entities/` | kind 横断の kind 一覧 / 共通型 / union、`<kind>/model.ts`（runtime 型・生成・再構築）、`<kind>/snapshot.ts`（public serialize DTO、hash DTO と field order、両 projection）、`<kind>/restore.ts`（key 一覧と検証） |
| `serialization/restore/` | restore orchestration、top-level、deterministic payload、`restore-json.ts`、entity dispatch、allocation order |

1. Phase 1C-S1: 配置の修正（本文は変えない）
   - Done: Phase 1C-S1: `internal/guards.ts` / `internal/immutable.ts` を `shared/` へ移し、`shared/` が basic 内の他 module を型 import も含めて import しない leaf rule を `tests/module-graph.test.mjs` に追加する。import 元22 file は path だけを更新し、specifier 順に並んでいた import はその順序を保つ
   - Done: Phase 1C-S1: 残りの `internal/` を、session へ差し込む `instrumentation/`（`test-hooks-guard.ts`、`stage-session-testing-hooks.ts` と test、`debug-state.ts`）と test-only の `testing/testing-hooks.ts` へ分けて `internal/` を廃止する。`core.ts` を import してよい module を `testing/testing-hooks.ts`、`state/` を import してよい module を `instrumentation/` に更新し、`instrumentation/` を import してよい module を `core.ts` / `session/` / `testing/` に固定する
   - Done: Phase 1C-S1: `serialization/restore-json.ts` の `compareUtf8Lexicographic` と private の `encodeUtf8Bytes` を本文そのままで `shared/utf8-order.ts` へ抽出し、`hash/hashable-game-state-adapter.ts` が restore 用 module を import しないようにする。lone surrogate を throw する `hash/canonical-encoder.ts` の UTF-8 比較とは契約が異なるため統合しない
   - Done: Phase 1C-S1: `restore-json.ts` と test を、唯一の利用者 `deterministic-payload.ts` と同じ `serialization/restore/` へ移す
   - Done: Phase 1C-S1: `CommittedPendingEvent` を `HashablePendingEvent` の alias ではなく `state/committed-state.ts` で明示定義し、committed model から hash DTO への依存をなくす。形が食い違えば `assertNever` を持つ serialize / hash projection が型エラーになる。`hash/` を import してよい module を `state/hashable-projection.ts`、`instrumentation/`、`testing/` に固定する
   - Done: Phase 1C-S1: startStage option、stage content、restore top-level、replay metadata の4箇所で difficulty の error code と message を test で固定してから、`content/types.ts` の `KNOWN_DIFFICULTIES` と型 guard `isKnownDifficulty()` へ列挙を寄せる。各 error message は literal のまま残し、公開型 `Difficulty` は表示名を保つため literal union のまま残し、一覧との一致を型 test で固定する。両者は root export に含めないことを型契約で固定する
   - Done: Phase 1C-S1: validate-content の `output.ts`（537行）を本文そのままで、診断の投影・正規化・順序比較と plain data snapshot（`diagnostic-normalization.ts`、286行）、result 構築と集計（`output.ts`、111行）、JSON / human formatter と `normalizeOutputForFormatting()`（`output-format.ts`、153行）へ分ける。依存は `output-format.ts` → `output.ts` → `diagnostic-normalization.ts` の一方向で、public export と型契約の `src/output.ts` deep import 確認は変えない
   - Done: Phase 1C-S1: hash adapter のコメントが指す versioned table を `hash/hashable-state.ts` に直し、`instrumentation/` が export する内部型 `StageSessionTestingHookOptions`、`ActiveStageSessionTestingHooks`、`HeadlessDebugCheckpoint` の root 非公開を型契約へ追加し、参照のない `containsLoneSurrogate` を削除する。それぞれ個別 commit とする
   - Done: Phase 1C-S1 review: `CommittedPendingEvent` を独立定義したことで失われた DTO との field 集合一致を、serialize / hash projection の `satisfies Required<CommittedPendingEvent>` と戻り値型で型検査に戻す。`tests/module-graph.test.mjs` に rule の path が実在する module を指すことの検査と、`testing/` を非 test source から import させない rule を追加する。さらに shooting-core / validate-content の非 test source が `*.test.ts` と `test-support/` を型 import も含めて import しないことを検査し、1C-R 節の依存方向と module 表が 1C-R 完了時点の記録であることを明記する
   - Done: Phase 1C-S1: `AGENTS.md` の依存方向に `shared/`、`instrumentation/`、`hash/` の rule を加え、`docs/design.md` の directory 構成、Core module 構成、依存方向の段落と、この文書の対応表を新 path へ更新する。1C-4 で追加した replay trace / divergence artifact も `testing/` の説明へ反映する
2. Phase 1C-S2: session / tick pipeline の整理
   - Done: Phase 1C-S2: fault injection の移動前に、pending event 上書きが working state だけに効くこと、input 拒否 tick で committed state hook を消費しないこと、同一 tick の PRNG 破壊と `nextEntityId` 上書きがともに committed state へ入ってから working state を作ること、rollback された tick でも消費済み `nextEntityId` 上書きが committed state に残り再適用されないことを test で固定する
   - Done: Phase 1C-S2: `StageSession.tick()` の committed state fault injection（PRNG 破壊、`nextEntityId` 上書き、working state 向け pending event 上書き）を、`options.testingHooks` を引数名へ置き換える以外は本文そのままで `instrumentation/stage-session-testing-hooks.ts` の `applyCommittedStateFaultsBeforeTick()` へ移す。`tick()` は入力照合 → fault 適用 → working state 生成 → pipeline → commit の順に読める
   - Done: Phase 1C-S2: `loaded-game.ts` の restore / startStage で重複していた `createStageSession()` の context 構築を private helper `createStageSessionFromContent()` へ寄せる。testing hook の消費状態は従来どおり session ごとに、検証と restore snapshot 記録の後で作る
   - Done: Phase 1C-S2: `StageTickContext` を、load 済み content lookup と stage / player の `StageTickContent` と、debug metrics 収集 flag と testing hook の `StageTickInstrumentation` に分け、`runStageTick(working, input, content, instrumentation)` とする。instrumentation は session ごとに1回だけ作り、system 本文は参照元の置き換え以外を変えない
   - Done: Phase 1C-S2: `runStageTick()` に直書きしていた timeline spawn を、他の system と同じく差分を返す純粋関数 `simulation/stage-timeline-system.ts` の `advanceStageTimeline()` へ抽出する。step ごとの採番、`entitySpawned` の順序と内容、cursor の進め方は変えず、pipeline が entity / event / cursor を working state へ反映する。`STAGE_TICK_SYSTEM_ORDER` は design 7.1 の記録として現状のまま残す
   - Done: Phase 1C-S2 review: pipeline に残っていた working mutation fault の消費も `instrumentation/` の `consumeWorkingMutationFailureForTesting()` へ寄せ、pipeline と session が hook の保持形式を知らない形にそろえる。`StageTickContent` の content map 型は `LoadedContentIndex` から導出する
3. Phase 1C-S3: entity kind の縦割り
   - Done: Phase 1C-S3: `tests/module-graph.test.mjs` の `matchesModulePath` を `/` を含まない1 segment の `*` に対応させて matcher の単体 test を置き、shooting-core の非 test source で型 import も含めた import cycle を禁止する（現状 0 件）。stale rule の検査は Phase 1C-S1 review で追加済み
   - Done: Phase 1C-S3: `entities/<kind>/` 配下の module が別 kind の directory を型 import も含めて import しないことを `tests/module-graph.test.mjs` で検査する
   - Done: Phase 1C-S3: `defineFieldOrder` と field 順・field 集合の型 utility を本文そのままで `hash/hashable-state.ts` から `shared/field-order.ts` へ移し、hash DTO 以外の key 一覧でも使える最下層 helper にする
   - Done: Phase 1C-S3: restore の top-level / nested plain data clone guard を本文そのままで `serialization/restore/plain-data.ts` から restore 層の下の `serialization/restore-plain-data.ts` へ移し、import してよい module を `serialization/restore/` に固定する。kind 別 restore validator を `entities/` へ移すときに、restore orchestrator を import せずに使えるようにする
   - Done: Phase 1C-S3: canonical な runtime entity kind 一覧 `RUNTIME_ENTITY_KINDS` と `RuntimeEntityKind` を `entities/entity-kinds.ts` に置き、restore の kind 判定をこの一覧へ寄せる。runtime / 公開 snapshot / serialize DTO / hash DTO の union の kind が一覧と過不足なく一致することを型 test で固定する
   - Done: Phase 1C-S3: `simulation/runtime-entity.ts`（366行）を本文そのままで、kind 別の runtime 型・生成・restore 再構築（`entities/{player,enemy,enemy-bullet,player-shot}/model.ts`）、共通 `Vector2`（`entities/model-common.ts`）、runtime union と公開 `ReadonlyEntityState` / `toReadonlyEntityState()`（`entities/runtime-entity.ts`）へ分け、import 元27 file を名前ごとに新 module へ振り分ける。test は `entities/runtime-entity.test.ts` へ移し、型契約の deep import 確認を `entities/enemy-bullet/model.ts` へ更新する
   - Done: Phase 1C-S3: `serialization/restore/runtime-entity-kinds.ts` を本文そのままで、共通 key・共通 field 検証・vector2 検証と `allocation-order.ts` から移した `isSameRestorePosition()`（`entities/restore-common.ts`）と、kind 別の key 一覧・検証（`entities/{player,enemy,enemy-bullet,player-shot}/restore.ts`）へ分ける。`runtime-entities.ts` の `validateRestoreInitialPlayerEntity()` は `entities/player/restore.ts`、全 kind の key 和集合は唯一の利用者 `runtime-entities.ts` へ移す。`entities/*/restore.ts` は `serialization/restore/` から、`entities/restore-common.ts` はそれと kind 別 restore から、`serialization/restore-plain-data.ts` は restore 層と entities の restore module からだけ import できる layer rule を追加する
   - Done: Phase 1C-S3: public serialize DTO の kind 別型（`Serialized{Player,Enemy,EnemyBullet,PlayerShot}RuntimeEntityState`）と serialize projection の case 本文を本文そのままで `entities/<kind>/snapshot.ts` へ移し、共通の `SerializedVector2` / `SerializedEntityId` / `SerializedRuntimeEntityBase` を `entities/snapshot-common.ts` に置く。public union `SerializedRuntimeEntityState` は `serialization/types.ts`、kind dispatch は `state/serialize-projection.ts` に残す。root export の `SerializedEntityId` は export 元だけが変わり、型は同一。`entities/*/snapshot.ts` を import してよい module を `serialization/types.ts`、`state/`、`hash/`、kind 別 restore に固定する
   - Done: Phase 1C-S3: hash DTO の kind 別型、kind 別 field order（`HASHABLE_<KIND>_RUNTIME_ENTITY_FIELD_ORDER`）、player movement の DTO と field order、hash projection の case 本文を本文そのままで `entities/<kind>/snapshot.ts` へ移し、`HashableVector2` を `entities/snapshot-common.ts` に置く。union、by-kind 表、fixedStruct 名の表、canonical adapter は `hash/` に残し、by-kind 表は kind 別 field order を参照して同じ frozen 配列を組み立てる。`snapshot.ts` は runtime から到達するため `hash/` を import せず、field order helper は `shared/field-order.ts` から使う。state hash golden と全 trace は不変
   - Done: Phase 1C-S3: `Restored*RuntimeEntityInput` を runtime 型の `Omit<…, "kind">` から導出して非公開にし、restore の `Extract<SerializedRuntimeEntityState, …>` 別名を kind 別 DTO の直接参照へ置き換える。restore key 一覧を `defineFieldOrder<公開 DTO, runtime 型>()` で作り、restore key・public DTO・runtime component の3つの field 集合が一致しなければ型エラーにする（値と順序は不変）。全 kind の key 和集合は `Record<RuntimeEntityKind, …>` の表から組み立て、kind 追加時の登録漏れを型エラーにする。debug dump の kind 別件数は `Record<kind, number>` の literal が既に登録漏れを型エラーにするため現状のまま残す。serialize / hash projection は契約が異なるため統合しない
   - Done: Phase 1C-S3: canonical adapter の runtime entity field 値型を `null | boolean | number | string | CanonicalFixedStruct` に絞り、position / velocity / movement のような nested struct を fixedStruct 化し忘れると canonical object として別の byte 列になる誤りを型エラーにする。`RUNTIME_ENTITY_KINDS` の kind ごとに `entities/<kebab-case>/` directory と `model.ts` / `snapshot.ts` / `restore.ts` がそろうことを test で検査し、新しく export した kind 一覧、kind 別 serialized DTO、kind 別 hash field order が root export に含まれないことを型契約へ追加する
   - Done: Phase 1C-S3: `AGENTS.md` に entity kind の配置、union / dispatch の置き場、field 追加 / kind 追加の checklist と entities の layer rule を置き、`docs/design.md` の directory 構成、Core module 構成、依存方向を更新する。player の1 field（`nextShotAllowedTick`）の出現 file は非 test source 8 file（6 directory）から `entities/player/` の3 file と挙動を持つ system の4 file になった。kind 名は dispatch の登録箇所として `"playerShot"` が17 file に現れるが、登録漏れは型検査と test が検出する

## Phase 2A へ進む条件

- Core が Phaser / Vite に依存していない
- sample app が Core の `GameFrame` を読むだけで描画できる
- keyboard input は runtime adapter で `InputFrame` に変換される
- Core event と render-only event が混ざっていない
- Core state hash に render-only state、view id、object pool state が含まれていない
- object pool sizing と performance budget は runtime adapter / performance design 側で扱う

Phase 2A で初期 playable を目標にする。

確認結果（Phase 1C-S 完了時点。`npm run check` は 303 test pass）:

| 条件 | 結果 | 根拠 / 残作業 |
| --- | --- | --- |
| Core が Phaser / Vite に依存していない | 満たす | `packages/shooting-core/package.json` は dependency を持たず、root `tsconfig.json` は `lib: ["ES2024"]`、`types: []` で DOM 型を含めない。ただし `apps/*` の追加で `phaser` / `vite` が root `node_modules` へ hoist されると Core source から bare specifier で解決できるため、Phase 2A-0 で import 制約を test に固定した |
| sample app が Core の `GameFrame` を読むだけで描画できる | 満たす | `GameFrame.state.entities` は kind、definitionId、position を持ち、asset key と collision radius は app が保持する content 定義から definitionId で引ける。自機の focus 状態は app 自身の入力から得る。弾の向きは public state に含まれないため、Phase 2A の仮素材は向きを持たない円形弾にする |
| keyboard input は runtime adapter で `InputFrame` に変換される | Core 側は満たす | `InputFrame` の parse と canonical order は Core にある。adapter は Phase 2A-1 で実装する |
| Core event と render-only event が混ざっていない | 満たす | `GameEvent` は gameplay の事実だけを持つ。`RuntimeEvent` は app 側の別型として定義する |
| Core state hash に render-only state、view id、object pool state が含まれていない | 満たす | `HashableGameState` は committed state だけを投影する |
| object pool sizing と performance budget は runtime adapter / performance design 側で扱う | 設計上満たす | view pool は Phase 2A-8 で runtime adapter に実装する |

## Phase 2A タスク分割（Minimum playable）

Phase 1C-S 完了時点の Core では、`PathDefinition` が id / version だけを持ち、敵は spawn 位置から動かない（最小 fixture の敵は `y=-16` に留まる）。敵弾は velocity と cleanup を持たず、pattern は `fireOnSpawn` だけで、残機が 0 になっても stage は終わらない。collision は Phase 1A の provisional full scan のままで、restore は敵と敵弾の位置が処理済み timeline の spawn 位置と一致することを要求している。validate-content の content loader は public export されておらず `node:path` に依存し、asset manifest は key の shape しか検証しない。Phase 2A では、ブラウザで自機を操作し、3-way 弾幕を撃つ敵を倒して stage の終了まで遊べる初期 playable milestone（design 23）を、Core の determinism contract を保ったまま作る。

決定事項:

- Browser test は Playwright を使う。unit test は既存の node:test を続け、Vitest は導入しない。Core / tools / app の Phaser 非依存 module は Node で TypeScript source を直接実行でき、既存の node:test 49 file は mock や snapshot 機能を使っていないため、移行や2 runner 併存の費用に見合う利点がない。app の unit test が DOM 環境や Vite 固有の変換（`import.meta.env`、virtual module）を必要とした時点で再検討する
- content は dev server / build 時に Vite plugin が validate-content の Node API で検証・組み立て、検証済み `GameDefinition` と asset manifest を virtual module で browser に渡す。browser に YAML parser と filesystem access を持ち込まない
- 残機切れと timeline 消化後の全滅による stage の最小終了判定を Phase 2A の Core に入れる。`clearCondition` / `failCondition` schema は Phase 2B 以降で扱う
- pattern runner state は design 20 どおり `patternRunnerStates` の versioned payload とし、path runner state は enemy runtime entity の `pathRunnerState` field とする
- 仮素材は diff で読める SVG とし、manifest から読み込む
- debug HUD と browser dump には Core 内部の state hash、PRNG hash、collision candidate 数を出さない（design 21.5）。design 19 の HUD 項目は Phase 2A-10 で直す

共通ルール:

- slice は責務ごとの commit に分け、各 commit で `npm run check` を通す。振る舞いを変えない移動と振る舞いを変える変更を同じ commit に混ぜない
- Core の field 追加・kind 追加は `AGENTS.md` の checklist に従い、hash の byte 列が変わる commit で `SERIALIZED_STATE_HASH_VERSION`、hash golden、public 型契約、`docs/design.md` の field order を同時に更新する
- 振る舞いを変えない slice（2A-0、2A-7）は state hash golden と replay trace の不変を完了条件にする
- design 7.1 の system order に substep を足す commit では design も同時に更新し、既存 content の event 順と採番順が変わらないことを golden で確認する
- app の Phaser 非依存 module は node:test で検査し、Phaser / DOM を含む確認は Phase 2A-12 の Browser test に寄せる

推奨順序は 2A-0 → 2A-1 → Core の 2A-2〜2A-7 → app の 2A-8〜2A-10 → 2A-11 → 2A-12 → 2A-13 とする。2A-1 の後は Core と app の slice を交互に進めてよい。2A-11 は 2A-2〜2A-6、2A-12 は 2A-9 / 2A-10 に依存する。

`apps/sample-title/` の構成:

| Path | 内容 |
| --- | --- |
| `config/game-definition.yaml` | sample title の game definition（`contentVersion` を含む plugin / CLI 入力） |
| `content/` | design 4 の種類別 YAML と `assets/manifest.yaml` |
| `public/assets/` | manifest が参照する仮素材 SVG |
| `vite/` | content を検証して virtual module を生成する Vite plugin（Node で実行） |
| `src/runtime/loop/` | 固定 tick clock、catch-up、dropped tick |
| `src/runtime/input/` | keyboard queue、`InputFrame` / `UiInputFrame` 変換、default binding |
| `src/runtime/lifecycle/` | `GameLifecycleState` と遷移 |
| `src/runtime/view/` | entity id 差分からの view spawn / update / destroy 計画と pool sizing |
| `src/runtime/assets/` | manifest path 解決、load 結果、fallback |
| `src/runtime/phaser/` | Phaser Scene、view pool、描画。`phaser` を import してよいのはここと entry だけ |
| `src/ui/` | DOM overlay の HUD、debug HUD、fatal / result 表示 |
| `src/debug/` | `BrowserDebugStateDump` と dev / test build 専用の global hook |
| `e2e/` | Playwright の Browser test |

1. Phase 2A-0: 着手条件の import guard（振る舞いは変えない）
   - Done: `tests/module-graph.test.mjs` に、shooting-core の非 test source が同じ `src/` 配下の module だけを相対 path で import する rule を追加した。import / export 宣言（型だけのものを含む）、`import x = require()`、dynamic `import()`、型位置の `import("...")`、triple-slash reference directive を収集し、bare specifier、`node:`、`src/` の外への相対 path、非 literal の dynamic import、reference directive（`lib="dom"` や `types="node"` で型を持ち込めるため種類を問わない）を拒否する。`apps/*` の追加で `phaser` / `vite` が root `node_modules` へ hoist された後も、Core から解決させない。現状の違反は 0 件
   - Done: 収集と判定を各 import 形式の合成 source で単体 test し、repository の copy に `phaser` の型 import、`node:fs/promises`、`/// <reference lib="dom" />`、`src/` の外への dynamic import を注入して4件とも検出すること、`node:` を import する `test-support/` は対象外のままであることを確認した。`AGENTS.md` と `docs/design.md` の依存方向に rule を追記した
2. Phase 2A-1: walking skeleton（ブラウザで自機が動き、低速移動し、ショットを撃てる）
   - Done: 2A-1a: `apps/sample-title` workspace（`@shooting-sample/sample-title`）を作った。`phaser` 4.2.1 を完全固定の依存、`vite` ^8.3.1 を devDependency、`@shooting-sample/shooting-core` を workspace 依存にし、browser 用 `tsconfig.json`（`lib: ["ES2024", "DOM"]`、`moduleResolution: "Bundler"`、`types: ["vite/client"]`）と Node 用 `tsconfig.node.json`（vite config）を root `typecheck` に加えた。Phaser 4.2.1 同梱の `.d.ts` が TypeScript 6 で内部 error を出すため、browser 用だけ `skipLibCheck` にする（`.ts` source は Core を含めて検査する）。root に `dev` / `build` script を足し、`npm run check` を typecheck → test → build の順にした。Phaser 本体が minify 後に約 1.4 MB の chunk になるため、`chunkSizeWarningLimit` を 1,600 kB にした
   - Done: 2A-1a: entry `src/main.ts` が Core を package root から import して `createShootingCore()` を呼び、`src/runtime/phaser/sample-title-game.ts` が 384x448 の playfield と `coreVersion` を描く。dev server で Phaser 4.2.1（WebGL）が console error なしに 384x448 の canvas を描き、Vite が Core の TypeScript source を bundle できることを確認した
   - Done: 2A-1a: `tests/module-graph.test.mjs` に、sample app の非 test source が `src/` 内の相対 path と `SAMPLE_TITLE_PACKAGE_IMPORT_RULES` の package だけを型 import も含めて import すること（Core は package root だけ、`phaser` は entry と `src/runtime/phaser/` だけ）、`import.meta` を読むのは entry だけであること、rule の path が実在する module を指すことを追加し、app を cycle 検査と test code import 検査の対象に加えた。Phaser 非依存 module の `import.meta.env` 参照は entry 限定の rule で禁止し、DOM global の参照禁止は runtime module を置く 2A-1c で型検査に固定する。Core の deep import、`packages/` への相対 path、`node:`、validate-content、adapter 外の `phaser`、entry 外の `import.meta` を注入した copy で全件の検出を確認した。`AGENTS.md` に sample app の import 規則、README に `npm run dev` を追記した
   - Done: 2A-1b: CLI の load → Core validation → run result の手順（filesystem / 予期しない例外の tool error 分類を含む）を、本文そのままで `game-definition-loader.ts` の `loadValidatedGameDefinitionWith()` へ抽出し、CLI はその結果を format するだけにした。CLI の実プロセス golden は不変
   - Done: 2A-1b: validate-content の public API に `loadValidatedGameDefinition(paths)` と `ValidateContentSourcePaths` / `LoadValidatedGameDefinitionResult` を追加した。exit code 0 のときだけ Core の `load()` を通った `GameDefinition` を呼び出しごとに新しく組み立てて返し、read failure は throw せず exit code 2 の tool error にする。filesystem / loader の差し替え口は非公開のまま残す。package boundary と exact 型契約を更新し、public API が Node の filesystem code に到達するため、validate-content の型契約は node 型のある `tsconfig.test.json` だけで検査する
   - Done: 2A-1b: `apps/sample-title/vite/content-plugin.ts` が dev server / build 時にこの API で `apps/sample-title/config/game-definition.yaml` と `apps/sample-title/content/` を検証し、成功時は `GameDefinition` を default export する `virtual:sample-title/game-definition` を提供する。validation error は human 形式の diagnostic で build を失敗させ、dev server では error overlay に出す。dev server は game-definition と content root の変更で module を無効化して page を再読み込みする。壊した content で build 失敗と overlay 表示、修正後の復帰を確認した
   - Done: 2A-1b: 初期 content として `fixtures/content-minimum/` を `apps/sample-title/content/` へ複製し（Phase 2A-11 で sample stage に差し替える）、`contentVersion` を `sample-title@content.1` にした。entry が virtual module を Core で load して content version を表示する。`npm run check` に `validate-content:sample` を加え、plugin の test（`apps/*/vite/**/*.test.ts`）を `npm test` に含めた。design 19 の sample content 検証の記述を app 配下の path へ更新した
   - Done: 2A-1b: asset manifest の virtual module 化は、manifest entry を検証する Phase 2A-8 へ送る。検証前の manifest を型付きで browser に渡さない
   - Done: 2A-1c: `src/runtime/loop/fixed-tick-clock.ts` の `FixedTickClock` が render frame の delta を tick 単位で積み（ms のまま割ると 50 ms が 2.999... tick に丸まるため）、1 frame の catch-up を 5 tick に制限して、超過分を端数も含めて破棄し `RuntimeDroppedTicks` の合計として数える。`reset()` で停止中の経過時間を捨て、有限でない delta と負の delta は 0 として扱う
   - Done: 2A-1c: `src/runtime/input/key-bindings.ts` に移動方向、gameplay action、UI action（`pause`）の既定 binding を置き、同じ physical key を複数 action に割り当てた binding を拒否する（UI modal を導入するまでは UI action との共有も禁止）。Core の gameplay action 追加時に並びへの追加漏れを型エラーにする
   - Done: 2A-1c: `src/runtime/input/keyboard-input.ts` の `KeyboardInputAdapter` が keydown / keyup を届いた順に反映し、gameplay action の edge を次に実行する tick までラッチする。`sampleTicks(firstTick, count)` は edge を最初の tick だけに入れ、`held` と axes を全 catch-up tick に入れる。tap は `pressed` と `released` に入り `held` に入らない。同じ tick の間に離して押し直した action は Core の `held` / `released` 排他に合わせて `released` から外す。複数 key を割り当てた action は最初の押下と最後の解放だけを edge にする。UI action は `takeUiInput()` の `UiInputFrame` に分ける。`reset()` は全ラッチと key state を捨て、reset 前から押されていた key と、押下を観測していない key の auto-repeat を keyup まで無視する。design 11 にこの edge 規則を追記した
   - Done: 2A-1c: clock、binding、adapter を fake delta / fake keyboard event の node:test で検査し、app content を Core で load した stage session に生成した frame を渡して、全 tick が受理され、ショット生成と自機移動が起き、reset 後は移動しないことを確認した
   - Done: 2A-1c: `src/runtime/` のうち `src/runtime/phaser/` 以外を `tsconfig.runtime.json`（DOM lib と Vite の型なし）で root `typecheck` に加えた。`document`、`window`、`import.meta.env`、DOM の `KeyboardEvent` 型を注入した probe で型 error になることを確認した。adapter は `type` / `code` / `repeat` だけの入力型で keyboard event を受ける
   - Done: 2A-1d: Phaser 非依存の `src/runtime/loop/stage-loop.ts` の `StageLoop` が render frame ごとに clock の tick 数だけ入力を sampling して `tick()` を連番で呼び、直近の frame と入力、その frame の全 event、dropped tick を返す。Core が error を返した tick 以降は session を進めず同じ error を返し続け、`reset()` で clock と入力を捨てる。`src/runtime/view/entity-view-diff.ts` が表示中の view id と `GameFrame.state.entities` から生成・更新・破棄を決め（event からは view を作らない。design 5.4 に追記）、`collision-radii.ts` が content 定義から definition id ごとの collision radius を引く。これらを app content の Core session と fake session で node:test に固定し、複数 test file で使う content load を `src/test-support/` に置いた
   - Done: 2A-1d: `src/runtime/phaser/stage-scene.ts` の `StageScene` が `startStage()` → `StageLoop` → `EntityViews` の同期を回す。keyboard event は Phaser の keyboard plugin を無効にして window から受け、割り当てのある key だけ browser の既定動作を止める。blur と visibility change で loop を reset し、Core の error は stage を止めて表示する。view は kind ごとの仮の円で、自機は判定より大きい本体に、focus 中だけ collision radius の判定を重ねる。敵弾は自機より手前に描く。entry は最初の stage と difficulty を選び、seed は `?seed=` か起動ごとの乱数で決めて画面に出す
   - Done: 2A-1d: 撃てる対象を画面に出すため、sample content の敵の spawn 位置を `y=-16` から `y=96` に、player shot の `lifetimeTicks` を 3 から 60 にし、`contentVersion` を `sample-title@content.2` に上げた（Phase 2A-11 で sample stage に差し替える）
   - Done: 2A-1d: dev server で、連射で敵を撃破して score が 100 になること、低速移動が 1.8 px/tick で進み判定が表示されること、実 key event（`isTrusted`）が adapter に届き割り当てのある key だけ既定動作を止めること、blur 後は押しっぱなしの key で自機が動かないこと、dropped tick が 0 のまま進むことを確認した
   - Done: 2A-1 review: keyboard adapter は reset 後に auto-repeat（`repeat` の keydown）だけを keyup まで無視し、repeat でない keydown は keyup が focus 外で失われていても新しい押下として受け付ける（従来は Alt-Tab 中に離した key の次の押下を捨てていた）。macOS は Meta を押している間ほかの key の keyup を送らないため、`metaKey` の event は入力に使わず押下中の key を keyup まで無視し、割り当てのある key は Cmd+← の履歴移動などを止める。design 11 に規則を追記した
   - Done: 2A-1 review: validate-content CLI は formatter の予期しない例外を再び exit code 2 の tool error にし、`loadValidatedGameDefinition()` は文字列の組でない引数や getter の例外を throw せず `tool.invalidInput` にする。content plugin は `..` で始まる名前の content file を content root 配下と判定し、build 時は content を watch 対象に登録して `vite build --watch` が content の変更と追加で再 build する（実行して確認）
   - Done: 2A-1 review: stage scene は window listener を scene の SHUTDOWN と game の DESTROY の両方で外し、tick が進まなかった render frame では view と status を同期しない。自機判定の円は半径が変わったときだけ作り直す
   - Done: 2A-1 review: import の収集と path の包含判定を `tests/support/module-references.mjs` に置き、module graph test と validate-content の package boundary test で共有する（package boundary test も型位置の import、`import = require`、reference directive、非 literal の dynamic import を検査する）。root tsconfig は Core の source と Core の公開型契約・fixture だけを node 型なしで検査し、node 型が要る型契約は `tsconfig.test.json` に任せる。app の `src/test-support/` を `tsconfig.test.json` に明示し、content plugin の test は content の version ではなく validate-content の出力と比べる
3. Phase 2A-2: 敵の path 移動
   - Done: `PathDefinition` に optional の `segments`（`type: velocity`、`duration`、`velocity`）と `PathSegmentDefinition` を追加し、省略時と空配列は動かない path として既存の `path.none` と互換にした（`schemaVersion` は "1" のまま）。content validation は 64 segment、1 segment 3,600 tick、axis ごとに ±16 px/tick を上限とし（`content/runtime-budgets.ts`）、`offset` など未対応の field と segment type を拒否して、segment index 付きの schema path を返す。path の検証は `content/validation/path-shape.ts` に置いた。validate-content が segment の YAML scalar を指すことを CLI の filesystem test、公開型を型契約で固定した
   - Done: `simulation/path-runner.ts` に PathRunner（segment index、segment 開始位置 `p0`、segment 内経過 tick `t`）を置き、位置を毎 tick `p0 + velocity * t` として求め直して加算誤差を積まない。`resolvePathRunnerAt()` は同じ演算で任意 tick 後の runner と位置を segment 単位で求め、1 tick ずつ進めた結果と一致することを test で固定した
   - Done: enemy runtime entity に `pathRunnerState` を足し、AGENTS.md の field 追加手順で public DTO、hash DTO と field order（`patternId` の後に `enemyPathRunnerState` fixedStruct）、restore key へ加えた。enemy は spawn tick から design 7.1 の update movement で path を進み、`fireOnSpawn` は spawn 位置から撃つ。path を終えて中心が playfield を 64 px の余白より外れた enemy は update lifetime で event を出さずに取り除き、path の途中では取り除かない
   - Done: restore は `pathRunnerState` の shape と segment 数の範囲を検証し、処理済み timeline の spawn 位置から spawn tick 〜 `expectedTick` の tick 数だけ path を進めた runner と位置が完全一致する spawn を選ぶ形へ、「spawn 位置との一致」検証を置き換えた。cleanup されているはずの enemy も拒否する。`SERIALIZED_STATE_HASH_VERSION` を 2 に上げて hash golden と型契約を更新し、restore test の version 不一致例は定数から導出するようにした。path 移動、cleanup、複数時点の restore roundtrip、改ざんした runner の拒否を test で固定し、design 7.1 / 9.8 / 20 を更新した
   - Done: sample content の敵を画面上から降下 → 2 秒停止 → 右上へ抜ける path で動かし（`sample-title@content.3`）、dev server で降下、停止、斜め移動、画面外での消去を確認した
4. Phase 2A-3: 敵弾の movement / cleanup / active 上限
   - Done: `fireOnSpawn` に optional の `velocity` を追加し（省略した敵弾は静止）、swept collision を導入するまでは 1 tick の移動量が自機と敵弾の判定半径の合計（約 7 px）を大きく超えないよう、content validation で axis ごとに ±8 px/tick に制限した。上限、active 2,000、cleanup 余白 32 px は `content/runtime-budgets.ts` に置き restore と共有する
   - Done: enemy bullet runtime entity に `velocity`、`spawnPosition`、`ageTicks` を足し、生成 tick の update movement から `spawnPosition + velocity * ageTicks` で動かす（加算誤差を積まない）。中心が playfield を 32 px の余白より外れた敵弾は update lifetime で event なしで取り除く（`simulation/enemy-bullet-movement-system.ts`）。collision は移動後の位置を使う
   - Done: 生成すると active な敵弾が 2,000 を超える tick は、敵弾を生成せず entity id も消費せず、新しい `CoreErrorCode` の `enemyBullet.budgetExceeded` を `stageSession.fatal` に latch する。この runtime policy を design 14 に記録した
   - Done: 3 field を public DTO、hash DTO と field order（`velocity` と `spawnPosition` は vector2 fixedStruct）、restore key へ加え、`SERIALIZED_STATE_HASH_VERSION` を 3 に上げて hash golden と型契約を更新した。restore は処理済み `fireOnSpawn` と同じ弾・生成位置・速度で、`ageTicks` が生成 tick からの tick 数、`position` が `spawnPosition + velocity * ageTicks` と完全一致する spawn を選び、1 tick 目と現在の位置が cleanup 境界の内側であることで cleanup されずに残る敵弾だけを受け付ける（各座標は tick に対して単調）。2,000 を超える敵弾も拒否する。移動、cleanup、動く敵弾による被弾、restore roundtrip、改ざんや cleanup 済みの敵弾の拒否、上限超過 fatal を test で固定し、design 7.1 / 9.6 / 14 / 20 を更新した
   - Done: sample content の出現時の敵弾を 3 px/tick で下へ撃ち（`sample-title@content.4`）、dev server で敵弾が計算どおりの位置を通って自機に当たり、残機が減ることを確認した
   - Done: pattern 定義の検証は Phase 2A-5 で大きく増えるため、Phase 2A-5 の最初の commit で `content/validation/shape.ts`（400 行）から pattern の検証を `content/validation/pattern-shape.ts` へ振る舞いを変えずに分けた
5. Phase 2A-4: 決定的な角度計算
   - Done: 角度を 1 周 1,440 step（0.25°）の整数で扱い（`shared/angle-steps.ts`）、`angleStepsFromDegrees()` は 0.25° の倍数でない角度を `null` にする。角度を持つ content field（`angleDeg` / `spreadDeg`）は Phase 2A-5 の `fire` と一緒に追加し、そこでこの関数を使って validation する
   - Done: 計画の 1 周 1,440 entry ではなく、0〜90° の 361 entry の quarter-wave 表を置き、90° より先は対称性で広げた（表が 1/4 で済み、sin / cos の対称性が表の丸め誤差に関係なく厳密に成り立つ）。`packages/shooting-core/scripts/generate-sine-table.mjs`（`npm run generate-sine-table`）が `round(sin(step * π / 720) * 2^30)` の整数 literal を `simulation/sine-table.ts` へ生成し、0° / 30° / 90° の端点と単調増加を生成時に検査する。再生成で byte 一致することを確認し、golden entry、checksum、`Math.sin` との誤差、対称性を test で固定した。表の生成方法、解像度、丸め規則は design 10 の「決定的な角度計算」に記録した
   - Done: `simulation/deterministic-trig.ts` に sin / cos、単位 vector、回転、`aim: player` 用の `directionToward()`（差分 vector を `Math.sqrt` で正規化し、同じ位置からは真下）を置いた（Phase 2A-5 で回転と `directionToward()` を、向きを最も近い角度 step にそろえる `angleStepsOfVector()` に置き換えた）。ECMA-262 の本文が `Math.sqrt` を正確な平方根の丸めと定めていることを確認してそのまま使い、`Math.hypot`、三角関数・指数関数、`**`（`Number::exponentiate`）は implementation-approximated なので `tests/deterministic-math.test.mjs` が Core の非 test source から拒否する。AGENTS.md に決定性の規則を追記した
   - Done: path segment に optional の `offset`（`type: sine`、`axis: x | y`、`amplitude` ±256 px、`periodTicks` 1〜3,600 tick）を追加し、位置を `p0 + velocity * t + amplitude * sin(floor(t * 1440 / periodTicks) step)` として毎 tick 求め直す。位相は `segmentElapsedTicks` から整数演算で求まるため `pathRunnerState` と state hash version は変えず、既存の hash golden が変わらないことを確認した。validation、位置の golden、1 tick ずつ進めた結果と `resolvePathRunnerAt()` の一致、波の途中での restore roundtrip を test で固定し、design 9.8 を更新した
   - Done: sample content の敵が停止中に左右 48 px・60 tick 周期で揺れるようにし（`sample-title@content.5`）、Core を headless で進めて、停止区間の x が 144〜240 を往復し、2 周期ちょうどで中央に戻って退場 segment へ連続することを確認した
6. Phase 2A-5: PatternProgram の最小 command subset
   - Done: 最初の commit で pattern の shape validation を `content/validation/pattern-shape.ts` へ振る舞いを変えずに分けた
   - Done: 計画の「`aim: player` は差分 vector を正規化する」から変え、aim の向きを差分 vector に最も近い角度 step へそろえる `angleStepsOfVector()`（表の方向との外積で二分探索し、隣の step と内積を比べる。四則演算と比較だけ）にした。狙いも固定角度も整数 step になり、敵弾の速度は常に表の `(cos, sin) * speed` で各成分が `speed` を超えず、restore が aim の弾の速度を表と照合できる。2A-4 の回転と `directionToward()` は使わなくなったため削除し、design 10 と AGENTS.md を更新した
   - Done: `PatternDefinition.steps` に `wait`、`fire`（`bullet`、`origin: self`、`aim: player` か `angleDeg`、`fan.count` / `fan.spreadDeg`、`speed`）、`loop`（前の step へ戻る）を追加し、`fireOnSpawn` とは排他にした。validation は step 1〜64 個、`wait` 1〜3,600 tick、`fan.count` 1〜64、角度 ±360°（`spreadDeg` は 0〜360）の 0.25° の倍数、`speed` 0 より大きく 8 以下（敵弾の axis 上限と同じ）に制限し、fan の全弾が 0.25° 刻みに載るよう広がりの step 数が 2 と `count - 1` で割り切れることを要求する。`loop` は戻り先から loop までの間に `wait` を含まなければ `definition.invalidConstraint` で拒否し、1 回の run が必ず止まることを保証する。`fire.bullet` の参照も検証し、公開型を型契約で固定した
   - Done: load 時に `patterns/pattern-program.ts` が `steps` を PatternProgram に正規化し、cursor ごとに次の `wait` か末尾までの run（発射命令、弾数、実行命令数、次の cursor と待ち tick 数）を 1 度だけ求める。runner（`patterns/pattern-runner.ts`）は cursor と `waitRemaining` だけを持ち、enemy の spawn tick から design 7.1 の update enemy behavior / pattern で enemy id 順に進む（`simulation/enemy-pattern-system.ts`）。発射元は enemy の移動前の位置、aim は自機の移動前の位置へ向け、敵弾は spawn substep で fireOnSpawn の後に同じ `enemyBulletsSpawnedBatch` へ並べる。runner は enemy が撃破か cleanup でいなくなった tick に破棄し、撃った弾は残す。1 tick に 2,000 命令を超えたら新しい `CoreErrorCode` の `pattern.budgetExceeded` を fatal に latch する（design 14）
   - Done: runner を `patternRunnerStates`（`patternRunner.enemy.<id>`、`stateVersion` 1、payload `{ cursor, waitRemaining }`）として UTF-8 順に serialize / hash へ出力した。hash の byte 列の定義は変わらず、steps を使わない content の hash golden も変わらないため state hash version は 3 のまま。restore は payload を汎用 JSON guard ではなく module の形で厳密に検証し（件数上限は timeline step 数、未対応 version は `state.featureMismatch`）、steps を持つ active enemy ごとにちょうど 1 つの runner が spawn から進めた runner と一致することを要求する。run を始める cursor の列が繰り返しに入ることを使う時刻表（`patterns/pattern-schedule.ts`）で、tick を 1 つずつ進めずに runner と発射を求める
   - Done: pattern の敵弾の restore は、生成 tick に run があり、生成位置がその tick の enemy の path 上の位置と、弾と fan の何発目かが一致する発射を 1 度だけ消費する（`serialization/restore/pattern-fires.ts`）。固定角度の弾は速度の完全一致を要求し、aim の弾は自機の過去の位置が snapshot にないため、表のどれかの向きに `speed` を掛けた速度であることだけを確かめる。撃破された tick は分からないため、enemy がいない spawn の弾も path を終えて cleanup される tick までの発射として受け付ける。同じ tick の採番順（fireOnSpawn、spawn 順、命令順、fan 順）と、撃ち続けた場合の発射数を加えた `nextEntityId` の到達可能性を検証する。restore の採番順は数列の辞書順で比べる形にした
   - Done: 時刻表と 1 tick ずつ進めた runner の一致、batch の順序、aim の向き、runner の破棄、命令数の budget、design 21.6 の 3-way golden（指定 tick の弾数、aim の角度 step、同じ seed での再現と seed によらない弾）、pattern の state hash golden、restore roundtrip と runner / 敵弾の改ざんの拒否を test で固定した。pattern runner の payload の検証 test を pattern 用の restore test へ移し、汎用 JSON payload guard の test は `enabledFeatureStates` で続けて検査する。validate-content の minimum fixture に steps の pattern と `pattern-error` golden（step 内の scalar の位置）を加えた。design 7.1 / 9.6 / 10 / 14 / 20 / 21.3 を更新した
   - Done: sample content の敵を、spawn から 60 tick 後に 40 tick ごと自機狙いの 3-way（30°、3 px/tick）を撃つ `pattern.scout_three_way` にし（`sample-title@content.6`）、Core を headless で進めて発射 tick と途中 12 回の restore を、dev server で 3-way が自機へ向かうことを確認した
7. Phase 2A-6: stage の最小終了判定
   - Queued: 残機切れを gameOver、timeline 消化後に active enemy が 0 になった時点を stageCleared とする判定を Core に入れ、`stageCleared` と gameOver の event を frame に出す
   - Queued: 終了後の `tick()` は design 20 どおり caller precondition error を返し、session を fatal にしない。stage status を committed state、serialize / hash DTO、restore 検証へ加える
8. Phase 2A-7: collision broad phase grid
   - Queued: playfield の固定サイズ grid と layer 別 collision pair（design 13）で候補を絞り込み、full scan を置き換える。collision resolution order と tie-breaker は変えず、既存の state hash golden と replay trace の不変を完了条件にする
   - Queued: headless debug dump の `collisionCandidates` を broad phase 通過 pair 数へ更新し、design 21.5 の定義を直す
9. Phase 2A-8: asset manifest と view pool
   - Queued: validate-content に manifest entry の検証（`type`、`path`、`required`、`usage`、`fallback` の型一致と cycle、`runtime.` built-in）を追加し、diagnostic golden を足す
   - Queued: 仮素材 SVG を `public/assets/` に置き、manifest path を `import.meta.env.BASE_URL` と合成して loading で preload する。`required: true` の load 失敗は stage start を止め、fallback の使用は debug HUD と log に出す
   - Queued: runtime budget（enemy 100、enemy bullet 2,000、player shot 300）から view pool を stage start 前に見積もり、不足は load error にする。spawn / destroy を queue で batch 化して 1 render frame の生成・破棄数に上限を設け、destroyed gameplay entity の view は即 hide / unmap する。枯渇時は `RuntimeEvent.viewPoolExhausted` を出す。`RuntimeEvent` は app 側の型とし、`GameEvent` に混ぜない
10. Phase 2A-9: lifecycle / HUD / collision 演出
    - Queued: `src/runtime/lifecycle/` に `GameLifecycleState` を置き、Phase 2A では `booting`、`loading`、`title`（開始待ちの簡易画面）、`stageStarting`、`playing`、`paused`、`stageCleared`、`gameOver` を使う。`pausedFrom` と、focus lost / visibility change の state 別の扱い（design 6）を node:test で固定する
    - Queued: DOM overlay の HUD に score と lives を `GameFrame.state` から表示する。`playerHit` は無敵中の点滅、`entityDestroyed`（defeated）は render-only の hit spark に変換し、spark は budget 超過時に落としてよい
    - Queued: audio は Phase 2A の対象外とし、browser dump の `audioStatus` は `"muted"` に固定する
11. Phase 2A-10: scaling / debug overlay / browser dump
    - Queued: 内部解像度 384x448 を integer scale と letterbox で表示し、viewport が 384x448 未満のときだけ fractional downscale する。canvas と DOM overlay を同じ CSS transform root に置き、devicePixelRatio は Phaser の renderer 解像度だけに使う。scale 計算は純粋関数として node:test で検査する
    - Queued: debug overlay の切り替えで、content の collision radius による collider 表示と debug HUD（lifecycle、tick、seed、content version、dropped tick、kind 別 entity 数）を出す。design 19 の HUD 項目から state hash、PRNG hash、collision candidate 数、pattern commands / tick を外し、browser へ Core 内部 diagnostics を公開しない方針（design 21.5）に合わせる
    - Queued: `BrowserDebugStateDump`（design 21.5）と `window.__SHOOTING_DEBUG_STATE__()` を dev / test build にだけ置き、production build で未定義であることを検査する
12. Phase 2A-11: サンプルステージ 1
    - Queued: `apps/sample-title/content/stages/stage_01.yaml` に、path で移動する複数 wave、3-way 弾幕、撃破できる HP を持つ敵を定義し、stage clear まで遊べる長さにする
    - Queued: design 21.6 の schema test（stage / enemy / path / pattern / bullet / asset 参照）と、敵撃破・score 加算・3-way を含む headless replay golden を追加する
13. Phase 2A-12: Browser smoke test
    - Queued: Playwright を導入し、`npm test`（node:test）とは別の `test:browser` script で実行する。起動、canvas 非空、キー入力による移動、HUD 更新、debug overlay の切り替えを `BrowserDebugStateDump` で検証する
    - Queued: desktop、mobile 相当、384x448 未満の fractional downscale、resize 後の viewport と、DPR 1 / high DPI での canvas と DOM overlay の座標一致を検証する。screenshot diff は tolerance と mask 付きの補助とする
    - Queued: browser で実際に Core へ渡した `InputFrame` 列を dev / test build 専用の hook で取り出し、Node の headless replay で同じ入力から同じ state hash が得られること、browser dump の tick、entity 数、自機座標と一致することを確認する。hook は dump schema の外に置き、design 21.5 に追記する
14. Phase 2A-13: docs と milestone 確認
    - Queued: `docs/design.md` の directory 構成と Phase 2A の実装状況、この文書の対応表、README の開発コマンド、`AGENTS.md` の app の依存方向を更新する
    - Queued: design 23 の初期マイルストーンの各項目を、対応する test または手動確認手順に対応付けて Phase 2A の完了を判定する

Later（Phase 2A の外）:

- swept circle collision、enemy bullet の `damage`、audio adapter、key config の localStorage 保存と settings migration、gamepad / touch
- content hot reload と Preview scene、Pattern DSL の残りの命令と semantic validation（Phase 2B）
- Core の bullet / shot / event builder の object pool（design 14。負荷が見えた段階で導入する）
- design 25 の docs 分割
