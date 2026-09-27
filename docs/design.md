# シューティングゲーム基盤 設計書

## 1. 目的

本設計は、縦スクロールまたは固定画面型の 2D シューティングゲームを、複数タイトルへ再利用できる形で開発するための基盤設計である。

目標は以下の通り。

- ゲームルール、描画、入力、UI、データ定義を分離し、保守性を高める。
- ステージ、敵、弾幕、出現タイムラインをコードの外側で定義できるようにする。
- 斑鳩や東方のような、精密操作、弾幕の読みやすさ、演出の気持ちよさを重視する。
- 別タイトルへ流用できる `shooting-core` と、タイトル固有の `content` を分ける。

この設計ではブラウザ向け 2D ゲームを前提に、Phaser + TypeScript + Vite を第一候補とする。ただし、ゲームルールの中核は Phaser に依存させない。

## 2. 設計原則

### 2.1 Source of Truth は Simulation に置く

ゲーム状態の正本は `simulation` が持つ。

- プレイヤー位置、敵状態、弾、スコア、ステージ進行、当たり判定、難易度補正は `simulation` が管理する。
- Phaser の Sprite、Tween、Particle、Camera は描画上の表現であり、ゲーム状態の正本にしない。
- セーブ、リプレイ、デバッグ、テストは `simulation` の状態を対象にする。

### 2.2 Content はデータとして扱う

敵、ステージ、弾幕、ドロップ、会話、BGM、難易度差分は外部データで定義する。

- MVP では YAML を正本とする。JSON 対応は必要になるまで追加しない。
- 読み込み時にスキーマ検証を行う。
- ゲーム内からはファイルパスではなく安定した `id` / manifest key で参照する。
- タイトル固有の内容は `content/` に閉じ込める。

### 2.3 Core はタイトル固有表現を知らない

`shooting-core` は以下を知らない。

- 固有キャラクター名
- 固有ステージ名
- 画像ファイルの実パス
- シナリオ本文
- UI テーマ

Core が扱うのは、抽象化されたプレイヤー、敵、弾、パターン、タイムライン、スコア、入力アクションである。

### 2.4 プレイフィールを仕様として扱う

プレイフィールは後付けの演出ではなく、基盤の仕様として扱う。

- 固定 tick による安定した操作感
- 小さな自機当たり判定
- 見た目と判定の分離
- 弾速、発射間隔、予告、色、レイヤーによる視認性管理
- グレイズ、コンボ、属性切替などを追加できる拡張点
- リプレイ可能な入力記録

## 3. 推奨技術スタック

| 領域 | 推奨 | 理由 |
| --- | --- | --- |
| 言語 | TypeScript | データ定義、状態、イベントを型で守る |
| Core package | TypeScript package | renderer、DOM、Vite に依存しない再利用単位にする |
| Sample app build | Vite | 小さく始めやすく、開発サーバが軽い |
| 2D ランタイム | Phaser | Sprite、Camera、Scene、Asset Loading が揃っている |
| UI | DOM overlay | HUD、設定、ポーズ、リザルトを柔軟に作れる |
| データ | YAML + schema | ステージや敵をコード外で編集でき、コメント付きで調整しやすい |
| テスト | node:test + TypeScript typecheck、Phase 2A から Playwright | Core / tools / app の Phaser 非依存 module は node:test で TypeScript source を直接検証し、Phaser / DOM を含む確認は Playwright の Browser test に寄せる。Vitest は app の unit test が DOM 環境や Vite 固有の変換を必要とするまで導入しない |

## 4. ディレクトリ構成

```text
packages/
  shooting-core/
    src/
      basic/
        content/
        entities/
        events/
        hash/
        input/
        instrumentation/
        replay/
        serialization/
        session/
        shared/
        simulation/
        state/
        testing/
        test-support/
        patterns/
      features/
        pickup/
        bomb/
        graze/
        affinity/
        rank/
        advanced-scoring/
    package.json
tools/
  validate-content/
    src/
    package.json
apps/
  sample-title/
    config/
      game-definition.yaml
    content/
      assets/
        manifest.yaml
      stages/
      enemies/
      bullets/
      player-shots/
      players/
      patterns/
      paths/
      bombs/          # Phase 2B 以降（optional feature の content）
      scoring/
      rank/
      pickups/
      affinities/
    public/
      assets/
    vite/
    e2e/
    src/
      main.ts
      runtime/
        assets/
        audio/
        debug/
        hud/
        input/
        lifecycle/
        loop/
        view/
        phaser/
      ui/
      debug/
      sample-content/
      test-support/
    package.json
docs/
```

実装初期は単一リポジトリ内で進めるが、Core は `packages/shooting-core` として切り出せる境界を維持する。Sample title は `apps/sample-title` に置き、Core から title 固有の asset、UI、シナリオ、テーマを参照しない。

Sample app の module 構成（Phase 2A 完了時点）:

| Path | 内容 |
| --- | --- |
| `config/game-definition.yaml`、`content/` | game definition と種類別の content YAML、asset manifest。validator が受け付けるのは `stages`、`enemies`、`bullets`、`player-shots`、`players`、`patterns`、`paths`、`assets` と、optional feature の `pickups`（Phase 2B-5、`content.features.pickups`）で、ほかは optional feature を入れる slice で足す |
| `public/assets/` | manifest が参照する仮素材の SVG |
| `vite/` | content を validate-content の Node API で検証して virtual module にする Vite plugin と、production build に debug hook が入らないことの test（Node で実行） |
| `src/main.ts` | entry。Core の load、`GameShell`、DOM overlay、viewport、Phaser、debug hook を組み立てる。`import.meta` と virtual module を読むのはここだけ |
| `src/runtime/` | Phaser と DOM に依存しない runtime（loop、input、lifecycle と `GameShell`、view の計画と pool、asset の読み込み判断、HUD の内容、dump と再生記録の組み立て、audio status）。node:test で検査する |
| `src/runtime/phaser/` | Phaser の scene、entity view、演出、render scale。`phaser` を import してよいのはここと entry だけ |
| `src/ui/` | DOM overlay の HUD と viewport への配置 |
| `src/debug/` | dev / test build だけが置く `window.__SHOOTING_DEBUG_STATE__` と `window.__SHOOTING_DEBUG_REPLAY__` |
| `src/sample-content/` | sample content の参照・撃破・headless replay golden の test |
| `src/test-support/` | 複数の test が使う helper（sample の load、fake session と frame、headless replay） |
| `e2e/` | Playwright の browser smoke test |

依存方向は、`ui/`、`debug/`、`runtime/phaser/` を import してよいのは `src/main.ts` だけで、`tests/module-graph.test.mjs` の `SAMPLE_TITLE_LAYER_RULES` が検査する。package の import（Core は root export と、entry だけが optional feature の subpath export、`phaser` は entry と `runtime/phaser/` だけ）は `SAMPLE_TITLE_PACKAGE_IMPORT_RULES` が検査する。

Core package の module 構成（公開 surface は root の `src/basic/index.ts` の export と、optional feature ごとの `./features/<feature>`（`src/features/<feature>/index.ts`）だけで、root の value export は `createShootingCore` のみ）:

```text
packages/shooting-core/src/
  basic/
    index.ts                   root public export
    core.ts                    createShootingCore() / load() facade
    api-types.ts               ShootingCore、LoadedGame、StageSession、GameFrame などの公開型
    result.ts                  CoreResult / CoreError
    content/
      types.ts                 GameDefinition / ContentRegistry
      validation.ts            validateGameDefinition() 入口
      validation/              shape、references、schema-path、fields
      content-index.ts         load 済み content の id lookup
      identifier.ts            namespace id / asset key
      runtime-budgets.ts       playfield と runtime budget
    input/
      input-frame.ts           InputFrame と canonical action order
      parse-input-frame.ts     public API 境界の InputFrame parse
    events/
      game-event.ts            GameEvent と EventLog
    entities/
      entity-kinds.ts          canonical な runtime entity kind 一覧
      runtime-entity.ts        runtime entity union、公開 ReadonlyEntityState と投影
      model-common.ts, snapshot-common.ts, restore-common.ts  kind 横断の座標型、DTO 共通部分、restore 共通検証
      <kind>/                  player / enemy / enemy-bullet / player-shot
        model.ts               runtime 型、content からの生成、restore 済み値からの再構築
        snapshot.ts            public serialize DTO、hash DTO と canonical field order、serialize / hash projection
        restore.ts             restore で受け付ける key 一覧と検証
    simulation/                entity id、PRNG、stage timeline / player / shot / enemy bullet / collision system、system order
    extension/
      feature-module.ts        optional feature の module（FeatureModule）、defineFeature()、ShootingCoreFeature、登録の解決
    session/
      loaded-game.ts           startStage() / restore()
      start-stage-options.ts   StartStageOptions parse
      stage-session.ts         input 照合、fatal latch、commit、serialize、debug 登録
      tick-pipeline.ts         7.1 の system order に沿った 1 tick
    state/
      committed-state.ts       committed / working state と invariant
      serialize-projection.ts  committed state から SerializedGameState
      hashable-projection.ts   committed state から HashableGameState
    serialization/
      types.ts                 SerializedGameState DTO と runtime entity の public union
      metadata.ts              version 定数と serialization metadata
      restore-plain-data.ts    restore 入力の plain data clone guard（restore 層の下に置く）
      restore/                 top-level metadata、deterministic payload、JSON payload guard、runtime entity、allocation order の restore validation
    hash/                      HashableGameState DTO と runtime entity の hash union / by-kind field order / fixedStruct 名、canonical encoder、xxHash64、state hash
    replay/
      metadata.ts              ReplayMetadata
    shared/                    共通 guard、immutable、UTF-8 byte order 比較、field order helper（basic 内の他 module を import しない最下層）
    instrumentation/           test hook 有効化 guard、stage session testing hook、headless debug checkpoint
    testing/                   test-only helper（hook 付き Core factory、headless debug dump、replay trace / divergence artifact、state hash comparison）
    test-support/              test file 共通 helper（package runtime source から除外）
    patterns/                  Phase 2A 以降: PatternProgram runner / commands
  features/                    Phase 2B-5 以降（pickup から）
    <feature>/
      index.ts                 package entry（`@shooting-sample/shooting-core/features/<feature>`）。defineFeature() で作った feature を export する
```

依存方向は `core.ts` → `session/` → `serialization/restore/` / `state/` → 下位 module（`content/`、`simulation/`、`hash/` など）→ `shared/` とし、下位 module から上位 layer を import しない。`instrumentation/` は `core.ts`、`session/`、`testing/` だけが使う session の差し込み口で、通常 runtime から到達してよい。runtime entity は kind ごとに `entities/<kind>/` の model / snapshot / restore へ縦に分け、各 file はそれぞれの layer に属する。`entities/*/snapshot.ts` は `serialization/types.ts`、`state/`、`hash/`、kind 別 restore から、`entities/*/restore.ts` は `serialization/restore/` からだけ使い、kind directory 同士は import しない。非 test source について、`core.ts`、`session/`、`serialization/restore/`、`state/`、`instrumentation/`、`hash/`、`testing/`、`entities/*/snapshot.ts`、`entities/*/restore.ts` を import してよい module と、kind directory 同士が import しないこと、`shared/` が他 module を import しないことは型 import も含めて、runtime import cycle と `index.ts` から `hash/` / `testing/` へ実行時に到達しないことは実行時 import で、`tests/module-graph.test.mjs` が検査する。同じ test は rule の path が実在する module を指すことと、shooting-core / validate-content の非 test source が `*.test.ts` / `test-support/` を import しないこと、shooting-core の非 test source が同じ `src/` 配下の module だけを相対 path で import し、npm package、`node:`、triple-slash reference directive を型 import も含めて使わないことも検査する。state hash と headless debug dump の digest は test helper 側で計算する。

`extension/` は optional feature が basic に差し込む口（Phase 2B-4）で、`content/types.ts`、`content/runtime-budgets.ts`（playfield の大きさ、feature は `extension/playfield.ts` を通して使う）、`content/validation/` の field / schema path / reference の helper（feature は `extension/content-validation.ts` を通して使う）、`entities/runtime-entity.ts` と `events/game-event.ts` と `simulation/entity.ts` の型、`result.ts`、`serialization/types.ts`、`shared/` だけを import し、`core.ts`、`api-types.ts`、`index.ts`、`session/`、`state/`、`serialization/restore/`、`instrumentation/`、`testing/` から使う。basic は `src/features/` を import せず、feature は同じ feature の directory と basic の `extension/`、`shared/`、`result.ts`、`content/types.ts`、`serialization/types.ts` だけを型 import も含めて import し、feature 同士は import しない（`tests/module-graph.test.mjs`）。package の export map は root と、`src/features/` の directory ごとの `./features/<feature>` だけを持つ（`tests/package-boundary.test.mjs`）。

## 5. レイヤー責務

### 5.1 `core/simulation`

ゲームルールの中心。Phaser に依存しない。

主な責務:

- 固定 tick 更新
- Entity の生成と破棄
- 移動、弾、敵 AI、ステージ進行
- 当たり判定
- スコア、残機、ボム、ゲージ
- 難易度補正
- ゲームイベントの発行

### 5.2 `core/content`

外部データから生成された parsed object を検証し、ゲーム内で使える定義へ変換する。

主な責務:

- スキーマ検証
- `id` による定義参照
- バージョン差分の吸収
- タイトル固有 content と core API の接続

YAML の読み込み、ファイル探索、行番号付きエラー整形は `apps/sample-title` または `validate-content` CLI の責務とする。`packages/shooting-core` はファイルシステム、Vite の asset base、ブラウザ fetch に依存しない。`apps/sample-title` は dev server / build 時に Vite plugin から validate-content の Node API を呼んで content を検証・組み立て、検証済み `GameDefinition` と asset manifest だけを browser へ渡す。browser には YAML parser と filesystem access を持ち込まない。

### 5.3 `core/patterns`

弾幕、移動、行動シーケンスを実行する。

主な責務:

- Phase 1A: `fireOnSpawn` schema / registry reference contract（生成処理は simulation system 側）
- Phase 2A: `PatternProgram` command subset の実行
- Phase 2B: DSL parser と semantic validation
- 時間指定、ループ、条件分岐
- 自機狙い、全方位、扇形、列、属性切替などの発射ロジック
- 難易度パラメータの適用

### 5.4 `runtime/phaser`

Simulation の状態を画面に反映するアダプタ。

主な責務:

- Sprite の生成、更新、破棄
- Asset の preload
- Camera、背景、Particle、画面揺れ
- 入力を action に変換して Simulation へ渡す
- `GameFrame.events` を演出へ変換する

Phaser adapter の view lifecycle:

- Simulation entity id と view id の mapping を持つ。
- Sprite、bullet view、effect view は object pool を使う。Pickup feature 有効時は pickup view も pool する（Phase 2B-7 の sample app は Runtime 側で `pickup` の kind の pool を持つ）。
- `GameFrame.events` を直接 Sprite 生成破棄に同期させず、destroy queue / spawn queue に積んで batch update する。gameplay entity の view の生成・破棄は `GameFrame.state.entities` の entity id 差分を正本にし、event は演出にだけ使う。これにより lifetime 切れのように event を伴わない消滅でも view を残さない。
- 1 render frame の view create/destroy に上限を持ち、超過時は低優先度 effect を落として gameplay view を優先する。
- gameplay entity の view は欠落させない。Runtime は content validation と performance budget から stage start 前に pool sizing を見積もり、足りない場合は load error として開始を止める。mid-stage で pool が枯渇した場合、Runtime は `RuntimeEvent.viewPoolExhausted` を出し、dev では hard error、本番では safe pause / fatal overlay に遷移する。
- destroyed gameplay entity の view は destroy queue が遅延しても即時 hide / unmap する。pool への return だけを destroy queue で遅延できる。
- drop や集約を許可するのは particle、afterimage、hit spark などの render-only effect だけとする。
- render-only view state は replay/state hash に含めない。

Phase 2A-8 の sample app の実装:

- loading（`BootScene`）は manifest の sprite を `import.meta.env.BASE_URL` と合成した URL で preload し（`.svg` は SVG として）、design 17 の規則で開始できるかを決めてから stage scene を始める。Phaser は取得の失敗だけを `FILE_LOAD_ERROR` で知らせ、decode できなかった file（dev server が存在しない path に `index.html` を返す場合を含む）は texture に加えずに捨てるため、読み込み後に texture ができていない asset も失敗として扱う。
- view pool の capacity は stage start 前に kind ごとに見積もる（`src/runtime/view/view-pool-plan.ts`）。player は 1、player shot は 1 回の発射で 1 発なので `floor(lifetimeTicks / intervalTicks) + 1`（budget 300 を超える content は load error）、enemy は timeline の spawn 数と budget 100 の小さい方、enemy bullet は timeline の pattern が `steps` を持てば Core の active 上限 2,000、`fireOnSpawn` だけならその spawn 数とする。enemy の退場は path から静的に見積もらないため、spawn 数が 100 を超える stage では同時数が 100 を超えた時点で枯渇する。
- stage scene は pool を 1 render frame あたり 256 個までに抑えて作り終えてから stage を始め、stage 中は image を生成・破棄せずに使い回す。消えた entity の view はその frame で隠して pool へ戻す。pool を使い切ったら `RuntimeEvent.viewPoolExhausted` を log と画面に出して stage を止める（Phase 2A は dev と本番を区別しない）。`RuntimeEvent`（`src/runtime/runtime-event.ts`）は app の型で、`GameEvent` や replay / state hash には含めない。

Phase 2A-9 の sample app の演出:

- 無敵中の自機は `GameFrame.state.player.invincibleTicksRemaining` を 4 tick ごとの区間に分け、残りが少ない側から隠す・表示するを交互に繰り返して点滅させる（`src/runtime/view/invincibility-blink.ts`）。`playerHit` event ではなく state から決めるため、restore した stage や event を取りこぼした frame でも同じ見た目になる。点滅は tick が進む `playing` の間だけにし、`paused` や stage の終了で止まったときは自機を表示する。
- 敵の撃破（`entityDestroyed` の reason `defeated`）は render-only の hit spark にする（`src/runtime/view/hit-sparks.ts`）。`entityDestroyed` は位置を持たないため、撃破された敵を直前に描いた位置に出し、一度も描かずに消えた敵（出現した render frame のうちに撃破された敵など）には出さない。1 render frame に 8 個、同時に 32 個を超える分は gameplay view を優先して落とし、落とした数を debug HUD に出す。寿命 240 ms は render frame の経過時間で数え、`paused` 中は進めない。depth は敵の上、自機の shot・自機・敵弾の下とし、敵弾の読みやすさを邪魔しない（15.3）。

### 5.5 `ui`

DOM overlay として HUD、メニュー、設定、リザルトを担当する。

主な責務:

- スコア、残機、ボム、ゲージ、グレイズ表示
- ポーズ、設定、キーコンフィグ
- ステージ開始/終了、リザルト
- デバッグ HUD

Phase 2A-9 の sample app の実装:

- `src/ui/hud-overlay.ts` が canvas と同じ大きさの箱（`index.html` の `.stage-root`）に DOM overlay を重ね、score、lives、状態の見出し（LOADING と進み具合、title、READY、PAUSED、STAGE CLEAR、GAME OVER）、debug HUD（Core と content の version、lifecycle、audio status、difficulty、seed、tick、dropped tick、asset の fallback、hit spark の drop 数）、loading と runtime の error を出す。overlay は pointer event を canvas へ通し、同じ内容の再描画では DOM を触らない。
- score と lives は `GameFrame.state` を正本にし、event から数え直さない。表示する内容は Phaser と DOM に依存しない `src/runtime/hud/hud-view.ts` の `buildHudView()` が lifecycle と最新の frame から決め、scene は `HudPort` を通して overlay を更新する。`src/runtime/` は `src/ui/` を import しない。
- canvas と overlay は同じ CSS transform root（`.stage-root`）に入れ、scale と letterbox は root の transform でまとめて当てる（12）。debug HUD は debug overlay を表示している間だけ出す（19）。

## 6. Game lifecycle

ゲーム全体の状態遷移は Runtime shell が所有し、Simulation は主に `playing` 中の game state を扱う。`paused`、`title`、`result` などの画面状態は UI/Runtime の責務とする。`GameLifecycleState` は `apps/sample-title/src/runtime/lifecycle/` 側の型であり、Core package の公開 API には含めない。Core は stage session の終了だけを `ReadonlyGameState.status`（`playing` / `stageCleared` / `gameOver`）と `stageCleared` / `gameOver` event で知らせ（Phase 2A-6、design 7.1）、Runtime はそれを見て lifecycle を `stageCleared` / `gameOver` へ進める。

```ts
type GameLifecycleState =
  | "booting"
  | "loading"
  | "title"
  | "stageStarting"
  | "playing"
  | "paused"
  | "stageCleared"
  | "gameOver"
  | "result"
  | "replayPlayback";
```

責務境界:

| State | Owner | 内容 |
| --- | --- | --- |
| `booting` | Runtime | app 初期化、設定読み込み |
| `loading` | Runtime | asset/content 読み込み、manifest 検証 |
| `title` | UI | メニュー、設定、開始選択 |
| `stageStarting` | Runtime + Simulation | stage 初期化、seed 決定、開始演出 |
| `playing` | Simulation | fixed tick 更新、入力、collision、score |
| `paused` | Runtime/UI | Simulation tick 停止、入力ラッチ解除 |
| `stageCleared` | Simulation + UI | clear event、集計、遷移 |
| `gameOver` | Simulation + UI | 残機切れ、continue、遷移 |
| `result` | UI | リザルト表示、保存、次ステージ選択 |
| `replayPlayback` | Runtime + Simulation | 記録済み `InputFrame` の再生 |

`pause` と `playing` / `replayPlayback` 中の focus lost / visibility change は `paused` に遷移させる。Runtime は `pausedFrom` に復帰先 state を保持し、復帰時は `playing` または `replayPlayback` へ戻す。`stageStarting` 中の focus lost / visibility change は開始演出 timer を止め、復帰時に `stageStarting` へ戻す。`loading`、`title`、`stageCleared`、`gameOver`、`result` 中の focus lost / visibility change は lifecycle を変更せず、入力ラッチと accumulator だけを破棄する。

