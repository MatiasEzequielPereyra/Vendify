import type { OfflineSale } from "../types/offline.js";
import type {
  LegacyPosPaymentInput,
  LegacyPosSaleItemInput,
  LegacyTicketSaleShape
} from "./legacy-adapter.js";
import { offlineSaleToLegacyTicketShape } from "./legacy-adapter.js";
import type { OfflineCompatSyncOptions } from "./compat-controller.js";
import type { OfflineQueueScope, OfflineSyncSummary } from "./sync-engine.js";
import type { SupabaseRpcClientLike } from "./supabase-transport.js";
import {
  VENDIFY_PRODUCTION_SUPABASE_REF,
  resolveOfflineSyncSafety
} from "./sync-safety.js";

export interface OfflinePosRuntime {
  readonly enabled: boolean;
  readonly ready: Promise<void>;
  listSales(scope: OfflineQueueScope): Promise<readonly OfflineSale[]>;
  acquireLease(
    client: SupabaseRpcClientLike,
    scope: OfflineQueueScope & { readonly cashRegisterId: string }
  ): Promise<unknown>;
  enqueueLegacySale(input: {
    readonly requestId: string;
    readonly businessId: string;
    readonly branchId: string;
    readonly cashRegisterId: string;
    readonly userId: string;
    readonly items: readonly LegacyPosSaleItemInput[];
    readonly payments: readonly LegacyPosPaymentInput[];
    readonly subtotal: number;
    readonly total: number;
    readonly observation?: string | null;
  }): Promise<OfflineSale>;
  syncNow(
    client: SupabaseRpcClientLike,
    scope: OfflineQueueScope,
    options?: { readonly includeReview?: boolean; readonly recoverInterrupted?: boolean; readonly limit?: number }
  ): Promise<OfflineSyncSummary>;
}

export interface OfflinePosScope {
  readonly userId: string | null;
  readonly businessId: string | null;
  readonly branchId: string | null;
  readonly cashRegisterId: string | null;
}

export interface OfflinePosTotals {
  readonly subtotal: number;
  readonly total: number;
  readonly tipo?: string | null;
  readonly valor?: number | string | null;
  readonly descuento?: number;
}

export interface OfflinePosIntegrationDependencies {
  readonly client: SupabaseRpcClientLike;
  readonly getRuntime: () => OfflinePosRuntime | undefined;
  readonly getScope: () => OfflinePosScope;
  readonly ensureRequestId: () => string;
  readonly validatePayments: (payments: readonly LegacyPosPaymentInput[]) => void;
  readonly validateLocalStock: (items: readonly LegacyPosSaleItemInput[]) => void;
  readonly applySaleToLocalStock: (items: readonly LegacyPosSaleItemInput[]) => void;
  readonly applySaleToLocalCash: (
    payments: readonly LegacyPosPaymentInput[],
    total: number
  ) => void;
  readonly buildTicket: (sale: LegacyTicketSaleShape) => Record<string, unknown>;
  readonly reloadProducts: () => Promise<void>;
  readonly reloadCash: () => Promise<void>;
  readonly showToast: (message: string, type: string) => void;
  readonly notifyChanged: (detail: unknown) => void;
  readonly warn: (message: string, error: unknown) => void;
  readonly isOnline: () => boolean;
  readonly getLocationSearch: () => string;
}

export interface OfflinePosIntegration {
  readonly enabled: () => boolean;
  readonly listSales: () => Promise<readonly OfflineSale[]>;
  readonly registerSale: (
    items: readonly LegacyPosSaleItemInput[],
    payments: readonly LegacyPosPaymentInput[],
    totals: OfflinePosTotals,
    observation: string
  ) => Promise<Record<string, unknown>>;
  readonly sync: (options?: OfflineCompatSyncOptions) => Promise<OfflineSyncSummary>;
}

const EMPTY_SYNC_SUMMARY: OfflineSyncSummary = {
  attempted: 0,
  synced: 0,
  retryable: 0,
  review: 0,
  recovered: 0
};

function queueScope(scope: OfflinePosScope): OfflineQueueScope | null {
  const userId = scope.userId?.trim() ?? "";
  const businessId = scope.businessId?.trim() ?? "";
  const branchId = scope.branchId?.trim() ?? "";
  if (!userId || !businessId || !branchId) return null;
  return { userId, businessId, branchId };
}

