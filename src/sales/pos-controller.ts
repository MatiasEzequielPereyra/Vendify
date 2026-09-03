import { escapeHtml, queryAll, queryOne } from "../core/dom.js";
import type { DiscountController } from "./discount-controller.js";
import {
  calculateSaleTotals,
  normalizeSalePayments,
  type PaymentMode,
  type SalePayment,
  type SaleTotals,
  type SalesRecord
} from "./sales-model.js";
import { registerSale, type SalesRpcClientPort } from "./sales-service.js";

export interface CartItem {
  readonly id: string;
  readonly nombre: string;
  readonly precioVenta: number;
  readonly stock: number;
  cantidad: number;
}

interface PosContext {
  readonly ready: boolean;
  readonly branchId: string | null;
  readonly cashRegisterId: string | null;
}

export interface PosControllerDependencies {
  readonly client: SalesRpcClientPort;
  readonly discount: DiscountController;
  readonly getContext: () => PosContext;
  readonly canSell: (message: string) => boolean;
  readonly getProducts: () => SalesRecord[];
  readonly isCashOpenByCurrentUser: () => boolean;
  readonly hasCashSession: () => boolean;
  readonly restoreOfflineCash: () => boolean;
  readonly openCashPanel: () => void;
  readonly isOnline: () => boolean;
  readonly formatCurrency: (value: number) => string;
  readonly showToast: (message: string, type: "error" | "info" | "success") => void;
  readonly renderSaleProducts: () => void;
  readonly persistCart: () => void;
  readonly applyOfflineSaleState: () => void;
  readonly validateOfflinePayments: (payments: readonly SalePayment[]) => void;
  readonly registerOfflineSale: (
    items: readonly CartItem[],
    payments: readonly SalePayment[],
    totals: SaleTotals,
    observation: string
  ) => SalesRecord | Promise<SalesRecord>;
  readonly updateOfflineUi: () => void;
  readonly clearPersistedCart: () => void;
  readonly reloadProducts: () => Promise<void>;
  readonly renderProducts: () => void;
  readonly reloadCash: () => Promise<void>;
  readonly emitStockChange: (reason: string) => void;
  readonly refreshDependentViews: (reason: string) => void;
  readonly showTicket: (data: SalesRecord) => void;
  readonly afterOnlineSale: () => void;
}

export interface PosController {
  readonly setup: () => void;
  readonly open: () => void;
  readonly close: () => void;
  readonly addToCart: (id: string) => void;
  readonly changeQuantity: (id: string, delta: number) => void;
  readonly removeFromCart: (id: string) => void;
  readonly getCart: () => CartItem[];
  readonly isConfirming: () => boolean;
  readonly setCart: (items: readonly CartItem[]) => void;
  readonly clearCart: () => void;
  readonly getTotal: () => number;
  readonly renderCart: () => void;
  readonly calculateTotals: () => SaleTotals;
  readonly updateTotals: () => SaleTotals;
  readonly ensureRequestId: () => string;
  readonly resetRequestId: () => void;
}

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function field(selector: string): Field | null {
  const element = queryOne(selector);
  return element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
    ? element
    : null;
}

