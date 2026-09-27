# Content の最小の例

content を書き始めるときの最小の例。`game-definition.yaml` と `content/` がそのまま 1 つの content として validate-content を通り、入力のない自機でも stage を clear まで進められる（`tests/content-authoring-examples.test.ts` が確かめる）。file 名は id の namespace を除いた部分にそろえる（`enemy.example` は `enemies/example.yaml`）。field の意味は各 file の comment と `docs/design.md` の各節を見る。

```sh
npm run validate-content -- --game-definition docs/content-authoring/examples/game-definition.yaml --content-root docs/content-authoring/examples/content --format human
```

| file | 内容 |
| --- | --- |
| `game-definition.yaml` | schema の version、有効な optional feature（`pickup`）、既定の自機、content の version |
| `content/assets/manifest.yaml` | asset manifest。content の `asset` が参照する key と、runtime が読む file の path |
| `content/players/example.yaml` | 自機。移動の速さ、当たり判定、lives と被弾後の無敵、shot |
| `content/player-shots/example.yaml` | 自機の shot。発射の間隔、速度、寿命、damage |
| `content/bullets/example.yaml` | 敵弾。当たり判定と sprite（向きと速さは pattern が決める） |
| `content/enemies/example.yaml` | 敵。hp、score、撃破で落とす pickup（`drops`） |
| `content/paths/example_dive.yaml` | 敵の移動 path。等速の segment と、sine の揺れ（`offset`） |
| `content/patterns/example_aimed.yaml` | 敵の pattern。`wait`、自機を狙う `fire` と `fan`、`loop` |
| `content/patterns/example_ring.yaml` | 敵の pattern。`repeat`、`radial`、`stream`、stage の difficulty で分ける `if` |
| `content/pickups/example.yaml` | pickup（pickup feature）。回収の半径、吸い寄せの半径、score |
| `content/stages/example.yaml` | stage。difficulty と、tick ごとに敵を出す timeline |

例にない形:

- pattern は `steps` の代わりに、spawn した tick に 1 度だけ撃つ `fireOnSpawn`（`bullet`、`offset`、`velocity`）でも書ける。
- `fire` の `origin` は発射元で、今は敵の位置（`self`）だけを取る。
- asset manifest の entry は `required: false` と `fallback`（別の asset の key）で、読めなかったときの代わりを決められる。

sample title の content（`apps/sample-title/content/`）は、これらを組み合わせて遊べる長さにした例になる。
