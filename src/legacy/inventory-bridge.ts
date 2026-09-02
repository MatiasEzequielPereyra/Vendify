import { createInventoryController } from "../inventory/inventory-controller.js";
import {
  adjustInventoryStock,
  applyPhysicalCount,
  listInventoryMovements,
  listTransferProducts,
  transferInventoryStock
} from "../inventory/inventory-service.js";

export interface VendifyInventoryV232Api {
  readonly createController: typeof createInventoryController;
  readonly listMovements: typeof listInventoryMovements;
  readonly adjustStock: typeof adjustInventoryStock;
  readonly applyPhysicalCount: typeof applyPhysicalCount;
  readonly listTransferProducts: typeof listTransferProducts;
  readonly transferStock: typeof transferInventoryStock;
}

declare global {
  interface Window {
    VendifyInventoryV232?: VendifyInventoryV232Api;
  }
}

window.VendifyInventoryV232 = Object.freeze({
  createController: createInventoryController,
  listMovements: listInventoryMovements,
  adjustStock: adjustInventoryStock,
  applyPhysicalCount,
  listTransferProducts,
  transferStock: transferInventoryStock
});
