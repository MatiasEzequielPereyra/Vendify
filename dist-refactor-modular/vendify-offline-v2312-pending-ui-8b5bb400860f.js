(function() {
  "use strict";
  function isUnsyncedSale(sale) {
    return sale.status !== "synced";
  }
  function summarizePendingSales(sales) {
    let pending = 0;
    let syncing = 0;
    let retryable = 0;
    let review = 0;
    for (const sale of sales) {
      switch (sale.status) {
        case "pending":
          pending += 1;
          break;
        case "syncing":
          syncing += 1;
          break;
        case "failed_retryable":
          retryable += 1;
          break;
        case "review":
          review += 1;
          break;
      }
    }
    return {
      total: pending + syncing + retryable + review,
      pending,
      syncing,
      retryable,
      review
    };
  }
  function pendingSaleRows(sales) {
    return sales.filter(isUnsyncedSale).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((sale) => {
      var _a;
      const itemCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
      const firstItem = ((_a = sale.items[0]) == null ? void 0 : _a.productName) ?? "Venta offline";
      const extraItems = sale.items.length - 1;
      const paymentLabel = sale.payments.map((payment) => payment.method).join(" + ");
      return {
        requestId: String(sale.requestId),
        createdAt: sale.createdAt,
        status: sale.status,
        attempts: sale.attempts,
        total: sale.total,
        itemCount,
        itemLabel: extraItems > 0 ? `${firstItem} +${String(extraItems)}` : firstItem,
        paymentLabel,
        lastError: sale.lastError ?? null
      };
    });
  }
  const STYLE_ID = "vendify-pending-sales-v2312-style";
  const BUTTON_ID = "vendify-pending-sales-v2312-button";
  const PANEL_ID = "vendify-pending-sales-v2312-panel";
  const moneyFormatter = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  });
  const dateFormatter = new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  function syncFunction() {
    return window.sincronizarVentasOfflineIndexedDbV2312;
  }
  function listSalesFunction() {
    return window.listarVentasOfflineIndexedDbV2312;
  }
  function statusLabel(status) {
    switch (status) {
      case "pending":
        return "Pendiente";
      case "syncing":
        return "Sincronizando";
      case "failed_retryable":
        return "Reintento pendiente";
      case "review":
        return "Requiere revisión";
    }
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== void 0) element.textContent = text;
    return element;
  }
  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${BUTTON_ID}{position:fixed;right:18px;bottom:18px;z-index:9400;border:0;border-radius:999px;padding:10px 14px;background:#111827;color:#fff;font:inherit;font-weight:800;cursor:pointer;box-shadow:0 12px 30px rgba(15,23,42,.22);display:flex;gap:8px;align-items:center}
#${BUTTON_ID}[hidden],#${PANEL_ID}[hidden]{display:none!important}
#${BUTTON_ID} .v2312-count{min-width:24px;height:24px;padding:0 7px;border-radius:999px;background:#fff;color:#111827;display:flex;align-items:center;justify-content:center;font-size:12px}
#${PANEL_ID}{position:fixed;inset:0;z-index:9500;background:rgba(15,23,42,.42);display:grid;place-items:end}
#${PANEL_ID} .v2312-sheet{width:min(520px,100%);max-height:88vh;overflow:auto;background:#fff;color:#111827;border-radius:20px 20px 0 0;padding:18px;box-shadow:0 -16px 50px rgba(15,23,42,.24)}
#${PANEL_ID} .v2312-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}
#${PANEL_ID} h3{margin:0;font-size:20px}#${PANEL_ID} .v2312-sub{margin:4px 0 0;color:#64748b;font-size:13px}
#${PANEL_ID} button{border:1px solid #dbe3ee;border-radius:10px;background:#fff;padding:9px 11px;font:inherit;font-weight:700;cursor:pointer}
#${PANEL_ID} .v2312-retry{width:100%;margin-top:12px;background:#111827;color:#fff;border-color:#111827}#${PANEL_ID} .v2312-retry:disabled{opacity:.55;cursor:not-allowed}
#${PANEL_ID} .v2312-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}.v2312-summary-card{border:1px solid #e2e8f0;border-radius:12px;padding:10px}.v2312-summary-card strong{display:block;font-size:18px}.v2312-summary-card span{color:#64748b;font-size:11px}
#${PANEL_ID} .v2312-list{display:grid;gap:10px}.v2312-row{border:1px solid #e2e8f0;border-radius:14px;padding:12px}.v2312-row-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:8px}.v2312-status{border-radius:999px;padding:5px 8px;font-size:11px;font-weight:800;background:#eef2ff;color:#3730a3}.v2312-status-review{background:#fff7ed;color:#9a3412}.v2312-status-failed_retryable{background:#fef2f2;color:#991b1b}.v2312-status-syncing{background:#ecfeff;color:#155e75}.v2312-meta{display:flex;flex-wrap:wrap;gap:8px 12px;color:#64748b;font-size:12px}.v2312-error{margin-top:8px;padding:8px 10px;border-radius:10px;background:#f8fafc;color:#475569;font-size:12px;word-break:break-word}.v2312-empty{padding:26px 12px;text-align:center;color:#64748b}
@media(min-width:720px){#${PANEL_ID}{place-items:center;padding:24px}#${PANEL_ID} .v2312-sheet{border-radius:20px}}
`;
    document.head.appendChild(style);
  }
  function createButton() {
    const button2 = document.createElement("button");
    button2.id = BUTTON_ID;
    button2.type = "button";
    button2.hidden = true;
    button2.setAttribute("aria-haspopup", "dialog");
    button2.append(node("span", void 0, "Ventas pendientes"), node("span", "v2312-count", "0"));
    document.body.appendChild(button2);
    return button2;
  }
  function createPanel() {
    const panel2 = document.createElement("div");
    panel2.id = PANEL_ID;
    panel2.hidden = true;
    panel2.setAttribute("role", "dialog");
    panel2.setAttribute("aria-modal", "true");
    panel2.setAttribute("aria-label", "Ventas pendientes");
    const sheet = node("section", "v2312-sheet");
    const head = node("div", "v2312-head");
    const titles = node("div");
    titles.append(node("h3", void 0, "Ventas pendientes"), node("p", "v2312-sub", "Cola durable en IndexedDB · orden FIFO"));
    const close = document.createElement("button");
    close.type = "button";
    close.dataset.action = "close";
    close.textContent = "Cerrar";
    head.append(titles, close);
    const summary = node("div", "v2312-summary");
    summary.dataset.role = "summary";
    const list = node("div", "v2312-list");
    list.dataset.role = "list";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "v2312-retry";
    retry.dataset.action = "retry";
    retry.textContent = "Reintentar sincronización";
    sheet.append(head, summary, list, retry);
    panel2.appendChild(sheet);
    document.body.appendChild(panel2);
    return panel2;
  }
  function summaryCard(value, label) {
    const card = document.createElement("div");
    card.className = "v2312-summary-card";
    card.append(node("strong", void 0, String(value)), node("span", void 0, label));
    return card;
  }
  function renderSummary(container, summary) {
    container.replaceChildren(
      summaryCard(summary.pending + summary.syncing, "En cola"),
      summaryCard(summary.retryable, "Reintentos"),
      summaryCard(summary.review, "Revisión")
    );
  }
  function renderRow(row) {
    const card = node("article", "v2312-row");
    const head = node("div", "v2312-row-head");
    const left = node("div");
    left.append(node("strong", void 0, `#${row.requestId.slice(0, 8)}`), node("div", void 0, row.itemLabel));
    head.append(
      left,
      node("span", `v2312-status v2312-status-${row.status}`, statusLabel(row.status))
    );
    const created = new Date(row.createdAt);
    const meta = node("div", "v2312-meta");
    meta.append(
      node("span", void 0, Number.isFinite(created.getTime()) ? dateFormatter.format(created) : row.createdAt),
      node("span", void 0, `${String(row.itemCount)} un.`),
      node("span", void 0, row.paymentLabel || "Pago N/D"),
      node("strong", void 0, moneyFormatter.format(row.total)),
      node("span", void 0, `Intentos: ${String(row.attempts)}`)
    );
    card.append(head, meta);
    if (row.lastError) card.append(node("div", "v2312-error", row.lastError));
    return card;
  }
  function syncLegacyBanner(summary) {
    const banner = document.querySelector("#offline-sync-banner-v2311");
    const text = document.querySelector("#offline-sync-text-v2311");
    if (!banner || !text) return;
    banner.classList.toggle("hidden", summary.total === 0);
    if (summary.total === 0) return;
    const total = String(summary.total);
    const review = String(summary.review);
    if (summary.review > 0) {
      text.textContent = `${total} venta${summary.total === 1 ? "" : "s"} pendiente${summary.total === 1 ? "" : "s"} · ${review} en revisión`;
    } else if (!navigator.onLine) {
      text.textContent = `${total} venta${summary.total === 1 ? "" : "s"} guardada${summary.total === 1 ? "" : "s"} sin conexión`;
    } else {
      text.textContent = `${total} venta${summary.total === 1 ? "" : "s"} esperando sincronización`;
    }
  }
  let button = null;
  let panel = null;
  let refreshInFlight = null;
  async function refresh() {
    const runtime = window.VendifyOfflineV2312;
    if (!(runtime == null ? void 0 : runtime.enabled) || !button || !panel) return;
    const listSales = listSalesFunction();
    if (!listSales) return;
    const sales = await listSales();
    const summary = summarizePendingSales(sales);
    const rows = pendingSaleRows(sales);
    const count = button.querySelector(".v2312-count");
    if (count) count.textContent = String(summary.total);
    button.hidden = summary.total === 0;
    syncLegacyBanner(summary);
    const summaryContainer = panel.querySelector('[data-role="summary"]');
    const list = panel.querySelector('[data-role="list"]');
    const retry = panel.querySelector('[data-action="retry"]');
    if (summaryContainer) renderSummary(summaryContainer, summary);
    if (list) {
      list.replaceChildren(
        ...rows.length > 0 ? rows.map(renderRow) : [node("div", "v2312-empty", "No hay ventas pendientes.")]
      );
    }
    if (retry) {
      retry.disabled = summary.total === 0 || !navigator.onLine;
      retry.textContent = navigator.onLine ? "Reintentar sincronización" : "Sin conexión · se reintentará al volver internet";
    }
  }
  function scheduleRefresh() {
    if (refreshInFlight) return;
    refreshInFlight = refresh().catch((error) => {
      console.error("[Vendify v2.31.2] pending sales UI refresh failed", error);
    }).finally(() => {
      refreshInFlight = null;
    });
  }
  async function retryQueue() {
    if (!panel || !navigator.onLine) return;
    const sync = syncFunction();
    if (!sync) return;
    const retry = panel.querySelector('[data-action="retry"]');
    if (retry) {
      retry.disabled = true;
      retry.textContent = "Sincronizando…";
    }
    try {
      await sync({ mostrarResumen: true, incluirRevision: true });
    } finally {
      scheduleRefresh();
    }
  }
  function openPanel() {
    if (!panel) return;
    panel.hidden = false;
    document.body.style.overflow = "hidden";
    scheduleRefresh();
  }
  function closePanel() {
    if (!panel) return;
    panel.hidden = true;
    document.body.style.overflow = "";
  }
  function init() {
    const runtime = window.VendifyOfflineV2312;
    if (!(runtime == null ? void 0 : runtime.enabled)) return;
    installStyles();
    button = createButton();
    panel = createPanel();
    button.addEventListener("click", openPanel);
    panel.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target === panel || target.dataset.action === "close") {
        closePanel();
      } else if (target.dataset.action === "retry") {
        void retryQueue();
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && panel && !panel.hidden) closePanel();
    });
    window.addEventListener("online", scheduleRefresh);
    window.addEventListener("offline", scheduleRefresh);
    window.addEventListener("focus", scheduleRefresh);
    window.addEventListener("vendify:offline-v2312-changed", scheduleRefresh);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleRefresh();
    });
    void runtime.ready.then(scheduleRefresh);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
