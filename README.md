# Shooting Sample

汎用的に再利用できる 2D シューティングゲーム基盤の開発プロジェクトです。

最初の設計書は [docs/design.md](docs/design.md) にあります。実装順序は
[docs/implementation-plan.md](docs/implementation-plan.md) で管理します。

現在の方針:

- Core は renderer 非依存の TypeScript package として作る。
- Sample app は Phaser + TypeScript + Vite を第一候補にする。
- ゲームルールの正本は Phaser ではなく `packages/shooting-core` に置く。
- ステージ、敵、弾幕、弾、アセットは外部データとして定義する。
- 斑鳩や東方のような精密操作と弾幕の読みやすさを重視する。

## 開発コマンド

前提:

- Node.js 24 以上
- npm 11 系
- Phase 1A では Node の `--experimental-strip-types` で TypeScript source を直接実行する
- Phase 1A の package export は `src/basic/index.ts` を指す source TS export であり、配布用 `dist` はまだ作らない
- workspace package の import 検証を含むため、初回は `npm install` で workspace symlink を作成する
- CI / clean checkout では `npm ci` を使う

```sh
npm install
npm run check
```
