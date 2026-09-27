/** 1 つの enemy が落とす pickup の数の上限（drops の `count` の合計）。 */
export const MAX_PICKUP_DROPS_PER_ENEMY = 16;

/** drops の `spread`（横に並べる幅、px）の上限。 */
export const MAX_PICKUP_DROP_SPREAD = 128;

/** pickup の `collectRadius`（px）の上限。 */
export const MAX_PICKUP_COLLECT_RADIUS = 64;

/** pickup の `magnetRadius`（px）の上限。 */
export const MAX_PICKUP_MAGNET_RADIUS = 256;

/**
 * pickup の速度の軸ごとの上限（px / tick）。敵弾と同じく 1 tick の移動量を抑えて回収の判定のすり抜けを小さくする（小さい
 * `collectRadius` でも起きないことを保証する swept の判定は Later）。
 */
export const MAX_PICKUP_SPEED_PER_AXIS = 8;
