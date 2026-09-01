import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: ".vendify-build/v2312",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: "src/offline/browser-runtime.ts",
      name: "VendifyOfflineV2312Bundle",
      formats: ["iife"],
      fileName: () => "vendify-offline-v2312.js"
    }
  }
});
