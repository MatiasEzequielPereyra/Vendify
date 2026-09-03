import type { LegacyPosPaymentInput, LegacyPosSaleItemInput } from "./legacy-adapter.js";
import {
  buildLegacyOfflineTicket,
  createLegacyOfflineSale,
  isLegacyOfflineNetworkError,
  parseLegacyOfflineQueue,
  summarizeLegacyOfflineQueue,
  validateLegacyOfflinePayments,
  type LegacyOfflineSale,
  type LegacyOfflineTotals
} from "./legacy-fallback.js";
import type { OfflineSyncSummary } from "./sync-engine.js";

const OFFLINE_SALES_PREFIX = "vendify_offline_sales_v2311";
const CASH_PROOF_PREFIX = "vendify_cash_proof_v2311";
const MAX_OFFLINE_SALES = 200;
const CASH_PROOF_MAX_MS = 18 * 60 * 60 * 1000;

interface OfflineContext {
  readonly ready: boolean;
  readonly userId: string | null;
  readonly businessId: string | null;
  readonly branchId: string | null;
  readonly cashRegisterId: string | null;
}

interface OfflineProduct {
  readonly id: string;
  readonly nombre: string;
  stock: number;
}

interface OfflineCashSession {
  ventas_total?: number;
  ventas_efectivo?: number;
  efectivo_esperado?: number;
  tickets?: number;
  readonly [key: string]: unknown;
}

interface OfflineCashState {
  readonly sesion?: OfflineCashSession | null;
  readonly es_mia?: boolean;
  readonly [key: string]: unknown;
}

interface OfflineRpcError { readonly message?: string; }
interface OfflineRpcResult { readonly data: unknown; readonly error: OfflineRpcError | null; }
interface OfflineRpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<OfflineRpcResult>;
}

export interface OfflineCompatSyncOptions {
  readonly mostrarResumen?: boolean;
  readonly incluirRevision?: boolean;
}

export interface LegacyOfflineSyncSummary {
  readonly synced: number;
  readonly revision: number;
  readonly pending: number;
}

export interface OfflineCompatDependencies {
  readonly client: OfflineRpcClient;
  readonly storage: Storage;
  readonly getContext: () => OfflineContext;
  readonly getProducts: () => OfflineProduct[];
  readonly getCartSize: () => number;
  readonly isSaleConfirming: () => boolean;
  readonly hasSellPermission: () => boolean;
  readonly isCashOpenByCurrentUser: () => boolean;
  readonly getCashState: () => OfflineCashState | null;
  readonly setCashState: (state: OfflineCashState) => void;
  readonly ensureRequestId: () => string;
  readonly clearPersistedCart: () => void;
  readonly persistProducts: () => void;
  readonly persistCart: () => void;
  readonly renderProducts: () => void;
  readonly renderSaleProducts: () => void;
  readonly renderCashHeader: () => void;
  readonly renderCart: () => void;
  readonly reloadProducts: () => Promise<void>;
  readonly reloadCash: () => Promise<void>;
  readonly reloadCommercialFoundation: () => Promise<void>;
  readonly setConnectionState: (state: string, label?: string) => void;
  readonly showToast: (message: string, type: string) => void;
  readonly now?: () => number;
  readonly isOnline?: () => boolean;
}

export interface OfflineCompatController {
  readonly setup: () => void;
  readonly readLegacySales: () => LegacyOfflineSale[];
  readonly persistCashProof: () => void;
  readonly restoreCashProof: () => boolean;
  readonly canChargeOffline: () => boolean;
  readonly updateUi: () => void;
  readonly applySaleState: () => void;
  readonly validatePayments: (payments: readonly LegacyPosPaymentInput[]) => void;
  readonly validateLocalStock: (items: readonly LegacyPosSaleItemInput[]) => void;
  readonly applySaleToLocalStock: (items: readonly LegacyPosSaleItemInput[]) => void;
  readonly applySaleToLocalCash: (
    payments: readonly LegacyPosPaymentInput[],
    total: number
  ) => void;
  readonly buildTicket: (sale: unknown) => Record<string, unknown>;
  readonly registerLegacySale: (
    items: readonly LegacyPosSaleItemInput[],
    payments: readonly LegacyPosPaymentInput[],
    totals: LegacyOfflineTotals,
    observation: string
  ) => Record<string, unknown>;
  readonly registerSale: (
    items: readonly LegacyPosSaleItemInput[],
    payments: readonly LegacyPosPaymentInput[],
    totals: LegacyOfflineTotals,
    observation: string
  ) => Promise<unknown>;
  readonly sync: (
    options?: OfflineCompatSyncOptions
  ) => Promise<LegacyOfflineSyncSummary | OfflineSyncSummary>;
}

