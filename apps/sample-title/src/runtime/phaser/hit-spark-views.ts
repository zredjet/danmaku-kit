import type { GameObjects, Scene } from "phaser";

import type { HitSpark } from "../view/hit-sparks.ts";

const SPARK_COLOR = 0xfde68a;
const SPARK_RADIUS = 8;
const SPARK_STROKE_WIDTH = 2;
/** 敵の上、自機の shot・自機・敵弾の下に置き、敵弾の読みやすさを邪魔しない（design 15.3）。 */
const SPARK_DEPTH = 1.5;

/**
 * hit spark を描く円の view。上限の数だけ先に作り、render frame ごとに出ている spark を先頭から順に当てて残りを隠す。
 *
 * spark は entity と対応しない render-only の演出なので、id で対応付けずに毎 frame 当て直す。
 */
export class HitSparkViews {
  readonly #circles: readonly GameObjects.Arc[];
  #shown = 0;

  constructor(scene: Scene, capacity: number) {
    this.#circles = Array.from({ length: capacity }, () => (
      scene.add.circle(0, 0, SPARK_RADIUS).setStrokeStyle(SPARK_STROKE_WIDTH, SPARK_COLOR).setDepth(SPARK_DEPTH).setVisible(false)
    ));
  }

  /** spark ごとに円を広げながら薄くし、前の frame に出していて今は使わない円を隠す。 */
  render(sparks: readonly HitSpark[]): void {
    const count = Math.min(sparks.length, this.#circles.length);
    for (let index = 0; index < Math.max(count, this.#shown); index += 1) {
      const circle = this.#circles[index]!;
      const spark = index < count ? sparks[index] : undefined;
      circle.setVisible(spark !== undefined);
      if (spark) {
        circle.setPosition(spark.x, spark.y).setScale(0.5 + spark.progress).setAlpha(1 - spark.progress);
      }
    }
    this.#shown = count;
  }
}
