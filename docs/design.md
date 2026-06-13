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
| テスト | node:test + TypeScript typecheck、後続で Vitest + Playwright | Phase 1A は renderer 非依存の Core 契約を軽く検証し、Phase 2 以降でブラウザ確認を追加する |

## 4. ディレクトリ構成

```text
packages/
  shooting-core/
    src/
      basic/
        simulation/
        content/
        input/
        events/
        patterns/
      features/
        pickup/
        bomb/
        graze/
        affinity/
        rank/
        advanced-scoring/
      testing/
    package.json
tools/
  validate-content/
    src/
    package.json
apps/
  sample-title/
    src/
      runtime/
        lifecycle/
        assets/
      ui/
    content/
      stages/
      enemies/
      bullets/
      player-shots/
      bombs/
      scoring/
      rank/
      patterns/
      paths/
      pickups/
      affinities/
      player/
      assets/
        manifest.yaml
    package.json
docs/
```

実装初期は単一リポジトリ内で進めるが、Core は `packages/shooting-core` として切り出せる境界を維持する。Sample title は `apps/sample-title` に置き、Core から title 固有の asset、UI、シナリオ、テーマを参照しない。

Core package の公開対象:

```text
packages/shooting-core/src/
  basic/
    simulation/
      world.ts
      tick.ts
      entity.ts
      systems/
        movementSystem.ts
        collisionSystem.ts
        bulletSystem.ts
        enemySystem.ts
        stageSystem.ts
        scoringSystem.ts
    content/
      schemas/
      registry.ts
    input/
      actions.ts
      inputFrame.ts
    events/
      gameEvent.ts
      eventLog.ts
    patterns/
      patternRunner.ts
      commands.ts
    replay/
      serializer.ts
  features/
    <feature>/
      schemaFragment.ts
      validation.ts
      systems.ts
      register.ts
  testing/
    headlessDebugDump.ts
```

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

YAML の読み込み、ファイル探索、行番号付きエラー整形は `apps/sample-title` または `validate-content` CLI の責務とする。`packages/shooting-core` はファイルシステム、Vite の asset base、ブラウザ fetch に依存しない。

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
- Sprite、bullet view、effect view は object pool を使う。Pickup feature 有効時は pickup view も feature module 側で pool する。
- `GameFrame.events` を直接 Sprite 生成破棄に同期させず、destroy queue / spawn queue に積んで batch update する。
- 1 render frame の view create/destroy に上限を持ち、超過時は低優先度 effect を落として gameplay view を優先する。
- gameplay entity の view は欠落させない。Runtime は content validation と performance budget から stage start 前に pool sizing を見積もり、足りない場合は load error として開始を止める。mid-stage で pool が枯渇した場合、Runtime は `RuntimeEvent.viewPoolExhausted` を出し、dev では hard error、本番では safe pause / fatal overlay に遷移する。
- destroyed gameplay entity の view は destroy queue が遅延しても即時 hide / unmap する。pool への return だけを destroy queue で遅延できる。
- drop や集約を許可するのは particle、afterimage、hit spark などの render-only effect だけとする。
- render-only view state は replay/state hash に含めない。

### 5.5 `ui`

DOM overlay として HUD、メニュー、設定、リザルトを担当する。

主な責務:

- スコア、残機、ボム、ゲージ、グレイズ表示
- ポーズ、設定、キーコンフィグ
- ステージ開始/終了、リザルト
- デバッグ HUD

## 6. Game lifecycle

ゲーム全体の状態遷移は Runtime shell が所有し、Simulation は主に `playing` 中の game state を扱う。`paused`、`title`、`result` などの画面状態は UI/Runtime の責務とする。`GameLifecycleState` は `apps/sample-title/src/runtime/lifecycle/` 側の型であり、Core package の公開 API には含めない。

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

1. Stage timeline で同 tick に生成された enemy の `fireOnSpawn` を timeline order に従って解決し、`enemyBulletsSpawnedBatch` を生成する。
2. player の `pressed` / `held` shot intent を `fire.intervalTicks` で間引き、`playerShotsSpawnedBatch` を生成する。