`pause`、ブラウザの focus lost、visibility change が発生した場合、Runtime は accumulator を reset し、未消費の `pressed` / `released` ラッチ、`held`、axis、現在の physical key state をすべて破棄する。復帰時は全キーを up 扱いにし、復帰前から押されている physical key は一度 keyup を観測するまで再ラッチしない。停止中の実時間 delta は Simulation に渡さない。

Phase 2A-9 の sample app の実装:

- `src/runtime/lifecycle/game-lifecycle.ts` の `transitionLifecycle()` が上の遷移を純粋関数として持ち、入力と accumulator を捨てる合図と開始演出 timer を止める合図を返す。Phaser に依存しない `GameShell`（`game-shell.ts`）が UI action、focus lost / visibility change、Core の最終 frame を lifecycle の出来事に変え、合図を入力 adapter、stage loop、timer に実行させる。`result` と `replayPlayback` は型だけを置き、Phase 2A では遷移しない。
- boot scene が asset の読み込みで `loading` を始め、stage scene が view pool を作り終えたら `title` へ進む。`title` の `confirm`（Enter / Space）で `stageStarting` へ進んで stage session を作り、seed を決める（`?seed=` があれば毎回その seed、なければ開始ごとに乱数）。difficulty は `?difficulty=` の値を stage が持っていればそれ、なければ stage の最初の difficulty にする（Phase 2B-3、`src/runtime/lifecycle/stage-difficulty.ts`）。開始演出（READY）は render frame の経過時間で 1,000 ms 続き、その間は tick を実行しない。window の blur か visibility の hidden で focus lost になったら、window の focus（visible に戻ったときは focus を持っていれば）が戻るまで開始演出の timer を止め、戻った最初の frame の経過時間は数えない。window が表示されたまま focus だけを失っても render frame は続くため、1 frame を捨てるだけでは止まらない。
- `playing` 中の `pause`（P / Esc）と focus lost / visibility change で `paused` へ進み、`pause` で `playing` へ戻る。Core が `stageCleared` / `gameOver` の frame を返した render frame で同じ名前の state へ進み、`confirm` で `title` へ戻る（Phase 2A は `result` 画面を置かない）。
- loading を終えて `title` へ進むとき、`stageStarting` へ進むとき、`paused` の出入り、`title` へ戻るときに入力ラッチと accumulator を捨てる。loading 中（stage scene が view pool を作っている間は shell を進めない）に押した UI action は title へ持ち越さず、開始前から押している key は一度離すまで効かない。

## 7. 更新ループ

Core は固定 tick で更新する。

```text
input devices
  -> input actions
  -> simulation tick
  -> game events
  -> renderer sync
  -> HUD sync
```

推奨値:

- Simulation: 60 tick/sec
- Rendering: requestAnimationFrame
- リプレイ: tick ごとの input action を記録

可変 FPS による操作感の揺れを避けるため、当たり判定とゲーム進行は固定 tick に寄せる。

Phaser adapter は `Scene.update(time, delta)` の可変 delta をそのまま Simulation へ渡さない。adapter 側で accumulator を持ち、`1 / 60 sec` ごとに `InputFrame` をサンプリングして `simulation.tick()` を呼ぶ。

catch-up 方針は以下に固定する。

- 1 frame あたりの最大 catch-up は 5 tick。
- 5 tick を超える delta は accumulator に残さず破棄する。
- 破棄した tick 数は `RuntimeDroppedTicks` として optional diagnostics metadata と debug HUD に記録する。headless replay や CI replay では省略できる。
- Simulation の tick 番号は実際に実行した tick だけ進む。
- replay 再生時は記録された `InputFrame` 列だけを使い、実時間 delta や dropped tick を再計算しない。

この方針により、タブ復帰や極端な処理落ちで弾幕や当たり判定が一気に進むことを避ける。完全な長時間停止の再現よりも、実プレイ時の操作感と replay の tick 決定性を優先する。

### 7.1 1 tick の system order

1 tick 内の system 実行順は以下に固定する。

```text
1. apply input
2. update player intent
3. resolve immediate player defensive actions
4. update stage timeline
5. update enemy behavior / pattern
6. spawn bullets / player shots
7. update movement
8. update lifetime
9. broad phase collision
10. narrow phase collision
11. collision resolution
12. scoring
13. cleanup destroyed entities
14. build immutable GameFrame
```

system order は replay determinism の一部として扱い、Core の major version が変わらない限り変更しない。変更が必要な場合は replay compatibility policy に従う。

`spawn bullets / player shots` の内訳は以下に固定する。

1. Stage timeline で同 tick に生成された enemy の `fireOnSpawn` を timeline order に従って解決し、続けて `update enemy behavior / pattern` で pattern runner が撃つと決めた弾を runner の enemy id 昇順（同じ enemy の中は命令順、fan 順）に並べ、1 つの `enemyBulletsSpawnedBatch` として生成する。
2. player の `pressed` / `held` shot intent を `fire.intervalTicks` で間引き、`playerShotsSpawnedBatch` を生成する。

したがって同 tick に enemy spawn、enemy bullet、player shot が重なる場合の spawn substep 内 event order は `entitySpawned`、`enemyBulletsSpawnedBatch`、`playerShotsSpawnedBatch` とする。collision / scoring が発生する場合は、その後に `playerHit`、`entityDestroyed`、`scoreChanged` を collision resolution order で追加し、stage が終わる tick はその後に `stageCleared` か `gameOver` を 1 つ出し、最後に `tickAdvanced` を出す。
tick 0 の `stageStarted` は system order 外の pending lifecycle event として frame 先頭に drain される。

`update enemy behavior / pattern` では、`steps` を持つ pattern の enemy ごとの pattern runner を enemy id 昇順に 1 tick 進める（Phase 2A-5）。runner は enemy を spawn した tick の timeline 処理で作り、その tick から進める。発射元はその tick の移動前の enemy 位置、`aim: player` はその tick の移動前の自機位置へ向ける。runner は enemy が撃破か cleanup でいなくなった tick の `cleanup destroyed entities` で破棄し、撃った弾は残す。

`update movement` では player を入力で、enemy を path で、enemy bullet を velocity で、player shot を projectile 定義で進める。敵弾の生成位置は spawn substep で決まるため、spawn tick に path で動いた enemy でも `fireOnSpawn` は spawn 位置を基準にし、生成した敵弾はその tick から動く。`update lifetime` では寿命の切れた player shot、path を終えて cleanup 境界の外にいる enemy、cleanup 境界の外に出た enemy bullet を event なしで取り除く。

`cleanup destroyed entities` の後に stage の終了を判定する（Phase 2A-6、`simulation/stage-status.ts`）。自機の残機が 0 なら `gameOver`、timeline をすべて処理して active な enemy がいなければ `stageCleared` とし、同じ tick に両方が成り立てば `gameOver` を優先する。敵弾が残っていても `stageCleared` にし、timeline が空の stage は tick 0 の終わりに `stageCleared` になる。判定結果は `GameFrame.state.status` と committed state の `stageStatus` に入り、終わった tick の frame が stage の最後の frame になる。

Rank feature が有効な場合だけ step 12 に rank update、Phase 2B の Pickup feature が有効な場合だけ step 12 に pickup の生成（その tick に撃破した enemy の drops）、回収と pickup score を追加する（Phase 2B-6。撃破と同じ tick に出すため、step 6 ではなく scoring で生成する）。feature 追加分も登録順と entity id 昇順で安定化し、Core minimum の system order を暗黙に変更しない。feature の system は step 6 の後（`spawn`）と step 12（`scoring`、basic の scoring の後で cleanup の前）で canonical feature order に実行し、feature が採番する id は同じ tick の basic の採番の後に来る。timeline を処理し終えて enemy がいなくなっても、feature が entity を残す間（回収されていない pickup）は stageCleared にしない。

Bomb が有効な title では、`resolve immediate player defensive actions` で bomb cost、無敵付与、弾消し予約を処理する。同 tick に bomb 入力と player hit が重なった場合、bomb の無敵付与と弾消しを player hit 判定より先に適用する。

## 8. Entity 設計

Entity は軽量な ID と component の集合として扱う。巨大な継承階層は避ける。

代表 component:

| Component | 内容 |
| --- | --- |
| `Transform` | 位置、速度、角度 |
| `Collider` | 判定形状、半径、属性 |
| `Renderable` | 表示 asset key、layer、animation key |
| `Health` | HP、無敵時間、撃破イベント |
| `Lifetime` | 生存 tick、時間切れ破棄 |
| `Bullet` | 弾種、威力、消滅条件、所有者 |
| `Enemy` | enemy definition id、現在の行動 state |
| `Player` | 自機状態、ボム、ゲージ、低速移動 |
| `Pickup` | 回収アイテム、スコア、効果。Phase 2B で導入 |

Entity id は Core が単調増加で採番する。1 stage 中は再利用しない。`restore()` 時は `nextEntityId` も復元し、event order と collision tie-break が replay で変化しないようにする。

## 9. Content 定義

### 9.1 Stage 定義例

Phase 1A の Core minimum が受け付ける最小 schema は以下とする。

```yaml
id: stage.stage_01
version: 1
difficulties:
  - normal
timeline:
  - tick: 60
    action:
      type: spawnEnemy
      enemy: enemy.scout
      path: path.none
      pattern: pattern.none
      position: { x: 192, y: -16 }
```

次の例は Phase 2 以降の authoring schema 案であり、Phase 1A の validator ではまだ受け付けない。

```yaml
id: stage.stage_01
title: "First Contact"
version: 1
music: bgm.stage01
background: bg.space_near
durationTicks: 7200
difficulty:
  normal:
    difficultyMultiplier: 1.0
  hard:
    difficultyMultiplier: 1.25
timeline:
  - at: 120
    spawn:
      enemy: enemy.scout
      position: { x: 160, y: -32 }
      path: path.down_sine
  - at: 360
    wave:
      enemy: enemy.scout
      count: 5
      interval: 24
      positions:
        type: line
        from: { x: 80, y: -32 }
        to: { x: 240, y: -32 }
  - at: 1800
    boss:
      enemy: enemy.boss_01
      position: { x: 160, y: 80 }
clearCondition:
  type: bossDefeated
  enemy: enemy.boss_01
failCondition:
  type: playerLivesZero
```

`clearCondition` は `timelineComplete`、`bossDefeated`、`surviveTicks`、`allEnemiesDefeated` を組み合わせられる。Boss stage の例では、ボス未撃破のまま `timelineComplete` だけで clear しないよう `bossDefeated` を単独条件にする。`all` を使う場合は、撃破時に stage timeline を completed 扱いにするなど、早期撃破後の空待ちを避ける rule を明記する。`failCondition` は `playerLivesZero`、`timeExpired`、`objectiveFailed`、`bossTimedOut` を扱う。Boss timeout は stage ごとに clear または fail のどちらかへ明示的に接続し、終端不能な stage を validation error にする。timeout による phase transition は MVP では扱わない。

### 9.2 Player 定義例

Player も content として定義し、自機性能を Core 外から調整できるようにする。

```yaml
id: player.default
version: 1
asset: player.default
collision:
  radius: 3
movement:
  speed: 4.0
  focusSpeed: 1.8
life:
  initialLives: 3
  invincibleTicksAfterHit: 120
shot:
  definition: playerShot.basic
```

`life.initialLives` は開始時の残機で 1 以上の整数とし、無敵中でない被弾ごとに 1 減る。残機が 0 になった tick で stage は gameOver として終わる（Phase 2A-6、design 7.1）。MVP の basic `PlayerDefinition` は `graze` と `bomb` field を持たない。Basic core validator は未知 field として拒否し、feature module schema 導入後だけ `graze.radius` / `graze.oncePerBullet` や `bomb.definition` を許可する。Bomb module 有効時でも bomb 未所持の自機を表したい場合は feature schema 側で `bomb.definition: null` を許可するが、この null 契約は basic schema へ持ち込まない。

Player movement は `InputFrame.axes` を intent として扱い、`focus` held 中は `focusSpeed`、それ以外は `speed` を使う。低速移動の意味を守るため `focusSpeed <= speed` を content validation で要求し、MVP では `speed` / `focusSpeed` ともに `16` 以下に制限する。斜め入力は通常移動より速くならないよう正規化し、自機中心は playfield の `x=0..384`、`y=0..448` 内へ clamp する。Shot 生成は system order に従って movement 前の player position を使い、同じ tick の `GameFrame.state` では player が movement 後の position になる。

### 9.3 PlayerShot 定義例

敵弾と自機弾は同じ `BulletDefinition` に寄せず、発射元と用途を分ける。敵弾は `content/bullets/`、自機ショットは `content/player-shots/` で管理する。

```yaml
id: playerShot.basic
version: 1
asset: shot.player_basic
collision:
  radius: 3
damage: 8
fire:
  intervalTicks: 3
projectile:
  velocity: { x: 0, y: -9.0 }
  lifetimeTicks: 90
```

Phase 1A の validator が受け付ける PlayerShot schema は上記の最小形である。`fire.intervalTicks` は同じ shot definition から次に発射できるまでの tick 間隔であり、`pressed` は初弾の edge、`held` は interval に従う連射 intent として扱う。発射可能条件は `input.tick >= nextShotAllowedTick` とし、発射後は `nextShotAllowedTick = firedTick + fire.intervalTicks` に更新する。同一 tick で `pressed` と `held` の両方に `shot` が含まれていても生成する batch は 1 つだけとする。発射後は Player runtime component に `nextShotAllowedTick` を保持し、renderer が読む `GameFrame.state` の public snapshot には出さない。一方で replay resume 用の `SerializedRuntimeEntityState` と state hash には含める。MVP では過剰な entity 生成を避けるため `1 <= fire.intervalTicks <= 60` に制限する。

`lifetimeTicks` は生成 tick を含めて `GameFrame.state.entities` に残る tick 数を表す。生成 tick でも `velocity` による movement は適用するが、lifetime decrement は次 tick から開始する。MVP では active player shot budget を守るため `lifetimeTicks <= 300`、`velocity.x/y` は `-64` から `64` の範囲に制限する。

レーザー、貫通弾、オプション弾は `PlayerShotDefinition` の `type` と `projectile` 拡張で扱う。Core は `owner: player` / `owner: enemy` を entity component に持たせ、collision pair で判定対象を分ける。高速な player shot は `collisionMode: swept` または laser/beam 用の segment 判定を使う。`collisionMode: discrete` を許す場合は content validation で 1 tick の移動量上限を検証し、敵 hitbox をすり抜ける速度を禁止する。

将来拡張の `fire.origins`、`projectile.pierce`、`collisionMode` は Phase 1A の schema には含めない。`pierce` は追加貫通回数である。`pierce: 0` は 1 体に命中したら destroyed、`pierce: 1` は 2 体目まで命中できる。Player shot は 1 tick 内で同一 enemy に 1 回だけ damage を与える。命中後、remaining pierce を 1 減らし、命中前の remaining pierce が 0 だった場合はその命中解決後に destroyed とする。Laser / beam は segment ごとの hit set を持ち、同一 tick の同一 enemy 多段 hit を禁止する。

### 9.4 Bomb 定義例

Bomb は `content/bombs/` で管理し、無敵、弾消し、ダメージ、スコア変化を明示する。Bomb は Phase 3 の拡張機能であり、MVP の collision pair には含めない。

```yaml
id: bomb.default
version: 1
asset: fx.bomb.default
cost: 1
inventory:
  initialBombs: 3
  maxBombs: 3
  refill:
    type: none
invincibleTicks: 180
effects:
  - type: clearBullets
    target: enemyBullet
    radius: fullScreen
    scorePerBullet: 10
  - type: damageEnemies
    damage: 240
    radius: fullScreen
  - type: emitEvent
    event: bombUsed
```

`BombEffect` は deterministic に解決する。無敵付与と弾消しは player hit 判定より先、敵ダメージとスコア加算は collision resolution 後の scoring phase で処理する。Bomb module 有効時は Player state に `bombCount` を持ち、stage start 時に `initialBombs`、上限に `maxBombs` を使う。`refill.type: pickup` は Pickup feature も有効な場合だけ許可し、Pickup feature 無効時は `refill.type: none` または fixed event refill のみ許可する。

### 9.5 Enemy 定義例

```yaml
id: enemy.scout
version: 1
asset: enemy.scout
hp: 40
score: 1200
collision:
  hitbox:
    shape: circle
    radius: 12
  contactbox:
    shape: circle
    radius: 10
movement:
  initialVelocity: { x: 0, y: 1.5 }
behavior:
  pattern: pattern.scout_three_way
  startAt: 30
  loop: true
```

上の例は authoring schema 案である。Phase 2A の Core と validate-content が受け付ける enemy は `id`、`version`、`asset`、`collision.radius`、`hp`、`score` だけで、移動と弾幕は enemy に持たせず、stage timeline の `spawnEnemy` が spawn ごとに `path`（`content/paths/`）と `pattern`（`content/patterns/`）を組み合わせる。同じ enemy を wave ごとに別の動きと弾幕で出せる形で、enemy が既定の movement / behavior を持つ形は Phase 2B 以降で検討する。

Boss は Enemy の拡張として扱う。`boss: true`、phase、HP bar、時間制限、無敵区間を `EnemyDefinition` に追加できる。

```yaml
id: enemy.boss_01
version: 1
asset: enemy.boss_01
boss: true
hp: 3000
phases:
  - id: phase_1
    hpTo: 2000
    pattern: pattern.boss_spread_1
  - id: phase_2
    hpTo: 0
    pattern: pattern.boss_radial_2
timeoutTicks: 3600
timeoutResult: fail
showHpBar: true
```

Boss phase の同 tick 競合は以下の順で解決する。

1. damage application
2. death check
3. phase threshold check
4. timeout check
5. `bossDefeated` / `bossPhaseChanged` / `bossTimedOut` event generation

HP が 0 以下になった場合、同 tick の phase change は発生させず `bossDefeated` を優先する。timeout と撃破が同 tick の場合も撃破を優先する。

Boss phase validation では、phase id の一意性、`hpTo` の単調減少、`0 <= hpTo < boss.hp` の範囲、最後の phase が `hpTo: 0` へ到達すること、初期 HP から一意に初期 phase を選べることを検証する。`timeoutTicks` を持つ Boss は `timeoutResult: clear | fail`、または stage 側の `failCondition` / `clearCondition` で timeout の扱いを明示する。

### 9.6 Pattern 定義例

Phase 1A の Core minimum では full DSL をまだ実装せず、敵 spawn tick に 1 回だけ敵弾を出す `fireOnSpawn` を最小形として扱う。

```yaml
id: pattern.spawn_bullet
version: 1
fireOnSpawn:
  bullet: bullet.red_small
  offset: { x: 0, y: 8 }
  velocity: { x: 0, y: 3 }
```

`fireOnSpawn` は Stage timeline で enemy が生成された tick の `spawn bullets / player shots` step 内で player shot より先に解決し、`enemyBulletsSpawnedBatch` event と `EnemyBulletRuntimeEntity` を生成する。`offset` は enemy の spawn position からの相対座標である。`velocity` は敵弾の速度（px / tick）で、省略した敵弾は動かない。敵弾は生成した tick の update movement から動き、位置は毎 tick `spawnPosition + velocity * ageTicks`（`ageTicks` は生成から動いた tick 数）として求め直して加算誤差を積まない。swept collision を導入するまでは、1 tick の移動量が自機と敵弾の判定半径の合計を大きく超えてすり抜けないよう、content validation で `velocity` を axis ごとに ±8 px/tick に制限する。敵弾は中心が playfield を 32 px の余白より外れた tick の update lifetime で event を出さずに取り除く。Phase 2A-5 で `wait`、`fire`、`loop` の命令列 `steps` を追加した（design 10 の PatternProgram）。`steps` と `fireOnSpawn` は 1 つの pattern で同時に指定できず、既存 content の `fireOnSpawn` はそのまま使える。

```yaml
id: pattern.scout_three_way
version: 1
steps:
  - wait: 20
  - fire:
      bullet: bullet.red_small
      origin: self
      aim: player
      fan:
        count: 3
        spreadDeg: 24
      speed: 2.4
  - wait: 50
  - loop: 0
```

各 step は `wait`、`fire`、`loop` のどれか 1 つの key だけを持つ（Phase 2B-2 / 2B-3 で `repeat` と `if` を足した）。`fire` は `bullet`、`speed`（px / tick、0 より大きく 8 以下）と、向きとして `aim: player` か `angleDeg`（+x を 0°、+y へ回る向きを正とする -360〜360 の 0.25° の倍数）のどちらか一方を持ち、省略できる `origin` は発射する enemy 自身を表す `self` だけを受け付ける。`fan` は `count` 発（1〜64）を基準の向きを中心に並べ、`spreadDeg`（0〜360）は最初と最後の弾の間の角度とする。各弾は基準から `-spread / 2 + i * spread / (count - 1)` だけずれるため、すべての弾が 0.25° 刻みに載るよう、広がりの step 数が 2 と `count - 1` で割り切れることを validation で要求する（`count` が 1 なら `spreadDeg` は 0）。`loop` は前の step の index へ戻り、戻り先から loop までの間に `wait` を含む必要がある。1 pattern の step は 1〜64 個、`wait` は 1〜3,600 tick に制限する。

Phase 2B-2 で `repeat`、`fire.radial`、`fire.stream` を追加した。

```yaml
id: pattern.gunship_burst
version: 1
steps:
  - repeat:
      count: 3
      steps:
        - fire:
            bullet: bullet.blue_large
            angleDeg: 90
            radial:
              count: 12
            stream:
              count: 2
              speedStep: 0.5
            speed: 1.5
        - wait: 10
  - wait: 60
  - loop: 0
```

