import type { Product, SmartStockInfo } from "./product-model.js";

export interface ProductCatalogScope {
  readonly businessId: string;
  readonly branchId: string;
}

export type ProductsStoreStatus = "idle" | "loading" | "ready" | "offline" | "error";

export interface ProductsStoreSnapshot {
  readonly scope: ProductCatalogScope | null;
  readonly status: ProductsStoreStatus;
  readonly revision: number;
  readonly products: readonly Product[];
  readonly categories: readonly string[];
  readonly error: string | null;
}

export interface ProductsLoadToken {
  readonly scopeKey: string;
  readonly generation: number;
}

export type ProductsStoreListener = (snapshot: ProductsStoreSnapshot) => void;

export interface ProductsStore {
  readonly beginLoad: (scope: ProductCatalogScope) => ProductsLoadToken;
  readonly accepts: (token: ProductsLoadToken) => boolean;
  readonly replaceProducts: (products: readonly Product[], token?: ProductsLoadToken) => boolean;
  readonly restoreProducts: (scope: ProductCatalogScope, products: readonly Product[]) => void;
  readonly replaceCategories: (categories: readonly string[]) => void;
  readonly replaceSmartStock: (items: ReadonlyMap<string, SmartStockInfo>) => void;
  readonly upsert: (product: Product) => void;
  readonly remove: (productId: string) => void;
  readonly patchStock: (productId: string, stock: number, stockMinimum?: number) => void;
  readonly updateCategory: (category: string, replacement: string) => void;
  readonly markReady: () => void;
  readonly markOffline: () => void;
  readonly markError: (message: string) => void;
  readonly clear: () => void;
  readonly list: () => Product[];
  readonly listCategories: () => string[];
  readonly getById: (productId: string) => Product | null;
  readonly findByBarcode: (barcode: string) => Product | null;
  readonly search: (query: string) => Product[];
  readonly getSmartStock: (productId: string) => SmartStockInfo | null;
  readonly getSnapshot: () => ProductsStoreSnapshot;
  readonly subscribe: (listener: ProductsStoreListener) => () => void;
}

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase("es");
}

function normalizedBarcode(value: string): string {
  return value.trim();
}

function scopeKey(scope: ProductCatalogScope): string {
  return `${scope.businessId.trim()}:${scope.branchId.trim()}`;
}

function cloneProduct(product: Product): Product {
  return { ...product };
}