したがって同 tick に enemy spawn、enemy bullet、player shot が重なる場合の event order は `entitySpawned`、`enemyBulletsSpawnedBatch`、`playerShotsSpawnedBatch`、`tickAdvanced` とする。
tick 0 の `stageStarted` は system order 外の pending lifecycle event として frame 先頭に drain される。

Rank feature が有効な場合だけ step 12 に rank update、Phase 2B の Pickup feature が有効な場合だけ step 6 に pickup spawn、step 12 に pickup score / collect processing を追加する。feature 追加分も登録順と entity id 昇順で安定化し、Core minimum の system order を暗黙に変更しない。

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
bomb:
  definition: null
```

`graze` と `bomb.definition` は optional である。MVP では `graze` field を持たず、`bomb.definition: null` を許可する。Graze module を有効にした title だけ `graze.radius` / `graze.oncePerBullet` を定義し、Bomb module を有効にした title だけ `bomb.default` などの定義を参照する。

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

Phase 1A の validator が受け付ける PlayerShot schema は上記の最小形である。`fire.intervalTicks` は同じ shot definition から次に発射できるまでの tick 間隔であり、`pressed` は初弾の edge、`held` は interval に従う連射 intent として扱う。発射可能条件は `input.tick >= nextShotAllowedTick` とし、発射後は `nextShotAllowedTick = firedTick + fire.intervalTicks` に更新する。同一 tick で `pressed` と `held` の両方に `shot` が含まれていても生成する batch は 1 つだけとする。発射後は Player runtime component に `nextShotAllowedTick` を保持し、public snapshot には出さず、将来の serialize / restore と state hash 対象になる内部状態として扱う。MVP では過剰な entity 生成を避けるため `1 <= fire.intervalTicks <= 60` に制限する。

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
```

`fireOnSpawn` は Stage timeline で enemy が生成された tick の `spawn bullets / player shots` step 内で player shot より先に解決し、`enemyBulletsSpawnedBatch` event と `EnemyBulletRuntimeEntity` を生成する。`offset` は enemy の spawn position からの相対座標である。`wait`、`loop`、`aim`、`fan`、speed を含む本来の Pattern DSL は Phase 2A 以降で `PatternProgram` として追加する。

将来の DSL 例:

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

Simulation 内部の座標は固定小数点として扱う。単位は `1 px = 1024 units` とし、content 上の小数値は loader で固定小数点整数へ変換する。三角関数や角度指定は pattern/path の初期化時に固定小数点テーブルまたは決定的な近似関数へ変換し、tick 中に環境依存の丸めを発生させない。Golden test の snapshot は px 表示へ戻す前の固定小数点値を比較する。

### 9.9 Pickup 定義例

Enemy の drops から参照する回収アイテムは、`content/pickups/` の定義として管理する。Pickup は Phase 2B の content authoring 拡張とし、Phase 1A / Phase 2A の minimum playable には含めない。

```yaml
id: pickup.score_small
version: 1
asset: pickup.score_small
score: 100
magnetRadius: 80
collectRadius: 10
```

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

Runtime adapter は `keydown` / `keyup` の KeyboardEvent queue を持ち、render frame 間に押下と解放が完結した短押しも edge input として保持する。tick サンプリング時は queue を action に変換し、gameplay action は `InputFrame.pressed` / `released` として次の simulation tick までラッチする。UI / lifecycle action は別の `UiInputFrame` として Runtime/UI が消費し、`InputFrame` には入れない。`pressed` と `released` は 1 tick だけ有効で、複数 catch-up tick が発生した場合は最初の catch-up tick でだけ消費する。render frame 間で press/release が完結した tap は、同じ tick の `pressed` と `released` の両方に入り、その tick の `held` には含めない。edge ordering は `pressed` を先に解釈し、その後 `released` を反映する。`held` は catch-up 中の全 tick に適用する。これにより、ボム、属性切替、pause などの短押しが欠落したり複数回適用されたりすることを防ぐ。

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

