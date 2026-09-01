import type { OfflineSaleStatus } from "../types/offline.js";
import { VendifyOfflineDb } from "./indexeddb-store.js";
import {
  OFFLINE_ENGINE_STORAGE_KEY,
  OFFLINE_ENGINE_V2312,
  resolveOfflineEngineMode
} from "./feature-flag.js";

export interface OfflineRuntimeDiagnostics {
  readonly version: "2.31.2";
  readonly mode: "legacy" | "v2312";
  readonly enabled: boolean;
  readonly indexedDbReady: boolean;
  readonly initializationError: string | null;
  readonly sales: Readonly<Record<OfflineSaleStatus, number>>;
}

export interface VendifyOfflineRuntimePublic {
  readonly version: "2.31.2";
  readonly mode: "legacy" | "v2312";
  readonly enabled: boolean;
  readonly ready: Promise<void>;
  diagnostics(): Promise<OfflineRuntimeDiagnostics>;
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

const ready = (async (): Promise<void> => {
  if (mode !== "v2312") return;

  try {
    db = await VendifyOfflineDb.open();
  } catch (error) {
    initializationError = error instanceof Error ? error.message : String(error);
    console.error("[Vendify v2.31.2] IndexedDB initialization failed", error);
  }
})();

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
  enableForThisBrowser,
  disableForThisBrowser
};

console.info(
  `[Vendify v2.31.2] offline runtime loaded in ${mode === "v2312" ? "IndexedDB" : "legacy"} mode`
);
