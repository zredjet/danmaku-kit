import type { ReadonlyEntityState } from "@shooting-sample/shooting-core";
import type { GameObjects, Scene } from "phaser";

import { ENTITY_KINDS, type EntityKind } from "../view/entity-counts.ts";

const COLLIDER_COLOR_BY_KIND: Readonly<Record<EntityKind, number>> = {
  player: 0xffffff,
  enemy: 0xfbbf24,
  enemyBullet: 0xf87171,
  playerShot: 0x86efac,
};
const COLLIDER_LINE_WIDTH = 1;
const COLLIDER_ALPHA = 0.9;
/** entity と演出より手前に重ねる。 */
const COLLIDER_DEPTH = 7;

/**
 * debug overlay の collider 表示（design 19）。content の collision radius の円を entity ごとに描く。
 *
 * `GameFrame` の entity は半径を持たないため、definition id から content の半径を引く。表示中だけ、state が変わった frame で描き直す。
 * 線の色は kind ごとに 1 回だけ設定し、敵弾が多い場面でも Graphics の command を entity 数の円だけに抑える。
 */
export class ColliderOverlay {
  readonly #graphics: GameObjects.Graphics;
  readonly #collisionRadii: ReadonlyMap<string, number>;

  constructor(scene: Scene, collisionRadii: ReadonlyMap<string, number>) {
    this.#graphics = scene.add.graphics().setDepth(COLLIDER_DEPTH).setVisible(false);
    this.#collisionRadii = collisionRadii;
  }

  draw(entities: readonly ReadonlyEntityState[], visible: boolean): void {
    const graphics = this.#graphics;
    graphics.clear().setVisible(visible);
    if (!visible) {
      return;
    }
    for (const kind of ENTITY_KINDS) {
      graphics.lineStyle(COLLIDER_LINE_WIDTH, COLLIDER_COLOR_BY_KIND[kind], COLLIDER_ALPHA);
      for (const entity of entities) {
        if (entity.kind !== kind) {
          continue;
        }
        const radius = this.#collisionRadii.get(entity.definitionId);
        if (radius === undefined) {
          throw new Error(`No collision radius for ${entity.definitionId}`);
        }
        graphics.strokeCircle(entity.position.x, entity.position.y, radius);
      }
    }
  }
}
