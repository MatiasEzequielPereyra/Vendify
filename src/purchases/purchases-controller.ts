import { escapeHtml, queryAll, queryOne } from "../core/dom.js";
import { formatArs } from "../core/format.js";
import {
  cancelPurchaseDraft,
  getPurchase,
  listPurchases,
  listSuppliers,
  receivePurchase,
  savePurchaseDraft,
  saveSupplier,
  type PurchasesRecord,
  type PurchasesRpcClientPort
} from "./purchases-service.js";

type PurchasesTab = "compras" | "proveedores";
type ToastType = "error" | "info" | "success";

interface BranchContext {
  readonly id: string | null;
  readonly name: string;
}

interface PurchaseItem {
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
}

export interface PurchasesControllerDependencies {
  readonly client: PurchasesRpcClientPort;
  readonly canManage: () => boolean;
  readonly getBranch: () => BranchContext;
  readonly listBranches: () => Promise<PurchasesRecord[]>;
  readonly getProducts: () => PurchasesRecord[];
  readonly productLabel: (product: PurchasesRecord) => string;
  readonly formatDate: (value: unknown) => string;
  readonly showToast: (message: string, type: ToastType) => void;
  readonly confirm: (title: string, message: string) => Promise<boolean>;
  readonly emitStockChange: (reason: string) => void;
  readonly reloadProducts: () => Promise<void>;
  readonly renderProducts: () => void;
}

export interface PurchasesController {
  readonly setup: () => void;
  readonly refreshOpenViews: () => Promise<void>;
}

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function field(selector: string): FormField | null {
  const element = queryOne(selector);
  return element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
    ? element
    : null;
}

function record(value: unknown): PurchasesRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as PurchasesRecord
    : null;
}

function records(value: unknown): PurchasesRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = record(item);
    return parsed ? [parsed] : [];
  });
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function firstText(values: unknown[], fallback: string): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
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

function setValue(selector: string, value: unknown): void {
  const element = field(selector);
  if (element) element.value = text(value);
}

function nullableField(selector: string): string | null {
  const value = field(selector)?.value.trim() ?? "";
  return value || null;
}