- `repeat` は `steps` を `count` 回（1〜256）続けて実行する。`steps` には `wait`、`fire`、`repeat` を置け（1〜64 個、入れ子は 4 段まで）、`loop` は置けない。load 時に展開するため、展開した後の命令数は 4,096 以下にする。`loop` は top-level の step の index へ戻り、`wait` を含む `repeat` は loop の範囲の `wait` として数える。
- `fire.radial` は基準の向き（`aim` か `angleDeg`）から 1 周を `count` 等分した向きへ撃つ（1〜64、360° を `count` で割った角度が 0.25° の倍数になる数だけ）。`fan` と `radial` はどちらか一方だけを指定できる。
- `fire.stream` は各向きに、`speed` から `speedStep` ずつ変えた速さの弾を `count` 発（1〜16）重ねる。`count` が 2 以上なら `speedStep` は 0 以外で、すべての弾の速さが 0 より大きく 8 以下になる必要がある。
- 1 回の発射の弾は向きごとに速さを並べた順（向きが外側、速さが内側）に採番する。

Phase 2B-3 で difficulty による分岐 `if` を追加した。

```yaml
id: pattern.scout_three_way
version: 1
steps:
  - wait: 20
  - if:
      difficulty: [hard]
      then:
        - fire: { bullet: bullet.red_small, aim: player, fan: { count: 5, spreadDeg: 40 }, speed: 2.4 }
      else:
        - fire: { bullet: bullet.red_small, aim: player, fan: { count: 3, spreadDeg: 24 }, speed: 2.4 }
  - wait: 50
  - loop: 0
```

- `if.difficulty` は既知の difficulty（`normal`、`hard`）を重複なく 1 つ以上並べる。stage の difficulty が含まれれば `then`、含まれなければ `else`（省略すると何もしない）を実行する。`then` と `else` には `repeat` の `steps` と同じ命令（`wait`、`fire`、`repeat`、`if`。1〜64 個）を置け、`loop` は置けない。`repeat` と `if` の入れ子は合わせて 4 段までにする。
- 分岐は stage を始めるとき（restore では snapshot の difficulty で）に解決して PatternProgram に展開するため、runner の状態と state hash は変わらない。`loop` の範囲の `wait` には、`then` と `else` の両方に `wait` を含む `if` だけを数える。展開した後の命令数の上限（4,096）は difficulty ごとに数える。

`parallel`、`set`、`move`、HP / 時間の `if`、`emitEvent`、`randomSpread`、`accel` は後続の DSL で扱う（`docs/implementation-plan.md` の「Phase 2B タスク分割」）。

### 9.7 Enemy Bullet 定義例

```yaml
id: bullet.red_small
version: 1
asset: bullet.red_small
collision:
  shape: circle
  radius: 4
visualRadius: 8
damage: 1
layer: enemyBullet
clearOnBomb: true
```

`clearOnBomb` は Bomb feature 有効時だけ解釈する field である。Bomb feature 無効時に `clearOnBomb` が指定されている場合は validation warning とし、Simulation では inert metadata として無視する。Bomb feature 有効時は未指定を `true` とみなす。

### 9.8 Path 定義例

Stage や Enemy から参照する移動パスは、`content/paths/` の定義として管理する。

```yaml
id: path.down_sine
version: 1
segments:
  - type: velocity
    duration: 180
    velocity: { x: 0, y: 1.4 }
    offset:
      type: sine
      axis: x
      amplitude: 32
      periodTicks: 120
  - type: velocity
    duration: 90
    velocity: { x: 0, y: 2.2 }
```

PathRunner は segment 開始位置を `p0`、segment 内経過 tick を `t` として、基本位置 `p0 + velocity * t` に `offset(t)` を足す。`offset.sine` は位置への相対変位であり、速度そのものは変更しない。segment が切り替わると、その時点の最終位置を次 segment の `p0` とする。

Phase 2A-2 の Core は `type: velocity` の segment だけを受け付け、Phase 2A-4 で `offset`（`type: sine`、`axis: x | y`、`amplitude`、`periodTicks`）を追加した。sine offset の変位は `amplitude * sin(floor(t * 1440 / periodTicks) step)` で、sine は下の決定的な表から引き、位相は整数演算で求める（`t * 1440` は 2^53 未満なので、割り算の丸めが整数境界をまたがず floor は正確）。`periodTicks` が 1,440 を割り切らない場合も位相は floor で丸める。content validation は `amplitude` を ±256 px、`periodTicks` を 1〜3,600 tick に制限する。offset を持たない segment の座標と state hash は変わらず、phase は `segmentElapsedTicks` から求まるため `pathRunnerState` も変えない。`segments` は省略でき、省略時と空配列は動かない path になる（`path.none` 互換）。content validation は 1 path を 64 segment、1 segment の `duration` を 1〜3,600 tick、`velocity` を axis ごとに ±16 px/tick に制限する。enemy は spawn した tick から system order の update movement で path を進み、位置は毎 tick `p0 + velocity * t` として求め直して加算誤差を積まない。全 segment を終えた enemy は最終位置に止まり、中心が playfield を 64 px の余白より外れていれば update lifetime で event を出さずに取り除く。画面外から登場する enemy を消さないよう、path の途中では cleanup しない。

Phase 1 の Simulation 座標は JavaScript の finite number として保持し、state hash では IEEE-754 binary64 の canonical encoding で比較する。斜め移動や sine offset によって小数座標が自然に発生するため、固定小数点へ変換できない値を不正扱いにしない。ただし tick 中の非線形関数は host `Math.sin` などの実装差へ依存させない。`offset.sine` のような機能を実装する slice では、core version に紐づく deterministic lookup table または決定的な近似関数を feature ごとに定義し、table 生成方法、解像度、補間方式、丸め規則、golden vector を同じ slice で固定してから tick で使う。Phase 2A-4 で固定した角度計算は design 10 の「決定的な角度計算」に置く。将来、runtime state 自体を固定小数点へ移行する場合は、単位、丸め規則、content loader の変換、golden snapshot の比較対象を別 schema version として同時に固定する。

### 9.9 Pickup 定義例

Enemy の drops から参照する回収アイテムは、`content/pickups/` の定義として管理する。Pickup は Phase 2B の content authoring 拡張とし、Phase 1A / Phase 2A の minimum playable には含めない。Phase 2B-5 で pickup feature（`@shooting-sample/shooting-core/features/pickup`）の content として実装した。`enabledFeatures: [pickup]` の content だけが使え、validate-content は `pickups/*.yaml` を `content.features.pickups` に入れる。

```yaml
id: pickup.score_small
version: 1
asset: pickup.score_small
score: 100
collectRadius: 10
magnetRadius: 80
velocity: { x: 0, y: 1.5 }
```

```yaml
# content/enemies/drone.yaml（抜粋）
drops:
  - pickup: pickup.score_small
    count: 3
    spread: 24
```

- pickup は `score`（0 以上の整数）、`collectRadius`（0 より大きく 64 以下）、省略できる `magnetRadius`（`collectRadius` より大きく 256 以下）、`velocity`（px / tick、x は ±8、y は 0 より大きく 8 以下）を持つ。下へ落ちるので、回収されなければ playfield の下から出て消える。
- enemy の `drops` は 1 つ以上の `{ pickup, count, spread? }` で、`count` の合計は 1 enemy あたり 16 以下にする。撃破した位置を中心に `count` 個を横へ `spread` px（0〜128）の幅で等間隔に並べる。乱数は使わない。
- Phase 2B-6 の simulation: 撃破した tick の scoring で、collision resolution の順、drop の順、横の並びの順に pickup を出して採番し、`pickupsSpawnedBatch` で知らせる。pickup の位置は `spawnPosition + velocity * age` で毎 tick 求め直す。playfield の下の境界（32 px 外）を越えるか、左右の境界の外で playfield へ戻らなければ event なしで取り除き、上の境界の外に出た pickup は落ちて入るので残す。自機の中心から `collectRadius` 以内で回収し（`pickupCollected` と reason `pickupCollected` の `scoreChanged`）、`magnetRadius` 以内なら吸い寄せに入る。吸い寄せに入った pickup は位置を止め、12 tick 後に回収する（描画はその間、自機へ寄せる演出にしてよい）。吸い寄せを Core で扱うので、回収の tick は描画に依存しない。
- active な pickup は 300 まで（design 14）。超える drop は pickup を出さずに `pickup.budgetExceeded` の fatal にする。回収されていない pickup が残る間は stage を clear にしないため、pickup は 0.5 px / tick 以上で落ちる必要がある。
- Phase 2B-7 で sample title が pickup feature を有効にした: drone が `pickup.score_small`（10 点、`magnetRadius` 64）を 2 個落とす。app は `collectViewEntities()` で Core の entity と `state.features.pickups` を 1 つの view の並びにし、pickup を専用の view pool（stage の timeline の drops の合計と 300 の小さい方）で敵の上、hit spark の下に描く。吸い寄せ中の pickup は描画だけ自機へ寄せ（`PickupAttraction`）、debug overlay の collider は Core の位置に回収の半径を描く。有効でない feature の pickup の定義は app も使わない。
- frame は `state.features.pickups`（`ReadonlyPickupState`: id、定義、位置、吸い寄せ中か）を持つ。pickup の state は pickup feature の state（`stateVersion` 2、serialize は `enabledFeatureStates` の payload）で、restore は id と出た tick の順、basic の entity との採番順、定義ごとの drop 数、吸い寄せの tick、cleanup を検証する。撃破した位置は入力で決まるため検証しない。

### 9.10 Scoring / Rank 定義例

Score と rank は title ごとに差し替えられる rule として扱う。Core は rule を評価するが、計算式の係数は content 側に置く。

MVP の score は固定ロジックの `scoreOnKill` のみを必須とする。これは `EnabledFeature` ではなく Core minimum の一部であり、Enemy の `score` を撃破時に加算するだけに限定する。Pickup score は Pickup と同じく Phase 2B で追加し、Core minimum の score contract には含めない。`ScoringRule` は `advancedScoring` feature として扱い、`defaultScoringRuleId` は `advancedScoring` 有効時だけ指定できる。advanced scoring 有効時は basic `scoreOnKill` を置換し、二重加算しない。Rank、chain、graze score、height multiplier は optional module とし、MVP の Core minimum には含めない。

以下の `ScoringRule` 例は `advancedScoring + graze + pickup` を有効にした title 用である。Core minimum ではこの rule を読み込まない。

```yaml
id: scoring.default
version: 1
rules:
  enemyKillBase: true
  graze:
    score: 10
    oncePerBullet: true
  pickup:
    scoreMultiplierByHeight: true
  chain:
    enabled: false
```

```yaml
id: rank.default
version: 1
enabled: true
initial: 1.0
min: 0.8
max: 1.5
modifiers:
  scoreGain: 0.00001
  playerDeath: -0.15
  bombUse: -0.05
appliesTo:
  enemyHp: false
  bulletSpeed: true
  fireInterval: true
```

`rank.modifiers.bombUse` は `rank` と `bomb` の両方が有効な場合だけ許可する。Bomb feature 無効時に bomb 関連 rank fragment がある場合は validation error にする。

### 9.11 Affinity 定義例

属性システムを有効にするタイトルでは、`content/affinities/` に相互作用ルールを定義する。

```yaml
id: affinity.ikaruga_like
version: 1
values: [white, black]
rules:
  same:
    playerBulletVsEnemy: absorb_or_bonus
    enemyBulletVsPlayer: absorb_or_no_damage
  opposite:
    playerBulletVsEnemy: damage_bonus
    enemyBulletVsPlayer: damage
  switch:
    cooldownTicks: 8
    keepsShotBuffer: true
chain:
  resetOnMiss: true
  resetOnWrongAffinityKill: true
```

MVP では affinity 定義を省略できる。`none` は予約値として常に許可し、通常の被弾/与ダメージだけを処理する。Affinity 有効 title でも、未指定 content は `none` とみなす。

Affinity feature を有効にする Player は、`initialAffinity` と `availableAffinities` を持つ。`initialAffinity` は `availableAffinities` に含まれ、両方とも選択された `AffinityRules.values` に含まれる必要がある。`switchAffinity` は `availableAffinities` の順序で切り替え、`none` しか持たない Player では登録不可とする。

## 10. 弾幕 DSL 方針

弾幕は単純な命令列として定義する。最初から汎用スクリプト言語を入れず、必要な命令を増やす。

基本命令:

| 命令 | 用途 |
| --- | --- |
| `wait` | 指定 tick 待機 |
| `fire` | 弾を発射 |
| `move` | 発射元や敵の移動制御 |
| `set` | ローカル変数や速度を設定 |
| `repeat` | 指定回数ループ |
| `loop` | 指定 step へ戻る |
| `parallel` | 複数シーケンスを同時実行 |
| `if` | HP、時間、難易度による分岐 |
| `emitEvent` | 演出や UI へイベント通知 |

発射指定:

- `aim: player`
- `angleDeg`
- `fan`
- `radial`
- `stream`
- `randomSpread`
- `speed`
- `accel`
- `color` または `affinity`

決定的な角度計算（Phase 2A-4）:

- 角度は画面座標系で +x を 0°、+y（下）へ回る向きを正とし、1 周を 1,440 step（0.25°）に分ける。content の `angleDeg` / `spreadDeg` のような角度は 0.25° の倍数だけを受け付け、`angleStepsFromDegrees()` で整数 step に変換する（4 倍は 2 の冪の乗算なので丸めを伴わない）。
- tick 中の sine / cosine は `simulation/sine-table.ts` の表だけから引き、host の `Math.sin` / `Math.cos` / `Math.atan2` を使わない。表は `packages/shooting-core/scripts/generate-sine-table.mjs`（`npm run generate-sine-table`）が 0〜90° の 361 entry を `round(sin(step * π / 720) * 2^30)` の整数として生成し、生成した整数 literal を正本として commit する。host の `Math.sin` は生成時にだけ使い、丸めは生成時の `Math.round` だけとする。tick は表を補間せずに引き、90° より先は対称性で広げる（sin 0° / 30° / 90° は 0 / 1/2 / 1 に一致し、180° は -0 にしない）。表の golden entry と checksum、対称性は test で固定する。
- `aim: player` の向きは、発射元から自機への差分 vector に最も近い角度 step へそろえる（`angleStepsOfVector()`）。`Math.atan2` は使わず、0〜90° の表の方向との外積の符号で二分探索し、隣り合う 2 step のうち内積が大きい方を選ぶ（四則演算と比較だけ）。差分が零なら真下を向く。狙いも固定角度も整数 step で表すので、敵弾の速度は常に表の `(cos, sin) * speed` になり、各成分は `speed` を超えない。fan は基準 step に各弾の step 差を足して作る。ECMAScript は `Math.sqrt` を正確な平方根の丸め（𝔽）と定めているので Core で使ってよいが、`Math.hypot` と三角関数・指数関数は implementation-approximated なので使わない。
- `tests/deterministic-math.test.mjs` が Core の非 test source に implementation-approximated な `Math` function と `**` 演算子（`Number::exponentiate` も implementation-approximated）が現れないことを検査する。

PatternProgram の最小 command subset（Phase 2A-5）:

- load 時に `steps` を `PatternProgram`（`patterns/pattern-program.ts`）へ正規化する。`repeat` は展開し（Phase 2B-2）、difficulty の `if` は difficulty ごとに枝を選んで展開し（Phase 2B-3）、角度と fan / radial は整数 step にし、stream は弾ごとの速さにする。run を始められる cursor（0、各 `wait` の直後、末尾）ごとに、次の `wait` か末尾まで実行する命令のまとまり（run）の発射命令、弾数、実行命令数、次の cursor と待ち tick 数を 1 度だけ求める。展開した命令列に分岐や乱数はないため、tick と restore は同じ run を引く。cursor は展開した後の命令の位置で、`repeat` と `if` のない pattern では step の index と同じになる。
- content の index は既知の difficulty ごとに PatternProgram の表を持ち（`if` を持たない pattern は 1 つの program を共有する）、stage session は `startStage()` の difficulty の表を、restore は snapshot の `difficulty` の表を使う。
- runner state は cursor と `waitRemaining`（次の run までに進める tick 数）だけを持つ。runner は enemy を spawn した tick から毎 tick、待ちが 2 tick 以上残っていれば 1 減らし、それ以外は cursor から run を実行する。`wait: N` で止まった run の次の run は N tick 後に実行する。末尾まで実行した runner は cursor を命令数にして止まる。
- `loop` の戻り先から loop までの間に `wait` があることを validation で保証するため、戻るたびに次に当たる loop の位置が前へ進み、1 回の run は必ず `wait` か末尾で止まる（静的に検出できる無限ループの拒否、design 21.3）。
- 発射命令は、基準の向き（`angleDeg` の step か、自機への向きに最も近い step）に fan の step 差を足した向きの表の単位 vector に `speed` を掛けて敵弾の速度にする。発射元は enemy の移動前の位置で、敵弾は生成した tick から動く。
- 1 tick に全 runner が実行した命令数が 2,000（design 14 の pattern commands / tick）を超えたら `pattern.budgetExceeded` を `stageSession.fatal` に latch する。敵弾数は `enemyBullet.budgetExceeded` の上限で守る。

斑鳩系の属性切替を入れる場合は、弾と敵に `affinity` を持たせる。

```yaml
affinity: white
```

Core は `affinity` を抽象値として扱い、タイトル側で白黒、赤青、光闇などに読み替える。

属性システムを有効にするタイトルでは、Core は `ContentRegistry.features.affinities` の `AffinityRules` を使う。Core は色名そのものではなく、同属性/逆属性/中立の相互作用を処理する。最小実装では `affinity` を任意拡張にし、`none` の場合は通常の被弾/与ダメージだけを処理する。

## 11. 入力設計

物理キーとゲーム内 action を分離する。

Gameplay action:

| Action | 内容 |
| --- | --- |
| `moveX` / `moveY` | 移動 |
| `shot` | 通常ショット |
| `focus` | 低速移動、当たり判定表示 |

低速移動時は、プレイヤーの見た目ではなく `Player` component の移動倍率を変更する。

Optional gameplay action:

| Action | Feature | 内容 |
| --- | --- | --- |
| `bomb` | `bomb` | ボム |
| `switchAffinity` | `affinity` | 属性切替 |

対応する optional module を有効にするタイトルだけ、追加 action として登録する。MVP では `bomb` と `switchAffinity` を input/replay/schema の必須項目にしない。

UI / lifecycle action:

| Action | 内容 |
| --- | --- |
| `pause` | Runtime lifecycle を `paused` に切り替える |
| `confirm` / `cancel` | UI 操作 |
| `menuUp` / `menuDown` | UI 操作 |
| `toggleDebug` | debug overlay（collider と debug HUD）の表示を切り替える |

Phase 2A の sample app は `pause`（Escape / P）、`confirm`（Enter / Space）、`toggleDebug`（Backquote / F3）を割り当てる。`cancel` と `menuUp` / `menuDown` は menu を置く slice で足す。

MVP の入力デバイスは keyboard のみとする。gamepad と touch は Phase 3 以降の runtime adapter 拡張で対応する。Input recording は physical key ではなく action 化された `InputFrame` を保存するため、key config が変わっても replay は変化しない。

`InputFrame` は tick ごとに以下を持つ。

```ts
type InputFrame = {
  tick: number;
  axes: {
    moveX: -1 | 0 | 1;
    moveY: -1 | 0 | 1;
  };
  held: GameplayActionId[];
  pressed: GameplayActionId[];
  released: GameplayActionId[];
};
```

Runtime adapter は `keydown` / `keyup` の KeyboardEvent queue を持ち、render frame 間に押下と解放が完結した短押しも edge input として保持する。tick サンプリング時は queue を action に変換し、gameplay action は `InputFrame.pressed` / `released` として次の simulation tick までラッチする。UI / lifecycle action は別の `UiInputFrame` として Runtime/UI が消費し、`InputFrame` には入れない。`pressed` と `released` は 1 tick だけ有効で、複数 catch-up tick が発生した場合は最初の catch-up tick でだけ消費する。render frame 間で press/release が完結した tap は、同じ tick の `pressed` と `released` の両方に入り、その tick の `held` には含めない。edge ordering は `pressed` を先に解釈し、その後 `released` を反映する。`held` は catch-up 中の全 tick に適用する。これにより、ボム、属性切替、pause などの短押しが欠落したり複数回適用されたりすることを防ぐ。同じ tick の間に離して押し直した action は tick 時点で held なので `released` から外し、`pressed` と `held` にだけ入れて、Core の `held` / `released` 排他を守る。1 action に複数 key を割り当てた場合は、最初の key の押下と最後の key の解放だけを edge とする。reset 後は、reset 前から押されていた key と押下を観測していない key の auto-repeat（`repeat` の keydown）を keyup まで無視し、repeat でない keydown は keyup が focus 外で失われていても新しい押下として扱う。macOS は Meta（Cmd）を押している間、他の key の keyup を送らないため、Meta を押している event は入力に使わず、押下中の key を reset と同じく keyup まで無視する。

UI input と gameplay input は型で分ける。`GameplayActionId` だけが `InputFrame` に入り、replay に記録される。`UiActionId` と lifecycle action は Runtime/UI で消費し、Simulation の replay 対象にしない。`pause` は lifecycle-only 入力であり replay の完全再生対象ではない。`playing` 中に gameplay へ影響する UI 操作を追加する場合は、必ず `GameplayActionId` へ変換して replay に含める。

Key config は Runtime settings として localStorage に保存する。Core は key config を知らず、常に action id だけを受け取る。

Runtime settings は `settingsVersion` を持つ。

```ts
type KeyBinding = {
  action: GameplayActionId | UiActionId;
  keys: string[];
};

type RuntimeSettings = {
  settingsVersion: number;
  keyBindings: KeyBinding[];
  volume: {
    master: number;
    bgm: number;
    se: number;
    ui: number;
  };
};
```

settings version が古い場合は Runtime が migration し、Core には migration 済み action だけを渡す。

settings 読み込み時に localStorage が使えない、JSON が壊れている、`settingsVersion` が未知、未知 action がある、unknown physical key がある場合、Runtime は default settings に fallback し、`RuntimeEvent.settingsFallbackUsed` を記録する。1 action には複数 physical key を割り当てられるが、同一 physical key を複数 gameplay action に割り当てることは禁止する。UI action と gameplay action の同一 key 共有は UI modal が開いている場合だけ UI が優先する。binding validation は UI 表示前に行い、壊れた設定で boot を止めない。

settings 保存時に quota exceeded、security exception、private mode などで localStorage write が失敗した場合、Runtime はメモリ上の設定を維持し、`RuntimeEvent.settingsSaveFailed` を記録する。UI は「このセッションのみ有効」状態を表示し、次回 boot では保存済み設定または default settings から開始する。

