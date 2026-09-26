import { AUTO, Game, Scale, Scene } from "phaser";

/** MVP の内部解像度（design 12）。integer scale と letterbox は Phase 2A-10 で扱う。 */
const LOGICAL_WIDTH = 384;
const LOGICAL_HEIGHT = 448;

export type SampleTitleGameOptions = Readonly<{
  parent: HTMLElement;
  coreVersion: string;
  contentVersion: string;
}>;

/**
 * playfield を表示する Phaser game を起動する。
 *
 * Core の stage session と固定 tick loop の接続は Phase 2A-1d で行い、ここでは Core が load した content の
 * version と、Phaser が内部解像度の canvas を描けることだけを表示する。
 */
export function startSampleTitleGame(options: SampleTitleGameOptions): Game {
  return new Game({
    type: AUTO,
    parent: options.parent,
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    backgroundColor: "#0b0d1a",
    scale: { mode: Scale.NONE },
    scene: new PlayfieldScene(`shooting-core ${options.coreVersion} / content ${options.contentVersion}`),
  });
}

class PlayfieldScene extends Scene {
  readonly #versionLabel: string;

  constructor(versionLabel: string) {
    super("playfield");
    this.#versionLabel = versionLabel;
  }

  create(): void {
    this.add.text(8, 8, this.#versionLabel, {
      color: "#9aa4c7",
      fontFamily: "monospace",
      fontSize: "12px",
    });
  }
}
