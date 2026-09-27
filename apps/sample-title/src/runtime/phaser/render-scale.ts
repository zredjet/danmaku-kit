import { Scale, Scenes, type Game, type Scene } from "phaser";

import { PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from "../view/playfield.ts";

/** render scale で描くときの canvas の画素数。 */
export function renderSizeOf(renderScale: number): Readonly<{ width: number; height: number }> {
  return { width: PLAYFIELD_WIDTH * renderScale, height: PLAYFIELD_HEIGHT * renderScale };
}

/**
 * canvas を描く解像度を `renderScale` 倍にする（design 12）。canvas の CSS の大きさは内部解像度のままで、表示の倍率は transform root が
 * 持つ。camera は `fitCameraToPlayfield()` が新しい解像度へ合わせ直す。
 */
export function applyRenderScale(game: Game, renderScale: number): void {
  const { width, height } = renderSizeOf(renderScale);
  if (game.scale.width !== width || game.scale.height !== height) {
    game.scale.resize(width, height);
  }
}

/**
 * scene の main camera が playfield（内部解像度の座標）全体を canvas いっぱいに映すようにし、canvas の解像度が変わるたびに合わせ直す。
 * Simulation の座標はそのまま描画に使い、解像度の違いは camera の zoom だけが吸収する。
 */
export function fitCameraToPlayfield(scene: Scene): void {
  const fit = (): void => {
    const { width, height } = scene.scale;
    scene.cameras.main
      .setSize(width, height)
      .setZoom(width / PLAYFIELD_WIDTH)
      .centerOn(PLAYFIELD_WIDTH / 2, PLAYFIELD_HEIGHT / 2);
  };
  fit();
  scene.scale.on(Scale.Events.RESIZE, fit);
  const stop = (): void => {
    scene.scale.off(Scale.Events.RESIZE, fit);
  };
  scene.events.once(Scenes.Events.SHUTDOWN, stop);
  scene.events.once(Scenes.Events.DESTROY, stop);
}
