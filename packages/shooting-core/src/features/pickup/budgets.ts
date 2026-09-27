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

/** active な pickup の上限（design 14）。超える drop は、pickup を出さずに stage session を fatal にする（content 側で守る）。 */
export const MAX_ACTIVE_PICKUPS = 300;

/** 吸い寄せに入った pickup を回収するまでの tick 数。この間、pickup は位置を止め、描画は自機へ寄せる演出にしてよい。 */
export const PICKUP_ATTRACT_TICKS = 12;

/** pickup の中心が playfield からこの幅より外に出た tick に、event を出さずに取り除く（px）。 */
export const PICKUP_CLEANUP_PLAYFIELD_MARGIN = 32;
