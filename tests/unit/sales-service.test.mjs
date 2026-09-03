import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeDiscount,
  configureDiscountPin,
  getDiscountPinState,
  registerSale,
  returnSaleItems,
  voidSale
} from "../../dist-ts/sales/sales-service.js";

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

test("professional checkout preserves registrar_venta_v4 idempotent contract", async () => {
  const client = makeClient({ registrar_venta_v4: { data: { venta: { id: "sale-1" } }, error: null } });
  await registerSale(client, {
    items: [{ id: "product-1", cantidad: 2 }],
    payments: [{ medio_pago: "Efectivo", monto: 1800 }],
    totals: { subtotal: 2000, tipo: "porcentaje", valor: 10, descuento: 200, total: 1800 },
    observation: "QA",
    branchId: "branch-1",
    cashRegisterId: "cash-1",
    requestId: "request-1"
  });
  assert.deepEqual(client.calls[0], {
    name: "registrar_venta_v4",
    args: {
      p_items: [{ producto_id: "product-1", cantidad: 2 }],
      p_pagos: [{ medio_pago: "Efectivo", monto: 1800 }],
      p_descuento_tipo: "porcentaje",
      p_descuento_valor: 10,
      p_observacion: "QA",
      p_sucursal_id: "branch-1",
      p_caja_id: "cash-1",
      p_request_id: "request-1"
    }
  });
});

test("discount authorization and PIN configuration preserve contracts", async () => {
  const client = makeClient({
    autorizar_descuento_v1: { data: { ok: true }, error: null },
    estado_pin_descuento_v1: { data: { configurado: true }, error: null },
    configurar_pin_descuento_v1: { data: { ok: true }, error: null }
  });
  await authorizeDiscount(client, "1234", "branch-1", { subtotal: 1000, tipo: "monto", valor: 100 });
  await getDiscountPinState(client);
  await configureDiscountPin(client, "1234");
  assert.deepEqual(client.calls, [
    {
      name: "autorizar_descuento_v1",
      args: { p_pin: "1234", p_sucursal_id: "branch-1", p_subtotal: 1000, p_descuento_tipo: "monto", p_descuento_valor: 100 }
    },
    { name: "estado_pin_descuento_v1", args: undefined },
    { name: "configurar_pin_descuento_v1", args: { p_pin: "1234" } }
  ]);
});

test("void and partial return preserve refund contracts", async () => {
  const client = makeClient({
    anular_venta_v1: { data: { ok: true }, error: null },
    devolver_venta_v1: { data: { ok: true }, error: null }
  });
  await voidSale(client, "sale-1", "cash-1", "Efectivo", "Error QA");
  await returnSaleItems(client, "sale-2", [{ item_id: "item-1", cantidad: 1 }], "cash-1", "Transferencia", "Cambio QA");
  assert.deepEqual(client.calls, [
    {
      name: "anular_venta_v1",
      args: { p_venta_id: "sale-1", p_caja_id: "cash-1", p_medio_reintegro: "Efectivo", p_motivo: "Error QA" }
    },
    {
      name: "devolver_venta_v1",
      args: { p_venta_id: "sale-2", p_items: [{ item_id: "item-1", cantidad: 1 }], p_caja_id: "cash-1", p_medio_reintegro: "Transferencia", p_motivo: "Cambio QA" }
    }
  ]);
});

test("sales services keep backend business messages", async () => {
  const client = makeClient({ registrar_venta_v4: { data: null, error: { message: "Stock insuficiente" } } });
  await assert.rejects(() => registerSale(client, {
    items: [{ id: "product-1", cantidad: 2 }],
    payments: [],
    totals: { subtotal: 10, tipo: null, valor: 0, descuento: 0, total: 10 },
    observation: null,
    branchId: "branch-1",
    cashRegisterId: "cash-1",
    requestId: "request-1"
  }), /Stock insuficiente/);
});
