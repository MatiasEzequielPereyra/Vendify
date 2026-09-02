import { createPurchasesController } from "../purchases/purchases-controller.js";
import {
  cancelPurchaseDraft,
  getPurchase,
  listPurchases,
  listSuppliers,
  receivePurchase,
  savePurchaseDraft,
  saveSupplier
} from "../purchases/purchases-service.js";

export interface VendifyPurchasesV232Api {
  readonly createController: typeof createPurchasesController;
  readonly listSuppliers: typeof listSuppliers;
  readonly saveSupplier: typeof saveSupplier;
  readonly listPurchases: typeof listPurchases;
  readonly getPurchase: typeof getPurchase;
  readonly savePurchaseDraft: typeof savePurchaseDraft;
  readonly receivePurchase: typeof receivePurchase;
  readonly cancelPurchaseDraft: typeof cancelPurchaseDraft;
}

declare global {
  interface Window {
    VendifyPurchasesV232?: VendifyPurchasesV232Api;
  }
}

window.VendifyPurchasesV232 = Object.freeze({
  createController: createPurchasesController,
  listSuppliers,
  saveSupplier,
  listPurchases,
  getPurchase,
  savePurchaseDraft,
  receivePurchase,
  cancelPurchaseDraft
});
