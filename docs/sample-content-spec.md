# Sample content spec（sample title の stage 1）

sample title（`apps/sample-title/`）の stage 1 の仕様。基盤の機能を 1 つの stage で一通り見せ、headless replay の golden で挙動を固定する content として作る（design 21.6 / 23、Phase 2B-13）。末尾の「機械で読める仕様」は content の値そのもので、`apps/sample-title/src/sample-content/sample-content-spec.test.ts` が content（`apps/sample-title/content/`）と golden（`stage-01-replay.golden.json`）に照らして確かめる。content か golden を変えたら、この文書の文章と block も合わせて変える（golden を `UPDATE_SAMPLE_TITLE_GOLDENS=1 npm test` で作り直したら、spec の test が新しい golden を読むよう `npm test` をもう一度実行する）。

## 狙い

- 自機の移動、低速移動、shot、被弾と無敵時間、lives、score、stage clear までを通して遊べる。golden の run（全滅させる）で約 37 秒、敵を倒さなくても全員が退場して約 42 秒で終わる。
- 敵の pattern で、自機狙い（`aim`）、扇（`fan`）、向きを決めた発射（`angleDeg`）、1 周の輪（`radial`）、繰り返し（`loop`）を見せる。
- 敵の path で、直進、折れ線の横切り、sine の揺れ、留まってからの退場を見せる。
- pickup feature で、撃破した drone が score の pickup を落とし、近づいた自機に吸い寄せられて回収されるまでを見せる。
- 入力が決まれば結果も決まる（seed に依存する乱数を使わない）ので、golden の入力で clear まで固定できる。golden の入力は shot を押し続け、最初の 40 tick は左へ、その後は 80 tick ごとに左右の向きを変える。

## 自機

- `player.default`: 速さ 4 px/tick、低速 1.8 px/tick、当たり判定の半径 3、lives 3、被弾後の無敵 120 tick。
- `playerShot.basic`: 3 tick ごとに 1 発、上へ 8 px/tick、寿命 60 tick、当たり判定の半径 5、damage 5。

## 敵

| 敵 | hp | score | 当たり判定の半径 | drops | 役割 |
| --- | --- | --- | --- | --- | --- |
| `enemy.drone` | 5 | 50 | 10 | `pickup.score_small` × 2 | 1 発で落ちる雑魚。狙い弾を 1 発撃ち、pickup を落とす |
| `enemy.scout` | 10 | 100 | 12 | なし | 2 発で落ちる。3-way の狙い弾を撃ち続ける |
| `enemy.gunship` | 200 | 2000 | 22 | なし | 留まって弾幕を撃つ大型機。stage の山場 |

## 弾

- `bullet.red_small`: 当たり判定の半径 4。狙い弾に使う。
- `bullet.blue_large`: 当たり判定の半径 6。gunship の扇と輪に使う。

## pattern

角度は両端の弾の間の角度（`spreadDeg`）。速さは px/tick。

- `pattern.drone_aimed_shot`: spawn から 45 tick 後に、自機狙いの赤い弾を 1 発（2.5）。
- `pattern.scout_three_way`: 60 tick 後から、自機狙いの赤い 3-way（30°、3）を 40 tick ごと。
- `pattern.gunship_barrage`: 90 tick 後から 30 tick ごとに、真下を中心にした青い 7-way の扇（90°、2）、自機狙いの赤い 3-way（20°、3.5）、青い 16 方向の輪（`radial`、扇より遅い 1.5）、自機狙いの赤い 3-way を繰り返す。

## pickup

- `pickup.score_small`: 10 点。1.25 px/tick で下へ落ちる。自機から 12 px に入れば回収し、64 px に入ると吸い寄せに入って 12 tick 後に回収する（Core ではその位置で止まり、sample app は自機へ寄っていく様子を描く）。

## wave

| wave | tick | 敵 | 内容 |
| --- | --- | --- | --- |
| 1 | 90〜150 | drone × 5 | 横に並んだ位置から縦にまっすぐ降り、1 発ずつ狙って撃つ |
| 2 | 330〜450 | drone × 6 | 左右の上から降りてから、斜めに横切る |
| 3 | 600〜720 | scout × 3 | 画面の横から波打って横切り、3-way を撃つ |
| 4 | 960〜990 | scout × 2 | 降りて左右に揺れてから退場する |
| 5 | 1320〜1365 | drone × 7 | V 字の隊形で降りる |
| 6 | 1620〜1860 | gunship × 1、scout × 2 | 揺れながら留まる gunship の弾幕と、scout の護衛 |

## clear までの流れ

timeline の spawn を出し終え、敵と pickup が playfield からいなくなると stage clear になる。どの path も敵を画面の外（cleanup の余白の外）まで運ぶので、倒し損ねた敵が退場しても clear できる（撃たない敵と撃たない自機でも tick 2519 に clear する）。lives がなくなれば game over。

golden の入力では、26 体すべてを倒し、drone が落とした pickup 36 個のうち 32 個を回収し（10 点ずつ）、wave 6 で 1 回被弾して、tick 2216 に score 3920、lives 2 で clear する。

## 機械で読める仕様

