import test from "node:test";
import assert from "node:assert/strict";

import {
  recoverInterruptedOfflineSales,
  syncOfflineQueue
} from "../../dist-ts/offline/sync-engine.js";
import { assertOfflineSaleTransition } from "../../dist-ts/offline/state-machine.js";

function sale(requestId, createdAt, status = "pending") {
  return {
    requestId,
    businessId: "business-1",
    branchId: "branch-1",
    cashRegisterId: "cash-1",
    userId: "user-1",
    createdAt,
    items: [
      {
        productId: "product-1",
        productName: "Producto",
        quantity: 1,
        unitPrice: 1000
      }
    ],
    payments: [{ method: "Efectivo", amount: 1000 }],
    subtotal: 1000,
    total: 1000,
    status,
    attempts: 0
  };
}

class MemoryStore {
  constructor(sales) {
    this.sales = new Map(sales.map((item) => [item.requestId, { ...item }]));
    this.transitions = [];
  }

  async listSales() {
    return [...this.sales.values()].map((item) => ({ ...item }));
  }

  async transitionSale(requestId, nextStatus, options = {}) {
    const current = this.sales.get(requestId);
    if (!current) throw new Error(`missing sale ${requestId}`);

    assertOfflineSaleTransition(current.status, nextStatus);

    const next = {
      ...current,
      status: nextStatus,
      attempts: current.attempts + (options.incrementAttempts ? 1 : 0)
    };

    if (options.clearLastError) delete next.lastError;
    if (options.lastError !== undefined) next.lastError = options.lastError;

    this.sales.set(requestId, next);
    this.transitions.push(`${requestId}:${current.status}->${nextStatus}`);
    return { ...next };
  }
}

test("syncs pending sales in strict FIFO order", async () => {
  const store = new MemoryStore([
    sale("req-2", "2026-09-01T10:01:00.000Z"),
    sale("req-1", "2026-09-01T10:00:00.000Z")
  ]);
  const sent = [];

  const summary = await syncOfflineQueue(store, {
    async send(item) {
      sent.push(item.requestId);
      return { ok: true };
    }
  });

  assert.deepEqual(sent, ["req-1", "req-2"]);
  assert.equal(summary.synced, 2);
  assert.equal(summary.attempted, 2);
  assert.equal(store.sales.get("req-1").status, "synced");
  assert.equal(store.sales.get("req-2").status, "synced");
});

test("retryable failure blocks later sales", async () => {
  const store = new MemoryStore([
    sale("req-1", "2026-09-01T10:00:00.000Z"),
    sale("req-2", "2026-09-01T10:01:00.000Z")
  ]);
  const sent = [];

  const summary = await syncOfflineQueue(store, {
    async send(item) {
      sent.push(item.requestId);
      return { ok: false, error: new TypeError("Failed to fetch") };
    }
  });

  assert.deepEqual(sent, ["req-1"]);
  assert.equal(summary.retryable, 1);
  assert.equal(summary.blockedRequestId, "req-1");
  assert.equal(store.sales.get("req-1").status, "failed_retryable");
  assert.equal(store.sales.get("req-2").status, "pending");
});

test("business error moves first sale to review and preserves FIFO", async () => {
  const store = new MemoryStore([
    sale("req-1", "2026-09-01T10:00:00.000Z"),
    sale("req-2", "2026-09-01T10:01:00.000Z")
  ]);
  const sent = [];

  const summary = await syncOfflineQueue(store, {
    async send(item) {
      sent.push(item.requestId);
      return { ok: false, error: { message: "stock insuficiente", code: "P0001" } };
    }
  });

  assert.deepEqual(sent, ["req-1"]);
  assert.equal(summary.review, 1);
  assert.equal(store.sales.get("req-1").status, "review");
  assert.equal(store.sales.get("req-2").status, "pending");
});

test("interrupted syncing sale is recovered as retryable", async () => {
  const store = new MemoryStore([
    sale("req-1", "2026-09-01T10:00:00.000Z", "syncing")
  ]);

  const recovered = await recoverInterruptedOfflineSales(store);

  assert.equal(recovered, 1);
  assert.equal(store.sales.get("req-1").status, "failed_retryable");
  assert.match(store.sales.get("req-1").lastError, /request_id/i);
});
