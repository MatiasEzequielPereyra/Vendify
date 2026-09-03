import { escapeHtml, queryAll, queryOne } from "../core/dom.js";
import {
  netSaleTotal,
  salePaymentsText,
  salesDateRange,
  saleStatusLabel,
  ticketNumber,
  type SalesRecord
} from "./sales-model.js";
import {
  listSales,
  returnSaleItems,
  voidSale,
  type SalesHistoryClientPort
} from "./sales-service.js";

type ReturnMode = "devolver" | "anular";

interface HistoryContext {
  readonly businessName: string;
  readonly branchId: string | null;
  readonly branchName: string;
  readonly cashRegisterId: string | null;
  readonly cashRegisterName: string;
  readonly role: string;
}

export interface SalesHistoryControllerDependencies {
  readonly client: SalesHistoryClientPort;
  readonly getContext: () => HistoryContext;
  readonly isCashOpenByCurrentUser: () => boolean;
  readonly openCashPanel: () => void;
  readonly formatCurrency: (value: number) => string;
  readonly showToast: (message: string, type: "error" | "info" | "success") => void;
  readonly getAutoPrint: () => boolean;
  readonly getTicketWidth: () => number;
  readonly emitStockChange: (reason: string) => void;
  readonly reloadProducts: () => Promise<void>;
  readonly renderProducts: () => void;
  readonly reloadCash: () => Promise<void>;
}

export interface SalesHistoryController {
  readonly setup: () => void;
  readonly open: () => Promise<void>;
  readonly close: () => void;
  readonly render: () => Promise<void>;
  readonly showTicket: (data: SalesRecord) => void;
  readonly getSales: () => SalesRecord[];
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

function record(value: unknown): SalesRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as SalesRecord
    : {};
}

function records(value: unknown): SalesRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is SalesRecord => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}

