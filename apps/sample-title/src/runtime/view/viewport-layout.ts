import { PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from "./playfield.ts";

/** Phaser の canvas を描く解像度の倍率の上限。大きな画面の高 DPI で canvas の画素数が増えすぎないようにする。 */
export const MAX_RENDER_SCALE = 4;
/** render scale の刻み。1/4 刻みなら内部解像度（384x448）との積が整数になり、camera の zoom と canvas の画素がずれない。 */
const RENDER_SCALE_STEPS_PER_UNIT = 4;
/** 浮動小数点の誤差で、ちょうど刻みにある値を次の刻みへ切り上げないための幅。 */
const RENDER_SCALE_EPSILON = 1e-9;

/** 表示先の大きさ（CSS px）と devicePixelRatio。 */
export type ViewportSize = Readonly<{
  width: number;
  height: number;
  devicePixelRatio: number;
}>;

/**
 * 内部解像度の playfield を viewport へ置く配置（design 12）。
 *
 * canvas と DOM overlay は同じ transform root に入れ、root を (`letterboxX`, `letterboxY`) へ動かして `scale` 倍する。
 * `renderScale` は Phaser の canvas を描く解像度の倍率で、devicePixelRatio はここにだけ効く。どの値も Simulation の座標には影響しない。
 */
export type ViewportLayout = Readonly<{
  logicalWidth: number;
  logicalHeight: number;
  scale: number;
  letterboxX: number;
  letterboxY: number;
  devicePixelRatio: number;
  renderScale: number;
}>;

/**
 * viewport に playfield を収める配置を求める。
 *
 * 収まる最大の整数倍で表示し、余りは上下左右へ半分ずつの letterbox にする（letterbox は整数 px に切り捨てる）。viewport が内部解像度
 * より小さい軸があるときだけ、収まる小数倍へ縮小する。拡大・縮小のどちらでも clip や scroll が要らない大きさにする。viewport の大きさが
 * 正の有限値でない（非表示の要素など）ときは等倍で原点に置き、devicePixelRatio が正の有限値でなければ 1 とみなす。
 */
export function computeViewportLayout(viewport: ViewportSize): ViewportLayout {
  const devicePixelRatio = isPositiveFinite(viewport.devicePixelRatio) ? viewport.devicePixelRatio : 1;
  const measurable = isPositiveFinite(viewport.width) && isPositiveFinite(viewport.height);
  const fit = measurable ? Math.min(viewport.width / PLAYFIELD_WIDTH, viewport.height / PLAYFIELD_HEIGHT) : 1;
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  return Object.freeze({
    logicalWidth: PLAYFIELD_WIDTH,
    logicalHeight: PLAYFIELD_HEIGHT,
    scale,
    letterboxX: measurable ? Math.floor((viewport.width - PLAYFIELD_WIDTH * scale) / 2) : 0,
    letterboxY: measurable ? Math.floor((viewport.height - PLAYFIELD_HEIGHT * scale) / 2) : 0,
    devicePixelRatio,
    renderScale: computeRenderScale(scale, devicePixelRatio),
  });
}

/**
 * 表示倍率と devicePixelRatio から canvas を描く解像度の倍率を求める。
 *
 * 表示される device pixel 数（`scale × devicePixelRatio`）を 1/4 刻みで切り上げ、1 以上 `MAX_RENDER_SCALE` 以下に収める。縮小表示では
 * 内部解像度のまま描いて browser に縮小させる。
 */
export function computeRenderScale(scale: number, devicePixelRatio: number): number {
  const devicePixels = scale * devicePixelRatio;
  const stepped = Math.ceil(devicePixels * RENDER_SCALE_STEPS_PER_UNIT - RENDER_SCALE_EPSILON) / RENDER_SCALE_STEPS_PER_UNIT;
  return Math.min(MAX_RENDER_SCALE, Math.max(1, stepped));
}

/**
 * SVG の sprite を rasterize する整数倍率。起動時の render scale 以上にして、拡大して描いても sprite をぼかさない。
 *
 * texture は起動時に一度だけ作るため、後で render scale が上がった分は texture の拡大で補う。
 */
export function svgRasterScaleFor(renderScale: number): number {
  return Math.ceil(renderScale);
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
