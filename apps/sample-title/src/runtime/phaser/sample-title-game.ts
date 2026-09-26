import { AUTO, Game, Scale, Scene } from "phaser";

/** MVP の内部解像度（design 12）。integer scale と letterbox は Phase 2A-10 で扱う。 */
const LOGICAL_WIDTH = 384;
const LOGICAL_HEIGHT = 448;

export type SampleTitleGameOptions = Readonly<{
  parent: HTMLElement;
  coreVersion: string;
}>;

/**
 * playfield を表示する Phaser game を起動する。
 *
 * Core の stage session と固定 tick loop の接続は Phase 2A-1d で行い、ここでは Vite が Core の source を
 * bundle でき、Phaser が内部解像度の canvas を描けることだけを確認する。
 */
export function startSampleTitleGame(options: SampleTitleGameOptions): Game {
  return new Game({
    type: AUTO,
    parent: options.parent,
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    backgroundColor: "#0b0d1a",
    scale: { mode: Scale.NONE },
    scene: new PlayfieldScene(options.coreVersion),
  });
}

class PlayfieldScene extends Scene {
  readonly #coreVersion: string;

  constructor(coreVersion: string) {
    super("playfield");
    this.#coreVersion = coreVersion;
  }

  create(): void {
    this.add.text(8, 8, `shooting-core ${this.#coreVersion}`, {
      color: "#9aa4c7",
      fontFamily: "monospace",
      fontSize: "12px",
    });
  }
}
