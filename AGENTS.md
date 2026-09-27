# AGENTS.md

## ソースコード検索・調査の方針

このリポジトリでは、通常の文字列検索と AST ベースの構文検索を使い分ける。

### 基本方針

- ファイル名、単純な文字列、ドキュメント、設定値、ログ断片を探すときは、まず `rg` / `rg --files` を使う。
- TypeScript / JavaScript の関数呼び出し、import/export、型定義、class、object literal、特定の構文パターンを探すときは `ast-grep` または `sg` を使う。
- 変更範囲の把握は `rg` で広く見てから、`ast-grep` で構文単位に絞る。
- 一括置換やリファクタでは、単純な文字列置換で壊れやすい箇所を `ast-grep` で事前に確認する。

### ast-grep を優先する場面

- public API の呼び出し元や export 元を構文として確認したい。
- `import type` と通常 import を区別したい。
- 関数名、引数、戻り値、object property など、コードの形に意味がある。
- コメントや文字列リテラル内の偶然の一致を除外したい。
- 同じ構文パターンが複数ファイルに散っていて、レビュー前に漏れを減らしたい。

### 使い分けの例

```sh
# 文字列として速く探す
rg "SerializedGameState" packages tests docs

# TypeScript の import だけを構文として探す
ast-grep --lang ts -p 'import { $$$NAMES } from "$MODULE"' packages tests

# 特定メソッド呼び出しを構文として探す
ast-grep --lang ts -p '$OBJECT.tick($ARG)' packages tests

# 型 alias 定義を構文として探す
ast-grep --lang ts -p 'export type $NAME = $$$TYPE' packages tests
```

### 注意点

- `ast-grep` は構文検索に強いが、対象言語や pattern がずれると結果が出ない。結果が空のときは `rg` でも確認する。
- Markdown、YAML、JSON、設定ファイルの調査は原則 `rg` を使う。
- `ast-grep` の結果で一括修正する前に、対象件数と差分を必ず確認する。
- 既存の未コミット変更を巻き戻さない。検索・調査で見つけた無関係な変更は触らない。

## モジュール構成の方針

### ファイル規模

- 非 test source は約400行、test file は約600行を目安にする。超える場合は責務が混在していないか確認し、責務単位の module へ分割する。
- 単一責務で分割すると読みにくくなる file（例: `hash/canonical-encoder.ts`）は例外として残してよい。
- 分割・移動は振る舞いを変えない commit に分け、`npm run check` と state hash / validate-content の golden が変わらないことを確認する。移動部分は `git diff --color-moved=zebra` で本文不変を確認する。

### 依存方向（`packages/shooting-core/src/basic/`）

