import assert from "node:assert/strict";
import test from "node:test";

import { computeRenderScale, computeViewportLayout, svgRasterScaleFor } from "./viewport-layout.ts";

const layoutOf = (width: number, height: number, devicePixelRatio = 1) => computeViewportLayout({ width, height, devicePixelRatio });

test("shows the playfield at the largest integer scale with centered letterboxes", () => {
  assert.deepEqual(layoutOf(1280, 720), {
    logicalWidth: 384,
    logicalHeight: 448,
    scale: 1,
    letterboxX: 448,
    letterboxY: 136,
    devicePixelRatio: 1,
    renderScale: 1,
  });
  assert.deepEqual(
    [layoutOf(1920, 1080), layoutOf(1000, 1000), layoutOf(384, 448), layoutOf(1152, 1344)]
      .map(({ scale, letterboxX, letterboxY }) => [scale, letterboxX, letterboxY]),
    [[2, 576, 92], [2, 116, 52], [1, 0, 0], [3, 0, 0]],
  );
});

test("keeps an integer scale until the viewport is smaller than the playfield on either axis", () => {
  // 767 px 幅は 2 倍に届かないので 1 倍に留め、余りを letterbox にする（切り捨てで整数 px）。
  assert.deepEqual([layoutOf(767, 895).scale, layoutOf(767, 895).letterboxX, layoutOf(767, 895).letterboxY], [1, 191, 223]);

  const narrow = layoutOf(375, 812);
  assert.equal(narrow.scale, 375 / 384);
  assert.equal(narrow.letterboxX, 0);
  assert.equal(narrow.letterboxY, Math.floor((812 - 448 * (375 / 384)) / 2));

  const short = layoutOf(1024, 300);
  assert.equal(short.scale, 300 / 448);
  assert.equal(short.letterboxY, 0);
  assert.ok(384 * short.scale + short.letterboxX * 2 <= 1024);
});

test("never offsets the playfield outside the viewport when the fractional scale rounds up", () => {
  // これらの高さでは 448 × (h / 448) が浮動小数点の誤差で h をわずかに超える。
  for (const height of [116, 123, 225, 232, 239, 246, 253]) {
    const layout = layoutOf(1000, height);
    assert.equal(layout.scale < 1 && layout.scale === height / 448, true, `scale for ${height}`);
    assert.equal(layout.letterboxY, 0, `letterboxY for ${height}`);
  }
});

test("uses the device pixel ratio only for the render scale", () => {
  const standard = layoutOf(1920, 1080, 1);
  const retina = layoutOf(1920, 1080, 2);
  const fractional = layoutOf(1920, 1080, 1.25);

  assert.deepEqual(
    [standard, retina, fractional].map(({ scale, letterboxX, letterboxY, renderScale }) => [scale, letterboxX, letterboxY, renderScale]),
    [[2, 576, 92, 2], [2, 576, 92, 4], [2, 576, 92, 2.5]],
  );
  assert.equal(retina.devicePixelRatio, 2);
});

test("rounds the render scale up to quarter steps between 1 and the cap", () => {
  assert.deepEqual(
    [
      computeRenderScale(1, 1),
      computeRenderScale(1, 1.1),
      computeRenderScale(1, 1.5),
      computeRenderScale(3, 1),
      computeRenderScale(0.6, 1),
      computeRenderScale(0.9765625, 3),
      computeRenderScale(3, 2),
    ],
    [1, 1.25, 1.5, 3, 1, 3, 4],
  );
  for (const renderScale of [1.25, 1.5, 2.5, 3.75]) {
    assert.ok(Number.isInteger(384 * renderScale) && Number.isInteger(448 * renderScale));
  }
});

test("rasterizes SVG sprites at the render scale rounded up to an integer", () => {
  assert.deepEqual([1, 1.25, 2, 2.5, 4].map(svgRasterScaleFor), [1, 2, 2, 3, 4]);
});

test("falls back to an unscaled layout for an unmeasurable viewport", () => {
  assert.deepEqual(computeViewportLayout({ width: 0, height: 768, devicePixelRatio: Number.NaN }), {
    logicalWidth: 384,
    logicalHeight: 448,
    scale: 1,
    letterboxX: 0,
    letterboxY: 0,
    devicePixelRatio: 1,
    renderScale: 1,
  });
});