## 12. 画面スケーリング

MVP の内部解像度は `384x448` とする。ブラウザ表示は integer scale を優先し、余白は letterbox で埋める。viewport が `384x448` 未満の場合だけ fractional downscale を許可し、canvas と DOM overlay を同じ CSS transform root で縮小する。clip や scroll は使わない。devicePixelRatio は Phaser renderer の解像度調整に使うが、Simulation 座標系には影響させない。画面サイズ変更時も playfield 内座標、collision、replay は変化しない。

Phase 2A-10 の sample app の実装:

- `src/runtime/view/viewport-layout.ts` の `computeViewportLayout()` が表示先の大きさと devicePixelRatio から配置を決める純粋関数で、node:test で検査する。収まる最大の整数倍で表示し、余りを上下左右へ半分ずつの letterbox（整数 px へ切り捨て、小数倍の浮動小数点の誤差でも負にしない）にする。どちらかの軸が内部解像度より小さいときだけ収まる小数倍へ縮小する。大きさを測れない（0 や非有限）ときは等倍で原点に置く。
- canvas と DOM overlay は内部解像度の大きさの transform root（`.stage-root`）に入れ、`src/ui/viewport-fit.ts` が root に `translate(letterbox) scale(scale)` を当てる。表示先の大きさの変化は ResizeObserver、devicePixelRatio の変化（browser zoom や別の display への移動）は `resolution` の media query で受け、配置が変わったときだけ当て直す。
- devicePixelRatio は canvas を描く解像度の倍率（render scale）にだけ使う。render scale は表示される device pixel 数（`scale × devicePixelRatio`）を 1/4 刻みで切り上げ、1 以上 4 以下に収める。1/4 刻みなら内部解像度との積が整数になる。canvas の画素数を render scale 倍にし、CSS の大きさは内部解像度のままにして、各 scene の camera の zoom で playfield 座標を canvas いっぱいに映す（`src/runtime/phaser/render-scale.ts`）。Simulation と entity の view の座標は内部解像度のまま変わらない。
- SVG の sprite は起動時の render scale を整数へ切り上げた倍率で rasterize し、描画では同じ倍率で割って内部解像度の大きさに戻す。texture は作り直さないため、起動後に render scale が上がった分は texture の拡大で補う。

## 13. 当たり判定

見た目と判定を明確に分離する。

推奨:

- 自機判定: 半径 2-4 px
- 自機見た目: 判定より大きい sprite
- 敵弾判定: 見た目より小さめ
- 敵本体判定: 攻撃可能範囲と接触ダメージ範囲を分ける
- Debug overlay で collider を表示可能にする

グレイズを採用する場合は、被弾判定より外側に `GrazeCollider` を追加する。Graze 判定は hit radius を除いた annulus として扱い、同じ tick に hit が成立した enemy bullet では graze を発生させない。`oncePerBullet` が有効な場合は bullet id ごとに graze 済み set を持ち、同一 bullet の再加点を禁止する。

高速弾のすり抜けを避けるため、敵弾と自機判定は tick 間の移動線分に対する swept circle collision を基本とする。player shot と enemy hitbox も、shot の `collisionMode` に応じて swept circle または segment 判定を使う。実装初期は、1 tick の移動量が判定半径合計を大きく超える entity について collision sampling を追加するか、content validation で最大速度を制限する。

collision broad phase は playfield を固定サイズ grid に分割し、layer 別 collision pair で候補を絞り込む。総当たり判定は禁止する。高速移動 entity は current position だけで grid 登録せず、previous-to-current の swept AABB を collider 半径で膨らませた範囲で grid 登録/検索する。Phase 1A の Core minimum 実装は契約固定用の小規模 content に限定した id 昇順の provisional full scan だったが、Phase 2A-7 で broad phase grid（`simulation/collision-grid.ts`）へ置き換えた。grid は playfield を 32 px の cell（12 x 14）に分け、tick ごとに layer（enemy bullet、enemy）の collider を中心の cell に 1 回だけ登録する。playfield の外の座標は端の cell にまとめる（座標から cell への写像が単調なので、重なる collider は重なる cell 範囲に入る）。問い合わせは問い合わせ側の半径と登録済み collider の最大半径の和だけ中心から広げた範囲の cell を、浮動小数点の丸めで境界をまたいでも取りこぼさないよう前後 1 cell ずつ広げて調べ、候補を entity id 昇順で返す。resolver はその中で円判定が成り立つ最初の候補を選ぶため、全探索と同じ組を同じ順で選び、state hash と replay は変わらない。移動線分の swept 登録は swept circle collision を入れる slice で扱い、それまでは現在位置で登録と判定をそろえる。

MVP の collision pair:

| Pair | Broad phase |
| --- | --- |
| player vs enemyBullet | enemyBullet grid |
| player vs enemy | enemy contact grid |
| playerShot vs enemy | enemy grid |

MVP では enemy の接触判定と被弾判定が同じ collider なので、enemy contact grid と enemy grid は 1 つの enemy grid を共有する。

Phase 2B で追加する collision pair:

| Pair | Broad phase |
| --- | --- |
| player vs pickup | 自機 1 体との距離の比較（pickup feature の scoring、Phase 2B-6。grid は使わない） |

Phase 3 で追加する collision pair:

| Pair | Broad phase |
| --- | --- |
| playerGraze vs enemyBullet | enemyBullet grid |
| bombClear vs enemyBullet | enemyBullet grid または full-screen list |

collision 解決は以下の順序で固定する。

1. player hit vs enemy bullet
2. player hit vs enemy contact
3. player shot vs enemy

Feature 有効時は以下を安定した位置へ挿入する。

| Feature | 追加 resolution |
| --- | --- |
| `bomb` | player hit より前に bomb clear vs enemy bullet |
| `graze` | player hit の直前に player graze vs enemy bullet |
| `pickup` | cleanup 前に pickup collect vs player |

同じ tick で複数 collision が発生した場合は、collision 種別の優先順位、発生 tick、entity id 昇順で解決する。未実装または無効な Phase 2B / Phase 3 機能の pair は resolution list から除外する。1 tick 内で player hit が成立した後は、その tick の追加 player hit を無視する。敵撃破、弾消し、スコア加算は解決順から event log を生成し、entity iteration order に依存させない。

## 14. Performance budget

MVP の performance budget は以下を目標にする。

| 項目 | 上限 |
| --- | --- |
| enemy bullet | 2,000 |
| player shot | 300 |
| enemy | 100 |
| simulation events / tick | 500（Core では検査しない目安。pickup は 1 個の回収で 2 event を出すので、同じ tick にまとめて回収すると超えうる） |
| render events / tick | 2,500 |
| pattern commands / tick | 2,000 |
| collision candidates / tick | 20,000 |
| target | 60 tick/sec |

Phase 2B 追加 budget:

| 項目 | 上限 |
| --- | --- |
| pickup | 300 |

Phase 1A では object pool はまだ実装せず、deterministic な ID 採番、batch 上限、immutable snapshot の契約を先に固定する。`fireOnSpawn` で保証する budget は同 tick の spawn 数と batch allocation の失敗時 rollback までとする。Phase 2A-3 で active enemy bullet 2,000 の上限を runtime policy として固定した。敵弾を生成すると active な敵弾が 2,000 を超える tick は、敵弾を 1 発も生成せず（entity id も消費せず）`enemyBullet.budgetExceeded` を内部 error として `stageSession.fatal` に latch する。無音で弾を落とすと replay と見た目が食い違うため、上限は content 側で守る。restore も 2,000 を超える敵弾を持つ snapshot を拒否する。Phase 2A-5 で pattern commands / tick 2,000 も runtime policy として固定した。全 pattern runner が 1 tick に実行する命令数が 2,000 を超える tick は、敵弾を生成せず `pattern.budgetExceeded` を `stageSession.fatal` に latch する。Phase 2B 以降で負荷が見えた段階で、Core は bullet、shot と event builder に object pool を導入し、tick 中の一時 allocation を避ける。Pickup feature は pickup pool を feature module 側で持つ。ただし `GameFrame.events` として返す event はコピー済み immutable value とし、次 tick の pool 再利用で過去 frame が変化しないようにする。上限超過時は dev では hard error、本番では stage load error または content error として扱い、無音で entity を落とさない。

大量発生する弾生成は per-bullet の simulation event にしない。Simulation event では `enemyBulletsSpawnedBatch` のような batch event を使い、render 用には別 stream の render event を生成する。Render event は budget 超過時に集約 event へ畳めるが、Simulation event と replay/state hash は変化させない。

## 15. プレイフィール仕様

### 15.1 自機

- 通常移動と低速移動を明確に分ける。
- 低速時に当たり判定を表示する。
- ショットは押しっぱなしで発射できる。
- ボムは無敵、弾消し、演出、スコア変化を event として扱う。

### 15.2 弾幕

- 弾の色、サイズ、速度、レイヤーを視認性優先で設計する。
- 背景と敵弾のコントラストを manifest レベルで確認できるようにする。
- 弾幕生成は deterministic にする。
- ランダムは seed 管理する。
- `randomSpread` などの乱数は Core が所有する PRNG だけを使う。PRNG state は `SerializedGameState` / state hash の対象として完全保存し、`ReplayMetadata` 自体には PRNG snapshot を重複して持たせない。

### 15.3 演出

- Hit stop は短く、操作不能時間を増やしすぎない。
- Screen shake は敵撃破、ボム、ボス形態変化に限定する。
- 弾消しは読みやすいエフェクトを優先する。
- 派手な Particle は enemy bullet layer を邪魔しない。

## 16. イベント設計

Simulation は tick 中に event log を組み立て、tick 終了時に順序保証された immutable な `ReadonlyArray<GameEvent>` として `GameFrame.events` へ含める。Runtime/UI は mid-tick に購読しない。

Event payload は各 system step で発生した時点の事実を表し、`GameFrame.state` は tick 終了時点の snapshot を表す。例えば `playerShotsSpawnedBatch.shots[].position` は生成位置であり、同じ frame の `state.entities` に含まれる player shot の position は、その後の movement step によって進んでいる場合がある。

代表 event:

| Event | 用途 |
| --- | --- |
| `entitySpawned` | 敵など少量 entity が生成された事実を通知 |
| `entityDestroyed` | Entity が破棄された事実を通知 |
| `enemyBulletsSpawnedBatch` | 敵弾生成を batch で通知 |
| `playerShotsSpawnedBatch` | プレイヤーショット生成を batch で通知 |
| `playerHit` | 被弾、残機処理、無敵演出 |
| `bombUsed` | ボム演出、弾消し |
| `bossPhaseChanged` | UI、BGM、背景演出 |
| `scoreChanged` | HUD 更新（reason は `enemyDefeated` か `pickupCollected`） |
| `pickupsSpawnedBatch` | pickup feature: 撃破した enemy が落とした pickup を batch で通知 |
| `pickupCollected` | pickup feature: 自機が pickup を回収した（続けて同じ pickup の `scoreChanged`） |
| `stageCleared` | リザルト遷移 |
| `gameOver` | 残機切れ、リザルト遷移 |

Event は描画命令ではなく、ゲーム内で起きた事実として表現する。
Sprite の生成や破棄、Particle、Tween、Camera 演出への変換は Runtime adapter の責務とする。

event の順序は、system 実行順と entity id の昇順で安定化する。Runtime/UI は `GameFrame.events` を読むだけで、Simulation へ同期的に副作用を返さない。これにより listener 順序、再入、描画側副作用による replay 非決定性を避ける。

## 17. Asset Manifest

ゲーム内では実ファイルパスを直接参照しない。

Asset manifest の正本は `content/assets/manifest.yaml` に置く。Runtime asset loader は検証済み manifest を `AssetManifest` として読み込む。

```yaml
version: 1
assets:
  enemy.scout:
    type: sprite
    path: assets/enemies/scout.png
    required: true
    usage: gameplay
  bullet.red_small:
    type: sprite
    path: assets/bullets/red-small.png
    required: true
    usage: gameplay
  sprite.placeholder.pickup:
    type: sprite
    path: assets/placeholders/pickup.png
    required: true
    usage: gameplay
  pickup.score_small:
    type: sprite
    path: assets/pickups/score-small.png
    required: false
    usage: gameplay
    fallback: sprite.placeholder.pickup
  bgm.stage01:
    type: audio
    path: assets/audio/stage01.ogg
    required: false
    usage: audio
    fallback: runtime.audio.silence
```

Content からは `asset: enemy.scout` のように key だけを参照する。この manifest は抜粋であり、実際の `content/assets/manifest.yaml` は参照される asset key をすべて含む。

Core は `AssetManifest` の path、decode、fallback を知らない。Core に渡す registry には asset key catalog だけを含め、実 path を持つ manifest は Runtime/app 側が保持する。Runtime adapter は manifest path を `assetBaseUrl` または Vite の `import.meta.env.BASE_URL` と合成して読み込む。manifest の path は origin-root 絶対パスではなく、base-relative path とする。

Manifest entry は `type`、`path`、`required`、`usage` を必須とし、`fallback`、`license`、`author`、`source` を任意 field として予約する。`usage` は `gameplay`、`ui`、`decorative`、`audio` のいずれかとする。`fallback` は同じ asset type の既存 key、または `runtime.` prefix の Runtime built-in asset だけを参照できる。fallback chain の cycle は validation error にする。`runtime.audio.silence` は manifest file を持たない built-in silent audio とし、Runtime adapter が提供する。

