import test from "node:test";
import assert from "node:assert/strict";

import {
  OfflineIdempotencyConflictError,
  OfflineSaleValidationError,
  OfflineStockConflictError,
  assertSaleCanReserveStock,
  assertSameOfflineRequest,
  validateOfflineSale
} from "../../dist-ts/offline/queue-policy.js";

const baseSale = {
  requestId: "req-1",
  businessId: "business-1",
  branchId: "branch-1",
  cashRegisterId: "cash-1",
  userId: "user-1",
  createdAt: "2026-09-01T12:00:00Z",
  items: [
    {
      productId: "product-a",
      productName: "Producto A",
      quantity: 2,
      unitPrice: 1000
    }
  ],
  payments: [{ method: "Efectivo", amount: 2000 }],
  subtotal: 2000,
  total: 2000,
  status: "pending",
  attempts: 0
};

test("valid offline sale passes validation", () => {
  assert.doesNotThrow(() => validateOfflineSale(baseSale));
});

test("invalid subtotal is rejected", () => {
  assert.throws(
    () => validateOfflineSale({ ...baseSale, subtotal: 1900 }),
    OfflineSaleValidationError
  );
});

test("missing stock snapshot is rejected", () => {
  assert.throws(
    () => assertSaleCanReserveStock(baseSale, [], []),
    (error) => {
      assert.ok(error instanceof OfflineStockConflictError);
      assert.equal(error.conflicts[0]?.reason, "missing_snapshot");
      return true;
    }
  );
});

test("queued pending sale reduces available stock", () => {
  const queued = {
    ...baseSale,
    requestId: "req-old",
    items: [{ ...baseSale.items[0], quantity: 3 }]
  };

  assert.throws(
    () =>
      assertSaleCanReserveStock(
        baseSale,
        [{ productId: "product-a", serverStock: 4 }],
        [queued]
      ),
    (error) => {
      assert.ok(error instanceof OfflineStockConflictError);
      assert.equal(error.conflicts[0]?.reason, "insufficient_stock");
      assert.equal(error.conflicts[0]?.reservedBefore, 3);
      assert.equal(error.conflicts[0]?.availableBefore, 1);
      return true;
    }
  );
});

test("synced sales do not block a new offline reservation", () => {
  const synced = {
    ...baseSale,
    requestId: "req-old",
    status: "synced",
    items: [{ ...baseSale.items[0], quantity: 4 }]
  };

  assert.doesNotThrow(() =>
    assertSaleCanReserveStock(
      baseSale,
      [{ productId: "product-a", serverStock: 2 }],
      [synced]
    )
  );
});

test("same request id with same immutable payload is idempotent", () => {
  const existing = { ...baseSale, status: "failed_retryable", attempts: 2, lastError: "timeout" };
  assert.doesNotThrow(() => assertSameOfflineRequest(existing, baseSale));
});

test("same request id with a different payload is rejected", () => {
  const different = {
    ...baseSale,
    items: [{ ...baseSale.items[0], quantity: 1 }],
    subtotal: 1000,
    total: 1000,
    payments: [{ method: "Efectivo", amount: 1000 }]
  };

  assert.throws(
    () => assertSameOfflineRequest(baseSale, different),
    OfflineIdempotencyConflictError
  );
});