- 以下の import 制約は非 test source（`*.test.ts` と `test-support/` 以外）に適用する。非 test source は `*.test.ts` と `test-support/` を型 import も含めて import しない（validate-content も同じ）。
- `packages/shooting-core/src/` の非 test source は同じ `src/` 配下の module だけを相対 path で import する。bare specifier（npm package）、`node:`、`src/` の外への相対 path、非 literal の dynamic import、triple-slash reference directive は型 import も含めて使わない。apps の依存（phaser、vite など）が root `node_modules` にあっても Core から解決させないためで、`tests/module-graph.test.mjs` が検査する。
- `core.ts` は `createShootingCore()` / `load()` の facade とし、import してよいのは `index.ts` と `testing/testing-hooks.ts` だけにする。公開型は `api-types.ts` に置く。
- `session/`（stage session、tick pipeline、loaded game）を import してよいのは `core.ts` だけ。
- `serialization/restore/` を import してよいのは `session/` だけ。
- `state/`（committed state と serialize / hash projection）を import してよいのは `session/`、`serialization/restore/`、`instrumentation/` だけ。
- `instrumentation/`（test hook 有効化 guard、stage session testing hook、headless debug checkpoint）は通常 runtime から到達してよい session の差し込み口で、import してよいのは `core.ts`、`session/`、`testing/` だけ。
- `hash/` は DTO、encoder、digest だけを持ち、上位 layer を import しない。`hash/` を import してよいのは `state/hashable-projection.ts`、`instrumentation/`、`testing/` だけ。
- `shared/`（guard、immutable、UTF-8 順序比較、field order helper）は最下層とし、`src/basic/` 内の他 module を import しない。
- `entities/*/snapshot.ts` を import してよいのは `serialization/types.ts`、`state/`、`hash/`、`entities/*/restore.ts` だけ。`entities/*/restore.ts` は `serialization/restore/` からだけ、`entities/restore-common.ts` はそれと `entities/*/restore.ts` からだけ、`serialization/restore-plain-data.ts` は restore 層と entities の restore module からだけ import する。layer rule の `*` は `/` を含まない1 segment に一致する。
- `entities/<kind>/` の module は別 kind の directory を型 import も含めて import しない。
- `index.ts` から実行時 import で到達する範囲に test / tooling 専用の `hash/` と `testing/` を含めない。`testing/` は非 test source から型 import も含めて import しない。state hash と headless debug dump の digest は test helper 側で計算する。
- runtime import cycle を作らない。`tests/module-graph.test.mjs` が layer rule は型 import も含めて、cycle と到達範囲は実行時 import（`import type` を除く）で検査する。rule に書いた path が実在する module を指すことも同じ test が検査するため、module を移動・改名したら rule も更新する。

### sample app（`apps/sample-title/`）

- `src/` は browser bundle に入る。非 test source は `src/` 内の module を相対 path で import し、package は `tests/module-graph.test.mjs` の `SAMPLE_TITLE_PACKAGE_IMPORT_RULES` に載せたものだけを型 import も含めて import する。Core は package root（`@shooting-sample/shooting-core`）からだけ import し、deep import、`node:`、validate-content は使わない。新しい package が必要なら rule に足す。
- `phaser` を import してよいのは entry の `src/main.ts` と Phaser adapter の `src/runtime/phaser/` だけにする。それ以外の runtime module は Phaser なしで node:test から検査できる形に保つ。`src/runtime/` のうち `src/runtime/phaser/` 以外は `tsconfig.runtime.json`（DOM lib と Vite の型なし）でも型検査するため、DOM global を使わず、`KeyboardEvent` のような DOM の値は必要な field だけの入力型で受ける。
- `import.meta`（`import.meta.env` など Vite 固有の値）と Vite の virtual module（`virtual:sample-title/game-definition`）を読むのは `src/main.ts` だけにし、他の module へは引数で渡す。
- `src/` の依存方向: DOM overlay（`ui/`）、dev / test build 専用の debug hook（`debug/`）、Phaser adapter（`runtime/phaser/`）を import してよいのは entry の `src/main.ts` だけにし、entry がそれらを組み立てて scene へ `HudPort` のような型として渡す。`runtime/` の他の module は DOM と Phaser なしで node:test から検査できる形に保ち、`runtime/debug/` には dump と再生記録を組み立てる純粋関数と型だけを置く。`tests/module-graph.test.mjs` の `SAMPLE_TITLE_LAYER_RULES` が型 import も含めて検査し、`tsconfig.runtime.json` の型検査も DOM の型で止まる。
- canvas と DOM overlay は同じ transform root（`.stage-root`）に入れ、表示の倍率と letterbox は root の transform だけで当てる。devicePixelRatio は canvas を描く解像度にだけ使い、Simulation と view の座標は内部解像度のままにする。
- browser の debug hook（debug state dump の `window.__SHOOTING_DEBUG_STATE__` と再生記録の `window.__SHOOTING_DEBUG_REPLAY__`）は `src/debug/` に置き、`src/main.ts` の `import.meta.env.MODE !== "production"` の分岐からだけ呼ぶ。production の bundle に入らないことは `vite/debug-state-hook-build.test.ts` が build して検査する。
- browser smoke test は `e2e/`（Playwright、`npm run test:browser`）に置き、`npm test` とは分ける。判定は debug hook の dump と再生記録を正本にし、screenshot diff は補助にする。e2e は `src/` の Phaser 非依存の module と `src/test-support/` を import してよく、`tsconfig.e2e.json` で型検査する。画面、入力、HUD、debug hook、viewport に触れたら `npm run test:browser` も通す。
- Vite config と content plugin のように Node で動く code は `src/` の外（`vite.config.ts`、`vite/`）に置き、`tsconfig.node.json` で型検査する。`vite/**/*.test.ts` も `npm test` の対象にする。
- content は build / dev server 時に `vite/content-plugin.ts` が validate-content の `loadValidatedGameDefinition()` で検証する。browser へ YAML parser や filesystem access を持ち込まない。virtual module は `GameDefinition` を default export、検証済みの asset manifest を `assetManifest` として export する。app は validate-content を import しないため、manifest の型は `src/runtime/assets/asset-manifest.ts` に同じ形で置き、content plugin が validate-content の値をこの型へ代入して形のずれを型検査で検出する。
- sample content（`content/`）を変えたら、`src/sample-content/` の test（参照の schema test、敵撃破、stage 1 の headless replay golden）を通す。golden は `UPDATE_SAMPLE_TITLE_GOLDENS=1 npm test` で作り直し、差分（clear の tick、撃破、被弾、3-way の角度）が意図どおりかを確認してから commit する。
- asset は `public/assets/` に置き、manifest の path は base URL からの相対 path にする。Phaser に依存しない loading の判断（`src/runtime/assets/`）と view pool の見積もり・使い回し（`src/runtime/view/`）は node:test で検査し、Phaser の scene はそれを呼ぶだけにする。

