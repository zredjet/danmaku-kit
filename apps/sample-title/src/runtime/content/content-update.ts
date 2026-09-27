import type { GameDefinition } from "@shooting-sample/shooting-core";

import type { AssetManifest } from "../assets/asset-manifest.ts";

/** dev server の content plugin が content の変更を app へ知らせる HMR の custom event の名前。 */
export const CONTENT_UPDATE_EVENT = "sample-title:content-update";

/**
 * content の変更を検証して分類した結果（design 19 の hot reload の表）。
 *
 * - `unchanged`: 検証はしたが、`GameDefinition` も asset manifest も変わらない（schema だけ、書式やコメントだけの変更）。
 * - `assets`: asset manifest だけが変わった。
 * - `content`: `GameDefinition` が変わった（stage、enemy、pattern、path、player、shot、feature の定義など）。
 * - `error`: 検証に失敗した。app は古い content のまま動かし、human 形式の診断を出す。
 */
export type ContentUpdate =
  | Readonly<{ kind: "unchanged" }>
  | Readonly<{ kind: "assets"; assetManifest: AssetManifest }>
  | Readonly<{ kind: "content"; definition: GameDefinition; assetManifest: AssetManifest }>
  | Readonly<{ kind: "error"; message: string }>;