collision broad phase は playfield を固定サイズ grid に分割し、layer 別 collision pair で候補を絞り込む。総当たり判定は禁止する。高速移動 entity は current position だけで grid 登録せず、previous-to-current の swept AABB を collider 半径で膨らませた範囲で grid 登録/検索する。

MVP の collision pair:

| Pair | Broad phase |
| --- | --- |
| player vs enemyBullet | enemyBullet grid |
| player vs enemy | enemy contact grid |
| playerShot vs enemy | enemy grid |

Phase 2B で追加する collision pair:

| Pair | Broad phase |
| --- | --- |
| player vs pickup | pickup grid |

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
| simulation events / tick | 500 |
| render events / tick | 2,500 |
| pattern commands / tick | 2,000 |
| collision candidates / tick | 20,000 |
| target | 60 tick/sec |

Phase 2B 追加 budget:

| 項目 | 上限 |
| --- | --- |
| pickup | 300 |

Phase 1A では object pool はまだ実装せず、deterministic な ID 採番、batch 上限、immutable snapshot の契約を先に固定する。`fireOnSpawn` で保証する budget は同 tick の spawn 数と batch allocation の失敗時 rollback までとし、active enemy bullet 2,000 の上限、移動、cleanup、上限超過時の runtime policy は collision / lifetime system 導入時に固定する。Phase 2B 以降で負荷が見えた段階で、Core は bullet、shot と event builder に object pool を導入し、tick 中の一時 allocation を避ける。Pickup feature は pickup pool を feature module 側で持つ。ただし `GameFrame.events` として返す event はコピー済み immutable value とし、次 tick の pool 再利用で過去 frame が変化しないようにする。上限超過時は dev では hard error、本番では stage load error または content error として扱い、無音で entity を落とさない。

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
- `randomSpread` などの乱数は Core が所有する PRNG だけを使う。PRNG state は `serialize()` に完全保存し、replay metadata には検証用 hash と resume 用 snapshot として扱う。

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
| `scoreChanged` | HUD 更新 |
| `stageCleared` | リザルト遷移 |

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

Asset load failure は lifecycle の `loading` で処理する。missing、decode error、timeout は `RuntimeEvent.assetLoadFailed` または `LoadResult` として記録し、`required: true` の asset では stage start を止める。`required: false` かつ valid fallback がある場合のみ fallback asset を使える。fallback 使用は debug HUD と log に表示し、schema validation では fallback 前提の未定義 key を許可しない。

`required: false` で fallback がない asset の失敗時挙動:

| Asset type | 挙動 |
| --- | --- |
| `audio` | 無音 degrade を許可し、`RuntimeEvent.assetLoadSkipped` を記録する |
| `particle` / `effect` | render-only effect を省略できる |
| `sprite` / `atlas` / `tilemap` | `usage: gameplay` なら load error、`ui` / `decorative` なら省略可 |

## 18. Audio adapter

Audio は Runtime adapter の責務とし、Simulation は `bgmRequested`、`seRequested`、`stageCleared` などの simulation event を出すだけにする。

MVP の音量カテゴリ:

- master
- bgm
- se
- ui

pause 時は BGM を pause または duck し、SE は新規再生を止める。visibility change では state 別に扱う。`playing` / `replayPlayback` は `paused` へ遷移し、BGM pause/duck と SE 停止を適用する。`stageStarting` は lifecycle を維持したまま開始演出 timer と BGM start を停止する。`title` / `result` は menu BGM を duck または継続できるが、新規 SE は止める。Audio file の missing/decode は `loading` で検出する。

ブラウザ autoplay 制限、`AudioContext.resume()` 失敗、`HTMLAudioElement.play()` promise rejection、suspended state は loading 後にも起きるため、Runtime は `RuntimeEvent.audioPlaybackFailed` と audio status を持つ。失敗時は user gesture 待ち UI、再試行、無音 degrade を選べるようにし、Simulation の成功/失敗判定には影響させない。

## 19. Debug / authoring workflow

Debug HUD は以下を表示する。

