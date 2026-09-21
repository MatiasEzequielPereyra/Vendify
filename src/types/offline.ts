import type {
  BranchId,
  BusinessId,
  CashRegisterId,
  OfflineLeaseId,
  ProductId,
  RequestId,
  UserId
} from "./ids.js";
import type { Money } from "./money.js";

export type OfflineSaleStatus =
  | "pending"
  | "syncing"
  | "failed_retryable"
  | "review"
  | "synced";

export type OfflinePaymentMethod = "Efectivo" | "Transferencia";

export interface OfflineLeaseReference {
  readonly leaseId: OfflineLeaseId;
  readonly token: string;
}

export interface OfflineSaleLease extends OfflineLeaseReference {
  readonly authorizedAt: string;
}

export interface OfflineProductQuota {
  readonly productId: ProductId;
  readonly maxQuantity: number;
  readonly usedQuantity: number;
}

export interface OfflineLease extends OfflineLeaseReference {
  readonly version: 1;
  readonly businessId: BusinessId;
  readonly branchId: BranchId;
  readonly cashRegisterId: CashRegisterId;
  readonly issuedByUserId: UserId;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly maxSales: number;
  readonly maxAmount: Money;
  readonly usedSales: number;
  readonly usedAmount: Money;
  readonly productQuotas: readonly OfflineProductQuota[];
}

export type OfflineLeaseServerStatus = "active" | "revoked" | "expired" | "exhausted";

export interface OfflineLeaseStatus {
  readonly status: OfflineLeaseServerStatus;
  readonly lease: OfflineLease;
}

export interface OfflineSaleItem {
  readonly productId: ProductId;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPrice: Money;
}

export interface OfflinePayment {
  readonly method: OfflinePaymentMethod;
  readonly amount: Money;
}

export interface OfflineSale {
  readonly requestId: RequestId;
  readonly businessId: BusinessId;
  readonly branchId: BranchId;
  readonly cashRegisterId: CashRegisterId;
  readonly userId: UserId;
  readonly createdAt: string;
  readonly lease?: OfflineSaleLease;
  readonly items: readonly OfflineSaleItem[];
  readonly payments: readonly OfflinePayment[];
  readonly subtotal: Money;
  readonly total: Money;
  readonly observation?: string;
  readonly status: OfflineSaleStatus;
  readonly attempts: number;
  readonly lastError?: string;
}

export interface StockSnapshot {
  readonly productId: ProductId;
  readonly serverStock: number;
}
