import type { OfflineSale, StockSnapshot } from "../types/offline.js";
import type { ProductId } from "../types/ids.js";

export interface CatalogStockProduct {
  readonly id: string;
  readonly stock: number;
}

export function stockSnapshotsFromCatalog(
  products: readonly CatalogStockProduct[]
): StockSnapshot[] {
  return products.map((product) => {
    const productId = product.id.trim();
    if (!productId || !Number.isFinite(product.stock) || product.stock < 0) {
      throw new Error("Invalid product received for offline stock snapshot");
    }
    return {
      productId: productId as ProductId,
      serverStock: product.stock
    };
  });
}

const RESERVING_STATUSES = new Set<OfflineSale["status"]>([
  "pending",
  "syncing",
  "failed_retryable",
  "review"
]);

export function reservedQuantityForProduct(
  productId: ProductId,
  sales: readonly OfflineSale[]
): number {
  return sales.reduce((reserved, sale) => {
    if (!RESERVING_STATUSES.has(sale.status)) return reserved;

    const fromSale = sale.items.reduce(
      (sum, item) => sum + (item.productId === productId ? item.quantity : 0),
      0
    );

    return reserved + fromSale;
  }, 0);
}

export function availableOfflineStock(
  snapshot: StockSnapshot,
  sales: readonly OfflineSale[]
): number {
  const reserved = reservedQuantityForProduct(snapshot.productId, sales);
  return Math.max(0, snapshot.serverStock - reserved);
}
