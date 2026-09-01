import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: ".vendify-build/v2312-bridge",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: "src/offline/legacy-pos-bridge.ts",
      name: "VendifyOfflineV2312BridgeBundle",
      formats: ["iife"],
      fileName: () => "vendify-offline-v2312-bridge.js"
    }
  }
});
