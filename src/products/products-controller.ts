import { escapeHtml, queryAll, queryOne } from "../core/dom.js";
import { PRODUCT_CATALOG, type CatalogProduct } from "./catalog-data.js";
import {
  isLowStock as calculateLowStock,
  isOutOfStock,
  mapProductRow,
  mapSmartStockRow,
  productLabel,
  smartStockText,
  type Product,
  type SmartStockInfo
} from "./product-model.js";
import {
  adjustInitialStock,
  deleteAllProducts,
  deleteCategory,
  deleteProduct,
  importCatalog,
  initializeCategories,
  listCategories,
  listProducts,
  listSmartStock,
  saveCategory,
  saveProduct,
  type ProductRecord,
  type ProductsRpcClientPort
} from "./products-service.js";

type ProductField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type CatalogKind = "kiosco" | "almacen" | "minimercado";

const DEFAULT_CATEGORIES = [
  "Bebidas", "Golosinas", "Snacks", "Cigarrillos", "Lácteos",
  "Panadería", "Helados", "Limpieza", "Útiles", "Otros"
] as const;

interface BranchContext {
  readonly id: string | null;
  readonly name: string;
}

interface RemotePayload {
  readonly eventType?: string;
  readonly new?: ProductRecord;
  readonly old?: ProductRecord;
}

export interface ProductsControllerDependencies {
  readonly client: ProductsRpcClientPort;
  readonly getProducts: () => Product[];
  readonly setProducts: (products: Product[]) => void;
  readonly getCategories: () => string[];
  readonly setCategories: (categories: string[]) => void;
  readonly getBranch: () => BranchContext;
  readonly getRole: () => string;
  readonly hasPermission: (permission: string) => boolean;
  readonly requirePermission: (permission: string, message: string) => boolean;
  readonly showToast: (message: string, type?: "error" | "info" | "success") => void;
  readonly confirm: (title: string, message: string) => Promise<boolean>;
  readonly formatPrice: (value: unknown) => string;
  readonly applyPermissions: () => void;
  readonly loadProductsOffline: () => boolean;
  readonly saveProductsOffline: () => void;
  readonly captureOfflineStockSnapshot: (products: Product[]) => Promise<void>;
  readonly loadCategoriesOffline: () => boolean;
  readonly saveCategoriesOffline: () => void;
  readonly refreshOnboarding: () => void;
  readonly emitStockChange: (reason: string) => void;
  readonly scheduleSmartRefresh: () => void;
  readonly renderSaleProducts: () => void;
  readonly renderCart: () => void;
  readonly isSaleOpen: () => boolean;
  readonly addToCart: (productId: string) => void;
  readonly openInventoryAdjustment: (productId: string, delta: number) => void;
  readonly openManualStockModal: (productId: string) => void;
  readonly setEditingProductId: (productId: string | null) => void;
  readonly getEditingProductId: () => string | null;
  readonly setCurrentPhoto: (photo: string | null) => void;
  readonly restoreSaleBehindProduct: (focus?: boolean) => void;
  readonly shouldReturnCreatedProductToSale: () => boolean;
  readonly clearPendingScannerProduct: () => void;
}

export interface ProductsController {
  readonly setup: () => void;
  readonly loadProducts: () => Promise<void>;
  readonly loadCategories: () => Promise<void>;
  readonly loadSmartStock: () => Promise<void>;
  readonly render: () => void;
  readonly renderCategoryFilter: () => void;
  readonly renderCategorySelect: (selected?: string) => void;
  readonly renderCategoryList: () => void;
  readonly getSmartStock: (product: ProductRecord) => SmartStockInfo | null;
  readonly isLowStock: (product: ProductRecord) => boolean;
  readonly isOutOfStock: (product: ProductRecord) => boolean;
  readonly openEditor: (product?: ProductRecord | null) => void;
  readonly closeEditor: (preserveScannerFlow?: boolean) => void;
  readonly lookupBarcode: (code: string) => Promise<ProductRecord | null>;
  readonly ensureCategory: (name: string) => Promise<void>;
  readonly openCatalog: () => void;
  readonly applyRemoteChange: (payload: RemotePayload) => void;
}

