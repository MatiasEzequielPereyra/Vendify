import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRegistrarVentaV4Args,
  createRegistrarVentaV4Transport
} from "../../dist-ts/offline/supabase-transport.js";

const sale = {
  requestId: "req-123",
  businessId: "business-1",
  branchId: "branch-1",
  cashRegisterId: "cash-1",
  userId: "user-1",
  createdAt: "2026-09-01T10:00:00.000Z",
  items: [
    {
      productId: "product-1",
      productName: "Producto",
      quantity: 2,
      unitPrice: 1000
    }
  ],
  payments: [{ method: "Efectivo", amount: 2000 }],
  subtotal: 2000,
  total: 2000,
  status: "syncing",
  attempts: 1
};

test("maps offline sale to registrar_venta_v4 contract", () => {
  assert.deepEqual(buildRegistrarVentaV4Args(sale), {
    p_items: [{ producto_id: "product-1", cantidad: 2 }],
    p_pagos: [{ medio_pago: "Efectivo", monto: 2000 }],
    p_descuento_tipo: null,
    p_descuento_valor: 0,
    p_observacion: null,
    p_sucursal_id: "branch-1",
    p_caja_id: "cash-1",
    p_request_id: "req-123"
  });
});

test("preserves offline sale observation", () => {
  assert.equal(
    buildRegistrarVentaV4Args({ ...sale, observation: "Cliente retira mañana" }).p_observacion,
    "Cliente retira mañana"
  );
});

test("returns transport error without throwing when Supabase returns error", async () => {
  const client = {
    async rpc() {
      return { data: null, error: { message: "stock insuficiente", code: "P0001" } };
    }
  };

  const result = await createRegistrarVentaV4Transport(client).send(sale);
  assert.equal(result.ok, false);
});

test("returns success when registrar_venta_v4 succeeds", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { id: "sale-1" }, error: null };
    }
  };

  const result = await createRegistrarVentaV4Transport(client).send(sale);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].name, "registrar_venta_v4");
  assert.equal(calls[0].args.p_request_id, "req-123");
});
