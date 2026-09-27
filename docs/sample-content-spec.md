# Sample content spec（sample title の stage 1）

sample title（`apps/sample-title/`）の stage 1 の仕様。基盤の機能を 1 つの stage で一通り見せ、headless replay の golden で挙動を固定する content として作る（design 21.6 / 23、Phase 2B-13）。末尾の「機械で読める仕様」は `apps/sample-title/src/sample-content/sample-content-spec.test.ts` が content（`apps/sample-title/content/`）と golden（`stage-01-replay.golden.json`）に照らして確かめる。content か golden を変えたら、この文書も合わせて変える。

## 狙い

- 自機の移動、低速移動、shot、被弾と無敵時間、lives、score、stage clear までを、約 37 秒で通して遊べる。
- 敵の pattern で、自機狙い（`aim`）、扇（`fan`）、向きを決めた発射（`angleDeg`）、1 周の輪（`radial`）、繰り返し（`loop`）を見せる。
- 敵の path で、直進、弧、sine の揺れ、画面の横からの横切り、留まってからの退場を見せる。
- pickup feature で、撃破した drone が score の pickup を落とし、吸い寄せて回収するまでを見せる。
- 入力が決まれば結果も決まる（seed に依存する乱数を使わない）ので、golden の入力（80 tick ごとに左右へ往復しながら撃ち続ける）で clear まで固定できる。

## 自機

- `player.default`: 速さ 4、低速 1.8、当たり判定の半径 3、lives 3、被弾後の無敵 120 tick。
- `playerShot.basic`: 3 tick ごとに 1 発、上へ 8 px/tick、寿命 60 tick、damage 5。

## 敵

| 敵 | hp | score | drops | 役割 |
| --- | --- | --- | --- | --- |
| `enemy.drone` | 5 | 50 | `pickup.score_small` × 2 | 1 発で落ちる雑魚。狙い弾を 1 発撃ち、pickup を落とす |
| `enemy.scout` | 10 | 100 | なし | 2 発で落ちる。3-way の狙い弾を撃ち続ける |
| `enemy.gunship` | 200 | 2000 | なし | 留まって弾幕を撃つ大型機。stage の山場 |

## pattern

- `pattern.drone_aimed_shot`: spawn から 45 tick 後に、自機狙いの弾を 1 発。
- `pattern.scout_three_way`: 60 tick 後から、自機狙いの 3-way（30°）を 40 tick ごと。
- `pattern.gunship_barrage`: 90 tick 後から、真下へ 7-way の扇（90°）、自機狙いの 3-way（20°）、16 方向の輪（`radial`、遅い大きな弾）、自機狙いの 3-way を 30 tick ごとに繰り返す。

## wave

| wave | tick | 敵 | 内容 |
| --- | --- | --- | --- |
| 1 | 90〜150 | drone × 5 | 自機の列へまっすぐ降り、1 発ずつ狙って撃つ |
| 2 | 330〜450 | drone × 6 | 左右から弧を描いて横切る |
| 3 | 600〜720 | scout × 3 | 画面の横から波打って横切り、3-way を撃つ |
| 4 | 960〜990 | scout × 2 | 降りて左右に揺れてから退場する |
| 5 | 1320〜1365 | drone × 7 | V 字の隊形で降りる |
| 6 | 1620〜1860 | gunship × 1、scout × 2 | 揺れながら留まる gunship の弾幕と、scout の護衛 |

## clear までの流れ

timeline の spawn を出し終え、敵と pickup が playfield からいなくなると stage clear になる。どの path も敵を画面の外（cleanup の余白の外）まで運ぶので、倒し損ねた敵が退場しても clear できる。lives がなくなれば game over。

golden の入力では、26 体すべてを倒し、drone が落とした pickup 36 個のうち 32 個を回収し（10 点ずつ）、wave 6 で 1 回被弾して、tick 2216 に score 3920、lives 2 で clear する。

## 機械で読める仕様

```json sample-content-spec
{
  "stage": "stage.stage_01",
  "difficulties": ["normal"],
  "player": "player.default",
  "waves": [
    { "wave": 1, "ticks": [90, 150], "spawns": { "enemy.drone": 5 }, "patterns": ["pattern.drone_aimed_shot"] },
    { "wave": 2, "ticks": [330, 450], "spawns": { "enemy.drone": 6 }, "patterns": ["pattern.drone_aimed_shot"] },
    { "wave": 3, "ticks": [600, 720], "spawns": { "enemy.scout": 3 }, "patterns": ["pattern.scout_three_way"] },
    { "wave": 4, "ticks": [960, 990], "spawns": { "enemy.scout": 2 }, "patterns": ["pattern.scout_three_way"] },
    { "wave": 5, "ticks": [1320, 1365], "spawns": { "enemy.drone": 7 }, "patterns": ["pattern.drone_aimed_shot"] },
    {
      "wave": 6,
      "ticks": [1620, 1860],
      "spawns": { "enemy.gunship": 1, "enemy.scout": 2 },
      "patterns": ["pattern.gunship_barrage", "pattern.scout_three_way"]
    }
  ],
  "enemies": {
    "enemy.drone": { "hp": 5, "score": 50, "drops": { "pickup.score_small": 2 } },
    "enemy.scout": { "hp": 10, "score": 100, "drops": {} },
    "enemy.gunship": { "hp": 200, "score": 2000, "drops": {} }
  },
  "patterns": {
    "pattern.drone_aimed_shot": ["aim"],
    "pattern.scout_three_way": ["aim", "fan", "loop"],
    "pattern.gunship_barrage": ["aim", "angleDeg", "fan", "loop", "radial"]
  },
  "pickups": { "pickup.score_small": { "score": 10 } },
  "golden": {
    "seed": "stage-01-golden",
    "weavePeriodTicks": 80,
    "clearTick": 2216,
    "score": 3920,
    "lives": 2,
    "defeats": { "enemy.drone": 18, "enemy.scout": 7, "enemy.gunship": 1 },
    "pickups": { "dropped": 36, "collected": 32, "score": 320 },
    "playerHits": [1894],
    "firstThreeWayTick": 660,
    "firstRadialTick": 1770
  }
}
```

- `waves`: timeline の spawn は、どれか 1 つの wave の `ticks`（両端を含む）に入る。`spawns` は wave の敵の数、`patterns` は wave の spawn が使う pattern。
- `patterns`: pattern が使う Pattern DSL の命令と fire の修飾（`aim`、`angleDeg`、`fan`、`radial`、`stream`、`loop`、`repeat`、`if`）。
- `golden`: `stage-01-replay.golden.json` の主要な値（clear の tick、score、lives、倒した敵の数、pickup、被弾の tick、最初の 3-way と radial の tick）。
