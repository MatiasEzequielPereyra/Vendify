import { escapeHtml, queryAll, queryOne } from "../core/dom.js";
import {
  adjustInventoryStock,
  applyPhysicalCount,
  listInventoryMovements,
  listTransferProducts,
  transferInventoryStock,
  type InventoryRecord,
  type InventoryRpcClientPort
} from "./inventory-service.js";

type InventoryTab = "resumen" | "movimientos" | "ajuste" | "conteo" | "transferencias";
type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface BranchContext {
  readonly id: string | null;
  readonly name: string;
}

export interface InventoryControllerDependencies {
  readonly client: InventoryRpcClientPort;
  readonly canManage: () => boolean;
  readonly isSupervisor: () => boolean;
  readonly hasManualStockPermission: () => boolean;
  readonly requireManualStockPermission: (message: string) => boolean;
  readonly getBranch: () => BranchContext;
  readonly listBranches: () => Promise<InventoryRecord[]>;
  readonly getProducts: () => InventoryRecord[];
  readonly mapProduct: (record: InventoryRecord) => InventoryRecord;
  readonly productLabel: (product: InventoryRecord) => string;
  readonly formatDate: (value: unknown) => string;
  readonly isLowStock: (product: InventoryRecord) => boolean;
  readonly isOutOfStock: (product: InventoryRecord) => boolean;
  readonly getSmartStock: (product: InventoryRecord) => InventoryRecord | null;
  readonly showToast: (message: string, type: "error" | "info" | "success") => void;
  readonly confirm: (title: string, message: string) => Promise<boolean>;
  readonly emitStockChange: (reason: string) => void;
  readonly reloadProducts: () => Promise<void>;
  readonly renderProducts: () => void;
}

