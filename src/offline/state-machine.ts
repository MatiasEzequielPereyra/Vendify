import type { OfflineSaleStatus } from "../types/offline.js";

const TRANSITIONS: Readonly<Record<OfflineSaleStatus, ReadonlySet<OfflineSaleStatus>>> = {
  pending: new Set(["syncing"]),
  syncing: new Set(["synced", "failed_retryable", "review"]),
  failed_retryable: new Set(["syncing", "review"]),
  review: new Set(["syncing"]),
  synced: new Set()
};

export function canTransitionOfflineSale(
  from: OfflineSaleStatus,
  to: OfflineSaleStatus
): boolean {
  return TRANSITIONS[from].has(to);
}

export function assertOfflineSaleTransition(
  from: OfflineSaleStatus,
  to: OfflineSaleStatus
): void {
  if (!canTransitionOfflineSale(from, to)) {
    throw new Error(`Invalid offline sale transition: ${from} -> ${to}`);
  }
}
