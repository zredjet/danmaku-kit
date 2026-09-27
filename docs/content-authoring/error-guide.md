# Content の診断と error の手引き

validate-content と Core が返す診断の code ごとに、原因、直し方、関連する schema path を載せる。見出しの code の一覧は、Core の `CoreErrorCode`、Core の warning の code、validate-content の `VALIDATE_CONTENT_DIAGNOSTIC_CODES` と一致する（`tests/error-guide.test.mjs` が過不足と各節の項目を検査する）。content の最小の例は [examples](examples/README.md) にある。

## 診断の読み方

validate-content の human 形式は、1 行に 1 つの診断を出す。

```text
content/stages/example.yaml:22:16-22:35 [ERROR] pattern.notFound: Pattern not found: pattern.example_rng (schema=content.stages[0].timeline[1].action.pattern, referrer=stage.example, target=pattern.example_rng)
```

- 先頭は file と位置（行:列、範囲がわかれば終わりの行:列）。optional feature の診断（`kind` が `featureGate`）は file の代わりに直す場所の source（`gameDefinition` か definition の id）で始まり、tool error は位置を持たない。
- `[ERROR]` / `[WARNING]` / `[INFO]` は重要度。error が 1 つでもあれば content は使えない（CLI の exit code 1）。warning と info は content を使えるが、意図と違う書き方の知らせ。
- `schema=` は content の中の位置（`content.<collection>[<index>].<field>`）。`source=` は診断のある definition の id（id がなければ file）。参照の診断（`kind` が `reference`）は、問題のある definition の id を `referrer=`、見つからない参照先の id を `target=` に出す。
- `--format json` は同じ内容を `diagnostics` の配列で出す（`kind` は `parse`、`schema`、`reference`、`featureGate`、`tool`）。

validate-content は YAML の読み込みと content root の形を先に調べ、次に Core の `load()` と同じ検証（形、値の範囲、参照、optional feature、pattern の意味）を行う。形の error があると参照の検証まで進まないので、直してから validate-content をもう一度実行する。validation を最後まで行えなかったとき（file を読めないなど）は tool error で、CLI の exit code は 2 になる。

## YAML と content root（validate-content）

### `yaml.parse.*`

- 重要度: error（parser の warning は warning）
- 原因: YAML の構文の誤り。code の後半は YAML parser（`yaml` package）の error code を小文字にしたもの（`yaml.parse.bad_indent`、`yaml.parse.duplicate_key`、`yaml.parse.missing_char`、`yaml.parse.tag_resolve_failed` など）。
- 直し方: 位置の行の字下げ、`:` や引用符の閉じ忘れ、同じ key の重複を直す。独自の tag（`!foo`）は使わない。
- schema path: `$`（file の root）

### `yaml.parse.alias_not_supported`

- 重要度: error
- 原因: YAML の anchor と alias（`&name` / `*name`）を使った。
- 直し方: alias を使わず、同じ値を書き並べる。共通にしたい定義は別の definition にして id で参照する。
- schema path: `$`

### `yaml.parse.invalid_utf8`

- 重要度: error
- 原因: file が UTF-8 として読めない。
- 直し方: editor で UTF-8（BOM なし）として保存し直す。
- schema path: `$`

### `yaml.parse.unsupported_version`

- 重要度: error
- 原因: `%YAML 1.1` のように、YAML 1.2 以外の version directive を書いた。
- 直し方: directive を消すか `%YAML 1.2` にする。
- schema path: `$`

### `yaml.resource`

- 重要度: error
- 原因: 1 つの file が読み込みの上限（大きさ、node の数、入れ子の深さ）を超えた。
- 直し方: file を小さくする（長い timeline は stage を分けるなど）。深すぎる入れ子は `repeat` や `if` の段を減らす。
- schema path: `$`

### `content.unknownEntry`

- 重要度: error
- 原因: content root に collection の directory（`players`、`player-shots`、`bullets`、`enemies`、`paths`、`patterns`、`pickups`、`stages`）と `assets` 以外の file や directory がある。
- 直し方: 名前の綴りを直すか、content 以外の file を content root の外へ移す。
- schema path: `content`

### `content.unsupportedEntry`

- 重要度: error
- 原因: collection の directory に `.yaml` 以外の file（`.yml`、画像、sub directory など）がある。
- 直し方: 拡張子を `.yaml` にするか、file を directory の外へ移す。
- schema path: `content.<collection>`

### `content.assetManifestNotFound`

