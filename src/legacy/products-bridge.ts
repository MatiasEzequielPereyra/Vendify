import {
  isOutOfStock,
  mapProductRow,
  productLabel
} from "../products/product-model.js";
import { createProductsController } from "../products/products-controller.js";
import { createScannerController } from "../products/scanner-controller.js";
import { normalizeCsvHeader, parseCsvLine } from "../products/products-service.js";
import {
  adjustInitialStock,
  confirmScannedStock,
  deleteAllProducts,
  deleteCategory,
  deleteProduct,
  importCatalog,
  importBulkCatalog,
  initializeCategories,
  listCategories,
  listProducts,
  listSmartStock,
  saveCategory,
  saveProduct
} from "../products/products-service.js";

export interface VendifyProductsV232Api {
  readonly createController: typeof createProductsController;
  readonly createScannerController: typeof createScannerController;
  readonly mapProductRow: typeof mapProductRow;
  readonly productLabel: typeof productLabel;
  readonly isOutOfStock: typeof isOutOfStock;
  readonly listProducts: typeof listProducts;
  readonly listCategories: typeof listCategories;
  readonly initializeCategories: typeof initializeCategories;
  readonly saveCategory: typeof saveCategory;
  readonly deleteCategory: typeof deleteCategory;
  readonly saveProduct: typeof saveProduct;
  readonly deleteProduct: typeof deleteProduct;
  readonly deleteAllProducts: typeof deleteAllProducts;
  readonly adjustInitialStock: typeof adjustInitialStock;
  readonly listSmartStock: typeof listSmartStock;
  readonly confirmScannedStock: typeof confirmScannedStock;
  readonly importCatalog: typeof importCatalog;
  readonly importBulkCatalog: typeof importBulkCatalog;
  readonly parseCsvLine: typeof parseCsvLine;
  readonly normalizeCsvHeader: typeof normalizeCsvHeader;
}

declare global {
  interface Window {
    VendifyProductsV232?: VendifyProductsV232Api;
  }
}

window.VendifyProductsV232 = Object.freeze({
  createController: createProductsController,
  createScannerController,
  mapProductRow,
  productLabel,
  isOutOfStock,
  listProducts,
  listCategories,
  initializeCategories,
  saveCategory,
  deleteCategory,
  saveProduct,
  deleteProduct,
  deleteAllProducts,
  adjustInitialStock,
  listSmartStock,
  confirmScannedStock,
  importCatalog,
  importBulkCatalog,
  parseCsvLine,
  normalizeCsvHeader
});