export function createPurchasesController(
  dependencies: PurchasesControllerDependencies
): PurchasesController {
  let suppliers: PurchasesRecord[] = [];
  let purchases: PurchasesRecord[] = [];
  let items: PurchaseItem[] = [];
  let editingPurchaseId: string | null = null;
  let editingPurchaseState = "borrador";
  let editingSupplierId: string | null = null;
  let activeTab: PurchasesTab = "compras";
  let operationInProgress = false;
  let setupComplete = false;

  function renderPurchaseStats(): void {
    const now = new Date();
    const receivedThisMonth = purchases.filter((purchase) => {
      if (purchase.estado !== "recibida" || !purchase.recibida_en) return false;
      const date = new Date(text(purchase.recibida_en));
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
    setText("#compras-stat-count", receivedThisMonth.length);
    setText(
      "#compras-stat-total",
      formatArs(receivedThisMonth.reduce((sum, purchase) => sum + number(purchase.total), 0))
    );
    setText(
      "#compras-stat-providers",
      suppliers.filter((supplier) => supplier.activo !== false).length
    );
  }

  function updateSupplierSelect(selected: string | null = null): void {
    const select = field("#compra-proveedor");
    if (!(select instanceof HTMLSelectElement)) return;
    const active = suppliers.filter((supplier) => supplier.activo !== false);
    select.innerHTML = active.length
      ? active.map((supplier) => {
          const id = text(supplier.id);
          return `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${
            escapeHtml(text(supplier.nombre))
          }</option>`;
        }).join("")
      : '<option value="">Creá un proveedor primero</option>';
  }

  function closeSupplierEditor(): void {
    queryOne("#modal-proveedor-editor")?.classList.add("hidden");
    editingSupplierId = null;
    const form = queryOne("#form-proveedor-v230");
    if (form instanceof HTMLFormElement) form.reset();
  }

  function openSupplierEditor(supplier: PurchasesRecord | null = null): void {
    editingSupplierId = supplier ? text(supplier.id) || null : null;
    setText("#proveedor-editor-title", supplier ? "Editar proveedor" : "Nuevo proveedor");
    setValue("#proveedor-id-v230", supplier?.id);
    setValue("#proveedor-nombre-v230", supplier?.nombre);
    setValue("#proveedor-cuit-v230", supplier?.cuit);
    setValue("#proveedor-contacto-v230", supplier?.contacto);
    setValue("#proveedor-telefono-v230", supplier?.telefono);
    setValue("#proveedor-email-v230", supplier?.email);
    setValue("#proveedor-direccion-v230", supplier?.direccion);
    setValue("#proveedor-notas-v230", supplier?.notas);
    setText("#proveedor-editor-error", "");
    queryOne("#modal-proveedor-editor")?.classList.remove("hidden");
    setTimeout(() => field("#proveedor-nombre-v230")?.focus(), 50);
  }

  function renderSuppliers(): void {
    const container = queryOne("#proveedores-list-v230");
    if (!container) return;
    const query = (field("#proveedores-search")?.value ?? "").trim().toLowerCase();
    const filtered = suppliers.filter((supplier) => {
      if (!query) return true;
      return [
        supplier.nombre,
        supplier.cuit,
        supplier.contacto,
        supplier.telefono,
        supplier.email
      ].map((value) => text(value)).filter(Boolean).join(" ").toLowerCase().includes(query);
    });
    if (!filtered.length) {
      container.innerHTML = `<div class="inventory-empty compras-empty-v230">${
        suppliers.length
          ? "No hay proveedores para esa búsqueda."
          : "Todavía no cargaste proveedores."
      }</div>`;
      return;
    }
    container.innerHTML = filtered.map((supplier) => {
      const id = text(supplier.id);
      const name = text(supplier.nombre, "P");
      return `
        <article class="proveedor-card-v230" data-provider-id="${escapeHtml(id)}">
          <div class="proveedor-card-head-v230">
            <div class="proveedor-avatar-v230">${escapeHtml(name.slice(0, 1).toUpperCase())}</div>
            <div class="proveedor-title-v230">
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(firstText([supplier.contacto, supplier.cuit], "Proveedor"))}</small>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-provider-edit="${
              escapeHtml(id)
            }">Editar</button>
          </div>
          <div class="proveedor-metrics-v230">
            <div><span>Total comprado</span><strong>${formatArs(number(supplier.total_comprado))}</strong></div>
            <div><span>Compras</span><strong>${String(number(supplier.compras_recibidas))}</strong></div>
          </div>
          <div class="proveedor-meta-v230">
            <span>${supplier.telefono ? `Tel. ${escapeHtml(text(supplier.telefono))}` : "Sin teléfono"}</span>
            <span>${
              supplier.ultima_compra
                ? `Última compra ${escapeHtml(dependencies.formatDate(supplier.ultima_compra))}`
                : "Sin compras recibidas"
            }</span>
          </div>
        </article>`;
    }).join("");
    container.querySelectorAll("[data-provider-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-provider-edit");
        const supplier = suppliers.find((item) => text(item.id) === id);
        if (supplier) openSupplierEditor(supplier);
      });
    });
  }

  async function loadSupplierList(options: { render?: boolean } = {}): Promise<void> {
    const shouldRender = options.render ?? true;
    try {
      suppliers = await listSuppliers(dependencies.client);
      if (shouldRender) renderSuppliers();
      updateSupplierSelect();
      renderPurchaseStats();
    } catch (error) {
      console.error("[Proveedores]", error);
      const container = queryOne("#proveedores-list-v230");
      if (shouldRender && container) {
        container.innerHTML = '<div class="inventory-empty">No se pudieron cargar los proveedores.</div>';
      }
    }
  }

  async function submitSupplier(event: Event): Promise<void> {
    event.preventDefault();
    const wasEditing = Boolean(editingSupplierId);
    const name = field("#proveedor-nombre-v230")?.value.trim() ?? "";
    setText("#proveedor-editor-error", "");
    if (!name) {
      setText("#proveedor-editor-error", "El nombre es obligatorio.");
      return;
    }
    try {
      await saveSupplier(dependencies.client, {
        id: editingSupplierId,
        name,
        taxId: nullableField("#proveedor-cuit-v230"),
        contact: nullableField("#proveedor-contacto-v230"),
        phone: nullableField("#proveedor-telefono-v230"),
        email: nullableField("#proveedor-email-v230"),
        address: nullableField("#proveedor-direccion-v230"),
        notes: nullableField("#proveedor-notas-v230")
      });
      closeSupplierEditor();
      await loadSupplierList({ render: activeTab === "proveedores" });
      dependencies.showToast(wasEditing ? "Proveedor actualizado" : "Proveedor creado", "success");
    } catch (error) {
      setText("#proveedor-editor-error", errorMessage(error, "No se pudo guardar el proveedor."));
    }
  }

  function renderPurchases(): void {
    const container = queryOne("#compras-list-v230");
    if (!container) return;
    const query = (field("#compras-search")?.value ?? "").trim().toLowerCase();
    const state = field("#compras-filter-state")?.value ?? "";
    const filtered = purchases.filter((purchase) => {
      const stateMatches = !state || purchase.estado === state;
      const searchable = [purchase.proveedor_nombre, purchase.numero_comprobante, purchase.nota]
        .map((value) => text(value)).filter(Boolean).join(" ").toLowerCase();
      return stateMatches && (!query || searchable.includes(query));
    });
    if (!filtered.length) {
      container.innerHTML = `<div class="inventory-empty compras-empty-v230">${
        purchases.length
          ? "No hay compras para esos filtros."
          : "Todavía no registraste compras en esta sucursal."
      }</div>`;
      return;
    }
    container.innerHTML = filtered.map((purchase) => {
      const id = text(purchase.id);
      const stateValue = text(purchase.estado, "borrador");
      const stateLabel = stateValue === "recibida"
        ? "Recibida"
        : stateValue === "anulada" ? "Anulada" : "Borrador";
      return `
        <article class="compra-card-v230" data-purchase-id="${escapeHtml(id)}">
          <div class="compra-status-v230 ${escapeHtml(stateValue)}"><span></span>${stateLabel}</div>
          <div class="compra-card-main-v230">
            <div>
              <strong>${escapeHtml(text(purchase.proveedor_nombre, "Sin proveedor"))}</strong>
              <small>${escapeHtml(text(purchase.numero_comprobante, "Sin comprobante"))} · ${
                String(number(purchase.items_count))
              } productos</small>
            </div>
            <div class="compra-card-total-v230">
              <strong>${formatArs(number(purchase.total))}</strong>
              <small>${escapeHtml(dependencies.formatDate(purchase.creado))}</small>
            </div>
          </div>
          <div class="compra-card-actions-v230">
            <button type="button" class="btn btn-secondary btn-sm" data-purchase-open="${
              escapeHtml(id)
            }">${stateValue === "borrador" ? "Continuar" : "Ver detalle"}</button>
            ${stateValue === "borrador"
              ? `<button type="button" class="btn btn-ghost btn-sm danger" data-purchase-cancel="${
                  escapeHtml(id)
                }">Anular borrador</button>`
              : ""}
          </div>
        </article>`;
    }).join("");
    container.querySelectorAll("[data-purchase-open]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-purchase-open");
        if (id) void openExistingPurchase(id);
      });
    });
    container.querySelectorAll("[data-purchase-cancel]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-purchase-cancel");
        if (id) void cancelDraft(id);
      });
    });
  }

  async function loadPurchaseList(options: { render?: boolean } = {}): Promise<void> {
    const branchId = dependencies.getBranch().id;
    if (!branchId) return;
    const shouldRender = options.render ?? true;
    try {
      purchases = await listPurchases(dependencies.client, branchId);
      if (shouldRender) renderPurchases();
      renderPurchaseStats();
    } catch (error) {
      console.error("[Compras]", error);
      const container = queryOne("#compras-list-v230");
      if (shouldRender && container) {
        container.innerHTML = '<div class="inventory-empty">No se pudieron cargar las compras.</div>';
      }
    }
  }

  function activateTab(tabValue: string | null, load = true): void {
    activeTab = tabValue === "proveedores" ? "proveedores" : "compras";
    queryAll(".compras-tab-v230").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-compras-tab") === activeTab);
    });
    queryAll(".compras-panel-v230").forEach((panel) => {
      const active = panel.getAttribute("data-compras-panel") === activeTab;
      panel.classList.toggle("active", active);
      if (panel instanceof HTMLElement) panel.hidden = !active;
    });
    if (!load) return;
    if (activeTab === "compras") void loadPurchaseList();
    else void loadSupplierList();
  }

  async function openPurchases(tab: PurchasesTab = "compras"): Promise<void> {
    if (!dependencies.canManage()) {
      dependencies.showToast("Tu rol no permite administrar compras", "error");
      return;
    }
    setText("#compras-branch-badge-v230", dependencies.getBranch().name || "Sucursal");
    queryOne("#modal-compras")?.classList.remove("hidden");
    activateTab(tab, false);
    await loadSupplierList({ render: tab === "proveedores" });
    await loadPurchaseList({ render: tab === "compras" });
  }

  function closePurchases(): void {
    queryOne("#modal-compras")?.classList.add("hidden");
  }

  async function fillBranchSelect(selected: string | null = null): Promise<void> {
    const select = field("#compra-sucursal");
    if (!(select instanceof HTMLSelectElement)) return;
    const branches = await dependencies.listBranches();
    select.innerHTML = branches.map((branch) => {
      const id = text(branch.id);
      return `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${
        escapeHtml(text(branch.nombre))
      }</option>`;
    }).join("");
    if (!selected && dependencies.getBranch().id) select.value = dependencies.getBranch().id ?? "";
  }

  function updateProductCost(): void {
    const selectedId = field("#compra-item-producto")?.value;
    const product = dependencies.getProducts().find((item) => text(item.id) === selectedId);
    const cost = field("#compra-item-costo");
    if (product && cost) cost.value = number(product.precioCompra).toFixed(2);
  }

  function fillProductSelect(selected: string | null = null): void {
    const select = field("#compra-item-producto");
    if (!(select instanceof HTMLSelectElement)) return;
    select.innerHTML = dependencies.getProducts().map((product) => {
      const id = text(product.id);
      return `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${
        escapeHtml(dependencies.productLabel(product))
      }</option>`;
    }).join("");
    updateProductCost();
  }

  function setEditorReadonly(readonly: boolean): void {
    ["#compra-proveedor", "#compra-sucursal", "#compra-comprobante", "#compra-nota"]
      .forEach((selector) => {
        const element = field(selector);
        if (element) element.disabled = readonly;
      });
    queryOne("#compra-add-item-box-v230")?.classList.toggle("hidden", readonly);
    queryOne("#btn-save-compra-draft")?.classList.toggle("hidden", readonly);
    queryOne("#btn-receive-compra")?.classList.toggle("hidden", readonly);
    document.body.classList.toggle("compra-readonly-v230", readonly);
  }

  function closePurchaseEditor(): void {
    queryOne("#modal-compra-editor")?.classList.add("hidden");
    editingPurchaseId = null;
    editingPurchaseState = "borrador";
    items = [];
    document.body.classList.remove("compra-readonly-v230");
  }

  function renderPurchaseItems(): void {
    const container = queryOne("#compra-items-list-v230");
    if (!container) return;
    const readonly = editingPurchaseState !== "borrador";
    container.innerHTML = items.length
      ? items.map((item, index) => `
          <div class="compra-item-row-v230">
            <span class="compra-item-name-v230"><strong>${escapeHtml(item.productName)}</strong></span>
            <label><input type="number" min="1" step="1" data-compra-qty="${String(index)}"
              value="${String(item.quantity)}" ${readonly ? "disabled" : ""} /></label>
            <label><input type="number" min="0" step="0.01" data-compra-cost="${String(index)}"
              value="${item.unitCost.toFixed(2)}" ${readonly ? "disabled" : ""} /></label>
            <strong>${formatArs(item.quantity * item.unitCost)}</strong>
            <button type="button" class="btn-icon danger" data-compra-remove="${String(index)}"
              ${readonly ? "hidden" : ""}>✕</button>
          </div>`).join("")
      : '<div class="inventory-empty">Agregá los productos incluidos en la compra.</div>';

    if (!readonly) {
      container.querySelectorAll("[data-compra-qty]").forEach((element) => {
        element.addEventListener("input", () => {
          if (!(element instanceof HTMLInputElement)) return;
          const item = items[Number(element.getAttribute("data-compra-qty"))];
          if (!item) return;
          item.quantity = Math.max(1, Math.round(Number(element.value || 1)));
          renderPurchaseItems();
        });
      });
      container.querySelectorAll("[data-compra-cost]").forEach((element) => {
        element.addEventListener("change", () => {
          if (!(element instanceof HTMLInputElement)) return;
          const item = items[Number(element.getAttribute("data-compra-cost"))];
          if (!item) return;
          item.unitCost = Math.max(0, Number(element.value || 0));
          renderPurchaseItems();
        });
      });
      container.querySelectorAll("[data-compra-remove]").forEach((button) => {
        button.addEventListener("click", () => {
          items.splice(Number(button.getAttribute("data-compra-remove")), 1);
          renderPurchaseItems();
        });
      });
    }
    setText(
      "#compra-total-value-v230",
      formatArs(items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0))
    );
  }

  function addPurchaseItem(): void {
    const productId = field("#compra-item-producto")?.value ?? "";
    const product = dependencies.getProducts().find((item) => text(item.id) === productId);
    if (!product) return;
    const quantity = Math.max(1, Math.round(Number(field("#compra-item-cantidad")?.value ?? 1)));
    const unitCost = Math.max(0, Number(field("#compra-item-costo")?.value ?? 0));
    const existing = items.find((item) => item.productId === productId);
    if (existing) {
      existing.quantity += quantity;
      existing.unitCost = unitCost;
    } else {
      items.push({
        productId,
        productName: dependencies.productLabel(product),
        quantity,
        unitCost
      });
    }
    setValue("#compra-item-cantidad", "1");
    renderPurchaseItems();
  }

  async function openNewPurchase(): Promise<void> {
    if (!suppliers.length) await loadSupplierList({ render: false });
    if (!suppliers.some((supplier) => supplier.activo !== false)) {
      dependencies.showToast("Primero cargá al menos un proveedor", "info");
      activateTab("proveedores");
      openSupplierEditor();
      return;
    }
    editingPurchaseId = null;
    editingPurchaseState = "borrador";
    items = [];
    setText("#compra-editor-title", "Nueva compra");
    setText("#compra-editor-subtitle", "Guardala como borrador o recibí la mercadería ahora.");
    setValue("#compra-comprobante", "");
    setValue("#compra-nota", "");
    setText("#compra-editor-error", "");
    updateSupplierSelect();
    await fillBranchSelect(dependencies.getBranch().id);
    fillProductSelect();
    setEditorReadonly(false);
    renderPurchaseItems();
    queryOne("#modal-compra-editor")?.classList.remove("hidden");
  }

  async function openExistingPurchase(id: string): Promise<void> {
    try {
      const response = await getPurchase(dependencies.client, id);
      const purchase = record(response.compra);
      if (!purchase) throw new Error("No se pudo abrir la compra");
      editingPurchaseId = text(purchase.id);
      editingPurchaseState = text(purchase.estado, "borrador");
      items = records(response.items).map((item) => ({
        productId: text(item.producto_id),
        productName: text(item.producto_nombre, "Producto"),
        quantity: number(item.cantidad),
        unitCost: number(item.costo_unitario)
      }));
      setText(
        "#compra-editor-title",
        editingPurchaseState === "borrador" ? "Editar compra" : "Detalle de compra"
      );
      setText(
        "#compra-editor-subtitle",
        editingPurchaseState === "recibida"
          ? `Mercadería recibida ${purchase.recibida_en ? dependencies.formatDate(purchase.recibida_en) : ""}`
          : editingPurchaseState === "anulada"
            ? "Esta compra fue anulada."
            : "Podés modificar el borrador antes de recibirlo."
      );
      await loadSupplierList({ render: false });
      updateSupplierSelect(text(purchase.proveedor_id));
      setValue("#compra-proveedor", purchase.proveedor_id);
      await fillBranchSelect(text(purchase.sucursal_id));
      setValue("#compra-sucursal", purchase.sucursal_id);
      setValue("#compra-comprobante", purchase.numero_comprobante);
      setValue("#compra-nota", purchase.nota);
      setText("#compra-editor-error", "");
      fillProductSelect();
      setEditorReadonly(editingPurchaseState !== "borrador");
      renderPurchaseItems();
      queryOne("#modal-compra-editor")?.classList.remove("hidden");
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo abrir la compra"), "error");
    }
  }

  async function savePurchase(receive = false): Promise<void> {
    if (operationInProgress) return;
    operationInProgress = true;
    const errorElement = queryOne("#compra-editor-error");
    if (errorElement) errorElement.textContent = "";
    const supplierId = field("#compra-proveedor")?.value ?? "";
    const branchId = field("#compra-sucursal")?.value ?? "";
    if (!supplierId || !branchId || !items.length) {
      setText(
        "#compra-editor-error",
        !supplierId
          ? "Seleccioná un proveedor."
          : !branchId ? "Seleccioná una sucursal." : "Agregá al menos un producto."
      );
      operationInProgress = false;
      return;
    }
    const actionButton = queryOne(receive ? "#btn-receive-compra" : "#btn-save-compra-draft");
    const originalText = actionButton?.textContent ?? "";
    if (actionButton instanceof HTMLButtonElement) {
      actionButton.disabled = true;
      actionButton.textContent = receive ? "Recibiendo..." : "Guardando...";
    }
    try {
      const saved = await savePurchaseDraft(dependencies.client, {
        purchaseId: editingPurchaseId,
        branchId,
        supplierId,
        receiptNumber: nullableField("#compra-comprobante"),
        notes: nullableField("#compra-nota"),
        items: items.map((item) => ({
          productId: item.productId,
          quantity: Math.max(1, Math.round(item.quantity)),
          unitCost: Math.max(0, item.unitCost)
        }))
      });
      editingPurchaseId = text(saved.compra_id) || editingPurchaseId;
      if (!editingPurchaseId) throw new Error("No se pudo identificar la compra guardada.");
      if (receive) {
        const received = await receivePurchase(dependencies.client, editingPurchaseId);
        dependencies.emitStockChange("compra_recibida");
        await dependencies.reloadProducts();
        dependencies.renderProducts();
        dependencies.showToast(
          `Compra recibida · ${String(number(received.unidades_ingresadas))} unidades ingresadas`,
          "success"
        );
      } else {
        dependencies.showToast("Compra guardada como borrador", "success");
      }
      closePurchaseEditor();
      await Promise.all([
        loadPurchaseList(),
        loadSupplierList({ render: activeTab === "proveedores" })
      ]);
    } catch (error) {
      setText("#compra-editor-error", errorMessage(error, "No se pudo guardar la compra."));
    } finally {
      if (actionButton instanceof HTMLButtonElement) {
        actionButton.disabled = false;
        actionButton.textContent = originalText;
      }
      operationInProgress = false;
    }
  }

  async function cancelDraft(id: string): Promise<void> {
    const confirmed = await dependencies.confirm(
      "Anular borrador",
      "La compra dejará de aparecer como pendiente. No se modificará el stock."
    );
    if (!confirmed) return;
    try {
      await cancelPurchaseDraft(dependencies.client, id);
      await loadPurchaseList();
      dependencies.showToast("Borrador anulado", "success");
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo anular"), "error");
    }
  }

  async function refreshOpenViews(): Promise<void> {
    if (queryOne("#modal-compras")?.classList.contains("hidden") !== false) return;
    await Promise.all([
      loadPurchaseList({ render: activeTab === "compras" }),
      loadSupplierList({ render: activeTab === "proveedores" })
    ]);
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#btn-compras")?.addEventListener("click", () => void openPurchases());
    queryOne("#btn-close-compras")?.addEventListener("click", closePurchases);
    queryOne("#modal-compras .modal-backdrop")?.addEventListener("click", closePurchases);
    queryAll(".compras-tab-v230").forEach((button) => {
      button.addEventListener("click", () => {
        activateTab(button.getAttribute("data-compras-tab"));
      });
    });
    queryOne("#btn-nueva-compra")?.addEventListener("click", () => void openNewPurchase());
    queryOne("#btn-refresh-compras")?.addEventListener("click", () => void loadPurchaseList());
    queryOne("#compras-search")?.addEventListener("input", renderPurchases);
    queryOne("#compras-filter-state")?.addEventListener("change", renderPurchases);
    queryOne("#btn-nuevo-proveedor")?.addEventListener("click", () => {
      openSupplierEditor();
    });
    queryOne("#btn-refresh-proveedores")?.addEventListener("click", () => void loadSupplierList());
    queryOne("#proveedores-search")?.addEventListener("input", renderSuppliers);
    queryOne("#form-proveedor-v230")?.addEventListener("submit", (event) => void submitSupplier(event));
    queryOne("#btn-close-proveedor-editor")?.addEventListener("click", closeSupplierEditor);
    queryOne("#btn-cancel-proveedor-editor")?.addEventListener("click", closeSupplierEditor);
    queryOne("#modal-proveedor-editor .modal-backdrop")?.addEventListener("click", closeSupplierEditor);
    queryOne("#btn-close-compra-editor")?.addEventListener("click", closePurchaseEditor);
    queryOne("#btn-cancel-compra-editor")?.addEventListener("click", closePurchaseEditor);
    queryOne("#modal-compra-editor .modal-backdrop")?.addEventListener("click", closePurchaseEditor);
    queryOne("#compra-item-producto")?.addEventListener("change", updateProductCost);
    queryOne("#btn-add-compra-item")?.addEventListener("click", addPurchaseItem);
    queryOne("#btn-save-compra-draft")?.addEventListener("click", () => void savePurchase(false));
    queryOne("#btn-receive-compra")?.addEventListener("click", () => void savePurchase(true));
  }

  return Object.freeze({ setup, refreshOpenViews });
}