- lifecycle state
- tick
- seed
- content version
- state hash
- PRNG state hash
- dropped tick
- entity 数
- enemy bullet 数
- player shot 数
- collision candidate 数
- simulation events / tick
- render events / tick
- pattern commands / tick
- object pool 使用量

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
- spawn position、collider、entity id、pattern cursor、PRNG hash、collision candidate 数を overlay 表示できる。
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

`validate-content` CLI の出力契約:

- human output: authoring 用の読みやすいエラー表示
- JSON output: CI / editor integration 用
- exit code 0: valid
- exit code 1: validation error
- exit code 2: tool/runtime error
- severity: `error`、`warning`、`info`

JSON diagnostic schema:

```ts
type ContentDiagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  sourceId?: string;
  path?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  schemaPath?: string;
  referrerId?: string;
  targetId?: string;
};

type ValidateContentJsonOutput = {
  schemaVersion: "1";
  contentRoot: string;
  ok: boolean;
  diagnostics: ContentDiagnostic[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
};
```

Diagnostic required fields:

| Diagnostic kind | Required fields |
| --- | --- |
| parse/schema | `code`、`severity`、`message`、`path`、`line`、`column`、`schemaPath` |
| cross-file reference | `code`、`severity`、`message`、`path`、`line`、`column`、`referrerId`、`targetId` |
| feature gate | `code`、`severity`、`message`、`sourceId`、`schemaPath` |
| tool/runtime | `code`、`severity`、`message` |

CI では `GameDefinition.enabledFeatures` と default ids を `--game-definition` で CLI に渡す。Phase 1C では sample app に依存しない `validate-content --game-definition fixtures/game-definition.minimum.yaml --content-root fixtures/content-minimum --format json` を実行する。Phase 2A 以降は `validate-content --game-definition config/game-definition.yaml --content-root apps/sample-title/content --format json` も追加する。`error` が 1 件以上あれば exit code 1 にする。warning は初期段階では non-blocking とし、editor integration は `path` / `line` / `column` を診断位置へ、`code` と `message` を表示本文へ mapping する。

DSL の失敗時挙動:

- dev: validation error、runtime budget 超過、未定義 command は hard error として停止する。
- production: stage load 前検証を原則とし、検出できるものは stage load error として開始を止める。
- production runtime: 想定外の budget 超過や content error は fatal telemetry として記録し、可能なら安全な pause/error overlay に遷移する。公式 content ではここに到達しないことを品質基準とする。

本編 runtime の開発用 cheat/debug command は Phase 3 以降に追加する。候補は stage jump、invincible、slow motion、spawn command、boss phase jump とする。Phase 2B の Preview scene 専用操作は、本編 runtime の cheat/debug command とは別扱いにする。

## 20. 再利用可能な Core API

別タイトルで再利用するため、Core の公開 API は小さく保つ。

```ts
type AssetKeyRegistry = {
  keys: string[];
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
  players: PlayerDefinition[];
  stages: StageDefinition[];
  enemies: EnemyDefinition[];
  bullets: BulletDefinition[];
  playerShots: PlayerShotDefinition[];
  patterns: PatternDefinition[];
  paths: PathDefinition[];
  features?: FeatureRegistry;
};

type FeatureRegistry = Partial<{
  bombs: BombDefinition[];
  pickups: PickupDefinition[];
  affinities: AffinityRules[];
  scoringRules: ScoringRule[];
  rankRules: RankRule[];
}>;

type GameDefinition = {
  schemaVersion: string;
  enabledFeatures: EnabledFeature[];
  defaultPlayerId: string;
  defaultAffinityRulesId?: string;
  defaultScoringRuleId?: string;
  defaultRankRuleId?: string;
  content: ContentRegistry;
};

type StartStageOptions = {
  stageId: string;
  difficulty: Difficulty;
  playerId?: string;
  seed: string;
};

type ReplayPlayback = {
  metadata: ReplayMetadata;
  inputs: InputFrame[];
};

type SerializedReplayPlaybackState = SerializedGameState & {
  replayCursor: number;
};

type SerializedGameState = {
  coreVersion: string;
  schemaVersion: string;
  contentVersion: string;
  inputFormatVersion: string;
  stateHashVersion: number;
  enabledFeatures: EnabledFeature[];
  stageId: string;
  difficulty: Difficulty;
  playerId: string;
  expectedTick: number;
  nextEntityId: number;
  prngState: SerializedPrngState;
  state: SerializedDeterministicState;
};

type GameFrame = {
  tick: number;
  state: ReadonlyGameState;
  events: ReadonlyArray<GameEvent>;
};

type CoreResult<T> =
  | { ok: true; value: T; warnings: CoreWarning[] }
  | { ok: false; errors: CoreError[] };

type ShootingCore = {
  coreVersion: string;
  load(definition: GameDefinition): CoreResult<LoadedGame>;
};

type LoadedGame = {
  startStage(options: StartStageOptions): CoreResult<StageSession>;
  restore(state: SerializedGameState): CoreResult<StageSession>;
  createReplayPlayback(replay: ReplayPlayback): CoreResult<ReplaySession>;
  restoreReplayPlayback(replay: ReplayPlayback, state: SerializedReplayPlaybackState): CoreResult<ReplaySession>;
};

type StageSession = {
  tick(input: InputFrame): CoreResult<GameFrame>;
  serialize(): CoreResult<SerializedGameState>;
};

type ReplaySession = {
  tick(): CoreResult<GameFrame>;
  serialize(): CoreResult<SerializedReplayPlaybackState>;
};
```

