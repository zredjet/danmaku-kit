import { AUTO, Game, Scale } from "phaser";

import { PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from "../view/playfield.ts";
import { BootScene, type BootSceneOptions } from "./boot-scene.ts";
import { StageScene, type StageSceneOptions } from "./stage-scene.ts";

export type SampleTitleGameOptions = Readonly<{
  parent: HTMLElement;
  boot: BootSceneOptions;
  stage: StageSceneOptions;
}>;

/**
 * 内部解像度の canvas で loading（boot scene）を始め、asset を読み込めたら stage scene へ進む。
 *
 * keyboard 入力は scene が window から受けるため、Phaser の keyboard plugin は無効にする。integer scale と letterbox は
 * Phase 2A-10 で扱う。
 */
export function startSampleTitleGame(options: SampleTitleGameOptions): Game {
  const { parent, boot, stage } = options;
  return new Game({
    type: AUTO,
    parent,
    width: PLAYFIELD_WIDTH,
    height: PLAYFIELD_HEIGHT,
    backgroundColor: "#0b0d1a",
    scale: { mode: Scale.NONE },
    input: { keyboard: false },
    // 配列の最初の scene だけが起動し、stage scene は boot scene が loading を終えてから始める。
    scene: [new BootScene(boot), new StageScene(stage)],
  });
}
