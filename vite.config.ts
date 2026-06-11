import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "review-app",
  build: {
    outDir: "../dist/review-app",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        review: resolve("review-app/src/review.ts"),
        analysis: resolve("review-app/src/analysis.ts"),
        settings: resolve("review-app/src/settings.ts")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name === "review.css" || assetInfo.name === "analysis.css" || assetInfo.name === "settings.css"
            ? "[name][extname]"
            : "[name]-[hash][extname]"
      }
    }
  }
});
