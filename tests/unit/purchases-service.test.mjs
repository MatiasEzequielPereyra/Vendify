import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelPurchaseDraft,
  getPurchase,
  listPurchases,
  listSuppliers,
  receivePurchase,
  savePurchaseDraft,
  saveSupplier
} from "../../dist-ts/purchases/purchases-service.js";

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

test("purchase queries preserve their RPC contracts", async () => {
  const client = makeClient({
    listar_proveedores_v1: { data: [{ id: "supplier-1" }], error: null },
    listar_compras_v1: { data: [{ id: "purchase-1" }], error: null },
    obtener_compra_v1: {
      data: { compra: { id: "purchase-1" }, items: [] },
      error: null
    }
  });

  assert.equal((await listSuppliers(client))[0].id, "supplier-1");
  assert.equal((await listPurchases(client, "branch-1"))[0].id, "purchase-1");
  assert.equal((await getPurchase(client, "purchase-1")).compra.id, "purchase-1");
  assert.deepEqual(client.calls, [
    { name: "listar_proveedores_v1", args: undefined },
    { name: "listar_compras_v1", args: { p_sucursal_id: "branch-1", p_limit: 150 } },
    { name: "obtener_compra_v1", args: { p_compra_id: "purchase-1" } }
  ]);
});

test("supplier mutation preserves every backend parameter", async () => {
  const client = makeClient({ guardar_proveedor_v1: { data: { ok: true }, error: null } });
  await saveSupplier(client, {
    id: null,
    name: "Proveedor QA",
    taxId: "20-1",
    contact: "Ana",
    phone: "123",
    email: "qa@example.com",
    address: "Calle 1",
    notes: "Prueba"
  });
  assert.deepEqual(client.calls[0], {
    name: "guardar_proveedor_v1",
    args: {
      p_id: null,
      p_nombre: "Proveedor QA",
      p_cuit: "20-1",
      p_contacto: "Ana",
      p_telefono: "123",
      p_email: "qa@example.com",
      p_direccion: "Calle 1",
      p_notas: "Prueba"
    }
  });
});

test("draft, receive, and cancel mutations preserve purchase contracts", async () => {
  const ok = { data: { ok: true, compra_id: "purchase-2" }, error: null };
  const client = makeClient({
    guardar_compra_borrador_v1: ok,
    recibir_compra_v1: ok,
    anular_compra_borrador_v1: ok
  });
  await savePurchaseDraft(client, {
    purchaseId: null,
    branchId: "branch-1",
    supplierId: "supplier-1",
    receiptNumber: "A-1",
    notes: null,
    items: [{ productId: "product-1", quantity: 2, unitCost: 100 }]
  });
  await receivePurchase(client, "purchase-2");
  await cancelPurchaseDraft(client, "purchase-2");
  assert.deepEqual(client.calls, [
    {
      name: "guardar_compra_borrador_v1",
      args: {
        p_compra_id: null,
        p_sucursal_id: "branch-1",
        p_proveedor_id: "supplier-1",
        p_numero_comprobante: "A-1",
        p_nota: null,
        p_items: [{ producto_id: "product-1", cantidad: 2, costo_unitario: 100 }]
      }
    },
    { name: "recibir_compra_v1", args: { p_compra_id: "purchase-2" } },
    { name: "anular_compra_borrador_v1", args: { p_compra_id: "purchase-2" } }
  ]);
});

test("purchase mutations keep backend business messages", async () => {
  const client = makeClient({
    guardar_compra_borrador_v1: {
      data: { ok: false, message: "Compra inválida" },
      error: null
    }
  });
  await assert.rejects(
    () => savePurchaseDraft(client, {
      purchaseId: null,
      branchId: "branch-1",
      supplierId: "supplier-1",
      receiptNumber: null,
      notes: null,
      items: []
    }),
    /Compra inválida/
  );
});
