export {
  assertOfflineSaleTransition,
  canTransitionOfflineSale
} from "./state-machine.js";
export {
  availableOfflineStock,
  reservedQuantityForProduct
} from "./stock-reservations.js";
export {
  OfflineIdempotencyConflictError,
  OfflineSaleValidationError,
  OfflineStockConflictError,
  assertSaleCanReserveStock,
  assertSameOfflineRequest,
  offlineSalePayloadFingerprint,
  validateOfflineSale
} from "./queue-policy.js";
export { VendifyOfflineDb } from "./indexeddb-store.js";
export { classifyOfflineSyncError } from "./sync-error.js";
export {
  OfflineQueueSynchronizer,
  createScopedOfflineQueueStore,
  recoverInterruptedOfflineSales,
  syncOfflineQueue
} from "./sync-engine.js";
export {
  buildRegistrarVentaV4Args,
  createRegistrarVentaV4Transport
} from "./supabase-transport.js";
export type {
  OfflineSyncErrorClassification,
  OfflineSyncErrorKind
} from "./sync-error.js";
export type {
  OfflineQueueStore,
  OfflineQueueScope,
  OfflineSaleTransport,
  OfflineSyncOptions,
  OfflineSyncSummary,
  OfflineTransitionOptions,
  OfflineTransportResult
} from "./sync-engine.js";
export type { SupabaseRpcClientLike } from "./supabase-transport.js";
