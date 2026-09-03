import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSaleTotals,
  discountAuthorizationMatches,
  netSaleTotal,
  normalizeDiscountRequest,
  normalizeSalePayments,
  salesDateRange,
  ticketNumber
} from "../../dist-ts/sales/sales-model.js";

test("discount requests clamp percentage and amount values", () => {
  assert.deepEqual(normalizeDiscountRequest(1000, "porcentaje", 150), {
    subtotal: 1000, tipo: "porcentaje", valor: 100
  });
  assert.deepEqual(normalizeDiscountRequest(1000, "monto", 1500), {
    subtotal: 1000, tipo: "monto", valor: 1000
  });
});

test("sale totals apply only a matching authorized discount", () => {
  const request = normalizeDiscountRequest(1000, "porcentaje", 10);
  assert.deepEqual(calculateSaleTotals(request, false), {
    subtotal: 1000, tipo: null, valor: 0, descuento: 0, total: 1000
  });
  assert.deepEqual(calculateSaleTotals(request, true), {
    subtotal: 1000, tipo: "porcentaje", valor: 10, descuento: 100, total: 900
  });
  assert.equal(discountAuthorizationMatches({
    ok: true, ...request, autorizador: "Owner", expiraMs: 2000
  }, request, 1000), true);
});

test("mixed payments require the exact sale total", () => {
  const format = (value) => `$${value}`;
  assert.deepEqual(normalizeSalePayments("mixed", 1000, "Efectivo", [
    { medio_pago: "Efectivo", monto: 400 },
    { medio_pago: "Transferencia", monto: 600 }
  ], format), [
    { medio_pago: "Efectivo", monto: 400 },
    { medio_pago: "Transferencia", monto: 600 }
  ]);
  assert.throws(
    () => normalizeSalePayments("mixed", 1000, "Efectivo", [
      { medio_pago: "Efectivo", monto: 900 }
    ], format),
    /Faltan \$100/
  );
});

test("sales helpers preserve net total, ticket and date ranges", () => {
  assert.equal(netSaleTotal({ total: 1500, total_devuelto: 400 }), 1100);
  assert.equal(ticketNumber("12345678-abcd"), "12345678");
  const range = salesDateRange("ayer", new Date(2026, 8, 3, 12));
  assert.equal(range.desde?.getDate(), 2);
  assert.equal(range.hasta?.getDate(), 3);
});
