import type { LegacyPosPaymentInput, LegacyPosSaleItemInput } from "./legacy-adapter.js";
import { offlineSaleToLegacyTicketShape } from "./legacy-adapter.js";
import type { SupabaseRpcClientLike } from "./supabase-transport.js";
import type { OfflineSyncSummary } from "./sync-engine.js";
import {
  VENDIFY_PRODUCTION_SUPABASE_REF,
  resolveOfflineSyncSafety
} from "./sync-safety.js";

interface LegacyTotals {
  readonly subtotal: number;
  readonly total: number;
  readonly tipo?: string | null;
  readonly valor?: number | string | null;
}

interface LegacyAppContext {
  readonly business?: { readonly id?: string | null } | null;
  readonly branch?: { readonly id?: string | null } | null;
  readonly cashRegister?: { readonly id?: string | null } | null;
}

interface LegacySession {
  readonly user?: { readonly id?: string | null } | null;
}

interface LegacySyncOptions {
  readonly mostrarResumen?: boolean;
  readonly incluirRevision?: boolean;
}

declare const sesionActual: LegacySession | null;
declare const supabaseClient: SupabaseRpcClientLike;
declare function asegurarVentaRequestIdV23011(): string;
declare function validarPagosOfflineV2311(pagos: readonly LegacyPosPaymentInput[]): void;
declare function validarStockLocalVentaV2311(items: readonly LegacyPosSaleItemInput[]): void;
declare function aplicarVentaAlStockLocalV2311(items: readonly LegacyPosSaleItemInput[]): void;
declare function aplicarVentaCajaLocalV2311(
  pagos: readonly LegacyPosPaymentInput[],
  total: number
): void;
declare function construirTicketOfflineV2311(sale: unknown): unknown;
declare function actualizarUIVentasOfflineV2311(): void;
declare function mostrarToast(message: string, type?: string): void;
declare function cargarProductos(): Promise<void>;

declare global {
  interface Window {
    appContext?: LegacyAppContext;
    registrarVentaOfflineIndexedDbV2312?: (
      items: readonly LegacyPosSaleItemInput[],
      pagos: readonly LegacyPosPaymentInput[],
      totales: LegacyTotals,
      observacion: string
    ) => Promise<unknown>;
    sincronizarVentasOfflineIndexedDbV2312?: (
      options?: LegacySyncOptions
    ) => Promise<OfflineSyncSummary>;
  }
}

const EMPTY_SYNC_SUMMARY: OfflineSyncSummary = {
  attempted: 0,
  synced: 0,
  retryable: 0,
  review: 0,
  recovered: 0
};

function requiredScopeId(value: string | null | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`No se pudo determinar ${label} para la venta offline.`);
  return normalized;
}

function runtimeEnabled(): boolean {
  return window.VendifyOfflineV2312?.enabled === true;
}

function currentSyncSafety() {
  const fallbackProductionUrl = `https://${VENDIFY_PRODUCTION_SUPABASE_REF}.supabase.co`;
  return resolveOfflineSyncSafety(
    supabaseClient.supabaseUrl ?? fallbackProductionUrl,
    window.location.search
  );
}