function number(value: unknown): number {
  return Number(value ?? 0);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function createRequestId(): string {
  const optionalCrypto = crypto as unknown as { randomUUID?: (this: Crypto) => string };
  const generated = optionalCrypto.randomUUID?.call(crypto);
  if (generated) return generated;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createPosController(dependencies: PosControllerDependencies): PosController {
  let cart: CartItem[] = [];
  let paymentMode: PaymentMode = "single";
  let requestId: string | null = null;
  let confirming = false;
  let setupComplete = false;
  const paymentMethods = ["Efectivo", "Débito", "Crédito", "Transferencia", "Mercado Pago", "Otro"];

  function getTotal(): number {
    return cart.reduce((total, item) => total + item.precioVenta * item.cantidad, 0);
  }

  function calculateTotals(): SaleTotals {
    return calculateSaleTotals(dependencies.discount.getRequest(), dependencies.discount.isAuthorized());
  }

  function mixedPaymentsFromDom(): SalePayment[] {
    return [...queryAll(".mixed-pay-row-v228")].map((row) => {
      const method = row.querySelector(".mixed-pay-method-v228");
      const amount = row.querySelector(".mixed-pay-amount-v228");
      return {
        medio_pago: method instanceof HTMLSelectElement ? method.value : "Otro",
        monto: amount instanceof HTMLInputElement ? number(amount.value) : 0
      };
    });
  }

  function paymentOptions(selected: string): string {
    return paymentMethods.map((method) =>
      `<option value="${escapeHtml(method)}" ${method === selected ? "selected" : ""}>${escapeHtml(method)}</option>`
    ).join("");
  }

  function renderMixedPayments(payments: readonly SalePayment[]): void {
    const container = queryOne("#mixed-payment-rows-v228");
    if (!container) return;
    container.innerHTML = payments.map((payment, index) =>
      `<div class="mixed-pay-row-v228" data-pay-index="${String(index)}"><select class="select mixed-pay-method-v228">${
        paymentOptions(payment.medio_pago || "Efectivo")
      }</select><div class="mixed-pay-amount-wrap-v228"><span>$</span><input class="mixed-pay-amount-v228" type="number" min="0" step="0.01" value="${
        number(payment.monto).toFixed(2)
      }"/></div><button type="button" class="btn btn-ghost btn-sm mixed-pay-rest-v228" data-pay-rest title="Completar con el restante">Restante</button><button type="button" class="btn-icon danger mixed-pay-remove-v228" data-pay-remove title="Quitar">✕</button></div>`
    ).join("");
    updateRemainingPayment();
  }

  function updateRemainingPayment(): void {
    const element = queryOne("#mixed-payment-remaining-v228");
    if (!element) return;
    const total = calculateTotals().total;
    const paid = mixedPaymentsFromDom().reduce((sum, payment) => sum + number(payment.monto), 0);
    const remaining = Math.round((total - paid) * 100) / 100;
    element.textContent = Math.abs(remaining) <= 0.01
      ? "Pago completo"
      : remaining > 0
        ? `Restante ${dependencies.formatCurrency(remaining)}`
        : `Excede ${dependencies.formatCurrency(Math.abs(remaining))}`;
    element.classList.toggle("ok", Math.abs(remaining) <= 0.01);
    element.classList.toggle("error", remaining < -0.01);
  }

  function updateTotals(): SaleTotals {
    const totals = calculateTotals();
    const subtotal = queryOne("#venta-subtotal-v228");
    const discount = queryOne("#venta-descuento-total-v228");
    const discountRow = queryOne("#venta-descuento-row-v228");
    const total = queryOne("#carrito-total");
    if (subtotal) subtotal.textContent = dependencies.formatCurrency(totals.subtotal);
    if (discount) discount.textContent = `−${dependencies.formatCurrency(totals.descuento)}`;
    discountRow?.classList.toggle("hidden", totals.descuento <= 0);
    if (total) total.textContent = dependencies.formatCurrency(totals.total);
    updateRemainingPayment();
    dependencies.discount.render();
    return totals;
  }

  function resetSale(): void {
    paymentMode = "single";
    dependencies.discount.invalidate({ recalculate: false });
    queryAll("[data-pay-mode-v228]").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-pay-mode-v228") === "single");
    });
    queryOne("#single-payment-v228")?.classList.remove("hidden");
    queryOne("#mixed-payment-v228")?.classList.add("hidden");
    const method = field("#medio-pago");
    const discountType = field("#venta-descuento-tipo-v228");
    const discountValue = field("#venta-descuento-valor-v228");
    const observation = field("#venta-observacion-v228");
    if (method) method.value = "Efectivo";
    if (discountType) discountType.value = "";
    if (discountValue) {
      discountValue.value = "0";
      discountValue.disabled = true;
    }
    if (observation) observation.value = "";
    renderMixedPayments([
      { medio_pago: "Efectivo", monto: 0 },
      { medio_pago: "Transferencia", monto: 0 }
    ]);
    updateTotals();
  }

  function activatePaymentMode(mode: string): void {
    paymentMode = mode === "mixed" ? "mixed" : "single";
    queryAll("[data-pay-mode-v228]").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-pay-mode-v228") === paymentMode);
    });
    queryOne("#single-payment-v228")?.classList.toggle("hidden", paymentMode !== "single");
    queryOne("#mixed-payment-v228")?.classList.toggle("hidden", paymentMode !== "mixed");
    if (paymentMode === "mixed") {
      const rows = queryOne("#mixed-payment-rows-v228");
      if (rows && !rows.children.length) {
        renderMixedPayments([
          { medio_pago: "Efectivo", monto: calculateTotals().total },
          { medio_pago: "Transferencia", monto: 0 }
        ]);
      } else {
        const inputs = [...queryAll(".mixed-pay-amount-v228")].filter(
          (element): element is HTMLInputElement => element instanceof HTMLInputElement
        );
        const paid = inputs.reduce((sum, input) => sum + number(input.value), 0);
        const first = inputs[0];
        if (paid <= 0 && first) first.value = calculateTotals().total.toFixed(2);
      }
    }
    updateRemainingPayment();
  }

  function addMixedPayment(): void {
    renderMixedPayments([...mixedPaymentsFromDom(), { medio_pago: "Efectivo", monto: 0 }]);
  }

  function completeRemainingPayment(row: Element): void {
    let otherPayments = 0;
    queryAll(".mixed-pay-row-v228").forEach((candidate) => {
      if (candidate === row) return;
      const input = candidate.querySelector(".mixed-pay-amount-v228");
      if (input instanceof HTMLInputElement) otherPayments += number(input.value);
    });
    const input = row.querySelector(".mixed-pay-amount-v228");
    if (input instanceof HTMLInputElement) {
      input.value = Math.max(0, calculateTotals().total - otherPayments).toFixed(2);
    }
    updateRemainingPayment();
  }

  function paymentsForSale(total: number): SalePayment[] {
    return normalizeSalePayments(
      paymentMode,
      total,
      field("#medio-pago")?.value ?? "Efectivo",
      mixedPaymentsFromDom(),
      dependencies.formatCurrency
    );
  }

  function renderCart(): void {
    const container = queryOne("#carrito-items");
    const count = queryOne("#carrito-count-v210");
    const charge = queryOne("#btn-cobrar");
    if (!container) return;
    const units = cart.reduce((sum, item) => sum + number(item.cantidad), 0);
    if (count) count.textContent = `${String(units)} ${units === 1 ? "artículo" : "artículos"}`;
    if (!cart.length) {
      container.innerHTML = '<p class="carrito-vacio" id="carrito-vacio">Tocá un producto para agregarlo</p>';
      updateTotals();
      if (charge instanceof HTMLButtonElement) charge.disabled = true;
      dependencies.persistCart();
      dependencies.applyOfflineSaleState();
      return;
    }
    container.innerHTML = cart.map((item) =>
      `<div class="carrito-item" data-id="${escapeHtml(item.id)}"><div class="carrito-item-info"><div class="carrito-item-nombre">${
        escapeHtml(item.nombre)
      }</div><div class="carrito-item-sub">${dependencies.formatCurrency(item.precioVenta)} c/u · ${
        dependencies.formatCurrency(item.precioVenta * item.cantidad)
      }</div></div><div class="carrito-item-qty"><button type="button" data-qty="-1">−</button><span>${
        String(item.cantidad)
      }</span><button type="button" data-qty="1">+</button></div><button type="button" class="carrito-item-quitar" data-quitar title="Quitar">🗑️</button></div>`
    ).join("");
    updateTotals();
    if (charge instanceof HTMLButtonElement) charge.disabled = false;
    dependencies.persistCart();
    dependencies.applyOfflineSaleState();
  }

  function addToCart(id: string): void {
    dependencies.discount.invalidate({ recalculate: false });
    const product = dependencies.getProducts().find((candidate) => candidate.id === id);
    if (!product) return;
    const item = cart.find((candidate) => candidate.id === id);
    const inCart = item?.cantidad ?? 0;
    const stock = number(product.stock);
    if (inCart >= stock) {
      dependencies.showToast(`No queda más stock de "${text(product.nombre)}"`, "error");
      return;
    }
    if (item) item.cantidad += 1;
    else {
      cart.push({
        id: text(product.id),
        nombre: text(product.nombre),
        precioVenta: number(product.precioVenta),
        stock,
        cantidad: 1
      });
    }
    dependencies.renderSaleProducts();
    renderCart();
  }

  function changeQuantity(id: string, delta: number): void {
    dependencies.discount.invalidate({ recalculate: false });
    const item = cart.find((candidate) => candidate.id === id);
    if (!item) return;
    const product = dependencies.getProducts().find((candidate) => candidate.id === id);
    const maximum = product ? number(product.stock) : item.stock;
    item.cantidad = Math.max(1, Math.min(maximum, item.cantidad + delta));
    dependencies.renderSaleProducts();
    renderCart();
  }

  function removeFromCart(id: string): void {
    dependencies.discount.invalidate({ recalculate: false });
    cart = cart.filter((item) => item.id !== id);
    dependencies.renderSaleProducts();
    renderCart();
  }

  function setCart(items: readonly CartItem[]): void {
    cart = items.map((item) => ({ ...item }));
  }

  function clearCart(): void {
    cart = [];
  }

  function ensureRequestId(): string {
    requestId ??= createRequestId();
    return requestId;
  }

  function resetRequestId(): void {
    requestId = null;
  }

  function open(): void {
    requestId = createRequestId();
    confirming = false;
    const context = dependencies.getContext();
    if (!context.cashRegisterId) {
      dependencies.showToast("Seleccioná una caja antes de vender", "error");
      return;
    }
    if (!dependencies.isCashOpenByCurrentUser() && !(!dependencies.isOnline() && dependencies.restoreOfflineCash())) {
      dependencies.showToast(
        !dependencies.isOnline()
          ? "Para vender offline, esta caja debe haber sido abierta previamente con internet"
          : dependencies.hasCashSession()
            ? "Esta caja está abierta por otro usuario"
            : "Abrí la caja antes de comenzar a vender",
        "info"
      );
      if (dependencies.isOnline()) dependencies.openCashPanel();
      return;
    }
    cart = [];
    const search = field("#venta-buscador");
    if (search) search.value = "";
    resetSale();
    dependencies.renderSaleProducts();
    renderCart();
    queryOne("#modal-venta")?.classList.remove("hidden");
    setTimeout(() => field("#venta-buscador")?.focus(), 50);
  }

  function close(): void {
    queryOne("#modal-venta")?.classList.add("hidden");
    cart = [];
  }

  async function confirmSale(): Promise<void> {
    if (!cart.length || confirming) return;
    const button = queryOne("#btn-cobrar");
    const offline = !dependencies.isOnline();
    const discountRequest = dependencies.discount.getRequest();
    if (offline && discountRequest.tipo && discountRequest.valor > 0) {
      dependencies.showToast("Los descuentos requieren conexión para validar la autorización.", "error");
      return;
    }
    if (!offline && discountRequest.tipo && discountRequest.valor > 0 && !dependencies.discount.isAuthorized()) {
      dependencies.showToast("Autorizá el descuento con un PIN de administrador", "error");
      dependencies.discount.openAuthorization();
      return;
    }
    const totals = calculateTotals();
    let payments: SalePayment[];
    try {
      payments = paymentsForSale(totals.total);
      if (offline) dependencies.validateOfflinePayments(payments);
    } catch (error) {
      dependencies.showToast(errorMessage(error, "Revisá los medios de pago"), "error");
      return;
    }
    confirming = true;
    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
      button.textContent = offline ? "Guardando..." : "Cobrando...";
    }
    try {
      const observation = field("#venta-observacion-v228")?.value.trim() ?? "";
      if (offline) {
        const ticket = await dependencies.registerOfflineSale(cart, payments, totals, observation);
        dependencies.showToast("Venta guardada offline. Se sincronizará automáticamente.", "success");
        dependencies.discount.invalidate({ recalculate: false });
        requestId = null;
        close();
        dependencies.showTicket(ticket);
        dependencies.updateOfflineUi();
        return;
      }
      if (!dependencies.canSell("Tu usuario no tiene permiso para registrar ventas")) return;
      const context = dependencies.getContext();
      if (!context.ready) throw new Error("El contexto del negocio todavía no está cargado");
      if (!context.branchId || !context.cashRegisterId) throw new Error("No hay una caja activa");
      const data = await registerSale(dependencies.client, {
        items: cart,
        payments,
        totals,
        observation: observation || null,
        branchId: context.branchId,
        cashRegisterId: context.cashRegisterId,
        requestId: ensureRequestId()
      });
      dependencies.emitStockChange("venta_profesional");
      dependencies.refreshDependentViews("venta_local");
      await dependencies.reloadProducts();
      dependencies.renderProducts();
      await dependencies.reloadCash();
      const nestedSale = typeof data.venta === "object" && data.venta !== null
        ? data.venta as SalesRecord
        : null;
      dependencies.showToast(
        `Venta cobrada: ${dependencies.formatCurrency(number(nestedSale?.total ?? totals.total))}`,
        "success"
      );
      dependencies.discount.invalidate({ recalculate: false });
      requestId = null;
      dependencies.clearPersistedCart();
      close();
      dependencies.showTicket(data);
      dependencies.afterOnlineSale();
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo registrar la venta"), "error");
    } finally {
      confirming = false;
      if (button instanceof HTMLButtonElement) dependencies.applyOfflineSaleState();
    }
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#btn-vender")?.addEventListener("click", open);
    queryOne("#btn-cerrar-venta")?.addEventListener("click", close);
    queryOne("#modal-venta .modal-backdrop")?.addEventListener("click", close);
    queryOne("#venta-buscador")?.addEventListener("input", dependencies.renderSaleProducts);
    queryOne("#venta-productos-lista")?.addEventListener("click", (event) => {
      const target = event.target;
      const item = target instanceof Element ? target.closest(".venta-producto-item") : null;
      if (!(item instanceof HTMLElement) || item.classList.contains("sin-stock") || !item.dataset.id) return;
      addToCart(item.dataset.id);
    });
    queryOne("#carrito-items")?.addEventListener("click", (event) => {
      const target = event.target;
      const row = target instanceof Element ? target.closest(".carrito-item") : null;
      if (!(row instanceof HTMLElement) || !row.dataset.id || !(target instanceof Element)) return;
      const quantityButton = target.closest("[data-qty]");
      if (quantityButton instanceof HTMLElement) {
        changeQuantity(row.dataset.id, Number.parseInt(quantityButton.dataset.qty ?? "0", 10));
      } else if (target.closest("[data-quitar]")) removeFromCart(row.dataset.id);
    });
    queryOne("#btn-cobrar")?.addEventListener("click", () => void confirmSale());
    queryAll("[data-pay-mode-v228]").forEach((button) => {
      button.addEventListener("click", () => {
        activatePaymentMode(button.getAttribute("data-pay-mode-v228") ?? "single");
      });
    });
    queryOne("#btn-add-payment-v228")?.addEventListener("click", addMixedPayment);
    queryOne("#mixed-payment-rows-v228")?.addEventListener("input", updateRemainingPayment);
    queryOne("#mixed-payment-rows-v228")?.addEventListener("change", updateRemainingPayment);
    queryOne("#mixed-payment-rows-v228")?.addEventListener("click", (event) => {
      const target = event.target;
      const row = target instanceof Element ? target.closest(".mixed-pay-row-v228") : null;
      if (!row || !(target instanceof Element)) return;
      if (target.closest("[data-pay-remove]")) {
        const payments = mixedPaymentsFromDom();
        const index = number((row as HTMLElement).dataset.payIndex);
        payments.splice(index, 1);
        renderMixedPayments(payments.length ? payments : [{ medio_pago: "Efectivo", monto: 0 }]);
      } else if (target.closest("[data-pay-rest]")) completeRemainingPayment(row);
    });
  }

  return Object.freeze({
    setup,
    open,
    close,
    addToCart,
    changeQuantity,
    removeFromCart,
    getCart: () => cart,
    isConfirming: () => confirming,
    setCart,
    clearCart,
    getTotal,
    renderCart,
    calculateTotals,
    updateTotals,
    ensureRequestId,
    resetRequestId
  });
}
