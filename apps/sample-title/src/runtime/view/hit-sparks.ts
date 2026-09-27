import type { GameEvent, ReadonlyEntityState } from "@shooting-sample/shooting-core";

/** hit spark の上限と寿命。上限を超えた spark は出さずに落とす。 */
export type HitSparkBudget = Readonly<{
  /** 同時に出ている spark の上限。Phaser 側はこの数の view を先に作っておく。 */
  maxActive: number;
  /** 1 render frame に新しく出す spark の上限。 */
  maxSpawnsPerFrame: number;
  lifetimeMs: number;
}>;

export const HIT_SPARK_BUDGET: HitSparkBudget = Object.freeze({ maxActive: 32, maxSpawnsPerFrame: 8, lifetimeMs: 240 });

/** 描画する spark。`progress` は出た瞬間が 0 で、寿命が尽きる直前に 1 へ近づく。 */
export type HitSpark = Readonly<{ x: number; y: number; progress: number }>;

type Position = Readonly<{ x: number; y: number }>;
type ActiveSpark = { readonly x: number; readonly y: number; ageMs: number };

/**
 * 敵の撃破（`entityDestroyed` の reason `defeated`）を render-only の hit spark に変える（design 5.4、16）。
 *
 * `entityDestroyed` は位置を持たないため、撃破された敵を直前に描いた位置（`positionOf`）に出し、一度も描かずに消えた敵には出さない。
 * spark は render frame の経過時間で古くなり、replay と state hash には含めない。1 render frame に出す数か同時に出ている数の上限を
 * 超えた分は gameplay view を優先して落とし、落とした数を数える。
 */
export class HitSparks {
  readonly #budget: HitSparkBudget;
  #sparks: ActiveSpark[] = [];
  #droppedTotal = 0;

  constructor(budget: HitSparkBudget = HIT_SPARK_BUDGET) {
    this.#budget = budget;
  }

  /** 出ている spark を `deltaMs` だけ古くして寿命の尽きたものを消し、`events` の撃破から新しい spark を出す。 */
  update(
    deltaMs: number,
    events: readonly GameEvent[],
    positionOf: (entityId: ReadonlyEntityState["id"]) => Position | null,
  ): void {
    const age = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
    const alive: ActiveSpark[] = [];
    for (const spark of this.#sparks) {
      spark.ageMs += age;
      if (spark.ageMs < this.#budget.lifetimeMs) {
        alive.push(spark);
      }
    }
    this.#sparks = alive;

    let spawned = 0;
    for (const event of events) {
      if (event.type !== "entityDestroyed" || event.reason !== "defeated") {
        continue;
      }
      const position = positionOf(event.entityId);
      if (!position) {
        continue;
      }
      if (spawned >= this.#budget.maxSpawnsPerFrame || this.#sparks.length >= this.#budget.maxActive) {
        this.#droppedTotal += 1;
        continue;
      }
      this.#sparks.push({ x: position.x, y: position.y, ageMs: 0 });
      spawned += 1;
    }
  }

  get active(): readonly HitSpark[] {
    return this.#sparks.map((spark) => ({ x: spark.x, y: spark.y, progress: spark.ageMs / this.#budget.lifetimeMs }));
  }

  /** 上限を超えて落とした spark の合計。 */
  get droppedTotal(): number {
    return this.#droppedTotal;
  }

  /** stage を始めたときと離れたときに、前の stage の spark を消す。 */
  clear(): void {
    this.#sparks = [];
  }
}
