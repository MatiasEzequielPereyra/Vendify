import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/migrations/20260907_002_product_barcode_uniqueness.sql"),
  "utf8"
);

test("barcode uniqueness is scoped to the business and ignores empty values", () => {
  assert.match(
    migration,
    /create unique index if not exists productos_negocio_codigo_barras_unico_idx[\s\S]*on public\.productos\(negocio_id, btrim\(codigo_barras\)\)[\s\S]*where nullif\(btrim\(codigo_barras\), ''\) is not null/
  );
});

test("barcode uniqueness refuses to silently alter existing duplicate data", () => {
  assert.match(
    migration,
    /group by p\.negocio_id, btrim\(p\.codigo_barras\)[\s\S]*having count\(\*\) > 1/
  );
  assert.match(migration, /No se puede activar la unicidad de códigos de barras/);
});
