declare module "virtual:sample-title/game-definition" {
  import type { GameDefinition } from "@shooting-sample/shooting-core";

  import type { AssetManifest } from "./runtime/assets/asset-manifest.ts";

  /** Vite content plugin が build / dev server 時に validate-content で検証した `GameDefinition`。 */
  const gameDefinition: GameDefinition;
  export default gameDefinition;

  /** 同じ plugin が検証した asset manifest。path は base URL からの相対 path。 */
  export const assetManifest: AssetManifest;
}
