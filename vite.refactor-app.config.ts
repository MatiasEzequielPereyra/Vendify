import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __VENDIFY_EXPECTED_SUPABASE_REF__: JSON.stringify(
      "vendify-static-validation-invalid"
    )
  },
  build: {
    outDir: ".vendify-build/refactor-app",
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    lib: {
      entry: "src/bootstrap/application-entry.ts",
      name: "VendifyApplicationV232Bundle",
      formats: ["iife"],
      fileName: () => "vendify-app-v232.js"
    }
  }
});
