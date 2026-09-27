import { PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from "../content/runtime-budgets.ts";
import type { Vector2 } from "../entities/model-common.ts";

/** broad phase grid の cell の一辺（px）。playfield 384x448 を 12x14 cell に分ける。 */
export const COLLISION_GRID_CELL_SIZE = 32;

const COLUMNS = Math.ceil(PLAYFIELD_WIDTH / COLLISION_GRID_CELL_SIZE);
const ROWS = Math.ceil(PLAYFIELD_HEIGHT / COLLISION_GRID_CELL_SIZE);

/** grid に登録できる円の collider。 */
export type CollisionGridCollider = Readonly<{
  id: number;
  position: Vector2;
  collisionRadius: number;
}>;

/**
 * collision broad phase の固定サイズ grid（design 13）。1 tick の collision 解決の間だけ、1 つの layer の collider を持つ。
 *
 * collider は中心の cell に 1 回だけ登録する。playfield の外の座標は端の cell にまとめる（座標から cell への写像が単調なので、
 * 範囲が重なる collider は必ず重なる cell 範囲に入る）。問い合わせは、問い合わせ側の半径と登録済み collider の最大半径の和だけ
 * 中心から広げた範囲の cell を、浮動小数点の丸めで境界をまたいでも取りこぼさないよう前後 1 cell ずつ広げて調べる。
 */
export class CollisionGrid<T extends CollisionGridCollider> {
  /** collider のある cell だけ配列を持つ。 */
  readonly #cells: (T[] | undefined)[] = new Array<T[] | undefined>(COLUMNS * ROWS);
  readonly #maxRadius: number;
  readonly #size: number;

  constructor(colliders: readonly T[]) {
    let maxRadius = 0;
    for (const collider of colliders) {
      (this.#cells[cellIndex(columnOf(collider.position.x), rowOf(collider.position.y))] ??= []).push(collider);
      maxRadius = Math.max(maxRadius, collider.collisionRadius);
    }
    this.#maxRadius = maxRadius;
    this.#size = colliders.length;
  }

  /** `center` を中心とする半径 `radius` の円と重なり得る collider を entity id の昇順で返す。 */
  query(center: Vector2, radius: number): T[] {
    if (this.#size === 0) {
      return [];
    }
    const reach = radius + this.#maxRadius;
    const firstColumn = Math.max(0, columnOf(center.x - reach) - 1);
    const lastColumn = Math.min(COLUMNS - 1, columnOf(center.x + reach) + 1);
    const firstRow = Math.max(0, rowOf(center.y - reach) - 1);
    const lastRow = Math.min(ROWS - 1, rowOf(center.y + reach) + 1);
    const candidates: T[] = [];
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const cell = this.#cells[cellIndex(column, row)];
        if (cell) {
          candidates.push(...cell);
        }
      }
    }
    return candidates.sort((left, right) => left.id - right.id);
  }
}

function columnOf(x: number): number {
  return clamp(Math.floor(x / COLLISION_GRID_CELL_SIZE), COLUMNS - 1);
}

function rowOf(y: number): number {
  return clamp(Math.floor(y / COLLISION_GRID_CELL_SIZE), ROWS - 1);
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function cellIndex(column: number, row: number): number {
  return row * COLUMNS + column;
}
