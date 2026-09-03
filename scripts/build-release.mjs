import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const files = [
  "index.html",
  "html-loader.js",
  "app.js",
  "styles.css",
  "sw.js",
  "supabase-config.js",
  "manifest.json",
  "vercel.json"
];

for (const file of files) {
  cpSync(resolve(root, file), resolve(out, file));
}
cpSync(resolve(root, "icons"), resolve(out, "icons"), { recursive: true });
cpSync(resolve(root, "styles"), resolve(out, "styles"), { recursive: true });
cpSync(resolve(root, "html"), resolve(out, "html"), { recursive: true });

console.log("Baseline production release created in dist/");
console.log("Classic filenames preserved; modular HTML and CSS copied.");
