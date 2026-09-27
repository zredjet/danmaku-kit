import type { GameFrame } from "@shooting-sample/shooting-core";

import type { AssetStatus } from "../assets/asset-loading.ts";
import type { AudioStatus } from "../audio/audio-status.ts";
import type { GameLifecycleState } from "../lifecycle/game-lifecycle.ts";
import { countEntitiesByKind, type EntityKind } from "../view/entity-counts.ts";
import type { ViewportLayout } from "../view/viewport-layout.ts";

type Point = Readonly<{ x: number; y: number }>;

/**
 * browser の debug state dump（design 21.5）。dev / test build の `window.__SHOOTING_DEBUG_STATE__()` が返す。
 *
 * headless dump を継承せず、公開の `GameFrame` と Runtime の状態だけから作る。Core 内部の state hash、PRNG hash、collision candidate
 * 数は含めない。
 */
export type BrowserDebugStateDump = Readonly<{
  schemaVersion: "1";
  kind: "browser";
  /** 現在の stage が次に受け付ける入力 tick（実行済みの tick 数）。stage の外と開始演出中で tick を実行していなければ 0。 */
  tick: number;
  seed: string | null;
  lifecycle: GameLifecycleState;
  entityCounts: Readonly<Record<EntityKind, number>>;
  playerPosition: Point | null;
  viewport: Readonly<{
    logicalWidth: number;
    logicalHeight: number;
    scale: number;
    devicePixelRatio: number;
    letterboxX: number;
    letterboxY: number;
  }>;
  /** まだ tick や render frame に渡していない入力の edge の数。 */
  inputQueueDepth: number;
  assetStatus: AssetStatus;
  audioStatus: AudioStatus;
  /** DOM overlay の実際の位置（CSS px）と、内部解像度からの倍率。canvas と同じ transform root にあれば viewport の配置と一致する。 */
  overlayTransform: Readonly<{ x: number; y: number; scale: number }>;
  debugOverlay: boolean;
}>;

/** dump の材料。`overlayRect` は DOM overlay の `getBoundingClientRect()`。 */
export type BrowserDebugStateSource = Readonly<{
  lifecycle: GameLifecycleState;
  seed: string | null;
  frame: GameFrame | null;
  layout: ViewportLayout;
  inputQueueDepth: number;
  assetStatus: AssetStatus;
  audioStatus: AudioStatus;
  overlayRect: Readonly<{ x: number; y: number; width: number }>;
  debugOverlay: boolean;
}>;

/** 材料から dump を組み立てる。property の順は schema の順に固定する。 */
export function buildBrowserDebugStateDump(source: BrowserDebugStateSource): BrowserDebugStateDump {
  const { frame, layout } = source;
  const entities = frame?.state.entities ?? [];
  const player = entities.find((entity) => entity.kind === "player");
  return deepFreeze({
    schemaVersion: "1",
    kind: "browser",
    tick: frame === null ? 0 : frame.tick + 1,
    seed: source.seed,
    lifecycle: source.lifecycle,
    entityCounts: countEntitiesByKind(entities),
    playerPosition: player ? { x: player.position.x, y: player.position.y } : null,
    viewport: {
      logicalWidth: layout.logicalWidth,
      logicalHeight: layout.logicalHeight,
      scale: layout.scale,
      devicePixelRatio: layout.devicePixelRatio,
      letterboxX: layout.letterboxX,
      letterboxY: layout.letterboxY,
    },
    inputQueueDepth: source.inputQueueDepth,
    assetStatus: source.assetStatus,
    audioStatus: source.audioStatus,
    overlayTransform: {
      x: source.overlayRect.x,
      y: source.overlayRect.y,
      scale: source.overlayRect.width / layout.logicalWidth,
    },
    debugOverlay: source.debugOverlay,
  });
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object") {
      deepFreeze(child);
    }
  }
  return Object.freeze(value);
}
