import {
  VENDIFY_BASELINE_VERSION,
  VENDIFY_ENGINEERING_PHASE
} from "./core/version.js";

export { availableOfflineStock } from "./offline/index.js";
export type {
  OfflinePayment,
  OfflineSale,
  OfflineSaleItem,
  OfflineSaleStatus
} from "./types/offline.js";

export const engineeringFoundation = Object.freeze({
  product: "Vendify",
  baseline: VENDIFY_BASELINE_VERSION,
  phase: VENDIFY_ENGINEERING_PHASE
});
