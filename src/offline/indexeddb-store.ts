import type { OfflineLease, OfflineSale, StockSnapshot } from "../types/offline.js";
import type { ProductId, RequestId } from "../types/ids.js";
import { assertOfflineSaleTransition } from "./state-machine.js";
import {
  assertSaleCanReserveStock,
  assertSameOfflineRequest,
  validateOfflineSale
} from "./queue-policy.js";
import { assertOfflineLeaseAllowsSale, leaseScopeKey } from "./offline-lease.js";

const DB_NAME = "vendify-offline-v2312";
const DB_VERSION = 2;
const SALES_STORE = "offline_sales";
const STOCK_STORE = "stock_snapshots";
const LEASES_STORE = "offline_leases";

interface StoredOfflineLease extends OfflineLease {
  readonly scopeKey: string;
}

interface StoredStockSnapshot extends StockSnapshot {
  readonly businessId: string;
  readonly branchId: string;
  readonly updatedAt: string;
  readonly key: string;
}

interface TransitionOptions {
  readonly lastError?: string;
  readonly incrementAttempts?: boolean;
  readonly clearLastError?: boolean;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed"));
    };
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    };
  });
}

function snapshotKey(businessId: string, branchId: string, productId: ProductId): string {
  return `${businessId}:${branchId}:${productId}`;
}

function clearSaleLastError(sale: OfflineSale): OfflineSale {
  const clone = { ...sale };
  delete clone.lastError;
  return clone;
}

