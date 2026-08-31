import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const targetArg = process.argv[2] ?? "dist";
const target = resolve(root, targetArg);
const required = [
  "index.html",
  "app.js",
  "styles.css",
  "sw.js",
  "supabase-config.js",
  "manifest.json",
  "vercel.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

for (const file of required) {
  if (!existsSync(resolve(target, file))) {
    console.error(`FAIL: release missing ${file}`);
    process.exit(1);
  }
}

const html = readFileSync(resolve(target, "index.html"), "utf8");
for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const ref = match[1];
  if (/^(?:https?:|data:|blob:|#)/.test(ref)) continue;
  const cleaned = ref.split(/[?#]/, 1)[0].replace(/^\.\//, "");
  if (!cleaned || cleaned === "/") continue;
  if (!existsSync(resolve(target, cleaned))) {
    console.error(`FAIL: unresolved local release reference ${cleaned}`);
    process.exit(1);
  }
}

const config = readFileSync(resolve(target, "supabase-config.js"), "utf8");
if (!config.includes("puhkmblnptntorwptvld.supabase.co")) {
  console.error("FAIL: release points to unexpected Supabase project");
  process.exit(1);
}
if (/vebqlbcfjxnpryjdgfvq/.test(config)) {
  console.error("FAIL: obsolete Supabase project detected");
  process.exit(1);
}

console.log("PASS: self-contained release verified");
