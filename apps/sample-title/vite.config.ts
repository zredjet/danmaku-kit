import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Phaser 4 本体だけで minify 後に約 1.4 MB の chunk になるため、既定の 500 kB ではなく Phaser 込みの規模で警告する。
    chunkSizeWarningLimit: 1_600,
  },
});
