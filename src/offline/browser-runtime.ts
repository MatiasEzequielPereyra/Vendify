import type { OfflineSale, OfflineSaleStatus, StockSnapshot } from "../types/offline.js";
import type { ProductId } from "../types/ids.js";
import { VendifyOfflineDb } from "./indexeddb-store.js";
import {
  OFFLINE_ENGINE_STORAGE_KEY,
  OFFLINE_ENGINE_V2312,
  resolveOfflineEngineMode
} from "./feature-flag.js";
import {
  legacyPosSaleToOfflineSale,
  type LegacyPosOfflineSaleInput
} from "./legacy-adapter.js";
import { createRegistrarVentaV4Transport, type SupabaseRpcClientLike } from "./supabase-transport.js";
import {
  OfflineQueueSynchronizer,
  type OfflineSyncOptions,
  type OfflineSyncSummary
} from "./sync-engine.js";

export interface OfflineRuntimeDiagnostics {
  readonly version: "2.31.2";
  readonly mode: "legacy" | "v2312";
  readonly enabled: boolean;
  readonly indexedDbReady: boolean;
  readonly initializationError: string | null;
  readonly sales: Readonly<Record<OfflineSaleStatus, number>>;
}

export interface CaptureStockSnapshotInput {
  readonly businessId: string;
  readonly branchId: string;
  readonly products: readonly {
    readonly productId: string;
    readonly serverStock: number;
  }[];
}

export interface VendifyOfflineRuntimePublic {
  readonly version: "2.31.2";
  readonly mode: "legacy" | "v2312";
  readonly enabled: boolean;
  readonly ready: Promise<void>;
  diagnostics(): Promise<OfflineRuntimeDiagnostics>;
  listSales(): Promise<readonly OfflineSale[]>;
  captureStockSnapshot(input: CaptureStockSnapshotInput): Promise<void>;
  enqueueLegacySale(input: LegacyPosOfflineSaleInput): Promise<OfflineSale>;
  syncNow(
    client: SupabaseRpcClientLike,
    options?: OfflineSyncOptions
  ): Promise<OfflineSyncSummary>;
  enableForThisBrowser(): void;
  disableForThisBrowser(): void;
}

declare global {
  interface Window {
    VendifyOfflineV2312?: VendifyOfflineRuntimePublic;
  }
}

const mode = resolveOfflineEngineMode(
  window.location.search,
  window.localStorage.getItem(OFFLINE_ENGINE_STORAGE_KEY)
);

let db: VendifyOfflineDb | null = null;
let initializationError: string | null = null;
let synchronizer: OfflineQueueSynchronizer | null = null;
let synchronizerClient: SupabaseRpcClientLike | null = null;

const ready = (async (): Promise<void> => {
  if (mode !== "v2312") return;

  try {
    db = await VendifyOfflineDb.open();
  } catch (error) {
    initializationError = error instanceof Error ? error.message : String(error);
    console.error("[Vendify v2.31.2] IndexedDB initialization failed", error);
  }
})();

function requireDb(): VendifyOfflineDb {
  if (mode !== "v2312") {
    throw new Error("Vendify offline v2.31.2 is not enabled");
  }
  if (!db) {
    throw new Error(initializationError ?? "Vendify IndexedDB is not ready");
  }
  return db;
}

function emptyStatusCounts(): Record<OfflineSaleStatus, number> {
  return {
    pending: 0,
    syncing: 0,
    failed_retryable: 0,
    review: 0,
    synced: 0
  };
}

async function diagnostics(): Promise<OfflineRuntimeDiagnostics> {
  await ready;
  const sales = emptyStatusCounts();

  if (db) {
    const storedSales = await db.listSales();
    for (const sale of storedSales) sales[sale.status] += 1;
  }

  return {
    version: "2.31.2",
    mode,
    enabled: mode === "v2312",
    indexedDbReady: db !== null,
    initializationError,
    sales
  };
}

async function listSales(): Promise<readonly OfflineSale[]> {
  await ready;
  return requireDb().listSales();
}

async function captureStockSnapshot(input: CaptureStockSnapshotInput): Promise<void> {
  await ready;
  const activeDb = requireDb();
  const businessId = input.businessId.trim();
  const branchId = input.branchId.trim();

  if (!businessId || !branchId) {
    throw new Error("Business and branch are required for offline stock snapshot");
  }

  const snapshots: StockSnapshot[] = input.products.map((product) => ({
    productId: product.productId.trim() as ProductId,
    serverStock: Number(product.serverStock)
  }));

  for (const snapshot of snapshots) {
    if (!snapshot.productId || !Number.isFinite(snapshot.serverStock) || snapshot.serverStock < 0) {
      throw new Error("Invalid product stock received for offline snapshot");
    }
  }

  await activeDb.replaceStockSnapshot(businessId, branchId, snapshots);
}

async function enqueueLegacySale(input: LegacyPosOfflineSaleInput): Promise<OfflineSale> {
  await ready;
  const sale = legacyPosSaleToOfflineSale(input);
  return requireDb().enqueueSale(sale);
}

async function syncNow(
  client: SupabaseRpcClientLike,
  options: OfflineSyncOptions = {}
): Promise<OfflineSyncSummary> {
  await ready;
  const activeDb = requireDb();

  if (synchronizer === null || synchronizerClient !== client) {
    synchronizerClient = client;
    synchronizer = new OfflineQueueSynchronizer(
      activeDb,
      createRegistrarVentaV4Transport(client)
    );
  }

  return synchronizer.run(options);
}

function enableForThisBrowser(): void {
  window.localStorage.setItem(OFFLINE_ENGINE_STORAGE_KEY, OFFLINE_ENGINE_V2312);
}

function disableForThisBrowser(): void {
  window.localStorage.removeItem(OFFLINE_ENGINE_STORAGE_KEY);
}

window.VendifyOfflineV2312 = {
  version: "2.31.2",
  mode,
  enabled: mode === "v2312",
  ready,
  diagnostics,
  listSales,
  captureStockSnapshot,
  enqueueLegacySale,
  syncNow,
  enableForThisBrowser,
  disableForThisBrowser
};

console.info(
  `[Vendify v2.31.2] offline runtime loaded in ${mode === "v2312" ? "IndexedDB" : "legacy"} mode`
);
