import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const files = [
  "index.html",
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

console.log("Baseline production release created in dist/");
console.log("Classic filenames preserved: index.html, app.js, styles.css, sw.js");
