/** 1 stage の timeline step 数上限。content validation と restore validation で共有する。 */
export const MAX_STAGE_TIMELINE_STEPS = 4_096;

/** 同一 tick に stage timeline から spawn できる enemy 数上限。 */
export const MAX_SPAWNS_PER_TICK = 100;

/** player movement speed の runtime budget。 */
export const MAX_PLAYER_MOVEMENT_SPEED = 16;

/** player の中心座標を許可する playfield 幅。 */
export const PLAYFIELD_WIDTH = 384;

/** player の中心座標を許可する playfield 高さ。 */
export const PLAYFIELD_HEIGHT = 448;

/** player shot の連射 interval 上限。 */
export const MAX_PLAYER_SHOT_FIRE_INTERVAL_TICKS = 60;

/** player shot が保持できる lifetime tick 上限。 */
export const MAX_PLAYER_SHOT_LIFETIME_TICKS = 300;

/** player shot velocity の axis ごとの絶対値上限。 */
export const MAX_PLAYER_SHOT_SPEED_PER_AXIS = 64;

/** 1 path が持てる segment 数の上限。 */
export const MAX_PATH_SEGMENTS = 64;

/** path segment 1 つの duration tick 上限。path 全体の進行 tick を safe integer に収める。 */
export const MAX_PATH_SEGMENT_DURATION_TICKS = 3_600;

/** path segment velocity の axis ごとの絶対値上限（px / tick）。 */
export const MAX_PATH_SPEED_PER_AXIS = 16;

/**
 * path を終えた enemy を cleanup する playfield 外の余白（px）。
 *
 * 画面外から登場する enemy を path の途中で消さないよう、cleanup は path を終えた enemy の中心が playfield をこの余白より
 * 外れたときだけ行う。
 */
export const ENEMY_CLEANUP_PLAYFIELD_MARGIN = 64;
