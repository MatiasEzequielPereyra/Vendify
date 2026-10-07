import {
  createApplicationBootstrap,
  type ApplicationBootstrap
} from "./application-bootstrap.js";
import {
  createApplicationContextAdapter,
  type ApplicationContextAdapter
} from "./application-context.js";
import {
  createApplicationOfflineStorage,
  type ApplicationOfflineStorage
} from "./application-offline-storage.js";
import {
  listBranchRealtimeStock,
  type RealtimeStockClientPort
} from "../products/realtime-stock-service.js";
import type { AuthController } from "../auth/auth-controller.js";
import type { InactivityGuard } from "../auth/inactivity-guard.js";
import type { ActiveBranchController } from "../branches/active-branch-controller.js";
import type { BranchAdministrationController } from "../branches/branch-administration-controller.js";
import type { CashController } from "../cash/cash-controller.js";
import type { CommercialFoundationController } from "../commercial/commercial-foundation-controller.js";
import type { ContextPickerController } from "../context/context-picker-controller.js";
import type { RealtimeController } from "../context/realtime-controller.js";
import type { DashboardController } from "../dashboard/dashboard-controller.js";
import type { DashboardNavigationCoordinator } from "../dashboard/dashboard-navigation.js";
import type {
  BranchTransferController,
  InventoryController
} from "../inventory/inventory-controller.js";
import type { DiagnosticsController } from "../observability/diagnostics-controller.js";
import type { ConnectionStatusController } from "../offline/connection-status-controller.js";
import type { OfflineCompatController } from "../offline/compat-controller.js";
import type { PlatformAdminController } from "../platform/platform-admin-controller.js";
import type { ProductsController } from "../products/products-controller.js";
import type { ScannerController } from "../products/scanner-controller.js";
import type { ProductsStore } from "../products/products-store.js";
import type { PurchasesController } from "../purchases/purchases-controller.js";
import type { DiscountController } from "../sales/discount-controller.js";
import type { PosController } from "../sales/pos-controller.js";
import type { SalesHistoryController } from "../sales/sales-history-controller.js";
import type { TeamController } from "../team/team-controller.js";

declare const SUPABASE_URL: string;
declare const supabaseClient: unknown;
declare const __VENDIFY_EXPECTED_SUPABASE_REF__: string;

type CoreApi = NonNullable<typeof window.VendifyCoreV232>;
type AuthApi = NonNullable<typeof window.VendifyAuthV232>;
type TeamApi = NonNullable<typeof window.VendifyTeamV232>;
type RealtimeApi = NonNullable<typeof window.VendifyRealtimeV232>;
type ProductsApi = NonNullable<typeof window.VendifyProductsV232>;
type ObservabilityApi = NonNullable<typeof window.VendifyObservabilityV232>;
type DashboardApi = NonNullable<typeof window.VendifyDashboardV232>;
type PlatformApi = NonNullable<typeof window.VendifyPlatformV232>;
type CommercialApi = NonNullable<typeof window.VendifyCommercialV232>;
type InventoryApi = NonNullable<typeof window.VendifyInventoryV232>;
type PurchasesApi = NonNullable<typeof window.VendifyPurchasesV232>;
type SalesApi = NonNullable<typeof window.VendifySalesV232>;
type CashApi = NonNullable<typeof window.VendifyCashV232>;
type BranchesApi = NonNullable<typeof window.VendifyBranchesV232>;
type ContextApi = NonNullable<typeof window.VendifyContextV232>;
type OfflineApi = NonNullable<typeof window.VendifyOfflineCompatV232>;
type PwaApi = NonNullable<typeof window.VendifyPwaV232>;

type AuthDependencies = Parameters<AuthApi["createController"]>[0];
type TeamDependencies = Parameters<TeamApi["createController"]>[0];
type ProductsDependencies = Parameters<ProductsApi["createController"]>[0];
type ScannerDependencies = Parameters<ProductsApi["createScannerController"]>[0];
type RealtimeDependencies = Parameters<RealtimeApi["createController"]>[0];
type DiagnosticsDependencies = Parameters<ObservabilityApi["createDiagnosticsController"]>[0];
type DashboardDependencies = Parameters<DashboardApi["createController"]>[0];
type PlatformDependencies = Parameters<PlatformApi["createPlatformAdminController"]>[0];
type CommercialDependencies = Parameters<CommercialApi["createCommercialFoundationController"]>[0];
type InventoryDependencies = Parameters<InventoryApi["createController"]>[0];
type BranchTransferDependencies = Parameters<InventoryApi["createBranchTransferController"]>[0];
type PurchasesDependencies = Parameters<PurchasesApi["createController"]>[0];
type DiscountDependencies = Parameters<SalesApi["createDiscountController"]>[0];
type HistoryDependencies = Parameters<SalesApi["createHistoryController"]>[0];
type PosDependencies = Parameters<SalesApi["createPosController"]>[0];
type CashDependencies = Parameters<CashApi["createController"]>[0];
type ActiveBranchDependencies = Parameters<BranchesApi["createActiveBranchController"]>[0];
type BranchAdministrationDependencies =
  Parameters<BranchesApi["createBranchAdministrationController"]>[0];
type ContextPickerDependencies =
  Parameters<ContextApi["createContextPickerController"]>[0];
type OfflineDependencies = Parameters<OfflineApi["createController"]>[0];

export interface BrowserApplicationComposition {
  readonly bootstrap: ApplicationBootstrap;
  readonly controllers: Readonly<{
    auth: AuthController;
    inactivity: InactivityGuard;
    team: TeamController;
    realtime: RealtimeController;
    products: ProductsController;
    scanner: ScannerController;
    diagnostics: DiagnosticsController;
    dashboard: DashboardController;
    platform: PlatformAdminController;
    commercial: CommercialFoundationController;
    inventory: InventoryController;
    branchTransfer: BranchTransferController;
    purchases: PurchasesController;
    discount: DiscountController;
    salesHistory: SalesHistoryController;
    pos: PosController;
    cash: CashController;
    activeBranch: ActiveBranchController;
    branchAdministration: BranchAdministrationController;
    contextPicker: ContextPickerController;
    connectionStatus: ConnectionStatusController;
    offline: OfflineCompatController;
  }>;
}

function requireRuntime<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`Vendify runtime API missing: ${name}`);
  return value;
}

function query(selector: string): Element | null {
  return document.querySelector(selector);
}

function input(selector: string): HTMLInputElement | null {
  const element = query(selector);
  return element instanceof HTMLInputElement ? element : null;
}

function button(selector: string): HTMLButtonElement | null {
  const element = query(selector);
  return element instanceof HTMLButtonElement ? element : null;
}

