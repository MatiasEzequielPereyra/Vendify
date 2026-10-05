import {
  getBranchContext,
  listAppBranches,
  type ContextRecord,
  type ContextRpcClientPort
} from "../context/context-service.js";

type ToastType = "error" | "info" | "success";

interface ActiveBranchContext {
  readonly branch: ContextRecord | null;
  readonly cashRegister: ContextRecord | null;
}

interface ActiveBranchLogger {
  error(...args: unknown[]): void;
}

export interface ActiveBranchSummary {
  readonly id: string;
  readonly name: string;
}

export interface ActiveBranchControllerDependencies {
  readonly client: ContextRpcClientPort;
  readonly getBusinessId: () => string | null;
  readonly getCurrentBranchId: () => string | null;
  readonly getCartSize: () => number;
  readonly setContext: (context: ActiveBranchContext) => void;
  readonly updateContextUi: () => void;
  readonly confirm: (title: string, message: string) => Promise<boolean>;
  readonly showToast: (message: string, type: ToastType) => void;
  readonly clearCart: () => void;
  readonly loadCashRegisters: (
    options: { readonly keep: boolean }
  ) => Promise<void>;
  readonly renderContextBranchOptions: () => void;
  readonly renderContextCashOptions: () => void;
  readonly updateContextLabels: () => void;
  readonly persistOfflineContext: () => void;
  readonly loadProducts: () => Promise<void>;
  readonly updateCategoryFilter: () => void;
  readonly renderProducts: () => void;
  readonly renderSaleProducts: () => void;
  readonly isSaleModalVisible: () => boolean;
  readonly subscribeRealtime: () => void;
  readonly storage?: Storage;
  readonly document?: Document;
  readonly logger?: ActiveBranchLogger;
}

export interface ActiveBranchController {
  readonly setup: () => void;
  readonly initialize: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly select: (branchId: string) => Promise<void>;
  readonly getBranches: () => ActiveBranchSummary[];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return "";
}

function recordOrNull(value: unknown): ContextRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as ContextRecord
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function branchSummary(record: ContextRecord): ActiveBranchSummary {
  return Object.freeze({
    id: text(record.id),
    name: text(record.nombre ?? record.name)
  });
}

function branchName(branch: ContextRecord | null): string {
  return text(branch?.nombre ?? branch?.name);
}

function branchId(branch: ContextRecord | null): string {
  return text(branch?.id);
}

export function createActiveBranchController(
  dependencies: ActiveBranchControllerDependencies
): ActiveBranchController {
  const documentRef = dependencies.document ?? globalThis.document;
  const storage = dependencies.storage ?? globalThis.localStorage;
  const logger = dependencies.logger ?? console;
  let branches: ActiveBranchSummary[] = [];
  let setupComplete = false;

  function selector(): HTMLSelectElement | null {
    return documentRef.getElementById(
      "branch-selector-v226"
    ) as HTMLSelectElement | null;
  }

  function renderSelector(): void {
    const element = selector();
    if (!element) return;

    const options = branches.map((branch) => {
      const option = documentRef.createElement("option");
      option.value = branch.id;
      option.textContent = branch.name;
      return option;
    });

    element.replaceChildren(...options);

    const currentBranchId = dependencies.getCurrentBranchId();
    if (currentBranchId) element.value = currentBranchId;

    dependencies.renderContextBranchOptions();
    dependencies.updateContextLabels();
  }

  async function loadBranches(): Promise<ActiveBranchSummary[]> {
    const records = await listAppBranches(dependencies.client);
    return records.map(branchSummary);
  }

  async function switchBranch(
    targetBranchId: string,
    { reload = true }: { readonly reload?: boolean } = {}
  ): Promise<ActiveBranchContext> {
    const data = await getBranchContext(
      dependencies.client,
      targetBranchId
    );
    const branch = recordOrNull(data.branch);
    const cashRegister = recordOrNull(data.cashRegister);

    dependencies.setContext({ branch, cashRegister });

    const businessId = dependencies.getBusinessId();
    const confirmedBranchId = branchId(branch);
    if (businessId && confirmedBranchId) {
      storage.setItem(
        `vendify_branch_${businessId}`,
        confirmedBranchId
      );
    }

    const element = selector();
    if (element) element.value = confirmedBranchId;

    dependencies.updateContextUi();
    await dependencies.loadCashRegisters({ keep: true });
    dependencies.renderContextBranchOptions();
    dependencies.renderContextCashOptions();
    dependencies.updateContextLabels();
    dependencies.persistOfflineContext();

    if (reload) {
      dependencies.clearCart();
      await dependencies.loadProducts();
      dependencies.updateCategoryFilter();
      dependencies.renderProducts();
      if (dependencies.isSaleModalVisible()) {
        dependencies.renderSaleProducts();
      }
    }

    dependencies.subscribeRealtime();
    return { branch, cashRegister };
  }

  async function initialize(): Promise<void> {
    try {
      branches = await loadBranches();
    } catch (error) {
      logger.error("[V2.26] listarSucursales:", error);
      return;
    }

    renderSelector();
    if (!branches.length) return;

    const businessId = dependencies.getBusinessId();
    const key = businessId ? `vendify_branch_${businessId}` : null;
    const persisted = key ? storage.getItem(key) : null;
    const currentBranchId = dependencies.getCurrentBranchId();

    const target =
      branches.find((branch) => branch.id === persisted) ??
      branches.find((branch) => branch.id === currentBranchId) ??
      branches[0];

    if (target && target.id !== currentBranchId) {
      await switchBranch(target.id, { reload: false });
    }

    const element = selector();
    const activeBranchId = dependencies.getCurrentBranchId();
    if (element && activeBranchId) {
      element.value = activeBranchId;
    }
  }

  async function select(targetBranchId: string): Promise<void> {
    const currentBranchId = dependencies.getCurrentBranchId();
    if (!targetBranchId || targetBranchId === currentBranchId) return;

    if (dependencies.getCartSize() > 0) {
      const confirmed = await dependencies.confirm(
        "Cambiar de sucursal",
        "El carrito actual se vaciará al cambiar de sucursal."
      );

      if (!confirmed) {
        const element = selector();
        if (element) element.value = currentBranchId ?? "";
        return;
      }
    }

    try {
      const context = await switchBranch(targetBranchId, {
        reload: true
      });
      dependencies.showToast(
        `Sucursal activa: ${branchName(context.branch)}`,
        "success"
      );
    } catch (error) {
      const element = selector();
      if (element) element.value = currentBranchId ?? "";
      dependencies.showToast(errorMessage(error), "error");
    }
  }

  async function refresh(): Promise<void> {
    try {
      branches = await loadBranches();
      renderSelector();

      const currentBranchId = dependencies.getCurrentBranchId();
      if (
        currentBranchId &&
        !branches.some((branch) => branch.id === currentBranchId) &&
        branches[0]
      ) {
        await switchBranch(branches[0].id, { reload: true });
      }
    } catch (error) {
      logger.error("[V2.26] refrescar sucursales:", error);
    }
  }

  function getBranches(): ActiveBranchSummary[] {
    return branches.map((branch) => ({ ...branch }));
  }

  function setup(): void {
    if (setupComplete) return;
    const element = selector();
    if (!element) return;

    element.addEventListener("change", (event) => {
      const target = event.target as HTMLSelectElement | null;
      void select(target?.value ?? "");
    });
    setupComplete = true;
  }

  return Object.freeze({
    setup,
    initialize,
    refresh,
    select,
    getBranches
  });
}