export function createProductsStore(): ProductsStore {
  let scope: ProductCatalogScope | null = null;
  let status: ProductsStoreStatus = "idle";
  let revision = 0;
  let generation = 0;
  let error: string | null = null;
  let order: string[] = [];
  let productsById = new Map<string, Product>();
  let productIdByBarcode = new Map<string, string>();
  let categories: string[] = [];
  let smartStock = new Map<string, SmartStockInfo>();
  const listeners = new Set<ProductsStoreListener>();

  function rebuildIndexes(products: readonly Product[]): void {
    const nextById = new Map<string, Product>();
    const nextByBarcode = new Map<string, string>();
    const nextOrder: string[] = [];
    for (const incoming of products) {
      const product = cloneProduct(incoming);
      if (!product.id || nextById.has(product.id)) continue;
      const barcode = normalizedBarcode(product.codigoBarras);
      if (barcode) {
        const existing = nextByBarcode.get(barcode);
        if (existing && existing !== product.id) {
          throw new Error(`Duplicate product barcode in catalog: ${barcode}`);
        }
        nextByBarcode.set(barcode, product.id);
      }
      nextById.set(product.id, product);
      nextOrder.push(product.id);
    }
    productsById = nextById;
    productIdByBarcode = nextByBarcode;
    order = nextOrder;
  }

  function snapshot(): ProductsStoreSnapshot {
    return Object.freeze({
      scope: scope ? Object.freeze({ ...scope }) : null,
      status,
      revision,
      products: Object.freeze(order.flatMap((id) => {
        const product = productsById.get(id);
        return product ? [Object.freeze(cloneProduct(product))] : [];
      })),
      categories: Object.freeze([...categories]),
      error
    });
  }

  function emit(): void {
    revision += 1;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function beginLoad(nextScope: ProductCatalogScope): ProductsLoadToken {
    const businessId = nextScope.businessId.trim();
    const branchId = nextScope.branchId.trim();
    if (!businessId || !branchId) throw new Error("Product catalog scope is required");
    const changed = scope?.businessId !== businessId || scope.branchId !== branchId;
    scope = { businessId, branchId };
    generation += 1;
    status = "loading";
    error = null;
    if (changed) {
      rebuildIndexes([]);
      smartStock.clear();
    }
    emit();
    return { scopeKey: scopeKey(scope), generation };
  }

  function accepts(token: ProductsLoadToken): boolean {
    if (!scope) return false;
    return token.generation === generation && token.scopeKey === scopeKey(scope);
  }

  function replaceProducts(products: readonly Product[], token?: ProductsLoadToken): boolean {
    if (token && !accepts(token)) return false;
    rebuildIndexes(products);
    error = null;
    emit();
    return true;
  }

  function restoreProducts(nextScope: ProductCatalogScope, products: readonly Product[]): void {
    scope = { businessId: nextScope.businessId.trim(), branchId: nextScope.branchId.trim() };
    generation += 1;
    rebuildIndexes(products);
    status = "offline";
    error = null;
    emit();
  }

  function replaceCategories(next: readonly string[]): void {
    categories = [...new Set(next.map((item) => item.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "es"));
    emit();
  }

  function replaceSmartStock(next: ReadonlyMap<string, SmartStockInfo>): void {
    smartStock = new Map(next);
    emit();
  }

  function upsert(incoming: Product): void {
    const existing = productsById.get(incoming.id);
    const next = order.flatMap((id) => id === incoming.id ? [incoming] : productsById.get(id) ?? []);
    if (!existing) next.push(incoming);
    rebuildIndexes(next);
    emit();
  }

  function remove(productId: string): void {
    if (!productsById.has(productId)) return;
    rebuildIndexes(order.flatMap((id) => id === productId ? [] : productsById.get(id) ?? []));
    smartStock.delete(productId);
    emit();
  }

  function patchStock(productId: string, nextStock: number, stockMinimum?: number): void {
    const product = productsById.get(productId);
    if (!product) return;
    const stock = Number.isFinite(nextStock) ? Math.max(0, nextStock) : product.stock;
    const next: Product = {
      ...product,
      stock,
      ...(stockMinimum === undefined ? {} : { stockMinimo: Math.max(0, stockMinimum) })
    };
    productsById.set(productId, next);
    emit();
  }

  function updateCategory(category: string, replacement: string): void {
    rebuildIndexes(order.flatMap((id) => {
      const product = productsById.get(id);
      return product ? [{ ...product, categoria: product.categoria === category ? replacement : product.categoria }] : [];
    }));
    emit();
  }

  function markReady(): void { status = "ready"; error = null; emit(); }
  function markOffline(): void { status = "offline"; error = null; emit(); }
  function markError(message: string): void { status = "error"; error = message; emit(); }

  function clear(): void {
    scope = null;
    status = "idle";
    error = null;
    generation += 1;
    categories = [];
    smartStock.clear();
    rebuildIndexes([]);
    emit();
  }

  function list(): Product[] {
    return order.flatMap((id) => {
      const product = productsById.get(id);
      return product ? [cloneProduct(product)] : [];
    });
  }

  function getById(productId: string): Product | null {
    const product = productsById.get(productId);
    return product ? cloneProduct(product) : null;
  }

  function findByBarcode(barcode: string): Product | null {
    const id = productIdByBarcode.get(normalizedBarcode(barcode));
    return id ? getById(id) : null;
  }

  function search(query: string): Product[] {
    const term = normalizedText(query);
    if (!term) return list();
    return list().filter((product) => normalizedText([
      product.nombre, product.marca, product.presentacion, product.codigoBarras, product.categoria
    ].filter(Boolean).join(" ")).includes(term));
  }

  function getSmartStock(productId: string): SmartStockInfo | null {
    const item = smartStock.get(productId);
    return item ? { ...item } : null;
  }

  function subscribe(listener: ProductsStoreListener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  return Object.freeze({
    beginLoad, accepts, replaceProducts, restoreProducts, replaceCategories, replaceSmartStock,
    upsert, remove, patchStock, updateCategory, markReady, markOffline, markError, clear,
    list, listCategories: () => [...categories], getById, findByBarcode, search, getSmartStock,
    getSnapshot: snapshot, subscribe
  });
}
