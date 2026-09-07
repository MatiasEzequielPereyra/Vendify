import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/migrations/20260907_003_dashboard_historical_margin.sql"),
  "utf8"
);
const html = fs.readFileSync(
  path.resolve(currentDirectory, "../../html/06-dashboard-admin-modals.html"),
  "utf8"
);

test("dashboard margin is calculated from the sale cost snapshot, not catalog cost", () => {
  assert.match(migration, /vi\.costo_unitario > 0/);
  assert.doesNotMatch(migration, /join public\.productos|coalesce\(p\.precio_compra/);
  assert.match(migration, /'margen_cobertura_pct', v_cobertura/);
});

test("legacy dashboard implementation is not callable by API clients", () => {
  assert.match(migration, /rename to dashboard_propietario_v1_legacy_v231/);
  assert.match(
    migration,
    /revoke all on function public\.dashboard_propietario_v1_legacy_v231[\s\S]*from public, anon, authenticated/
  );
  assert.match(migration, /grant execute on function public\.dashboard_propietario_v1\(uuid,integer\)[\s\S]*to authenticated/);
});

test("dashboard UI presents historical margin coverage", () => {
  assert.match(html, /Margen histórico/);
  assert.match(html, /id="dash-margin-quality-v231"/);
});
