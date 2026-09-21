import assert from "node:assert/strict";
import { createSalesConcurrencyClient } from "./sales-concurrency.mjs";

function message(result) {
  return result.data?.message ?? result.data?.error ?? String(result.data ?? result.status);
}

export async function runOperationalBackupV2(config, fetchImpl = globalThis.fetch, log = console.log) {
  const client = createSalesConcurrencyClient(config, fetchImpl);
  const ownerToken = await client.signIn(config.owner);
  const otherOwnerToken = await client.signIn(config.otherOwner);
  const cashierToken = await client.signIn(config.cashier);

  const anonymous = await client.rpc(null, "iniciar_respaldo_operativo_v2");
  assert.equal(anonymous.ok, false, "Anon no debe iniciar respaldos");

  const cashier = await client.rpc(cashierToken, "iniciar_respaldo_operativo_v2");
  assert.equal(cashier.ok, false, "Un cajero no debe iniciar respaldos");
  assert.match(message(cashier), /solo el propietario/i);

  const [started, concurrent, otherTenant] = await Promise.all([
    client.rpc(ownerToken, "iniciar_respaldo_operativo_v2"),
    client.rpc(ownerToken, "iniciar_respaldo_operativo_v2"),
    client.rpc(otherOwnerToken, "iniciar_respaldo_operativo_v2")
  ]);
  for (const result of [started, concurrent, otherTenant]) {
    assert.equal(result.ok, true, `No se pudo iniciar un respaldo: ${message(result)}`);
    assert.equal(result.data?.format, "vendify-operational-backup-v2");
    assert.equal(result.data?.schema_version, 2);
  }
  assert.notEqual(started.data.backup_id, concurrent.data.backup_id);
  assert.notEqual(started.data.business_id, otherTenant.data.business_id);

  const crossTenantState = await client.rpc(otherOwnerToken, "estado_respaldo_operativo_v2", {
    p_backup_id: started.data.backup_id
  });
  assert.equal(crossTenantState.ok, false, "Otro Negocio no debe consultar el respaldo");

  const invalidLimit = await client.rpc(ownerToken, "exportar_pagina_respaldo_operativo_v2", {
    p_backup_id: started.data.backup_id,
    p_section: "products",
    p_cursor: null,
    p_limit: 99
  });
  assert.equal(invalidLimit.ok, false, "Debe rechazarse una página menor al límite permitido");

  const invalidSection = await client.rpc(ownerToken, "exportar_pagina_respaldo_operativo_v2", {
    p_backup_id: started.data.backup_id,
    p_section: "secrets",
    p_cursor: null,
    p_limit: 100
  });
  assert.equal(invalidSection.ok, false, "Debe rechazarse una sección no declarada");

  const pages = [];
  let cursor = null;
  do {
    const page = await client.rpc(ownerToken, "exportar_pagina_respaldo_operativo_v2", {
      p_backup_id: started.data.backup_id,
      p_section: "products",
      p_cursor: cursor,
      p_limit: 100
    });
    assert.equal(page.ok, true, `No se pudo exportar products: ${message(page)}`);
    assert.equal(page.data?.section, "products");
    assert.ok(page.data.row_count <= 100);
    pages.push(page.data);
    cursor = page.data.next_cursor;
  } while (cursor);

  assert.equal(pages.length, 3, "207 productos deben exportarse en tres páginas");
  assert.deepEqual(pages.map((page) => page.row_count), [100, 100, 7]);
  assert.deepEqual(pages.map((page) => page.has_more), [true, true, false]);

  const ids = pages.flatMap((page) => page.rows.map((row) => row.id));
  assert.equal(new Set(ids).size, 207, "La paginación no debe duplicar productos");
  assert.deepEqual(ids, [...ids].sort(), "Las páginas deben conservar orden keyset estable");
  assert.equal(pages.flatMap((page) => page.rows).some((row) => "foto" in row), false);

  const alteredCursor = `${pages[0].next_cursor.slice(0, -1)}${pages[0].next_cursor.endsWith("0") ? "1" : "0"}`;
  const altered = await client.rpc(ownerToken, "exportar_pagina_respaldo_operativo_v2", {
    p_backup_id: started.data.backup_id,
    p_section: "products",
    p_cursor: alteredCursor,
    p_limit: 100
  });
  assert.equal(altered.ok, false, "Un cursor alterado debe rechazarse");
  assert.match(message(altered), /cursor.*inválido/i);

  const wrongSectionCursor = await client.rpc(ownerToken, "exportar_pagina_respaldo_operativo_v2", {
    p_backup_id: started.data.backup_id,
    p_section: "branches",
    p_cursor: pages[0].next_cursor,
    p_limit: 100
  });
  assert.equal(wrongSectionCursor.ok, false, "Un cursor no debe reutilizarse en otra sección");

  const state = await client.rpc(ownerToken, "estado_respaldo_operativo_v2", {
    p_backup_id: started.data.backup_id
  });
  assert.equal(state.ok, true, `No se pudo consultar el respaldo: ${message(state)}`);
  assert.equal(state.data?.status, "preparing");
  assert.equal(state.data?.parts?.length, 0);
  assert.equal("cursor_secret" in state.data, false);

  log("PASS: backup v2 owner auth, tenant isolation, signed cursors and keyset pagination");
  return { ownerToken, backupId: started.data.backup_id, businessId: started.data.business_id };
}
