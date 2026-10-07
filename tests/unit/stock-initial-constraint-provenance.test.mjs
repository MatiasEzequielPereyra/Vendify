import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const ven014Migration =
  "supabase/migrations/20261006171531_preserve_stock_inicial_movement_type.sql";
const canonicalTypes = new Set([
  "venta",
  "ingreso",
  "ajuste",
  "rotura",
  "vencimiento",
  "perdida",
  "inventario",
  "transferencia_salida",
  "transferencia_entrada",
  "devolucion",
  "compra",
  "stock_inicial"
]);

function movementConstraintRebuilds(sql, path, chainIndex) {
  const rebuilds = [];
  const dropPattern = /drop\s+constraint\s+if\s+exists\s+movimientos_tipo_check\s*;/giu;
  const drops = [...sql.matchAll(dropPattern)];

  for (let index = 0; index < drops.length; index += 1) {
    const dropIndex = drops[index].index ?? 0;
    const blockStart = sql.slice(0, dropIndex).lastIndexOf("do $");
    const tail = sql.slice(blockStart >= 0 ? blockStart : 0);
    const blockEnd = tail.match(/end\s+\$\$\s*;/iu);
    const block = blockEnd
      ? tail.slice(0, (blockEnd.index ?? 0) + blockEnd[0].length)
      : tail;
    if (!/add\s+constraint\s+movimientos_tipo_check/iu.test(block)) continue;

    const allowed = new Set(
      [...block.matchAll(/union\s+select\s+'([^']+)'/giu)].map((match) => match[1])
    );
    const explicitCheck = block.match(
      /check\s*\(\s*tipo\s+in\s*\(([\s\S]*?)\)\s*\)/iu
    );
    if (explicitCheck) {
      for (const match of explicitCheck[1].matchAll(/'([^']+)'/gu)) {
        allowed.add(match[1]);
      }
    }

    rebuilds.push({ path, chainIndex, allowed, block });
  }

  return rebuilds;
}

const assembly = JSON.parse(
  readFileSync(resolve(root, "supabase/baseline/assembly.json"), "utf8")
);
const migrations = readdirSync(resolve(root, "supabase/migrations"))
  .filter((file) => file.endsWith(".sql") && !file.endsWith(".local.sql"))
  .sort()
  .map((file) => `supabase/migrations/${file}`);
const chain = [...assembly.steps, ...migrations];
const rebuilds = chain.flatMap((path, chainIndex) =>
  movementConstraintRebuilds(readFileSync(resolve(root, path), "utf8"), path, chainIndex)
);

test("VEN-014 restores stock_inicial after the historical rebuilds that dropped it", () => {
  const byPath = new Map(rebuilds.map((entry) => [entry.path, entry]));

  assert.equal(
    byPath.get("supabase/legacy/modules/stock_inicial_flexible.sql")?.allowed.has("stock_inicial"),
    true
  );
  assert.equal(
    byPath.get("supabase/legacy/modules/compras_proveedores.sql")?.allowed.has("stock_inicial"),
    false
  );
  assert.equal(
    byPath.get("supabase/legacy/Vendify-Security-FIX3-ALL-IN-ONE.sql")?.allowed.has("stock_inicial"),
    false
  );

  const ven014 = byPath.get(ven014Migration);
  assert.ok(ven014, "VEN-014 must rebuild movimientos_tipo_check");
  assert.ok(
    ven014.chainIndex >
      chain.indexOf("supabase/legacy/Vendify-Security-FIX3-ALL-IN-ONE.sql"),
    "VEN-014 must execute after the historical baseline rebuilds"
  );
  assert.equal(ven014.allowed.has("stock_inicial"), true);
});

test("the effective final rebuild preserves every canonical movement type", () => {
  const finalRebuild = rebuilds.at(-1);
  assert.ok(finalRebuild, "movement constraint rebuild chain is missing");

  for (const type of canonicalTypes) {
    assert.equal(
      finalRebuild.allowed.has(type),
      true,
      `final movimientos_tipo_check lost canonical type ${type}`
    );
  }

  assert.equal(finalRebuild.allowed.has("ven014_tipo_invalido"), false);
  assert.match(finalRebuild.block, /add\s+constraint\s+movimientos_tipo_check/iu);
  assert.doesNotMatch(finalRebuild.block, /check\s*\(\s*true\s*\)/iu);
});

test("future constraint rebuilds after VEN-014 must continue to allow stock_inicial", () => {
  const ven014Index = chain.indexOf(ven014Migration);
  assert.ok(ven014Index >= 0, "VEN-014 migration is missing from the canonical chain");

  const later = rebuilds.filter((entry) => entry.chainIndex > ven014Index);
  for (const rebuild of later) {
    assert.equal(
      rebuild.allowed.has("stock_inicial"),
      true,
      `${rebuild.path} rebuilds movimientos_tipo_check after VEN-014 without stock_inicial`
    );
  }
});

test("ajustar_stock_inicial_rapido_v2 keeps an explicit stock_inicial movement contract", () => {
  const rpcSql = readFileSync(
    resolve(root, "supabase/migrations/20260831000100_permisos_stock_empleados.sql"),
    "utf8"
  );
  const start = rpcSql.indexOf(
    "create or replace function public.ajustar_stock_inicial_rapido_v2"
  );
  const end = rpcSql.indexOf(
    "revoke all on function public.ajustar_stock_inicial_rapido_v2",
    start
  );
  assert.ok(start >= 0 && end > start, "stock-initial RPC definition is missing");

  const rpc = rpcSql.slice(start, end);
  const insertStart = rpc.indexOf("insert into public.movimientos");
  const returnStart = rpc.indexOf("return jsonb_build_object", insertStart);
  assert.ok(insertStart >= 0 && returnStart > insertStart, "movement insert is missing");

  const movementInsert = rpc.slice(insertStart, returnStart);
  assert.match(movementInsert, /'stock_inicial'\s*,\s*p_delta/iu);
  assert.doesNotMatch(movementInsert, /'ajuste'\s*,\s*p_delta/iu);
});