export function createOfflinePosIntegration(
  dependencies: OfflinePosIntegrationDependencies
): OfflinePosIntegration {
  function runtime(): OfflinePosRuntime | undefined {
    return dependencies.getRuntime();
  }

  function enabled(): boolean {
    return runtime()?.enabled === true;
  }

  function syncAllowed(): boolean {
    const fallback = `https://${VENDIFY_PRODUCTION_SUPABASE_REF}.supabase.co`;
    return resolveOfflineSyncSafety(
      dependencies.client.supabaseUrl ?? fallback,
      dependencies.getLocationSearch()
    ).allowed;
  }

  async function listSales(): Promise<readonly OfflineSale[]> {
    const activeRuntime = runtime();
    const scope = queueScope(dependencies.getScope());
    if (!activeRuntime?.enabled || !scope) return [];
    await activeRuntime.ready;
    return activeRuntime.listSales(scope);
  }

  async function renewLease(): Promise<void> {
    const activeRuntime = runtime();
    const sourceScope = dependencies.getScope();
    const scope = queueScope(sourceScope);
    const cashRegisterId = sourceScope.cashRegisterId?.trim() ?? "";
    if (
      !activeRuntime?.enabled || !dependencies.isOnline() || !syncAllowed() ||
      !scope || !cashRegisterId
    ) return;
    await activeRuntime.ready;
    await activeRuntime.acquireLease(dependencies.client, { ...scope, cashRegisterId });
  }

  async function registerSale(
    items: readonly LegacyPosSaleItemInput[],
    payments: readonly LegacyPosPaymentInput[],
    totals: OfflinePosTotals,
    observation: string
  ): Promise<Record<string, unknown>> {
    const activeRuntime = runtime();
    if (!activeRuntime?.enabled) throw new Error("El motor offline v2.31.2 no está activo.");
    const sourceScope = dependencies.getScope();
    const scope = queueScope(sourceScope);
    const cashRegisterId = sourceScope.cashRegisterId?.trim() ?? "";
    if (!scope || !cashRegisterId) {
      throw new Error("No se pudo determinar el contexto para la venta offline.");
    }
    if ((totals.tipo ?? "").trim() || Number(totals.valor ?? totals.descuento ?? 0) !== 0) {
      throw new Error("Los descuentos requieren conexión para validar la autorización.");
    }

    dependencies.validatePayments(payments);
    dependencies.validateLocalStock(items);
    await activeRuntime.ready;
    const sale = await activeRuntime.enqueueLegacySale({
      requestId: dependencies.ensureRequestId(),
      businessId: scope.businessId,
      branchId: scope.branchId,
      cashRegisterId,
      userId: scope.userId,
      items,
      payments,
      subtotal: totals.subtotal,
      total: totals.total,
      observation
    });
    try {
      dependencies.applySaleToLocalStock(items);
      dependencies.applySaleToLocalCash(payments, totals.total);
    } catch (error) {
      dependencies.warn("La venta offline quedó guardada, pero el espejo local requiere recarga.", error);
    }
    dependencies.notifyChanged({ requestId: sale.requestId, status: sale.status });
    return dependencies.buildTicket(offlineSaleToLegacyTicketShape(sale));
  }

  async function sync(
    options: OfflineCompatSyncOptions = {}
  ): Promise<OfflineSyncSummary> {
    const activeRuntime = runtime();
    const scope = queueScope(dependencies.getScope());
    if (!activeRuntime?.enabled || !dependencies.isOnline() || !scope) {
      return EMPTY_SYNC_SUMMARY;
    }
    if (!syncAllowed()) {
      if (options.mostrarResumen) {
        dependencies.showToast(
          "Staging seguro: la sincronización offline hacia producción está bloqueada.",
          "warning"
        );
      }
      return EMPTY_SYNC_SUMMARY;
    }

    await activeRuntime.ready;
    const summary = await activeRuntime.syncNow(dependencies.client, scope, {
      includeReview: options.incluirRevision === true,
      recoverInterrupted: true,
      limit: 50
    });
    if (summary.synced > 0) {
      try {
        await dependencies.reloadProducts();
        await dependencies.reloadCash();
      } catch (error) {
        dependencies.warn("La venta offline se sincronizó, pero la reconciliación visual quedó pendiente.", error);
      }
    }
    if (options.mostrarResumen) {
      if (summary.review > 0) {
        dependencies.showToast("Hay una venta offline que requiere revisión.", "warning");
      } else if (summary.retryable > 0) {
        dependencies.showToast("La sincronización se reintentará automáticamente.", "warning");
      } else if (summary.synced > 0) {
        dependencies.showToast(
          `${String(summary.synced)} venta${summary.synced === 1 ? "" : "s"} offline sincronizada${summary.synced === 1 ? "" : "s"}.`,
          "success"
        );
      }
    }
    dependencies.notifyChanged(summary);
    try {
      await renewLease();
    } catch (error) {
      dependencies.warn("La sincronización terminó, pero la autorización offline no pudo renovarse.", error);
    }
    return summary;
  }

  return { enabled, listSales, registerSale, sync };
}
