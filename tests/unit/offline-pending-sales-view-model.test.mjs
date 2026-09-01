import test from "node:test";
import assert from "node:assert/strict";

import {
  pendingSaleRows,
  summarizePendingSales
} from "../../dist-ts/offline/pending-sales-view-model.js";

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

test("summary excludes synced sales from pending total", () => {
  const summary = summarizePendingSales([
    baseSale,
    { ...baseSale, requestId: "req-2", status: "failed_retryable" },
    { ...baseSale, requestId: "req-3", status: "review" },
    { ...baseSale, requestId: "req-4", status: "syncing" },
    { ...baseSale, requestId: "req-5", status: "synced" }
  ]);

  assert.deepEqual(summary, {
    total: 4,
    pending: 1,
    syncing: 1,
    retryable: 1,
    review: 1
  });
});

test("rows keep unsynced sales in FIFO order", () => {
  const rows = pendingSaleRows([
    { ...baseSale, requestId: "late", createdAt: "2026-09-01T12:05:00Z" },
    { ...baseSale, requestId: "done", createdAt: "2026-09-01T11:00:00Z", status: "synced" },
    { ...baseSale, requestId: "early", createdAt: "2026-09-01T12:01:00Z", status: "review" }
  ]);

  assert.deepEqual(rows.map((row) => row.requestId), ["early", "late"]);
});

test("row aggregates quantities and product label", () => {
  const rows = pendingSaleRows([
    {
      ...baseSale,
      items: [
        ...baseSale.items,
        {
          productId: "product-b",
          productName: "Producto B",
          quantity: 3,
          unitPrice: 500
        }
      ],
      payments: [
        { method: "Efectivo", amount: 1000 },
        { method: "Transferencia", amount: 2500 }
      ],
      subtotal: 3500,
      total: 3500
    }
  ]);

  assert.equal(rows[0].itemCount, 5);
  assert.equal(rows[0].itemLabel, "Producto A +1");
  assert.equal(rows[0].paymentLabel, "Efectivo + Transferencia");
});
