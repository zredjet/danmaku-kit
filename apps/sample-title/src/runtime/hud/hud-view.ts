import type { GameFrame } from "@shooting-sample/shooting-core";

import type { GameLifecycleState } from "../lifecycle/game-lifecycle.ts";

/** 画面中央に出す状態の見出し。 */
export type HudBanner = Readonly<{
  title: string;
  detail: string | null;
  tone: "info" | "success" | "danger";
}>;

/** DOM overlay の HUD に出す内容。score と lives は stage の frame があるときだけ出す。 */
export type HudView = Readonly<{
  score: number | null;
  lives: number | null;
  banner: HudBanner | null;
}>;

/** DOM overlay の HUD。Phaser の scene は描画の実装を知らず、この口を通して HUD を更新する。 */
export type HudPort = Readonly<{
  render(view: HudView): void;
  setDebugLines(lines: readonly string[]): void;
  showError(title: string, lines: readonly string[]): void;
}>;

const RETURN_TO_TITLE = "Press Enter to return to the title";

const BANNER_BY_STATE: Readonly<Partial<Record<GameLifecycleState, HudBanner>>> = Object.freeze({
  booting: { title: "LOADING", detail: null, tone: "info" },
  loading: { title: "LOADING", detail: null, tone: "info" },
  title: { title: "SHOOTING SAMPLE", detail: "Press Enter to start", tone: "info" },
  stageStarting: { title: "READY", detail: null, tone: "info" },
  paused: { title: "PAUSED", detail: "Press P or Esc to resume", tone: "info" },
  stageCleared: { title: "STAGE CLEAR", detail: RETURN_TO_TITLE, tone: "success" },
  gameOver: { title: "GAME OVER", detail: RETURN_TO_TITLE, tone: "danger" },
});

const STAGE_STATES: readonly GameLifecycleState[] = Object.freeze(["stageStarting", "playing", "paused", "stageCleared", "gameOver"]);

/**
 * lifecycle と最新の `GameFrame` から HUD の内容を決める（design 5.5）。
 *
 * score と lives は `GameFrame.state` を正本にし、event から数え直さない。stage の外（loading、title）では出さない。
 */
export function buildHudView(lifecycle: GameLifecycleState, frame: GameFrame | null): HudView {
  const inStage = frame !== null && STAGE_STATES.includes(lifecycle);
  return Object.freeze({
    score: inStage ? frame.state.score : null,
    lives: inStage ? frame.state.player.lives : null,
    banner: BANNER_BY_STATE[lifecycle] ?? null,
  });
}

/** loading 中の HUD。`detail` に asset や view pool の準備の進み具合を出す。 */
export function buildLoadingHudView(detail: string): HudView {
  return Object.freeze({
    score: null,
    lives: null,
    banner: Object.freeze({ ...BANNER_BY_STATE.loading!, detail }),
  });
}
