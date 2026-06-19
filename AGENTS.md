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
