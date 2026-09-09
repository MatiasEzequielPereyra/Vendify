import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLegacyOfflineTicket,
  createLegacyOfflineSale,
  isLegacyOfflineNetworkError,
  legacyOfflineSalesPreBranchStorageKey,
  legacyOfflineSalesStorageKey,
  parseLegacyOfflineQueue,
  partitionLegacyOfflineSalesByScope,
  summarizeLegacyOfflineQueue,
  validateLegacyOfflinePayments
} from "../../dist-ts/offline/legacy-fallback.js";

const baseInput = {
  requestId: "request-1",
  userId: "user-1",
  businessId: "business-1",
  branchId: "branch-1",
  cashRegisterId: "cash-1",
  items: [{ id: "product-1", nombre: "Agua", cantidad: 2, precioVenta: 750 }],
  payments: [{ medio_pago: "Efectivo", monto: 1500 }],
  totals: { subtotal: 1500, total: 1500 },
  observation: " prueba ",
  createdAt: "2026-09-03T12:00:00.000Z"
};

test("legacy queue parser tolerates missing and malformed storage", () => {
  assert.deepEqual(parseLegacyOfflineQueue(null), []);
  assert.deepEqual(parseLegacyOfflineQueue("not-json"), []);
  assert.deepEqual(parseLegacyOfflineQueue("{}"), []);
});

test("legacy queue summary separates pending and review sales", () => {
  const pending = createLegacyOfflineSale(baseInput);
  const review = { ...createLegacyOfflineSale({ ...baseInput, requestId: "request-2" }), status: "revision" };
  assert.deepEqual(summarizeLegacyOfflineQueue([pending, review]), {
    total: 2,
    pending: 1,
    revision: 1,
    queue: [pending, review]
  });
});

test("legacy offline storage is branch-scoped and migration partitions without data loss", () => {
  const scope = { userId: "user-1", businessId: "business-1", branchId: "branch-1" };
  const own = createLegacyOfflineSale(baseInput);
  const otherBranch = createLegacyOfflineSale({ ...baseInput, requestId: "request-2", branchId: "branch-2" });
  const otherUser = createLegacyOfflineSale({ ...baseInput, requestId: "request-3", userId: "user-2" });

  assert.equal(
    legacyOfflineSalesStorageKey(scope),
    "vendify_offline_sales_v2311:user-1:business-1:branch-1"
  );
  assert.equal(
    legacyOfflineSalesPreBranchStorageKey(scope),
    "vendify_offline_sales_v2311:user-1:business-1"
  );
  assert.deepEqual(
    partitionLegacyOfflineSalesByScope([own, otherBranch, otherUser], scope),
    { scoped: [own], remaining: [otherBranch, otherUser] }
  );
});

test("legacy offline payment validation preserves supported methods", () => {
  assert.doesNotThrow(() => validateLegacyOfflinePayments([
    { medio_pago: "Efectivo", monto: 500 },
    { medio_pago: "Transferencia", monto: 1000 }
  ]));
  assert.throws(
    () => validateLegacyOfflinePayments([{ medio_pago: "Tarjeta", monto: 1500 }]),
    /solo se permiten cobros en Efectivo o Transferencia/
  );
});

test("legacy fallback sale and ticket preserve checkout contracts", () => {
  const sale = createLegacyOfflineSale(baseInput);
  assert.equal(sale.request_id, "request-1");
  assert.equal(sale.observacion, "prueba");
  assert.deepEqual(sale.items[0], {
    producto_id: "product-1",
    producto_nombre: "Agua",
    cantidad: 2,
    precio_unitario: 750
  });
  assert.deepEqual(buildLegacyOfflineTicket(sale), {
    venta: {
      id: "request-1",
      creado: "2026-09-03T12:00:00.000Z",
      subtotal: 1500,
      descuento_total: 0,
      total: 1500,
      estado: "pendiente_sincronizacion",
      observacion: "prueba"
    },
    items: [{ producto_nombre: "Agua", cantidad: 2, precio_unitario: 750, subtotal: 1500 }],
    pagos: [{ medio_pago: "Efectivo", monto: 1500, operacion: "cobro" }]
  });
});

test("legacy network error classification preserves retry behavior", () => {
  assert.equal(isLegacyOfflineNetworkError(new Error("Failed to fetch"), true), true);
  assert.equal(isLegacyOfflineNetworkError({ message: "stock insuficiente" }, true), false);
  assert.equal(isLegacyOfflineNetworkError(new Error("cualquier error"), false), true);
});