function number(value: unknown): number {
  return Number(value ?? 0);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createSalesHistoryController(
  dependencies: SalesHistoryControllerDependencies
): SalesHistoryController {
  let sales: SalesRecord[] = [];
  let currentTicket: SalesRecord | null = null;
  let management: { sale: SalesRecord; mode: ReturnMode } | null = null;
  let setupComplete = false;

  function buildTicketHtml(data: SalesRecord): string {
    const nestedSale = record(data.venta);
    const sale = Object.keys(nestedSale).length ? nestedSale : data;
    const items = records(data.items).length ? records(data.items) : records(sale.venta_items);
    const payments = records(data.pagos).length ? records(data.pagos) : records(sale.venta_pagos);
    const created = sale.creado ? new Date(text(sale.creado)) : new Date();
    const itemsHtml = items.map((item) => {
      const quantity = number(item.cantidad);
      const subtotal = number(item.subtotal ?? number(item.precio_unitario) * quantity);
      return `<div class="receipt-item-v228"><div><strong>${String(quantity)}× ${
        escapeHtml(text(item.producto_nombre, "Producto"))
      }</strong><small>${dependencies.formatCurrency(number(item.precio_unitario))} c/u</small></div><span>${
        dependencies.formatCurrency(subtotal)
      }</span></div>`;
    }).join("");
    const paymentsHtml = payments.filter((payment) => payment.operacion !== "devolucion").map((payment) =>
      `<div class="receipt-line-v228"><span>${escapeHtml(text(payment.medio_pago))}</span><span>${
        dependencies.formatCurrency(number(payment.monto))
      }</span></div>`
    ).join("");
    const status = text(sale.estado, "completada");
    const context = dependencies.getContext();
    return `<div class="receipt-v228"><div class="receipt-head-v228"><div class="receipt-brand-v228">VENDIFY</div><strong>${
      escapeHtml(context.businessName || "Negocio")
    }</strong><span>${escapeHtml(context.branchName)}${
      context.cashRegisterName ? ` · ${escapeHtml(context.cashRegisterName)}` : ""
    }</span></div><div class="receipt-meta-v228"><span>Ticket #${ticketNumber(sale.id)}</span><span>${
      created.toLocaleString("es-AR")
    }</span></div>${status !== "completada" ? `<div class="receipt-status-v228">${escapeHtml(saleStatusLabel(status))}</div>` : ""}<div class="receipt-items-v228">${itemsHtml}</div><div class="receipt-totals-v228"><div class="receipt-line-v228"><span>Subtotal</span><span>${
      dependencies.formatCurrency(number(sale.subtotal ?? sale.total))
    }</span></div>${number(sale.descuento_total) > 0 ? `<div class="receipt-line-v228"><span>Descuento</span><span>−${
      dependencies.formatCurrency(number(sale.descuento_total))
    }</span></div>` : ""}<div class="receipt-line-v228 total"><span>Total</span><strong>${
      dependencies.formatCurrency(number(sale.total))
    }</strong></div>${number(sale.total_devuelto) > 0 ? `<div class="receipt-line-v228 refund"><span>Devuelto</span><span>−${
      dependencies.formatCurrency(number(sale.total_devuelto))
    }</span></div>` : ""}</div>${paymentsHtml ? `<div class="receipt-payment-v228"><small>Pago</small>${paymentsHtml}</div>` : ""}${
      sale.observacion ? `<div class="receipt-note-v228"><small>Observación</small><p>${escapeHtml(text(sale.observacion))}</p></div>` : ""
    }<div class="receipt-footer-v228">Gracias por tu compra<small>Gestionado con Vendify</small></div></div>`;
  }

  function showTicket(data: SalesRecord): void {
    currentTicket = data;
    const preview = queryOne("#ticket-preview-v228");
    if (preview) preview.innerHTML = buildTicketHtml(data);
    queryOne("#modal-ticket-v228")?.classList.remove("hidden");
    if (dependencies.getAutoPrint()) setTimeout(printTicket, 120);
  }

  function closeTicket(): void {
    queryOne("#modal-ticket-v228")?.classList.add("hidden");
  }

  function printTicket(): void {
    if (!currentTicket) return;
    const popup = window.open("", "_blank", "width=420,height=720");
    if (!popup) {
      dependencies.showToast("El navegador bloqueó la ventana de impresión", "error");
      return;
    }
    const width = dependencies.getTicketWidth() === 58 ? 58 : 80;
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket Vendify</title><style>
      *{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;padding:16px;color:#111;background:#fff}.receipt-v228{max-width:320px;margin:auto;font-size:12px}.receipt-head-v228{text-align:center;display:flex;flex-direction:column;gap:3px}.receipt-brand-v228{font-size:20px;font-weight:800;letter-spacing:1px}.receipt-head-v228 span,.receipt-meta-v228,.receipt-footer-v228 small{font-size:10px;color:#555}.receipt-meta-v228{display:flex;justify-content:space-between;border-top:1px dashed #aaa;border-bottom:1px dashed #aaa;padding:8px 0;margin:10px 0}.receipt-item-v228{display:flex;justify-content:space-between;gap:10px;padding:5px 0}.receipt-item-v228>div{display:flex;flex-direction:column}.receipt-item-v228 small{color:#666}.receipt-totals-v228,.receipt-payment-v228,.receipt-note-v228{border-top:1px dashed #aaa;margin-top:8px;padding-top:8px}.receipt-line-v228{display:flex;justify-content:space-between;gap:12px;padding:2px 0}.receipt-line-v228.total{font-size:15px;padding-top:6px}.receipt-line-v228.refund{color:#b91c1c}.receipt-status-v228{text-align:center;font-weight:700;border:1px solid #111;padding:4px;margin-bottom:8px}.receipt-note-v228 p{margin:4px 0 0}.receipt-footer-v228{text-align:center;border-top:1px dashed #aaa;margin-top:12px;padding-top:10px;display:flex;flex-direction:column;gap:4px}@media print{body{padding:0}.receipt-v228{max-width:none;width:${String(width)}mm}}
    </style></head><body>${buildTicketHtml(currentTicket)}<script>window.onload=()=>{window.print();}</script></body></html>`);
    popup.document.close();
  }

  function openManagement(sale: SalesRecord, mode: ReturnMode): void {
    if (!dependencies.isCashOpenByCurrentUser()) {
      dependencies.showToast("Abrí una caja propia antes de realizar reintegros", "info");
      dependencies.openCashPanel();
      return;
    }
    management = { sale, mode };
    const isVoid = mode === "anular";
    const title = queryOne("#return-title-v228");
    const subtitle = queryOne("#return-subtitle-v228");
    if (title) title.textContent = isVoid ? "Anular venta" : "Devolver artículos";
    if (subtitle) subtitle.textContent = isVoid
      ? "La venta quedará anulada, se restaurará el stock y se registrará el reintegro."
      : "El stock seleccionado volverá a la sucursal original.";
    queryOne("#return-items-section-v228")?.classList.toggle("hidden", isVoid);
    queryOne("#return-warning-v228")?.classList.toggle("hidden", !isVoid);
    if (isVoid) {
      const warning = queryOne("#return-warning-v228");
      if (warning) warning.innerHTML = "<strong>Esta acción no borra la venta.</strong><span>Quedará registrada como anulada en el historial y en la auditoría.</span>";
    }
    const chargedPayments = records(sale.venta_pagos).filter((payment) => payment.operacion === "cobro");
    const method = text(chargedPayments[0]?.medio_pago, "Efectivo");
    const methodField = field("#return-method-v228");
    if (methodField) methodField.value = ["Efectivo", "Débito", "Crédito", "Transferencia", "Mercado Pago", "Otro"].includes(method) ? method : "Otro";
    const reason = field("#return-reason-v228");
    const error = queryOne("#return-error-v228");
    if (reason) reason.value = "";
    if (error) error.textContent = "";
    const container = queryOne("#return-items-v228");
    if (container) {
      container.innerHTML = isVoid ? "" : records(sale.venta_items).map((item) => {
        const available = Math.max(0, number(item.cantidad) - number(item.cantidad_devuelta));
        return `<div class="return-item-v228 ${available <= 0 ? "disabled" : ""}" data-return-item-id="${
          escapeHtml(text(item.id))
        }" data-return-price="${String(number(item.precio_neto_unitario ?? item.precio_unitario))}"><div class="return-item-copy-v228"><strong>${
          escapeHtml(text(item.producto_nombre))
        }</strong><small>Disponible para devolver: ${String(available)}</small></div><input type="number" class="return-item-qty-v228" min="0" max="${
          String(available)
        }" step="1" value="0" ${available <= 0 ? "disabled" : ""}/></div>`;
      }).join("");
    }
    const submit = queryOne("#btn-submit-return-v228");
    if (submit instanceof HTMLButtonElement) {
      submit.textContent = isVoid ? "Anular y reintegrar" : "Confirmar devolución";
      submit.classList.toggle("btn-danger", isVoid);
      submit.classList.toggle("btn-primary", !isVoid);
    }
    updateReturnTotal();
    queryOne("#modal-return-v228")?.classList.remove("hidden");
  }

  function closeManagement(): void {
    queryOne("#modal-return-v228")?.classList.add("hidden");
    management = null;
  }

  function updateReturnTotal(): void {
    const element = queryOne("#return-total-v228");
    if (!element || !management) return;
    if (management.mode === "anular") {
      element.textContent = dependencies.formatCurrency(netSaleTotal(management.sale));
      return;
    }
    let total = 0;
    queryAll(".return-item-v228").forEach((row) => {
      const input = row.querySelector(".return-item-qty-v228");
      const quantity = input instanceof HTMLInputElement ? number(input.value) : 0;
      total += quantity * number((row as HTMLElement).dataset.returnPrice);
    });
    total = Math.min(netSaleTotal(management.sale), Math.round(total * 100) / 100);
    element.textContent = dependencies.formatCurrency(total);
  }

  async function saveManagement(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!management) return;
    const reason = field("#return-reason-v228")?.value.trim() ?? "";
    const method = field("#return-method-v228")?.value ?? "Efectivo";
    const error = queryOne("#return-error-v228");
    const cashRegisterId = dependencies.getContext().cashRegisterId;
    if (error) error.textContent = "";
    if (reason.length < 2) {
      if (error) error.textContent = "Ingresá el motivo.";
      return;
    }
    if (!cashRegisterId) {
      if (error) error.textContent = "No hay una caja activa.";
      return;
    }
    try {
      if (management.mode === "anular") {
        await voidSale(dependencies.client, text(management.sale.id), cashRegisterId, method, reason);
      } else {
        const items = [...queryAll(".return-item-v228")].flatMap((row) => {
          const input = row.querySelector(".return-item-qty-v228");
          const quantity = input instanceof HTMLInputElement ? number(input.value) : 0;
          const id = (row as HTMLElement).dataset.returnItemId;
          return quantity > 0 && id ? [{ item_id: id, cantidad: quantity }] : [];
        });
        if (!items.length) {
          if (error) error.textContent = "Seleccioná al menos un artículo.";
          return;
        }
        await returnSaleItems(dependencies.client, text(management.sale.id), items, cashRegisterId, method, reason);
      }
      const mode = management.mode;
      closeManagement();
      dependencies.emitStockChange(mode === "anular" ? "anulacion" : "devolucion");
      await dependencies.reloadProducts();
      dependencies.renderProducts();
      await dependencies.reloadCash();
      await render();
      dependencies.showToast(mode === "anular" ? "Venta anulada y stock restaurado" : "Devolución registrada", "success");
    } catch (caught) {
      if (error) error.textContent = errorMessage(caught, "No se pudo gestionar la venta");
    }
  }

  async function render(): Promise<void> {
    const container = queryOne("#historial-lista");
    const empty = queryOne("#historial-vacio");
    const summary = queryOne("#historial-resumen");
    if (!container || !empty || !summary) return;
    container.innerHTML = '<p class="hint" style="text-align:center;padding:1rem;">Cargando...</p>';
    empty.classList.add("hidden");
    const range = salesDateRange(field("#historial-rango")?.value ?? "todo");
    try {
      sales = await listSales(dependencies.client, dependencies.getContext().branchId, range.desde, range.hasta);
    } catch (error) {
      console.error("[Ventas] historial:", error);
      container.innerHTML = "";
      dependencies.showToast("No se pudo cargar el historial", "error");
      return;
    }
    if (!sales.length) {
      container.innerHTML = "";
      summary.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    const activeSales = sales.filter((sale) => sale.estado !== "anulada");
    const netTotal = sales.reduce((accumulator, sale) => accumulator + netSaleTotal(sale), 0);
    const returnedTotal = sales.reduce((accumulator, sale) => accumulator + number(sale.total_devuelto), 0);
    summary.innerHTML = `<span><strong>${String(activeSales.length)}</strong> ticket${activeSales.length === 1 ? "" : "s"} netos</span><span><strong>${
      dependencies.formatCurrency(netTotal)
    }</strong> vendido neto</span>${returnedTotal > 0 ? `<span><strong>${dependencies.formatCurrency(returnedTotal)}</strong> devuelto</span>` : ""}`;
    const canManage = ["owner", "admin", "manager"].includes(dependencies.getContext().role);
    container.innerHTML = sales.map((sale) => {
      const date = new Date(text(sale.creado));
      const dateText = date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
      const timeText = date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
      const items = [...records(sale.venta_items)].sort((left, right) =>
        text(left.producto_nombre).localeCompare(text(right.producto_nombre), "es")
      );
      const itemsHtml = items.map((item) => {
        const returned = number(item.cantidad_devuelta);
        return `<div class="ticket-item-row"><span>${String(number(item.cantidad))}× ${
          escapeHtml(text(item.producto_nombre))
        }${returned > 0 ? `<small class="ticket-returned-v228"> · ${String(returned)} devuelto${returned === 1 ? "" : "s"}</small>` : ""}</span><span>${
          dependencies.formatCurrency(number(item.subtotal))
        }</span></div>`;
      }).join("");
      const net = netSaleTotal(sale);
      const payments = salePaymentsText(records(sale.venta_pagos), "cobro", dependencies.formatCurrency);
      const refunds = salePaymentsText(records(sale.venta_pagos), "devolucion", dependencies.formatCurrency);
      const status = text(sale.estado, "completada");
      const canReturn = canManage && !["devuelta", "anulada"].includes(status) && net > 0.01;
      const canVoid = canManage && status === "completada" && number(sale.total_devuelto) <= 0.01;
      return `<details class="ticket-card ticket-card-v228 ${escapeHtml(status)}"><summary><span class="ticket-fecha">${dateText} · ${timeText}</span><span class="sale-status-v228 ${
        escapeHtml(status)
      }">${saleStatusLabel(status)}</span>${sale.medio_pago ? `<span class="ticket-medio">${escapeHtml(text(sale.medio_pago))}</span>` : ""}<span class="ticket-total">${
        dependencies.formatCurrency(net)
      }</span></summary><div class="ticket-detail-v228"><div class="ticket-items">${itemsHtml || '<p class="hint">Sin detalle de artículos</p>'}</div><div class="ticket-finance-v228"><div><span>Subtotal</span><strong>${
        dependencies.formatCurrency(number(sale.subtotal ?? sale.total))
      }</strong></div>${number(sale.descuento_total) > 0 ? `<div><span>Descuento</span><strong>−${dependencies.formatCurrency(number(sale.descuento_total))}</strong></div>` : ""}<div><span>Total original</span><strong>${
        dependencies.formatCurrency(number(sale.total))
      }</strong></div>${number(sale.total_devuelto) > 0 ? `<div class="refund"><span>Devuelto</span><strong>−${dependencies.formatCurrency(number(sale.total_devuelto))}</strong></div>` : ""}<div class="net"><span>Neto</span><strong>${
        dependencies.formatCurrency(net)
      }</strong></div></div>${payments ? `<p class="ticket-payment-note-v228"><strong>Cobro:</strong> ${escapeHtml(payments)}</p>` : ""}${refunds ? `<p class="ticket-payment-note-v228 refund"><strong>Reintegros:</strong> ${escapeHtml(refunds)}</p>` : ""}${sale.observacion ? `<p class="ticket-observation-v228">${escapeHtml(text(sale.observacion))}</p>` : ""}<div class="ticket-actions-row-v228"><button type="button" class="btn btn-secondary btn-sm" data-sale-action-v228="ticket" data-id="${escapeHtml(text(sale.id))}">🖨 Ticket</button>${canReturn ? `<button type="button" class="btn btn-secondary btn-sm" data-sale-action-v228="return" data-id="${escapeHtml(text(sale.id))}">↩ Devolver</button>` : ""}${canVoid ? `<button type="button" class="btn btn-danger btn-sm" data-sale-action-v228="void" data-id="${escapeHtml(text(sale.id))}">Anular</button>` : ""}</div></div></details>`;
    }).join("");
  }

  async function open(): Promise<void> {
    queryOne("#modal-historial")?.classList.remove("hidden");
    await render();
  }

  function close(): void {
    queryOne("#modal-historial")?.classList.add("hidden");
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#btn-historial")?.addEventListener("click", () => void open());
    queryOne("#btn-cerrar-historial")?.addEventListener("click", close);
    queryOne("#modal-historial .modal-backdrop")?.addEventListener("click", close);
    queryOne("#historial-rango")?.addEventListener("change", () => void render());
    queryOne("#btn-close-ticket-v228")?.addEventListener("click", closeTicket);
    queryOne("#btn-close-ticket-bottom-v228")?.addEventListener("click", closeTicket);
    queryOne("#modal-ticket-v228 .modal-backdrop")?.addEventListener("click", closeTicket);
    queryOne("#btn-print-ticket-v228")?.addEventListener("click", printTicket);
    queryOne("#historial-lista")?.addEventListener("click", (event) => {
      const target = event.target;
      const button = target instanceof Element ? target.closest("[data-sale-action-v228]") : null;
      if (!(button instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();
      const sale = sales.find((item) => item.id === button.dataset.id);
      if (!sale) return;
      if (button.dataset.saleActionV228 === "ticket") {
        showTicket({ venta: sale, items: records(sale.venta_items), pagos: records(sale.venta_pagos) });
      } else if (button.dataset.saleActionV228 === "return") openManagement(sale, "devolver");
      else if (button.dataset.saleActionV228 === "void") openManagement(sale, "anular");
    });
    queryOne("#form-return-v228")?.addEventListener("submit", (event) => void saveManagement(event as SubmitEvent));
    queryOne("#return-items-v228")?.addEventListener("input", updateReturnTotal);
    queryOne("#btn-close-return-v228")?.addEventListener("click", closeManagement);
    queryOne("#btn-cancel-return-v228")?.addEventListener("click", closeManagement);
    queryOne("#modal-return-v228 .modal-backdrop")?.addEventListener("click", closeManagement);
  }

  return Object.freeze({ setup, open, close, render, showTicket, getSales: () => [...sales] });
}