async function registrarVentaOfflineIndexedDbV2312(
  items: readonly LegacyPosSaleItemInput[],
  pagos: readonly LegacyPosPaymentInput[],
  totales: LegacyTotals,
  observacion: string
): Promise<unknown> {
  const runtime = window.VendifyOfflineV2312;
  if (!runtime?.enabled) {
    throw new Error("El motor offline v2.31.2 no está activo.");
  }

  await runtime.ready;

  if ((totales.tipo ?? "").trim() || Number(totales.valor ?? 0) !== 0) {
    throw new Error("Los descuentos requieren conexión para validar la autorización.");
  }

  validarPagosOfflineV2311(pagos);
  validarStockLocalVentaV2311(items);

  const context = window.appContext;
  const requestId = asegurarVentaRequestIdV23011();
  const sale = await runtime.enqueueLegacySale({
    requestId,
    businessId: requiredScopeId(context?.business?.id, "el negocio"),
    branchId: requiredScopeId(context?.branch?.id, "la sucursal"),
    cashRegisterId: requiredScopeId(context?.cashRegister?.id, "la caja"),
    userId: requiredScopeId(sesionActual?.user?.id, "el usuario"),
    items,
    payments: pagos,
    subtotal: totales.subtotal,
    total: totales.total,
    observation: observacion
  });

  try {
    aplicarVentaAlStockLocalV2311(items);
    aplicarVentaCajaLocalV2311(pagos, totales.total);
  } catch (error) {
    console.error("[Vendify v2.31.2] local POS mirror update failed", error);
  }

  try {
    actualizarUIVentasOfflineV2311();
  } catch {
    // Legacy counter does not own the v2.31.2 queue.
  }

  window.dispatchEvent(
    new CustomEvent("vendify:offline-v2312-changed", {
      detail: { requestId: sale.requestId, status: sale.status }
    })
  );

  return construirTicketOfflineV2311(offlineSaleToLegacyTicketShape(sale));
}

let syncInFlight: Promise<OfflineSyncSummary> | null = null;

async function runIndexedDbSync(
  options: LegacySyncOptions = {}
): Promise<OfflineSyncSummary> {
  const runtime = window.VendifyOfflineV2312;
  if (!runtime?.enabled || !navigator.onLine) {
    return EMPTY_SYNC_SUMMARY;
  }

  const safety = currentSyncSafety();
  if (!safety.allowed) {
    if (options.mostrarResumen) {
      mostrarToast(
        "Staging seguro: la sincronización offline hacia producción está bloqueada.",
        "warning"
      );
    }
    console.warn(
      "[Vendify v2.31.2] offline sync blocked because staging is using the production Supabase backend"
    );
    return EMPTY_SYNC_SUMMARY;
  }

  if (syncInFlight) return syncInFlight;

  const run = runtime
    .syncNow(supabaseClient, {
      includeReview: options.incluirRevision === true,
      recoverInterrupted: true,
      limit: 50
    })
    .then(async (summary) => {
      if (summary.synced > 0) {
        try {
          await cargarProductos();
        } catch (error) {
          console.warn("[Vendify v2.31.2] product reconciliation deferred", error);
        }
      }

      if (options.mostrarResumen) {
        if (summary.review > 0) {
          mostrarToast("Hay una venta offline que requiere revisión.", "warning");
        } else if (summary.retryable > 0) {
          mostrarToast("La sincronización se reintentará automáticamente.", "warning");
        } else if (summary.synced > 0) {
          const syncedCount = String(summary.synced);
          mostrarToast(
            `${syncedCount} venta${summary.synced === 1 ? "" : "s"} offline sincronizada${summary.synced === 1 ? "" : "s"}.`,
            "success"
          );
        }
      }

      window.dispatchEvent(
        new CustomEvent("vendify:offline-v2312-changed", { detail: summary })
      );

      return summary;
    });

  syncInFlight = run.finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

window.registrarVentaOfflineIndexedDbV2312 = registrarVentaOfflineIndexedDbV2312;
window.sincronizarVentasOfflineIndexedDbV2312 = runIndexedDbSync;

function scheduleSync(showSummary: boolean): void {
  if (!runtimeEnabled() || !navigator.onLine) return;
  void runIndexedDbSync({ mostrarResumen: showSummary }).catch((error: unknown) => {
    console.error("[Vendify v2.31.2] automatic sync failed", error);
  });
}

window.addEventListener("online", () => {
  scheduleSync(true);
});

window.addEventListener("focus", () => {
  scheduleSync(false);
});

window.setTimeout(() => {
  scheduleSync(false);
}, 800);

const startupSafety = currentSyncSafety();
console.info(
  `[Vendify v2.31.2] legacy POS bridge ${runtimeEnabled() ? "active" : "standby"}; sync ${startupSafety.allowed ? "enabled" : "blocked for production backend"}`
);
