import type { OfflineLease, OfflineProductQuota, OfflineSale } from "../types/offline.js";
import type {
  BranchId,
  BusinessId,
  CashRegisterId,
  OfflineLeaseId,
  ProductId,
  UserId
} from "../types/ids.js";

export type OfflineLeaseErrorCode =
  | "missing"
  | "invalid"
  | "not_yet_valid"
  | "expired"
  | "scope_mismatch"
  | "capacity_exhausted";

export class OfflineLeaseError extends Error {
  readonly code: OfflineLeaseErrorCode;

  constructor(code: OfflineLeaseErrorCode, message: string) {
    super(message);
    this.name = "OfflineLeaseError";
    this.code = code;
  }
}

export interface OfflineLeaseScope {
  readonly businessId: string;
  readonly branchId: string;
  readonly cashRegisterId: string;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseProductQuotas(value: unknown): readonly OfflineProductQuota[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const quotas: OfflineProductQuota[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const source = record(entry);
    const productId = text(source?.product_id ?? source?.productId);
    const maxQuantity = finiteNonNegative(source?.max_quantity ?? source?.maxQuantity);
    const usedQuantity = finiteNonNegative(source?.used_quantity ?? source?.usedQuantity);
    if (!productId || maxQuantity === null || maxQuantity <= 0 || usedQuantity === null || usedQuantity > maxQuantity || seen.has(productId)) {
      return null;
    }
    seen.add(productId);
    quotas.push({ productId: productId as ProductId, maxQuantity, usedQuantity });
  }
  return quotas;
}

export function parseOfflineLease(value: unknown): OfflineLease {
  const source = record(value);
  const leaseId = text(source?.lease_id ?? source?.leaseId);
  const token = text(source?.token);
  const businessId = text(source?.business_id ?? source?.businessId);
  const branchId = text(source?.branch_id ?? source?.branchId);
  const cashRegisterId = text(source?.cash_register_id ?? source?.cashRegisterId);
  const issuedByUserId = text(source?.issued_by_user_id ?? source?.issuedByUserId);
  const issuedAt = text(source?.issued_at ?? source?.issuedAt);
  const expiresAt = text(source?.expires_at ?? source?.expiresAt);
  const maxSales = positiveInteger(source?.max_sales ?? source?.maxSales);
  const maxAmount = finiteNonNegative(source?.max_amount ?? source?.maxAmount);
  const usedSales = finiteNonNegative(source?.used_sales ?? source?.usedSales);
  const usedAmount = finiteNonNegative(source?.used_amount ?? source?.usedAmount);
  const productQuotas = parseProductQuotas(source?.product_quotas ?? source?.productQuotas);

  if (
    source?.version !== 1 || !leaseId || !token || token.length < 32 ||
    !businessId || !branchId || !cashRegisterId || !issuedByUserId || !issuedAt || !expiresAt ||
    !Number.isFinite(Date.parse(issuedAt)) || !Number.isFinite(Date.parse(expiresAt)) ||
    maxSales === null || maxAmount === null || usedSales === null || usedAmount === null ||
    usedSales > maxSales || usedAmount > maxAmount || productQuotas === null
  ) {
    throw new OfflineLeaseError("invalid", "La autorización offline recibida no es válida.");
  }

  return {
    version: 1,
    leaseId: leaseId as OfflineLeaseId,
    token,
    businessId: businessId as BusinessId,
    branchId: branchId as BranchId,
    cashRegisterId: cashRegisterId as CashRegisterId,
    issuedByUserId: issuedByUserId as UserId,
    issuedAt,
    expiresAt,
    maxSales,
    maxAmount,
    usedSales,
    usedAmount,
    productQuotas
  };
}

export function assertOfflineLeaseAllowsSale(
  lease: OfflineLease | null,
  sale: Pick<OfflineSale, "businessId" | "branchId" | "cashRegisterId" | "createdAt" | "total" | "items">,
  now = new Date()
): asserts lease is OfflineLease {
  if (!lease) throw new OfflineLeaseError("missing", "Necesitás conectarte para habilitar ventas offline.");
  const nowMs = now.getTime();
  const issuedMs = Date.parse(lease.issuedAt);
  const expiresMs = Date.parse(lease.expiresAt);
  const saleMs = Date.parse(sale.createdAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(saleMs)) {
    throw new OfflineLeaseError("invalid", "La fecha de la venta offline no es válida.");
  }
  if (nowMs < issuedMs || saleMs < issuedMs) {
    throw new OfflineLeaseError("not_yet_valid", "La autorización offline todavía no es válida.");
  }
  if (nowMs > expiresMs || saleMs > expiresMs) {
    throw new OfflineLeaseError("expired", "La autorización offline venció. Conectate para renovarla.");
  }
  if (
    lease.businessId !== sale.businessId || lease.branchId !== sale.branchId ||
    lease.cashRegisterId !== sale.cashRegisterId
  ) {
    throw new OfflineLeaseError("scope_mismatch", "La autorización offline pertenece a otra caja o sesión.");
  }
  if (lease.usedSales + 1 > lease.maxSales || lease.usedAmount + sale.total > lease.maxAmount) {
    throw new OfflineLeaseError("capacity_exhausted", "La capacidad offline se agotó. Conectate para renovarla.");
  }
  const requested = new Map<string, number>();
  for (const item of sale.items) requested.set(item.productId, (requested.get(item.productId) ?? 0) + item.quantity);
  for (const [productId, quantity] of requested) {
    const quota = lease.productQuotas.find((entry) => entry.productId === productId);
    if (!quota || quota.usedQuantity + quantity > quota.maxQuantity) {
      throw new OfflineLeaseError("capacity_exhausted", "El cupo offline del producto se agotó. Conectate para actualizarlo.");
    }
  }
}

export function leaseScopeKey(scope: OfflineLeaseScope): string {
  return [scope.businessId, scope.branchId, scope.cashRegisterId].join(":");
}