validate-content は Phase 2A-8 から manifest entry を検証する（`tools/validate-content/src/asset-manifest.ts`）。manifest の root は `version: 1` と `assets` だけを持ち、`type` は `sprite`、`atlas`、`tilemap`、`audio`、`particle`、`effect`、`required` は boolean とする。`usage: audio` は `type: audio` の entry にだけ使う。`path` は scheme、先頭の `/`、`\`、空・`.`・`..` の segment を持たない base-relative path に限る。URL parser が `%2e` を `.` と同じ dot segment として扱うため `%2e%2e` のような percent-encoding した dot segment も拒否し、server が区切りとして decode し得る `%2f` / `%5c` も拒否する。`fallback` は `required: false` の entry だけが持て、同じ type の manifest key か `runtime.` の built-in asset を参照し、fallback chain の cycle は `assetManifest.fallbackCycle` にする。`runtime.` で始まる key は built-in 用に予約し、manifest には書けない。`loadValidatedGameDefinition()` は検証済みの `AssetManifest`（path を含む）を `GameDefinition` と別に返し、Core へは従来どおり key の一覧だけを渡す。

Asset load failure は lifecycle の `loading` で処理する。missing、decode error、timeout は `RuntimeEvent.assetLoadFailed` または `LoadResult` として記録し、`required: true` の asset では stage start を止める。`required: false` かつ valid fallback がある場合のみ fallback asset を使える。fallback 使用は debug HUD と log に表示し、schema validation では fallback 前提の未定義 key を許可しない。

`required: false` で fallback がない asset の失敗時挙動:

| Asset type | 挙動 |
| --- | --- |
| `audio` | 無音 degrade を許可し、`RuntimeEvent.assetLoadSkipped` を記録する |
| `particle` / `effect` | render-only effect を省略できる |
| `sprite` / `atlas` / `tilemap` | `usage: gameplay` なら load error、`ui` / `decorative` なら省略可 |

Phase 2A-8 の sample app は sprite だけを画像として読み込む。audio は Phase 2A の対象外なので `required` にかかわらず読まずに `assetLoadSkipped` とし、atlas / tilemap / particle / effect は未対応として読み込み失敗と同じ規則に回す。fallback の使用は log と debug HUD に出す。gameplay entity の definition が参照する asset が省略された場合も、view を欠かせないため load error にする。

## 18. Audio adapter

Audio は Runtime adapter の責務とし、Simulation は `bgmRequested`、`seRequested`、`stageCleared` などの simulation event を出すだけにする。

MVP の音量カテゴリ:

- master
- bgm
- se
- ui

pause 時は BGM を pause または duck し、SE は新規再生を止める。visibility change では state 別に扱う。`playing` / `replayPlayback` は `paused` へ遷移し、BGM pause/duck と SE 停止を適用する。`stageStarting` は lifecycle を維持したまま開始演出 timer と BGM start を停止する。`title` / `result` は menu BGM を duck または継続できるが、新規 SE は止める。Audio file の missing/decode は `loading` で検出する。

ブラウザ autoplay 制限、`AudioContext.resume()` 失敗、`HTMLAudioElement.play()` promise rejection、suspended state は loading 後にも起きるため、Runtime は `RuntimeEvent.audioPlaybackFailed` と audio status を持つ。失敗時は user gesture 待ち UI、再試行、無音 degrade を選べるようにし、Simulation の成功/失敗判定には影響させない。

Phase 2A の sample app は audio を読まず（asset loading は audio を `assetLoadSkipped` にする）、audio status を `muted` に固定する（`src/runtime/audio/audio-status.ts`）。status は debug HUD に出し、Phase 2A-10 の `BrowserDebugStateDump.audioStatus` にも使う。audio adapter は Phase 2A の外（Later）とする。

## 19. Debug / authoring workflow

Debug HUD（browser）は以下を表示する。

- lifecycle state
- tick
- seed
- content version
- dropped tick
- kind 別の entity 数（player、enemy、enemy bullet、player shot）
- simulation events / tick
- render events / tick
- object pool 使用量

state hash、PRNG state hash（state hash と同じ canonical encoding / xxHash64 seed / output format を使う）、collision candidate 数、pattern commands / tick は Core 内部の diagnostics なので browser へ公開せず（21.5）、headless debug dump と test helper で見る。

Phase 2A-10 の sample app の実装:

- debug overlay は `toggleDebug`（Backquote / F3）でどの lifecycle でも切り替え、dev server では最初から表示する。表示中は content の collision radius による collider の円を entity ごとに描き（`src/runtime/phaser/collider-overlay.ts`）、debug HUD に Core と content の version、lifecycle、audio status、difficulty、seed、tick、dropped tick、kind 別の entity 数、asset の fallback と hit spark の drop 数を出す（`src/runtime/hud/debug-lines.ts`）。
- simulation events / tick、render events / tick、object pool 使用量は Phase 2A では出さない。

Content 制作者向け workflow:

1. `validate-content` CLI で schema、reference、performance budget を検証する。Pattern DSL 導入後は DSL semantic も同じ CLI に追加する。
2. Preview scene で stage、enemy、pattern、path を単体再生する。
3. Dev server では content hot reload を許可する。
4. hot reload 時は Simulation を安全に restart し、現在の replay には混ぜない。
5. validation error は file path、line、column、schema path、参照元 ID を表示する。

YAML loader と CLI は parse 後の object に `SourceSpan` を付与する。Core が直接ファイルを知らない場合でも、registry validation は validation context 経由で `sourceId`、`path`、`line`、`column`、`schemaPath` を diagnostic に戻せるようにする。cross-file reference error は参照元 span と未解決 target id を必ず含める。

Content 制作者向け docs には `docs/content-authoring/examples/` と `docs/content-authoring/error-guide.md` を用意する。minimal YAML examples は stage、enemy、bullet、player shot、pattern、asset manifest から始め、Phase 2B で pickup と scoring rule を追加する。error guide は diagnostic `code` ごとに原因、修正例、関連 schema path を載せる。

Preview scene の操作仕様:

- stage / enemy / pattern / path を選択して単体再生できる。
- pause、step 1 tick、restart、seed 変更、difficulty 切替ができる。
- spawn position、collider、entity id、pattern cursor、PRNG state を overlay 表示できる。pattern cursor と PRNG state は公開の `serialize()` から読み、collision candidate 数と state / PRNG の hash は Core 内部の diagnostics なので出さない（21.5）。
- Preview scene 専用の dev-only 操作として invincible、stage jump、boss phase jump を許可する。
- preview 操作は Runtime/UI 入力であり、replay 入力列には混ぜない。

Hot reload の適用範囲:

| 変更種別 | 挙動 |
| --- | --- |
| schema-only | validate のみ再実行 |
| asset-only | Runtime asset reload、Simulation は継続可能 |
| stage/enemy/pattern/path | stage restart 必須 |
| player/shot/collision | stage restart 必須 |
| scoring/rank/affinity | stage restart 必須 |

Phase 2B-8 の sample app の実装:

- content plugin（`vite/content-plugin.ts`）は game-definition と content root の変更で content を検証し直し、検証済みの content 全体か human 形式の診断を HMR の custom event（`sample-title:content-update`）で app へ送る。virtual module も無効化するので、page を読み込み直せば新しい content になる。最初の読み込みが検証の error だった page は event を受けられないので、次の有効な変更で page を読み込み直させる。
- app（`src/runtime/content/hot-reload.ts`、Phaser 非依存）は届いた content を今動かしている content と、object の key の順を無視して比べる。`GameDefinition` も asset manifest も同じなら schema-only として error の表示を消すだけにする。`GameDefinition` の変更（stage、enemy、pattern、path、player、shot、feature の定義）は、definition が使う sprite、collider の半径、loading で作った view pool に収まれば新しい `LoadedGame` で stage を始め直し（`GameShell.replaceContent()`、lifecycle の `contentReloaded`。新しい stage は入力を記録し直すので、前の replay には混ぜない）、収まらなければ page を読み込み直す。asset manifest だけの変更は、sprite の path だけ（SVG か画像かは同じ）なら一時的な key で読み直してから入れ替え、stage を続ける。asset の増減、type、fallback の変更は page を読み込み直す。
- 検証に失敗した変更は HUD の下端（`.hud-content-error`）に出し、古い content のまま動かし続ける。app が使えなかった変更では app の content を進めないので、後の変更も今の content と比べる。Core の error などで止まった stage は始め直せないので page を読み込み直す。focus がない間に始め直した stage の開始演出は focus が戻るまで進めない。
- `e2e/hot-reload.spec.ts` は content を一時 directory へ写した dev server を自分で起こし、stage の再開始、error の表示と回復、表示中の sprite の読み直し、page の読み込み直しを確かめる。

Phase 2B-9 の sample app の実装:

- Preview は dev server と test build（Vite の mode が `production` でない build）で `?preview=<target>` を付けて開く。target は `stage:<id>`、`enemy:<enemy>,<path>,<pattern>`、`pattern:<id>`、`path:<id>` で、content にない id や `?preview` だけなら最初の stage にする。production build では `src/main.ts` の分岐ごと消え、`vite/dev-only-build.test.ts` が production と test の mode で build して、Preview の印が test の bundle にだけあることを検査する。
- Core に Preview 専用の API は足さない。app（`src/runtime/preview/preview-definition.ts`、Phaser と DOM に依存しない）は選んだ対象だけを出す `GameDefinition` を合成して普通に load する: stage はそのまま、enemy、pattern、path は tick 30 に 1 体だけ出す stage を足す。pattern は止めておく path（区間なし）の enemy に画面の上の方で撃たせ、path は撃たない pattern の enemy で動かし、enemy は選んだ path と pattern で出す（enemy と位置は content の stage で最初に使われている spawn から借りる）。足す stage、path、pattern の id は content の id と重ならないよう suffix を付ける。足す stage は選んだ difficulty だけを持ち、他の difficulty の使われない枝が予算を超える pattern も再生できる。
- 選択（`PreviewSelection`）は対象、seed、difficulty を持つ。difficulty は stage ならその stage の difficulty、それ以外は content の stage の difficulty すべてから選ぶ。seed は変えるまで同じ値で始め直し、選択は URL（`preview`、`seed`、`difficulty`）に書いて、page を読み込み直しても同じ Preview を開く。
- panel（`src/preview/preview-mode.ts`、transform root の外）は対象、seed、difficulty の選択と Restart（R）、Pause（P）、Step（N）を持ち、選択を変えると stage を始め直す（`GameShell.startOrRestart()`）。Preview は title で止めずに始める。Step は pause 中の stage を 1 tick 進め（`GameShell.stepPausedTick()`）、通常の tick と同じく入力を記録し、進めた tick と event は次の render frame で view に渡す。1 tick 送りで stage が終わったら pause のまま止め、pause を解くと終わった stage に tick を渡さずに stage の終わりへ進む。入力欄に打つ key は game の入力にしない。
- overlay は playfield（transform root の中）に player、enemy、pickup の entity id と、次の 120 tick に出る spawn の位置を出す（spawn の位置は playfield の外が多いので端へ寄せ、近い印はまとめる）。panel には次に実行する tick（debug dump の `tick` と同じ）、PRNG state、pattern runner ごとの cursor と待ちの tick を、公開の `serialize()` から読んで出す（playing の間は 6 tick ごと、pause と 1 tick 送りでは毎回描き直す）。collider は debug overlay（Backquote / F3）の円で見る。
- 対象を選び直しても view pool を作り直さないよう、Preview の view pool は enemy、enemy bullet、pickup を runtime budget の capacity まで持つ（`planPreviewViewPoolCapacities()`）。
- content の hot reload は、新しい content で今の対象（なくなっていれば最初の stage）を合成し直して始め直す。合成した content を Core が拒めば、前の content と選択のまま動かし続けて HUD の下端に error を出す。
- Preview の stage の再生記録（`window.__SHOOTING_DEBUG_REPLAY__`）の `stage.stageId` は合成した stage を指すので、Node で再生するには同じ合成が要る。

`validate-content` CLI の出力契約:

- human output: authoring 用の読みやすいエラー表示
- JSON output: CI / editor integration 用
- exit code 0: valid
- exit code 1: validation error
- exit code 2: tool/runtime error
- severity: `error`、`warning`、`info`

CLI MVP input contract:

```yaml
# config/game-definition.yaml
schemaVersion: "1"
enabledFeatures: []
defaultPlayerId: player.default
contentVersion: shooting-sample@content.1
```

`contentVersion` は CLI input 専用 field であり、組み立て後は `GameDefinition.content.version` になる。`content` field を game-definition file に直接書くことは禁止し、`--content-root` 以下からだけ組み立てる。MVP は `.yaml` のみを受け付け、JSON と `.yml` は追加しない。

```text
content-root/
  assets/manifest.yaml
  players/*.yaml
  stages/*.yaml
  enemies/*.yaml
  bullets/*.yaml
  player-shots/*.yaml
  patterns/*.yaml
  paths/*.yaml
```

各 collection file は 1 file 1 definition とする。collection directory が存在しない場合は空配列として扱う。存在する collection directory 内の entry は `.yaml` regular file だけを許可し、未知の content-root entry、nested directory、`.yml`、symbolic link は schema error にする。file path と asset key は locale 非依存の UTF-8 byte order へ並べ、filesystem の列挙順に依存させない。

`content/assets/manifest.yaml` は必須で、Core へ渡す `assetKeys.keys` は `assets` mapping の key から生成する。Runtime 用 manifest entry の完全な shape、fallback、license validation は asset validation slice で追加し、Phase 1C-2 は object shape と Core が必要な key catalog の生成までを担当する。

YAML parser は `yaml` package の strict YAML 1.2 single-document mode を使う。YAML 1.1 directive、core schema 外の既知 tag、duplicate key、非 string key、複数 document、alias を parse error にする。alias は小さいsourceから大きなobject graphを作りsource index走査を増幅できるため、authoring YAMLでは使用しない。1 file は strict UTF-8 で 1 MiB、AST は 50,000 node、collection depth は 64 を上限とし、Node filesystem adapter は 1 MiB + 1 byte までの bounded readとfatal UTF-8 decodeで全量確保・置換受理を防ぐ。parse error と warning は parser offset を 1-based line / column へ変換する。

Core の content validation error は optional context として index 付き `schemaPath`、`referrerId`、`targetId` を返す。CLI はこの構造化情報を分割 YAML の source index へ接続し、同じ scalar 値を持つ無関係な field や別 definition へ診断を誤配置しない。旧 Core error や context を持たない warning は message から path を抽出し、game-definition または該当 definition root へ fallback して source span 必須契約を維持する。error code は `schema`、`reference`、`featureGate` へ分類する。

CLI process contract:

- `--game-definition` と `--content-root` は必須、`--format human|json` は省略時 `human` とする。
- 未知 option、重複 option、値欠落、未知 format は `tool.invalidArguments`、exit code 2 とする。
- help 以外の formatted result は validation error と tool error を含め stdout へ 1 回だけ出す。JSON 利用者が同じ stream だけで結果を読めることを優先する。
- stderr は entry point 自身が結果を format / write できない最終 failure だけに予約する。stdout / stderr の stream callback と非同期 error event を待機し、pipe 切断時も未処理例外ではなく exit code 2 へ正規化する。
- file read、permission、directory read failure は `tool.readFailed`、予期しない例外は `tool.unexpected`、ともに exit code 2 とする。

JSON diagnostic schema:

```ts
type ContentDiagnosticKind = "parse" | "schema" | "reference" | "featureGate" | "tool";

type ContentDiagnosticBase = Readonly<{
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
}>;

type DiagnosticSourceEnd =
  | Readonly<{ endLine?: never; endColumn?: never }>
  | Readonly<{ endLine: number; endColumn: number }>;

type DiagnosticSourceSpan = Readonly<{
  path: string;
  line: number;
  column: number;
}> & DiagnosticSourceEnd;

type ParseOrSchemaContentDiagnostic = ContentDiagnosticBase & DiagnosticSourceSpan & Readonly<{
  kind: "parse" | "schema";
  schemaPath: string;
  sourceId?: string;
}>;

type ReferenceContentDiagnostic = ContentDiagnosticBase & DiagnosticSourceSpan & Readonly<{
  kind: "reference";
  referrerId: string;
  targetId: string;
  schemaPath?: string;
  sourceId?: string;
}>;

type FeatureGateContentDiagnostic = ContentDiagnosticBase & Readonly<{
  kind: "featureGate";
  sourceId: string;
  schemaPath: string;
}>;

type ToolContentDiagnostic = ContentDiagnosticBase & Readonly<{ kind: "tool" }>;

type ContentDiagnostic =
  | ParseOrSchemaContentDiagnostic
  | ReferenceContentDiagnostic
  | FeatureGateContentDiagnostic
  | ToolContentDiagnostic;

type ValidateContentJsonOutputBase = Readonly<{
  schemaVersion: "1";
  contentRoot: string;
  diagnostics: readonly ContentDiagnostic[];
  summary: Readonly<{
    errors: number;
    warnings: number;
    infos: number;
  }>;
}>;

type ValidateContentJsonOutput =
  | (ValidateContentJsonOutputBase & Readonly<{ ok: true }>)
  | (ValidateContentJsonOutputBase & Readonly<{ ok: false }>);

type ValidateContentRunResult =
  | Readonly<{ exitCode: 0; output: ValidateContentJsonOutput & Readonly<{ ok: true }> }>
  | Readonly<{ exitCode: 1; output: ValidateContentJsonOutput & Readonly<{ ok: false }> }>
  | Readonly<{ exitCode: 2; output: ValidateContentJsonOutput & Readonly<{ ok: false }> }>;
```

`createValidationRunResult()` は `tool` を除く validation diagnostic だけを受け取り、型と runtime projection の両方で下表の field を必須化する。source span の終了位置は `endLine` / `endColumn` を一組で指定する。runtime projection は own enumerable data property を一度だけ snapshot し、accessor、symbol property、未知 property を公開 JSON schema へ流さない。unknown kind / severity、不完全な必須 field、`tool` diagnostic の混入は tool/runtime error として exit code 2 へ分類する。tool/runtime error は `createToolErrorRunResult()` から生成する。

formatter は公開 DTO を直接構築した呼び出し元に対しても同じ runtime projection、canonical sort、summary 再計算を適用し、不整合な `ok` / `summary` や diagnostic をそのまま出力しない。Phase 1C-2 の parser / Core validation adapter は、外部診断を必ず上記 factory 境界へ渡す。

Diagnostic required fields:

| Diagnostic kind | Required fields |
| --- | --- |
| parse/schema | `kind`、`code`、`severity`、`message`、`path`、`line`、`column`、`schemaPath` |
| cross-file reference | `kind`、`code`、`severity`、`message`、`path`、`line`、`column`、`referrerId`、`targetId` |
| feature gate | `kind`、`code`、`severity`、`message`、`sourceId`、`schemaPath` |
| tool/runtime | `kind`、`code`、`severity`、`message` |

診断順は source path / source ID、開始位置、終了位置、kind、severity、code、message、schema / reference context の順で canonical に固定し、入力列挙順へ依存させない。human output は終了位置、`schemaPath`、`sourceId`、`referrerId`、`targetId` を表示し、改行、ANSI escape、制御文字を可視化して1 diagnostic を1行に保つ。

CI では `GameDefinition.enabledFeatures` と default ids を `--game-definition` で CLI に渡す。Phase 1C では sample app に依存しない `npm run validate-content -- --game-definition fixtures/game-definition.minimum.yaml --content-root fixtures/content-minimum --format json` を実行する。Phase 2A 以降は sample app の content も `npm run validate-content:sample`（`--game-definition apps/sample-title/config/game-definition.yaml --content-root apps/sample-title/content --format json`）として `npm run check` で検証する。sample app の Vite content plugin は同じ検証を validate-content の Node API `loadValidatedGameDefinition()` で行い、error があれば build と dev server の表示を止める。`error` が 1 件以上あれば exit code 1 にする。warning は初期段階では non-blocking とし、editor integration は `path` / `line` / `column` を診断位置へ、`code` と `message` を表示本文へ mapping する。

`fixtures/game-definition.minimum.yaml` と `fixtures/content-minimum/` は、Core basic を起動できる最小 content authoring 契約として扱う。player、stage、enemy、enemy bullet、player shot、pattern、path、asset manifest の必須形をすべて含め、stage から到達する pattern は enemy bullet を参照する。schema や参照契約を変更するときは実装、fixture、設計書を同じ変更で同期する。CLI integration test はこの静的 fixture を一時領域へ複製し、content parse、content schema、game-definition schema、reference、runtime budget、CLI argument の各失敗を 1 箇所だけ変更して生成する。これにより、失敗 fixture の重複と正常系からの意図しない乖離を避ける。

`fixtures/validate-content-golden/` は、CI / editor 向け JSON と content 制作者向け human output のプロセス境界を固定する。テストでは actual path と diagnostic source を検証してから、一時パスの JSON-escaped string または human path だけを `<content-root>` / `<game-definition>` へ置換し、それ以外の stdout byte を保持する。golden file は `.gitattributes` で LF に固定し、通常実行では読み取り専用にする。契約変更で更新が必要な場合だけ `npm run update-validate-content-goldens` を明示的に実行する。更新処理は全 case の process result を検証してから同一 filesystem 上で directory を入れ替え、生成差分をレビュー対象とする。

DSL の失敗時挙動:

- dev: validation error、runtime budget 超過、未定義 command は hard error として停止する。
- production: stage load 前検証を原則とし、検出できるものは stage load error として開始を止める。
- production runtime: 想定外の budget 超過や content error は fatal telemetry として記録し、可能なら安全な pause/error overlay に遷移する。公式 content ではここに到達しないことを品質基準とする。

本編 runtime の開発用 cheat/debug command は Phase 3 以降に追加する。候補は stage jump、invincible、slow motion、spawn command、boss phase jump とする。Phase 2B の Preview scene 専用操作は、本編 runtime の cheat/debug command とは別扱いにする。

## 20. 再利用可能な Core API

別タイトルで再利用するため、Core の公開 API は小さく保つ。

以下の型例は、現在実装済みの public method、現在実装済みの public DTO contract、
future API を分けて示す。現在実装済みの public method は
`ShootingCore.load()`、`LoadedGame.startStage()`、`LoadedGame.restore()`、`StageSession.tick()`、`StageSession.serialize()` である。
Phase 1B-3 で `SerializedGameState` などの public DTO 型境界を追加し、Phase 1B-4 で
root export 済みの `StageSession` 自体へ `serialize()` を追加済みである。Phase 1B-5A で
root export 済みの `LoadedGame` 自体へ `restore()` を追加済みである。
Phase 1B-7 は metadata-only の `ReplayMetadata` だけを追加し、replay playback 系 API は post-1B で扱う。

```ts
type AssetKeyRegistry = {
  keys: readonly string[];
};

type EnabledFeature =
  | "bomb"
  | "graze"
  | "affinity"
  | "rank"
  | "pickup"
  | "advancedScoring";

type ContentRegistry = {
  version: string;
  assetKeys: AssetKeyRegistry;
  players: readonly PlayerDefinition[];
  stages: readonly StageDefinition[];
  enemies: readonly EnemyDefinition[];
  bullets: readonly BulletDefinition[];
  playerShots: readonly PlayerShotDefinition[];
  patterns: readonly PatternDefinition[];
  paths: readonly PathDefinition[];
};

type GameDefinition = {
  schemaVersion: string;
  enabledFeatures: readonly EnabledFeature[];
  defaultPlayerId: PlayerId;
  content: ContentRegistry;
};

// optional feature の content（Phase 2B-5 で pickups を実装。ほかは feature を入れる slice で足す）。
// ContentRegistry.features?: FeatureContentRegistry
type FeatureContentRegistry = Partial<{
  pickups: readonly PickupDefinition[];
  bombs: readonly BombDefinition[];          // 未実装
  affinities: readonly AffinityRules[];      // 未実装
  scoringRules: readonly ScoringRule[];      // 未実装
  rankRules: readonly RankRule[];            // 未実装
}>;

// 未実装の feature が足す top-level field。
type FeatureGameDefinition = GameDefinition & Readonly<{
  defaultAffinityRulesId?: string;
  defaultScoringRuleId?: string;
  defaultRankRuleId?: string;
}>;

type StartStageOptions = {
  stageId: StageId;
  difficulty: Difficulty;
  playerId?: PlayerId;
  seed: string;
};

// Phase 1B-7 で追加する metadata-only DTO。
type ReplayMetadata = Readonly<{
  coreVersion: string;
  schemaVersion: string;
  contentVersion: string;
  inputFormatVersion: string;
  stageId: StageId;
  difficulty: Difficulty;
  playerId: PlayerId;
  enabledFeatures: readonly EnabledFeature[];
  seed: string;
}>;

// post-1B replay playback API。Phase 1B-7 では root export しない。
type ReplayPlayback = Readonly<{
  metadata: ReplayMetadata;
  inputs: readonly InputFrame[];
}>;

type SerializedReplayPlaybackState = SerializedGameState & Readonly<{
  replayCursor: number;
}>;

type SerializedPrngSnapshot = Readonly<{
  state: number;
}>;

type SerializedEntityId = number;

type SerializedJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly SerializedJsonValue[]
  | { readonly [key: string]: SerializedJsonValue };

type SerializedVector2 = Readonly<{
  x: number;
  y: number;
}>;

type SerializedPendingEvent = Readonly<{
  type: "stageStarted";
  tick: 0;
  stageId: StageId;
}>;

type SerializedRuntimeEntityState =
  | Readonly<{
      id: SerializedEntityId;
      kind: "player";
      definitionId: PlayerId;
      position: SerializedVector2;
      collisionRadius: number;
      lives: number;
      invincibleTicksRemaining: number;
      nextShotAllowedTick: number;
      movement: Readonly<{ speed: number; focusSpeed: number }>;
      shotDefinitionId: PlayerShotId;
    }>
  | Readonly<{
      id: SerializedEntityId;
      kind: "enemy";
      definitionId: EnemyId;
      position: SerializedVector2;
      collisionRadius: number;
      hp: number;
      scoreOnKill: number;
      pathId: PathId;
      patternId: PatternId;
      pathRunnerState: Readonly<{
        segmentIndex: number;
        segmentStart: SerializedVector2;
        segmentElapsedTicks: number;
      }>;
    }>
  | Readonly<{
      id: SerializedEntityId;
      kind: "enemyBullet";
      definitionId: BulletId;
      position: SerializedVector2;
      collisionRadius: number;
      velocity: SerializedVector2;
      spawnPosition: SerializedVector2;
      ageTicks: number;
    }>
  | Readonly<{
      id: SerializedEntityId;
      kind: "playerShot";
      definitionId: PlayerShotId;
      position: SerializedVector2;
      collisionRadius: number;
      velocity: SerializedVector2;
      remainingLifetimeTicks: number;
      damage: number;
    }>;

type SerializedPatternRunnerState = Readonly<{
  // Root package では SerializedPatternRunnerId という補助型名は公開しない。
  runnerId: `patternRunner.${string}`;
  patternId: PatternId;
  stateVersion: number;
  payload: SerializedJsonValue;
}>;

type SerializedEnabledFeatureState = Readonly<{
  feature: EnabledFeature;
  stateVersion: number;
  payload: SerializedJsonValue;
}>;

type SerializedDeterministicState = Readonly<{
  runtimeEntities: readonly SerializedRuntimeEntityState[];
  pendingEvents: readonly SerializedPendingEvent[];
  score: number;
  timelineCursor: number;
  stageStatus: "playing" | "stageCleared" | "gameOver";
  patternRunnerStates: readonly SerializedPatternRunnerState[];
  enabledFeatureStates: readonly SerializedEnabledFeatureState[];
}>;

type SerializedGameState = Readonly<{
  coreVersion: string;
  schemaVersion: string;
  contentVersion: string;
  inputFormatVersion: string;
  stateHashVersion: number;
  enabledFeatures: readonly EnabledFeature[];
  stageId: StageId;
  difficulty: Difficulty;
  playerId: PlayerId;
  expectedTick: number;
  nextEntityId: number;
  prngState: SerializedPrngSnapshot;
  state: SerializedDeterministicState;
}>;

type GameFrame = {
  tick: number;
  state: ReadonlyGameState;
  events: ReadonlyArray<GameEvent>;
};

type ReadonlyGameState = {
  tick: number;
  stageId: StageId;
  playerId: PlayerId;
  status: "playing" | "stageCleared" | "gameOver";
  player: {
    lives: number;
    invincibleTicksRemaining: number;
  };
  score: number;
  entities: ReadonlyArray<ReadonlyEntityState>;
};

type CoreResult<T> =
  | { ok: true; value: T; warnings: CoreWarning[] }
  | { ok: false; errors: CoreError[] };

type ShootingCore = {
  coreVersion: string;
  load(definition: GameDefinition): CoreResult<LoadedGame>;
};

type LoadedGame = {
  restore(state: SerializedGameState): CoreResult<StageSession>;
  startStage(options: StartStageOptions): CoreResult<StageSession>;
};

type StageSession = {
  tick(input: InputFrame): CoreResult<GameFrame>;
  serialize(): CoreResult<SerializedGameState>;
};

// post-1B replay playback API。
type ReplayLoadedGame = LoadedGame & {
  createReplayPlayback(replay: ReplayPlayback): CoreResult<ReplaySession>;
  restoreReplayPlayback(replay: ReplayPlayback, state: SerializedReplayPlaybackState): CoreResult<ReplaySession>;
};

type ReplaySession = {
  tick(): CoreResult<GameFrame>;
  serialize(): CoreResult<SerializedReplayPlaybackState>;
};
```

Runtime は `tick()` の戻り値に含まれる `GameFrame.events` を読んで描画する。

`SerializedPrngSnapshot` は public DTO とし、`state` は platform-independent な non-zero uint32 とする。Core 内部で使う旧 `SerializedPrngState` 相当の型名は root export せず、public snapshot の名前は `SerializedPrngSnapshot` に統一する。PRNG algorithm を変更する場合は snapshot field を暗黙変換せず、`ShootingCore.coreVersion` と restore compatibility policy で扱う。

`SerializedPendingEvent` は `GameFrame.events` の `GameEvent` と用途を分ける。`GameFrame.events` はその tick で発生して runtime adapter が消費する通知であり、`SerializedPendingEvent` は serialize / restore をまたいで未処理のまま再通知する queue だけを表す。Phase 1B では startStage 直後に残り得る tick 0 の `stageStarted` のみに限定し、`entitySpawned`、`playerShotsSpawnedBatch`、`enemyBulletsSpawnedBatch`、`playerHit`、`entityDestroyed`、`scoreChanged`、`tickAdvanced` は drain 済み frame event として pending queue へ保存しない。Phase 1B の restore は `expectedTick === 0` の snapshot では同一 `stageId` の `stageStarted` 1 件だけを要求し、`expectedTick > 0` では `pendingEvents` を空に限定する。feature / progression event は、restore 後にも pending として残る実装上の正本を持つ slice でだけ `SerializedPendingEvent` へ追加する。EnemyBullet の serialized state は Phase 2A-3 で `velocity`、`spawnPosition`、`ageTicks` を追加し、`stateHashVersion` を 3 に上げた。restore は現在座標から移動を逆算せず、処理済み timeline の `fireOnSpawn` と同じ弾・生成位置・速度で、`ageTicks` が生成 tick から `expectedTick` までの tick 数、`position` が `spawnPosition + velocity * ageTicks` と完全一致する spawn を選ぶ。等速直線運動の各座標は tick に対して単調なので、1 tick 目と現在の位置がどちらも cleanup 境界の内側であることで、途中で cleanup されずに残る敵弾だけを受け付ける。enemy bullet の `damage` と lifetime は Core runtime が正本を持つ slice で追加し、それまでの restore は `projectile` のような未知 field を `state.invalidShape` として拒否する。

`SerializedDeterministicState.runtimeEntities` は serialize 時に entity id 昇順で出力する。entity id は正の safe integer とし、`runtimeEntities` 内では strict ascending / unique / `id < nextEntityId` を満たす必要がある。restore は 0、負数、小数、unsafe integer、重複、`nextEntityId` 以上、昇順でない `runtimeEntities`、到達不能な `nextEntityId` envelope、同 tick の system order から作れない ID 並びを `state.invalidShape` として拒否し、受け取った順序を暗黙に sort しない。これにより collision / event order の tie-breaker と state hash の入力順を同じ契約に固定する。Core minimum の `score` は fixed `scoreOnKill` の加算結果なので、restore では non-negative safe integer として検証する。restore 成功時に active state へ入る player は playfield 内座標、`lives <= initialLives`、`invincibleTicksRemaining <= invincibleTicksAfterHit`、`nextShotAllowedTick <= expectedTick - 1 + fire.intervalTicks` を要求し、active enemy は `hp > 0` を要求する。倒された enemy は collision cleanup 後の snapshot から消えている必要があり、`hp: 0` の active enemy として復元しない。

`SerializedRuntimeEntityState` は現行 runtime が正本を持つ state だけを含める。Phase 2A-2 で PathRunner の segment index、segment start `p0`、segment 内経過 tick `t` を enemy の `pathRunnerState` として追加し、`stateHashVersion` を 2 に上げた（sine offset の phase などは、その state を持つ slice で同じく追加する）。現在座標、`pathId`、`patternId` だけから path movement を逆算して restore することは禁止する。restore は `pathRunnerState` の shape と segment 数に収まる範囲を検証したうえで、処理済み timeline の spawn 位置から spawn tick 〜 `expectedTick` の tick 数だけ path を進めた runner と位置を求め、restore した `pathRunnerState` と `position` が完全一致する spawn を選ぶ。一致する spawn がない enemy と、path を終えて cleanup 境界の外にいるはずの enemy は `state.invalidShape` として拒否する。

`SerializedPatternRunnerState.runnerId` は `patternRunner.${string}` の namespace 付き ID とし、`patternRunner.` のような空 suffix は restore で拒否する。同一 snapshot 内で一意にし、`patternRunnerStates` は `runnerId` の UTF-8 byte lexicographic order 昇順、`enabledFeatureStates` は top-level `enabledFeatures` と同じ canonical feature order で出力する。`runnerId` の比較に `localeCompare` や JavaScript の UTF-16 code unit order を使わない。canonical feature order は `["bomb", "graze", "affinity", "rank", "pickup", "advancedScoring"]` の順に固定し、実装はこの順序を `KNOWN_ENABLED_FEATURES` の正本として扱う。ただし root package の value export は `createShootingCore` に限定し、feature order は schema / type contract と test で固定する。restore は型、shape、top-level `enabledFeatures` と `enabledFeatureStates` の重複や canonical order 違反を `state.invalidShape`、loaded content との top-level feature 差分や unknown feature、feature state の extra / missing / wrong feature と `stateVersion` の不一致を `state.featureMismatch` として分類する。Phase 2B-4 で、有効な feature は必ず 1 つの state を持つことにした（実行時の状態を持たない feature は `null` の payload）。

`SerializedPatternRunnerState.payload` と `SerializedEnabledFeatureState.payload` は public な `SerializedJsonValue` だけを許可し、state hash では canonical encoding の対象にする。`number` は finite number のみ有効とし、`NaN` / `Infinity` は restore validation で `state.invalidShape` にする。hash では `-0` を `+0` に正規化し、finite number を IEEE-754 binary64 little-endian bytes として encode する。string は lone surrogate を含む場合に `state.invalidShape` として拒否し、payload の object key は UTF-8 byte sequence の lexicographic order で正規化する。module ごとの `stateVersion` は正の safe integer とし、未対応 version は module ごとの互換性 error で拒否する。Phase 1B-3 は型境界だけを固定し、basic core が実際に `patternRunnerStates: []` と `enabledFeatureStates: []` を出力する処理は Phase 1B-4 の serialize 実装で追加する。restore 時の top-level `enabledFeatures` と feature state の整合検証は Phase 1B-5 で扱う。

Phase 2A-5 で basic core の pattern runner が `patternRunnerStates` を出力するようにした。`steps` を持つ pattern で動く active enemy ごとに 1 件で、`runnerId` は `patternRunner.enemy.<entity id>`、`patternId` は enemy の pattern、`stateVersion` は 1、`payload` は `{ cursor, waitRemaining }`（design 10 の runner state、0 以上の safe integer。cursor は `repeat` を展開した後の命令の位置）とする。state hash の byte 列の定義は変わらず、`steps` を使わない content の state hash も変わらないため、`stateHashVersion` は 3 のままにした。restore は pattern runner の payload を汎用の JSON guard ではなく module の形（`cursor` と `waitRemaining` だけの plain object）で検証し、未対応の `stateVersion` を `state.featureMismatch`、それ以外の不一致を `state.invalidShape` にする。runner の件数上限は timeline step 数（4,096）とする。runner は `steps` を持つ pattern で動く active enemy ごとにちょうど 1 つ必要で、spawn tick から `expectedTick` まで進めた runner と完全一致しなければならない。restore は run を始める cursor の列が命令数 + 1 回以内に繰り返しに入ることを使い、tick を 1 つずつ進めずに run の時刻表から runner と発射を求める（`patterns/pattern-schedule.ts`）。

pattern が撃った敵弾の restore は、生成 tick（`expectedTick - ageTicks`）に処理済み spawn の runner が run を実行し、生成位置がその tick の移動前の enemy 位置（spawn 位置から path を進めた位置）と一致し、弾の定義と fan の何発目かまで一致する発射を 1 度だけ消費する。固定角度の弾は速度まで完全一致を要求する。`aim: player` の向きは発射した tick の自機位置で決まり、自機の位置は入力の履歴によるため snapshot から求め直せない。そのため aim の弾は、表のどれかの向きに `speed` を掛けた速度であることだけを確かめる。撃破された tick も snapshot から分からないため、enemy がいない spawn の弾も、path を終えて cleanup される tick（cleanup されない enemy は `expectedTick - 1`）までの発射として受け付ける。同じ tick の敵弾の採番順は fireOnSpawn、pattern（enemy の spawn 順、命令順、fan 順）の順に検証し、`nextEntityId` の到達可能性の上限には enemy が撃破されずに撃ち続けた場合の pattern の発射数を加える。

Phase 2A-6 で stage の終了状態 `stageStatus` を committed state、`SerializedDeterministicState`、`HashableGameState`（`timelineCursor` の次）に加え、`stateHashVersion` を 4 に上げた。値は直前の tick の終わりに design 7.1 の規則で決めた `playing` / `stageCleared` / `gameOver` で、`GameFrame.state.status` と同じ。`stageCleared` / `gameOver` の session の `tick()` は、input の shape や tick 番号より先に `stageSession.ended` の caller precondition error を返し、session を fatal にしない。`serialize()` は終了後も使え、終了した snapshot も restore できる（restore した session の `tick()` も `stageSession.ended` を返す）。restore は `stageStatus` が 3 値のどれかであることを検証し、`expectedTick` が 0 の snapshot は `playing` に限り、それ以外は restore した自機の残機、`timelineCursor` と timeline の長さ、active enemy から同じ規則で決まる値との一致を要求する。

Core API は transactional とする。現在実装済みの `load()`、`startStage()`、`restore()` は成功時だけ新しい handle を返し、失敗時に既存の `LoadedGame` / `StageSession` を部分更新しない。Phase 1B-5A の `restore()` は top-level metadata と互換性 error boundary を固定し、Phase 1B-5B は compatible snapshot の deterministic payload を validate / convert / re-serialize して accepted committed state の前段まで確認した。Phase 1B-5D では compatible snapshot から `StageSession` を返し、restore 直後の serialize と後続 tick が元 session と一致することを固定した。post-1B replay playback で追加する `createReplayPlayback()` / `restoreReplayPlayback()` も同じ方針にする。Core version は `ShootingCore.coreVersion` が持ち、content が申告する値ではない。`StageSession.tick()` は session 内の `expectedTick` を持ち、`input.tick !== expectedTick`、重複 tick、欠番 tick を caller precondition error として返すが、session を fatal にしない。Runtime は dropped tick を replay 入力として補完せず、実際に Simulation へ渡した `InputFrame` だけを保存する。

`ContentRegistry` は外部データの参照関係を検証する境界でもある。`content.version` は単なる title 内の連番ではなく、title / content pack をまたいで一意な immutable release identity とし、異なる content payload に同じ値を再利用しない。Stage の `music`、`background`、timeline 内の `enemy` と `path`、`clearCondition.bossDefeated.enemy`、Enemy の `asset`、`behavior.pattern`、Boss phase の `phases[].pattern`、Pattern の `fireOnSpawn.bullet`、Bullet/Player/PlayerShot の `asset` はすべて registry 経由で解決し、未定義 ID を schema test で検出する。Feature registry が登録された場合だけ、Pickup、Bomb、Affinity、Rank、advanced scoring の参照を追加検証する。

`load()` は registry index を生成する時点で、namespace ごとの `id` 一意性を検証する。同一 namespace 内で重複 ID があれば失敗する。別 namespace 間で同じ suffix を使うことはできるが、完全な ID は `enemy.scout`、`bullet.red_small` のように namespace prefix を含める。参照解決は配列順に依存させず、検証済み index だけを使う。

Basic core が許可する namespace prefix:

| Content type | Prefix |
| --- | --- |
| StageDefinition | `stage.` |
| PlayerDefinition | `player.` |
| EnemyDefinition | `enemy.` |
| BulletDefinition | `bullet.` |
| PlayerShotDefinition | `playerShot.` |
| PatternDefinition | `pattern.` |
| PathDefinition | `path.` |

Feature module 導入後に追加で許可する namespace prefix:

| Content type | Prefix |
| --- | --- |
| BombDefinition | `bomb.` |
| PickupDefinition | `pickup.` |
| AffinityRules | `affinity.` |
| ScoringRule | `scoring.` |
| RankRule | `rank.` |

Feature id、module path、YAML namespace の対応:

| Feature id | Module path | Namespace |
| --- | --- | --- |
| `pickup` | `features/pickup` | `pickup.` |
| `bomb` | `features/bomb` | `bomb.` |
| `graze` | `features/graze` | `player.graze` field |
| `affinity` | `features/affinity` | `affinity.` |
| `rank` | `features/rank` | `rank.` |
| `advancedScoring` | `features/advanced-scoring` | `scoring.` |

現在の basic core の `load()` は `schemaVersion`、`enabledFeatures`、`defaultPlayerId`、`content` だけを `GameDefinition` の top-level field として受け付け、`defaultPlayerId` が registry に存在することを検証する。`features`、`defaultAffinityRulesId`、`defaultScoringRuleId`、`defaultRankRuleId` は feature module schema 導入後の field であり、basic core では unknown field または unsupported feature として拒否する。`startStage()` は `stageId`、`playerId`、`difficulty` が registry と stage definition に存在することを検証し、不正な値では Simulation を開始しない。検証失敗は例外や no-op ではなく `CoreResult` の `errors` として返す。

Feature module 導入後、Affinity を使う content では、Bullet、Enemy、Player、PlayerShot、Pattern が参照する `affinity` 値が `none` または選択された `AffinityRules.values` に含まれることを検証する。`defaultAffinityRulesId` が未指定の場合、`affinity` 値は `none` だけを許可する。Bomb、Graze、Pickup、Rank、advanced scoring の default id、asset、effect target、rule id も feature module の registry 経由で解決し、未定義 ID、未対応 effect、cycle する参照は load error とする。これらの検証は feature schema の責務であり、現在の basic core には適用しない。

Feature module 導入後の `enabledFeatures` は optional module の境界である。MVP basic core は `[]` だけを許可し、basic score は Core minimum の固定仕様として扱う。Feature schema では disabled feature の定義ファイルを content library として registry に含めることは許可するが、default id、stage/player からの参照、runtime input action、collision pair として使うことは禁止する。未使用の disabled feature 定義は warning、参照された disabled feature は load error にする。

feature の content は `ContentRegistry.features`（`FeatureContentRegistry`）に置く。`Partial` だが、`enabledFeatures` に含まれる feature の collection は必須とする。空配列は「feature module は有効だが content 定義はない」状態として許可する。collection 自体が欠けている場合は configuration error（pickup は `definition.invalidShape`）とする。ただし `graze` は Player field だけで有効化できるため collection を持たない。

Feature の gating（Phase 2B-5）: basic は feature が持つ content の field を `content/feature-fields.ts` の表で知り、feature の module が Core に登録されていなくても gating する。`enabledFeatures` にない feature の collection（`content.features.pickups`）は検証せずに読み込むだけで Core は読まず、`feature.disabledContent` の warning にする。basic の definition に feature が足す field（`EnemyDefinition.drops`）を、その feature が `enabledFeatures` にない content で使えば `feature.disabled` の error にする。`enabledFeatures` にあって module が登録されていなければ `feature.unsupported` の error にする。有効な feature の collection と field の値は feature の module の `loadContent()` が検証し、参照を解決する（pickup の参照切れは `pickup.notFound`）。この matrix は `features/pickup/gating.test.ts` が固定する。validate-content は feature の診断を `featureGate` にし、`enabledFeatures` と無効な feature の collection は game definition を、無効な feature を使う field はその definition を指す。

- `bomb` 無効: basic schema では `PlayerDefinition.bomb` field 自体を禁止する。feature schema では `bomb.definition` の参照、`bomb` gameplay action、`bombClear` collision pair を禁止し、bomb 未所持の表現が必要な場合だけ `bomb.definition: null` を許可する。
- `graze` 無効: `PlayerDefinition.graze` field、player graze collider、`playerGraze` collision pair は禁止。
- `affinity` 無効: `defaultAffinityRulesId` は未指定、content の `affinity` は `none` のみ許可、`switchAffinity` gameplay action は登録不可。
- `rank` 無効: `defaultRankRuleId` は未指定、rank rule 参照と rank state は無効。
- `pickup` 無効: `EnemyDefinition.drops`、PickupDefinition からの参照、pickup collision pair、pickup score は禁止。manifest に未使用 optional asset key があるだけなら warning に留める。
- `advancedScoring` 無効: `defaultScoringRuleId` は未指定、`ScoringRule` と scoring fragment は禁止。`graze` / `pickup` score fragment は対応 feature も有効な場合だけ許可する。

Optional module は論理分離だけでなく source / export 境界も分ける。Core minimum は `packages/shooting-core/src/basic/` と root export に置く。Bomb、Graze、Affinity、Rank、Pickup、advanced scoring は `packages/shooting-core/src/features/<feature>/` に置き、feature registration を通じて schema fragments、validation rules、systems、collision pairs、input actions を追加する。root package に型名を置く場合でも、feature 固有 field は discriminated extension として扱い、enabled feature なしでは参照できない。

Feature registration（Phase 2B-4、`src/basic/extension/feature-module.ts`）:

- feature は `src/features/<feature>/index.ts` を package の subpath export（`@shooting-sample/shooting-core/features/<feature>`）で公開し、`defineFeature()` で作った `ShootingCoreFeature` を export する。host は `createShootingCore({ coreVersion, features: [...] })` に渡す（文字列の引数は従来どおり `coreVersion`）。`ShootingCoreFeature` は中身を読めない型で、`defineFeature()` が作った値だけを受け付け、偽の値、同じ feature の重複、既知でない feature、不正な `stateVersion` や hook は TypeError にする。
- `GameDefinition.enabledFeatures` は `features` に渡された feature だけを受け付け、渡されていない既知の feature は feature ごとに `feature.unsupported`（`targetId` 付き）にする。feature を 1 つも渡さない Core は、従来どおり `enabledFeatures: []` だけを受け付ける。
- Core は有効な feature の module を canonical feature order で呼ぶ。`load()` は basic の検証に通った definition に `validateContent()` を当てて error と warning を足し、`startStage()` は `createInitialState()` で state を作り、tick は `spawn`（spawn bullets / player shots の後）と `scoring`（collision resolution と basic の scoring の後、cleanup の前）の位置で system を実行する。serialize は `serializeState()` を `SerializedEnabledFeatureState` の payload に、state hash は `hashState()` を feature state に入れ、restore は feature ごとに 1 つの state と `stateVersion` を確かめてから `restoreState()` で state を作る（spawn から到達できる state だけを受け付けるのは module の責務）。
- feature の state は JSON 互換の plain data で、Core が committed state に feature ごとに持って freeze する。hook が plain data でない値を返せば、startStage と tick は `stageSession.fatal`、restore は `state.invalidShape` にする。system の error は tick の fatal になる。
- `loadContent()` は load 時に 1 度だけ feature の content（pickup は `pickupsById`）を作り、Core は hook の文脈の `content` に渡す（Phase 2B-5）。
- entity を持つ feature のための hook（Phase 2B-6）: tick の文脈は basic の entity、entity id の採番（basic と同じ allocator）、feature の event（`FeatureGameEvent`、文脈の tick のものだけ）の発行を持ち、`scoring` の文脈だけがその tick に撃破された enemy と score の加算（0 以上の safe integer）を持つ。誤った event や score は fatal にする。`projectFrameState()` は frame の `state.features` を、`holdsStageClear()` は stage の clear を待たせるかを返す。restore の文脈は `nextEntityId` と basic の entity の採番 tick（`entityAllocationTicks`）を持ち、`maxAllocations()` は restore の `nextEntityId` の allocation envelope に feature が採番し得る数を足す。stage の状態は feature の state を restore した後に、`holdsStageClear()` を含めて検証する。
- feature を有効にしない content の frame は `features` を持たず、state hash、replay の golden は変わらない。pickup の state の byte 列は feature の `stateVersion` で区別するため、`SERIALIZED_STATE_HASH_VERSION` は 4 のままにした（basic の byte 列は変わらない）。
- Phase 2B-4 の時点で登録された feature はなく、state hash、replay、validate-content の golden は変わらない。Phase 2B-5 で pickup の content と gating を足した（state は `null`）。feature が共有 allocator から採番する entity の restore（allocation envelope と restore の文脈）と tick の文脈（entity、event、score）は、pickup の simulation を足す Phase 2B-6 で SPI に足す。

`StageSession.tick()` は stage session が active でない場合、`gameOver` / `stageCleared` 後、または tick mismatch 時に `CoreResult` の error を返す。precondition violation を silent no-op にしない。`gameOver` / `stageCleared` 後の余分な tick と tick mismatch は caller precondition error であり、session を fatal にしない。budget invariant 破壊、不正 state、内部 system order 違反は fatal error とし、以後の `tick()` は同じ fatal reason を返す。tick 更新は commit 前の working state で実行し、成功時だけ committed state に swap するため、部分更新された state は公開しない。Phase 1B-4 で追加済みの `serialize()` は fatal 後に error を返す。Phase 1B-5A で追加済みの `restore()` は version mismatch、top-level content / feature mismatch、top-level shape error を `CoreError[]` として返し、失敗時に既存 handle へ副作用を残さない。runtime entity、pending event、PRNG、allocator、registry reference の deep validation は Phase 1B-5B、feature state の欠落・余剰・wrong feature は Phase 1B-5C の extension state validation で扱う。

post-1B replay playback API の `createReplayPlayback()` は開始前に `ReplayPlayback.inputs` の tick が 0 から始まる連続列であること、重複と欠番がないこと、metadata の `stageId` / `difficulty` / `playerId` と一致することを検証する。さらに `enabledFeatures` が dense array で、既知 feature だけを重複なく canonical order で持つことを検証し、非 canonical な入力は並べ替えず error とする。互換性比較はこの検証に成功した metadata だけを対象にする。`coreVersion` は SemVer として検証し、完全一致は保証対象、同一 major の不一致は warning 付き best-effort、major mismatch は error とする。`schemaVersion` と `inputFormatVersion` は opaque epoch、`contentVersion` は title / content pack をまたいで一意な immutable release identity として扱い、いずれも完全一致だけを許可する。`ReplaySession.tick()` は現在 cursor の input を消費し、cursor を 1 進める。入力列をすべて消費した時点で stage が terminal state なら `replayFinished` terminal frame を 1 回返し、それ以後の `tick()` は terminal precondition error を返す。入力列を消費し切っても stage が active の場合は replay truncation error を返す。`ReplaySession.serialize()` は `SerializedReplayPlaybackState` として replay cursor を含め、`restoreReplayPlayback()` は次に読む input index を復元する。

Replay metadata は用途ごとに分ける。`ReplayMetadata` は互換性確認と表示用の未検証 DTO であり、型は `enabledFeatures` の要素型と readonly 性だけを保証する。canonical order と重複禁止は playback validator が保証し、検証前の DTO を互換性比較へ渡さない。`ReplayPlayback` は metadata と入力列を持つ再生入力、`RuntimeDroppedTicks` は Runtime 診断 metadata であり Simulation の入力列ではない。

- Full replay 必須: `ShootingCore.coreVersion` から記録した `coreVersion`、`schemaVersion`、`content.version`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId`、canonical `enabledFeatures`、platform-independent `seed`、入力列。
- optional diagnostics: `RuntimeDroppedTicks` log、runtime build info、browser timing summary。
- 検証用: tick ごとの state hash、PRNG state hash（独立 algorithm ではなく state hash format 内の `prngState` field を使う）。
- Resume 用 snapshot: `SerializedGameState` と完全な PRNG state。

完全再生は seed と入力列から再構築し、PRNG snapshot を必須にしない。途中再開 replay だけ snapshot を使う。完全再生を保証するのは `coreVersion`、`schemaVersion`、`contentVersion`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId`、検証済み canonical `enabledFeatures` がすべて完全一致する replay だけとする。SemVer として妥当な `coreVersion` の同一 major 不一致だけは `CoreResult.ok.warnings` を返して best-effort playback として開始できるが、determinism 保証対象外とする。`coreVersion` の major mismatch、または opaque epoch / release identity である他の version field の不一致は再生不可にする。`SerializedGameState` からの snapshot restore は PRNG state を直接復元するため、`coreVersion` 完全一致だけを受け付ける。PRNG algorithm の変更は必ず major version 変更として扱い、同一 major mismatch の best-effort playback 対象にしない。

State hash は replay determinism test の正本とする。

Hash 対象:

- expectedTick（次に受け付ける input tick）
- nextEntityId
- runtime entities（entity id と component values を含む単一の canonical DTO。別枠で entity id や component values を二重 encode しない）
- active pattern runner states
- active stage timeline cursor
- score
- Bomb feature 有効時だけ bomb count
- enabled feature states
- PRNG state
- next tick に持ち越す pending deterministic event queue

Hash 対象外:

- object pool の空きリスト
- render-only state
- Sprite、Tween、Particle、Camera
- DOM UI state
- audio state
- debug HUD 表示状態

Rank が無効な MVP では rank value を hash に含めない。Rank module が有効な場合だけ score/rank state として hash に含める。

State hash は canonical encoding を固定する。hash input は `stateHashVersion`、`ShootingCore.coreVersion`、`schemaVersion`、`expectedTick` を先頭に置く。`expectedTick` は次に受け付ける input tick であり、最後に完了した frame tick ではない。hash は replay / snapshot metadata の互換性検証が完了した同一 `contentVersion`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId`、canonical `enabledFeatures` 文脈内でだけ比較する。debug artifact 単体で異なる文脈を比較したい場合は、state hash 本体ではなく artifact metadata にこれらの互換性 field を必ず併記する。

entity は id 昇順、`patternRunnerStates` は `runnerId` の UTF-8 byte lexicographic order 昇順、`enabledFeatureStates` は canonical feature order で列挙する。state hash 用 DTO は public serialize DTO とは別の `HashableGameState` として定義し、`stateHashVersion`、`ShootingCore.coreVersion`、`schemaVersion`、`expectedTick`、`nextEntityId`、`timelineCursor`、`stageStatus`、`prngState`、`score`、runtime entities、pending events、pattern runner states、enabled feature states を持つ。runtime entity DTO には entity id と component values を一度だけ入れ、`entity ids` や `component values` を別配列として二重 encode しない。`lives` や `nextShotAllowedTick` は player runtime entity payload 内の field として encode する。

固定 DTO は fixedStruct として encode する。fixedStruct は `0x07` tag、struct name の UTF-8 byte length u32 little-endian、struct name bytes、field count u32 little-endian、schema 定義順の field value bytes の順に出力し、object key bytes は出さない。type discriminant を持つ union DTO では `kind` などの discriminant field も schema 定義順の通常 field として encode する。nested field は flatten せず、`position` は `fixedStruct("vector2", [x, y])`、player `movement` は `fixedStruct("playerMovement", [speed, focusSpeed])`、enemy `pathRunnerState` は `fixedStruct("enemyPathRunnerState", [segmentIndex, fixedStruct("vector2", [x, y]), segmentElapsedTicks])`、enemy bullet の `velocity` と `spawnPosition` はそれぞれ `fixedStruct("vector2", [x, y])` として encode する。たとえば player entity は現在の `HashableRuntimeEntityState` schema に合わせて `id`、`kind`、`definitionId`、`position`、`collisionRadius`、`lives`、`invincibleTicksRemaining`、`nextShotAllowedTick`、`movement`、`shotDefinitionId` の順に、enemy entity は `id`、`kind`、`definitionId`、`position`、`collisionRadius`、`hp`、`scoreOnKill`、`pathId`、`patternId`、`pathRunnerState` の順に、enemy bullet entity は `id`、`kind`、`definitionId`、`position`、`collisionRadius`、`velocity`、`spawnPosition`、`ageTicks` の順に encode する。

fixedStruct name の実行時正本は `HASHABLE_FIXED_STRUCT_NAME_BY_DTO` とし、次の表はその内容を示す。

| DTO | struct name |
| --- | --- |
| `HashableGameState` | `hashableGameState` |
| PRNG state | `prngState` |
| vector | `vector2` |
| player movement | `playerMovement` |
| enemy path runner state | `enemyPathRunnerState` |
| player runtime entity | `playerRuntimeEntity` |
| enemy runtime entity | `enemyRuntimeEntity` |
| enemy bullet runtime entity | `enemyBulletRuntimeEntity` |
| player shot runtime entity | `playerShotRuntimeEntity` |
| pending event | `pendingEvent` |
| pattern runner state | `patternRunnerState` |
| enabled feature state | `enabledFeatureState` |

`HashableGameState` の canonical byte sequence または digest 表記を変え得る変更は、`stateHashVersion` を更新する。これには field order、fixedStruct name、type tag、length / endian 規則、UTF-8 key sort、`-0` 正規化、number encoding、hash algorithm、seed、digest hex 表記を含む。byte / digest が不変であることを golden で確認できる内部リファクタだけは version 更新を要しない。

extension payload のような任意 object だけは object tag、property count、key length + key bytes、value を UTF-8 byte sequence の lexicographic order で encode する。string value と object key はどちらも lone surrogate を拒否する。各値は 1 byte の type tag から始め、tag table は `0x00 = null`、`0x01 = false`、`0x02 = true`、`0x03 = number`、`0x04 = string`、`0x05 = array`、`0x06 = object`、`0x07 = fixedStruct` とする。可変長 payload は unsigned 32 bit little-endian の byte length または element count を付ける。string は tag、byte length、UTF-8 bytes の順に encode する。array は tag、element count、各 value の順に encode する。number は finite number のみ許可し、`-0` は `+0` に正規化したうえで IEEE-754 binary64 little-endian bytes としてエンコードする。これにより斜め移動で発生する `Math.SQRT1_2` 由来の座標も合法な hash 対象にする。浮動小数点文字列化、`localeCompare`、JavaScript の object key order には依存しない。

basic core の canonical encoder は public content loader ではなく、Core 所有 DTO と validation 済み extension payload だけを受け取る internal helper とする。上流の content / restore JSON validation が untrusted input の byte / node budget を適用し、canonical encoder の reflection check は DTO 境界を越える accessor、symbol、Proxy failure を検出するための防御層として使う。hash 処理の resource budget は、string と fixedStruct name を UTF-8 8 KiB 以下、単一 array / object / fixedStruct fields を 10,000 entries 以下、値 tree 全体を 100,000 container entries 以下、object key の UTF-8 byte 合計を object ごとに 256 KiB 以下、出力 byte stream を 2 MiB 以下に制限する。上限超過、accessor / symbol / non-enumerable / array additional property、循環、反射時の Proxy failure は canonical input error として拒否する。incremental digest sink は callable な `write()` を必須とし、不正な sink は byte を出力する前に `TypeError` として拒否する。書き出し中に canonical input error または sink callback failure になった場合、それまでに渡した byte 列は未完了なので呼び出し側は sink ごと破棄する。sink callback failure は変換せずに伝播し、再試行は新しい sink で先頭から始める。

hash algorithm は `xxHash64`、seed は safe integer に丸めず `0x53484f4f54494e47n` の BigInt literal または hi/lo uint32 pair `{ hi: 0x53484f4f, lo: 0x54494e47 }` として渡す。出力は lower-case 16 桁 hex と固定する。algorithm 変更時は `stateHashVersion` を上げる。PRNG state hash は独立した algorithm を作らないが、debug artifact 用に単独 digest が必要な場合は `fixedStruct("prngState", [state])` として、`0x07` tag、`prngState` name、field count `1`、`prngState.state` の canonical number bytes を state hash と同じ xxHash64 seed / output format で比較する。現在 tick で出力済みの `GameFrame.events` は hash 対象外とし、serialize/restore 後も残る pending queue だけを hash に含める。

## 21. 検証とテスト

### 21.1 Unit Test

- Phase 2B: Pattern DSL の解釈
- Stage timeline の spawn 順
- Phase 1A: `fireOnSpawn` による enemy bullet 生成、次 tick での非再発火、`enemyBulletsSpawnedBatch` と player shot の event order
- Collision
- Score
- Difficulty modifier
- Replay determinism
- PathRunner の合成式
- public frame snapshot に runtime-only field が漏れないこと

### 21.2 Schema Test

- `content/` 以下の全 YAML をスキーマ検証する。
- namespace ごとの重複 ID を検出する。
- 未定義 asset key、stage id、player id、enemy id、boss enemy id、enemy bullet id、player shot id、pattern id、path id を検出する。
- `PatternDefinition.fireOnSpawn.bullet` の namespace と存在確認、`offset` の数値制約、timeline spawn 位置との合成結果が有限座標になることを検証する。
- feature 有効時だけ、bomb id、pickup id、scoring rule id、rank rule id、affinity rules id を検出する。
- basic core では `defaultPlayerId`、`startStage()` に渡す `stageId`、`playerId`、`difficulty` を registry と stage definition に対して検証する。
- feature module 導入後は、enabled feature に応じて `defaultAffinityRulesId`、`defaultScoringRuleId`、`defaultRankRuleId` も registry に対して検証する。
- feature module 導入後は、Bullet、Enemy、Player、PlayerShot、Pattern の `affinity` 値が `none` または選択された `AffinityRules.values` に含まれることを検証する。
- feature module 導入後は、`enabledFeatures` の matrix test を持つ。各 feature について、disabled で未使用定義だけがある場合は warning、disabled で参照された場合は error、enabled で valid reference の場合は pass、enabled で不正 reference の場合は error になることを検証する。
- feature module 導入後は、feature 間依存の matrix test を持つ。`advancedScoring + graze`、`advancedScoring + pickup`、`rank + bomb`、`bomb + pickup refill` は依存 feature が揃う場合だけ pass し、片方だけ有効な参照は error にする。
- settings migration は旧 `settingsVersion`、破損 JSON、未知 action、重複 binding の fixture を持ち、Runtime が default fallback または migration 済み settings を返すことを検証する。
- package boundary test では root export と feature ごとの `./features/<feature>` 以外の runtime / type-only deep import を拒否し、public type contract は内部 runtime component や system result、feature の module（`FeatureModule`、`defineFeature()`）が root に漏れないことを検証する。
- public API 境界は getter、Proxy、prototype 継承 property、巨大 input、非 JSON 互換値を validation 前に拒否し、例外を漏らさないことを検証する。

### 21.3 DSL Semantic Test

Pattern DSL と Stage timeline は、単純な構造検証に加えて意味検証を行う。

Parse 後は `PatternProgram` として正規化する（`packages/shooting-core/src/basic/patterns/pattern-program.ts`）。命令列に分岐や乱数はないため、runner が止まる位置（cursor）ごとに、次の `wait` か末尾まで実行する命令のまとまり（run）を load 時に 1 度だけ求める。

```ts
type PatternProgram = {
  patternId: PatternId;
  length: number;
  stepCount: number; // 元の top-level の step 数
  runs: ReadonlyMap<number, PatternRun>; // run を始められる cursor（0、wait の直後、length）ごとの run
};

type PatternRun = {
  fires: readonly PatternFireCommand[];
  bulletCount: number;
  executedCommands: number;
  executedSteps: readonly number[];
  next: { cursor: number; waitTicks: number } | null;
};

// spawn から実行する run の時刻表から求める静的な予算（patterns/pattern-budget.ts）。
type PatternStaticBudget = {
  maxBulletsPerRun: number;
  maxCommandsPerRun: number;
  firstFireTicks: number | null;
  cycle: { durationTicks: number; bullets: number } | null;
  unreachableSteps: readonly number[];
};
```

- `wait`、`interval`、`duration` は正の整数である。
- `loop` の target は存在する step index である。
- `repeat` の回数は上限以内である。
- `fan.count`、`radial.count`、`speed`、`accel` は content validation の安全上限以内である。
- `parallel` の branch 数と同時生成弾数は上限以内である。
- 静的に検出できる無限ループは validation error にする。
- 静的に判定できないループは runtime budget を持ち、1 tick 内の pattern command 実行数が上限を超えたら content error として停止する。

Phase 2A-5 の最小 subset（`wait` / `fire` / `loop`）では、`loop` が前の step へだけ戻り、戻り先から loop までの間に `wait` を含むことを validation で要求して静的な無限ループを拒否する。1 tick の命令数は 2,000 を runtime budget とし、超えた tick は `pattern.budgetExceeded` の fatal にする。

Phase 2B-1 の意味の検証（`content/validation/pattern-semantics.ts`）: shape と参照の検証に通った content の各 pattern を `PatternProgram` にし、spawn から実行する run だけを見て静的な予算を求める。

- 1 run の弾数が敵弾の active 上限（2,000）を超える pattern と、1 run の命令数が 1 tick の命令数の上限（2,000）を超える pattern（`repeat` を展開すると起き得る）は、その run の tick に必ず fatal になるため `definition.invalidConstraint` の load error にする。loop より後ろのように spawn から実行されない run は数えない。
- 一度も撃たない pattern（`pattern.neverFires`）と、spawn からどの run でも実行されない step（`pattern.unreachableStep`、`loop` より後ろの step など）は、動作はするが書き間違いの可能性が高いため warning にする。warning は `CoreResult.warnings` で返し、content に error がある間は返さない。
- difficulty の `if` を持つ pattern（Phase 2B-3）は、pattern を使う stage の difficulty ごとに（どの stage も使わない pattern は既知の difficulty すべてで）予算を求め、どれかの difficulty で上限を超えれば error にする（message に超えた difficulty を書く）。`pattern.neverFires` はどの difficulty でも撃たないときだけ出す。`loop` は top-level にだけ置けて前へ戻るため、step に届くかは difficulty によらない。
- どの difficulty でも使われない `if` の枝（`pattern.unusedBranch`）も warning にする。`if` に届く difficulty（外側の `if` で絞った後）にない difficulty を `if.difficulty` が挙げていれば `if.difficulty` に、届く difficulty がすべて `then` を使うなら `if.else` に出す。
- `CoreWarning` は error と同じく optional の `schemaPath` と `referrerId` を持ち、validate-content は warning を YAML の該当 step（never fires は `steps` 全体）へ向けて exit code 0 の schema diagnostic として出す（CLI golden の `pattern-warning`、`pattern-silent`、`pattern-budget-error`、`pattern-difficulty-warning`）。
- 静的な予算は runtime の状態を変えないため、state hash と replay は変わらない。

### 21.4 Golden Test

特定 seed、特定入力、特定 stage に対して、指定 tick の状態 snapshot を比較する。

例:

- 300 tick 時点で敵が 5 体存在する。
- 600 tick 時点で敵弾が 42 発存在する。
- 同じ replay は同じ score になる。

Replay divergence 調査では、各 side の status、parse 後の immutable `InputFrame`、state hash、順序付き `GameFrame.events` の完全 payload を tick ごとに比較し、いずれかが最初に異なる checkpoint を特定する。state hash が同じでも event の欠落、順序、payload が異なれば divergence とする。初期 checkpoint は `frameTick: null` / `checkpointTick: 0`、tick 処理後は `checkpointTick === frameTick + 1` とし、frame と post-tick state を同じ数値で誤結合しない。Golden test は最終 hash だけで失敗させず、この first divergent checkpoint を報告する。

比較前に expected / actual の raw `ReplayMetadata` を内部 validator へ通し、未知 feature、重複、canonical order 違反を拒否した `ValidatedReplayCompatibilityMetadata` を作る。互換性 field が一致しない場合は state divergence report を作らず compatibility diagnostic を返す。report には validator が artifact 用 plain DTO へ投影した両 metadata を残す。入力は side ごとに保持し、同じ入力列を前提にする場合でも一致を検証してから比較する。

```ts
type ReplayDivergenceReport = Readonly<{
  schemaVersion: "1";
  artifactName: string;
  replayId: string;
  firstDivergentFrameTick: number | null;
  firstDivergentCheckpointTick: number;
  expectedMetadata: ReplayCompatibilitySnapshot;
  actualMetadata: ReplayCompatibilitySnapshot;
  expected: ReplayDivergenceSide;
  actual: ReplayDivergenceSide;
  inputDiff: readonly ReplayDiffItem[];
  entityDiff: readonly ReplayDiffItem[];
  componentDiff: readonly ReplayDiffItem[];
  eventDiff: readonly ReplayDiffItem[];
  prngStateDiff: ReplayDiffItem | null;
}>;

type ReplayDivergenceSide =
  | Readonly<{
    status: "ok";
    inputFrame: InputFrame | null;
    stateHash: string;
    summary: HeadlessDebugStateDump;
    state: HashableGameState;
    events: readonly GameEvent[];
  }>
  | Readonly<{ status: "missing"; inputFrame: InputFrame | null }>
  | Readonly<{ status: "error"; inputFrame: InputFrame | null; errors: readonly CoreError[] }>;

type ReplayDiffItem = Readonly<{
  path: string;
  expected: ReplayDiffValue;
  actual: ReplayDiffValue;
  entityId?: number;
  component?: string;
}>;

type JsonValue = null | boolean | number | string | readonly JsonValue[] | Readonly<{
  [key: string]: JsonValue;
}>;

type ReplayDiffValue = JsonValue | Readonly<{ kind: "missing" }> | Readonly<{
  kind: "error";
  codes: readonly string[];
}>;
```

CI artifact path は `artifacts/replay-divergence/<replayId>-tick-<tick>.json` とし、path の `<tick>` は `firstDivergentCheckpointTick` に固定する。片側だけ replay が終了した場合は `missing`、片側の `tick()` だけ失敗した場合は `error` side として artifact を生成し、存在しない state / events を必須扱いしない。

Phase 1C-4 の field-level diff は root package へ公開しない test helper として `packages/shooting-core/src/basic/testing/` に置く。

- `recordReplayTraceForTest(loadedGame, startOptions, inputs)` は hook-enabled `LoadedGame` で stage を開始し、初期 checkpoint と各 tick 後の checkpoint を `ReplayTrace` として記録する。trace の `ReplayMetadata` は開始した session の serialize 結果と `startOptions.seed` から作り、記録した run と食い違わせない。`tick()` または checkpoint capture が失敗したら、その checkpoint を `error` として記録して止める。`inputFrame` は Core と同じ正規化で parse した値とし、parse できない入力は `null` で残す。
- `compareReplayTracesForTest(replayId, expected, actual)` は `match` / `divergence` / `incompatible` / `invalid` を返す。両 metadata の検証失敗と、checkpoint が tick 順に連続しない、`ok` checkpoint の state / summary が別 tick を指す、`error` が最後でない、といった trace 不正は `invalid`、互換性 field の不一致は `incompatible` とし、どちらも report を作らない。
- `ValidatedReplayCompatibilityMetadata` は `ReplayMetadata` の全 field を検証した型だけの brand 付き値で、`ReplayCompatibilitySnapshot` はそれを `ReplayMetadata` と同じ field 順の plain DTO へ投影したもの。validator は `coreVersion` の SemVer、非空の version / seed、`stage.*` / `player.*` namespace、difficulty、既知 feature だけを重複なく canonical order で持つ `enabledFeatures` を検証し、並べ替えや補完はしない。
- 互換性は full replay の再生条件に合わせる。`coreVersion` は同一 major の不一致だけを warning 付きで比較し、major 不一致は `incompatible` とする。`schemaVersion`、`contentVersion`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId`、`enabledFeatures`、`seed` は完全一致だけを比較可能とする。seed が違う run は同じ replay ではないため state divergence にしない。
- checkpoint の一致判定は status、parse 後の input、`ok` 同士の state hash と順序付き event 列、`error` 同士の error code 列で行う。
- 両側 `ok` の diff は runtime entity を id で対応付け、片側だけの entity と kind 違いを `entityDiff`、同じ entity の field と state 直下の field（`expectedTick`、`nextEntityId`、`score` など）を `componentDiff`、`prngState.state` を `prngStateDiff`、event 列を index ごとに `eventDiff` へ置く。object は key、array は index で再帰し、異なる leaf だけを `state.runtimeEntities[id=1].movement.speed` のような path で残す。entity の field diff は `entityId` と `component`（entity の top-level field 名）、state 直下の field diff は `component` だけを持つ。
- 片側が `missing` / `error` の場合は field 単位で比べられないため、`componentDiff` の `stateHash` と `eventDiff` の `events` の1件ずつで、観測値と `{ kind: "missing" }` / `{ kind: "error", codes }` を並べる。`entityDiff` は空、`prngStateDiff` は `null` とする。`error` side の `errors` は Core error に加え、hash を作れない場合の test-only `debugState.hashFailed` を含み得る。
- checkpoint capture は session を進めず、fatal latch もしない読み取り helper とする。committed state から hash DTO を作れない場合は内部 error をそのまま返し、recorder はその checkpoint を `error` side にする。

### 21.5 Browser Test

- 起動できる。
- canvas が非空で描画される。
- キー入力で移動できる。
- HUD が更新される。
- debug overlay を表示できる。
- screenshot diff で playfield、HUD、letterbox、DOM overlay alignment の崩れを検出する。
- viewport は desktop、mobile 相当、`384x448` 未満の fractional downscale、resize 後を含める。
- DPR は 1 と high DPI 相当で canvas と DOM overlay の座標一致を検証する。
- debug state dump で tick、seed、entity 数、bullet 数、player 座標、viewport scale、DPR、overlay transform を検証する。
- browser test と同じ replay input を別の Node headless smoke test にも渡し、同一 replay の state hash が一致することを確認する。browser dump 自体には内部 hash を公開しない。

Screenshot diff は flaky になりやすいため、CI では tolerance と mask を使う。判定の正本は debug state dump と deterministic replay smoke test に置き、screenshot diff は視覚崩れ検知の補助とする。

Phase 1C の debug state dump は headless/core dump とし、root package へ公開しない package-internal test helper の `serializeDebugStateForTest(session)` から取得する。利用時は test process で `SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS=1` を設定し、`createShootingCoreWithTestingHooksForTest()` から作った session を渡す。通常の `createShootingCore()` から作った session は serializer 未登録として例外で拒否する。これらの helper / factory は package root や deep package subpath から import できる public API にしない。

`tick` は state hash の `expectedTick` と同じく、その committed checkpoint が次に受け付ける入力 tick を表す。開始時の seed は replay snapshot に保存しないため、`startStage()` から作った session では元の文字列、`restore()` から作った session では `null` とする。seed の有無は state hash へ影響させない。canonical hash の resource budget 超過などで digest を生成できない場合、helper は throw せず `debugState.hashFailed` の test-only result error を返す。この内部 code は root 公開の `CoreErrorCode` union へ追加しない。

`entityCounts` は現在の committed entity、`eventCounts` と `collisionCandidates` は直前に成功して commit された tick を表す。start / restore 直後はまだ成功 frame がないため、未計測を実測ゼロと区別して両 field を `null` にする。最初の成功 tick では pending `stageStarted` を含む実際の frame event を集計し、以後も成功 tick ごとに置き換える。非fatalな失敗 tick では直前値を保持し、fatal latch 後は破損し得る committed snapshot をdumpせず `stageSession.fatal` errorを返す。`collisionCandidates` は broad phase を通過した collider の組の数（問い合わせごとに grid が返した候補数の合計で、narrow phase の早期終了や撃破済み enemy の読み飛ばしの前に数える）とし、render-only state や object pool state と同様に state hash / serialize 対象へ含めない。Phase 2A-7 までは narrow phase の円判定を実行した組の数だった。

collision / event metrics は test serializer が登録された session でだけ収集する。通常の `createShootingCore()` session では collision counter、event count object、freeze を tick hot path に生成せず、Core の本番性能へ test-only diagnostics の費用を持ち込まない。

Browser Test では Phase 2A 以降に `apps/sample-title` が `BrowserDebugStateDump` を所有し、最新の public `GameFrame` と runtime adapter の lifecycle / viewport / input / asset / audio / overlay state から `window.__SHOOTING_DEBUG_STATE__()` を組み立てる。この global hook は dev / test build にだけ設置し、production build では定義しない。sample app は Vite の mode が `production` でないとき（dev server と `vite build --mode test`）だけ `src/debug/debug-state-hook.ts` で hook を置き、production build では分岐ごと消える。`apps/sample-title/vite/dev-only-build.test.ts` が production と test の mode で app を build し、hook 名（と Phase 2B-9 の Preview の印）が test の bundle にだけ含まれることを検査する。browser schema は headless dump を継承せず、Core 内部の `stateHash`、`prngHash`、`collisionCandidates` を含めないため、非公開 helper のdeep importや新しいCore diagnostics portを必要としない。

Browser の入力の再生（Phase 2A-12）: dev / test build は stage ごとに Core が受け付けた `InputFrame` を残し（`StageLoop` の `recordInputs`）、dump の schema の外にある `window.__SHOOTING_DEBUG_REPLAY__()` が `BrowserReplayRecord`（`schemaVersion: "1"`、`kind: "browserReplay"`、開始条件の `stage`（stageId / difficulty / seed）、`inputs`、最後の入力の後の serialize 結果 `state`）を返す（`src/runtime/debug/browser-replay-record.ts`）。Node の headless replay は `stage` を始めて `inputs` を順に渡し、`state` と同じ serialize 結果に着くことを、`serialize()` の JSON の SHA-256 で比べる。Core の内部 hash は browser に出さない。

Phase 2A-12 の Browser test（`apps/sample-title/e2e/`、`npm run test:browser`）:

- Playwright の Chromium で、`vite build --mode test` の bundle を `vite preview` で配って試す。node:test の `npm test` と `npm run check` には含めない。
- smoke: 起動して asset を読み終え title に進むこと、canvas に自機が描かれること（screenshot の自機の中心が背景色でない）、矢印 key で 4 px / tick、Shift を押すと 1.8 px / tick で動き、低速移動中は自機の中心に当たり判定が出ること、drone を倒すと HUD の score が変わること、Backquote / F3 で debug overlay を切り替え、pause 中の自機のまわりに collider が描かれることを、dump と screenshot の画素で確かめる。
- viewport: desktop（DPR 1）、high DPI（DPR 2）、mobile 相当（Pixel 7）、playfield より小さい窓（320x400）と、resize の後で、dump の `viewport` が `computeViewportLayout()` と一致し、canvas の画素数が render scale 倍、canvas の実際の位置と大きさが `overlayTransform` と一致し、scroll が出ないことを確かめる。
- replay: 移動、低速移動、shot を含む入力で遊んで pause し、再生記録を Node で再生して、tick、kind 別 entity 数、自機座標が dump と、serialize 結果の digest が記録の `state` と一致することを確かめる。
- screenshot diff は title 画面だけを対象にした補助とし、debug HUD を mask して画素の 2% までの差を許す。font の描画は OS で違うため、baseline は platform ごとに commit する。

CI artifact path は `artifacts/debug-state/<test-name>-tick-<tick>.json` とする。`test-name` は 1..128 文字の lower-case ASCII slug とし、英数字の区間を `.`, `_`, `-` のいずれか1文字で区切る。test helper はこの規則と non-negative safe integer tick を検証し、`/`、`\\`、`..` を artifact path へ流さない。JSON artifact は schema 固定の property order、2-space indent、末尾 LF で固定し、caller object の property 挿入順へ依存させない。

```ts
type HeadlessDebugStateDump = Readonly<{
  schemaVersion: "3";
  kind: "headless";
  // committed state が次に受け付ける input tick
  tick: number;
  seed: string | null;
  stateHash: string;
  prngHash: string;
  entityCounts: Readonly<Record<"player" | "enemy" | "enemyBullet" | "playerShot", number>>;
  collisionCandidates: number | null;
  eventCounts: Readonly<Record<
    | "stageStarted"
    | "tickAdvanced"
    | "entitySpawned"
    | "entityDestroyed"
    | "playerHit"
    | "playerShotsSpawnedBatch"
    | "enemyBulletsSpawnedBatch"
    | "scoreChanged"
    | "stageCleared"
    | "gameOver",
    number
  >> | null;
}>;
```

`eventCounts` は `GameEvent` の全 type を持つ。Phase 2A-6 で `stageCleared` と `gameOver` を加え、`schemaVersion` を 2 に上げた。Phase 2B-6 で pickup feature の `pickupsSpawnedBatch` と `pickupCollected` を加え、`schemaVersion` を 3 に上げた。

Phase 1C-4 では、上記 headless summary schema、artifact naming、state / PRNG hash、count metrics と、21.4 の field-level replay divergence artifact を実装済みである。summary dump だけから entity / component / event / PRNG の値は復元できないため、field-level diff は検証済み replay compatibility metadata と expected / actual の各 `ReplayDivergenceSide` を入力にする。`ok` side だけが `HashableGameState`、順序付き `GameFrame.events`、parse後の `InputFrame`、summaryを持ち、早期終了とtick失敗は `missing` / `error` として扱う。`HeadlessDebugStateDump` はreportの各`ok` sideに置く概要fieldであり、deterministic snapshotの代用にはしない。

Phase 2A の browser/runtime dump は次の別 schema とする（Phase 2B-7 で `entityCounts` に pickup feature の `pickup` を加え、`schemaVersion` を 2 に上げた）。

```ts
type BrowserDebugStateDump = Readonly<{
  schemaVersion: "2";
  kind: "browser";
  tick: number;
  seed: string | null;
  lifecycle: GameLifecycleState;
  entityCounts: Readonly<Record<"player" | "enemy" | "enemyBullet" | "playerShot" | "pickup", number>>;
  playerPosition: Readonly<{ x: number; y: number }> | null;
  viewport: Readonly<{
    logicalWidth: number;
    logicalHeight: number;
    scale: number;
    devicePixelRatio: number;
    letterboxX: number;
    letterboxY: number;
  }>;
  inputQueueDepth: number;
  assetStatus: "loading" | "ready" | "error";
  audioStatus: "muted" | "suspended" | "running" | "error";
  overlayTransform: Readonly<{ x: number; y: number; scale: number }>;
  debugOverlay: boolean;
}>;
```

Phase 2A-10 の sample app の実装（`src/runtime/debug/browser-debug-state.ts`）:

- `tick` は headless dump と同じく現在の stage が次に受け付ける入力 tick（実行済みの tick 数）とし、stage の外と開始演出中でまだ tick を実行していなければ 0 にする。`seed` は現在の stage の seed、stage の外では `null`。`entityCounts` と `playerPosition` は直近の `GameFrame.state` から作る（`pickup` は `state.features.pickups` の数）。
- `viewport` は `computeViewportLayout()` の配置、`overlayTransform` は DOM overlay の実際の `getBoundingClientRect()` の位置と内部解像度からの倍率で、canvas と overlay が同じ transform root にあれば両者は一致する。
- `inputQueueDepth` はまだ tick や render frame に渡していないラッチ済みの押下・解放 edge の数、`assetStatus` は loading の asset の状態（stage を始められない失敗なら `error`）、`audioStatus` は Phase 2A では `muted`。
- `debugOverlay` は debug overlay を表示しているかで、Phase 2A-12 の browser smoke test が切り替えを確かめるために加えた。

### 21.6 初期マイルストーン受け入れテスト

初期 playable milestone では、以下を合格条件にする。

| 対象 | テスト |
| --- | --- |
| `content/stages/stage_01.yaml` | Schema test で stage/enemy/path/pattern/bullet/asset 参照を検証する |
| 敵撃破 | Unit test で HP 減少、撃破 event、score 加算を確認する |
| 3-way 弾幕 | Golden test で指定 tick の弾数、角度、seed 再現性を確認する |
| 低速移動 | Unit test と Browser test で移動倍率と当たり判定表示を確認する |
| debug overlay | Browser test で collider 表示の toggle を確認する |
| browser smoke | Browser test で起動、canvas 非空、HUD 更新、screenshot diff、debug state dump、deterministic replay smoke を確認する |

Phase 2A-11 の sample title（`apps/sample-title/`）の実装:

- `content/stages/stage_01.yaml` は 6 wave（自機の列へ降りる drone、左右から弧を描く drone、横から波打って横切る scout、降りて揺れる scout、V 字の drone、扇状弾と狙い弾を交互に撃つ gunship と護衛の scout）で 26 体を出す約 37 秒の stage とする。敵は drone（HP 5、50 点）、scout（HP 10、100 点）、gunship（HP 200、2,000 点）で、自機 shot は 1 発 5 damage。どの path も最後に enemy を playfield の cleanup 余白（64 px）より外へ運ぶため、timeline を終えて全滅か退場で stage が clear になる。
- schema test（`src/sample-content/content-references.test.ts`）は、sample content が diagnostic なしで検証に通ること、全 definition と asset が stage 1 と既定の自機から参照されていること、stage の enemy / path / pattern、pattern の bullet、enemy の asset、自機の shot の参照を 1 つずつ壊すと参照元の file に対応する code（`enemy.notFound` など）が出ることを確かめる。
- 敵撃破の unit test（`src/sample-content/stage-01.test.ts`）は、sample の scout と drone を自機の正面に置いた stage で、serialize した HP の減少、`entityDestroyed`（defeated）、`scoreChanged` と score の加算を確かめる。
- headless replay golden（`src/sample-content/stage-01-replay.test.ts`）は、80 tick ごとに左右へ往復しながら撃ち続ける input script で stage 1 を固定 seed で再生し、checkpoint（score、残機、kind 別 entity 数、自機座標、serialize した state の SHA-256）、撃破と score、被弾、最初の 3-way の角度を golden と比べる。Core の state hash は test 用の内部 helper でだけ求まるため、app は公開の `serialize()` の JSON を hash する。同じ seed で同じ run になることも確かめる。golden は `UPDATE_SAMPLE_TITLE_GOLDENS=1` で作り直す。
- 3-way の golden（弾数、角度、seed 再現性）は Core の `session/enemy-pattern-tick.test.ts` にもあり、sample の golden は sample content の 3-way（30° に 3 発で隣との差 15°）を確かめる。

Phase 2B では `docs/content-authoring/examples/` を `validate-content` に通し、docs 例と schema の drift を検出する。Preview scene は Browser test で stage/enemy/pattern/path 選択、pause、step 1 tick、seed 変更、difficulty 切替、overlay 表示を確認する。

## 22. 開発フェーズ

### Phase 1A: Core minimum contract

- TypeScript package セットアップ
- `packages/shooting-core` の最小型定義
- Content schema minimum
- Registry validation minimum
- Fixed tick
- Entity/Component
- `InputFrame`
- immutable event log
- PRNG
- Player / Enemy / EnemyBullet / PlayerShot / Stage / Path / minimum Pattern schema
- renderer 非依存の Player movement / shot movement / lifetime / fire interval / enemy bullet fireOnSpawn minimum
- system order lock
- fixed `scoreOnKill` scoring system
- Collision minimum
- Unit test

Phase 1A の完了条件は、Core minimum が renderer なしで deterministic に tick 更新できることとする。Core package は Vite、Phaser、DOM、fetch、localStorage に依存しない。

### Phase 1B: Determinism contract

- `serialize()` / `restore()`
- replay metadata
- state hash
- golden test
- locked system order と state hash の互換性検証

Phase 1B の完了条件は、同一 seed と入力列で state hash が一致し、restore 後も同じ tick 結果を返すことに加え、完全 replay に必要な readonly `ReplayMetadata` の field と root type export 境界が型契約で固定されていることとする。

### Phase 1C: Tooling minimum

- `validate-content` CLI MVP
- `tools/validate-content` package
- `fixtures/content-minimum/`
- `fixtures/game-definition.minimum.yaml`
- debug state dump
- CLI JSON / human output
- exit code / severity
- schema / reference / performance budget validation

Phase 1C の完了条件は、content authoring と CI で最低限の validation が使えることとする。

### Phase 2A: Minimum playable

- Vite sample app セットアップ
- Phaser セットアップ
- Phaser adapter
- Core `GameFrame` を読む Player 描画
- Core `InputFrame` へ変換する keyboard adapter
- 低速移動の入力 adapter / 表示確認
- 自機判定表示
- Core event / state からの bullet / shot 描画
- Core collision event の HUD / 演出反映
- Debug overlay
- Stage timeline の sample content 読み込み
- Enemy / Bullet / PlayerShot definition の sample content 読み込み
- Path movement minimum（velocity segment）と enemy bullet movement / cleanup
- 最小 pattern command subset
- 残機切れと timeline 消化後の全滅による stage の最小終了判定
- collision broad phase grid
- Asset manifest
- サンプルステージ 1 つ
- Browser smoke test

Phase 2A の完了条件を初期 playable milestone とする。Phase 2A は 2A-0〜2A-13 の slice で完了し、23 の各項目と 21.6 の受け入れテストを test または手動確認に対応付けた判定を `docs/implementation-plan.md` の「Phase 2A 完了判定」に置いた。

### Phase 2B: Authoring / content expansion

- Pickup definition
- Pickup collision / pickup score
- Pattern DSL
- DSL semantic validation
- sample content spec
- minimal YAML examples
- content authoring error guide
- Preview scene
- Browser regression test

Phase 2B の成果物には sample content spec を含める。sample stage は schema、golden test、browser smoke、docs の例と同期させ、仕様の実質的な正本として扱える品質にする。

Phase 2B のタスク分割と範囲の決定（Pattern DSL は load 時に run へ展開できる `repeat`、`radial`、`stream`、difficulty の `if` までにすること、pickup を最初の feature module にして drops を乱数なしで出すこと、scoring rule は `advancedScoring` と一緒に後へ回すこと、Preview の overlay は公開の `serialize()` から読めるものに限ること）は `docs/implementation-plan.md` の「Phase 2B タスク分割」に置いた。

### Phase 3: プレイフィール

- グレイズ
- ボム
- 弾消し
- hit stop
- screen shake
- 属性切替
- rank
- replay UI

### Phase 4: 再利用性

- `shooting-core` とタイトル固有 content の分離
- Core API 整理
- Content validation CLI の公開整備
- サンプル別タイトル content
- ドキュメント整備

## 23. 初期マイルストーン

最初の playable milestone は Phase 2A の完了条件とし、以下を目標にする。

- ブラウザで起動する。
- 自機が移動し、低速移動できる。
- 自機ショットで敵を倒せる。
- `content/stages/stage_01.yaml` で敵の出現を定義できる。
- `content/enemies/*.yaml` で敵の HP、移動、弾幕を定義できる。
- 最小 pattern command subset で簡単な 3-way 弾幕を定義できる。
- 当たり判定 debug overlay を切り替えられる。
- Phase 2B では `content/pickups/*.yaml`、`content/patterns/*.yaml` の radial 弾幕、`docs/sample-content-spec.md`、content authoring examples を追加する。

Phase 2A の完了時点で、Phase 2B の項目を除く全項目を満たした（`docs/implementation-plan.md` の「Phase 2A 完了判定」）。`content/enemies/*.yaml` は敵の HP、score、当たり判定を定義し、移動と弾幕は stage timeline の spawn ごとに `content/paths/*.yaml` と `content/patterns/*.yaml` を組み合わせる形で定義する（9.5）。

## 24. 未決定事項

初期実装では以下を暫定デフォルトにする。

- 画面サイズ: `384x448`
- ステージ形式: 縦スクロール
- 座標系: 左上原点、playfield 内 x=`0..384`, y=`0..448`
- 移動制限: 自機中心が playfield 外へ出ない
- アセット: 初期は仮素材

実装前に追加で決めるとよい項目。

- Phase 3 で属性切替を入れる場合の affinity ルール
- ボム、グレイズ、ランクシステムの優先度

## 25. 将来課題

MVP では対象外だが、再利用基盤として以下を追跡する。

| 項目 | 方針 |
| --- | --- |
| gamepad / touch | Phase 3 以降の Runtime adapter で追加する |
| localization / text resource | MVP 対象外。会話や UI text を content 化する段階で設計する |
| color / 視認性基準 | 背景と敵弾のコントラスト基準、色覚対応 palette を検討する |
| docs 分割 | Phase 1 完了時点で `docs/core-api.md`、`docs/content-authoring.md`、`docs/runtime-adapter.md` の目次を作る。正本は分割後の各文書へ移し、`docs/design.md` は概要とリンク集に縮退させる |
| asset 権利管理 | manifest schema に `license`、`author`、`source` の予約 field を持たせる |
| cheat/debug command | Phase 2B dev-only で invincible と stage jump だけ検討する |
| sample content 品質 | Phase 2B の成果物として sample content spec を作る |

## 26. 次に作るもの

Phase 1A の Core minimum contract は、TypeScript package、最小 content schema、registry validation、fixed tick、InputFrame、immutable event log、Entity/Component、seed/PRNG、Player / Enemy / EnemyBullet / PlayerShot、minimum Pattern `fireOnSpawn`、MVP collision resolution pair、fixed `scoreOnKill`、package boundary test まで実装済みである。collision broad phase は Phase 1A 完了条件ではなく、playable runtime へ向けた後続性能タスクとして残す。

Phase 1B-5D として、`LoadedGame.restore(state): CoreResult<StageSession>` の public API、top-level error boundary、PRNG snapshot の public restore error 変換、deterministic payload の shape、pending event、runtime entity の kind 別 shape / registry / runtime budget validation、accepted committed state 変換、非空 extension state の shape / JSON guard / feature mismatch 分類、transactional restore、roundtrip determinism は実装済みである。`nextEntityId` は EntityAllocator と共有する上限まで含めて `state.invalidShape` として正規化する。続く Phase 1B-6 の state hash minimum も canonical encoder、fixed seed xxHash64、gameplay digest golden、restore 後の複数 tick 一致まで実装済みである。Phase 1B-7 では metadata-only の `ReplayMetadata` を root type export し、未検証 `enabledFeatures` を replay 互換性 field として含め、snapshot 専用 `stateHashVersion` と replay playback API は公開しない境界を型契約で固定した。Phase 1C-1 では `tools/validate-content` package と immutable diagnostic / JSON / human / exit code contract、Phase 1C-2 では YAML parser、source span、CLI / filesystem boundary、Core validation adapter、Phase 1C-3 では静的な最小 content fixture と実プロセス CLI golden test、Phase 1C-4 では test-only headless debug dump、state / PRNG hash、count metrics、portable artifact path / JSON formatter と、first divergent checkpoint の field-level replay divergence artifact を追加した。Phase 1C-R では振る舞いを変えない module 分割リファクタリング（`docs/implementation-plan.md` の Phase 1C-R）、Phase 1C-S では振る舞いを変えない構造整理（同 Phase 1C-S）を完了した。Phase 1C の tooling minimum は完了し、Phase 2A へ進む条件の確認結果と minimum playable の slice 分割は `docs/implementation-plan.md` の「Phase 2A タスク分割」に置いた。

state hash は `docs/implementation-plan.md` の Phase 1B-6、replay metadata minimum は同計画の Phase 1B-7 で実装済みである。

Phase 2A（Minimum playable）は完了した。Core に path movement、enemy bullet の movement / cleanup / 上限、決定的な角度計算、`wait` / `fire` / `loop` の PatternProgram と pattern runner、残機切れと全滅による stage の終了、collision broad phase grid を加え、`apps/sample-title` に Vite / Phaser の runtime（content pipeline、固定 tick loop、keyboard input、lifecycle、DOM HUD、演出、integer scale と letterbox、debug overlay、dev / test build の debug hook）、6 wave の sample stage 1、headless replay golden、Playwright の browser smoke test を置いた。判定は `docs/implementation-plan.md` の「Phase 2A 完了判定」にある。

次は Phase 2B（22）の authoring / content expansion で、pickup、Pattern DSL の残りの命令と semantic validation、sample content spec、minimal YAML examples と error guide、Preview scene、Browser regression test を扱う。
