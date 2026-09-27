import type { ReadonlyEntityState, ReadonlyGameState, ReadonlyPickupState } from "@danmaku-kit/core";

type Point = Readonly<{ x: number; y: number }>;

/** 描画する entity の種類。Core の entity の kind と、pickup feature の pickup。 */
export type ViewKind = ReadonlyEntityState["kind"] | "pickup";

/** view と同期する entity（Core の `entities` と `features.pickups` をまとめたもの）。id は 1 stage の中で種類をまたいで一意。 */
export type ViewEntity = Readonly<{
  id: ReadonlyEntityState["id"];
  kind: ViewKind;
  definitionId: string;
  position: Point;
}>;

/** 吸い寄せに入った pickup を自機へ寄せ切るまでの tick 数（Core が回収するまでの 12 tick に合わせる）。 */
export const PICKUP_ATTRACTION_VIEW_TICKS = 12;

/**
 * 吸い寄せに入った pickup を、自機へ寄せていく描画の演出（render-only）。
 *
 * Core は吸い寄せに入った pickup の位置を止めて 12 tick 後に回収するので、描画は吸い寄せに入った tick の位置から自機の位置へ、tick
 * ごとに寄せる。Core の state は変えない。stage が変わったら `clear()` する。吸い寄せに入ったことは frame で知るため、1 render frame
 * に複数の tick が進むと寄せ始めがその分遅れ、自機の手前で回収されて消えることがある（描画だけの差）。
 */
export class PickupAttraction {
  readonly #started = new Map<ReadonlyPickupState["id"], Readonly<{ tick: number; from: Point }>>();

  /** frame の pickup の描画の位置。吸い寄せに入っていない pickup は Core の位置のまま。 */
  positions(pickups: readonly ReadonlyPickupState[], player: Point | null, tick: number): ReadonlyMap<number, Point> {
    const positions = new Map<number, Point>();
    const current = new Set<number>();
    for (const pickup of pickups) {
      current.add(pickup.id);
      if (!pickup.attracted || player === null) {
        positions.set(pickup.id, pickup.position);
        continue;
      }
      let started = this.#started.get(pickup.id);
      if (!started) {
        started = { tick, from: pickup.position };
        this.#started.set(pickup.id, started);
      }
      const progress = Math.min(1, (tick - started.tick + 1) / PICKUP_ATTRACTION_VIEW_TICKS);
      positions.set(pickup.id, {
        x: started.from.x + (player.x - started.from.x) * progress,
        y: started.from.y + (player.y - started.from.y) * progress,
      });
    }
    for (const id of this.#started.keys()) {
      if (!current.has(id)) {
        this.#started.delete(id);
      }
    }
    return positions;
  }

  clear(): void {
    this.#started.clear();
  }
}

/**
 * frame の state から、描画する entity を並べる（Core の entity を id の順に並べた後に pickup を id の順に並べる）。state がなければ空。
 *
 * `attraction` を渡すと吸い寄せ中の pickup を自機へ寄せた位置にし、null なら Core の位置のままにする（debug overlay の collider は
 * Core の位置を描く）。
 */
export function collectViewEntities(state: ReadonlyGameState | null, attraction: PickupAttraction | null): readonly ViewEntity[] {
  if (state === null) {
    return [];
  }
  const pickups = state.features?.pickups ?? [];
  if (pickups.length === 0) {
    attraction?.clear();
    return state.entities;
  }
  const player = state.entities.find((entity) => entity.kind === "player")?.position ?? null;
  const positions = attraction?.positions(pickups, player, state.tick) ?? new Map<number, Point>();
  return [
    ...state.entities,
    ...pickups.map((pickup) => ({
      id: pickup.id,
      kind: "pickup" as const,
      definitionId: pickup.definitionId,
      position: positions.get(pickup.id) ?? pickup.position,
    })),
  ];
}
