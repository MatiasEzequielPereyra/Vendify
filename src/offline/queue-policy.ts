import type { OfflineSale, OfflineSaleItem, StockSnapshot } from "../types/offline.js";
import type { ProductId } from "../types/ids.js";
import { reservedQuantityForProduct } from "./stock-reservations.js";

const MONEY_EPSILON = 0.01;

export type OfflineStockConflictReason =
  | "missing_snapshot"
  | "insufficient_stock";

export interface OfflineStockConflict {
  readonly productId: ProductId;
  readonly productName: string;
  readonly reason: OfflineStockConflictReason;
  readonly requested: number;
  readonly reservedBefore: number;
  readonly availableBefore: number;
}

export class OfflineStockConflictError extends Error {
  readonly conflicts: readonly OfflineStockConflict[];

  constructor(conflicts: readonly OfflineStockConflict[]) {
    super("Offline sale cannot reserve the requested stock");
    this.name = "OfflineStockConflictError";
    this.conflicts = conflicts;
  }
}

export class OfflineSaleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflineSaleValidationError";
  }
}

export class OfflineIdempotencyConflictError extends Error {
  constructor(requestId: string) {
    super(`Offline requestId already exists with a different payload: ${requestId}`);
    this.name = "OfflineIdempotencyConflictError";
  }
}

function assertFiniteMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new OfflineSaleValidationError(`${label} must be a finite non-negative number`);
  }
}

function assertValidItem(item: OfflineSaleItem): void {
  if (!item.productId || !item.productName.trim()) {
    throw new OfflineSaleValidationError("Every offline sale item needs productId and productName");
  }

  if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
    throw new OfflineSaleValidationError(
      `Offline quantity must be a positive integer for product ${item.productId}`
    );
  }

  assertFiniteMoney(item.unitPrice, `unitPrice:${item.productId}`);
}

function assertOfflinePaymentMethod(
  method: unknown
): asserts method is "Efectivo" | "Transferencia" {
  if (method !== "Efectivo" && method !== "Transferencia") {
    const printable = typeof method === "string" ? method : JSON.stringify(method);
    throw new OfflineSaleValidationError(
      `Unsupported offline payment method: ${printable ?? "unknown"}`
    );
  }
}

export function validateOfflineSale(sale: OfflineSale): void {
  if (!sale.requestId) {
    throw new OfflineSaleValidationError("Offline sale requires requestId");
  }

  if (!sale.businessId || !sale.branchId || !sale.cashRegisterId || !sale.userId) {
    throw new OfflineSaleValidationError("Offline sale scope is incomplete");
  }

  if (!Number.isFinite(Date.parse(sale.createdAt))) {
    throw new OfflineSaleValidationError("Offline sale createdAt is invalid");
  }

  if (sale.items.length === 0) {
    throw new OfflineSaleValidationError("Offline sale requires at least one item");
  }

  sale.items.forEach(assertValidItem);
  sale.payments.forEach((payment) => {
    const method: unknown = payment.method;
    assertOfflinePaymentMethod(method);
    assertFiniteMoney(payment.amount, `payment:${method}`);
  });

  assertFiniteMoney(sale.subtotal, "subtotal");
  assertFiniteMoney(sale.total, "total");

  const calculatedSubtotal = sale.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );

  if (Math.abs(calculatedSubtotal - sale.subtotal) > MONEY_EPSILON) {
    throw new OfflineSaleValidationError("Offline sale subtotal does not match its items");
  }

  const paymentTotal = sale.payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (Math.abs(paymentTotal - sale.total) > MONEY_EPSILON) {
    throw new OfflineSaleValidationError("Offline payment total does not match sale total");
  }

  if (Math.abs(sale.subtotal - sale.total) > MONEY_EPSILON) {
    throw new OfflineSaleValidationError(
      "Offline discounts are not supported; subtotal and total must match"
    );
  }
}

function normalizedItems(
  sale: OfflineSale
): readonly (readonly [string, number, number])[] {
  return [...sale.items]
    .map((item) => [String(item.productId), item.quantity, item.unitPrice] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function normalizedPayments(
  sale: OfflineSale
): readonly (readonly [string, number])[] {
  return [...sale.payments]
    .map((payment) => [payment.method, payment.amount] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

export function offlineSalePayloadFingerprint(sale: OfflineSale): string {
  return JSON.stringify({
    requestId: sale.requestId,
    businessId: sale.businessId,
    branchId: sale.branchId,
    cashRegisterId: sale.cashRegisterId,
    userId: sale.userId,
    createdAt: sale.createdAt,
    items: normalizedItems(sale),
    payments: normalizedPayments(sale),
    subtotal: sale.subtotal,
    total: sale.total
  });
}

export function assertSameOfflineRequest(existing: OfflineSale, incoming: OfflineSale): void {
  if (offlineSalePayloadFingerprint(existing) !== offlineSalePayloadFingerprint(incoming)) {
    throw new OfflineIdempotencyConflictError(String(incoming.requestId));
  }
}

function quantityRequested(productId: ProductId, sale: OfflineSale): number {
  return sale.items.reduce(
    (sum, item) => sum + (item.productId === productId ? item.quantity : 0),
    0
  );
}

export function assertSaleCanReserveStock(
  sale: OfflineSale,
  snapshots: readonly StockSnapshot[],
  queuedSales: readonly OfflineSale[]
): void {
  validateOfflineSale(sale);

  const sameScopeSales = queuedSales.filter(
    (queued) =>
      queued.requestId !== sale.requestId &&
      queued.businessId === sale.businessId &&
      queued.branchId === sale.branchId
  );

  const snapshotByProduct = new Map(
    snapshots.map((snapshot) => [snapshot.productId, snapshot] as const)
  );

  const uniqueProducts = new Map<ProductId, string>();
  for (const item of sale.items) {
    uniqueProducts.set(item.productId, item.productName);
  }

  const conflicts: OfflineStockConflict[] = [];

  for (const [productId, productName] of uniqueProducts) {
    const requested = quantityRequested(productId, sale);
    const reservedBefore = reservedQuantityForProduct(productId, sameScopeSales);
    const snapshot = snapshotByProduct.get(productId);

    if (!snapshot) {
      conflicts.push({
        productId,
        productName,
        reason: "missing_snapshot",
        requested,
        reservedBefore,
        availableBefore: 0
      });
      continue;
    }

    const availableBefore = Math.max(0, snapshot.serverStock - reservedBefore);
    if (requested > availableBefore) {
      conflicts.push({
        productId,
        productName,
        reason: "insufficient_stock",
        requested,
        reservedBefore,
        availableBefore
      });
    }
  }

  if (conflicts.length > 0) {
    throw new OfflineStockConflictError(conflicts);
  }
}