export interface InventoryController {
  readonly setup: () => void;
  readonly refreshOpenView: (reloadProducts?: boolean) => Promise<void>;
  readonly openAdjustmentFromProduct: (productId: string, delta?: number | null) => Promise<void>;
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

function setText(selector: string, value: string | number): void {
  const element = queryOne(selector);
  if (element) element.textContent = String(value);
}

function setValue(selector: string, value: string | number): void {
  const element = field(selector);
  if (element) element.value = String(value);
}

function movementLabel(type: unknown): string {
  const key = text(type);
  const labels: Record<string, string> = {
    venta: "Venta",
    compra: "Compra",
    stock_inicial: "Carga inicial",
    ingreso: "Ingreso",
    ajuste: "Corrección",
    rotura: "Rotura",
    vencimiento: "Vencimiento",
    perdida: "Pérdida / merma",
    inventario: "Conteo físico",
    transferencia_salida: "Transferencia saliente",
    transferencia_entrada: "Transferencia entrante",
    devolucion: "Devolución"
  };
  return labels[key] ?? (key ? key : "Movimiento");
}

function movementClass(type: unknown): string {
  const key = text(type);
  if (["ingreso", "compra", "stock_inicial", "transferencia_entrada", "devolucion"].includes(key)) {
    return "positive";
  }
  if (["rotura", "vencimiento", "perdida", "transferencia_salida", "venta"].includes(key)) {
    return "negative";
  }
  return "neutral";
}

export function createInventoryController(
  dependencies: InventoryControllerDependencies
): InventoryController {
  let movements: InventoryRecord[] = [];
  const countDraft = new Map<string, number>();
  let transferProducts: InventoryRecord[] = [];
  let activeTab: InventoryTab = "resumen";
  let countInProgress = false;
  let transferInProgress = false;
  let setupComplete = false;

  function applyPermissions(): void {
    const supervisor = dependencies.isSupervisor();
    const manualStock = dependencies.hasManualStockPermission();
    queryOne('[data-inventory-tab="ajuste"]')?.classList.toggle("permiso-hidden", !manualStock);
    queryOne('[data-inventory-tab="conteo"]')?.classList.toggle("permiso-hidden", !manualStock);
    queryOne('[data-inventory-tab="movimientos"]')?.classList.toggle("permiso-hidden", !supervisor);
    queryOne('[data-inventory-tab="transferencias"]')?.classList.toggle("permiso-hidden", !supervisor);
    queryOne("#inventory-recent-card-v23014")?.classList.toggle("permiso-hidden", !supervisor);
  }

  function safeTab(tab: string | null): InventoryTab {
    const requested: InventoryTab = ["movimientos", "ajuste", "conteo", "transferencias"].includes(tab ?? "")
      ? tab as InventoryTab
      : "resumen";
    if (["movimientos", "transferencias"].includes(requested) && !dependencies.isSupervisor()) {
      return "resumen";
    }
    if (["ajuste", "conteo"].includes(requested) && !dependencies.hasManualStockPermission()) {
      return "resumen";
    }
    return requested;
  }

  function activateTab(tab: string | null, load = true): void {
    activeTab = safeTab(tab);
    queryAll(".inventory-tab").forEach((button) => {
      const active = button.getAttribute("data-inventory-tab") === activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    queryAll(".inventory-panel").forEach((panel) => {
      const active = panel.getAttribute("data-inventory-panel") === activeTab;
      panel.classList.toggle("active", active);
      if (panel instanceof HTMLElement) panel.hidden = !active;
    });
    const content = queryOne(".inventory-content");
    if (content instanceof HTMLElement) content.scrollTop = 0;
    if (!load) return;
    if (activeTab === "movimientos") void loadMovements();
    else if (activeTab === "ajuste") prepareAdjustment();
    else if (activeTab === "conteo") renderPhysicalCount();
    else if (activeTab === "transferencias") void prepareTransfer();
  }

  function renderRecentMovements(rows: InventoryRecord[]): void {
    const container = queryOne("#inventory-recent-list");
    if (!container) return;
    if (!rows.length) {
      container.innerHTML = '<div class="inventory-empty">Todavía no hay movimientos registrados.</div>';
      return;
    }
    container.innerHTML = rows.map((movement) => {
      const delta = number(movement.delta);
      const cssClass = movementClass(movement.tipo);
      return `
        <div class="inventory-recent-row">
          <span class="inventory-recent-icon ${cssClass}">${delta >= 0 ? "↑" : "↓"}</span>
          <span class="inventory-recent-copy">
            <strong>${escapeHtml(text(movement.producto_nombre, "Producto"))}</strong>
            <small>${escapeHtml(movementLabel(movement.tipo))} · ${
              escapeHtml(text(movement.motivo, "Sin observación"))
            }</small>
          </span>
          <span class="inventory-recent-value ${cssClass}">${delta > 0 ? "+" : ""}${String(delta)}</span>
        </div>`;
    }).join("");
  }

  function renderMovements(): void {
    const container = queryOne("#inventory-movement-list");
    if (!container) return;
    const query = (field("#inventory-movement-search")?.value ?? "").trim().toLowerCase();
    const type = field("#inventory-movement-type")?.value ?? "";
    const filtered = movements.filter((movement) => {
      const queryMatches = !query ||
        text(movement.producto_nombre).toLowerCase().includes(query) ||
        text(movement.motivo).toLowerCase().includes(query);
      return queryMatches && (!type || movement.tipo === type);
    });
    if (!filtered.length) {
      container.innerHTML = '<div class="inventory-empty inventory-table-empty">No hay movimientos para esos filtros.</div>';
      return;
    }
    container.innerHTML = filtered.map((movement) => {
      const delta = number(movement.delta);
      const cssClass = movementClass(movement.tipo);
      return `
        <div class="inventory-movement-row">
          <span class="inventory-movement-product">
            <strong>${escapeHtml(text(movement.producto_nombre, "Producto"))}</strong>
            <small>${escapeHtml(text(movement.motivo, "Sin motivo"))}</small>
          </span>
          <span><span class="inventory-type-pill ${cssClass}">${escapeHtml(movementLabel(movement.tipo))}</span></span>
          <strong class="inventory-delta ${cssClass}">${delta > 0 ? "+" : ""}${String(delta)}</strong>
          <strong>${String(number(movement.stock_resultante))}</strong>
          <span class="inventory-movement-user">
            <strong>${escapeHtml(text(movement.usuario_nombre, "Usuario"))}</strong>
            <small>${escapeHtml(dependencies.formatDate(movement.creado))}</small>
          </span>
        </div>`;
    }).join("");
  }

  async function loadMovements(options: { limit?: number; target?: "table" | "recent" } = {}): Promise<void> {
    const branchId = dependencies.getBranch().id;
    if (!branchId) return;
    const limit = options.limit ?? 100;
    const target = options.target ?? "table";
    try {
      const rows = await listInventoryMovements(dependencies.client, branchId, limit);
      if (target === "recent") renderRecentMovements(rows);
      else {
        movements = rows;
        renderMovements();
      }
    } catch (error) {
      console.error("[Inventario] movimientos:", error);
      const container = queryOne(target === "recent" ? "#inventory-recent-list" : "#inventory-movement-list");
      if (container) {
        container.innerHTML = target === "recent"
          ? '<div class="inventory-empty">No se pudo cargar la actividad.</div>'
          : '<div class="inventory-empty">No se pudo cargar el historial.</div>';
      }
    }
  }

  function renderSummary(): void {
    const products = dependencies.getProducts();
    setText("#inventory-stat-products", products.length);
    setText(
      "#inventory-stat-units",
      products.reduce((sum, product) => sum + number(product.stock), 0).toLocaleString("es-AR")
    );
    setText("#inventory-stat-low", products.filter(dependencies.isLowStock).length);
    setText("#inventory-stat-zero", products.filter(dependencies.isOutOfStock).length);

    const attention = products
      .map((product) => ({ product, info: dependencies.getSmartStock(product) }))
      .filter(({ product, info }) =>
        dependencies.isOutOfStock(product) || dependencies.isLowStock(product) || info?.estado === "proximo"
      )
      .sort((a, b) => {
        if (dependencies.isOutOfStock(a.product) !== dependencies.isOutOfStock(b.product)) {
          return dependencies.isOutOfStock(a.product) ? -1 : 1;
        }
        return number(a.info?.diasCobertura ?? 9999) - number(b.info?.diasCobertura ?? 9999);
      })
      .slice(0, 8);
    const list = queryOne("#inventory-attention-list");
    if (!list) return;
    if (!attention.length) {
      list.innerHTML = '<div class="inventory-empty">No hay productos críticos en esta sucursal.</div>';
    } else {
      list.innerHTML = attention.map(({ product, info }) => {
        const out = dependencies.isOutOfStock(product);
        const state = out ? "Sin stock" : dependencies.isLowStock(product) ? "Stock bajo" : "Próximo";
        const days = info?.diasCobertura == null
          ? "Sin estimación"
          : `${number(info.diasCobertura).toFixed(1)} días de cobertura`;
        const id = text(product.id);
        return `
          <button type="button" class="inventory-attention-row" data-inventory-adjust-product="${escapeHtml(id)}">
            <span class="inventory-attention-dot ${out ? "danger" : "warning"}"></span>
            <span class="inventory-attention-copy">
              <strong>${escapeHtml(dependencies.productLabel(product))}</strong>
              <small>${escapeHtml(days)}</small>
            </span>
            <span class="inventory-attention-stock">
              <strong>${String(number(product.stock))}</strong><small>${state}</small>
            </span>
          </button>`;
      }).join("");
      list.querySelectorAll("[data-inventory-adjust-product]").forEach((button) => {
        button.addEventListener("click", () => {
          activateTab("ajuste", false);
          prepareAdjustment(button.getAttribute("data-inventory-adjust-product"));
        });
      });
    }
    if (dependencies.isSupervisor()) void loadMovements({ limit: 6, target: "recent" });
  }

  function productOptions(selectedId: string | null = null): string {
    return dependencies.getProducts().map((product) => {
      const id = text(product.id);
      return `<option value="${escapeHtml(id)}" ${id === selectedId ? "selected" : ""}>${
        escapeHtml(dependencies.productLabel(product))
      } · stock ${String(number(product.stock))}</option>`;
    }).join("");
  }

  function updateAdjustmentPreview(): void {
    const id = field("#inventory-adjust-product")?.value;
    const product = dependencies.getProducts().find((item) => text(item.id) === id);
    const current = number(product?.stock);
    const mode = field("#inventory-adjust-mode")?.value ?? "sumar";
    const amount = Math.max(0, Number(field("#inventory-adjust-amount")?.value ?? 0));
    let result = current;
    if (mode === "sumar") result = current + amount;
    if (mode === "restar") result = Math.max(0, current - amount);
    if (mode === "establecer") result = amount;
    setText("#inventory-adjust-current", `Stock actual: ${String(current)}`);
    const preview = queryOne("#inventory-adjust-preview");
    if (preview) {
      const difference = result - current;
      preview.innerHTML = `Stock resultante: <strong>${String(result)}</strong> <span>(${
        difference >= 0 ? "+" : ""
      }${String(difference)})</span>`;
    }
  }

  function prepareAdjustment(
    productId: string | null = null,
    mode: string | null = null,
    amount: number | null = null
  ): void {
    const select = field("#inventory-adjust-product");
    if (!(select instanceof HTMLSelectElement)) return;
    const selected = productId ?? (select.value ? select.value : text(dependencies.getProducts()[0]?.id));
    select.innerHTML = productOptions(selected);
    if (selected) select.value = selected;
    if (mode) setValue("#inventory-adjust-mode", mode);
    if (amount != null) {
      const absoluteAmount = Math.abs(amount);
      setValue("#inventory-adjust-amount", absoluteAmount === 0 ? 1 : absoluteAmount);
    }
    updateAdjustmentPreview();
  }

  async function submitAdjustment(event: Event): Promise<void> {
    event.preventDefault();
    const branchId = dependencies.getBranch().id;
    const productId = field("#inventory-adjust-product")?.value ?? "";
    const mode = field("#inventory-adjust-mode")?.value ?? "sumar";
    const amount = Number(field("#inventory-adjust-amount")?.value);
    const reason = field("#inventory-adjust-reason")?.value ?? "correccion";
    const noteValue = field("#inventory-adjust-note")?.value.trim() ?? "";
    setText("#inventory-adjust-error", "");
    if (!branchId || !productId || !Number.isFinite(amount) || amount < 0) {
      setText("#inventory-adjust-error", "Revisá producto y cantidad.");
      return;
    }
    try {
      const data = await adjustInventoryStock(dependencies.client, {
        productId,
        branchId,
        mode,
        quantity: Math.round(amount),
        reason,
        note: noteValue ? noteValue : null
      });
      dependencies.emitStockChange("inventario_ajuste");
      await dependencies.reloadProducts();
      dependencies.renderProducts();
      prepareAdjustment(productId);
      renderSummary();
      dependencies.showToast(`Stock actualizado a ${String(number(data.stock))}`, "success");
    } catch (error) {
      setText("#inventory-adjust-error", errorMessage(error, "No se pudo ajustar el stock"));
    }
  }

  function updateCountDifference(productId: string): void {
    const product = dependencies.getProducts().find((item) => text(item.id) === productId);
    const element = document.querySelector(`[data-count-diff="${CSS.escape(productId)}"]`);
    if (!product || !element) return;
    if (!countDraft.has(productId)) {
      element.textContent = "—";
      element.className = "inventory-count-diff";
      return;
    }
    const difference = number(countDraft.get(productId)) - number(product.stock);
    element.textContent = `${difference > 0 ? "+" : ""}${String(difference)}`;
    element.className = `inventory-count-diff ${
      difference > 0 ? "positive" : difference < 0 ? "negative" : "zero"
    }`;
  }

  function updateCountProgress(): void {
    const differences = Array.from(countDraft.entries()).filter(([id, counted]) => {
      const product = dependencies.getProducts().find((item) => text(item.id) === id);
      return product && counted !== number(product.stock);
    }).length;
    setText("#inventory-count-progress", `${String(countDraft.size)} contados · ${String(differences)} con diferencia`);
  }

  function renderPhysicalCount(): void {
    const container = queryOne("#inventory-count-list");
    if (!container) return;
    const query = (field("#inventory-count-search")?.value ?? "").trim().toLowerCase();
    const visible = dependencies.getProducts().filter((product) =>
      !query || dependencies.productLabel(product).toLowerCase().includes(query)
    );
    if (!visible.length) {
      container.innerHTML = '<div class="inventory-empty">No hay productos para mostrar.</div>';
      return;
    }
    container.innerHTML = visible.map((product) => {
      const id = text(product.id);
      const stored = countDraft.has(id) ? String(countDraft.get(id)) : "";
      return `
        <div class="inventory-count-row" data-count-row="${escapeHtml(id)}">
          <span class="inventory-count-product">
            <strong>${escapeHtml(dependencies.productLabel(product))}</strong>
            <small>${escapeHtml(text(product.categoria, "Sin categoría"))}</small>
          </span>
          <span class="inventory-system-stock"><small>Sistema</small><strong>${
            String(number(product.stock))
          }</strong></span>
          <label class="inventory-count-input"><small>Contado</small>
            <input type="number" min="0" step="1" inputmode="numeric" data-count-product="${
              escapeHtml(id)
            }" value="${stored}" placeholder="—" />
          </label>
          <span class="inventory-count-diff" data-count-diff="${escapeHtml(id)}">—</span>
        </div>`;
    }).join("");
    container.querySelectorAll("[data-count-product]").forEach((element) => {
      element.addEventListener("input", () => {
        if (!(element instanceof HTMLInputElement)) return;
        const id = element.getAttribute("data-count-product");
        if (!id) return;
        if (element.value === "") countDraft.delete(id);
        else countDraft.set(id, Math.max(0, Number(element.value || 0)));
        updateCountDifference(id);
        updateCountProgress();
      });
    });
    visible.forEach((product) => {
      updateCountDifference(text(product.id));
    });
    updateCountProgress();
  }

  function clearPhysicalCount(): void {
    countDraft.clear();
    setValue("#inventory-count-note", "");
    renderPhysicalCount();
  }

  async function submitPhysicalCount(): Promise<void> {
    if (!dependencies.requireManualStockPermission(
      "El propietario no habilitó los conteos de stock para tu usuario"
    )) return;
    if (countInProgress) return;
    if (!countDraft.size) {
      dependencies.showToast("Ingresá al menos un producto contado", "info");
      return;
    }
    const branchId = dependencies.getBranch().id;
    if (!branchId) return;
    const countItems = Array.from(countDraft.entries()).map(([productId, countedStock]) => ({
      productId,
      countedStock: Math.max(0, Math.round(countedStock))
    }));
    const differences = countItems.filter((item) => {
      const product = dependencies.getProducts().find((candidate) => text(candidate.id) === item.productId);
      return product && number(product.stock) !== item.countedStock;
    });
    const confirmed = await dependencies.confirm(
      "Aplicar conteo físico",
      differences.length
        ? `Se ajustarán ${String(differences.length)} productos con diferencias. El conteo quedará auditado.`
        : "No hay diferencias. ¿Querés guardar igualmente este conteo?"
    );
    if (!confirmed) return;
    countInProgress = true;
    const button = queryOne("#btn-apply-count");
    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
      button.textContent = "Aplicando...";
    }
    try {
      const noteValue = field("#inventory-count-note")?.value.trim() ?? "";
      const data = await applyPhysicalCount(
        dependencies.client,
        branchId,
        countItems,
        noteValue ? noteValue : null
      );
      countDraft.clear();
      setValue("#inventory-count-note", "");
      dependencies.emitStockChange("conteo_fisico");
      await dependencies.reloadProducts();
      dependencies.renderProducts();
      renderPhysicalCount();
      renderSummary();
      dependencies.showToast(
        `Conteo guardado · ${String(number(data.productos_ajustados))} ajustes`,
        "success"
      );
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo aplicar el conteo físico"), "error");
    } finally {
      countInProgress = false;
      if (button instanceof HTMLButtonElement) {
        button.disabled = false;
        button.textContent = "Aplicar diferencias";
      }
    }
  }

  function updateTransferAvailable(): void {
    const id = field("#inventory-transfer-product")?.value;
    const product = transferProducts.find((item) => text(item.id) === id);
    setText(
      "#inventory-transfer-available",
      product ? `Disponible en origen: ${String(number(product.stock))}` : "Disponible: —"
    );
  }

  async function loadTransferProductList(): Promise<void> {
    const originId = field("#inventory-transfer-origin")?.value;
    if (!originId) return;
    try {
      const rows = await listTransferProducts(dependencies.client, originId);
      transferProducts = rows.map(dependencies.mapProduct);
      const select = field("#inventory-transfer-product");
      if (select instanceof HTMLSelectElement) {
        select.innerHTML = transferProducts.map((product) =>
          `<option value="${escapeHtml(text(product.id))}">${
            escapeHtml(dependencies.productLabel(product))
          } · stock ${String(number(product.stock))}</option>`
        ).join("");
      }
      updateTransferAvailable();
    } catch (error) {
      setText("#inventory-transfer-error", errorMessage(error, "No se pudieron cargar los productos"));
    }
  }

  async function prepareTransfer(): Promise<void> {
    const origin = field("#inventory-transfer-origin");
    const destination = field("#inventory-transfer-destination");
    if (!(origin instanceof HTMLSelectElement) || !(destination instanceof HTMLSelectElement)) return;
    try {
      const branches = await dependencies.listBranches();
      const options = branches.map((branch) =>
        `<option value="${escapeHtml(text(branch.id))}">${escapeHtml(text(branch.nombre))}</option>`
      ).join("");
      origin.innerHTML = options;
      destination.innerHTML = options;
      origin.value = dependencies.getBranch().id ?? text(branches[0]?.id);
      destination.value = text(
        branches.find((branch) => text(branch.id) !== origin.value)?.id,
        text(branches[0]?.id)
      );
      await loadTransferProductList();
    } catch (error) {
      setText("#inventory-transfer-error", errorMessage(error, "No se cargaron las sucursales"));
    }
  }

  async function submitTransfer(event: Event): Promise<void> {
    event.preventDefault();
    if (transferInProgress) return;
    const originId = field("#inventory-transfer-origin")?.value ?? "";
    const destinationId = field("#inventory-transfer-destination")?.value ?? "";
    const productId = field("#inventory-transfer-product")?.value ?? "";
    const quantity = Number(field("#inventory-transfer-amount")?.value);
    const note = field("#inventory-transfer-note")?.value.trim() ?? "";
    setText("#inventory-transfer-error", "");
    if (originId === destinationId) {
      setText("#inventory-transfer-error", "Origen y destino deben ser distintos.");
      return;
    }
    transferInProgress = true;
    const submitter = event instanceof SubmitEvent && event.submitter instanceof HTMLButtonElement
      ? event.submitter
      : null;
    if (submitter) submitter.disabled = true;
    try {
      await transferInventoryStock(dependencies.client, {
        productId,
        originId,
        destinationId,
        quantity: Math.round(quantity),
        reason: note ? note : "Transferencia entre sucursales"
      });
      dependencies.emitStockChange("transferencia_inventario");
      const currentBranch = dependencies.getBranch().id;
      if (currentBranch === originId || currentBranch === destinationId) {
        await dependencies.reloadProducts();
        dependencies.renderProducts();
      }
      setValue("#inventory-transfer-note", "");
      setValue("#inventory-transfer-amount", "1");
      await loadTransferProductList();
      renderSummary();
      dependencies.showToast(`Transferencia realizada · ${String(quantity)} unidades`, "success");
    } catch (error) {
      setText("#inventory-transfer-error", errorMessage(error, "No se pudo transferir el stock"));
    } finally {
      transferInProgress = false;
      if (submitter) submitter.disabled = false;
    }
  }

  async function refresh(reloadProducts = true): Promise<void> {
    if (reloadProducts) await dependencies.reloadProducts();
    renderSummary();
    if (activeTab === "movimientos") await loadMovements();
    else if (activeTab === "ajuste") prepareAdjustment();
    else if (activeTab === "conteo") renderPhysicalCount();
    else if (activeTab === "transferencias") await prepareTransfer();
  }

  async function refreshOpenView(reloadProducts = true): Promise<void> {
    if (queryOne("#modal-inventario")?.classList.contains("hidden") !== false) return;
    await refresh(reloadProducts);
  }

  async function open(tab: InventoryTab = "resumen"): Promise<void> {
    if (!dependencies.canManage()) {
      dependencies.showToast("Tu rol no permite administrar inventario", "error");
      return;
    }
    const branch = dependencies.getBranch();
    if (!branch.id) {
      dependencies.showToast("Seleccioná una sucursal", "error");
      return;
    }
    const branchName = branch.name ? branch.name : "Sucursal";
    setText("#inventory-branch-badge", branchName);
    setText("#inventory-summary-title", `Inventario · ${branchName}`);
    queryOne("#modal-inventario")?.classList.remove("hidden");
    applyPermissions();
    activateTab(tab, false);
    await refresh();
  }

  function close(): void {
    queryOne("#modal-inventario")?.classList.add("hidden");
  }

  async function openAdjustmentFromProduct(
    productId: string,
    delta: number | null = null
  ): Promise<void> {
    await open("ajuste");
    const product = dependencies.getProducts().find((item) => text(item.id) === productId);
    if (delta == null) prepareAdjustment(productId, "establecer", number(product?.stock));
    else prepareAdjustment(productId, delta >= 0 ? "sumar" : "restar", Math.abs(delta));
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#btn-inventario")?.addEventListener("click", () => void open());
    queryOne("#btn-close-inventory")?.addEventListener("click", close);
    queryOne("#modal-inventario .modal-backdrop")?.addEventListener("click", close);
    queryAll(".inventory-tab").forEach((button) => {
      button.addEventListener("click", () => {
        activateTab(button.getAttribute("data-inventory-tab"));
      });
    });
    queryAll("[data-inventory-go]").forEach((button) => {
      button.addEventListener("click", () => {
        activateTab(button.getAttribute("data-inventory-go"));
      });
    });
    queryOne("#btn-refresh-inventory")?.addEventListener("click", () => void refresh());
    queryOne("#btn-refresh-movements")?.addEventListener("click", () => void loadMovements());
    queryOne("#inventory-movement-search")?.addEventListener("input", renderMovements);
    queryOne("#inventory-movement-type")?.addEventListener("change", renderMovements);
    queryOne("#inventory-adjust-form")?.addEventListener("submit", (event) => void submitAdjustment(event));
    queryOne("#inventory-adjust-product")?.addEventListener("change", updateAdjustmentPreview);
    queryOne("#inventory-adjust-mode")?.addEventListener("change", updateAdjustmentPreview);
    queryOne("#inventory-adjust-amount")?.addEventListener("input", updateAdjustmentPreview);
    queryOne("#inventory-count-search")?.addEventListener("input", renderPhysicalCount);
    queryOne("#btn-clear-count")?.addEventListener("click", clearPhysicalCount);
    queryOne("#btn-apply-count")?.addEventListener("click", () => void submitPhysicalCount());
    queryOne("#inventory-transfer-form")?.addEventListener("submit", (event) => void submitTransfer(event));
    queryOne("#inventory-transfer-origin")?.addEventListener("change", () => void loadTransferProductList());
    queryOne("#inventory-transfer-product")?.addEventListener("change", updateTransferAvailable);
  }

  return Object.freeze({ setup, refreshOpenView, openAdjustmentFromProduct });
}
