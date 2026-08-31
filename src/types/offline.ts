import type {
  BranchId,
  BusinessId,
  CashRegisterId,
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
  readonly items: readonly OfflineSaleItem[];
  readonly payments: readonly OfflinePayment[];
  readonly subtotal: Money;
  readonly total: Money;
  readonly status: OfflineSaleStatus;
  readonly attempts: number;
  readonly lastError?: string;
}

export interface StockSnapshot {
  readonly productId: ProductId;
  readonly serverStock: number;
}
