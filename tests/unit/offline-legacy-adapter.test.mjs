import test from "node:test";
import assert from "node:assert/strict";

import {
  legacyPosSaleToOfflineSale,
  offlineSaleToLegacyTicketShape
} from "../../dist-ts/offline/legacy-adapter.js";

const input = {
  requestId: "req-legacy-1",
  businessId: "business-1",
  branchId: "branch-1",
  cashRegisterId: "cash-1",
  userId: "user-1",
  createdAt: "2026-09-01T12:00:00.000Z",
  items: [
    {
      id: "product-1",
      nombre: "Producto Uno",
      cantidad: 2,
      precioVenta: 1500
    }
  ],
  payments: [{ medio_pago: "Efectivo", monto: 3000 }],
  subtotal: 3000,
  total: 3000,
  observation: "  Retira por mostrador  "
};

test("maps legacy POS sale into durable offline model", () => {
  const sale = legacyPosSaleToOfflineSale(input);

  assert.equal(sale.requestId, "req-legacy-1");
  assert.equal(sale.items[0].productId, "product-1");
  assert.equal(sale.items[0].quantity, 2);
  assert.equal(sale.payments[0].method, "Efectivo");
  assert.equal(sale.observation, "Retira por mostrador");
  assert.equal(sale.status, "pending");
  assert.equal(sale.attempts, 0);
});

test("rejects unsupported legacy payment methods", () => {
  assert.throws(() =>
    legacyPosSaleToOfflineSale({
      ...input,
      payments: [{ medio_pago: "Crédito", monto: 3000 }]
    })
  );
});

test("converts durable sale back to legacy ticket shape", () => {
  const sale = legacyPosSaleToOfflineSale(input);
  const ticket = offlineSaleToLegacyTicketShape(sale);

  assert.equal(ticket.request_id, "req-legacy-1");
  assert.equal(ticket.items[0].producto_nombre, "Producto Uno");
  assert.equal(ticket.pagos[0].medio_pago, "Efectivo");
  assert.equal(ticket.totales.total, 3000);
  assert.equal(ticket.observacion, "Retira por mostrador");
});