Runtime は `tick()` の戻り値に含まれる `GameFrame.events` を読んで描画する。

Core API は transactional とする。`load()`、`startStage()`、`restore()`、`createReplayPlayback()`、`restoreReplayPlayback()` は成功時だけ新しい handle を返し、失敗時に既存の `LoadedGame` / `StageSession` を部分更新しない。Core version は `ShootingCore.coreVersion` が持ち、content が申告する値ではない。`StageSession.tick()` は session 内の `expectedTick` を持ち、`input.tick !== expectedTick`、重複 tick、欠番 tick を caller precondition error として返すが、session を fatal にしない。Runtime は dropped tick を replay 入力として補完せず、実際に Simulation へ渡した `InputFrame` だけを保存する。

`ContentRegistry` は外部データの参照関係を検証する境界でもある。Stage の `music`、`background`、timeline 内の `enemy` と `path`、`clearCondition.bossDefeated.enemy`、Enemy の `asset`、`behavior.pattern`、Boss phase の `phases[].pattern`、Pattern の `fireOnSpawn.bullet`、Bullet/Player/PlayerShot の `asset` はすべて registry 経由で解決し、未定義 ID を schema test で検出する。Feature registry が登録された場合だけ、Pickup、Bomb、Affinity、Rank、advanced scoring の参照を追加検証する。

`load()` は registry index を生成する時点で、namespace ごとの `id` 一意性を検証する。同一 namespace 内で重複 ID があれば失敗する。別 namespace 間で同じ suffix を使うことはできるが、完全な ID は `enemy.scout`、`bullet.red_small` のように namespace prefix を含める。参照解決は配列順に依存させず、検証済み index だけを使う。

許可する namespace prefix:

| Content type | Prefix |
| --- | --- |
| StageDefinition | `stage.` |
| PlayerDefinition | `player.` |
| EnemyDefinition | `enemy.` |
| BulletDefinition | `bullet.` |
| PlayerShotDefinition | `playerShot.` |
| PatternDefinition | `pattern.` |
| PathDefinition | `path.` |
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

`load()` は `defaultPlayerId`、`defaultAffinityRulesId`、`defaultScoringRuleId`、`defaultRankRuleId` が指定されている場合に registry に存在することを検証する。`startStage()` は `stageId`、`playerId`、`difficulty` が registry と stage definition に存在することを検証し、不正な値では Simulation を開始しない。検証失敗は例外や no-op ではなく `CoreResult` の `errors` として返す。

Affinity を使う content では、Bullet、Enemy、Player、PlayerShot、Pattern が参照する `affinity` 値が `none` または選択された `AffinityRules.values` に含まれることを検証する。`defaultAffinityRulesId` が未指定の場合、`affinity` 値は `none` だけを許可する。

