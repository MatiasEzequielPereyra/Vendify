import assert from "node:assert/strict";
import test from "node:test";
import {
  OfflineLeaseError,
  assertOfflineLeaseAllowsSale,
  isOfflineLeaseExhausted,
  mergeOfflineLeaseUsage,
  parseOfflineLease,
  parseOfflineLeaseStatus
} from "../../dist-ts/offline/offline-lease.js";

const rawLease = (overrides = {}) => ({
  version: 1,
  lease_id: "lease-1",
  token: "a".repeat(64),
  business_id: "business-1",
  branch_id: "branch-1",
  cash_register_id: "cash-1",
  issued_by_user_id: "user-1",
  issued_at: "2026-09-17T10:00:00.000Z",
  expires_at: "2026-09-17T18:00:00.000Z",
  max_sales: 2,
  max_amount: 5000,
  used_sales: 0,
  used_amount: 0,
  product_quotas: [{ product_id: "product-1", max_quantity: 3, used_quantity: 0 }],
  ...overrides
});

test("parses authoritative lease status while retaining the local opaque token", () => {
  const token = "b".repeat(64);
  const { token: _serverMustNotReturnToken, ...payload } = rawLease({ status: "revoked" });
  const state = parseOfflineLeaseStatus(payload, token);
  assert.equal(state.status, "revoked");
  assert.equal(state.lease.token, token);
  assert.throws(() => parseOfflineLeaseStatus({ ...payload, status: "unknown" }, token), OfflineLeaseError);
});

test("detects aggregate lease exhaustion", () => {
  assert.equal(isOfflineLeaseExhausted(parseOfflineLease(rawLease())), false);
  assert.equal(isOfflineLeaseExhausted(parseOfflineLease(rawLease({ used_sales: 2 }))), true);
  assert.equal(isOfflineLeaseExhausted(parseOfflineLease(rawLease({ used_amount: 5000 }))), true);
});

test("reconciliation never releases usage from unsynchronized local sales", () => {
  const local = parseOfflineLease(rawLease({
    used_sales: 2,
    used_amount: 2000,
    product_quotas: [{ product_id: "product-1", max_quantity: 3, used_quantity: 2 }]
  }));
  const server = parseOfflineLease(rawLease({ used_sales: 1, used_amount: 1000 }));
  const reconciled = mergeOfflineLeaseUsage(local, server);
  assert.equal(reconciled.usedSales, 2);
  assert.equal(reconciled.usedAmount, 2000);
  assert.equal(reconciled.productQuotas[0].usedQuantity, 2);
  assert.throws(() => mergeOfflineLeaseUsage(local, parseOfflineLease(rawLease({ lease_id: "other" }))), {
    code: "scope_mismatch"
  });
});

const sale = (overrides = {}) => ({
  businessId: "business-1",
  branchId: "branch-1",
  cashRegisterId: "cash-1",
  userId: "user-1",
  createdAt: "2026-09-17T12:00:00.000Z",
  total: 1000,
  items: [{ productId: "product-1", quantity: 1 }],
  ...overrides
});

test("parses a versioned offline lease from an untrusted RPC payload", () => {
  const lease = parseOfflineLease(rawLease());
  assert.equal(lease.leaseId, "lease-1");
  assert.equal(lease.maxSales, 2);
  assert.equal(lease.productQuotas[0].maxQuantity, 3);
});

test("rejects malformed lease payloads and short opaque tokens", () => {
  assert.throws(() => parseOfflineLease(rawLease({ token: "short" })), OfflineLeaseError);
  assert.throws(() => parseOfflineLease({ version: 1 }), OfflineLeaseError);
});

test("accepts a sale inside lease scope, validity and capacity", () => {
  const lease = parseOfflineLease(rawLease());
  assert.doesNotThrow(() => assertOfflineLeaseAllowsSale(
    lease, sale(), new Date("2026-09-17T12:00:00.000Z")
  ));
});

test("rejects missing, future and expired leases", () => {
  assert.throws(() => assertOfflineLeaseAllowsSale(null, sale()), { code: "missing" });
  const lease = parseOfflineLease(rawLease());
  assert.throws(() => assertOfflineLeaseAllowsSale(
    lease, sale(), new Date("2026-09-17T09:00:00.000Z")
  ), { code: "not_yet_valid" });
  assert.throws(() => assertOfflineLeaseAllowsSale(
    lease, sale(), new Date("2026-09-17T19:00:00.000Z")
  ), { code: "expired" });
});

test("rejects cross-tenant, cross-branch and cross-cash sales while allowing another authorized user", () => {
  const lease = parseOfflineLease(rawLease());
  for (const mismatch of [
    { businessId: "other" }, { branchId: "other" }, { cashRegisterId: "other" }
  ]) {
    assert.throws(() => assertOfflineLeaseAllowsSale(
      lease, sale(mismatch), new Date("2026-09-17T12:00:00.000Z")
    ), { code: "scope_mismatch" });
  }
  assert.doesNotThrow(() => assertOfflineLeaseAllowsSale(
    lease, sale({ userId: "other" }), new Date("2026-09-17T12:00:00.000Z")
  ));
});

test("rejects products without quota and quantities beyond the remaining product quota", () => {
  const lease = parseOfflineLease(rawLease({
    product_quotas: [{ product_id: "product-1", max_quantity: 3, used_quantity: 2 }]
  }));
  assert.throws(() => assertOfflineLeaseAllowsSale(
    lease, sale({ items: [{ productId: "product-1", quantity: 2 }] }),
    new Date("2026-09-17T12:00:00.000Z")
  ), { code: "capacity_exhausted" });
  assert.throws(() => assertOfflineLeaseAllowsSale(
    lease, sale({ items: [{ productId: "product-2", quantity: 1 }] }),
    new Date("2026-09-17T12:00:00.000Z")
  ), { code: "capacity_exhausted" });
});

test("rejects exhausted sale-count and amount capacity", () => {
  const countLease = parseOfflineLease(rawLease({ used_sales: 2 }));
  assert.throws(() => assertOfflineLeaseAllowsSale(
    countLease, sale(), new Date("2026-09-17T12:00:00.000Z")
  ), { code: "capacity_exhausted" });
  const amountLease = parseOfflineLease(rawLease({ used_amount: 4500 }));
  assert.throws(() => assertOfflineLeaseAllowsSale(
    amountLease, sale(), new Date("2026-09-17T12:00:00.000Z")
  ), { code: "capacity_exhausted" });
});
