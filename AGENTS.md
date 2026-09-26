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

- 以下の import 制約は非 test source（`*.test.ts` と `test-support/` 以外）に適用する。
- `core.ts` は `createShootingCore()` / `load()` の facade とし、import してよいのは `index.ts` と `testing/testing-hooks.ts` だけにする。公開型は `api-types.ts` に置く。
- `session/`（stage session、tick pipeline、loaded game）を import してよいのは `core.ts` だけ。
- `serialization/restore/` を import してよいのは `session/` だけ。
- `state/`（committed state と serialize / hash projection）を import してよいのは `session/`、`serialization/restore/`、`instrumentation/` だけ。
- `instrumentation/`（test hook 有効化 guard、stage session testing hook、headless debug checkpoint）は通常 runtime から到達してよい session の差し込み口で、import してよいのは `core.ts`、`session/`、`testing/` だけ。
- `hash/` は DTO、encoder、digest だけを持ち、上位 layer を import しない。`hash/` を import してよいのは `state/hashable-projection.ts`、`instrumentation/`、`testing/` だけ。
- `shared/`（guard、immutable、UTF-8 順序比較）は最下層とし、`src/basic/` 内の他 module を import しない。
- `index.ts` から実行時 import で到達する範囲に test / tooling 専用の `hash/` と `testing/` を含めない。state hash と headless debug dump の digest は test helper 側で計算する。
- runtime import cycle を作らない。`tests/module-graph.test.mjs` が layer rule は型 import も含めて、cycle と到達範囲は実行時 import（`import type` を除く）で検査する。

### 分割時の注意

- 移動した内部 API を元 file から re-export せず、import 元を新しい path へ更新する。
- 統合するのは完全に同一の helper だけにする。似ているが契約が異なる helper（例: boolean を返す `hasOnlyKeys` と error を積む `validateAllowedKeys`、lone surrogate の扱いが異なる UTF-8 encoder）は統合しない。
- 複数 test file で使う test helper は `src/basic/test-support/` に置く。Core 内部 test hook を使う test file は `enableInternalTestHooksForTestFile()` で環境変数を設定する。
- `@ts-expect-error` を含む型契約 file を分割・移動するときは、directive を無効化した状態の diagnostic が変わらないことを確認し、import 漏れなど別の error を握りつぶさないようにする。
- 型契約の deep import 確認は exports map で常に error になり path の stale を検出できないため、`tests/package-boundary.test.mjs` が対象 file と export 名の実在を検査する。module を移動したら型契約の path も更新する。
