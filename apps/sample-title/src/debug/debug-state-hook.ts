import type { AssetStatus } from "../runtime/assets/asset-loading.ts";
import type { AudioStatus } from "../runtime/audio/audio-status.ts";
import { buildBrowserDebugStateDump, type BrowserDebugStateDump } from "../runtime/debug/browser-debug-state.ts";
import type { GameShell } from "../runtime/lifecycle/game-shell.ts";
import type { ViewportLayout } from "../runtime/view/viewport-layout.ts";

declare global {
  interface Window {
    /** dev / test build だけが定義する debug state dump の hook（design 21.5）。 */
    __SHOOTING_DEBUG_STATE__?: () => BrowserDebugStateDump;
  }
}

export type DebugStateSources = Readonly<{
  shell: Pick<GameShell, "lifecycle" | "seed" | "latestFrame" | "inputQueueDepth" | "debugOverlay">;
  layout: () => ViewportLayout;
  assetStatus: () => AssetStatus;
  audioStatus: AudioStatus;
  /** canvas と同じ transform root に置いた DOM overlay。実際の位置と倍率を dump に出す。 */
  overlay: HTMLElement;
}>;

/**
 * `window.__SHOOTING_DEBUG_STATE__()` を置く。呼ぶたびにその時点の Runtime の状態から dump を作る。
 *
 * production build に入れないため、entry は production 以外の mode の分岐からだけ呼ぶ（build 結果は vite/ の test が検査する）。
 */
export function installDebugStateHook(sources: DebugStateSources): void {
  window.__SHOOTING_DEBUG_STATE__ = () => {
    const rect = sources.overlay.getBoundingClientRect();
    return buildBrowserDebugStateDump({
      lifecycle: sources.shell.lifecycle.state,
      seed: sources.shell.seed,
      frame: sources.shell.latestFrame,
      layout: sources.layout(),
      inputQueueDepth: sources.shell.inputQueueDepth,
      assetStatus: sources.assetStatus(),
      audioStatus: sources.audioStatus,
      overlayRect: { x: rect.x, y: rect.y, width: rect.width },
      debugOverlay: sources.shell.debugOverlay,
    });
  };
}