export class VendifyOfflineDb {
  private readonly db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(indexedDBFactory: IDBFactory = indexedDB): Promise<VendifyOfflineDb> {
    const request = indexedDBFactory.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SALES_STORE)) {
        const sales = db.createObjectStore(SALES_STORE, { keyPath: "requestId" });
        sales.createIndex("status", "status", { unique: false });
        sales.createIndex("branch", ["businessId", "branchId"], { unique: false });
        sales.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STOCK_STORE)) {
        const stock = db.createObjectStore(STOCK_STORE, { keyPath: "key" });
        stock.createIndex("branch", ["businessId", "branchId"], { unique: false });
      }

      if (!db.objectStoreNames.contains(LEASES_STORE)) {
        const leases = db.createObjectStore(LEASES_STORE, { keyPath: "scopeKey" });
        leases.createIndex("leaseId", "leaseId", { unique: true });
        leases.createIndex("expiresAt", "expiresAt", { unique: false });
      }
    };

    const db = await requestToPromise(request);
    return new VendifyOfflineDb(db);
  }

  close(): void {
    this.db.close();
  }

  async replaceStockSnapshot(
    businessId: string,
    branchId: string,
    snapshots: readonly StockSnapshot[],
    updatedAt = new Date().toISOString()
  ): Promise<void> {
    const transaction = this.db.transaction(STOCK_STORE, "readwrite");
    const store = transaction.objectStore(STOCK_STORE);
    const branchIndex = store.index("branch");
    const existingKeys = await requestToPromise(branchIndex.getAllKeys([businessId, branchId]));

    for (const key of existingKeys) {
      store.delete(key);
    }

    for (const snapshot of snapshots) {
      const record: StoredStockSnapshot = {
        ...snapshot,
        businessId,
        branchId,
        updatedAt,
        key: snapshotKey(businessId, branchId, snapshot.productId)
      };
      store.put(record);
    }

    await transactionDone(transaction);
  }

  async listSales(): Promise<readonly OfflineSale[]> {
    const transaction = this.db.transaction(SALES_STORE, "readonly");
    const sales = await requestToPromise(transaction.objectStore(SALES_STORE).getAll());
    await transactionDone(transaction);
    return sales as OfflineSale[];
  }

  async saveLease(lease: OfflineLease): Promise<void> {
    const transaction = this.db.transaction(LEASES_STORE, "readwrite");
    const stored: StoredOfflineLease = {
      ...lease,
      scopeKey: leaseScopeKey(lease)
    };
    transaction.objectStore(LEASES_STORE).put(stored);
    await transactionDone(transaction);
  }

  async getLease(scope: {
    readonly businessId: string;
    readonly branchId: string;
    readonly cashRegisterId: string;
  }): Promise<OfflineLease | null> {
    const transaction = this.db.transaction(LEASES_STORE, "readonly");
    const stored = (await requestToPromise(
      transaction.objectStore(LEASES_STORE).get(leaseScopeKey(scope))
    )) as StoredOfflineLease | undefined;
    await transactionDone(transaction);
    if (!stored) return null;
    return {
      version: stored.version,
      leaseId: stored.leaseId,
      token: stored.token,
      businessId: stored.businessId,
      branchId: stored.branchId,
      cashRegisterId: stored.cashRegisterId,
      issuedByUserId: stored.issuedByUserId,
      issuedAt: stored.issuedAt,
      expiresAt: stored.expiresAt,
      maxSales: stored.maxSales,
      maxAmount: stored.maxAmount,
      usedSales: stored.usedSales,
      usedAmount: stored.usedAmount,
      productQuotas: stored.productQuotas
    };
  }

  async deleteLease(scope: {
    readonly businessId: string;
    readonly branchId: string;
    readonly cashRegisterId: string;
  }): Promise<void> {
    const transaction = this.db.transaction(LEASES_STORE, "readwrite");
    transaction.objectStore(LEASES_STORE).delete(leaseScopeKey(scope));
    await transactionDone(transaction);
  }

  async hasUnsyncedSalesForLease(leaseId: string): Promise<boolean> {
    const sales = await this.listSales();
    return sales.some((sale) => sale.lease?.leaseId === leaseId && sale.status !== "synced");
  }

  async listBranchSales(businessId: string, branchId: string): Promise<readonly OfflineSale[]> {
    const transaction = this.db.transaction(SALES_STORE, "readonly");
    const sales = await requestToPromise(
      transaction.objectStore(SALES_STORE).index("branch").getAll([businessId, branchId])
    );
    await transactionDone(transaction);
    return sales as OfflineSale[];
  }

  async listBranchSnapshots(
    businessId: string,
    branchId: string
  ): Promise<readonly StockSnapshot[]> {
    const transaction = this.db.transaction(STOCK_STORE, "readonly");
    const records = await requestToPromise(
      transaction.objectStore(STOCK_STORE).index("branch").getAll([businessId, branchId])
    );
    await transactionDone(transaction);
    return (records as StoredStockSnapshot[]).map(({ productId, serverStock }) => ({
      productId,
      serverStock
    }));
  }

  async enqueueSale(sale: OfflineSale): Promise<OfflineSale> {
    validateOfflineSale(sale);
    if (sale.status !== "pending" || sale.attempts !== 0) {
      throw new Error("New offline sales must start as pending with attempts=0");
    }

    const transaction = this.db.transaction([SALES_STORE, STOCK_STORE, LEASES_STORE], "readwrite");
    const salesStore = transaction.objectStore(SALES_STORE);
    const stockStore = transaction.objectStore(STOCK_STORE);
    const leasesStore = transaction.objectStore(LEASES_STORE);

    try {
      const existing = (await requestToPromise(
        salesStore.get(sale.requestId)
      )) as OfflineSale | undefined;

      if (existing) {
        assertSameOfflineRequest(existing, sale);
        await transactionDone(transaction);
        return existing;
      }


      const storedLease = (await requestToPromise(
        leasesStore.get(leaseScopeKey(sale))
      )) as StoredOfflineLease | undefined;
      assertOfflineLeaseAllowsSale(storedLease ?? null, sale);
      if (!sale.lease || sale.lease.leaseId !== storedLease?.leaseId || sale.lease.token !== storedLease.token) {
        throw new Error("Offline sale lease does not match the active authorization");
      }

      const queued = (await requestToPromise(
        salesStore.index("branch").getAll([sale.businessId, sale.branchId])
      )) as OfflineSale[];

      const stockRecords = (await requestToPromise(
        stockStore.index("branch").getAll([sale.businessId, sale.branchId])
      )) as StoredStockSnapshot[];

      const snapshots = stockRecords.map(({ productId, serverStock }) => ({
        productId,
        serverStock
      }));

      assertSaleCanReserveStock(sale, snapshots, queued);
      const requested = new Map<string, number>();
      for (const item of sale.items) requested.set(item.productId, (requested.get(item.productId) ?? 0) + item.quantity);
      leasesStore.put({
        ...storedLease,
        usedSales: storedLease.usedSales + 1,
        usedAmount: storedLease.usedAmount + sale.total,
        productQuotas: storedLease.productQuotas.map((quota) => ({
          ...quota,
          usedQuantity: quota.usedQuantity + (requested.get(quota.productId) ?? 0)
        }))
      });
      salesStore.add(sale);
      await transactionDone(transaction);
      return sale;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Transaction may already be completed or aborted.
      }
      throw error;
    }
  }

  async transitionSale(
    requestId: RequestId,
    nextStatus: OfflineSale["status"],
    options: TransitionOptions = {}
  ): Promise<OfflineSale> {
    const transaction = this.db.transaction(SALES_STORE, "readwrite");
    const store = transaction.objectStore(SALES_STORE);
    const existing = (await requestToPromise(store.get(requestId))) as OfflineSale | undefined;

    if (!existing) {
      try {
        transaction.abort();
      } catch {
        // Transaction may already be closing.
      }
      throw new Error(`Offline sale not found: ${requestId}`);
    }

    assertOfflineSaleTransition(existing.status, nextStatus);

    const base = options.clearLastError ? clearSaleLastError(existing) : existing;
    const next: OfflineSale = {
      ...base,
      status: nextStatus,
      attempts: existing.attempts + (options.incrementAttempts ? 1 : 0),
      ...(options.lastError === undefined ? {} : { lastError: options.lastError })
    };

    store.put(next);
    await transactionDone(transaction);
    return next;
  }

  async getSale(requestId: RequestId): Promise<OfflineSale | null> {
    const transaction = this.db.transaction(SALES_STORE, "readonly");
    const sale = (await requestToPromise(
      transaction.objectStore(SALES_STORE).get(requestId)
    )) as OfflineSale | undefined;
    await transactionDone(transaction);
    return sale ?? null;
  }
}