- 重要度: error
- 原因: `content/assets/manifest.yaml` がない。
- 直し方: content が参照する asset の key を持つ manifest を置く（例: `examples/content/assets/manifest.yaml`）。
- schema path: `content.assetKeys`

## asset manifest（validate-content）

### `assetManifest.invalidShape`

- 重要度: error
- 原因: manifest か entry の形の誤り。manifest が object でない、`version` が 1 でない、`assets` が object でない、entry の `type` / `path` / `required` / `usage` がないか値が誤り、`path` が base URL と合成できる相対 path でない、`usage: audio` と `type: audio` が組になっていない、`fallback` が空、`license` / `author` / `source` が文字列でない、`runtime.` で始まる key を定義した（runtime の built-in に予約）。
- 直し方: message の field を直す。`type` は `sprite`、`atlas`、`tilemap`、`audio`、`particle`、`effect`、`usage` は `gameplay`、`ui`、`decorative`、`audio` から選ぶ（audio の asset は type も usage も `audio`）。
- schema path: `assetManifest.version`、`assetManifest.assets["<key>"].<field>`（manifest か `assets` が object でなければ `content.assetKeys` / `content.assetKeys.keys`）

### `assetManifest.unknownField`

- 重要度: error
- 原因: manifest の root か entry に知らない field がある（綴りの誤りが多い）。
- 直し方: field を消すか綴りを直す。entry が持てるのは `type`、`path`、`required`、`usage`、`fallback`、`license`、`author`、`source`。
- schema path: `assetManifest.<field>`、`assetManifest.assets["<key>"].<field>`

### `assetManifest.invalidFallback`

- 重要度: error
- 原因: `fallback` が manifest にない key、type の違う asset、`required: true` の entry から指している。
- 直し方: `fallback` は `required: false` の entry に置き、同じ type の manifest の key か `runtime.` の built-in の key を指す。
- schema path: `assetManifest.assets["<key>"].fallback`

### `assetManifest.fallbackCycle`

- 重要度: error
- 原因: `fallback` をたどると元の entry に戻る。
- 直し方: 連鎖のどこかで、読み込みに失敗しない asset か `runtime.` の built-in を指して終わらせる。
- schema path: `assetManifest.assets["<key>"].fallback`

## 形と値（Core）

### `schema.unsupportedVersion`

- 重要度: error
- 原因: game-definition の `schemaVersion` が Core の知る version でない。
- 直し方: `schemaVersion: "1"` にする（文字列で書く）。
- schema path: `schemaVersion`

### `definition.invalidShape`

- 重要度: error
- 原因: 必須の field がない、型が違う、値が範囲の外（負の `hp`、0 以下の `duration`、上限を超える数など）、1 つの pattern の step に `wait` / `fire` / `loop` / `repeat` / `if` のうち 2 つ以上の key がある、`steps` と `fireOnSpawn` を両方書いた、など。validate-content も、game-definition の `contentVersion` がない、collection の file が object でない、といった読み込みの形の誤りをこの code で出す。message に field と条件が出る。
- 直し方: message の field を条件どおりに直す。

  ```yaml
  # enemy.hp must be a positive number
  hp: -1   # 誤り
  hp: 10   # 正しい
  ```

- schema path: message の field（`content.enemies[0].hp` など）

### `definition.unknownField`

- 重要度: error
- 原因: definition に知らない field がある（綴りの誤りが多い）。game-definition に `content` を書いた場合も出る（content は `--content-root` から組み立てる）。
- 直し方: field を消すか綴りを直す。使える field は [examples](examples/README.md) の各 file を見る。optional feature の field は、その feature を `enabledFeatures` に入れてから使う。
- schema path: message の field

### `definition.invalidConstraint`

- 重要度: error
- 原因: 形は正しいが、組み合わせの条件を満たさない。pattern の `loop` の戻り先から `loop` までに `wait` がない（同じ tick で無限に回る）、`repeat` を展開した命令の数が上限を超える、1 tick に撃つ弾の数が敵弾の active 上限を超える（difficulty ごとに数え、超えた difficulty が message に出る）、`fireOnSpawn` の位置が有限にならない、など。
- 直し方: `loop` の範囲に `wait` を入れる、`repeat` の `count` や 1 回の `fire` の弾数（`fan` / `radial` の `count` と `stream` の `count` の積）を減らす。
- schema path: message の field（`content.patterns[0].steps` など）

### `id.invalidNamespace`

