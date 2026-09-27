# Shooting Sample

汎用的に再利用できる 2D シューティングゲーム基盤の開発プロジェクトです。

最初の設計書は [docs/design.md](docs/design.md) にあります。実装順序は
[docs/implementation-plan.md](docs/implementation-plan.md) で管理します。

現在の状況: Phase 2B（Authoring / content expansion）まで完了した。ブラウザで sample stage 1 を clear まで遊べ、content を YAML で書いて
validate-content の診断と docs（[examples](docs/content-authoring/examples/README.md)、[error guide](docs/content-authoring/error-guide.md)、
[sample content spec](docs/sample-content-spec.md)）で直し、dev server の Preview で単体再生して確かめられる。完了の判定は
[docs/implementation-plan.md](docs/implementation-plan.md) の「Phase 2A 完了判定」と「Phase 2B 完了判定」にある。

現在の方針:

- Core は renderer 非依存の TypeScript package として作る。
- Sample app は Phaser + TypeScript + Vite で作る（`apps/sample-title`）。
- ゲームルールの正本は Phaser ではなく `packages/shooting-core` に置く。
- ステージ、敵、弾幕、弾、アセットは外部データとして定義する。
- 斑鳩や東方のような精密操作と弾幕の読みやすさを重視する。

## 開発コマンド

前提:

- Node.js 24 以上
- npm 11 系
- Node の `--experimental-strip-types` で TypeScript source を直接実行する
- Core の package export は `src/basic/index.ts` を指す source TS export であり、配布用 `dist` はまだ作らない
- workspace package の import 検証を含むため、初回は `npm install` で workspace symlink を作成する
- CI / clean checkout では `npm ci` を使う

```sh
npm install
npm run check
```

`npm run check` は型検査、test、sample app の content 検証、sample app の production build を順に実行する。sample app（`apps/sample-title`、Vite + Phaser）は次で起動する。content は `apps/sample-title/config/game-definition.yaml` と `apps/sample-title/content/` にあり、dev server は変更を検証して page を再読み込みせずに反映する（gameplay の変更は stage を始め直し、sprite の path の変更は texture を読み直し、検証の error は画面の下端に出して古い content のまま動かす。読み込み済みの sprite や view pool に収まらない変更だけ page を読み込み直す）。

```sh
npm run dev
```

sample app の操作:

| 操作 | key |
| --- | --- |
| 移動 | 矢印 key |
| 低速移動（当たり判定を表示） | Shift |
| shot | Z |
| 開始 / title へ戻る | Enter、Space |
| pause | P、Esc |
| debug overlay（collider と debug HUD） | Backquote、F3（dev server では最初から表示） |

URL に `?seed=<文字列>` を付けると、毎回その seed で stage を始める（debug HUD に seed が出る）。`?difficulty=<difficulty>` は stage が持つ difficulty を選ぶ（持たなければ最初の difficulty）。

dev server（と test build）では `?preview` を付けると Preview を開き、stage、enemy（path と pattern を選ぶ）、pattern、path を単体再生する。`?preview=pattern:pattern.gunship_barrage` のように対象を URL で選べる（`stage:<id>`、`enemy:<enemy>,<path>,<pattern>`、`pattern:<id>`、`path:<id>`）。右上の panel で対象、seed、difficulty を選び、R で始め直し、P で pause、pause 中に N で 1 tick 進める。dev-only の cheat として、被弾しても stage が終わらない invincible と、stage の途中の spawn から始める jump も選べる（URL の `invincible=1`、`jump=<tick>`）。paused（URL の `paused=1`）を選ぶと、開始演出の後に tick 0 で止まり、N で 1 tick ずつ進められる。

browser smoke / regression test は Playwright で、`npm test` / `npm run check` とは別に実行する。`vite build --mode test` の bundle を `vite preview`（port 4173）で配って Chromium で試す。Chromium がない環境では先に `npx playwright install chromium` を実行する。screenshot の baseline は platform ごとに `apps/sample-title/e2e/__screenshots__/` に置く。CI（GitHub Actions）も browser test を実行し、Linux の baseline は手動の Browser baselines workflow で作って commit する（commit するまでは CI が baseline のない screenshot を skip して warning を出す）。

```sh
npm run test:browser
```

その他の開発コマンド:

| コマンド | 内容 |
| --- | --- |
| `npm run validate-content:sample` | sample app の content を validate-content の CLI で検証し、JSON で出力する |
| `npm run validate-content -- --game-definition <file> --content-root <dir> --format human` | 任意の content を検証する。content の最小の例は `docs/content-authoring/examples/`、診断の code ごとの説明は `docs/content-authoring/error-guide.md` にある |
| `UPDATE_SAMPLE_TITLE_GOLDENS=1 npm test` | sample stage 1 の headless replay golden を作り直す（差分を確かめてから commit する） |
| `npm run update-validate-content-goldens` | validate-content の CLI golden を作り直す |
| `npm run test:browser -- --update-snapshots` | browser smoke test の screenshot baseline を作り直す（baseline は platform ごと） |
| `npm run generate-sine-table` | Core の決定的な sine 表を生成し直す |
