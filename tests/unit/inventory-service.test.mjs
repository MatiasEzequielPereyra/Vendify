import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustInventoryStock,
  applyPhysicalCount,
  listInventoryMovements,
  listTransferProducts,
  transferInventoryStock
} from "../../dist-ts/inventory/inventory-service.js";

function makeClient(responses) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      return responses[name] ?? { data: null, error: null };
    }
  };
}

test("inventory read contracts preserve branch and limits", async () => {
  const client = makeClient({
    listar_movimientos_inventario_v1: { data: [{ id: "movement-1" }], error: null },
    listar_productos_sucursal_seguro_v1: { data: [{ id: "product-1" }], error: null }
  });
  assert.equal((await listInventoryMovements(client, "branch-1", 100))[0].id, "movement-1");
  assert.equal((await listTransferProducts(client, "branch-2"))[0].id, "product-1");
  assert.deepEqual(client.calls, [
    {
      name: "listar_movimientos_inventario_v1",
      args: { p_sucursal_id: "branch-1", p_limit: 100 }
    },
    {
      name: "listar_productos_sucursal_seguro_v1",
      args: { p_sucursal_id: "branch-2" }
    }
  ]);
});

test("stock adjustment preserves the atomic RPC contract", async () => {
  const client = makeClient({ ajustar_stock_inventario_v2: { data: { stock: 8 }, error: null } });
  const data = await adjustInventoryStock(client, {
    productId: "product-1",
    branchId: "branch-1",
    mode: "establecer",
    quantity: 8,
    reason: "correccion",
    note: null
  });
  assert.equal(data.stock, 8);
  assert.deepEqual(client.calls[0], {
    name: "ajustar_stock_inventario_v2",
    args: {
      p_producto_id: "product-1",
      p_sucursal_id: "branch-1",
      p_modo: "establecer",
      p_cantidad: 8,
      p_motivo: "correccion",
      p_nota: null
    }
  });
});

test("physical count maps every counted item", async () => {
  const client = makeClient({ aplicar_conteo_fisico_v2: { data: { productos_ajustados: 1 }, error: null } });
  await applyPhysicalCount(
    client,
    "branch-1",
    [{ productId: "product-1", countedStock: 4 }],
    "Conteo QA"
  );
  assert.deepEqual(client.calls[0], {
    name: "aplicar_conteo_fisico_v2",
    args: {
      p_sucursal_id: "branch-1",
      p_items: [{ producto_id: "product-1", stock_contado: 4 }],
      p_nota: "Conteo QA"
    }
  });
});

test("stock transfer preserves origin, destination and reason", async () => {
  const client = makeClient({ transferir_stock_v2: { data: { ok: true }, error: null } });
  await transferInventoryStock(client, {
    productId: "product-1",
    originId: "branch-1",
    destinationId: "branch-2",
    quantity: 3,
    reason: "Transferencia QA"
  });
  assert.deepEqual(client.calls[0], {
    name: "transferir_stock_v2",
    args: {
      p_producto_id: "product-1",
      p_origen_id: "branch-1",
      p_destino_id: "branch-2",
      p_cantidad: 3,
      p_motivo: "Transferencia QA"
    }
  });
});

test("stock transfer rejects invalid or ambiguous requests before calling the backend", async () => {
  const client = makeClient({});
  const valid = {
    productId: "product-1",
    originId: "branch-1",
    destinationId: "branch-2",
    quantity: 3,
    reason: "Transferencia QA"
  };

  await assert.rejects(
    () => transferInventoryStock(client, { ...valid, destinationId: "branch-1" }),
    /Origen y destino deben ser distintos/
  );
  await assert.rejects(
    () => transferInventoryStock(client, { ...valid, quantity: 0 }),
    /entero mayor a cero/
  );
  await assert.rejects(
    () => transferInventoryStock(client, { ...valid, quantity: 1.5 }),
    /entero mayor a cero/
  );
  await assert.rejects(
    () => transferInventoryStock(client, { ...valid, productId: "" }),
    /Revisá producto y sucursales/
  );
  assert.deepEqual(client.calls, []);
});

test("inventory services keep backend error messages", async () => {
  const client = makeClient({
    ajustar_stock_inventario_v2: { data: null, error: { message: "Sin permiso" } }
  });
  await assert.rejects(
    () => adjustInventoryStock(client, {
      productId: "product-1",
      branchId: "branch-1",
      mode: "sumar",
      quantity: 1,
      reason: "ingreso",
      note: null
    }),
    /Sin permiso/
  );
});
