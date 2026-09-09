import {
  pendingSaleRows,
  summarizePendingSales,
  type PendingSaleRow,
  type PendingSalesSummary
} from "./pending-sales-view-model.js";
import type { OfflineSale } from "../types/offline.js";

interface SyncOptions {
  readonly mostrarResumen?: boolean;
  readonly incluirRevision?: boolean;
}

interface SyncSummary {
  readonly attempted: number;
  readonly synced: number;
  readonly retryable: number;
  readonly review: number;
  readonly recovered: number;
}

type SyncFunction = (options?: SyncOptions) => Promise<SyncSummary>;

type WindowWithOfflineSync = Window & {
  readonly sincronizarVentasOfflineIndexedDbV2312?: SyncFunction;
  readonly listarVentasOfflineIndexedDbV2312?: () => Promise<readonly OfflineSale[]>;
};

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

function syncFunction(): SyncFunction | undefined {
  return (window as WindowWithOfflineSync).sincronizarVentasOfflineIndexedDbV2312;
}

function listSalesFunction(): (() => Promise<readonly OfflineSale[]>) | undefined {
  return (window as WindowWithOfflineSync).listarVentasOfflineIndexedDbV2312;
}

function statusLabel(status: PendingSaleRow["status"]): string {
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

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function installStyles(): void {
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

function createButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.hidden = true;
  button.setAttribute("aria-haspopup", "dialog");
  button.append(node("span", undefined, "Ventas pendientes"), node("span", "v2312-count", "0"));
  document.body.appendChild(button);
  return button;
}

function createPanel(): HTMLDivElement {
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Ventas pendientes");

  const sheet = node("section", "v2312-sheet");
  const head = node("div", "v2312-head");
  const titles = node("div");
  titles.append(node("h3", undefined, "Ventas pendientes"), node("p", "v2312-sub", "Cola durable en IndexedDB · orden FIFO"));

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
  panel.appendChild(sheet);
  document.body.appendChild(panel);
  return panel;
}

function summaryCard(value: number, label: string): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "v2312-summary-card";
  card.append(node("strong", undefined, String(value)), node("span", undefined, label));
  return card;
}

function renderSummary(container: HTMLElement, summary: PendingSalesSummary): void {
  container.replaceChildren(
    summaryCard(summary.pending + summary.syncing, "En cola"),
    summaryCard(summary.retryable, "Reintentos"),
    summaryCard(summary.review, "Revisión")
  );
}

function renderRow(row: PendingSaleRow): HTMLElement {
  const card = node("article", "v2312-row");
  const head = node("div", "v2312-row-head");
  const left = node("div");
  left.append(node("strong", undefined, `#${row.requestId.slice(0, 8)}`), node("div", undefined, row.itemLabel));

  head.append(
    left,
    node("span", `v2312-status v2312-status-${row.status}`, statusLabel(row.status))
  );

  const created = new Date(row.createdAt);
  const meta = node("div", "v2312-meta");
  meta.append(
    node("span", undefined, Number.isFinite(created.getTime()) ? dateFormatter.format(created) : row.createdAt),
    node("span", undefined, `${String(row.itemCount)} un.`),
    node("span", undefined, row.paymentLabel || "Pago N/D"),
    node("strong", undefined, moneyFormatter.format(row.total)),
    node("span", undefined, `Intentos: ${String(row.attempts)}`)
  );

  card.append(head, meta);
  if (row.lastError) card.append(node("div", "v2312-error", row.lastError));
  return card;
}

function syncLegacyBanner(summary: PendingSalesSummary): void {
  const banner = document.querySelector<HTMLElement>("#offline-sync-banner-v2311");
  const text = document.querySelector<HTMLElement>("#offline-sync-text-v2311");
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

let button: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let refreshInFlight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  const runtime = window.VendifyOfflineV2312;
  if (!runtime?.enabled || !button || !panel) return;

  const listSales = listSalesFunction();
  if (!listSales) return;
  const sales = await listSales();
  const summary = summarizePendingSales(sales);
  const rows = pendingSaleRows(sales);

  const count = button.querySelector<HTMLElement>(".v2312-count");
  if (count) count.textContent = String(summary.total);
  button.hidden = summary.total === 0;
  syncLegacyBanner(summary);

  const summaryContainer = panel.querySelector<HTMLElement>('[data-role="summary"]');
  const list = panel.querySelector<HTMLElement>('[data-role="list"]');
  const retry = panel.querySelector<HTMLButtonElement>('[data-action="retry"]');

  if (summaryContainer) renderSummary(summaryContainer, summary);
  if (list) {
    list.replaceChildren(
      ...(rows.length > 0
        ? rows.map(renderRow)
        : [node("div", "v2312-empty", "No hay ventas pendientes.")])
    );
  }

  if (retry) {
    retry.disabled = summary.total === 0 || !navigator.onLine;
    retry.textContent = navigator.onLine
      ? "Reintentar sincronización"
      : "Sin conexión · se reintentará al volver internet";
  }
}

function scheduleRefresh(): void {
  if (refreshInFlight) return;
  refreshInFlight = refresh()
    .catch((error: unknown) => {
      console.error("[Vendify v2.31.2] pending sales UI refresh failed", error);
    })
    .finally(() => {
      refreshInFlight = null;
    });
}

async function retryQueue(): Promise<void> {
  if (!panel || !navigator.onLine) return;
  const sync = syncFunction();
  if (!sync) return;

  const retry = panel.querySelector<HTMLButtonElement>('[data-action="retry"]');
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

function openPanel(): void {
  if (!panel) return;
  panel.hidden = false;
  document.body.style.overflow = "hidden";
  scheduleRefresh();
}

function closePanel(): void {
  if (!panel) return;
  panel.hidden = true;
  document.body.style.overflow = "";
}

function init(): void {
  const runtime = window.VendifyOfflineV2312;
  if (!runtime?.enabled) return;

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
