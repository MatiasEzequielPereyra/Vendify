export {
  assertOfflineSaleTransition,
  canTransitionOfflineSale
} from "./state-machine.js";
export {
  availableOfflineStock,
  reservedQuantityForProduct,
  stockSnapshotsFromCatalog
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
  buildRegistrarVentaOfflineArgs,
  buildRegistrarVentaV4Args,
  createRegistrarVentaV4Transport,
  requestOfflineLease,
  revokeOfflineLease
} from "./supabase-transport.js";
export {
  OfflineLeaseError,
  assertOfflineLeaseAllowsSale,
  leaseScopeKey,
  parseOfflineLease
} from "./offline-lease.js";
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
