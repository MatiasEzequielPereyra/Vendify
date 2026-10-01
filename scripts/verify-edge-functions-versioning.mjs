import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const provenance = JSON.parse(
  readFileSync(resolve(root, "docs/supabase/edge-functions-provenance.json"), "utf8")
);
const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");

for (const entry of provenance.functions) {
  const source = readFileSync(resolve(root, entry.repository_path), "utf8");
  const digest = createHash("sha256").update(source, "utf8").digest("hex");
  if (digest !== entry.source_sha256) {
    throw new Error(entry.function + ": source checksum drift");
  }

  const section = "[functions." + entry.function + "]";
  const start = config.indexOf(section);
  if (start === -1) {
    throw new Error(entry.function + ": function config section missing");
  }
  const next = config.indexOf("\n[", start + section.length);
  const body = config.slice(start, next === -1 ? config.length : next);
  if (!/verify_jwt\s*=\s*true/.test(body)) {
    throw new Error(entry.function + ": verify_jwt=true is not declared");
  }
}

console.log(
  "PASS: " + provenance.functions.length +
  " versioned Edge Functions match captured source checksums and JWT configuration"
);
