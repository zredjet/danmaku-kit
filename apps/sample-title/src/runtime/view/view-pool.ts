/**
 * 1 種類の view を capacity まで使い回す pool（design 5.4）。Phaser に依存せず、view の生成は `create` に任せる。
 *
 * stage start 前に `warm()` で 1 render frame あたりの生成数を抑えながら capacity まで作り、stage 中は `acquire()` / `release()` で
 * 使い回して view を生成・破棄しない。capacity を使い切ったら `acquire()` は null を返し、呼び出し側が枯渇として扱う。
 */
export class ViewPool<T> {
  readonly #capacity: number;
  readonly #create: () => T;
  readonly #free: T[] = [];
  #created = 0;

  constructor(capacity: number, create: () => T) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new RangeError("view pool capacity must be a non-negative safe integer");
    }
    this.#capacity = capacity;
    this.#create = create;
  }

  get capacity(): number {
    return this.#capacity;
  }

  /** 作り終えた view の数。 */
  get created(): number {
    return this.#created;
  }

  /** まだ作っていない view を最大 `maxCreates` 個作って空きに加え、作った数を返す。 */
  warm(maxCreates: number): number {
    const count = Math.max(0, Math.min(maxCreates, this.#capacity - this.#created));
    for (let index = 0; index < count; index += 1) {
      this.#free.push(this.#create());
    }
    this.#created += count;
    return count;
  }

  /** 空いている view を取り出す。warm が終わっていなければ capacity までその場で作り、使い切っていれば null を返す。 */
  acquire(): T | null {
    const view = this.#free.pop();
    if (view !== undefined) {
      return view;
    }
    return this.warm(1) === 1 ? this.#free.pop()! : null;
  }

  /** 使い終えた view を空きに戻す。 */
  release(view: T): void {
    this.#free.push(view);
  }
}
