import type { ReadonlyEntityState } from "@shooting-sample/shooting-core";
import type { GameObjects, Scene } from "phaser";

import { diffEntityViews } from "../view/entity-view-diff.ts";

type EntityKind = ReadonlyEntityState["kind"];

/**
 * asset manifest の sprite へ置き換えるまで（Phase 2A-8）の、kind ごとの仮表示。
 *
 * 自機は判定より大きい本体を描き、その他は collision radius の円で描く。敵弾は自機より手前に置き、弾幕の読みやすさを優先する。
 */
const PLACEHOLDER_STYLE: Readonly<Record<EntityKind, Readonly<{ color: number; depth: number; radius?: number }>>> = {
  enemy: { color: 0xf87171, depth: 1 },
  playerShot: { color: 0x86efac, depth: 2 },
  player: { color: 0x7dd3fc, depth: 3, radius: 8 },
  enemyBullet: { color: 0xfbbf24, depth: 4 },
};
const PLAYER_HITBOX_COLOR = 0xffffff;
const PLAYER_HITBOX_DEPTH = 5;

/**
 * `GameFrame.state.entities` と Phaser の game object を entity id で同期する。
 *
 * object pool と 1 frame の生成・破棄上限は Phase 2A-8 で入れる。自機の判定は focus 中だけ本体の上に重ねて表示する。
 */
export class EntityViews {
  readonly #scene: Scene;
  readonly #collisionRadii: ReadonlyMap<string, number>;
  readonly #views = new Map<ReadonlyEntityState["id"], GameObjects.Arc>();
  readonly #playerHitbox: GameObjects.Arc;

  constructor(scene: Scene, collisionRadii: ReadonlyMap<string, number>) {
    this.#scene = scene;
    this.#collisionRadii = collisionRadii;
    this.#playerHitbox = scene.add.circle(0, 0, 1, PLAYER_HITBOX_COLOR).setDepth(PLAYER_HITBOX_DEPTH).setVisible(false);
  }

  /** frame の entity に合わせて view を生成・移動・破棄し、focus 中なら自機の判定を表示する。 */
  sync(entities: readonly ReadonlyEntityState[], options: Readonly<{ showPlayerHitbox: boolean }>): void {
    const diff = diffEntityViews(this.#views.keys(), entities);
    for (const id of diff.destroyedIds) {
      this.#views.get(id)?.destroy();
      this.#views.delete(id);
    }
    for (const entity of diff.spawned) {
      this.#views.set(entity.id, this.#createView(entity));
    }
    for (const entity of diff.updated) {
      this.#views.get(entity.id)?.setPosition(entity.position.x, entity.position.y);
    }

    const player = entities.find((entity) => entity.kind === "player");
    this.#playerHitbox.setVisible(options.showPlayerHitbox && player !== undefined);
    if (player) {
      this.#playerHitbox.setPosition(player.position.x, player.position.y).setRadius(this.#collisionRadiusOf(player));
    }
  }

  #createView(entity: ReadonlyEntityState): GameObjects.Arc {
    const style = PLACEHOLDER_STYLE[entity.kind];
    const radius = style.radius ?? this.#collisionRadiusOf(entity);
    return this.#scene.add.circle(entity.position.x, entity.position.y, radius, style.color).setDepth(style.depth);
  }

  #collisionRadiusOf(entity: ReadonlyEntityState): number {
    const radius = this.#collisionRadii.get(entity.definitionId);
    if (radius === undefined) {
      throw new Error(`No collision radius for ${entity.definitionId}`);
    }
    return radius;
  }
}
