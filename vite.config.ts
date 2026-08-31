import { defineConfig } from "vite";

/**
 * Vite is intentionally NOT the production build yet.
 *
 * During Phase 0 `npm run build` copies the verified v2.31.1 baseline.
 * `npm run build:vite` exists so new TypeScript modules can be bundled and
 * tested without replacing the legacy POS until parity is proven.
 */
export default defineConfig({
  build: {
    outDir: "dist-vite",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: () => "app.js"
    },
    rollupOptions: {
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css")
            ? "styles.css"
            : "assets/[name]-[hash][extname]"
      }
    }
  }
});
