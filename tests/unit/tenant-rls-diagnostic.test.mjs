import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const diagnostic = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/diagnostics/tenant_rls_audit.sql"),
  "utf8"
);

test("tenant RLS diagnostic is read-only and covers commercial critical tables", () => {
  for (const table of ["ventas", "cajas_sesiones", "producto_stock_sucursal", "compras"]) {
    assert.match(diagnostic, new RegExp(`\\('${table}'\\)`));
  }
  assert.match(diagnostic, /relrowsecurity/);
  assert.match(diagnostic, /pg_policy/);
  assert.match(diagnostic, /critical_tables_with_anon_direct_access/);
  assert.doesNotMatch(
    diagnostic,
    /\b(insert\s+into|update\s+public\.|delete\s+from|alter\s+table|create\s+policy|drop\s+policy|grant\s+|revoke\s+)/i
  );
});