- 重要度: error
- 原因: id が collection の namespace で始まっていない（enemy の id は `enemy.` で始める）、namespace の後に使えない文字がある、128 文字を超える。参照の値が参照先の namespace の id の形でない場合も出る。
- 直し方: id を `player.`、`playerShot.`、`bullet.`、`enemy.`、`path.`、`pattern.`、`pickup.`、`stage.` の namespace で始め、namespace の後は英数字で始まる英数字、`.`、`_`、`-` にする（`..` は使えない。全体で 128 文字まで）。
- schema path: `content.<collection>[<index>].id` か参照の field

### `id.duplicate`

- 重要度: error
- 原因: 同じ collection に同じ id の definition が 2 つある（file を複製して id を変え忘れたなど）。
- 直し方: どちらかの id を変える。file 名を id にそろえておくと見つけやすい。
- schema path: `content.<collection>[<index>].id`

### `asset.invalidKey`

- 重要度: error
- 原因: asset の key が空、使えない文字を含む、128 文字を超える。definition の `asset` の値が key の規則に合わない場合も出る。
- 直し方: key は英数字で始まる英数字、`.`、`_`、`-` にする（`..` は使えない。128 文字まで）。
- schema path: `content.assetKeys.keys`、`content.<collection>[<index>].asset`

### `asset.duplicate`

- 重要度: error
- 原因: Core に渡した asset の key の一覧に重複がある。validate-content は manifest の key から一覧を作るので、manifest の key の重複は YAML の読み込みで `yaml.parse.duplicate_key` になり、この code は Core を直接呼ぶ tool で出る。
- 直し方: key を 1 つにする。
- schema path: `content.assetKeys.keys`

### `timeline.invalidOrder`

- 重要度: error
- 原因: stage の `timeline` が `tick` の昇順に並んでいない。
- 直し方: step を `tick` の小さい順に並べ替える（同じ tick の spawn は続けて書く）。
- schema path: `content.stages[<index>].timeline`

### `timeline.tooManySteps`

- 重要度: error
- 原因: 1 つの stage の `timeline` の step が上限を超える。
- 直し方: stage を分けるか、spawn をまとめる。
- schema path: `content.stages[<index>].timeline`

### `timeline.tooManySpawnsPerTick`

- 重要度: error
- 原因: 同じ tick に出す敵が上限を超える。
- 直し方: spawn の `tick` をずらして、複数の tick に分ける。
- schema path: `content.stages[<index>].timeline`

## 参照（Core）

### `asset.notFound`

- 重要度: error
- 原因: definition の `asset` が manifest にない key を指している。
- 直し方: manifest に key を足すか、`asset` の綴りを直す。
- schema path: `content.<collection>[<index>].asset`

### `bullet.notFound`

- 重要度: error
- 原因: pattern の `fire.bullet` か `fireOnSpawn.bullet` が、ない bullet を指している。
- 直し方: `bullets/` に bullet を足すか、id の綴りを直す。
- schema path: `content.patterns[<index>].steps[<index>].fire.bullet`

### `enemy.notFound`

- 重要度: error
- 原因: stage の spawn の `enemy` が、ない enemy を指している。
- 直し方: `enemies/` に enemy を足すか、id の綴りを直す。
- schema path: `content.stages[<index>].timeline[<index>].action.enemy`

### `path.notFound`

- 重要度: error
- 原因: stage の spawn の `path` が、ない path を指している。
- 直し方: `paths/` に path を足すか、id の綴りを直す。
- schema path: `content.stages[<index>].timeline[<index>].action.path`

### `pattern.notFound`

- 重要度: error
- 原因: stage の spawn の `pattern` が、ない pattern を指している。
- 直し方: `patterns/` に pattern を足すか、id の綴りを直す。
- schema path: `content.stages[<index>].timeline[<index>].action.pattern`

### `pickup.notFound`

- 重要度: error
- 原因: enemy の `drops[].pickup` が、ない pickup を指している（pickup feature）。
- 直し方: `pickups/` に pickup を足すか、id の綴りを直す。
- schema path: `content.enemies[<index>].drops[<index>].pickup`

### `player.defaultNotFound`

- 重要度: error
- 原因: game-definition の `defaultPlayerId` が、ない player を指している。
- 直し方: `players/` に player を足すか、`defaultPlayerId` の綴りを直す。
- schema path: `defaultPlayerId`

### `playerShot.notFound`

