import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: ".vendify-build/v2312-pending-ui",
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    lib: {
      entry: "src/offline/pending-sales-ui.ts",
      name: "VendifyOfflineV2312PendingUiBundle",
      formats: ["iife"],
      fileName: () => "vendify-offline-v2312-pending-ui.js"
    }
  }
});
