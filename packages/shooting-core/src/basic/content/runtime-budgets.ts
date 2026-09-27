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

/** path segment の sine offset の振幅の絶対値上限（px）。 */
export const MAX_PATH_SINE_AMPLITUDE = 256;

/** path segment の sine offset の周期 tick 上限。 */
export const MAX_PATH_SINE_PERIOD_TICKS = 3_600;

/**
 * path を終えた enemy を cleanup する playfield 外の余白（px）。
 *
 * 画面外から登場する enemy を path の途中で消さないよう、cleanup は path を終えた enemy の中心が playfield をこの余白より
 * 外れたときだけ行う。
 */
export const ENEMY_CLEANUP_PLAYFIELD_MARGIN = 64;

/**
 * enemy bullet velocity の axis ごとの絶対値上限（px / tick）。
 *
 * swept collision を入れるまでは、1 tick の移動量が自機と敵弾の判定半径の合計（約 7 px）を大きく超えて弾が自機をすり抜けない
 * ように、この上限で速度を制限する。pattern の `fire.speed` もこの値以下にし、表の単位 vector を掛けた各成分が上限を超えない。
 */
export const MAX_ENEMY_BULLET_SPEED_PER_AXIS = 8;

/** 1 pattern が持てる step 数の上限。 */
export const MAX_PATTERN_STEPS = 64;

/** pattern の `wait` 1 つの tick 上限。 */
export const MAX_PATTERN_WAIT_TICKS = 3_600;

/** pattern の `fire` 1 つが並べる fan の弾数上限。 */
export const MAX_PATTERN_FAN_COUNT = 64;

/** pattern の `fire.radial.count` の上限。 */
export const MAX_PATTERN_RADIAL_COUNT = 64;

/** pattern の `fire.stream.count` の上限。 */
export const MAX_PATTERN_STREAM_COUNT = 16;

/** pattern の `repeat.count` の上限。 */
export const MAX_PATTERN_REPEAT_COUNT = 256;

/** `repeat` の入れ子の深さの上限。 */
export const MAX_PATTERN_REPEAT_DEPTH = 4;

/**
 * `repeat` を展開した後の pattern の命令数の上限。load 時の展開と PatternProgram の run の表の大きさを抑える。
 */
export const MAX_PATTERN_EXPANDED_COMMANDS = 4_096;

/** pattern の `angleDeg` の絶対値と `fan.spreadDeg` の上限（度）。 */
export const MAX_PATTERN_ANGLE_DEGREES = 360;

/**
 * 1 tick に全 pattern runner が実行できる命令数の上限（design 14）。
 *
 * `loop` は戻り先までに `wait` を含むことを validation で保証するが、多数の enemy が長い命令列を同じ tick に実行したときの上限はこの
 * budget で守る。超えた tick は fatal にする。
 */
export const MAX_PATTERN_COMMANDS_PER_TICK = 2_000;

/** 同時に存在できる enemy bullet 数の上限（design 14）。超える生成は entity を落とさず fatal にする。 */
export const MAX_ACTIVE_ENEMY_BULLETS = 2_000;

/** enemy bullet を cleanup する playfield 外の余白（px）。中心がこの余白より外れた敵弾は update lifetime で取り除く。 */
export const ENEMY_BULLET_CLEANUP_PLAYFIELD_MARGIN = 32;