- 重要度: error
- 原因: player の `shot.definition` が、ない player shot を指している。tick の途中に `stageSession.fatal` の message に出たときは Core の不整合。
- 直し方: `player-shots/` に player shot を足すか、id の綴りを直す。
- schema path: `content.players[<index>].shot.definition`

## optional feature（Core）

### `feature.unknown`

- 重要度: error
- 原因: `enabledFeatures` に Core の知らない feature の名前がある。
- 直し方: 綴りを直す。Core が知る名前は `pickup`、`bomb`、`graze`、`affinity`、`rank`、`advancedScoring` で、今 module があるのは `pickup` だけ（他は予約した名前で、`feature.unsupported` になる）。
- schema path: `enabledFeatures`

### `feature.duplicate`

- 重要度: error
- 原因: `enabledFeatures` に同じ feature が 2 回ある。
- 直し方: 1 つにする。
- schema path: `enabledFeatures`

### `feature.unsupported`

- 重要度: error
- 原因: `enabledFeatures` の feature の module が、Core に登録されていない。`bomb`、`graze`、`affinity`、`rank`、`advancedScoring` は名前だけ予約していて module がまだないので、validate-content（`pickup` を登録している）ではこれらを書くとこの error になる。自分で Core を作る runtime では、`createShootingCore({ features })` に module を渡し忘れた場合も出る。
- 直し方: module のない feature は `enabledFeatures` から外す。`pickup` なら、content を使う runtime で module を登録する（sample title は `src/main.ts` で `pickupFeature` を渡す）。
- schema path: `enabledFeatures`

### `feature.disabled`

- 重要度: error
- 原因: `enabledFeatures` にない feature の field を使った（pickup を有効にせずに enemy の `drops` を書いたなど）。
- 直し方: feature を `enabledFeatures` に入れるか、field を消す。
- schema path: feature の field（`content.enemies[<index>].drops` など）

### `feature.disabledContent`

- 重要度: warning
- 原因: `enabledFeatures` にない feature の collection（`pickups/` など）に definition がある。読み込むだけで使わない。
- 直し方: feature を使うなら `enabledFeatures` に入れる。使わないなら directory を消す。
- schema path: `content.features.<collection>`

## pattern の意味（Core の warning）

### `pattern.neverFires`

- 重要度: warning
- 原因: pattern の `steps` が 1 発も撃たない（`fire` がないか、`if` の枝のどれにも届かない）。
- 直し方: 撃たない敵なら意図どおりなので、そのままでよい。撃つつもりなら `fire` を足す。
- schema path: `content.patterns[<index>].steps`

### `pattern.unreachableStep`

- 重要度: warning
- 原因: spawn からたどって実行されない step がある（`loop` の後ろの step など）。
- 直し方: step を `loop` の前へ移すか消す。
- schema path: `content.patterns[<index>].steps[<index>]`

### `pattern.unusedBranch`

- 重要度: warning
- 原因: `if.difficulty` に、その step が実行される difficulty（pattern を使う stage の `difficulties`）にない difficulty がある、または `else` がどの difficulty でも選ばれない（`difficulty: [hard]` の `if` を hard のない stage だけで使う、stage の difficulty がすべて `then` を選ぶ、など）。`then` が使われていても、届かない difficulty を書いていれば出る。
- 直し方: stage の `difficulties` か `if.difficulty` を見直し、使われない `else` は消す。複数の stage で共有していて意図どおりなら、そのままでよい。
- schema path: `content.patterns[<index>].steps[<index>].if.difficulty` か `.if.else`

## stage の開始と実行（Core API を呼ぶ runtime 向け）

content を直すより、Core を呼ぶ側（runtime、tool、test）の引数や使い方を直す error。content が原因のときはその旨を書く。

`startStage()` の error はそのまま返る。`tick()` では、引数の誤り（`input.*`）と終わった stage への `tick()`（`stageSession.ended`）はその error を返すだけで session は使い続けられる。tick の処理の途中の error は session を止め、元の code と message を message に並べた `stageSession.fatal` として返す（以後の `tick()` と `serialize()` も同じ error を返す）。下の節で「`stageSession.fatal` の message に出る」と書いた code は、この形で見る。

### `startStage.invalidShape`

- 重要度: error
- 原因: `startStage()` の引数の形が誤り。`stageId` が `stage.` の id でない、`difficulty` が `normal` / `hard` でない、`seed` が空か長すぎる、知らない field がある、など。
- 直し方: `{ stageId, difficulty, seed }`（と任意の `playerId`）を正しい値で渡す。