### 決定性（`packages/shooting-core/src/`）

- tick に入り得る Core の source は host によって結果が変わる演算を使わない。`Math.sin` / `Math.cos` / `Math.atan2` / `Math.hypot` / `Math.pow` などの implementation-approximated な `Math` function と `**` 演算子は `tests/deterministic-math.test.mjs` が拒否する。`Math.sqrt`、`Math.floor`、`Math.abs`、四則演算は正確なので使ってよい。
- 角度は 0.25° 刻みの整数 step（`shared/angle-steps.ts`）で扱い、sine / cosine / 単位 vector / 狙いの向き（vector に最も近い step）は `simulation/deterministic-trig.ts` を使う。sine 表 `simulation/sine-table.ts` は `npm run generate-sine-table` が生成する正本で、手で編集しない。
- 移動する entity の位置は、生成位置や segment 開始位置から `origin + velocity * t` のように毎 tick 求め直し、tick ごとの加算を積まない。restore はこの式で state が spawn から到達可能かを検証するため、式を変えるときは restore の検証も同じ式にそろえる。
- pattern の命令列は load 時に `patterns/pattern-program.ts` で run を始められる cursor ごとの run へ正規化し、tick の runner（`pattern-runner.ts`）と restore の時刻表（`pattern-schedule.ts`）が同じ run を使う。runner の進め方を変えるときは、時刻表と 1 tick ずつ進めた結果を比べる test で一致を確かめる。DSL の命令を足すときは、load 時に run へ展開できる形にして runner state（cursor と `waitRemaining`）を増やさないことを優先し、1 回の発射の弾の並び（採番順）を restore の割り当て（`serialization/restore/pattern-fires.ts`）と tick の system で同じにする。

### runtime entity kind（`packages/shooting-core/src/basic/entities/`）

