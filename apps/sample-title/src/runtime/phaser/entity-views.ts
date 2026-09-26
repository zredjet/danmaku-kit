import type { ReadonlyEntityState } from "@shooting-sample/shooting-core";
import type { GameObjects, Scene } from "phaser";

import type { RuntimeEvent } from "../runtime-event.ts";
import { diffEntityViews } from "../view/entity-view-diff.ts";
import { ViewPool } from "../view/view-pool.ts";

type EntityKind = ReadonlyEntityState["kind"];

/** 敵弾を自機より手前に置き、弾幕の読みやすさを優先する。 */
const DEPTH_BY_KIND: Readonly<Record<EntityKind, number>> = {
  enemy: 1,
  playerShot: 2,
  player: 3,
  enemyBullet: 4,
};
const KINDS = Object.keys(DEPTH_BY_KIND) as EntityKind[];
const PLAYER_HITBOX_COLOR = 0xffffff;
const PLAYER_HITBOX_DEPTH = 5;
/** Phaser が必ず持つ texture。pool の view は使う直前に definition の texture へ差し替える。 */
const PLACEHOLDER_TEXTURE = "__DEFAULT";

type EntityView = Readonly<{ kind: EntityKind; image: GameObjects.Image }>;

export type EntityViewsOptions = Readonly<{
  collisionRadii: ReadonlyMap<string, number>;
  /** definition id から読み込み済み texture の key を引く表。 */
  textures: ReadonlyMap<string, string>;
  capacities: Readonly<Record<EntityKind, number>>;
}>;

/**
 * `GameFrame.state.entities` と Phaser の image を entity id で同期する（design 5.4）。
 *
 * kind ごとの view pool を stage start 前に `warm()` で作っておき、stage 中は image を生成・破棄せずに使い回す。消えた entity の view は
 * その render frame で隠して pool へ戻し、新しい entity には pool の image へ definition の texture を当てる。pool を使い切ったら
 * `viewPoolExhausted` を返し、呼び出し側が stage を止める。自機の判定は focus 中だけ本体の上に重ねて表示する。
 */
export class EntityViews {
  readonly #options: EntityViewsOptions;
  readonly #pools: Readonly<Record<EntityKind, ViewPool<GameObjects.Image>>>;
  readonly #views = new Map<ReadonlyEntityState["id"], EntityView>();
  readonly #playerHitbox: GameObjects.Arc;

  constructor(scene: Scene, options: EntityViewsOptions) {
    this.#options = options;
    const createPool = (kind: EntityKind) => new ViewPool(options.capacities[kind], () => (
      scene.add.image(0, 0, PLACEHOLDER_TEXTURE).setDepth(DEPTH_BY_KIND[kind]).setVisible(false).setActive(false)
    ));
    this.#pools = {
      enemy: createPool("enemy"),
      playerShot: createPool("playerShot"),
      player: createPool("player"),
      enemyBullet: createPool("enemyBullet"),
    };
    this.#playerHitbox = scene.add.circle(0, 0, 1, PLAYER_HITBOX_COLOR).setDepth(PLAYER_HITBOX_DEPTH).setVisible(false);
  }

  /** view pool をまだ作っていない分から最大 `maxCreates` 個作り、全 pool を作り終えたら true を返す。 */
  warm(maxCreates: number): boolean {
    let budget = maxCreates;
    for (const kind of KINDS) {
      budget -= this.#pools[kind].warm(budget);
    }
    return KINDS.every((kind) => this.#pools[kind].created === this.#pools[kind].capacity);
  }

  /** 作った view と、作る view の合計。loading の進み具合の表示に使う。 */
  get warmProgress(): Readonly<{ created: number; capacity: number }> {
    return {
      created: KINDS.reduce((total, kind) => total + this.#pools[kind].created, 0),
      capacity: KINDS.reduce((total, kind) => total + this.#pools[kind].capacity, 0),
    };
  }

  /**
   * frame の entity に合わせて view を出し入れ・移動し、focus 中なら自機の判定を表示する。
   *
   * pool を使い切った kind があれば、その entity を表示せずに `viewPoolExhausted` を返す。
   */
  sync(entities: readonly ReadonlyEntityState[], options: Readonly<{ showPlayerHitbox: boolean }>): RuntimeEvent | null {
    const diff = diffEntityViews(this.#views.keys(), entities);
    for (const id of diff.destroyedIds) {
      const view = this.#views.get(id);
      if (view) {
        view.image.setVisible(false).setActive(false);
        this.#pools[view.kind].release(view.image);
        this.#views.delete(id);
      }
    }
    for (const entity of diff.spawned) {
      const pool = this.#pools[entity.kind];
      const image = pool.acquire();
      if (!image) {
        return { type: "viewPoolExhausted", kind: entity.kind, capacity: pool.capacity, entityId: entity.id };
      }
      image.setTexture(this.#textureOf(entity)).setPosition(entity.position.x, entity.position.y).setVisible(true).setActive(true);
      this.#views.set(entity.id, { kind: entity.kind, image });
    }
    for (const entity of diff.updated) {
      this.#views.get(entity.id)?.image.setPosition(entity.position.x, entity.position.y);
    }

    const player = entities.find((entity) => entity.kind === "player");
    this.#playerHitbox.setVisible(options.showPlayerHitbox && player !== undefined);
    if (player) {
      this.#playerHitbox.setPosition(player.position.x, player.position.y);
      // setRadius は geometry を作り直すため、自機の定義が変わったときだけ呼ぶ。
      const radius = this.#collisionRadiusOf(player);
      if (this.#playerHitbox.radius !== radius) {
        this.#playerHitbox.setRadius(radius);
      }
    }
    return null;
  }

  #textureOf(entity: ReadonlyEntityState): string {
    const texture = this.#options.textures.get(entity.definitionId);
    if (texture === undefined) {
      throw new Error(`No texture for ${entity.definitionId}`);
    }
    return texture;
  }

  #collisionRadiusOf(entity: ReadonlyEntityState): number {
    const radius = this.#options.collisionRadii.get(entity.definitionId);
    if (radius === undefined) {
      throw new Error(`No collision radius for ${entity.definitionId}`);
    }
    return radius;
  }
}
