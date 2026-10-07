import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const production = JSON.parse(
  readFileSync(resolve(root, "docs/supabase/edge-functions-provenance.json"), "utf8")
);
const staging = JSON.parse(
  readFileSync(resolve(root, "docs/supabase/edge-functions-staging-validation.json"), "utf8")
);
const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");

const EXPECTED_PRODUCTION = Object.freeze({
  ticket: "VEN-004",
  production_project_ref: "puhkmblnptntorwptvld",
  functions: Object.freeze({
    "crear-empleado": Object.freeze({
      deployed_version: 2,
      verify_jwt: true,
      deployed_ezbr_sha256: "e1c44b3e2b98b13a72be72790d77e14d6480e516b74543876ee07533046c3676",
      source_sha256: "df540898703d458e4533730db0a6727bef74cb1ce3c6dc5c8a6b2afbb79f1890"
    }),
    "gestionar-empleado": Object.freeze({
      deployed_version: 2,
      verify_jwt: true,
      deployed_ezbr_sha256: "db6127e0f367ca74b371a731a7017b0f04dae17efc4d588099eeeb44f054ccb1",
      source_sha256: "6b9902122e94b097cf973812ec9700996cd5fa6c5d82ae19076798ac1f1d8255"
    })
  })
});

if (production.ticket !== EXPECTED_PRODUCTION.ticket) {
  throw new Error("production Edge Function provenance must remain VEN-004");
}
if (production.production_project_ref !== EXPECTED_PRODUCTION.production_project_ref) {
  throw new Error("production Edge Function provenance project ref drift");
}
if ("validation_project_ref" in production) {
  throw new Error("staging validation metadata must not replace production provenance");
}

for (const [functionName, expected] of Object.entries(EXPECTED_PRODUCTION.functions)) {
  const entry = production.functions.find((item) => item.function === functionName);
  if (!entry) throw new Error(functionName + ": production provenance entry missing");
  for (const [key, value] of Object.entries(expected)) {
    if (entry[key] !== value) {
      throw new Error(functionName + ": production provenance " + key + " drift");
    }
  }
}

if (staging.ticket !== "VEN-015") {
  throw new Error("staging Edge Function validation must be owned by VEN-015");
}
if (staging.validation_project_ref !== "clqxfwiutwnhbejezakw") {
  throw new Error("staging Edge Function validation project ref drift");
}
if (staging.validation_project_ref === production.production_project_ref) {
  throw new Error("staging and production project refs must remain distinct");
}

for (const entry of staging.functions) {
  const source = readFileSync(resolve(root, entry.repository_path), "utf8")
    .replace(/\r\n?/g, "\n");
  const digest = createHash("sha256").update(source, "utf8").digest("hex");
  if (digest !== entry.source_sha256) {
    throw new Error(entry.function + ": staging source checksum drift");
  }
  if (entry.verify_jwt !== true) {
    throw new Error(entry.function + ": staging validation must preserve verify_jwt=true");
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
  "PASS: immutable production provenance preserved and " +
  staging.functions.length +
  " staging-validated Edge Functions match current source checksums and JWT configuration"
);
