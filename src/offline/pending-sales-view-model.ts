import type { OfflineSale, OfflineSaleStatus } from "../types/offline.js";

type UnsyncedOfflineSale = OfflineSale & {
  readonly status: Exclude<OfflineSaleStatus, "synced">;
};

export interface PendingSalesSummary {
  readonly total: number;
  readonly pending: number;
  readonly syncing: number;
  readonly retryable: number;
  readonly review: number;
}

export interface PendingSaleRow {
  readonly requestId: string;
  readonly createdAt: string;
  readonly status: Exclude<OfflineSaleStatus, "synced">;
  readonly attempts: number;
  readonly total: number;
  readonly itemCount: number;
  readonly itemLabel: string;
  readonly paymentLabel: string;
  readonly lastError: string | null;
}

function isUnsyncedSale(sale: OfflineSale): sale is UnsyncedOfflineSale {
  return sale.status !== "synced";
}

export function summarizePendingSales(
  sales: readonly OfflineSale[]
): PendingSalesSummary {
  let pending = 0;
  let syncing = 0;
  let retryable = 0;
  let review = 0;

  for (const sale of sales) {
    switch (sale.status) {
      case "pending":
        pending += 1;
        break;
      case "syncing":
        syncing += 1;
        break;
      case "failed_retryable":
        retryable += 1;
        break;
      case "review":
        review += 1;
        break;
      case "synced":
        break;
    }
  }

  return {
    total: pending + syncing + retryable + review,
    pending,
    syncing,
    retryable,
    review
  };
}

export function pendingSaleRows(
  sales: readonly OfflineSale[]
): readonly PendingSaleRow[] {
  return sales
    .filter(isUnsyncedSale)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((sale) => {
      const itemCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
      const firstItem = sale.items[0]?.productName ?? "Venta offline";
      const extraItems = sale.items.length - 1;
      const paymentLabel = sale.payments.map((payment) => payment.method).join(" + ");

      return {
        requestId: String(sale.requestId),
        createdAt: sale.createdAt,
        status: sale.status,
        attempts: sale.attempts,
        total: sale.total,
        itemCount,
        itemLabel: extraItems > 0 ? `${firstItem} +${String(extraItems)}` : firstItem,
        paymentLabel,
        lastError: sale.lastError ?? null
      };
    });
}