Player の `shot.definition`、optional な `bomb.definition`、Shot の `asset`、Bomb の `asset` と effect target、Scoring/Rank rule id も registry 経由で解決する。未定義 ID、未対応 effect、cycle する参照は load error とする。

`enabledFeatures` は optional module の境界である。MVP は `[]` を許可し、basic score は Core minimum の固定仕様として扱う。disabled feature の定義ファイルを content library として registry に含めることは許可するが、default id、stage/player からの参照、runtime input action、collision pair として使うことは禁止する。未使用の disabled feature 定義は warning、参照された disabled feature は load error にする。

`FeatureRegistry` は `Partial` だが、`enabledFeatures` に含まれる feature の registry entry は原則必須とする。空配列は「feature module は有効だが content 定義はない」状態として許可する。entry 自体が欠けている場合は configuration error とする。ただし `graze` は Player field だけで有効化できるため registry entry を持たない。

- `bomb` 無効: `PlayerDefinition.bomb.definition` は `null`、`bomb` gameplay action は登録不可、`bombClear` collision pair は無効。
- `graze` 無効: `PlayerDefinition.graze` field、player graze collider、`playerGraze` collision pair は禁止。
- `affinity` 無効: `defaultAffinityRulesId` は未指定、content の `affinity` は `none` のみ許可、`switchAffinity` gameplay action は登録不可。
- `rank` 無効: `defaultRankRuleId` は未指定、rank rule 参照と rank state は無効。
- `pickup` 無効: `EnemyDefinition.drops`、PickupDefinition からの参照、pickup collision pair、pickup score は禁止。manifest に未使用 optional asset key があるだけなら warning に留める。
- `advancedScoring` 無効: `defaultScoringRuleId` は未指定、`ScoringRule` と scoring fragment は禁止。`graze` / `pickup` score fragment は対応 feature も有効な場合だけ許可する。

Optional module は論理分離だけでなく source / export 境界も分ける。Core minimum は `packages/shooting-core/src/basic/` と root export に置く。Bomb、Graze、Affinity、Rank、Pickup、advanced scoring は `packages/shooting-core/src/features/<feature>/` に置き、feature registration を通じて schema fragments、validation rules、systems、collision pairs、input actions を追加する。root package に型名を置く場合でも、feature 固有 field は discriminated extension として扱い、enabled feature なしでは参照できない。

`StageSession.tick()` は stage session が active でない場合、`gameOver` / `stageCleared` 後、または tick mismatch 時に `CoreResult` の error を返す。precondition violation を silent no-op にしない。`gameOver` / `stageCleared` 後の余分な tick と tick mismatch は caller precondition error であり、session を fatal にしない。budget invariant 破壊、不正 state、内部 system order 違反は fatal error とし、以後の `tick()` は同じ fatal reason を返す。`serialize()` は fatal 後は error を返す。tick 更新は commit 前の working state で実行し、成功時だけ committed state に swap するため、部分更新された state は公開しない。`serialize()` と `restore()` も version mismatch、壊れた state、不正 registry、feature mismatch を `CoreError[]` として返す。

`createReplayPlayback()` は開始前に `ReplayPlayback.inputs` の tick が 0 から始まる連続列であること、重複と欠番がないこと、metadata の `stageId` / `difficulty` / `playerId` と一致することを検証する。また、`ShootingCore.coreVersion`、`schemaVersion`、`content.version`、`inputFormatVersion` の互換性を検証し、完全一致は保証対象、minor mismatch は warning 付き best-effort、major mismatch は error とする。`ReplaySession.tick()` は現在 cursor の input を消費し、cursor を 1 進める。入力列をすべて消費した時点で stage が terminal state なら `replayFinished` terminal frame を 1 回返し、それ以後の `tick()` は terminal precondition error を返す。入力列を消費し切っても stage が active の場合は replay truncation error を返す。`ReplaySession.serialize()` は `SerializedReplayPlaybackState` として replay cursor を含め、`restoreReplayPlayback()` は次に読む input index を復元する。

