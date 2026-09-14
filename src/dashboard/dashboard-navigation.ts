export type DashboardInventoryFilter = "low" | "out" | null;

export type DashboardDestination =
  | { readonly kind: "sales" }
  | { readonly kind: "cash" }
  | { readonly kind: "inventory"; readonly filter: DashboardInventoryFilter }
  | { readonly kind: "restock"; readonly productId: string }
  | { readonly kind: "product"; readonly productId: string };

export interface DashboardNavigationCoordinator {
  readonly begin: (destination: DashboardDestination) => void;
  readonly complete: (kind: DashboardDestination["kind"]) => void;
  readonly cancel: () => void;
}

export function createDashboardNavigationCoordinator(
  restoreDashboard: () => void | Promise<void>
): DashboardNavigationCoordinator {
  let active: DashboardDestination["kind"] | null = null;
  return Object.freeze({
    begin(destination: DashboardDestination) { active = destination.kind; },
    complete(kind: DashboardDestination["kind"]) {
      if (active !== kind) return;
      active = null;
      void restoreDashboard();
    },
    cancel() { active = null; }
  });
}
