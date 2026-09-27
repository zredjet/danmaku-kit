import type { InputFrame, SerializedGameState, StartStageOptions } from "@shooting-sample/shooting-core";

/**
 * browser で遊んでいる stage の再生記録（design 21.5）。dev / test build の `window.__SHOOTING_DEBUG_REPLAY__()` が返す。
 *
 * `BrowserDebugStateDump` の schema の外に置く。Node の headless replay で `stage` を始めて `inputs` を順に渡すと、`state` と同じ
 * serialize 結果に着く。Core の内部 hash は含めず、比べる側が `state` を hash する。
 */
export type BrowserReplayRecord = Readonly<{
  schemaVersion: "1";
  kind: "browserReplay";
  stage: Readonly<StartStageOptions>;
  /** Core が受け付けた `InputFrame`（tick 0 から順）。 */
  inputs: readonly InputFrame[];
  /** 最後の入力を渡した後の committed state。 */
  state: SerializedGameState;
}>;
