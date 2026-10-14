import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error"
    }
  },
  {
    // vite.config.ts is outside tsconfig.json's src-only include list.
    files: ["vite.config.ts"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["vite.config.ts"]
        },
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    ignores: [
      "app.js",
      "dist/**",
      "dist-ts/**",
      "dist-vite/**",
      "node_modules/**"
    ]
  }
);