function select(selector: string): HTMLSelectElement | null {
  const element = query(selector);
  return element instanceof HTMLSelectElement ? element : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function icon(name: string, className = "vendify-icon"): string {
  const safe = String(name || "").replace(/[^a-z0-9-]/gi, "");
  return `<svg class="${className}" aria-hidden="true"><use href="#vi-${safe}"></use></svg>`;
}

export function createBrowserApplicationComposition(): BrowserApplicationComposition {
  const core = requireRuntime(window.VendifyCoreV232, "VendifyCoreV232");
  const authApi = requireRuntime(window.VendifyAuthV232, "VendifyAuthV232");
  const teamApi = requireRuntime(window.VendifyTeamV232, "VendifyTeamV232");
  const realtimeApi = requireRuntime(window.VendifyRealtimeV232, "VendifyRealtimeV232");
  const productsApi = requireRuntime(window.VendifyProductsV232, "VendifyProductsV232");
  const observabilityApi = requireRuntime(
    window.VendifyObservabilityV232,
    "VendifyObservabilityV232"
  );
  const dashboardApi = requireRuntime(window.VendifyDashboardV232, "VendifyDashboardV232");
  const platformApi = requireRuntime(window.VendifyPlatformV232, "VendifyPlatformV232");
  const commercialApi = requireRuntime(
    window.VendifyCommercialV232,
    "VendifyCommercialV232"
  );
  const inventoryApi = requireRuntime(window.VendifyInventoryV232, "VendifyInventoryV232");
  const purchasesApi = requireRuntime(window.VendifyPurchasesV232, "VendifyPurchasesV232");
  const salesApi = requireRuntime(window.VendifySalesV232, "VendifySalesV232");
  const cashApi = requireRuntime(window.VendifyCashV232, "VendifyCashV232");
  const branchesApi = requireRuntime(window.VendifyBranchesV232, "VendifyBranchesV232");
  const contextApi = requireRuntime(window.VendifyContextV232, "VendifyContextV232");
  const offlineApi = requireRuntime(
    window.VendifyOfflineCompatV232,
    "VendifyOfflineCompatV232"
  );
  const pwa = requireRuntime(window.VendifyPwaV232, "VendifyPwaV232");

  const productsStore: ProductsStore = productsApi.createStore();
  let editingProductId: string | null = null;
  let productOverSale = false;
  const client = supabaseClient;

  let applicationBootstrap: ApplicationBootstrap;
  let contextAdapter: ApplicationContextAdapter;
  let offlineStorage: ApplicationOfflineStorage;
  let authController: AuthController;
  let inactivityGuard: InactivityGuard;
  let teamController: TeamController;
  let realtimeController: RealtimeController;
  let productsController: ProductsController;
  let scannerController: ScannerController;
  let diagnosticsController: DiagnosticsController;
  let navigationEventsController: ReturnType<CoreApi["createNavigationEventsController"]>;
  let overlayStabilityController: ReturnType<CoreApi["createOverlayStabilityController"]>;
  let dashboardController: DashboardController;
  let dashboardNavigation: DashboardNavigationCoordinator;
  let platformAdminController: PlatformAdminController;
  let commercialFoundationController: CommercialFoundationController;
  let inventoryController: InventoryController;
  let branchAdministrationController: BranchAdministrationController;
  let branchTransferController: BranchTransferController;
  let purchasesController: PurchasesController;
  let discountController: DiscountController;
  let salesHistoryController: SalesHistoryController;
  let posController: PosController;
  let cashController: CashController;
  let activeBranchController: ActiveBranchController;
  let contextPickerController: ContextPickerController;
  let connectionStatusController: ConnectionStatusController;
  let offlineController: OfflineCompatController;

  const formatPrice = (value: unknown): string => core.formatArs(value);
  const showToast = (
    message: string,
    type: "error" | "info" | "success" = "success"
  ): void => {
    core.showToast(message, type);
  };
  const confirm = (
    title: string,
    message: string,
    options: {
      readonly okText?: string | null;
      readonly cancelText?: string;
      readonly danger?: boolean | null;
    } = {}
  ): Promise<boolean> =>
    core.showConfirmation(title, message, options);

  const role = (): string => contextAdapter.get().membership?.role ?? "cashier";
  const businessId = (): string | null => contextAdapter.get().business?.id ?? null;
  const branchId = (): string | null => contextAdapter.get().branch?.id ?? null;

  const loadProducts = async (): Promise<void> => {
    await productsController.loadProducts();
  };
  const loadCategories = async (): Promise<void> => {
    await productsController.loadCategories();
  };
  const renderProducts = (): void => {
    productsController.render();
  };
  const renderCategoryFilter = (): void => {
    productsController.renderCategoryFilter();
  };
  const renderCart = (): void => {
    posController.renderCart();
  };
  const renderSaleProducts = (): void => {
    const container = query("#venta-productos-lista");
    if (!container) return;
    container.innerHTML = productsApi.renderSaleProductsHtml({
      store: productsStore,
      query: input("#venta-buscador")?.value ?? "",
      cart: posController.getCart(),
      formatCurrency: (value) => formatPrice(value)
    });
  };

  const loadCashState = async (): Promise<void> => {
    await cashController.loadState();
  };
  const initializeCash = async (): Promise<void> => {
    await cashController.initialize();
  };
  const openCashPanel = async (): Promise<void> => {
    await cashController.openPanel();
  };
  const renderCashPanel = async (): Promise<void> => {
    await cashController.renderPanel();
  };
  const cashOpenByCurrentUser = (): boolean =>
    cashController.isOpenByCurrentUser();

  const formatDate = (value: unknown): string => {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(String(value)));
    } catch {
      return String(value);
    }
  };

  const loadTheme = (): void => {
    core.loadTheme("kiosco_theme");
  };
  const toggleTheme = (): void => {
    const next = core.toggleTheme("kiosco_theme");
    showToast(
      next === "light" ? "Tema claro activado" : "Tema oscuro activado",
      "info"
    );
  };
  const normalizeProductView = (): void => {
    const container = query("#productos-grid");
    container?.classList.remove("vista-grid");
    container?.classList.add("vista-lista");
    try {
      localStorage.removeItem("vendify_product_view");
    } catch {
      // Old view preference cleanup is best-effort.
    }
  };

  const showEnvironmentError = (message: string): void => {
    let box = query("#vendify-environment-error-vqa");
    if (!box) {
      box = document.createElement("div");
      box.id = "vendify-environment-error-vqa";
      box.className = "vendify-environment-error-vqa";
      document.body.appendChild(box);
    }
    box.innerHTML = `
      <div>
        <strong>Vendify no puede iniciar</strong>
        <p>${core.escapeHtml(message || "Configuración inválida")}</p>
        <small>Revisá supabase-config.js antes de continuar.</small>
      </div>`;
  };

  const validateEnvironment = (): boolean => {
    const expectedRef = __VENDIFY_EXPECTED_SUPABASE_REF__;
    const url = String(SUPABASE_URL || "");
    if (!url || !url.includes(expectedRef)) {
      showEnvironmentError(
        `El frontend está apuntando a otro proyecto de Supabase (${url || "URL desconocida"}).`
      );
      console.error("[Vendify QA] Supabase project mismatch", { url, expectedRef });
      return false;
    }
    return true;
  };

  const activateSettingsTab = (tab = "general"): void => {
    document.querySelectorAll(".config-tab-v224").forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const active = element.dataset.configTab === tab;
      element.classList.toggle("active", active);
      element.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".config-panel-v224").forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const active = element.dataset.configPanel === tab;
      element.classList.toggle("active", active);
      element.hidden = !active;
      element.style.display = active ? "block" : "none";
    });
    const content = query(".config-content-v224");
    if (content instanceof HTMLElement) content.scrollTop = 0;
  };

  const updateDiscountPinState = (): Promise<void> =>
    discountController.updatePinState();

  const openSettings = (tab = "general"): void => {
    productsController.renderCategoryList();
    contextAdapter.updateUi();
    const welcomeBusiness = query("#config-welcome-business");
    if (welcomeBusiness) {
      welcomeBusiness.textContent =
        contextAdapter.get().business?.nombre ?? "Tu negocio";
    }
    activateSettingsTab(tab);
    query("#modal-config")?.classList.remove("hidden");
    void teamController.refreshBusinessAccessCode();
    void updateDiscountPinState();
    void commercialFoundationController.loadPlan();
    void commercialFoundationController.loadOperationalConfig();
    requestAnimationFrame(() => activateSettingsTab(tab));
  };

  const closeSettings = (): void => {
    query("#modal-config")?.classList.add("hidden");
    renderCategoryFilter();
  };

  const openSale = (): void => posController.open();
  const closeSale = (): void => posController.close();
  const addToCart = (id: string): void => posController.addToCart(id);
  const closeSalesHistory = (): void => salesHistoryController.close();
  const renderSalesHistory = async (): Promise<void> => {
    await salesHistoryController.render();
  };

  const activateProductOverSale = (): void => {
    const productModal = query("#modal");
    const saleModal = query("#modal-venta");
    if (!productModal || !saleModal) return;
    productOverSale = true;
    productModal.classList.add("modal-product-over-sale");
    saleModal.classList.add("modal-under-product");
    saleModal.setAttribute("aria-hidden", "true");
  };

  const restoreSaleBehindProduct = (focus = true): void => {
    const productModal = query("#modal");
    const saleModal = query("#modal-venta");
    productModal?.classList.remove("modal-product-over-sale");
    saleModal?.classList.remove("modal-under-product");
    saleModal?.removeAttribute("aria-hidden");
    productOverSale = false;
    if (
      focus &&
      saleModal &&
      !saleModal.classList.contains("hidden")
    ) {
      window.setTimeout(() => input("#venta-buscador")?.focus(), 60);
    }
  };

  const openProduct = (product: Parameters<ProductsController["openEditor"]>[0] = null): void => {
    productsController.openEditor(product);
  };
  const closeProduct = (preserveScannerFlow = false): void => {
    productsController.closeEditor(preserveScannerFlow);
  };

  const isSupervisor = (): boolean =>
    ["owner", "admin", "manager"].includes(role());
  const isOwner = (): boolean => role() === "owner";

  let errorLogThrottle = new Map<string, number>();
  const logClientError = async (
    type: string,
    message: string,
    context: Record<string, unknown> = {}
  ): Promise<void> => {
    if (
      !navigator.onLine
      || !authController.getSession()?.user
      || !businessId()
    ) {
      return;
    }

    const clean = observabilityApi.sanitizeClientErrorMessage(message);
    const key = `${type}:${clean.slice(0, 140)}`;
    const last = errorLogThrottle.get(key) ?? 0;
    if (Date.now() - last < 30_000) return;
    errorLogThrottle.set(key, Date.now());

    try {
      await observabilityApi.logClientError(
        client as Parameters<ObservabilityApi["logClientError"]>[0],
        {
          type,
          message: clean,
          version: "2.31.1",
          context: {
            path: location.pathname,
            role: role(),
            branch_id: branchId(),
            online: navigator.onLine,
            ...context
          }
        }
      );
    } catch {
      // Error telemetry never blocks the product.
    }
  };

  const setupObservability = (): void => {
    window.addEventListener("error", (event) => {
      void logClientError(
        "window_error",
        event.message || event.error?.message || "Error JavaScript",
        {
          file: event.filename ? event.filename.split("/").pop() ?? null : null,
          line: event.lineno || null,
          col: event.colno || null
        }
      );
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason as unknown;
      void logClientError(
        "unhandled_rejection",
        reason instanceof Error ? reason.message : String(reason ?? "Promise rechazada")
      );
    });
  };

  contextAdapter = createApplicationContextAdapter({
    client: client as Parameters<ContextApi["getApp"]>[0],
    getApp: contextApi.getApp,
    getPermissions: contextApi.getPermissions,
    getEmployee: contextApi.getEmployee,
    getSession: () => authController.getSession(),
    showToast,
    setConnectionState: (state, label) =>
      connectionStatusController.setState(state, label)
  });

  realtimeController = realtimeApi.createController({
    client: client as RealtimeDependencies["client"],
    getScope: () => ({
      ready: contextAdapter.get().ready,
      businessId: businessId(),
      branchId: branchId()
    }),
    getVisibility: () => document.visibilityState,
    setStatus: (status) => {
      document.documentElement.dataset.realtimeStatus = status.toLowerCase();
    },
    refreshCatalog: async () => {
      await loadProducts();
      renderCategoryFilter();
      renderProducts();
      contextAdapter.applyPermissions();
      if (!query("#modal-venta")?.classList.contains("hidden")) {
        renderSaleProducts();
        renderCart();
      }
    },
    refreshProducts: async () => {
      await loadProducts();
      renderCategoryFilter();
      renderProducts();
      contextAdapter.applyPermissions();
      if (!query("#modal-venta")?.classList.contains("hidden")) {
        renderSaleProducts();
        renderCart();
      }
    },
    syncStock: async (render) => {
      const currentBranchId = branchId();
      if (!currentBranchId) return false;

      const rows = await listBranchRealtimeStock(
        client as RealtimeStockClientPort,
        currentBranchId
      );
      let changed = false;
      const stockMap = new Map(rows.map((row) => [row.productId, row]));
      for (const product of productsStore.list()) {
        const row = stockMap.get(product.id);
        if (!row) continue;
        if (
          Number(product.stock ?? 0) !== row.stock
          || Number(product.stockMinimo ?? 0) !== row.minimumStock
        ) {
          productsStore.patchStock(
            product.id,
            row.stock,
            row.minimumStock
          );
          changed = true;
        }
      }

      if (changed && render) {
        renderProducts();
        contextAdapter.applyPermissions();
        if (!query("#modal-venta")?.classList.contains("hidden")) {
          renderSaleProducts();
          renderCart();
        }
      }
      return changed;
    },
    refreshSmartStock: async () => {
      await productsController.loadSmartStock();
      renderProducts();
    },
    refreshDependentViews: async () => {
      if (!query("#modal-historial")?.classList.contains("hidden")) {
        await renderSalesHistory();
      }
      await inventoryController.refreshOpenView(false);
      await purchasesController.refreshOpenViews();
      if (!query("#modal-caja-operativa-v227")?.classList.contains("hidden")) {
        await loadCashState();
        await renderCashPanel();
      }
    },
    addWindowListener: (event, listener) =>
      window.addEventListener(event, listener),
    addVisibilityListener: (listener) =>
      document.addEventListener("visibilitychange", listener),
    report: (level, context, error) => {
      const detail = error instanceof Error ? error.message : error;
      console[level](
        `[Vendify Realtime] ${context}`,
        ...(detail === undefined ? [] : [detail])
      );
    },
    notifyCatalogFailure: () =>
      showToast("No se pudieron resincronizar los datos", "error")
  });

  productsController = productsApi.createController({
    client: client as ProductsDependencies["client"],
    store: productsStore,
    getBusinessId: businessId,
    getBranch: () => ({
      id: branchId(),
      name: contextAdapter.get().branch?.nombre ?? "Sucursal"
    }),
    getRole: role,
    hasPermission: contextAdapter.hasPermission,
    requirePermission: contextAdapter.requirePermission,
    showToast,
    confirm: (title, message) => confirm(title, message),
    formatPrice: (value) => formatPrice(value),
    applyPermissions: contextAdapter.applyPermissions,
    loadProductsOffline: () => offlineStorage.restoreCatalog(),
    saveProductsOffline: () => offlineStorage.persistCatalog(),
    captureOfflineStockSnapshot: async (items) => {
      const context = contextAdapter.get();
      if (
        !window.VendifyOfflineV2312?.enabled
        || !context.business?.id
        || !context.branch?.id
      ) {
        return;
      }
      await window.VendifyOfflineV2312.captureStockSnapshot({
        businessId: context.business.id,
        branchId: context.branch.id,
        products: items.map((product) => ({
          productId: product.id,
          serverStock: Number(product.stock ?? 0)
        }))
      });
    },
    refreshOnboarding: () => {
      void commercialFoundationController.refreshOnboarding();
    },
    emitStockChange: realtimeController.emitStockChange,
    scheduleSmartRefresh: realtimeController.scheduleSmartRefresh,
    renderSaleProducts,
    renderCart,
    isSaleOpen: () => !query("#modal-venta")?.classList.contains("hidden"),
    addToCart,
    openInventoryAdjustment: (id, delta) => {
      void inventoryController.openAdjustmentFromProduct(id, delta);
    },
    setEditingProductId: (id) => {
      editingProductId = id;
    },
    getEditingProductId: () => editingProductId,
    restoreSaleBehindProduct,
    shouldReturnCreatedProductToSale: () =>
      scannerController.shouldReturnCreatedProductToSale(),
    clearPendingScannerProduct: () => scannerController.clearPendingProduct(),
    returnToScannerFromEditor: () => scannerController.returnFromProductEditor(),
    onEditorClose: () => dashboardNavigation.complete("product")
  });

  scannerController = productsApi.createScannerController({
    client: client as ScannerDependencies["client"],
    store: productsStore,
    getCart: () => posController.getCart(),
    getBranchId: branchId,
    getEditingProductId: () => editingProductId,
    showToast,
    emitStockChange: realtimeController.emitStockChange,
    renderProducts,
    renderSaleProducts,
    addToCart,
    openProductEditor: (product) => productsController.openEditor(product),
    activateProductOverSale,
    lookupBarcode: (code) => productsController.lookupBarcode(code)
  });

  const onboardingController = core.createOnboardingController({
    onExamples: () => productsController.openCatalog()
  });

  diagnosticsController = observabilityApi.createDiagnosticsController({
    getRole: () => contextAdapter.get().membership?.role ?? null,
    isOnline: () => navigator.onLine,
    getBranchName: () => contextAdapter.get().branch?.nombre ?? null,
    getCashRegisterName: () => contextAdapter.get().cashRegister?.nombre ?? null,
    runDiagnostic: () =>
      contextApi.runDiagnostic(
        client as DiagnosticsDependencies["client"]
      ),
    showToast
  });

  teamController = teamApi.createController({
    client: client as TeamDependencies["client"],
    functions: (client as { readonly functions: TeamDependencies["functions"] }).functions,
    getContext: () => ({
      user: contextAdapter.get().user,
      membership: contextAdapter.get().membership
    }),
    requirePermission: contextAdapter.requirePermission,
    showToast,
    confirm: (title, message) => confirm(title, message),
    roleName: (value) => contextAdapter.roleName(value)
  });

  overlayStabilityController = core.createOverlayStabilityController({
    closeUserMenu: () => navigationEventsController.closeUserMenu(),
    closeManagementMenu: () => navigationEventsController.closeManagementMenu(),
    closeContextPickers: () => contextPickerController.close()
  });

  navigationEventsController = core.createNavigationEventsController({
    toggleTheme,
    exportProducts: () => {
      if (
        !contextAdapter.requirePermission(
          "viewReports",
          "No tenés permiso para exportar información"
        )
      ) {
        return;
      }
      const catalog = productsStore.list();
      if (catalog.length === 0) {
        showToast("No hay productos para exportar", "error");
        return;
      }
      const csv = productsApi.buildCsv(catalog);
      const blob = new Blob(["\uFEFF" + csv], {
        type: "text/csv;charset=utf-8;"
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `vendify-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast("CSV exportado");
    },
    openSettings,
    activateSettingsTab,
    closeSettings,
    openCatalog: () => productsController.openCatalog(),
    openTeam: () => {
      void teamController.open();
    },
    dismissConfirmation: () => core.dismissConfirmation(),
    closeTopOpenModal: (targets) => core.closeTopOpenModal(targets),
    openSale,
    focusProductSearch: () => input("#buscador")?.focus(),
    openProductEditor: () => openProduct(null),
    hasPermission: contextAdapter.hasPermission,
    closeProductEditor: () => closeProduct(),
    closeSale,
    closeSalesHistory,
    closeTeam: () => teamController.close(),
    closeTeamEditor: () => teamController.closeEditor(),
    closeTeamPasswordReset: () => teamController.closePasswordReset(),
    closeScanner: () => scannerController.close(),
    closeContextPickers: () => contextPickerController.close(),
    getCartSize: () => posController.getCart().length,
    confirm: (title, message) => confirm(title, message),
    showToast,
    isModalVisible: (modal) => overlayStabilityController.isModalVisible(modal),
    getAppReady: () => contextAdapter.get().ready
  });

  dashboardController = dashboardApi.createController({
    client: client as DashboardDependencies["client"],
    isSupervisor,
    getBranchId: branchId,
    getBusinessName: () => contextAdapter.get().business?.nombre ?? "Negocio",
    closeManagement: () => navigationEventsController.closeManagementMenu(),
    icon,
    showToast,
    reportError: (type, message) => logClientError(type, message),
    openDestination: async (destination) => {
      if (destination.kind === "sales") {
        dashboardNavigation.begin(destination);
        dashboardController.close();
        await salesHistoryController.open();
        return;
      }
      if (destination.kind === "inventory") {
        if (
          !isSupervisor()
          && !contextAdapter.hasPermission("adjustStock")
        ) {
          showToast("Tu rol no permite administrar inventario", "error");
          return;
        }
        dashboardNavigation.begin(destination);
        dashboardController.close();
        await inventoryController.openFiltered(destination.filter);
        return;
      }
      const product = productsStore.getById(destination.productId);
      if (!product) {
        showToast(
          "El producto ya no está disponible. Actualizamos el Dashboard.",
          "info"
        );
        await dashboardController.load();
        return;
      }
      if (destination.kind === "restock") {
        if (
          !contextAdapter.requirePermission(
            "adjustStock",
            "No tenés permiso para ajustar stock"
          )
        ) return;
        dashboardNavigation.begin(destination);
        dashboardController.close();
        await inventoryController.openAdjustmentFromProduct(destination.productId);
        return;
      }
      if (destination.kind === "product") {
        if (
          !contextAdapter.requirePermission(
            "manageProducts",
            "No tenés permiso para modificar productos"
          )
        ) return;
        dashboardNavigation.begin(destination);
        dashboardController.close();
        productsController.openEditor(product);
        return;
      }
      if (
        destination.kind === "cash"
        && contextAdapter.get().cashRegister?.id
      ) {
        dashboardNavigation.begin(destination);
        dashboardController.close();
        try {
          await cashController.openPanel();
        } catch (error) {
          dashboardNavigation.complete("cash");
          showToast(errorMessage(error, "No se pudo abrir la caja"), "error");
        }
      }
    }
  });

  dashboardNavigation = dashboardApi.createNavigationCoordinator(
    () => dashboardController.open()
  );

  platformAdminController = platformApi.createPlatformAdminController({
    client: client as PlatformDependencies["client"],
    isOnline: () => navigator.onLine,
    closeUserMenu: () => navigationEventsController.closeUserMenu(),
    formatPrice: (value) => formatPrice(value),
    icon,
    showToast
  });

  const downloadText = (
    content: string,
    mime: string,
    filename: string
  ): void => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  commercialFoundationController =
    commercialApi.createCommercialFoundationController({
      client: client as CommercialDependencies["client"],
      getAppReady: () => contextAdapter.get().ready,
      getBusiness: () => contextAdapter.get().business,
      getRole: () => contextAdapter.get().membership?.role ?? null,
      hasPermission: contextAdapter.hasPermission,
      isOnline: () => navigator.onLine,
      persistOfflineContext: contextAdapter.persistOffline,
      applyOfflineState: () => offlineController.applySaleState(),
      openProduct: () => openProduct(null),
      openConfig: openSettings,
      openCash: openCashPanel,
      openSale,
      openTeam: () => teamController.open(),
      reloadDashboardAlertBadge: () => dashboardController.loadAlertBadge(),
      refreshPlatformAccess: () => platformAdminController.refreshAccess(),
      showToast,
      downloadText,
      icon
    });

  inventoryController = inventoryApi.createController({
    client: client as InventoryDependencies["client"],
    canManage: () =>
      isSupervisor() || contextAdapter.hasPermission("adjustStock"),
    isSupervisor,
    hasManualStockPermission: () =>
      contextAdapter.hasPermission("adjustStock"),
    requireManualStockPermission: (message) =>
      contextAdapter.requirePermission("adjustStock", message),
    getBranch: () => ({
      id: branchId(),
      name: contextAdapter.get().branch?.nombre ?? "Sucursal"
    }),
    listBranches: async () =>
      activeBranchController.getBranches().map((branch) => ({
        id: branch.id,
        nombre: branch.name
      })) as unknown as Awaited<ReturnType<InventoryDependencies["listBranches"]>>,
    getProducts: () =>
      productsStore.list() as unknown as ReturnType<InventoryDependencies["getProducts"]>,
    mapProduct: (record) =>
      productsApi.mapProductRow(record) as unknown as ReturnType<InventoryDependencies["mapProduct"]>,
    productLabel: (product) =>
      productsApi.productLabel(product as Parameters<ProductsApi["productLabel"]>[0]),
    formatDate,
    isLowStock: (product) =>
      productsController.isLowStock(
        product as Parameters<ProductsController["isLowStock"]>[0]
      ),
    isOutOfStock: (product) =>
      productsController.isOutOfStock(
        product as Parameters<ProductsController["isOutOfStock"]>[0]
      ),
    getSmartStock: (product) =>
      productsController.getSmartStock(
        product as Parameters<ProductsController["getSmartStock"]>[0]
      ) as unknown as ReturnType<InventoryDependencies["getSmartStock"]>,
    showToast,
    confirm: (title, message) => confirm(title, message),
    emitStockChange: realtimeController.emitStockChange,
    reloadProducts: loadProducts,
    renderProducts,
    onClose: () => {
      dashboardNavigation.complete("inventory");
      dashboardNavigation.complete("restock");
    }
  });

  branchAdministrationController =
    branchesApi.createBranchAdministrationController({
      client: client as BranchAdministrationDependencies["client"],
      getRole: () => contextAdapter.get().membership?.role ?? null,
      getCurrentBranchId: branchId,
      refreshBranches: () => activeBranchController.refresh(),
      reloadCashRegisters: ({ keep }) =>
        cashController.loadRegisters({ keep }),
      showToast
    });

  branchTransferController = inventoryApi.createBranchTransferController({
    client: client as BranchTransferDependencies["client"],
    canManage: isSupervisor,
    getActiveBranchId: branchId,
    listBranches: async () =>
      activeBranchController.getBranches().map((branch) => ({
        id: branch.id,
        nombre: branch.name
      })) as unknown as Awaited<ReturnType<BranchTransferDependencies["listBranches"]>>,
    mapProduct: (record) =>
      productsApi.mapProductRow(record) as unknown as ReturnType<BranchTransferDependencies["mapProduct"]>,
    productLabel: (product) =>
      productsApi.productLabel(product as Parameters<ProductsApi["productLabel"]>[0]),
    showToast,
    emitStockChange: realtimeController.emitStockChange,
    reloadProducts: loadProducts,
    renderProducts,
    refreshBranchSettings: () => branchAdministrationController.render()
  });

  purchasesController = purchasesApi.createController({
    client: client as PurchasesDependencies["client"],
    canManage: isSupervisor,
    getBranch: () => ({
      id: branchId(),
      name: contextAdapter.get().branch?.nombre ?? "Sucursal"
    }),
    listBranches: async () =>
      activeBranchController.getBranches().map((branch) => ({
        id: branch.id,
        nombre: branch.name
      })) as unknown as Awaited<ReturnType<PurchasesDependencies["listBranches"]>>,
    getProducts: () =>
      productsStore.list() as unknown as ReturnType<PurchasesDependencies["getProducts"]>,
    productLabel: (product) =>
      productsApi.productLabel(product as Parameters<ProductsApi["productLabel"]>[0]),
    formatDate,
    showToast,
    confirm: (title, message) => confirm(title, message),
    emitStockChange: realtimeController.emitStockChange,
    reloadProducts: loadProducts,
    renderProducts
  });

  discountController = salesApi.createDiscountController({
    client: client as DiscountDependencies["client"],
    getBranchId: branchId,
    getRole: () => contextAdapter.get().membership?.role ?? null,
    isAppReady: () => contextAdapter.get().ready,
    getSubtotal: () => posController.getTotal(),
    formatCurrency: (value) => formatPrice(value),
    icon,
    showToast,
    recalculateTotals: () => posController.updateTotals()
  });

  salesHistoryController = salesApi.createHistoryController({
    client: client as HistoryDependencies["client"],
    getContext: () => ({
      businessName: contextAdapter.get().business?.nombre ?? "Negocio",
      branchId: branchId(),
      branchName: contextAdapter.get().branch?.nombre ?? "",
      cashRegisterId: contextAdapter.get().cashRegister?.id ?? null,
      cashRegisterName: contextAdapter.get().cashRegister?.nombre ?? "",
      role: role()
    }),
    isCashOpenByCurrentUser: cashOpenByCurrentUser,
    openCashPanel,
    formatCurrency: (value) => formatPrice(value),
    showToast,
    getAutoPrint: () => commercialFoundationController.getAutoPrint(),
    getTicketWidth: () => commercialFoundationController.getTicketWidth(),
    emitStockChange: realtimeController.emitStockChange,
    reloadProducts: loadProducts,
    renderProducts,
    reloadCash: loadCashState,
    onClose: () => dashboardNavigation.complete("sales")
  });

  posController = salesApi.createPosController({
    client: client as PosDependencies["client"],
    discount: discountController,
    getContext: () => ({
      ready: contextAdapter.get().ready,
      branchId: branchId(),
      cashRegisterId: contextAdapter.get().cashRegister?.id ?? null
    }),
    canSell: (message) => contextAdapter.requirePermission("sell", message),
    getProducts: () =>
      productsStore.list() as unknown as ReturnType<PosDependencies["getProducts"]>,
    isCashOpenByCurrentUser: cashOpenByCurrentUser,
    hasCashSession: () => Boolean(cashController.getState()?.sesion),
    restoreOfflineCash: () => offlineController.restoreCashProof(),
    openCashPanel: () => {
      void openCashPanel();
    },
    isOnline: () => navigator.onLine,
    formatCurrency: (value) => formatPrice(value),
    showToast,
    renderSaleProducts,
    persistCart: () => offlineStorage.persistCart(),
    applyOfflineSaleState: () => offlineController.applySaleState(),
    validateOfflinePayments: (payments) =>
      offlineController.validatePayments(payments),
    registerOfflineSale: (items, payments, totals, observation) =>
      offlineController.registerSale(items, payments, totals, observation),
    updateOfflineUi: () => offlineController.updateUi(),
    clearPersistedCart: () => offlineStorage.clearPersistedCart(),
    reloadProducts: loadProducts,
    renderProducts,
    reloadCash: loadCashState,
    emitStockChange: realtimeController.emitStockChange,
    refreshDependentViews: realtimeController.refreshDependentViews,
    showTicket: (data) => salesHistoryController.showTicket(data),
    afterOnlineSale: () => {
      void commercialFoundationController.refreshOnboarding();
      void dashboardController.loadAlertBadge();
    }
  });

  cashController = cashApi.createController({
    client: client as CashDependencies["client"],
    getContext: () => ({
      businessId: businessId(),
      branch: {
        id: branchId(),
        name: contextAdapter.get().branch?.nombre ?? "Sucursal"
      },
      cashRegister: {
        id: contextAdapter.get().cashRegister?.id ?? null,
        name: contextAdapter.get().cashRegister?.nombre ?? "Caja"
      }
    }),
    setCashRegister: (cashRegister) =>
      contextAdapter.setCashRegister(cashRegister),
    getCartSize: () => posController.getCart().length,
    clearCart: () => {
      posController.clearCart();
      renderCart();
    },
    confirm: (title, message) => confirm(title, message),
    showToast,
    formatCurrency: (value) => formatPrice(value),
    icon,
    updateContextLabels: () => contextPickerController.updateLabels(),
    persistOfflineContext: contextAdapter.persistOffline,
    restoreOfflineState: () => offlineController.restoreCashProof(),
    persistOfflineState: () => offlineController.persistCashProof(),
    isOnline: () => navigator.onLine,
    onPanelClose: () => dashboardNavigation.complete("cash")
  });

  activeBranchController = branchesApi.createActiveBranchController({
    client: client as ActiveBranchDependencies["client"],
    getBusinessId: businessId,
    getCurrentBranchId: branchId,
    getCartSize: () => posController.getCart().length,
    setContext: ({ branch, cashRegister }) =>
      contextAdapter.setBranchAndCash(branch, cashRegister),
    updateContextUi: contextAdapter.updateUi,
    confirm: (title, message) => confirm(title, message),
    showToast,
    clearCart: () => posController.clearCart(),
    loadCashRegisters: ({ keep }) => cashController.loadRegisters({ keep }),
    renderContextBranchOptions: () => contextPickerController.renderBranchOptions(),
    renderContextCashOptions: () => contextPickerController.renderCashOptions(),
    updateContextLabels: () => contextPickerController.updateLabels(),
    persistOfflineContext: contextAdapter.persistOffline,
    loadProducts,
    updateCategoryFilter: renderCategoryFilter,
    renderProducts,
    renderSaleProducts,
    isSaleModalVisible: () => !query("#modal-venta")?.classList.contains("hidden"),
    subscribeRealtime: () => realtimeController.subscribe(),
    storage: localStorage,
    document
  });

  contextPickerController = contextApi.createContextPickerController({
    getContext: () => ({
      branch: {
        id: branchId(),
        name: contextAdapter.get().branch?.nombre ?? ""
      },
      cashRegister: {
        id: contextAdapter.get().cashRegister?.id ?? null,
        name: contextAdapter.get().cashRegister?.nombre ?? ""
      }
    }),
    getBranches: () => activeBranchController.getBranches(),
    selectBranch: (id) => activeBranchController.select(id),
    selectCash: async (id) => {
      const selector = select("#cash-selector-v227");
      if (!selector) return;
      selector.value = id;
      await cashController.selectRegister(id);
    },
    renderCashOptions: () => cashController.renderOptions(),
    closeUserMenu: () => navigationEventsController.closeUserMenu(),
    closeManagementMenu: () => navigationEventsController.closeManagementMenu(),
    positionPopover: navigationEventsController.positionPopover,
    icon
  });

  let syncInFlight: Promise<boolean> | null = null;
  const syncAll = async (showSuccessToast = false): Promise<boolean> => {
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
      if (!navigator.onLine) {
        connectionStatusController.setState("offline");
        if (showSuccessToast) showToast("No hay conexión a internet", "info");
        return false;
      }

      connectionStatusController.setState("syncing");
      try {
        await loadProducts();
        renderProducts();
        if (contextAdapter.get().cashRegister?.id) await loadCashState();
        if (!query("#modal-historial")?.classList.contains("hidden")) {
          await renderSalesHistory();
        }
        await inventoryController.refreshOpenView();
        await purchasesController.refreshOpenViews();
        connectionStatusController.setState("online");
        if (showSuccessToast) showToast("Datos sincronizados", "success");
        return true;
      } catch (error) {
        console.error("[Vendify Stability] sync:", error);
        connectionStatusController.setState("error");
        if (showSuccessToast) {
          showToast(errorMessage(error, "No se pudo sincronizar"), "error");
        }
        return false;
      }
    })().finally(() => {
      syncInFlight = null;
    });
    return syncInFlight;
  };

  connectionStatusController = offlineApi.createConnectionStatusController({
    isOnline: () => navigator.onLine,
    getPendingOfflineSalesCount: () => offlineController.readLegacySales().length,
    syncPendingOfflineSales: () =>
      offlineController.sync({
        mostrarResumen: true,
        incluirRevision: true
      }),
    syncAll
  });

  offlineController = offlineApi.createController({
    client: client as OfflineDependencies["client"],
    storage: localStorage,
    getContext: () => ({
      ready: contextAdapter.get().ready,
      userId: authController.getSession()?.user?.id ?? null,
      businessId: businessId(),
      branchId: branchId(),
      cashRegisterId: contextAdapter.get().cashRegister?.id ?? null
    }),
    getProducts: () =>
      productsStore.list() as unknown as ReturnType<OfflineDependencies["getProducts"]>,
    updateProductStock: (productId, stock) =>
      productsStore.patchStock(productId, stock),
    getCartSize: () => posController.getCart().length,
    isSaleConfirming: () => posController.isConfirming(),
    hasSellPermission: () => contextAdapter.hasPermission("sell"),
    isCashOpenByCurrentUser: cashOpenByCurrentUser,
    getCashState: () =>
      cashController.getState() as unknown as ReturnType<OfflineDependencies["getCashState"]>,
    setCashState: (state) =>
      cashController.setState(
        state as unknown as Parameters<CashController["setState"]>[0]
      ),
    ensureRequestId: () => posController.ensureRequestId(),
    clearPersistedCart: () => offlineStorage.clearPersistedCart(),
    persistProducts: () => offlineStorage.persistCatalog(),
    persistCart: () => offlineStorage.persistCart(),
    renderProducts,
    renderSaleProducts,
    renderCashHeader: () => cashController.renderHeader(),
    renderCart,
    reloadProducts: loadProducts,
    reloadCash: loadCashState,
    reloadCommercialFoundation: () => commercialFoundationController.load(),
    setConnectionState: (state, label) =>
      connectionStatusController.setState(state, label),
    showToast: (message, type) =>
      showToast(
        message,
        type === "error" || type === "info" ? type : "success"
      )
  });

  offlineStorage = createApplicationOfflineStorage({
    getUserId: () => authController.getSession()?.user?.id ?? null,
    getContext: contextAdapter.get,
    productsStore,
    pos: posController,
    serializeCatalog: productsApi.serializeOfflineCache,
    parseCatalog: productsApi.parseOfflineCache,
    migrateLegacyCatalog: productsApi.migrateLegacyOfflineCache
  });

  const setupCsvImport = (): void => {
    const downloadTemplate = (): void => {
      const csv = [
        "nombre,marca,presentacion,categoria,codigo_barras,precio_compra,precio_venta,stock",
        '"Coca-Cola Original 500 ml","Coca-Cola","500 ml","Gaseosas","7790000000000","800","1200","24"',
        '"Alfajor Triple","Marca","80 g","Golosinas","","500","850","12"'
      ].join("\n");
      downloadText(
        "\uFEFF" + csv,
        "text/csv;charset=utf-8",
        "vendify-plantilla-productos.csv"
      );
    };

    const importCsv = async (file: File): Promise<void> => {
      if (!contextAdapter.hasPermission("manageProducts")) {
        showToast("No tenés permiso para importar productos", "error");
        return;
      }
      const text = await file.text();
      const lines = text
        .replace(/^\uFEFF/u, "")
        .split(/\r?\n/u)
        .filter((line) => line.trim().length > 0);
      if (lines.length < 2) {
        showToast("El CSV está vacío", "error");
        return;
      }
      if (lines.length > 2001) {
        showToast("Importá como máximo 2000 productos por archivo", "error");
        return;
      }

      const headers = productsApi
        .parseCsvLine(lines[0] ?? "")
        .map(productsApi.normalizeCsvHeader);
      const index = (name: string): number => headers.indexOf(name);
      if (index("nombre") < 0) {
        showToast('El CSV necesita una columna "nombre"', "error");
        return;
      }
      const numeric = (value: string | undefined): number => {
        const parsed = Number(String(value ?? "").replace(",", "."));
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const items = lines.slice(1).flatMap((line) => {
        const row = productsApi.parseCsvLine(line);
        const name = row[index("nombre")] ?? "";
        if (!name.trim()) return [];
        return [{
          nombre: name,
          marca: index("marca") >= 0 ? row[index("marca")] ?? "" : "",
          presentacion:
            index("presentacion") >= 0 ? row[index("presentacion")] ?? "" : "",
          categoria:
            index("categoria") >= 0 ? row[index("categoria")] ?? "" : "",
          codigo_barras:
            index("codigo_barras") >= 0 ? row[index("codigo_barras")] ?? "" : "",
          precio_compra:
            index("precio_compra") >= 0
              ? numeric(row[index("precio_compra")])
              : 0,
          precio_venta:
            index("precio_venta") >= 0
              ? numeric(row[index("precio_venta")])
              : 0,
          stock:
            index("stock") >= 0
              ? Math.max(0, Math.trunc(numeric(row[index("stock")])))
              : 0
        }];
      });

      if (items.length === 0) {
        showToast("No se encontraron productos válidos", "error");
        return;
      }

      const accepted = await confirm(
        "Importar catálogo",
        `Se procesarán ${items.length} productos en ${
          contextAdapter.get().branch?.nombre ?? "la sucursal activa"
        }.`,
        { okText: "Importar", cancelText: "Cancelar" }
      );
      if (!accepted) return;

      const importButton = button("#btn-import-csv-v231");
      if (importButton) {
        importButton.disabled = true;
        importButton.textContent = "Importando...";
      }

      try {
        const data = await productsApi.importBulkCatalog(
          client as Parameters<ProductsApi["importBulkCatalog"]>[0],
          branchId() ?? "",
          items
        );
        await loadCategories();
        await loadProducts();
        renderCategoryFilter();
        renderProducts();
        await commercialFoundationController.refreshOnboarding();
        const record =
          typeof data === "object" && data !== null && !Array.isArray(data)
            ? data as Record<string, unknown>
            : {};
        showToast(
          `${Number(record.importados ?? 0)} producto(s) importados · ${
            Number(record.omitidos ?? 0)
          } omitidos`,
          "success"
        );
      } catch (error) {
        showToast(errorMessage(error, "No se pudo importar el CSV"), "error");
      } finally {
        if (importButton) {
          importButton.disabled = false;
          importButton.innerHTML = `${icon("upload")}<span>Importar CSV</span>`;
        }
      }
    };

    query("#btn-template-csv-v231")
      ?.addEventListener("click", downloadTemplate);
    query("#btn-import-csv-v231")?.addEventListener("click", () => {
      input("#input-import-csv-v231")?.click();
    });
    input("#input-import-csv-v231")?.addEventListener("change", (event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLInputElement)) return;
      const file = target.files?.[0];
      target.value = "";
      if (file) void importCsv(file);
    });
  };

  authController = authApi.createController({
    auth: (client as { readonly auth: AuthDependencies["auth"] }).auth,
    showApp: (session) => applicationBootstrap.bootAuthenticated(session),
    beforeSignOut: () => contextAdapter.clear(),
    handleSignedOut: () => applicationBootstrap.handleSignedOut(),
    showToast,
    icon
  });

  inactivityGuard = authApi.createInactivityGuard({
    getSession: () => authController.getSession(),
    signOut: () => authController.signOut(),
    showToast
  });

  const showApplicationShell = (): void => {
    query("#auth-screen")?.classList.add("hidden");
    query(".app")?.classList.remove("hidden");
  };

  const bootOfflineAuthenticated = (): void => {
    offlineStorage.restoreCatalog();
    renderCategoryFilter();
    renderProducts();
    contextAdapter.applyPermissions();
    contextPickerController.updateLabels();
    offlineController.restoreCashProof();
    offlineController.updateUi();
    if (offlineStorage.restoreCart()) renderCart();
    offlineController.applySaleState();
  };

  const bootOnlineAuthenticated = async (): Promise<void> => {
    await activeBranchController.initialize();
    await initializeCash();
    await loadCategories();
    await loadProducts();
    renderCategoryFilter();
    renderProducts();
    contextAdapter.applyPermissions();
    if (offlineStorage.restoreCart()) renderCart();
    realtimeController.subscribe();
    await commercialFoundationController.load();
  };

  applicationBootstrap = createApplicationBootstrap({
    validateEnvironment,
    setupSteps: [
      {
        name: "service-worker",
        run: () => pwa.registerServiceWorker()
      },
      { name: "theme", run: loadTheme },
      { name: "product-view", run: normalizeProductView },
      {
        name: "navigation-events",
        run: () => navigationEventsController.setup()
      },
      { name: "auth", run: () => authController.setup() },
      { name: "team", run: () => teamController.setup() },
      {
        name: "products-scanner",
        run: () => {
          productsController.setup();
          scannerController.setup();
        }
      },
      { name: "discount", run: () => discountController.setup() },
      { name: "pos", run: () => posController.setup() },
      { name: "sales-history", run: () => salesHistoryController.setup() },
      { name: "active-branch", run: () => activeBranchController.setup() },
      { name: "branch-transfer", run: () => branchTransferController.setup() },
      {
        name: "branch-administration",
        run: () => branchAdministrationController.setup()
      },
      { name: "cash", run: () => cashController.setup() },
      { name: "context-picker", run: () => contextPickerController.setup() },
      { name: "inventory", run: () => inventoryController.setup() },
      { name: "purchases", run: () => purchasesController.setup() },
      { name: "inactivity", run: () => inactivityGuard.start() },
      {
        name: "connection-overlay",
        run: () => {
          connectionStatusController.setup();
          overlayStabilityController.setup();
        }
      },
      { name: "diagnostics", run: () => diagnosticsController.setup() },
      { name: "observability", run: setupObservability },
      { name: "offline", run: () => offlineController.setup() },
      { name: "dashboard", run: () => dashboardController.setup() },
      {
        name: "commercial",
        run: () => commercialFoundationController.setup()
      },
      { name: "platform", run: () => platformAdminController.setup() },
      { name: "product-csv", run: setupCsvImport },
      { name: "realtime-watchdog", run: () => realtimeController.startWatchdog() },
      { name: "pwa-install", run: () => pwa.setupInstallPrompt() },
      { name: "onboarding", run: () => onboardingController.setup() }
    ],
    initializeAuth: () => authController.initialize(),
    reportAsyncError: (error) => {
      console.error("[Vendify bootstrap] Auth initialization failed", error);
    },
    showApplicationShell,
    loadContext: async () => {
      await contextAdapter.load();
    },
    isContextReady: () => contextAdapter.get().ready,
    isOfflineAuthenticatedMode: () =>
      !navigator.onLine && contextAdapter.get().offlineMode === true,
    bootOfflineAuthenticated,
    bootOnlineAuthenticated,
    showContextLoadError: (error) => {
      console.error(error);
      showToast(
        "No se pudo cargar el negocio: "
          + errorMessage(error, "Error de contexto"),
        "error"
      );
    },
    cleanupContext: () => {
      contextAdapter.clear();
      errorLogThrottle = new Map<string, number>();
    },
    clearProducts: () => productsStore.clear(),
    clearCart: () => posController.clearCart(),
    disconnectRealtime: () => realtimeController.disconnect()
  });

  return Object.freeze({
    bootstrap: applicationBootstrap,
    controllers: Object.freeze({
      auth: authController,
      inactivity: inactivityGuard,
      team: teamController,
      realtime: realtimeController,
      products: productsController,
      scanner: scannerController,
      diagnostics: diagnosticsController,
      dashboard: dashboardController,
      platform: platformAdminController,
      commercial: commercialFoundationController,
      inventory: inventoryController,
      branchTransfer: branchTransferController,
      purchases: purchasesController,
      discount: discountController,
      salesHistory: salesHistoryController,
      pos: posController,
      cash: cashController,
      activeBranch: activeBranchController,
      branchAdministration: branchAdministrationController,
      contextPicker: contextPickerController,
      connectionStatus: connectionStatusController,
      offline: offlineController
    })
  });
}
