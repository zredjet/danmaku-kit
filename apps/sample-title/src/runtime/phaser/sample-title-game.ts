import { AUTO, Game, Scale } from "phaser";

import { PLAYFIELD_BACKGROUND_COLOR } from "../view/playfield.ts";
import { BootScene, type BootSceneOptions } from "./boot-scene.ts";
import { renderSizeOf } from "./render-scale.ts";
import { StageScene, type StageSceneOptions } from "./stage-scene.ts";
import type { AssetLoadRequest } from "../assets/asset-loading.ts";

export type SampleTitleGameOptions = Readonly<{
  parent: HTMLElement;
  /** canvas を描く解像度の倍率（`ViewportLayout.renderScale`）。後から `applyRenderScale()` で変えられる。 */
  renderScale: number;
  boot: BootSceneOptions;
  stage: StageSceneOptions;
}>;

/**
 * loading（boot scene）を始め、asset を読み込めたら stage scene へ進む。`parent` には canvas と DOM overlay の HUD を重ねる transform
 * root を渡す。
 *
 * canvas は内部解像度の `renderScale` 倍の画素で描き、CSS の大きさは内部解像度のままにする（index.html）。表示の倍率と letterbox は
 * transform root が持つため、Phaser の scale manager は拡大縮小しない。keyboard 入力は scene が window から受けるため、Phaser の
 * keyboard plugin は無効にする。
 */
export function startSampleTitleGame(options: SampleTitleGameOptions): Game {
  const { parent, renderScale, boot, stage } = options;
  const { width, height } = renderSizeOf(renderScale);
  return new Game({
    type: AUTO,
    parent,
    width,
    height,
    backgroundColor: PLAYFIELD_BACKGROUND_COLOR,
    scale: { mode: Scale.NONE },
    input: { keyboard: false },
    // 配列の最初の scene だけが起動し、stage scene は boot scene が loading を終えてから始める。
    scene: [new BootScene(boot), new StageScene(stage)],
  });
}

/**
 * content の hot reload で、stage scene に sprite の texture を読み直させる（`StageScene.reloadTextures()`）。stage scene がまだ view を
 * 作っていないか止まっていれば false。
 */
export function reloadSampleTitleTextures(game: Game, requests: readonly AssetLoadRequest[], done: (ok: boolean) => void): boolean {
  const scene = game.scene.getScene("stage");
  return scene instanceof StageScene && scene.reloadTextures(requests, done);
}

/** stage scene が Core の error などで止まっているか。stage scene をまだ始めていなければ false。 */
export function isSampleTitleHalted(game: Game): boolean {
  const scene = game.scene.getScene("stage");
  return scene instanceof StageScene && scene.halted;
}
