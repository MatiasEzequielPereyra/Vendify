import { mapProductRow, type Product } from "./product-model.js";
import type { ProductCatalogScope } from "./products-store.js";

export interface ProductCatalogCacheSnapshot {
  readonly version: 1;
  readonly savedAt: string;
  readonly scope: ProductCatalogScope;
  readonly products: readonly Product[];
  readonly categories: readonly string[];
}

interface LegacyCatalogSnapshot {
  readonly savedAt?: unknown;
  readonly productos?: unknown;
  readonly categorias?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validScope(value: unknown): ProductCatalogScope | null {
  const parsed = record(value);
  const businessId = typeof parsed?.businessId === "string" ? parsed.businessId.trim() : "";
  const branchId = typeof parsed?.branchId === "string" ? parsed.branchId.trim() : "";
  return businessId && branchId ? { businessId, branchId } : null;
}

function parseProducts(value: unknown): Product[] | null {
  if (!Array.isArray(value)) return null;
  const products: Product[] = [];
  for (const item of value) {
    const parsed = record(item);
    if (!parsed) return null;
    const product = mapProductRow(parsed);
    if (!product.id || !product.nombre) return null;
    products.push(product);
  }
  return products;
}

function parseCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []))]
    .sort((left, right) => left.localeCompare(right, "es"));
}

function sameScope(left: ProductCatalogScope, right: ProductCatalogScope): boolean {
  return left.businessId === right.businessId && left.branchId === right.branchId;
}

export function serializeProductCatalogCache(
  scope: ProductCatalogScope,
  products: readonly Product[],
  categories: readonly string[],
  savedAt = new Date().toISOString()
): string {
  const snapshot: ProductCatalogCacheSnapshot = {
    version: 1,
    savedAt,
    scope: { ...scope },
    products: products.map((product) => ({ ...product })),
    categories: parseCategories(categories)
  };
  return JSON.stringify(snapshot);
}

export function parseProductCatalogCache(
  raw: string | null,
  expectedScope: ProductCatalogScope
): ProductCatalogCacheSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const envelope = record(parsed);
    if (envelope?.version !== 1) return null;
    const scope = validScope(envelope.scope);
    const products = parseProducts(envelope.products);
    const savedAt = typeof envelope.savedAt === "string" ? envelope.savedAt : "";
    if (!scope || !sameScope(scope, expectedScope) || !products || !Number.isFinite(Date.parse(savedAt))) {
      return null;
    }
    return {
      version: 1,
      savedAt,
      scope,
      products,
      categories: parseCategories(envelope.categories)
    };
  } catch {
    return null;
  }
}

export function migrateLegacyProductCache(
  productsRaw: string | null,
  categoriesRaw: string | null,
  scope: ProductCatalogScope
): ProductCatalogCacheSnapshot | null {
  try {
    const productsEnvelope = JSON.parse(productsRaw ?? "null") as LegacyCatalogSnapshot | null;
    const categoriesEnvelope = JSON.parse(categoriesRaw ?? "null") as LegacyCatalogSnapshot | null;
    const products = parseProducts(productsEnvelope?.productos);
    if (!products) return null;
    const savedAt = typeof productsEnvelope?.savedAt === "string" && Number.isFinite(Date.parse(productsEnvelope.savedAt))
      ? productsEnvelope.savedAt
      : new Date(0).toISOString();
    return {
      version: 1,
      savedAt,
      scope: { ...scope },
      products,
      categories: parseCategories(categoriesEnvelope?.categorias)
    };
  } catch {
    return null;
  }
}
