export interface RealtimeScope {
  readonly ready: boolean;
  readonly businessId: string | null;
  readonly branchId: string | null;
}

export interface RealtimeChannelLike {
  on(
    type: "postgres_changes",
    filter: Readonly<Record<string, string>>,
    callback: (payload: unknown) => void
  ): RealtimeChannelLike;
  subscribe(callback: (status: string) => void | Promise<void>): RealtimeChannelLike;
}

export interface RealtimeClientLike {
  channel(name: string): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): unknown;
}

export interface RealtimeScheduler {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void | Promise<void>, delay: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly setInterval: (callback: () => void | Promise<void>, delay: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

export interface RealtimeControllerDependencies {
  readonly client: RealtimeClientLike;
  readonly getScope: () => RealtimeScope;
  readonly getVisibility: () => string;
  readonly setStatus: (status: string) => void;
  readonly refreshCatalog: () => Promise<void>;
  readonly refreshProducts: () => Promise<void>;
  readonly syncStock: (render: boolean) => Promise<boolean>;
  readonly refreshSmartStock: () => Promise<void>;
  readonly refreshDependentViews: (reason: string) => Promise<void>;
  readonly addWindowListener: (event: "focus" | "online", listener: () => void) => void;
  readonly addVisibilityListener: (listener: () => void) => void;
  readonly report: (level: "info" | "warn" | "debug", context: string, error?: unknown) => void;
  readonly notifyCatalogFailure: () => void;
  readonly scheduler?: RealtimeScheduler;
}

export interface RealtimeController {
  readonly subscribe: () => void;
  readonly disconnect: () => void;
  readonly startWatchdog: () => void;
  readonly stopWatchdog: () => void;
  readonly syncCatalog: (options?: { readonly silent?: boolean }) => Promise<void>;
  readonly syncStock: (options?: { readonly render?: boolean }) => Promise<boolean>;
  readonly scheduleSmartRefresh: () => void;
  readonly refreshDependentViews: (reason?: string) => void;
  readonly emitStockChange: (reason?: string) => void;
}

const defaultScheduler: RealtimeScheduler = {
  now: Date.now,
  setTimeout: (callback, delay) => globalThis.setTimeout(() => { void callback(); }, delay),
  clearTimeout: (handle) => { globalThis.clearTimeout(Number(handle)); },
  setInterval: (callback, delay) => globalThis.setInterval(() => { void callback(); }, delay),
  clearInterval: (handle) => { globalThis.clearInterval(Number(handle)); }
};

function property(
  value: unknown,
  key: "new" | "old" | "payload" | "sucursal_id" | "branch_id"
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (key === "new" && "new" in value) return value.new;
  if (key === "old" && "old" in value) return value.old;
  if (key === "payload" && "payload" in value) return value.payload;
  if (key === "sucursal_id" && "sucursal_id" in value) return value.sucursal_id;
  if (key === "branch_id" && "branch_id" in value) return value.branch_id;
  return undefined;
}

function payloadBranchId(payload: unknown): string | null {
  for (const candidate of [property(payload, "new"), property(payload, "old"), property(payload, "payload"), payload]) {
    const value = property(candidate, "sucursal_id") ?? property(candidate, "branch_id");
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export function createRealtimeController(
  dependencies: RealtimeControllerDependencies
): RealtimeController {
  const scheduler = dependencies.scheduler ?? defaultScheduler;
  let channel: RealtimeChannelLike | null = null;
  let reconnectTimer: unknown = null;
  let watchdogTimer: unknown = null;
  let productTimer: unknown = null;
  let smartStockTimer: unknown = null;
  let dependentTimer: unknown = null;
  let status = "IDLE";
  let stockSyncInFlight = false;
  let catalogSyncInFlight = false;
  let lastFullSync = 0;
  let lifecycleBound = false;

  const visibleScope = (): RealtimeScope | null => {
    const scope = dependencies.getScope();
    return scope.ready && scope.branchId && dependencies.getVisibility() !== "hidden"
      ? scope
      : null;
  };

  const setStatus = (nextStatus: string): void => {
    status = nextStatus || "UNKNOWN";
    dependencies.setStatus(status);
  };

  const removeCurrentChannel = (): void => {
    if (!channel) return;
    try {
      dependencies.client.removeChannel(channel);
    } catch (error) {
      dependencies.report("debug", "remove-channel", error);
    }
    channel = null;
  };

  const syncCatalog = async ({ silent = true }: { readonly silent?: boolean } = {}): Promise<void> => {
    if (catalogSyncInFlight || !visibleScope()) return;
    catalogSyncInFlight = true;
    try {
      await dependencies.refreshCatalog();
      lastFullSync = scheduler.now();
    } catch (error) {
      dependencies.report("warn", "catalog-sync", error);
      if (!silent) dependencies.notifyCatalogFailure();
    } finally {
      catalogSyncInFlight = false;
    }
  };

  const syncStock = async ({ render = true }: { readonly render?: boolean } = {}): Promise<boolean> => {
    if (stockSyncInFlight || !visibleScope()) return false;
    stockSyncInFlight = true;
    try {
      return await dependencies.syncStock(render);
    } catch (error) {
      dependencies.report("warn", "stock-sync", error);
      return false;
    } finally {
      stockSyncInFlight = false;
    }
  };

  const refreshDependentViews = (reason = "data"): void => {
    if (dependentTimer !== null) scheduler.clearTimeout(dependentTimer);
    dependentTimer = scheduler.setTimeout(async () => {
      dependentTimer = null;
      try {
        await dependencies.refreshDependentViews(reason);
      } catch (error) {
        dependencies.report("debug", `dependent-refresh:${reason}`, error);
      }
    }, 260);
  };

  const scheduleSmartRefresh = (): void => {
    if (smartStockTimer !== null) scheduler.clearTimeout(smartStockTimer);
    smartStockTimer = scheduler.setTimeout(async () => {
      smartStockTimer = null;
      if (!visibleScope()) return;
      try {
        await dependencies.refreshSmartStock();
      } catch (error) {
        dependencies.report("debug", "smart-stock-refresh", error);
      }
    }, 900);
  };

  const scheduleProductRefresh = (): void => {
    if (productTimer !== null) scheduler.clearTimeout(productTimer);
    productTimer = scheduler.setTimeout(async () => {
      productTimer = null;
      try {
        await dependencies.refreshProducts();
      } catch (error) {
        dependencies.report("debug", "product-refresh", error);
      }
    }, 120);
  };

  const scheduleReconnect = (): void => {
    if (reconnectTimer !== null) scheduler.clearTimeout(reconnectTimer);
    const scope = visibleScope();
    if (!scope?.businessId) return;
    reconnectTimer = scheduler.setTimeout(() => {
      reconnectTimer = null;
      dependencies.report("info", "reconnecting");
      subscribe();
    }, 1600);
  };

  const receiveStockChange = (payload: unknown): void => {
    const branchId = payloadBranchId(payload);
    if (branchId && branchId !== dependencies.getScope().branchId) return;
    void syncStock({ render: true });
    scheduleSmartRefresh();
    refreshDependentViews("stock");
  };

  const subscribe = (): void => {
    if (reconnectTimer !== null) scheduler.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    removeCurrentChannel();

    const scope = dependencies.getScope();
    if (!scope.businessId || !scope.branchId) return;
    setStatus("CONNECTING");

    channel = dependencies.client
      .channel(`vendify-${scope.businessId}-${scope.branchId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "productos", filter: `negocio_id=eq.${scope.businessId}`
      }, scheduleProductRefresh)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "producto_stock_sucursal", filter: `sucursal_id=eq.${scope.branchId}`
      }, receiveStockChange)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "ventas", filter: `sucursal_id=eq.${scope.branchId}`
      }, () => { refreshDependentViews("ventas"); })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "movimientos", filter: `sucursal_id=eq.${scope.branchId}`
      }, () => { refreshDependentViews("movimientos"); })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "compras", filter: `sucursal_id=eq.${scope.branchId}`
      }, () => { refreshDependentViews("compras"); })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "proveedores", filter: `negocio_id=eq.${scope.businessId}`
      }, () => { refreshDependentViews("proveedores"); })
      .subscribe(async (nextStatus) => {
        dependencies.report("info", `status:${nextStatus}`);
        setStatus(nextStatus);
        if (nextStatus === "SUBSCRIBED") {
          if (reconnectTimer !== null) scheduler.clearTimeout(reconnectTimer);
          reconnectTimer = null;
          if (scheduler.now() - lastFullSync > 30_000) await syncCatalog();
          else await syncStock({ render: true });
          scheduleSmartRefresh();
          refreshDependentViews("reconnect");
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(nextStatus)) {
          scheduleReconnect();
        }
      });
  };

  const resynchronize = async (): Promise<void> => {
    if (!visibleScope()) return;
    await syncCatalog();
    scheduleSmartRefresh();
    refreshDependentViews("focus");
    if (status !== "SUBSCRIBED") subscribe();
  };

  const startWatchdog = (): void => {
    if (watchdogTimer !== null) return;
    watchdogTimer = scheduler.setInterval(async () => {
      if (!visibleScope()) return;
      if (scheduler.now() - lastFullSync > 60_000) await syncCatalog();
      else await syncStock({ render: true });
      if (status !== "SUBSCRIBED") scheduleReconnect();
    }, 10_000);
    if (!lifecycleBound) {
      lifecycleBound = true;
      dependencies.addWindowListener("focus", () => { void resynchronize(); });
      dependencies.addWindowListener("online", () => { void resynchronize(); });
      dependencies.addVisibilityListener(() => {
        if (dependencies.getVisibility() === "visible") void resynchronize();
      });
    }
  };

  const stopWatchdog = (): void => {
    if (watchdogTimer !== null) scheduler.clearInterval(watchdogTimer);
    watchdogTimer = null;
  };

  const disconnect = (): void => {
    if (reconnectTimer !== null) scheduler.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    removeCurrentChannel();
    setStatus("IDLE");
  };

  const emitStockChange = (reason = "stock"): void => {
    scheduleSmartRefresh();
    refreshDependentViews(reason);
  };

  return Object.freeze({
    subscribe,
    disconnect,
    startWatchdog,
    stopWatchdog,
    syncCatalog,
    syncStock,
    scheduleSmartRefresh,
    refreshDependentViews,
    emitStockChange
  });
}
