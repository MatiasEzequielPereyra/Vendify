import test from "node:test";
import assert from "node:assert/strict";

import {
  availableOfflineStock,
  reservedQuantityForProduct
} from "../../dist-ts/offline/stock-reservations.js";

const productA = "product-a";
const baseSale = {
  requestId: "req-1",
  businessId: "business-1",
  branchId: "branch-1",
  cashRegisterId: "cash-1",
  userId: "user-1",
  createdAt: "2026-08-31T12:00:00Z",
  payments: [{ method: "Efectivo", amount: 2000 }],
  subtotal: 2000,
  total: 2000,
  attempts: 0,
  items: [
    {
      productId: productA,
      productName: "Producto A",
      quantity: 2,
      unitPrice: 1000
    }
  ]
};

test("pending sales reserve local stock", () => {
  const sales = [{ ...baseSale, status: "pending" }];
  assert.equal(reservedQuantityForProduct(productA, sales), 2);
  assert.equal(
    availableOfflineStock({ productId: productA, serverStock: 5 }, sales),
    3
  );
});

test("review sales still reserve stock until resolved", () => {
  const sales = [{ ...baseSale, status: "review" }];
  assert.equal(
    availableOfflineStock({ productId: productA, serverStock: 2 }, sales),
    0
  );
});

test("synced sales do not reserve stock", () => {
  const sales = [{ ...baseSale, status: "synced" }];
  assert.equal(
    availableOfflineStock({ productId: productA, serverStock: 5 }, sales),
    5
  );
});