### `stage.notFound`

- 重要度: error
- 原因: `startStage()` の `stageId` の stage が content にない。
- 直し方: content の stage の id を渡す。

### `player.notFound`

- 重要度: error（tick の途中なら `stageSession.fatal` の message に出る）
- 原因: `startStage()` の `playerId` の player が content にない。tick の途中なら、自機の entity が state にない（Core の不整合）。
- 直し方: content の player の id を渡すか、`playerId` を省いて `defaultPlayerId` を使う。tick の途中で出たら Core の不具合として報告する。

### `difficulty.notSupported`

- 重要度: error
- 原因: stage の `difficulties` にない difficulty で始めようとした。
- 直し方: stage の `difficulties` にある値を渡すか、content の stage に difficulty を足す。

### `input.invalidShape`

- 重要度: error
- 原因: `tick()` に渡した `InputFrame` の形が誤り（`axes` の値が -1 / 0 / 1 でない、知らない action、知らない field など）。session はそのまま使える。
- 直し方: `{ tick, axes: { moveX, moveY }, held, pressed, released }` の形で渡す。

### `input.tickMismatch`

- 重要度: error
- 原因: `InputFrame.tick` が、session が次に受け付ける tick と違う。tick を飛ばしたか、同じ tick を 2 回渡した。session はそのまま使える。
- 直し方: 次に受け付ける tick（始めた session なら 0、restore した session なら state の `expectedTick`）から 1 ずつ増やして渡す。

### `stageSession.ended`

- 重要度: error
- 原因: `stageCleared` か `gameOver` になった session に `tick()` を渡した。session は壊れていない。
- 直し方: frame の `state.status` が `playing` の間だけ `tick()` を渡し、終わったら新しい stage を始める。

### `stageSession.fatal`

- 重要度: error
- 原因: tick の処理が続けられない状態になった。message の `Stage session entered a fatal state:` の後に、元の code と message が `<code>: <message>` の形で並ぶ（敵弾や pickup の上限、1 tick の pattern の命令の上限、optional feature の state が JSON 互換でない、feature が規則に反する event や score を出した、Core の内部の不整合など）。
- 直し方: message の先頭の code の節を見て原因を直し、新しい session で始め直す（止まった session は `tick()` も `serialize()` も同じ error を返し続ける）。feature を作っているなら feature module の hook を見直す。

### `enemyBullet.budgetExceeded`

- 重要度: error（`stageSession.fatal` の message に出る）
- 原因: 敵弾の数が active の上限を超えそうになった。1 tick に撃つ弾の数は load 時に調べるが、弾が長く残って積み上がると実行中に超える。
- 直し方: pattern の弾数や発射の頻度を減らすか、弾が早く画面の外へ出るよう速さを上げる。

### `pickup.budgetExceeded`

- 重要度: error（`stageSession.fatal` の message に出る）
- 原因: pickup の数が active の上限を超えそうになった（pickup feature）。
- 直し方: enemy の `drops` の `count` を減らすか、pickup の `velocity` を上げて早く画面の外へ出す。

### `pattern.budgetExceeded`

- 重要度: error（`stageSession.fatal` の message に出る）
- 原因: 1 tick に動くすべての敵の pattern が実行する命令の合計が上限を超えた。load 時の検証は 1 つの pattern の 1 回の実行だけを調べるので、命令の多い pattern の敵を同じ tick に多く出すと、検証を通った content でも起きる。
- 直し方: 同じ tick に出す敵を減らすか spawn の tick をずらす。1 回の実行の命令（`repeat` の展開、`wait` なしで続く `fire`）を減らす。

### `entityAllocator.invalidState`

- 重要度: error（`stageSession.fatal` の message に出る）
- 原因: Core の内部で entity の id の採番が壊れた（Core の不整合）。restore した state の id の誤りは `state.invalidShape` になり、この code にはならない。
- 直し方: 再現する content、seed、入力を添えて Core の不具合として報告する。

### `prng.invalidState`

- 重要度: error（`stageSession.fatal` の message に出る）
- 原因: Core の内部で乱数の state が壊れた（Core の不整合）。restore した state の乱数の誤りは `state.prngInvalid` になる。
- 直し方: 再現する content、seed、入力を添えて Core の不具合として報告する。

### `testHook.failure`

