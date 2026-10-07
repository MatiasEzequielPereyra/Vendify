import type { Product } from "../products/product-model.js";
import type {
  ProductCatalogScope,
  ProductsStore
} from "../products/products-store.js";
import type {
  ProductCatalogCacheSnapshot
} from "../products/products-offline-cache.js";
import type {
  CartItem,
  PosController
} from "../sales/pos-controller.js";
import type {
  ApplicationContextState
} from "./application-context.js";

export interface ApplicationOfflineStorageDependencies {
  readonly storage?: Storage;
  readonly getUserId: () => string | null;
  readonly getContext: () => ApplicationContextState;
  readonly productsStore: ProductsStore;
  readonly pos: PosController;
  readonly serializeCatalog: (
    scope: ProductCatalogScope,
    products: readonly Product[],
    categories: readonly string[],
    savedAt?: string
  ) => string;
  readonly parseCatalog: (
    raw: string | null,
    scope: ProductCatalogScope
  ) => ProductCatalogCacheSnapshot | null;
  readonly migrateLegacyCatalog: (
    productsRaw: string | null,
    categoriesRaw: string | null,
    scope: ProductCatalogScope
  ) => ProductCatalogCacheSnapshot | null;
}

export interface ApplicationOfflineStorage {
  readonly scopedKey: (prefix: string) => string;
  readonly persistCatalog: () => void;
  readonly restoreCatalog: () => boolean;
  readonly persistCart: () => void;
  readonly restoreCart: () => boolean;
  readonly clearPersistedCart: () => void;
}

const CART_PREFIX = "vendify_cart_v231";
const LEGACY_PRODUCTS_PREFIX = "vendify_products_v231";
const LEGACY_CATEGORIES_PREFIX = "vendify_categories_v231";
const CATALOG_PREFIX = "vendify_catalog_v232";

function cartItem(
  product: Product,
  quantity: unknown
): CartItem | null {
  const stock = Number(product.stock ?? 0);
  if (!product.id || stock <= 0) return null;

  return {
    id: product.id,
    nombre: product.nombre,
    precioVenta: Number(product.precioVenta ?? 0),
    stock,
    cantidad: Math.max(
      1,
      Math.min(Number(quantity ?? 1), stock)
    )
  };
}

export function createApplicationOfflineStorage(
  dependencies: ApplicationOfflineStorageDependencies
): ApplicationOfflineStorage {
  const storage = dependencies.storage ?? globalThis.localStorage;

  const scopedKey = (prefix: string): string => {
    const context = dependencies.getContext();
    const userId = dependencies.getUserId() ?? "anon";
    const businessId = context.business?.id ?? "none";
    const branchId = context.branch?.id ?? "none";
    return `${prefix}:${userId}:${businessId}:${branchId}`;
  };

  const scope = (): ProductCatalogScope | null => {
    const context = dependencies.getContext();
    const businessId = context.business?.id ?? null;
    const branchId = context.branch?.id ?? null;
    return businessId && branchId ? { businessId, branchId } : null;
  };

  const persistCatalog = (): void => {
    const activeScope = scope();
    if (!activeScope) return;

    try {
      storage.setItem(
        scopedKey(CATALOG_PREFIX),
        dependencies.serializeCatalog(
          activeScope,
          dependencies.productsStore.list(),
          dependencies.productsStore.listCategories()
        )
      );
    } catch {
      // Offline cache persistence is best-effort.
    }
  };

  const restoreCatalog = (): boolean => {
    const activeScope = scope();
    if (!activeScope) return false;

    try {
      const snapshot =
        dependencies.parseCatalog(
          storage.getItem(scopedKey(CATALOG_PREFIX)),
          activeScope
        )
        ?? dependencies.migrateLegacyCatalog(
          storage.getItem(scopedKey(LEGACY_PRODUCTS_PREFIX)),
          storage.getItem(scopedKey(LEGACY_CATEGORIES_PREFIX)),
          activeScope
        );

      if (!snapshot) return false;

      dependencies.productsStore.restoreProducts(
        activeScope,
        snapshot.products
      );
      dependencies.productsStore.replaceCategories(
        snapshot.categories
      );
      storage.setItem(
        scopedKey(CATALOG_PREFIX),
        dependencies.serializeCatalog(
          activeScope,
          snapshot.products,
          snapshot.categories,
          snapshot.savedAt
        )
      );
      return true;
    } catch {
      return false;
    }
  };

  const persistCart = (): void => {
    const activeScope = scope();
    if (!activeScope) return;

    try {
      const key = scopedKey(CART_PREFIX);
      const cart = dependencies.pos.getCart();
      if (cart.length === 0) {
        storage.removeItem(key);
        return;
      }

      storage.setItem(
        key,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          carrito: cart
        })
      );
    } catch {
      // Offline cart persistence is best-effort.
    }
  };

  const restoreCart = (): boolean => {
    if (
      dependencies.pos.getCart().length > 0
      || dependencies.productsStore.list().length === 0
    ) {
      return false;
    }

    try {
      const raw = storage.getItem(scopedKey(CART_PREFIX));
      if (!raw) return false;
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== "object"
        || parsed === null
        || Array.isArray(parsed)
        || !("carrito" in parsed)
        || !Array.isArray(parsed.carrito)
      ) {
        return false;
      }

      const restored = parsed.carrito.flatMap((value): CartItem[] => {
        if (
          typeof value !== "object"
          || value === null
          || Array.isArray(value)
          || !("id" in value)
          || typeof value.id !== "string"
        ) {
          return [];
        }

        const product = dependencies.productsStore.getById(value.id);
        if (!product) return [];
        const quantity = "cantidad" in value ? value.cantidad : 1;
        const item = cartItem(product, quantity);
        return item ? [item] : [];
      });

      if (restored.length === 0) return false;
      dependencies.pos.setCart(restored);
      return true;
    } catch {
      return false;
    }
  };

  const clearPersistedCart = (): void => {
    try {
      storage.removeItem(scopedKey(CART_PREFIX));
    } catch {
      // Local storage cleanup is best-effort.
    }
  };

  return Object.freeze({
    scopedKey,
    persistCatalog,
    restoreCatalog,
    persistCart,
    restoreCart,
    clearPersistedCart
  });
}
