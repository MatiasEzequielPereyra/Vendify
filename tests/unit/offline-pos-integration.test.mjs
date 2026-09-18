import assert from "node:assert/strict";
import test from "node:test";
import { createOfflinePosIntegration } from "../../dist-ts/offline/pos-integration.js";

function sale() {
  return {
    requestId: "request-1",
    businessId: "business-1",
    branchId: "branch-1",
    cashRegisterId: "cash-1",
    userId: "user-1",
    createdAt: "2026-09-18T10:00:00.000Z",
    lease: {
      leaseId: "lease-1",
      token: "opaque-token-value-with-enough-length",
      authorizedAt: "2026-09-18T09:00:00.000Z"
    },
    items: [{ productId: "product-1", productName: "Yerba", quantity: 1, unitPrice: 1500 }],
    payments: [{ method: "Efectivo", amount: 1500 }],
    subtotal: 1500,
    total: 1500,
    status: "pending",
    attempts: 0
  };
}

function harness(overrides = {}) {
  const calls = [];
  const runtime = {
    enabled: true,
    ready: Promise.resolve(),
    listSales: async (scope) => { calls.push(["list", scope]); return [sale()]; },
    acquireLease: async (_client, scope) => { calls.push(["lease", scope]); },
    enqueueLegacySale: async (input) => { calls.push(["enqueue", input]); return sale(); },
    syncNow: async (_client, scope, options) => {
      calls.push(["sync", scope, options]);
      return { attempted: 1, synced: 1, retryable: 0, review: 0, recovered: 0 };
    }
  };
  const dependencies = {
    client: { supabaseUrl: "http://127.0.0.1:54321", rpc: async () => ({ data: null, error: null }) },
    getRuntime: () => runtime,
    getScope: () => ({
      userId: "user-1",
      businessId: "business-1",
      branchId: "branch-1",
      cashRegisterId: "cash-1"
    }),
    ensureRequestId: () => "request-1",
    validatePayments: (payments) => calls.push(["validate-payments", payments]),
    validateLocalStock: (items) => calls.push(["validate-stock", items]),
    applySaleToLocalStock: (items) => calls.push(["apply-stock", items]),
    applySaleToLocalCash: (payments, total) => calls.push(["apply-cash", payments, total]),
    buildTicket: (value) => ({ ticket: value.request_id }),
    reloadProducts: async () => { calls.push(["reload-products"]); },
    reloadCash: async () => { calls.push(["reload-cash"]); },
    showToast: (message, type) => calls.push(["toast", message, type]),
    notifyChanged: (detail) => calls.push(["changed", detail]),
    warn: (message, error) => calls.push(["warn", message, error]),
    isOnline: () => true,
    getLocationSearch: () => "",
    ...overrides
  };
  return { calls, integration: createOfflinePosIntegration(dependencies) };
}

test("typed POS integration stays idle until an authenticated scope exists", async () => {
  const { calls, integration } = harness({
    getScope: () => ({ userId: null, businessId: null, branchId: null, cashRegisterId: null })
  });

  assert.deepEqual(await integration.listSales(), []);
  assert.deepEqual(await integration.sync(), {
    attempted: 0, synced: 0, retryable: 0, review: 0, recovered: 0
  });
  assert.deepEqual(calls, []);
});

test("typed POS integration validates, persists and mirrors an offline sale", async () => {
  const { calls, integration } = harness();
  const ticket = await integration.registerSale(
    [{ id: "product-1", nombre: "Yerba", cantidad: 1, precioVenta: 1500 }],
    [{ medio_pago: "Efectivo", monto: 1500 }],
    { subtotal: 1500, total: 1500 },
    ""
  );

  assert.deepEqual(ticket, { ticket: "request-1" });
  assert.deepEqual(calls.map(([name]) => name), [
    "validate-payments", "validate-stock", "enqueue", "apply-stock", "apply-cash", "changed"
  ]);
});

test("typed POS integration synchronizes, reconciles and renews the lease", async () => {
  const { calls, integration } = harness();
  const result = await integration.sync({ mostrarResumen: true, incluirRevision: true });

  assert.equal(result.synced, 1);
  assert.deepEqual(calls.map(([name]) => name), [
    "sync", "reload-products", "reload-cash", "toast", "changed", "lease"
  ]);
});

test("a durable sale remains successful when its local mirror needs recovery", async () => {
  const { calls, integration } = harness({
    applySaleToLocalStock: () => { throw new Error("render failed"); }
  });

  const ticket = await integration.registerSale(
    [{ id: "product-1", nombre: "Yerba", cantidad: 1, precioVenta: 1500 }],
    [{ medio_pago: "Efectivo", monto: 1500 }],
    { subtotal: 1500, total: 1500 },
    ""
  );

  assert.deepEqual(ticket, { ticket: "request-1" });
  assert.equal(calls.filter(([name]) => name === "warn").length, 1);
  assert.equal(calls.filter(([name]) => name === "changed").length, 1);
});

test("a synchronized sale remains successful when visual reconciliation fails", async () => {
  const { calls, integration } = harness({
    reloadProducts: async () => { throw new Error("catalog refresh failed"); }
  });

  const result = await integration.sync();
  assert.equal(result.synced, 1);
  assert.equal(calls.filter(([name]) => name === "warn").length, 1);
  assert.equal(calls.filter(([name]) => name === "changed").length, 1);
  assert.equal(calls.filter(([name]) => name === "lease").length, 1);
});

test("typed POS integration blocks production synchronization without the explicit override", async () => {
  const { calls, integration } = harness({
    client: {
      supabaseUrl: "https://puhkmblnptntorwptvld.supabase.co",
      rpc: async () => ({ data: null, error: null })
    }
  });

  const result = await integration.sync({ mostrarResumen: true });
  assert.equal(result.attempted, 0);
  assert.deepEqual(calls.map(([name]) => name), ["toast"]);
});
