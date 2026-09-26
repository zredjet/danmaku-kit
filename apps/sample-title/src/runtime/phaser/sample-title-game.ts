import { AUTO, Game, Scale } from "phaser";

import { PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from "../view/playfield.ts";
import { StageScene, type StageSceneOptions } from "./stage-scene.ts";

export type SampleTitleGameOptions = StageSceneOptions & Readonly<{
  parent: HTMLElement;
}>;

/**
 * 内部解像度の canvas で stage scene を起動する。
 *
 * keyboard 入力は scene が window から受けるため、Phaser の keyboard plugin は無効にする。integer scale と letterbox は
 * Phase 2A-10 で扱う。
 */
export function startSampleTitleGame(options: SampleTitleGameOptions): Game {
  const { parent, ...sceneOptions } = options;
  return new Game({
    type: AUTO,
    parent,
    width: PLAYFIELD_WIDTH,
    height: PLAYFIELD_HEIGHT,
    backgroundColor: "#0b0d1a",
    scale: { mode: Scale.NONE },
    input: { keyboard: false },
    scene: new StageScene(sceneOptions),
  });
}
