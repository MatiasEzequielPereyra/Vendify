import { mapProductRow, mapSmartStockRow, type Product, type SmartStockInfo } from "./product-model.js";
import {
  initializeCategories,
  listCategories,
  listProducts,
  listSmartStock,
  type ProductsRpcClientPort
} from "./products-service.js";
import type { ProductCatalogScope, ProductsStore } from "./products-store.js";

const DEFAULT_CATEGORIES = [
  "Bebidas", "Golosinas", "Snacks", "Cigarrillos", "Lácteos",
  "Panadería", "Helados", "Limpieza", "Útiles", "Otros"
] as const;

export type CatalogLoadResult =
  | { readonly kind: "ready"; readonly productCount: number; readonly smartStockWarning: unknown }
  | { readonly kind: "offline" }
  | { readonly kind: "stale" }
  | { readonly kind: "error"; readonly error: unknown };

export type CategoryLoadResult =
  | { readonly kind: "ready" }
  | { readonly kind: "offline" }
  | { readonly kind: "defaults"; readonly error: unknown };

export type SmartStockLoadResult =
  | { readonly kind: "ready"; readonly itemCount: number }
  | { readonly kind: "empty" }
  | { readonly kind: "unavailable"; readonly error: unknown };

export interface ProductCatalogLifecycle {
  readonly loadBranch: (scope: ProductCatalogScope) => Promise<CatalogLoadResult>;
  readonly loadCategories: () => Promise<CategoryLoadResult>;
  readonly loadSmartStock: (branchId: string | null) => Promise<SmartStockLoadResult>;
}

export interface ProductCatalogLifecycleDependencies {
  readonly client: ProductsRpcClientPort;
  readonly store: ProductsStore;
  readonly isOnline: () => boolean;
  readonly restoreOfflineCatalog: () => boolean;
  readonly saveOfflineCatalog: () => void;
  readonly captureOfflineStockSnapshot: (products: Product[]) => Promise<void>;
  readonly refreshOnboarding: () => void;
}

function value(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

export function createProductCatalogLifecycle(
  dependencies: ProductCatalogLifecycleDependencies
): ProductCatalogLifecycle {
  async function loadSmartStock(branchId: string | null): Promise<SmartStockLoadResult> {
    if (!branchId) {
      dependencies.store.replaceSmartStock(new Map());
      return { kind: "empty" };
    }
    try {
      const rows = await listSmartStock(dependencies.client, branchId);
      const smartStock = new Map<string, SmartStockInfo>();
      for (const row of rows) {
        const productId = value(row.producto_id);
        if (productId) smartStock.set(productId, mapSmartStockRow(row));
      }
      dependencies.store.replaceSmartStock(smartStock);
      return { kind: "ready", itemCount: smartStock.size };
    } catch (error) {
      return { kind: "unavailable", error };
    }
  }

  async function loadBranch(scope: ProductCatalogScope): Promise<CatalogLoadResult> {
    const token = dependencies.store.beginLoad(scope);
    try {
      const rows = await listProducts(dependencies.client, scope.branchId);
      const products = rows.map(mapProductRow);
      if (!dependencies.store.replaceProducts(products, token)) return { kind: "stale" };
      dependencies.store.markReady();
      await dependencies.captureOfflineStockSnapshot(products);
      dependencies.saveOfflineCatalog();
      const smartStock = await loadSmartStock(scope.branchId);
      dependencies.refreshOnboarding();
      return {
        kind: "ready",
        productCount: products.length,
        smartStockWarning: smartStock.kind === "unavailable" ? smartStock.error : null
      };
    } catch (error) {
      if (!dependencies.isOnline() && dependencies.restoreOfflineCatalog()) {
        dependencies.store.markOffline();
        return { kind: "offline" };
      }
      if (dependencies.store.accepts(token)) {
        dependencies.store.replaceProducts([], token);
        dependencies.store.markError(error instanceof Error ? error.message : "No se pudieron cargar los productos");
      }
      return { kind: "error", error };
    }
  }

  async function initializeDefaults(): Promise<CategoryLoadResult> {
    try {
      const rows = await initializeCategories(dependencies.client, DEFAULT_CATEGORIES);
      const names = rows.map((row) => value(row.nombre)).filter(Boolean);
      dependencies.store.replaceCategories(names.length ? names : [...DEFAULT_CATEGORIES]);
      return { kind: "ready" };
    } catch (error) {
      dependencies.store.replaceCategories([...DEFAULT_CATEGORIES]);
      return { kind: "defaults", error };
    }
  }

  async function loadCategoriesFromBackend(): Promise<CategoryLoadResult> {
    try {
      const rows = await listCategories(dependencies.client);
      const names = rows.map((row) => value(row.nombre)).filter(Boolean);
      let result: CategoryLoadResult;
      if (names.length > 0) {
        dependencies.store.replaceCategories(names);
        result = { kind: "ready" };
      } else {
        result = await initializeDefaults();
      }
      dependencies.saveOfflineCatalog();
      return result;
    } catch (error) {
      if (!dependencies.isOnline() && dependencies.restoreOfflineCatalog()) return { kind: "offline" };
      dependencies.store.replaceCategories([...DEFAULT_CATEGORIES]);
      return { kind: "defaults", error };
    }
  }

  return Object.freeze({
    loadBranch,
    loadCategories: loadCategoriesFromBackend,
    loadSmartStock
  });
}