Replay metadata は用途ごとに分ける。`ReplayMetadata` は互換性確認と表示用、`ReplayPlayback` は metadata と入力列を持つ再生入力、`RuntimeDroppedTicks` は Runtime 診断 metadata であり Simulation の入力列ではない。

- Full replay 必須: `ShootingCore.coreVersion` から記録した `coreVersion`、`schemaVersion`、`content.version`、`inputFormatVersion`、`stageId`、`difficulty`、`playerId`、platform-independent `seed`、入力列。
- optional diagnostics: `RuntimeDroppedTicks` log、runtime build info、browser timing summary。
- 検証用: tick ごとの state hash、PRNG state hash。
- Resume 用 snapshot: `SerializedGameState` と完全な PRNG state。

完全再生は seed と入力列から再構築し、PRNG snapshot を必須にしない。途中再開 replay だけ snapshot を使う。完全再生を保証するのは同一 `ShootingCore.coreVersion`、`schemaVersion`、`content.version`、`inputFormatVersion` の replay だけとする。minor version 差分では `CoreResult.ok.warnings` に互換性 warning を返して best-effort playback として開始できるが、determinism 保証対象外とする。major version 差分では再生不可にする。

State hash は replay determinism test の正本とする。

Hash 対象:

- tick
- nextEntityId
- entity ids
- component values（Player runtime component の `nextShotAllowedTick` を含む）
- active pattern runner states
- active stage timeline cursor
- score、lives
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

State hash は canonical encoding を固定する。hash input は `stateHashVersion`、`ShootingCore.coreVersion`、`schemaVersion`、tick を先頭に置き、entity は id 昇順、component は component kind の固定順、object key は schema 定義順で列挙する。数値は固定小数点整数として little-endian 64 bit でエンコードし、文字列は UTF-8 bytes、boolean は `0x00` / `0x01`、配列は length prefix 付きでエンコードする。浮動小数点文字列化や JSON object key order に依存しない。hash algorithm は `xxHash64`、seed `0x53484f4f54494e47`、出力は lower-case 16 桁 hex と固定する。algorithm 変更時は `stateHashVersion` を上げる。現在 tick で出力済みの `GameFrame.events` は hash 対象外とし、serialize/restore 後も残る pending queue だけを hash に含める。

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
- `defaultPlayerId`、`defaultAffinityRulesId`、`defaultScoringRuleId`、`defaultRankRuleId`、`startStage()` に渡す `stageId`、`playerId`、`difficulty` を registry と stage definition に対して検証する。
- Bullet、Enemy、Player、PlayerShot、Pattern の `affinity` 値が `none` または選択された `AffinityRules.values` に含まれることを検証する。
- `enabledFeatures` の matrix test を持つ。各 feature について、disabled で未使用定義だけがある場合は warning、disabled で参照された場合は error、enabled で valid reference の場合は pass、enabled で不正 reference の場合は error になることを検証する。
- feature 間依存の matrix test を持つ。`advancedScoring + graze`、`advancedScoring + pickup`、`rank + bomb`、`bomb + pickup refill` は依存 feature が揃う場合だけ pass し、片方だけ有効な参照は error にする。
- settings migration は旧 `settingsVersion`、破損 JSON、未知 action、重複 binding の fixture を持ち、Runtime が default fallback または migration 済み settings を返すことを検証する。
- package boundary test では root export 以外の runtime / type-only deep import を拒否し、public type contract は内部 runtime component や system result が漏れないことを検証する。
- public API 境界は getter、Proxy、prototype 継承 property、巨大 input、非 JSON 互換値を validation 前に拒否し、例外を漏らさないことを検証する。

### 21.3 DSL Semantic Test

Pattern DSL と Stage timeline は、単純な構造検証に加えて意味検証を行う。

Parse 後は `PatternProgram` として正規化する。

```ts
type PatternProgram = {
  id: string;
  commands: PatternCommand[];
  labels: Record<string, number>;
  staticBudget: PatternBudget;
};
```

