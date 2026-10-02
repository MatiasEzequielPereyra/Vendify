import { createOfflineCompatController } from "../offline/compat-controller.js";
import { createConnectionStatusController } from "../offline/connection-status-controller.js";
import {
  buildLegacyOfflineTicket,
  createLegacyOfflineSale,
  isLegacyOfflineNetworkError,
  parseLegacyOfflineQueue,
  summarizeLegacyOfflineQueue,
  validateLegacyOfflinePayments
} from "../offline/legacy-fallback.js";

export interface VendifyOfflineCompatV232Api {
  readonly createController: typeof createOfflineCompatController;
  readonly createConnectionStatusController: typeof createConnectionStatusController;
  readonly parseLegacyQueue: typeof parseLegacyOfflineQueue;
  readonly summarizeLegacyQueue: typeof summarizeLegacyOfflineQueue;
  readonly validatePayments: typeof validateLegacyOfflinePayments;
  readonly createLegacySale: typeof createLegacyOfflineSale;
  readonly buildLegacyTicket: typeof buildLegacyOfflineTicket;
  readonly isNetworkError: typeof isLegacyOfflineNetworkError;
}

declare global {
  interface Window {
    VendifyOfflineCompatV232?: VendifyOfflineCompatV232Api;
  }
}

window.VendifyOfflineCompatV232 = Object.freeze({
  createController: createOfflineCompatController,
  createConnectionStatusController,
  parseLegacyQueue: parseLegacyOfflineQueue,
  summarizeLegacyQueue: summarizeLegacyOfflineQueue,
  validatePayments: validateLegacyOfflinePayments,
  createLegacySale: createLegacyOfflineSale,
  buildLegacyTicket: buildLegacyOfflineTicket,
  isNetworkError: isLegacyOfflineNetworkError
});
