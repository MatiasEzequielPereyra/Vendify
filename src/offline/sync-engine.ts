import type { OfflineSale } from "../types/offline.js";
import type { RequestId } from "../types/ids.js";
import { classifyOfflineSyncError } from "./sync-error.js";

export interface OfflineTransitionOptions {
  readonly lastError?: string;
  readonly incrementAttempts?: boolean;
  readonly clearLastError?: boolean;
}

export interface OfflineQueueStore {
  listSales(): Promise<readonly OfflineSale[]>;
  getSale(requestId: RequestId): Promise<OfflineSale | null>;
  transitionSale(
    requestId: RequestId,
    nextStatus: OfflineSale["status"],
    options?: OfflineTransitionOptions
  ): Promise<OfflineSale>;
}

export interface OfflineQueueScope {
  readonly businessId: string;
  readonly branchId: string;
  readonly userId: string;
}

export type OfflineTransportResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown };

export interface OfflineSaleTransport {
  send(sale: OfflineSale): Promise<OfflineTransportResult>;
}

export interface OfflineSyncSummary {
  readonly attempted: number;
  readonly synced: number;
  readonly retryable: number;
  readonly review: number;
  readonly recovered: number;
  readonly blockedRequestId?: RequestId;
}

export interface OfflineSyncOptions {
  readonly includeReview?: boolean;
  readonly limit?: number;
  readonly recoverInterrupted?: boolean;
}

function saleMatchesScope(sale: OfflineSale, scope: OfflineQueueScope): boolean {
  return sale.businessId === scope.businessId
    && sale.branchId === scope.branchId
    && sale.userId === scope.userId;
}

export function createScopedOfflineQueueStore(
  store: OfflineQueueStore,
  scope: OfflineQueueScope
): OfflineQueueStore {
  return {
    async listSales() {
      return (await store.listSales()).filter((sale) => saleMatchesScope(sale, scope));
    },
    async getSale(requestId) {
      const sale = await store.getSale(requestId);
      return sale !== null && saleMatchesScope(sale, scope) ? sale : null;
    },
    async transitionSale(requestId, nextStatus, options) {
      const sale = await store.getSale(requestId);
      if (sale === null || !saleMatchesScope(sale, scope)) {
        throw new Error(`Offline sale is outside the active scope: ${requestId}`);
      }
      return store.transitionSale(requestId, nextStatus, options);
    }
  };
}

function compareSalesFifo(a: OfflineSale, b: OfflineSale): number {
  const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  return String(a.requestId).localeCompare(String(b.requestId));
}

function isSyncCandidate(sale: OfflineSale, includeReview: boolean): boolean {
  return (
    sale.status === "pending" ||
    sale.status === "failed_retryable" ||
    (includeReview && sale.status === "review")
  );
}

export async function recoverInterruptedOfflineSales(
  store: OfflineQueueStore
): Promise<number> {
  const sales = [...(await store.listSales())]
    .filter((sale) => sale.status === "syncing")
    .sort(compareSalesFifo);

  for (const sale of sales) {
    await store.transitionSale(sale.requestId, "failed_retryable", {
      lastError:
        "La sincronización anterior se interrumpió. Se reintentará de forma segura usando el mismo request_id."
    });
  }

  return sales.length;
}

export async function syncOfflineQueue(
  store: OfflineQueueStore,
  transport: OfflineSaleTransport,
  options: OfflineSyncOptions = {}
): Promise<OfflineSyncSummary> {
  const includeReview = options.includeReview === true;
  const recoverInterrupted = options.recoverInterrupted !== false;
  const limit = Math.max(1, Math.floor(options.limit ?? 50));

  const recovered = recoverInterrupted
    ? await recoverInterruptedOfflineSales(store)
    : 0;

  const candidates = [...(await store.listSales())]
    .filter((sale) => isSyncCandidate(sale, includeReview))
    .sort(compareSalesFifo)
    .slice(0, limit);

  let attempted = 0;
  let synced = 0;
  let retryable = 0;
  let review = 0;
  let blockedRequestId: RequestId | undefined;

  for (const candidate of candidates) {
    const syncing = await store.transitionSale(candidate.requestId, "syncing", {
      incrementAttempts: true,
      clearLastError: true
    });

    attempted += 1;

    let result: OfflineTransportResult;
    try {
      result = await transport.send(syncing);
    } catch (error) {
      result = { ok: false, error };
    }

    if (result.ok) {
      await store.transitionSale(syncing.requestId, "synced", {
        clearLastError: true
      });
      synced += 1;
      continue;
    }

    const classification = classifyOfflineSyncError(result.error);
    blockedRequestId = syncing.requestId;

    if (classification.kind === "retryable") {
      await store.transitionSale(syncing.requestId, "failed_retryable", {
        lastError: classification.message
      });
      retryable += 1;
    } else {
      await store.transitionSale(syncing.requestId, "review", {
        lastError: classification.message
      });
      review += 1;
    }

    // Strict FIFO: a failed earlier sale blocks later sales until it is
    // retried or reviewed, preserving stock/order semantics.
    break;
  }

  return {
    attempted,
    synced,
    retryable,
    review,
    recovered,
    ...(blockedRequestId === undefined ? {} : { blockedRequestId })
  };
}

export class OfflineQueueSynchronizer {
  private inFlight: Promise<OfflineSyncSummary> | null = null;

  constructor(
    private readonly store: OfflineQueueStore,
    private readonly transport: OfflineSaleTransport
  ) {}

  run(options: OfflineSyncOptions = {}): Promise<OfflineSyncSummary> {
    if (this.inFlight) return this.inFlight;

    const runPromise = syncOfflineQueue(this.store, this.transport, options);
    this.inFlight = runPromise.finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }
}
