import { escapeHtml, queryOne } from "../core/dom.js";
import {
  listTransferProducts,
  transferInventoryStock,
  type InventoryRecord,
  type InventoryRpcClientPort
} from "./inventory-service.js";

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface BranchTransferControllerDependencies {
  readonly client: InventoryRpcClientPort;
  readonly canManage: () => boolean;
  readonly getActiveBranchId: () => string | null;
  readonly listBranches: () => Promise<InventoryRecord[]>;
  readonly mapProduct: (record: InventoryRecord) => InventoryRecord;
  readonly productLabel: (product: InventoryRecord) => string;
  readonly showToast: (message: string, type: "error" | "info" | "success") => void;
  readonly emitStockChange: (reason: string) => void;
  readonly reloadProducts: () => Promise<void>;
  readonly renderProducts: () => void;
  readonly refreshBranchSettings: () => Promise<void>;
}

export interface BranchTransferController {
  readonly setup: () => void;
}

function field(selector: string): FormField | null {
  const element = queryOne(selector);
  return element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
    ? element
    : null;
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function number(value: unknown): number {
  return Number(value ?? 0);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createBranchTransferController(
  dependencies: BranchTransferControllerDependencies
): BranchTransferController {
  let products: InventoryRecord[] = [];
  let submissionInProgress = false;
  let setupComplete = false;

  function setError(message: string): void {
    const element = queryOne("#transfer-error-v226");
    if (element) element.textContent = message;
  }

  function close(): void {
    queryOne("#modal-transferencia-v226")?.classList.add("hidden");
  }

  function updateAvailable(): void {
    const productId = field("#transfer-producto-v226")?.value;
    const product = products.find((item) => text(item.id) === productId);
    const element = queryOne("#transfer-stock-disponible-v226");
    if (element) {
      element.textContent = product
        ? `Disponible en origen: ${String(number(product.stock))}`
        : "";
    }
  }

  async function loadProducts(): Promise<void> {
    const originId = field("#transfer-origen-v226")?.value;
    const select = field("#transfer-producto-v226");
    if (!originId || !(select instanceof HTMLSelectElement)) return;

    try {
      const rows = await listTransferProducts(dependencies.client, originId);
      products = rows.map(dependencies.mapProduct);
      select.innerHTML = products.map((product) =>
        `<option value="${escapeHtml(text(product.id))}">${
          escapeHtml(dependencies.productLabel(product))
        } · stock ${String(number(product.stock))}</option>`
      ).join("");
      setError("");
      updateAvailable();
    } catch (error) {
      products = [];
      select.innerHTML = "";
      updateAvailable();
      const message = errorMessage(error, "No se pudieron cargar los productos");
      setError(message);
      dependencies.showToast(message, "error");
    }
  }

  async function open(): Promise<void> {
    if (!dependencies.canManage()) {
      dependencies.showToast("No tenés permiso para transferir stock", "error");
      return;
    }

    try {
      const branches = await dependencies.listBranches();
      if (branches.length < 2) {
        dependencies.showToast("Necesitás al menos dos sucursales activas", "info");
        return;
      }

      const origin = field("#transfer-origen-v226");
      const destination = field("#transfer-destino-v226");
      if (!(origin instanceof HTMLSelectElement) || !(destination instanceof HTMLSelectElement)) {
        throw new Error("No se encontró el formulario de transferencia");
      }

      const options = branches.map((branch) =>
        `<option value="${escapeHtml(text(branch.id))}">${escapeHtml(text(branch.nombre))}</option>`
      ).join("");
      origin.innerHTML = options;
      destination.innerHTML = options;
      origin.value = dependencies.getActiveBranchId() ?? text(branches[0]?.id);
      destination.value = text(
        branches.find((branch) => text(branch.id) !== origin.value)?.id,
        text(branches[0]?.id)
      );
      const quantity = field("#transfer-cantidad-v226");
      if (quantity) quantity.value = "1";
      setError("");
      await loadProducts();
      queryOne("#modal-transferencia-v226")?.classList.remove("hidden");
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo abrir la transferencia"), "error");
    }
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (submissionInProgress) return;

    const originId = field("#transfer-origen-v226")?.value ?? "";
    const destinationId = field("#transfer-destino-v226")?.value ?? "";
    const productId = field("#transfer-producto-v226")?.value ?? "";
    const quantity = Number(field("#transfer-cantidad-v226")?.value);
    setError("");

    submissionInProgress = true;
    const submitter = event instanceof SubmitEvent && event.submitter instanceof HTMLButtonElement
      ? event.submitter
      : null;
    if (submitter) submitter.disabled = true;

    try {
      await transferInventoryStock(dependencies.client, {
        productId,
        originId,
        destinationId,
        quantity,
        reason: "Transferencia entre sucursales"
      });
      close();
      dependencies.emitStockChange("transferencia");
      const currentBranch = dependencies.getActiveBranchId();
      if (currentBranch === originId || currentBranch === destinationId) {
        await dependencies.reloadProducts();
        dependencies.renderProducts();
      }
      await dependencies.refreshBranchSettings();
      dependencies.showToast("Stock transferido", "success");
    } catch (error) {
      setError(errorMessage(error, "No se pudo transferir el stock"));
    } finally {
      submissionInProgress = false;
      if (submitter) submitter.disabled = false;
    }
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#btn-transferir-stock-v226")?.addEventListener("click", () => void open());
    queryOne("#form-transferencia-v226")?.addEventListener("submit", (event) => void submit(event));
    queryOne("#btn-cerrar-transferencia-v226")?.addEventListener("click", close);
    queryOne("#btn-cancelar-transferencia-v226")?.addEventListener("click", close);
    queryOne("#modal-transferencia-v226 .modal-backdrop")?.addEventListener("click", close);
    queryOne("#transfer-origen-v226")?.addEventListener("change", () => void loadProducts());
    queryOne("#transfer-producto-v226")?.addEventListener("change", updateAvailable);
  }

  return Object.freeze({ setup });
}
