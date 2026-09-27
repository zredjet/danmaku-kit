import type { PickupId } from "../content/types.ts";

/**
 * pickup feature が frame に出す pickup（`ReadonlyGameState.features.pickups`）。
 *
 * `attracted` の pickup は自機の吸い寄せに入って位置を止め、決まった tick の後に回収される。描画はその間、自機へ寄せる演出にしてよい。
 */
export type ReadonlyPickupState = Readonly<{
  id: number;
  definitionId: PickupId;
  position: Readonly<{ x: number; y: number }>;
  attracted: boolean;
}>;

/** 有効な optional feature が frame に出す state。basic の `entities` とは分け、feature が有効な content だけが持つ。 */
export type ReadonlyFeatureFrameState = Readonly<{
  pickups?: readonly ReadonlyPickupState[];
}>;