```json sample-content-spec
{
  "stage": "stage.stage_01",
  "difficulties": ["normal"],
  "player": {"id": "player.default", "movement": {"speed": 4, "focusSpeed": 1.8}, "collision": {"radius": 3}, "life": {"initialLives": 3, "invincibleTicksAfterHit": 120}, "shot": "playerShot.basic"},
  "playerShot": {"id": "playerShot.basic", "collision": {"radius": 5}, "damage": 5, "fire": {"intervalTicks": 3}, "projectile": {"velocity": {"x": 0, "y": -8}, "lifetimeTicks": 60}},
  "bullets": {"bullet.blue_large": {"radius": 6}, "bullet.red_small": {"radius": 4}},
  "enemies": {
    "enemy.drone": {"hp": 5, "score": 50, "radius": 10, "drops": {"pickup.score_small": 2}},
    "enemy.gunship": {"hp": 200, "score": 2000, "radius": 22, "drops": {}},
    "enemy.scout": {"hp": 10, "score": 100, "radius": 12, "drops": {}}
  },
  "pickups": {"pickup.score_small": {"score": 10, "collectRadius": 12, "magnetRadius": 64, "velocity": {"x": 0, "y": 1.25}}},
  "patterns": {
    "pattern.drone_aimed_shot": [
      {"wait": 45},
      {"fire": {"bullet": "bullet.red_small", "aim": "player", "speed": 2.5}}
    ],
    "pattern.gunship_barrage": [
      {"wait": 90},
      {"fire": {"bullet": "bullet.blue_large", "angleDeg": 90, "fan": {"count": 7, "spreadDeg": 90}, "speed": 2}},
      {"wait": 30},
      {"fire": {"bullet": "bullet.red_small", "aim": "player", "fan": {"count": 3, "spreadDeg": 20}, "speed": 3.5}},
      {"wait": 30},
      {"fire": {"bullet": "bullet.blue_large", "angleDeg": 90, "radial": {"count": 16}, "speed": 1.5}},
      {"wait": 30},
      {"fire": {"bullet": "bullet.red_small", "aim": "player", "fan": {"count": 3, "spreadDeg": 20}, "speed": 3.5}},
      {"wait": 30},
      {"loop": 1}
    ],
    "pattern.scout_three_way": [
      {"wait": 60},
      {"fire": {"bullet": "bullet.red_small", "aim": "player", "fan": {"count": 3, "spreadDeg": 30}, "speed": 3}},
      {"wait": 40},
      {"loop": 1}
    ]
  },
  "waves": [
    {"wave": 1, "ticks": [90, 150], "spawns": {"enemy.drone": 5},
     "paths": ["path.drone_dive"],
     "patterns": ["pattern.drone_aimed_shot"]},
    {"wave": 2, "ticks": [330, 450], "spawns": {"enemy.drone": 6},
     "paths": ["path.drone_swoop_left", "path.drone_swoop_right"],
     "patterns": ["pattern.drone_aimed_shot"]},
    {"wave": 3, "ticks": [600, 720], "spawns": {"enemy.scout": 3},
     "paths": ["path.scout_sweep_left", "path.scout_sweep_right"],
     "patterns": ["pattern.scout_three_way"]},
    {"wave": 4, "ticks": [960, 990], "spawns": {"enemy.scout": 2},
     "paths": ["path.enter_hover_exit", "path.enter_hover_exit_left"],
     "patterns": ["pattern.scout_three_way"]},
    {"wave": 5, "ticks": [1320, 1365], "spawns": {"enemy.drone": 7},
     "paths": ["path.drone_dive"],
     "patterns": ["pattern.drone_aimed_shot"]},
    {"wave": 6, "ticks": [1620, 1860], "spawns": {"enemy.gunship": 1, "enemy.scout": 2},
     "paths": ["path.gunship_entry", "path.scout_sweep_left", "path.scout_sweep_right"],
     "patterns": ["pattern.gunship_barrage", "pattern.scout_three_way"]}
  ],
  "idleClearTick": 2519,
  "golden": {"seed": "stage-01-golden", "weavePeriodTicks": 80, "clearTick": 2216, "score": 3920, "lives": 2, "defeats": {"enemy.drone": 18, "enemy.gunship": 1, "enemy.scout": 7}, "pickups": {"dropped": 36, "collected": 32, "score": 320}, "playerHits": [1894], "firstThreeWayTick": 660, "firstRadialTick": 1770}
}

```

- `player`、`playerShot`、`bullets`、`enemies`、`pickups`: content の値（`enemies` の `radius` は当たり判定の半径、`drops` は pickup ごとの数）。
- `patterns`: 各 pattern の `steps` そのもの。
- `waves`: timeline の spawn は、どれか 1 つの wave の `ticks`（両端を含み、最初と最後の spawn の tick）に入る。`spawns` は wave の敵の数、`paths` と `patterns` は wave の spawn が使う path と pattern。
- `idleClearTick`: どの敵も撃たず（pattern を撃たないものに差し替え）、自機も何もしない run が、撃破 0 のまま stage clear になる tick。すべての path が敵を画面の外まで運ぶことを表す。
- `golden`: `stage-01-replay.golden.json` の主要な値（clear の tick、score、lives、倒した敵の数、pickup、被弾の tick、最初の 3-way と radial の tick）。