- `wait`、`interval`、`duration` は正の整数である。
- `loop` の target は存在する step index である。
- `repeat` の回数は上限以内である。
- `fan.count`、`radial.count`、`speed`、`accel` は content validation の安全上限以内である。
- `parallel` の branch 数と同時生成弾数は上限以内である。
- 静的に検出できる無限ループは validation error にする。
- 静的に判定できないループは runtime budget を持ち、1 tick 内の pattern command 実行数が上限を超えたら content error として停止する。

### 21.4 Golden Test

特定 seed、特定入力、特定 stage に対して、指定 tick の状態 snapshot を比較する。

例:

- 300 tick 時点で敵が 5 体存在する。
- 600 tick 時点で敵弾が 42 発存在する。
- 同じ replay は同じ score になる。

Replay divergence 調査では、state hash mismatch の最初の tick を特定し、その tick の entity diff、component diff、event diff、PRNG state diff、input frame を debug artifact として出力する。Golden test は最終 hash だけで失敗させず、first divergent tick を報告する。

```ts
type ReplayDivergenceReport = {
  schemaVersion: "1";
  artifactName: string;
  replayId: string;
  firstDivergentTick: number;
  expectedStateHash: string;
  actualStateHash: string;
  inputFrame: InputFrame;
  entityDiff: ReplayDiffItem[];
  componentDiff: ReplayDiffItem[];
  eventDiff: ReplayDiffItem[];
  prngStateDiff: ReplayDiffItem | null;
};

type ReplayDiffItem = {
  path: string;
  expected: string | number | boolean | null;
  actual: string | number | boolean | null;
  entityId?: number;
  component?: string;
};
```

CI artifact path は `artifacts/replay-divergence/<replayId>-tick-<tick>.json` とする。

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
- deterministic replay smoke test で同一 replay の state hash が一致することを確認する。

Screenshot diff は flaky になりやすいため、CI では tolerance と mask を使う。判定の正本は debug state dump と deterministic replay smoke test に置き、screenshot diff は視覚崩れ検知の補助とする。

Phase 1C の debug state dump は headless/core dump とし、test helper の `StageSession.serializeDebugState()` から取得する。Browser Test では `window.__SHOOTING_DEBUG_STATE__()` から browser/runtime dump を取得する。CI artifact path は `artifacts/debug-state/<test-name>-tick-<tick>.json` とする。

```ts
type DebugStateDump = {
  schemaVersion: "1";
  kind: "headless" | "browser";
  tick: number;
  seed: string;
  stateHash: string;
  prngHash: string;
  entityCounts: Record<string, number>;
  collisionCandidates: number;
  eventCounts: Record<string, number>;
  lifecycle?: GameLifecycleState;
  viewport?: { width: number; height: number; scale: number; dpr: number };
  inputQueueDepth?: number;
  assetStatus?: Record<string, "loaded" | "fallback" | "failed" | "skipped">;
  audioStatus?: {
    context: "running" | "suspended" | "closed" | "unavailable";
    degraded: boolean;
    lastError?: string;
  };
  overlayTransform?: string;
};
```

headless dump では optional field を省略する。browser/runtime dump では `lifecycle`、`viewport`、`inputQueueDepth`、`assetStatus`、`audioStatus`、`overlayTransform` を含める。

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

Phase 1B の完了条件は、同一 seed と入力列で state hash が一致し、restore 後も同じ tick 結果を返すこととする。

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
- 最小 pattern command subset
- Asset manifest
- サンプルステージ 1 つ
- Browser smoke test

Phase 2A の完了条件を初期 playable milestone とする。

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

Phase 1A の Core minimum contract は、TypeScript package、最小 content schema、registry validation、fixed tick、InputFrame、immutable event log、Entity/Component、seed/PRNG、Player / Enemy / EnemyBullet / PlayerShot、minimum Pattern `fireOnSpawn`、package boundary test まで実装済みである。

次の作業では、Phase 1A の残りとして以下を作る。

1. EnemyBullet と Player / PlayerShot / Enemy の collision minimum
2. enemy HP、player shot damage、enemy defeated event
3. fixed `scoreOnKill` scoring system
4. collision / scoring の deterministic system order test
5. collision / scoring 結果を含む public snapshot の更新

state hash 対象の更新は Phase 1B の replay determinism 作業で扱う。