- `entities/` 直下は kind 横断の module（`entity-kinds.ts`、`model-common.ts`、`snapshot-common.ts`、`restore-common.ts`、`runtime-entity.ts`）だけにし、サブディレクトリは `RUNTIME_ENTITY_KINDS` の1 kind（kebab-case）に1つ対応させる。
- kind directory は `model.ts`（runtime 型、content からの生成、restore 済み値からの再構築）、`snapshot.ts`（public serialize DTO、hash DTO と canonical field order、serialize / hash projection）、`restore.ts`（受け付ける key 一覧と検証）の3 file を持つ。serialize / hash projection は契約が異なるため本文が同じでも統合しない。
- union と dispatch は関心ごとに1箇所に置く: runtime union と公開 `ReadonlyEntityState` は `entities/runtime-entity.ts`、public serialize union は `serialization/types.ts`、hash union・by-kind field order 表・fixedStruct 名の表は `hash/hashable-state.ts`、canonical encode は `hash/hashable-game-state-adapter.ts`、projection の dispatch は `state/*-projection.ts`、restore の dispatch と全 kind の key 和集合は `serialization/restore/runtime-entities.ts`。同 tick の採番順は kind ではなく tick 順の知識なので `serialization/restore/allocation-order.ts` に置く。
- `snapshot.ts` は通常 runtime から到達するため `hash/` を import しない。field order は `shared/field-order.ts` の `defineFieldOrder` で作る。

field を追加するとき:

1. `<kind>/model.ts` の runtime 型、生成時の初期値、restore 済み値からの再構築に足す。
2. `<kind>/snapshot.ts` の public DTO、hash DTO、hash field order（state hash の byte 契約）、serialize / hash projection に足す。restore key 一覧・public DTO・runtime 型、hash DTO・runtime 型の field 集合がずれると型エラーになる。
3. `<kind>/restore.ts` の key 一覧と検証に足し、startStage の初期値なら初期 snapshot の検証も更新する。
4. position / velocity のような nested struct は `hash/hashable-game-state-adapter.ts` で fixedStruct へ変換する。新しい struct 種別なら `HASHABLE_FIXED_STRUCT_NAME_BY_DTO` と nested field order も足す。変換し忘れは adapter の型検査が検出する。
5. byte 列が変わるので `SERIALIZED_STATE_HASH_VERSION`、hash golden、public 型契約、`docs/design.md` の field order を更新する。

kind を追加するとき:

1. `entities/entity-kinds.ts` の `RUNTIME_ENTITY_KINDS` に足し、`entities/<kind>/{model,snapshot,restore}.ts` を作る（directory と file の過不足は test が検出する）。
2. 型検査が示す union / dispatch へ1件ずつ登録する: `entities/runtime-entity.ts`、`serialization/types.ts`、`hash/hashable-state.ts`（union、by-kind 表、fixedStruct 名）、`hash/hashable-game-state-adapter.ts`、`state/*-projection.ts`、`serialization/restore/runtime-entities.ts`。
3. 生成元と採番順を `serialization/restore/allocation-order.ts` に、挙動を simulation system に足し、event、debug dump schema、型契約、state hash version を更新する。
4. optional feature 由来の entity は basic の union に足さず、`features/<feature>/` で同じ3 file の分担に従う。

### 分割時の注意

- 移動した内部 API を元 file から re-export せず、import 元を新しい path へ更新する。
- 統合するのは完全に同一の helper だけにする。似ているが契約が異なる helper（例: boolean を返す `hasOnlyKeys` と error を積む `validateAllowedKeys`、lone surrogate の扱いが異なる UTF-8 encoder）は統合しない。
- 複数 test file で使う test helper は `src/basic/test-support/`（sample app は `apps/sample-title/src/test-support/`）に置く。Core 内部 test hook を使う test file は `enableInternalTestHooksForTestFile()` で環境変数を設定する。
- `@ts-expect-error` を含む型契約 file を分割・移動するときは、directive を無効化した状態の diagnostic が変わらないことを確認し、import 漏れなど別の error を握りつぶさないようにする。
- 型契約の deep import 確認は exports map で常に error になり path の stale を検出できないため、`tests/package-boundary.test.mjs` が対象 file と export 名の実在を検査する。module を移動したら型契約の path も更新する。