function element(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector);
}

function button(selector: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(selector);
}

function countText(value: number): string {
  return String(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Error de red";
}

export function createOfflineCompatController(
  dependencies: OfflineCompatDependencies
): OfflineCompatController {
  const now = dependencies.now ?? Date.now;
  const isOnline = dependencies.isOnline ?? (() => navigator.onLine);
  let syncPromise: Promise<LegacyOfflineSyncSummary> | null = null;
  let setupComplete = false;

  function salesKey(): string {
    const context = dependencies.getContext();
    return `${OFFLINE_SALES_PREFIX}:${context.userId ?? "anon"}:${context.businessId ?? "none"}`;
  }

  function cashProofKey(): string {
    const context = dependencies.getContext();
    return [
      CASH_PROOF_PREFIX,
      context.userId ?? "anon",
      context.businessId ?? "none",
      context.branchId ?? "none",
      context.cashRegisterId ?? "none"
    ].join(":");
  }

  function readLegacySales(): LegacyOfflineSale[] {
    try {
      return parseLegacyOfflineQueue(dependencies.storage.getItem(salesKey()));
    } catch {
      return [];
    }
  }

  function saveLegacySales(queue: readonly LegacyOfflineSale[]): boolean {
    try {
      dependencies.storage.setItem(salesKey(), JSON.stringify(queue));
      return true;
    } catch (error) {
      console.error("[Offline sales] storage:", error);
      return false;
    }
  }

  function persistCashProof(): void {
    const context = dependencies.getContext();
    const state = dependencies.getCashState();
    if (
      !dependencies.isCashOpenByCurrentUser() ||
      !context.userId || !context.businessId || !context.branchId || !context.cashRegisterId
    ) return;

    try {
      dependencies.storage.setItem(cashProofKey(), JSON.stringify({
        savedAt: new Date(now()).toISOString(),
        userId: context.userId,
        businessId: context.businessId,
        branchId: context.branchId,
        cashId: context.cashRegisterId,
        estado: state
      }));
    } catch {
      // Offline proof is opportunistic and must never interrupt an online sale.
    }
  }

  function restoreCashProof(): boolean {
    const context = dependencies.getContext();
    if (!context.userId || !context.businessId || !context.branchId || !context.cashRegisterId) {
      return false;
    }

    try {
      const raw = dependencies.storage.getItem(cashProofKey());
      if (!raw) return false;
      const proof = JSON.parse(raw) as {
        readonly savedAt?: string;
        readonly userId?: string;
        readonly businessId?: string;
        readonly branchId?: string;
        readonly cashId?: string;
        readonly estado?: OfflineCashState;
      };
      const savedAt = new Date(proof.savedAt ?? 0).getTime();
      const valid =
        proof.userId === context.userId &&
        proof.businessId === context.businessId &&
        proof.branchId === context.branchId &&
        proof.cashId === context.cashRegisterId &&
        Boolean(proof.estado?.sesion) &&
        proof.estado?.es_mia === true &&
        Number.isFinite(savedAt) &&
        now() - savedAt <= CASH_PROOF_MAX_MS;
      if (!valid) return false;
      dependencies.setCashState(proof.estado);
      return true;
    } catch {
      return false;
    }
  }

  function cashEnabledOffline(): boolean {
    return dependencies.isCashOpenByCurrentUser() || restoreCashProof();
  }

  function canChargeOffline(): boolean {
    const context = dependencies.getContext();
    if (isOnline() || !context.ready || !dependencies.hasSellPermission()) return false;
    if (!context.branchId || !context.cashRegisterId || !cashEnabledOffline()) return false;
    return readLegacySales().length < MAX_OFFLINE_SALES;
  }

  function updateUi(): void {
    const state = summarizeLegacyOfflineQueue(readLegacySales());
    const globalBanner = element("#offline-sync-banner-v2311");
    const globalText = element("#offline-sync-text-v2311");
    const retry = button("#btn-sync-offline-sales-v2311");
    const saleBanner = element("#offline-sale-banner-v2311");
    const saleMessage = element("#offline-sale-message-v2311");
    const connection = element("#connection-status-v23011");
    globalBanner?.classList.toggle("hidden", state.total === 0);

    if (globalText && state.total > 0) {
      if (state.revision > 0) {
        globalText.textContent = `${countText(state.total)} venta${state.total === 1 ? "" : "s"} pendiente${state.total === 1 ? "" : "s"} · ${countText(state.revision)} requiere${state.revision === 1 ? "" : "n"} revisión`;
      } else if (isOnline()) {
        globalText.textContent = `${countText(state.total)} venta${state.total === 1 ? "" : "s"} esperando sincronización`;
      } else {
        globalText.textContent = `${countText(state.total)} venta${state.total === 1 ? "" : "s"} guardada${state.total === 1 ? "" : "s"} sin conexión`;
      }
    }

    if (retry) {
      retry.disabled = !isOnline();
      retry.textContent = isOnline() ? "Sincronizar" : "Esperando internet";
    }
    if (connection) {
      connection.dataset.pendingOffline = String(state.total);
      connection.classList.toggle("has-offline-sales-v2311", state.total > 0);
    }

    const offline = !isOnline();
    saleBanner?.classList.toggle("hidden", !offline);
    if (saleMessage && offline) {
      saleMessage.textContent = canChargeOffline()
        ? state.total > 0
          ? `Podés seguir vendiendo. Hay ${countText(state.total)} venta${state.total === 1 ? "" : "s"} pendiente${state.total === 1 ? "" : "s"} de sincronización.`
          : "Podés cobrar en Efectivo o Transferencia. La venta se sincronizará automáticamente al volver internet."
        : "Para vender sin conexión, esta caja debe haber sido abierta y verificada previamente con internet.";
    }
  }

  function applySaleState(): void {
    const saleButton = button("#btn-cobrar");
    if (!saleButton) return;
    const offline = !isOnline();
    const enabled = canChargeOffline();
    saleButton.classList.toggle("offline-enabled-v2311", offline && enabled);
    saleButton.classList.toggle("offline-disabled-v231", offline && !enabled);
    if (offline) {
      saleButton.textContent = enabled ? "Cobrar offline" : "Cobro offline no disponible";
      saleButton.disabled =
        dependencies.getCartSize() === 0 || dependencies.isSaleConfirming() || !enabled;
      saleButton.title = enabled
        ? "La venta quedará pendiente de sincronización"
        : "La caja debe haber sido verificada abierta con internet";
    } else {
      saleButton.textContent = "Cobrar";
      saleButton.title = "";
      saleButton.disabled = dependencies.getCartSize() === 0 || dependencies.isSaleConfirming();
    }
    updateUi();
  }

  function validateLocalStock(items: readonly LegacyPosSaleItemInput[]): void {
    for (const item of items) {
      const product = dependencies.getProducts().find((candidate) => candidate.id === item.id);
      if (!product) throw new Error(`No se encontró "${item.nombre}" en el catálogo local.`);
      if (product.stock < item.cantidad) {
        throw new Error(`Stock local insuficiente de "${product.nombre}".`);
      }
    }
  }

  function applySaleToLocalStock(items: readonly LegacyPosSaleItemInput[]): void {
    for (const item of items) {
      const product = dependencies.getProducts().find((candidate) => candidate.id === item.id);
      if (product) {
        product.stock = Math.max(0, product.stock - item.cantidad);
      }
    }
    dependencies.persistProducts();
    dependencies.renderProducts();
    if (!element("#modal-venta")?.classList.contains("hidden")) {
      dependencies.renderSaleProducts();
    }
  }

  function applySaleToLocalCash(
    payments: readonly LegacyPosPaymentInput[],
    total: number
  ): void {
    const state = dependencies.getCashState();
    if (!state?.sesion || !state.es_mia) return;
    const cash = payments
      .filter((payment) => payment.medio_pago === "Efectivo")
      .reduce((sum, payment) => sum + payment.monto, 0);
    const session = state.sesion;
    session.ventas_total = (session.ventas_total ?? 0) + total;
    session.ventas_efectivo = (session.ventas_efectivo ?? 0) + cash;
    session.efectivo_esperado = (session.efectivo_esperado ?? 0) + cash;
    session.tickets = (session.tickets ?? 0) + 1;
    persistCashProof();
    dependencies.renderCashHeader();
  }

  function buildTicket(sale: unknown): Record<string, unknown> {
    return buildLegacyOfflineTicket(sale as LegacyOfflineSale);
  }

  function registerLegacySale(
    items: readonly LegacyPosSaleItemInput[],
    payments: readonly LegacyPosPaymentInput[],
    totals: LegacyOfflineTotals,
    observation: string
  ): Record<string, unknown> {
    const context = dependencies.getContext();
    if (!canChargeOffline()) throw new Error("La caja no está habilitada para ventas offline.");
    if ((totals.tipo ?? "").trim() || (totals.descuento ?? 0) > 0) {
      throw new Error("Los descuentos requieren conexión para validar la autorización.");
    }
    validateLegacyOfflinePayments(payments);
    validateLocalStock(items);
    const queue = readLegacySales();
    if (queue.length >= MAX_OFFLINE_SALES) {
      throw new Error(
        "Se alcanzó el máximo de ventas offline pendientes. Reconectá internet antes de continuar."
      );
    }
    if (!context.businessId || !context.branchId || !context.cashRegisterId) {
      throw new Error("No se pudo determinar el contexto para la venta offline.");
    }
    const sale = createLegacyOfflineSale({
      requestId: dependencies.ensureRequestId(),
      userId: context.userId,
      businessId: context.businessId,
      branchId: context.branchId,
      cashRegisterId: context.cashRegisterId,
      items,
      payments,
      totals,
      observation
    });
    if (!saveLegacySales([...queue, sale])) {
      throw new Error("No hay espacio suficiente para guardar la venta sin conexión.");
    }
    applySaleToLocalStock(items);
    applySaleToLocalCash(payments, totals.total);
    dependencies.clearPersistedCart();
    updateUi();
    return buildLegacyOfflineTicket(sale);
  }

  async function registerSale(
    items: readonly LegacyPosSaleItemInput[],
    payments: readonly LegacyPosPaymentInput[],
    totals: LegacyOfflineTotals,
    observation: string
  ): Promise<unknown> {
    if (
      window.VendifyOfflineV2312?.enabled &&
      typeof window.registrarVentaOfflineIndexedDbV2312 === "function"
    ) {
      return window.registrarVentaOfflineIndexedDbV2312(items, payments, totals, observation);
    }
    return registerLegacySale(items, payments, totals, observation);
  }

  async function syncLegacy(
    options: OfflineCompatSyncOptions = {}
  ): Promise<LegacyOfflineSyncSummary> {
    if (!isOnline()) {
      updateUi();
      return { synced: 0, revision: 0, pending: readLegacySales().length };
    }
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      const queue = readLegacySales();
      let synced = 0;
      let stoppedByNetwork = false;
      for (let index = 0; index < queue.length;) {
        const sale = queue[index];
        if (!sale) break;
        if (sale.status === "revision" && options.incluirRevision !== true) {
          index += 1;
          continue;
        }
        let response: OfflineRpcResult;
        try {
          response = await dependencies.client.rpc("registrar_venta_v4", {
            p_items: sale.items.map((item) => ({
              producto_id: item.producto_id,
              cantidad: item.cantidad
            })),
            p_pagos: sale.pagos,
            p_descuento_tipo: null,
            p_descuento_valor: 0,
            p_observacion: sale.observacion,
            p_sucursal_id: sale.sucursal_id,
            p_caja_id: sale.caja_id,
            p_request_id: sale.request_id
          });
        } catch (error) {
          response = { data: null, error: { message: errorText(error) } };
        }
        if (response.error) {
          if (isLegacyOfflineNetworkError(response.error, isOnline())) {
            stoppedByNetwork = true;
            break;
          }
          sale.attempts += 1;
          sale.last_error = response.error.message ?? "La venta necesita revisión.";
          sale.status = "revision";
          queue[index] = sale;
          saveLegacySales(queue);
          index += 1;
          continue;
        }
        queue.splice(index, 1);
        saveLegacySales(queue);
        synced += 1;
      }
      updateUi();
      if (synced > 0) {
        try {
          await dependencies.reloadProducts();
          dependencies.renderProducts();
          await dependencies.reloadCash();
        } catch (error) {
          console.warn("[Offline sales] sincronizada, refresh pendiente:", error);
        }
      }
      const remaining = readLegacySales();
      const reviewSales = remaining.filter((sale) => sale.status === "revision");
      if (options.mostrarResumen) {
        if (synced > 0 && reviewSales.length === 0) {
          dependencies.showToast(
            `${countText(synced)} venta${synced === 1 ? "" : "s"} offline sincronizada${synced === 1 ? "" : "s"}`,
            "success"
          );
        } else if (reviewSales.length > 0) {
          const firstError = reviewSales[0]?.last_error ?? "Revisá stock y estado de caja.";
          dependencies.showToast(
            `${countText(reviewSales.length)} venta${reviewSales.length === 1 ? "" : "s"} requiere${reviewSales.length === 1 ? "" : "n"} revisión: ${firstError}`,
            "error"
          );
        } else if (stoppedByNetwork && remaining.length > 0) {
          dependencies.showToast(
            "La conexión volvió a cortarse. Las ventas siguen guardadas.",
            "info"
          );
        }
      }
      return { synced, revision: reviewSales.length, pending: remaining.length };
    })().finally(() => {
      syncPromise = null;
    });
    return syncPromise;
  }

  async function sync(
    options: OfflineCompatSyncOptions = {}
  ): Promise<LegacyOfflineSyncSummary | OfflineSyncSummary> {
    if (
      window.VendifyOfflineV2312?.enabled &&
      typeof window.sincronizarVentasOfflineIndexedDbV2312 === "function"
    ) {
      return window.sincronizarVentasOfflineIndexedDbV2312(options);
    }
    return syncLegacy(options);
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    button("#btn-sync-offline-sales-v2311")
      ?.addEventListener("click", () => void sync({
        mostrarResumen: true,
        incluirRevision: true
      }));
    updateUi();
    if (isOnline() && readLegacySales().length > 0) {
      window.setTimeout(() => void sync({ mostrarResumen: true }), 800);
    }
    window.addEventListener("offline", () => {
      dependencies.persistCart();
      persistCashProof();
      applySaleState();
      updateUi();
    });
    window.addEventListener("online", () => {
      void (async () => {
        dependencies.setConnectionState("syncing", "Sincronizando");
        await sync({ mostrarResumen: true });
        applySaleState();
        await dependencies.reloadCommercialFoundation();
        try { await dependencies.reloadCash(); } catch { /* Keep recovered local state. */ }
        dependencies.renderCart();
        updateUi();
        if (isOnline()) dependencies.setConnectionState("online");
      })();
    });
    window.addEventListener("focus", () => {
      if (isOnline() && (
        readLegacySales().length > 0 || window.VendifyOfflineV2312?.enabled === true
      )) void sync({ mostrarResumen: false });
    });
  }

  return {
    setup,
    readLegacySales,
    persistCashProof,
    restoreCashProof,
    canChargeOffline,
    updateUi,
    applySaleState,
    validatePayments: validateLegacyOfflinePayments,
    validateLocalStock,
    applySaleToLocalStock,
    applySaleToLocalCash,
    buildTicket,
    registerLegacySale,
    registerSale,
    sync
  };
}
