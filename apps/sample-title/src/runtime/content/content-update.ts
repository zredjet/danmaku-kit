import type { GameDefinition } from "@shooting-sample/shooting-core";

import type { AssetManifest } from "../assets/asset-manifest.ts";

/** dev server の content plugin が content の変更を app へ知らせる HMR の custom event の名前。 */
export const CONTENT_UPDATE_EVENT = "sample-title:content-update";

/**
 * dev server が content の変更を検証した結果。`validated` は検証済みの content 全体で、app が今動かしている content と比べて何が
 * 変わったかを決める（`decideHotReload()`）。`error` は検証に失敗した human 形式の診断で、app は古い content のまま動かす。
 */
export type ContentUpdate =
  | Readonly<{ kind: "validated"; definition: GameDefinition; assetManifest: AssetManifest }>
  | Readonly<{ kind: "error"; message: string }>;
