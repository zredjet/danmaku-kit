import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { sampleTitleContentPlugin } from "./vite/content-plugin.ts";

export default defineConfig({
  plugins: [
    sampleTitleContentPlugin({
      gameDefinitionPath: fileURLToPath(new URL("./config/game-definition.yaml", import.meta.url)),
      contentRoot: fileURLToPath(new URL("./content", import.meta.url)),
    }),
  ],
  build: {
    // Phaser 4 本体だけで minify 後に約 1.4 MB の chunk になるため、既定の 500 kB ではなく Phaser 込みの規模で警告する。
    chunkSizeWarningLimit: 1_600,
  },
});
