import type { CoreError, LoadedGame, StartStageOptions } from "@shooting-sample/shooting-core";
import { Scene, type GameObjects, type Types } from "phaser";

import { KeyboardInputAdapter } from "../input/keyboard-input.ts";
import { StageLoop } from "../loop/stage-loop.ts";
import { PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from "../view/playfield.ts";
import { EntityViews } from "./entity-views.ts";

export type StageSceneOptions = Readonly<{
  loadedGame: LoadedGame;
  stage: StartStageOptions;
  collisionRadii: ReadonlyMap<string, number>;
  versionLabel: string;
}>;

const TEXT_STYLE: Types.GameObjects.Text.TextStyle = {
  color: "#9aa4c7",
  fontFamily: "monospace",
  fontSize: "12px",
};
const TEXT_DEPTH = 10;

/**
 * 1 stage を固定 tick で進め、`GameFrame` を描画する scene。
 *
 * keyboard event は Phaser の keyboard plugin を使わず window から受けて `KeyboardInputAdapter` に渡し、割り当てのある key は
 * browser の既定動作を止める。focus lost と visibility change では stage loop の clock と入力を捨てる（lifecycle の paused
 * 遷移は Phase 2A-9）。Core が error を返したら stage を止めて error を表示する。
 */
export class StageScene extends Scene {
  readonly #options: StageSceneOptions;
  #loop: StageLoop | null = null;
  #views: EntityViews | null = null;
  #status: GameObjects.Text | null = null;

  constructor(options: StageSceneOptions) {
    super("stage");
    this.#options = options;
  }

  create(): void {
    this.add.text(8, 8, this.#options.versionLabel, TEXT_STYLE).setDepth(TEXT_DEPTH);
    this.#status = this.add.text(8, 24, `seed ${this.#options.stage.seed}`, TEXT_STYLE).setDepth(TEXT_DEPTH);

    const session = this.#options.loadedGame.startStage(this.#options.stage);
    if (!session.ok) {
      this.#showFatal(session.errors);
      return;
    }
    const input = new KeyboardInputAdapter();
    const loop = new StageLoop(session.value, input);
    this.#loop = loop;
    this.#views = new EntityViews(this, this.#options.collisionRadii);
    this.#listenToBrowser(input, loop);
  }

  update(_time: number, delta: number): void {
    const loop = this.#loop;
    if (!loop) {
      return;
    }
    const step = loop.advance(delta);
    if (!step.ok) {
      this.#loop = null;
      this.#showFatal(step.errors);
      return;
    }
    const frame = step.latestFrame;
    if (!frame) {
      return;
    }
    this.#views?.sync(frame.state.entities, { showPlayerHitbox: step.latestInput?.held.includes("focus") ?? false });
    this.#status?.setText([
      `seed ${this.#options.stage.seed}  tick ${frame.tick}  dropped ${loop.droppedTicksTotal}`,
      `score ${frame.state.score}  lives ${frame.state.player.lives}`,
    ]);
  }

  #listenToBrowser(input: KeyboardInputAdapter, loop: StageLoop): void {
    const onKey = (event: KeyboardEvent): void => {
      if (input.handleKeyEvent(event)) {
        event.preventDefault();
      }
    };
    const onFocusLost = (): void => {
      loop.reset();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onFocusLost);
    document.addEventListener("visibilitychange", onFocusLost);
    this.events.once("shutdown", () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onFocusLost);
      document.removeEventListener("visibilitychange", onFocusLost);
    });
  }

  #showFatal(errors: readonly CoreError[]): void {
    this.add
      .text(PLAYFIELD_WIDTH / 2, PLAYFIELD_HEIGHT / 2, ["Core error", ...errors.map((error) => `${error.code}: ${error.message}`)], {
        ...TEXT_STYLE,
        align: "center",
        color: "#fca5a5",
        wordWrap: { width: PLAYFIELD_WIDTH - 32 },
      })
      .setOrigin(0.5)
      .setDepth(TEXT_DEPTH);
  }
}
