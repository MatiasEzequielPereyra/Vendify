import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(
    currentDirectory,
    "../../supabase/migrations/20260908_010_security_definer_api_grants.sql"
  ),
  "utf8"
);
const contract = JSON.parse(
  fs.readFileSync(
    path.resolve(currentDirectory, "../../contracts/rpc-source-coverage.json"),
    "utf8"
  )
);

test("SECURITY DEFINER grants expose only the versioned frontend contract", () => {
  assert.match(migration, /revoke all on function %s from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function %s to service_role/i);
  assert.match(migration, /grant execute on function %s to authenticated/i);
  assert.match(migration, /v_remaining_anon <> 0/);
  assert.match(migration, /registrar_venta_v3 debe permanecer sólo para llamadas internas/i);

  for (const { rpc } of contract.rows) {
    assert.match(migration, new RegExp(`'${rpc}'`));
  }
});