function field(selector: string): ProductField | null {
  const element = queryOne(selector);
  return element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
    ? element
    : null;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
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

function mapExternalCategory(categories: string): string {
  const normalized = categories.toLowerCase();
  if (normalized.includes("beer") || normalized.includes("cerve")) return "Cervezas";
  if (normalized.includes("soda") || normalized.includes("gase")) return "Gaseosas";
  if (normalized.includes("water") || normalized.includes("agua")) return "Aguas";
  if (normalized.includes("chocolate")) return "Chocolates";
  if (normalized.includes("snack") || normalized.includes("chip")) return "Snacks";
  if (normalized.includes("biscuit") || normalized.includes("cookie") || normalized.includes("gallet")) {
    return "Galletitas";
  }
  if (normalized.includes("dairy") || normalized.includes("milk") || normalized.includes("láct")) {
    return "Lácteos";
  }
  return "Otros";
}

export function createProductsController(
  dependencies: ProductsControllerDependencies
): ProductsController {
  let smartStock = new Map<string, SmartStockInfo>();
  let legacyLowStockFilter = false;
  let catalogKind: CatalogKind = "kiosco";
  let catalogSelection = new Set<string>();
  const stockQueue = new Map<string, Promise<void>>();
  let setupComplete = false;

  function products(): Product[] {
    return dependencies.getProducts();
  }

  function categories(): string[] {
    return dependencies.getCategories();
  }

  function getSmartStock(product: ProductRecord): SmartStockInfo | null {
    const id = text(product.id);
    return id ? smartStock.get(id) ?? null : null;
  }

  function productIsLow(product: ProductRecord): boolean {
    return calculateLowStock(product, getSmartStock(product));
  }

  async function loadSmartStock(): Promise<void> {
    smartStock = new Map();
    const branchId = dependencies.getBranch().id;
    if (!branchId) return;
    try {
      const rows = await listSmartStock(dependencies.client, branchId);
      rows.forEach((row) => {
        const productId = text(row.producto_id);
        if (productId) smartStock.set(productId, mapSmartStockRow(row));
      });
    } catch (error) {
      console.warn("[Vendify] Stock inteligente no disponible:", errorMessage(error, "Sin datos"));
    }
  }

  async function loadProducts(): Promise<void> {
    const branchId = dependencies.getBranch().id;
    if (!branchId) {
      dependencies.setProducts([]);
      return;
    }
    try {
      const rows = await listProducts(dependencies.client, branchId);
      const mapped = rows.map(mapProductRow);
      dependencies.setProducts(mapped);
      await dependencies.captureOfflineStockSnapshot(mapped);
      dependencies.saveProductsOffline();
      await loadSmartStock();
      dependencies.refreshOnboarding();
    } catch (error) {
      console.error("[V2.26] Error cargando productos de sucursal:", error);
      if (!navigator.onLine && dependencies.loadProductsOffline()) {
        dependencies.showToast("Sin conexión · mostrando el último catálogo guardado", "info");
        return;
      }
      dependencies.showToast("No se pudieron cargar los productos de la sucursal", "error");
      dependencies.setProducts([]);
    }
  }

  async function initializeDefaultCategories(): Promise<void> {
    try {
      const rows = await initializeCategories(dependencies.client, DEFAULT_CATEGORIES);
      const names = rows.map((row) => text(row.nombre)).filter(Boolean);
      dependencies.setCategories(names.length ? names : [...DEFAULT_CATEGORIES]);
      dependencies.saveCategoriesOffline();
    } catch (error) {
      console.error("[Security] categorías iniciales:", error);
      dependencies.setCategories([...DEFAULT_CATEGORIES]);
    }
  }

  async function loadCategories(): Promise<void> {
    try {
      const rows = await listCategories(dependencies.client);
      const names = rows.map((row) => text(row.nombre)).filter(Boolean);
      if (!names.length) await initializeDefaultCategories();
      else dependencies.setCategories(names);
      dependencies.saveCategoriesOffline();
    } catch (error) {
      console.error("[Security] categorías:", error);
      if (!navigator.onLine && dependencies.loadCategoriesOffline()) return;
      dependencies.setCategories([...DEFAULT_CATEGORIES]);
    }
  }

  function renderCategorySelect(selected = ""): void {
    const select = field("#categoria");
    if (!(select instanceof HTMLSelectElement)) return;
    select.innerHTML = '<option value="">Sin categoría</option>';
    categories().forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      option.selected = category === selected;
      select.appendChild(option);
    });
  }

  function renderCategoryFilter(): void {
    const select = field("#filtro-categoria");
    if (!(select instanceof HTMLSelectElement)) return;
    const current = select.value;
    const used = [...new Set([
      ...categories(),
      ...products().map((product) => product.categoria).filter(Boolean)
    ])].sort((a, b) => a.localeCompare(b, "es"));
    select.innerHTML = '<option value="">Todas las categorías</option>';
    used.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      select.appendChild(option);
    });
    if (used.includes(current)) select.value = current;
  }

  function renderCategoryList(): void {
    const list = queryOne("#lista-categorias-config");
    if (!list) return;
    if (!categories().length) {
      list.innerHTML = '<li style="justify-content:center;color:var(--text-muted);">No hay categorías. Agregá una.</li>';
      return;
    }
    list.innerHTML = categories().map((category, index) => `
      <li>
        <span>${escapeHtml(category)}</span>
        <button type="button" class="btn-icon danger" data-cat-index="${String(index)}" title="Eliminar">🗑️</button>
      </li>`).join("");
  }

  async function addCategory(): Promise<void> {
    if (!dependencies.requirePermission("manageProducts", "No tenés permiso para administrar categorías")) return;
    const input = field("#nueva-categoria");
    if (!(input instanceof HTMLInputElement)) return;
    const name = input.value.trim();
    if (!name) {
      dependencies.showToast("Escribí un nombre de categoría", "error");
      return;
    }
    if (categories().some((category) => category.toLowerCase() === name.toLowerCase())) {
      dependencies.showToast("Esa categoría ya existe", "error");
      return;
    }
    try {
      await saveCategory(dependencies.client, name);
      dependencies.setCategories([...categories(), name].sort((a, b) => a.localeCompare(b, "es")));
      renderCategoryList();
      renderCategoryFilter();
      input.value = "";
      input.focus();
      dependencies.showToast(`Categoría "${name}" agregada`, "success");
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo guardar la categoría"), "error");
    }
  }

  async function removeCategory(index: number): Promise<void> {
    if (!dependencies.requirePermission("manageProducts", "No tenés permiso para administrar categorías")) return;
    const name = categories()[index];
    if (!name) return;
    const inUse = products().some((product) => product.categoria === name);
    const message = inUse
      ? `La categoría "${name}" está en uso. ¿La eliminás igual? Los productos quedan sin categoría.`
      : `¿Eliminar la categoría "${name}"?`;
    if (!await dependencies.confirm("Eliminar categoría", message)) return;
    try {
      await deleteCategory(dependencies.client, name);
      if (inUse) {
        dependencies.setProducts(products().map((product) =>
          product.categoria === name ? { ...product, categoria: "" } : product
        ));
      }
      dependencies.setCategories(categories().filter((_, current) => current !== index));
      renderCategoryList();
      renderCategoryFilter();
      render();
      dependencies.showToast("Categoría eliminada", "success");
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo eliminar la categoría"), "error");
    }
  }

  function updateQuickFilterUi(): void {
    const value = field("#filtro-stock-v29")?.value ?? "";
    queryOne("#stat-bajo-card")?.classList.toggle("active", legacyLowStockFilter || value === "bajo");
    queryOne("#stat-sin-card")?.classList.toggle("active", value === "sin");
    const active = legacyLowStockFilter || value === "bajo" || value === "sin";
    queryOne("#filtro-activo")?.classList.toggle("hidden", !active);
    setText(
      "#filtro-activo-texto",
      value === "sin" ? "Mostrando productos sin stock" : "Mostrando productos con stock bajo inteligente"
    );
  }

  function filteredProducts(): Product[] {
    const search = (field("#buscador")?.value ?? "").trim().toLowerCase();
    const category = field("#filtro-categoria")?.value ?? "";
    const stockFilter = field("#filtro-stock-v29")?.value ?? "";
    const [sortField = "nombre", direction = "asc"] = (field("#orden")?.value ?? "nombre-asc").split("-");
    const result = products().filter((product) => {
      const haystack = [
        product.nombre, product.marca, product.presentacion, product.codigoBarras, product.categoria
      ].filter(Boolean).join(" ").toLowerCase();
      const low = productIsLow(product);
      const out = isOutOfStock(product);
      return (!search || haystack.includes(search)) &&
        (!category || product.categoria === category) &&
        (!legacyLowStockFilter || low) &&
        (!stockFilter || (stockFilter === "bajo" && low) || (stockFilter === "sin" && out));
    });
    result.sort((a, b) => {
      const leftValue = a[sortField];
      const rightValue = b[sortField];
      const left = typeof leftValue === "string" ? leftValue.toLowerCase() : number(leftValue);
      const right = typeof rightValue === "string" ? rightValue.toLowerCase() : number(rightValue);
      if (left < right) return direction === "asc" ? -1 : 1;
      if (left > right) return direction === "asc" ? 1 : -1;
      return 0;
    });
    return result;
  }

  function render(): void {
    const grid = queryOne("#productos-grid");
    if (!grid) return;
    const productList = products();
    const visible = filteredProducts();
    const canManage = dependencies.hasPermission("manageProducts");
    const canAdjust = dependencies.hasPermission("adjustStock");
    const canViewCosts = dependencies.hasPermission("viewCosts");
    const totalStock = productList.reduce((sum, product) => sum + number(product.stock), 0);
    const totalCost = productList.reduce(
      (sum, product) => sum + number(product.stock) * number(product.precioCompra), 0
    );
    const totalSale = productList.reduce(
      (sum, product) => sum + number(product.stock) * number(product.precioVenta), 0
    );
    setText("#stat-productos", productList.length);
    setText("#stat-stock", totalStock);
    setText("#stat-costo", canViewCosts ? dependencies.formatPrice(totalCost) : "—");
    setText("#stat-venta", dependencies.formatPrice(totalSale));
    setText("#stat-bajo", productList.filter(productIsLow).length);
    setText("#stat-sin", productList.filter(isOutOfStock).length);
    const empty = queryOne("#empty-state");
    const noResults = queryOne("#no-results");
    if (!productList.length) {
      grid.innerHTML = "";
      empty?.classList.toggle("hidden", !canManage);
      noResults?.classList.add("hidden");
      return;
    }
    empty?.classList.add("hidden");
    if (!visible.length) {
      grid.innerHTML = "";
      noResults?.classList.remove("hidden");
      return;
    }
    noResults?.classList.add("hidden");
    grid.innerHTML = visible.map((product) => {
      const low = productIsLow(product);
      const stock = number(product.stock);
      const stockClass = stock === 0 ? "stock-zero-v29" : low ? "stock-low-v29" : "";
      const label = productLabel(product);
      const initial = (product.marca || product.nombre || "P").slice(0, 1).toUpperCase();
      const category = product.categoria || "Sin categoría";
      const stockHtml = canAdjust
        ? `<div class="row-stock-actions-v29" title="${escapeHtml(smartStockText(product, getSmartStock(product)))}">
            <button data-action="restar" aria-label="Restar stock">−</button>
            <button class="stock-number-v29 ${stockClass}" data-action="ajustar">${String(stock)}</button>
            <button data-action="sumar" aria-label="Sumar stock">+</button>
          </div>`
        : `<strong class="stock-number-v29 ${stockClass}" title="${
          escapeHtml(smartStockText(product, getSmartStock(product)))
        }">${String(stock)}</strong>`;
      const actions = canManage
        ? '<div class="row-actions-v29"><button class="btn btn-ghost btn-sm" data-action="editar">Editar</button>' +
          '<button class="btn-icon danger" data-action="eliminar" title="Eliminar" aria-label="Eliminar">🗑</button></div>'
        : "";
      return `
        <article class="producto-card producto-row-v29 producto-row-v223" data-id="${escapeHtml(product.id)}"
          data-mobile-editable="${canManage ? "true" : "false"}"
          ${canManage ? `tabindex="0" role="button" aria-label="Editar ${escapeHtml(label)}"` : ""}>
          <div class="producto-v223-media">${
            product.foto
              ? `<img src="${escapeHtml(product.foto)}" alt="" class="producto-v223-img">`
              : `<div class="producto-v223-icon">${escapeHtml(initial)}</div>`
          }</div>
          <div class="producto-v223-info"><strong class="producto-v223-nombre">${escapeHtml(label)}</strong>
            <small class="producto-v223-categoria">${escapeHtml(category)}</small></div>
          <div class="producto-v223-stock">${stockHtml}</div>
          <div class="producto-v223-precio"><strong>${dependencies.formatPrice(product.precioVenta)}</strong>${
            canViewCosts ? `<small>Costo ${dependencies.formatPrice(product.precioCompra)}</small>` : ""
          }</div>
          <div class="producto-v223-acciones">${actions}</div>
        </article>`;
    }).join("");
    dependencies.applyPermissions();
  }

  function updateSmartStockForm(product: ProductRecord | null): void {
    if (!product) {
      setText("#stock-smart-form-value", "Se calculará según las ventas");
      setText("#stock-smart-form-hint", "Cuando el producto tenga historial, Vendify calculará su umbral automáticamente.");
      return;
    }
    const info = getSmartStock(product);
    if (!info?.tieneHistorial) {
      setText("#stock-smart-form-value", "Todavía sin historial");
      setText("#stock-smart-form-hint", "El umbral aparecerá cuando existan ventas suficientes del producto.");
      return;
    }
    setText("#stock-smart-form-value", `≤ ${String(info.stockBajo)} unidades`);
    const days = info.diasCobertura == null ? "—" : `${info.diasCobertura.toFixed(1)} días`;
    setText(
      "#stock-smart-form-hint",
      `${info.promedioDiario.toFixed(2)} unidades/día · cobertura actual ${days}`
    );
  }

  function openEditor(product: ProductRecord | null = null): void {
    if (!dependencies.requirePermission("manageProducts", "No tenés permiso para modificar productos")) return;
    const mapped = product ? product as Product : null;
    const editingId = mapped?.id ?? null;
    dependencies.setEditingProductId(editingId);
    dependencies.setCurrentPhoto(mapped?.foto ?? null);
    setText("#modal-titulo", mapped ? "Editar producto" : "Nuevo producto");
    setText("#producto-branch-hint-v226", `Stock de sucursal: ${dependencies.getBranch().name || "—"}`);
    setValue("#producto-id", editingId ?? "");
    setValue("#nombre", mapped?.nombre ?? "");
    setValue("#marca", mapped?.marca ?? "");
    setValue("#presentacion", mapped?.presentacion ?? "");
    setValue("#codigo-barras", mapped?.codigoBarras ?? "");
    setValue("#precio-compra", mapped?.precioCompra ?? "");
    setValue("#precio-venta", mapped?.precioVenta ?? "");
    setValue("#stock", mapped?.stock ?? 0);
    setValue("#stock-minimo", 0);
    const stock = field("#stock");
    if (stock instanceof HTMLInputElement) {
      stock.disabled = !dependencies.hasPermission("adjustStock");
      stock.title = stock.disabled ? "El propietario no habilitó la modificación manual de stock" : "";
    }
    updateSmartStockForm(mapped);
    setText("#error-nombre", "");
    setText("#barcode-status-v29", "");
    renderCategorySelect(mapped?.categoria ?? "");
    const modal = queryOne("#modal");
    const content = modal?.querySelector(".modal-content");
    modal?.classList.remove("hidden");
    requestAnimationFrame(() => {
      if (content instanceof HTMLElement) content.scrollTop = 0;
      const initial = field(mapped ? "#nombre" : "#marca");
      try { initial?.focus({ preventScroll: true }); } catch { initial?.focus(); }
      if (content instanceof HTMLElement) content.scrollTop = 0;
    });
  }

  function closeEditor(preserveScannerFlow = false): void {
    queryOne("#modal")?.classList.add("hidden");
    const form = queryOne("#form-producto");
    if (form instanceof HTMLFormElement) form.reset();
    dependencies.setEditingProductId(null);
    dependencies.setCurrentPhoto(null);
    dependencies.restoreSaleBehindProduct(!preserveScannerFlow);
    if (!preserveScannerFlow) dependencies.clearPendingScannerProduct();
  }

  async function submitProduct(event: Event): Promise<void> {
    event.preventDefault();
    if (!dependencies.requirePermission("manageProducts", "No tenés permiso para modificar productos")) return;
    const branch = dependencies.getBranch();
    if (!branch.id) {
      dependencies.showToast("Seleccioná una sucursal antes de guardar", "error");
      return;
    }
    const name = field("#nombre")?.value.trim() ?? "";
    const barcode = field("#codigo-barras")?.value.trim() ?? "";
    const editingId = dependencies.getEditingProductId();
    if (!name) {
      setText("#error-nombre", "El nombre es obligatorio");
      return;
    }
    const duplicate = barcode && products().find(
      (product) => product.codigoBarras === barcode && product.id !== editingId
    );
    if (duplicate) {
      dependencies.showToast(`Ese código ya pertenece a "${duplicate.nombre}"`, "error");
      return;
    }
    const button = queryOne("#btn-guardar");
    if (button instanceof HTMLButtonElement) button.disabled = true;
    try {
      const row = await saveProduct(dependencies.client, {
        productId: editingId,
        branchId: branch.id,
        name,
        brand: nullableText(field("#marca")?.value),
        presentation: nullableText(field("#presentacion")?.value),
        barcode: nullableText(barcode),
        category: nullableText(field("#categoria")?.value),
        purchasePrice: Math.max(0, Number.parseFloat(field("#precio-compra")?.value ?? "") || 0),
        salePrice: Math.max(0, Number.parseFloat(field("#precio-venta")?.value ?? "") || 0),
        stock: Math.max(0, Number.parseInt(field("#stock")?.value ?? "", 10) || 0)
      });
      const mapped = mapProductRow(row);
      const editing = Boolean(editingId);
      if (editing) {
        dependencies.setProducts(products().map((product) => product.id === editingId ? mapped : product));
      } else dependencies.setProducts([...products(), mapped]);
      await loadSmartStock();
      renderCategoryFilter();
      render();
      const returnToSale = !editing && dependencies.shouldReturnCreatedProductToSale();
      closeEditor(returnToSale);
      if (returnToSale) {
        dependencies.clearPendingScannerProduct();
        queryOne("#modal-venta")?.classList.remove("hidden");
        dependencies.restoreSaleBehindProduct(false);
        dependencies.addToCart(mapped.id);
        dependencies.renderSaleProducts();
        dependencies.renderCart();
        setTimeout(() => field("#venta-buscador")?.focus(), 80);
        dependencies.showToast(`${mapped.nombre} registrado en ${branch.name} y agregado a la venta`, "success");
        return;
      }
      dependencies.showToast(
        editing ? `Producto actualizado en ${branch.name}` : `Producto agregado a ${branch.name}`,
        "success"
      );
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo guardar el producto"), "error");
    } finally {
      if (button instanceof HTMLButtonElement) button.disabled = false;
    }
  }

  async function removeProduct(productId: string): Promise<void> {
    if (!["owner", "admin", "manager"].includes(dependencies.getRole())) {
      dependencies.showToast("Tu rol no permite eliminar productos", "error");
      return;
    }
    if (!dependencies.requirePermission("manageProducts", "No tenés permiso para eliminar productos")) return;
    const product = products().find((candidate) => candidate.id === productId);
    if (!product) return;
    if (!await dependencies.confirm(
      "Eliminar producto",
      `¿Seguro que querés eliminar "${product.nombre}"? Esta acción no se puede deshacer.`
    )) return;
    try {
      await deleteProduct(dependencies.client, productId);
      dependencies.setProducts(products().filter((candidate) => candidate.id !== productId));
      renderCategoryFilter();
      render();
      dependencies.showToast("Producto eliminado", "success");
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo eliminar el producto"), "error");
    }
  }

  async function removeAllProducts(): Promise<void> {
    if (!["owner", "admin"].includes(dependencies.getRole())) {
      dependencies.showToast("Solo propietario o administrador pueden eliminar todos los productos", "error");
      return;
    }
    if (!products().length) {
      dependencies.showToast("No hay productos para eliminar", "info");
      return;
    }
    const amount = products().length;
    if (!await dependencies.confirm(
      "Eliminar todos los productos",
      `Vas a eliminar ${String(amount)} productos del negocio. Esta acción no se puede deshacer.`
    )) return;
    if (!await dependencies.confirm(
      "Confirmación final",
      `¿Realmente querés eliminar los ${String(amount)} productos? Las ventas históricas no deberían borrarse, pero el catálogo actual quedará vacío.`
    )) return;
    const button = queryOne("#btn-eliminar-todos-productos");
    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
      button.textContent = "Eliminando...";
    }
    try {
      await deleteAllProducts(dependencies.client);
      dependencies.setProducts([]);
      renderCategoryFilter();
      render();
      dependencies.showToast(`${String(amount)} productos eliminados`, "success");
    } catch (error) {
      console.error("[Vendify Security] Error eliminando productos:", error);
      dependencies.showToast(errorMessage(error, "No se pudieron eliminar los productos"), "error");
    } finally {
      if (button instanceof HTMLButtonElement) {
        button.disabled = false;
        button.textContent = "🗑 Eliminar todos";
      }
    }
  }

  async function executeStockChange(productId: string, delta: number): Promise<void> {
    if (!dependencies.requirePermission(
      "adjustStock",
      "El propietario no habilitó la modificación manual de stock para tu usuario"
    )) return;
    const product = products().find((candidate) => candidate.id === productId);
    const branchId = dependencies.getBranch().id;
    if (!product || !branchId) return;
    if (delta < 0 && number(product.stock) <= 0) {
      dependencies.showToast(`"${product.nombre}" ya está en stock 0`, "info");
      return;
    }
    try {
      const data = await adjustInitialStock(dependencies.client, productId, branchId, delta);
      if (data.requiere_motivo) {
        dependencies.openInventoryAdjustment(productId, delta);
        return;
      }
      product.stock = number(data.stock ?? number(product.stock) + delta);
      dependencies.emitStockChange("stock_inicial");
      render();
      dependencies.scheduleSmartRefresh();
      if (dependencies.isSaleOpen()) {
        dependencies.renderSaleProducts();
        dependencies.renderCart();
      }
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo modificar el stock"), "error");
    }
  }

  function changeStock(productId: string, delta: number): Promise<void> {
    const previous = stockQueue.get(productId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => executeStockChange(productId, delta)).finally(() => {
      if (stockQueue.get(productId) === next) stockQueue.delete(productId);
    });
    stockQueue.set(productId, next);
    return next;
  }

  async function ensureCategory(name: string): Promise<void> {
    if (!name || categories().includes(name)) return;
    try {
      await saveCategory(dependencies.client, name);
      dependencies.setCategories([...categories(), name].sort((a, b) => a.localeCompare(b, "es")));
      renderCategoryFilter();
    } catch {
      // External barcode lookup remains useful even if its suggested category cannot be stored.
    }
  }

  async function lookupBarcode(code: string): Promise<ProductRecord | null> {
    const normalized = code.trim();
    if (!normalized) return null;
    setText("#barcode-status-v29", "Buscando datos del producto...");
    try {
      const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(normalized)}.json` +
        "?fields=code,product_name,brands,quantity,categories";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Consulta no disponible");
      const payload = await response.json() as ProductRecord;
      const product = typeof payload.product === "object" && payload.product !== null
        ? payload.product as ProductRecord
        : null;
      if (payload.status !== 1 || !product) {
        setText("#barcode-status-v29", "Código no encontrado. Podés completar los datos manualmente.");
        return null;
      }
      const brand = text(product.brands).split(",")[0]?.trim() ?? "";
      const name = text(product.product_name).trim();
      const quantity = text(product.quantity).trim();
      if (!field("#marca")?.value) setValue("#marca", brand);
      if (!field("#presentacion")?.value) setValue("#presentacion", quantity);
      if (!field("#nombre")?.value) {
        setValue("#nombre", [brand, name, quantity].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
      }
      const localCategory = mapExternalCategory(text(product.categories));
      if (!field("#categoria")?.value) {
        await ensureCategory(localCategory);
        renderCategorySelect(localCategory);
      }
      setText("#barcode-status-v29", "Datos encontrados. Revisalos y completá precio/stock.");
      return product;
    } catch (error) {
      console.warn("OpenFoodFacts", error);
      setText("#barcode-status-v29", "No pudimos consultar la base externa. El código quedó cargado.");
      return null;
    }
  }

  function catalogItems(): readonly CatalogProduct[] {
    return PRODUCT_CATALOG.filter((item) => item.catalogos.includes(catalogKind));
  }

  function renderCatalog(): void {
    queryAll(".catalog-tab-v29").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-catalog") === catalogKind);
    });
    const search = (field("#catalog-search-v29")?.value ?? "").trim().toLowerCase();
    const existing = new Set(products().map((product) => product.nombre.toLowerCase()));
    const visible = catalogItems().filter((item) =>
      !search || [item.nombre, item.marca, item.presentacion, item.categoria].join(" ").toLowerCase().includes(search)
    );
    const list = queryOne("#catalog-list-v29");
    if (list) {
      list.innerHTML = visible.map((item) => {
        const exists = existing.has(item.nombre.toLowerCase());
        return `<label class="catalog-row-v29 ${exists ? "already-v29" : ""}">
          <input type="checkbox" data-catalog-name="${escapeHtml(item.nombre)}" ${
            catalogSelection.has(item.nombre) && !exists ? "checked" : ""
          } ${exists ? "disabled" : ""}>
          <span><strong>${escapeHtml(item.nombre)}</strong><small>${escapeHtml(item.categoria)}${
            exists ? " · ya cargado" : ""
          }</small></span></label>`;
      }).join("");
    }
    setText(
      "#catalog-selected-count-v29",
      [...catalogSelection].filter((name) => !existing.has(name.toLowerCase())).length
    );
  }

  function openCatalog(): void {
    if (!dependencies.requirePermission("manageProducts", "No tenés permiso para cargar catálogos")) return;
    catalogKind = "kiosco";
    catalogSelection = new Set(catalogItems().map((item) => item.nombre));
    setValue("#catalog-search-v29", "");
    queryOne("#modal-catalogo-v29")?.classList.remove("hidden");
    renderCatalog();
  }

  function closeCatalog(): void {
    queryOne("#modal-catalogo-v29")?.classList.add("hidden");
  }

  async function submitCatalog(): Promise<void> {
    const branchId = dependencies.getBranch().id;
    if (!branchId) return;
    const existing = new Set(products().map((product) => product.nombre.toLowerCase()));
    const selected = PRODUCT_CATALOG.filter((item) =>
      catalogSelection.has(item.nombre) && !existing.has(item.nombre.toLowerCase())
    );
    if (!selected.length) {
      dependencies.showToast("No hay productos nuevos seleccionados", "info");
      return;
    }
    try {
      const data = await importCatalog(dependencies.client, branchId, selected);
      await loadCategories();
      await loadProducts();
      renderCategoryFilter();
      render();
      closeCatalog();
      dependencies.showToast(
        `${String(number(data.importados))} productos importados. Ahora cargá precios y stock.`,
        "success"
      );
    } catch (error) {
      console.error(error);
      dependencies.showToast(errorMessage(error, "No se pudo importar el catálogo"), "error");
    }
  }

  function toggleLowStock(): void {
    const select = field("#filtro-stock-v29");
    if (select) select.value = "";
    legacyLowStockFilter = !legacyLowStockFilter;
    updateQuickFilterUi();
    render();
    if (legacyLowStockFilter) {
      dependencies.showToast("Filtrando stock bajo según velocidad de venta", "info");
    }
  }

  function toggleOutOfStock(): void {
    const select = field("#filtro-stock-v29");
    if (!select) return;
    legacyLowStockFilter = false;
    select.value = select.value === "sin" ? "" : "sin";
    updateQuickFilterUi();
    render();
    if (select.value === "sin") dependencies.showToast("Filtrando productos sin stock", "info");
  }

  function clearStockFilter(): void {
    legacyLowStockFilter = false;
    const select = field("#filtro-stock-v29");
    if (select) select.value = "";
    updateQuickFilterUi();
    render();
  }

  function applyRemoteChange(payload: RemotePayload): void {
    const current = products();
    const next = payload.new;
    const old = payload.old;
    if (payload.eventType === "INSERT" && next && !current.some((product) => product.id === text(next.id))) {
      dependencies.setProducts([...current, mapProductRow(next)]);
    } else if (payload.eventType === "UPDATE" && next) {
      dependencies.setProducts(current.map((product) => product.id === text(next.id) ? mapProductRow(next) : product));
    } else if (payload.eventType === "DELETE" && old) {
      dependencies.setProducts(current.filter((product) => product.id !== text(old.id)));
    }
    renderCategoryFilter();
    render();
    dependencies.applyPermissions();
    if (dependencies.isSaleOpen()) dependencies.renderSaleProducts();
  }

  function handleGridAction(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("[data-action]");
    const card = target.closest<HTMLElement>(".producto-card");
    const productId = card?.dataset.id;
    if (!productId) return;
    if (!button) {
      if (!window.matchMedia("(max-width: 700px)").matches || card.dataset.mobileEditable !== "true") return;
      const product = products().find((candidate) => candidate.id === productId);
      if (product) openEditor(product);
      return;
    }
    const action = button.getAttribute("data-action");
    if (action === "sumar" || action === "restar") {
      void changeStock(productId, action === "sumar" ? 1 : -1);
    } else if (action === "ajustar") {
      dependencies.openManualStockModal(productId);
    } else if (action === "editar") {
      const product = products().find((candidate) => candidate.id === productId);
      if (product) openEditor(product);
    } else if (action === "eliminar") void removeProduct(productId);
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#btn-nuevo")?.addEventListener("click", () => { openEditor(); });
    queryOne("#btn-empty-nuevo")?.addEventListener("click", () => { openEditor(); });
    queryOne("#form-producto")?.addEventListener("submit", (event) => { void submitProduct(event); });
    queryOne("#btn-cerrar-modal")?.addEventListener("click", () => { closeEditor(); });
    queryOne("#btn-cancelar")?.addEventListener("click", () => { closeEditor(); });
    queryOne("#modal .modal-backdrop")?.addEventListener("click", () => { closeEditor(); });
    queryOne("#buscador")?.addEventListener("input", render);
    queryOne("#filtro-categoria")?.addEventListener("change", render);
    queryOne("#orden")?.addEventListener("change", render);
    queryOne("#filtro-stock-v29")?.addEventListener("change", () => {
      legacyLowStockFilter = false;
      updateQuickFilterUi();
      render();
    });
    queryOne("#stat-bajo-card")?.addEventListener("click", toggleLowStock);
    queryOne("#stat-sin-card")?.addEventListener("click", toggleOutOfStock);
    queryOne("#btn-limpiar-filtro")?.addEventListener("click", clearStockFilter);
    queryOne("#btn-add-categoria")?.addEventListener("click", () => { void addCategory(); });
    queryOne("#nueva-categoria")?.addEventListener("keydown", (event) => {
      if (event instanceof KeyboardEvent && event.key === "Enter") {
        event.preventDefault();
        void addCategory();
      }
    });
    queryOne("#lista-categorias-config")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLElement>("[data-cat-index]");
      if (button) void removeCategory(Number(button.dataset.catIndex));
    });
    queryOne("#productos-grid")?.addEventListener("click", handleGridAction);
    queryOne("#productos-grid")?.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent) || (event.key !== "Enter" && event.key !== " ")) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest("[data-action]")) return;
      const card = target.closest<HTMLElement>('.producto-card[data-mobile-editable="true"]');
      const product = products().find((candidate) => candidate.id === card?.dataset.id);
      if (product) {
        event.preventDefault();
        openEditor(product);
      }
    });
    queryOne("#btn-catalogo-v29")?.addEventListener("click", openCatalog);
    queryOne("#btn-cargar-ejemplos")?.addEventListener("click", openCatalog);
    queryOne("#btn-cargar-ejemplos-config")?.addEventListener("click", openCatalog);
    queryOne("#btn-eliminar-todos-productos")?.addEventListener("click", () => { void removeAllProducts(); });
    queryOne("#btn-buscar-barcode")?.addEventListener("click", () => {
      void lookupBarcode(field("#codigo-barras")?.value ?? "");
    });
    queryOne("#btn-close-catalogo-v29")?.addEventListener("click", closeCatalog);
    queryOne("#btn-cancel-catalogo-v29")?.addEventListener("click", closeCatalog);
    queryOne("#modal-catalogo-v29 .modal-backdrop")?.addEventListener("click", closeCatalog);
    queryOne("#catalog-search-v29")?.addEventListener("input", renderCatalog);
    queryAll(".catalog-tab-v29").forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.getAttribute("data-catalog");
        if (kind === "kiosco" || kind === "almacen" || kind === "minimercado") catalogKind = kind;
        catalogSelection = new Set(catalogItems().map((item) => item.nombre));
        renderCatalog();
      });
    });
    queryOne("#catalog-list-v29")?.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const checkbox = target.closest<HTMLInputElement>("[data-catalog-name]");
      const name = checkbox?.dataset.catalogName;
      if (!checkbox || !name) return;
      if (checkbox.checked) catalogSelection.add(name);
      else catalogSelection.delete(name);
      renderCatalog();
    });
    queryOne("#catalog-select-all-v29")?.addEventListener("click", () => {
      queryAll("#catalog-list-v29 input:not(:disabled)").forEach((element) => {
        if (element instanceof HTMLInputElement && element.dataset.catalogName) {
          catalogSelection.add(element.dataset.catalogName);
        }
      });
      renderCatalog();
    });
    queryOne("#catalog-clear-v29")?.addEventListener("click", () => {
      queryAll("#catalog-list-v29 input:not(:disabled)").forEach((element) => {
        if (element instanceof HTMLInputElement && element.dataset.catalogName) {
          catalogSelection.delete(element.dataset.catalogName);
        }
      });
      renderCatalog();
    });
    queryOne("#btn-import-catalogo-v29")?.addEventListener("click", () => { void submitCatalog(); });
  }

  return Object.freeze({
    setup,
    loadProducts,
    loadCategories,
    loadSmartStock,
    render,
    renderCategoryFilter,
    renderCategorySelect,
    renderCategoryList,
    getSmartStock,
    isLowStock: productIsLow,
    isOutOfStock,
    openEditor,
    closeEditor,
    lookupBarcode,
    ensureCategory,
    openCatalog,
    applyRemoteChange
  });
}
