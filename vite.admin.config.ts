import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  publicDir: false,
  build: {
    outDir: ".vendify-build/admin-entry",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: "admin/index.html",
      output: {
        entryFileNames: "admin/assets/entry-[hash].js",
        chunkFileNames: "admin/assets/chunk-[hash].js",
        assetFileNames: "admin/assets/[name]-[hash][extname]"
      }
    }
  }
});