- 重要度: error
- 原因: test 専用の hook（Core の内部 test hook を有効にした test）で注入した失敗。その tick の途中の state を捨てて error を返し、session は fatal にならずにそのまま使える。通常の runtime では出ない。
- 直し方: test の意図どおりなら対応は要らない。通常の実行で出たら、test hook を有効にする環境変数が設定されていないかを確かめる。

## state の restore（Core API を呼ぶ runtime 向け）

`restore()` に渡した serialize 済みの state が、load した content や Core と合わない。どれも `serialize()` の結果を書き換えず、同じ Core と content で `restore()` すれば出ない。

### `state.invalidShape`

- 重要度: error
- 原因: state の形か値が不正、または spawn から到達できない値（位置、残り時間、entity の組み合わせなど）。
- 直し方: `serialize()` の結果をそのまま渡す。手で作った state は serialize の形と到達可能性の条件に合わせる。

### `state.registryInvalid`

- 重要度: error
- 原因: state の entity が、load した content にない definition（enemy、path、bullet など）を指している。
- 直し方: state を作ったときと同じ content を load してから restore する。

### `state.contentMismatch`

- 重要度: error
- 原因: state を作った content と、load した content が違う（`contentVersion`、stage、player、difficulty、timeline の位置が合わない）。
- 直し方: 同じ `contentVersion` の content を load する。content を変えたら古い state は使わない。

### `state.featureMismatch`

- 重要度: error
- 原因: state の optional feature の組か feature の state の version が、load した content と Core に登録した feature と合わない。pattern runner の state の version が basic の pattern runner と合わない場合も出る。
- 直し方: 同じ `enabledFeatures` の content と、同じ feature module を登録した同じ version の Core で restore する。

### `state.coreVersionMismatch`

- 重要度: error
- 原因: state を作った Core の version が違う。
- 直し方: 同じ version の Core で restore する。Core を更新したら古い state は使わない。

### `state.schemaVersionMismatch`

- 重要度: error
- 原因: state の `schemaVersion` が、load した content の `schemaVersion` と違う。
- 直し方: 同じ schema の content で restore する。

### `state.inputFormatVersionMismatch`

- 重要度: error
- 原因: state の入力の形式の version が、今の Core と違う。
- 直し方: 同じ version の Core で作った state を使う。

### `state.stateHashVersionMismatch`

- 重要度: error
- 原因: state の hash の version が、今の Core と違う。
- 直し方: 同じ version の Core で作った state を使う。

### `state.prngInvalid`

- 重要度: error
- 原因: state の `prngState` を乱数が受け付けない。
- 直し方: `serialize()` の結果の `prngState` を書き換えずに渡す。

## tool error（validate-content）

validation を最後まで行えなかった。content の誤りではなく、呼び出し方か環境の問題。CLI の exit code は 2。

### `tool.invalidArguments`

- 重要度: error
- 原因: CLI の引数が誤り（`--game-definition` か `--content-root` がない、同じ option を 2 回書いた、知らない option、option の値がない、`--format` の値が `human` / `json` でない）。
- 直し方: `validate-content --game-definition <file> --content-root <dir> [--format human|json]` の形で実行する（`--format` は省略すると human）。

### `tool.invalidInput`

- 重要度: error
- 原因: `loadValidatedGameDefinition()` などの API に、文字列でない path など不正な引数を渡した。
- 直し方: `{ gameDefinitionPath, contentRoot }` を文字列で渡す。

### `tool.readFailed`

- 重要度: error
- 原因: game-definition や content root を読めない（path の誤り、権限がない）。
- 直し方: path と読み取り権限を確かめる。相対 path は実行した directory からの path になる。

### `tool.unexpected`

- 重要度: error
- 原因: validate-content の予期しない例外。
- 直し方: message と、再現する content と command を添えて報告する。

### `tool.invalidDiagnostic`

- 重要度: error
- 原因: 結果に入れる診断が、公開の形の規則に合わない。validate-content の不具合か、公開の `createValidationRunResult()` に手で作った診断を渡した。
- 直し方: `createValidationRunResult()` には公開の形（`kind` ごとの必須 field）の診断を渡す。validate-content の CLI や `loadValidatedGameDefinition()` で出たら、再現する content を添えて報告する。

### `tool.invalidOutput`

- 重要度: error
- 原因: 出力しようとした JSON が公開の形に合わない（validate-content の不具合か、`formatValidateContentJson()` などへ手で作った出力を渡した）。
- 直し方: validate-content が返した出力をそのまま format に渡す。validate-content の出力で出たら報告する。
