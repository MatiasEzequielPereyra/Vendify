import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: ".vendify-build/modular-core",
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    lib: {
      entry: "src/legacy/core-bridge.ts",
      name: "VendifyCoreV232Bundle",
      formats: ["iife"],
      fileName: () => "vendify-core-v232.js"
    }
  }
});
