import { escapeHtml, queryAll, queryOne } from "../core/dom.js";
import { formatArs } from "../core/format.js";
import {
  loadDashboard,
  loadOperationalAlerts,
  type DashboardRpcClientPort
} from "./dashboard-service.js";
import {
  dashboardEmpty,
  dashboardRows,
  renderDashboardRows,
  type DashboardRow
} from "./dashboard-ui.js";

export interface DashboardControllerDependencies {
  readonly client: DashboardRpcClientPort;
  readonly isSupervisor: () => boolean;
  readonly getBranchId: () => string | null;
  readonly getBusinessName: () => string;
  readonly closeManagement: () => void;
  readonly icon: (name: string) => string;
  readonly showToast: (message: string, type: "error" | "info" | "success") => void;
  readonly reportError: (type: string, message: string) => void | Promise<void>;
  readonly navigateTo: (target: "sales" | "inventory" | "cash" | "purchases") => void;
}

export interface DashboardLoadOptions {
  readonly focusAlerts?: boolean;
}

export interface DashboardController {
  readonly setup: () => void;
  readonly open: (options?: DashboardLoadOptions) => Promise<void>;
  readonly close: () => void;
  readonly load: (options?: DashboardLoadOptions) => Promise<void>;
  readonly loadAlertBadge: () => Promise<void>;
}

function numberValue(value: unknown): number {
  return Number(value ?? 0);
}

function textValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatPct(value: unknown): string {
  const number = numberValue(value);
  if (!Number.isFinite(number)) return "—";
  return `${number >= 0 ? "+" : ""}${number.toFixed(1)}%`;
}

function formatCompactNumber(value: unknown): string {
  return new Intl.NumberFormat("es-AR", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(numberValue(value));
}

function marginQualityText(data: DashboardRow): string {
  const quality = textValue(data.margen_calidad);
  const coverage = Math.max(0, Math.min(100, numberValue(data.margen_cobertura_pct)));
  if (quality === "sin_ventas") return "Sin ventas en el período";
  if (quality === "completo") return "Costo histórico disponible en toda la venta";
  return `Costo histórico disponible en ${coverage.toFixed(1)}% de la venta`;
}

function setText(selector: string, value: string | number): void {
  const element = queryOne(selector);
  if (element) element.textContent = String(value);
}

export function createDashboardController(
  dependencies: DashboardControllerDependencies
): DashboardController {
  let days = 7;
  let dashboardData: DashboardRow | null = null;
  let setupComplete = false;

  function updateAlertBadge(alertsValue: unknown): void {
    const total = dashboardRows(alertsValue).reduce(
      (sum, row) => sum + numberValue(row.count),
      0
    );
    const badge = queryOne("#alertas-badge-v231");
    if (!badge) return;
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.classList.toggle("hidden", total <= 0);
  }

  function renderBars(seriesValue: unknown): void {
    const container = queryOne("#dashboard-sales-chart-v231");
    if (!container) return;
    const series = dashboardRows(seriesValue);
    if (!series.length) {
      container.innerHTML = dashboardEmpty("Todavía no hay ventas para graficar.");
      return;
    }

    const max = Math.max(1, ...series.map((row) => numberValue(row.total)));
    container.innerHTML = series
      .map((row) => {
        const total = numberValue(row.total);
        const height = Math.max(4, Math.round((total / max) * 100));
        const date = new Date(`${textValue(row.fecha)}T12:00:00`);
        const label = date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
        return `
          <button type="button" class="dashboard-bar-column-v231 dashboard-actionable-v231" data-dashboard-target="sales" title="Ver ventas de ${label} · ${formatArs(total)}">
            <div class="dashboard-bar-value-v231">
              ${total > 0 ? formatCompactNumber(total) : ""}
            </div>
            <div class="dashboard-bar-track-v231">
              <div class="dashboard-bar-v231" style="height:${String(height)}%"></div>
            </div>
            <small>${label}</small>
          </button>`;
      })
      .join("");
  }

  function render(data: DashboardRow): void {
    dashboardData = data;
    setText("#dash-sales-v231", formatArs(numberValue(data.ventas_netas)));

    const change = data.variacion_pct;
    const changeElement = queryOne("#dash-sales-change-v231");
    if (changeElement) {
      changeElement.textContent =
        change == null ? "Sin período anterior comparable" : `${formatPct(change)} vs período anterior`;
      changeElement.className =
        `dashboard-kpi-change-v231 ${numberValue(change) >= 0 ? "positive" : "negative"}`;
    }

    setText("#dash-tickets-v231", numberValue(data.tickets));
    setText("#dash-average-v231", `Ticket promedio ${formatArs(numberValue(data.ticket_promedio))}`);
    setText("#dash-margin-v231", formatArs(numberValue(data.margen_estimado)));
    setText("#dash-margin-quality-v231", marginQualityText(data));
    setText("#dash-refunds-v231", formatArs(numberValue(data.devoluciones_total)));
    setText(
      "#dash-refund-count-v231",
      `${String(numberValue(data.devoluciones_cantidad))} operación(es)`
    );
    setText("#dash-open-cash-v231", numberValue(data.cajas_abiertas));

    const alerts = dashboardRows(data.alertas);
    setText(
      "#dash-alerts-v231",
      alerts.reduce((sum, row) => sum + numberValue(row.count), 0)
    );
    setText("#dash-stock-alert-v231", `${String(alerts.length)} tipo(s) de alerta`);

    renderBars(data.serie);
    renderDashboardRows(
      queryOne("#dashboard-top-products-v231"),
      data.top_productos,
      (row, index) => `
          <button type="button" class="dashboard-list-row-v231 dashboard-actionable-v231" data-dashboard-target="inventory">
          <span class="dashboard-rank-v231">${String(index + 1)}</span>
          <div class="dashboard-list-copy-v231">
            <strong>${escapeHtml(textValue(row.nombre, "Producto"))}</strong>
            <small>${String(numberValue(row.unidades))} unidades</small>
          </div>
          <strong>${formatArs(numberValue(row.total))}</strong>
          </button>`,
      "Todavía no hay productos vendidos en este período."
    );

    const paymentRows = dashboardRows(data.medios_pago);
    const paymentTotal = paymentRows.reduce((sum, row) => sum + numberValue(row.total), 0);
    renderDashboardRows(
      queryOne("#dashboard-payments-v231"),
      paymentRows,
      (row) => {
        const pct = paymentTotal > 0
          ? Math.round((numberValue(row.total) / paymentTotal) * 100)
          : 0;
        return `
          <div class="dashboard-payment-row-v231">
            <div class="dashboard-list-copy-v231">
              <strong>${escapeHtml(textValue(row.medio_pago, "Otro"))}</strong>
              <small>${String(pct)}% del cobro</small>
            </div>
            <strong>${formatArs(numberValue(row.total))}</strong>
            <div class="dashboard-mini-progress-v231"><span style="width:${String(pct)}%"></span></div>
          </div>`;
      },
      "Todavía no hay cobros en el período."
    );

    renderDashboardRows(
      queryOne("#dashboard-restock-v231"),
      data.reposicion,
      (row) => `
          <button type="button" class="dashboard-list-row-v231 dashboard-actionable-v231" data-dashboard-target="inventory">
          <span class="dashboard-list-icon-v231 warning">${dependencies.icon("inventory")}</span>
          <div class="dashboard-list-copy-v231">
            <strong>${escapeHtml(textValue(row.nombre, "Producto"))}</strong>
            <small>
              Stock ${String(numberValue(row.stock))}
              ${row.dias_cobertura == null ? "" : ` · ${numberValue(row.dias_cobertura).toFixed(1)} días`}
            </small>
          </div>
          <strong>+${String(numberValue(row.reposicion_sugerida))}</strong>
          </button>`,
      "No hay reposiciones urgentes sugeridas."
    );

    renderDashboardRows(
      queryOne("#dashboard-alerts-list-v231"),
      alerts,
      (row) => {
        const severity = textValue(row.severity, "info");
        return `
          <button type="button" class="dashboard-alert-row-v231 ${escapeHtml(severity)} dashboard-actionable-v231" data-dashboard-target="inventory">
            <span class="dashboard-list-icon-v231">
              ${dependencies.icon(severity === "critical" ? "alert" : "bell")}
            </span>
            <div class="dashboard-list-copy-v231">
              <strong>${escapeHtml(textValue(row.title, "Alerta"))}</strong>
              <small>${escapeHtml(textValue(row.detail))}</small>
            </div>
            <strong>${String(numberValue(row.count))}</strong>
          </button>`;
      },
      "Sin alertas operativas activas."
    );

    renderDashboardRows(
      queryOne("#dashboard-activity-v231"),
      data.actividad,
      (row) => `
          <div class="dashboard-list-row-v231">
          <span class="dashboard-list-icon-v231">${dependencies.icon(textValue(row.icon, "history"))}</span>
          <div class="dashboard-list-copy-v231">
            <strong>${escapeHtml(textValue(row.title, "Actividad"))}</strong>
            <small>${escapeHtml(textValue(row.detail))}</small>
          </div>
          <time>${
            row.fecha == null
              ? ""
              : new Date(textValue(row.fecha)).toLocaleString("es-AR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit"
                })
          }</time>
        </div>`,
      "Todavía no hay actividad reciente."
    );

    updateAlertBadge(alerts);
  }

  function buildSummary(): string {
    if (!dashboardData) return "";
    const top = dashboardRows(dashboardData.top_productos)[0];
    const alertCount = dashboardRows(dashboardData.alertas).reduce(
      (sum, row) => sum + numberValue(row.count),
      0
    );
    return [
      `Vendify · ${dependencies.getBusinessName() || "Negocio"}`,
      `Resumen ${days === 1 ? "de hoy" : `últimos ${String(days)} días`}`,
      `Ventas netas: ${formatArs(numberValue(dashboardData.ventas_netas))}`,
      `Tickets: ${String(numberValue(dashboardData.tickets))}`,
      `Ticket promedio: ${formatArs(numberValue(dashboardData.ticket_promedio))}`,
      `Margen estimado: ${formatArs(numberValue(dashboardData.margen_estimado))}`,
      `Devoluciones: ${formatArs(numberValue(dashboardData.devoluciones_total))}`,
      top
        ? `Más vendido: ${textValue(top.nombre)} · ${String(numberValue(top.unidades))} unidades`
        : null,
      `Alertas activas: ${String(alertCount)}`
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  async function copySummary(): Promise<void> {
    const summary = buildSummary();
    if (!summary) {
      dependencies.showToast("Primero cargá el Dashboard", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(summary);
      dependencies.showToast("Resumen copiado", "success");
    } catch {
      dependencies.showToast("No se pudo copiar automáticamente", "error");
    }
  }

  async function load(options: DashboardLoadOptions = {}): Promise<void> {
    if (!dependencies.isSupervisor()) return;
    const refresh = queryOne("#btn-refresh-dashboard-v231");
    if (refresh instanceof HTMLButtonElement) refresh.disabled = true;
    try {
      const response = await loadDashboard(dependencies.client, dependencies.getBranchId(), days);
      const data = typeof response === "object" && response !== null && !Array.isArray(response)
        ? response as DashboardRow
        : {};
      render(data);
      if (options.focusAlerts) {
        requestAnimationFrame(() => {
          queryOne("#dashboard-alerts-panel-v231")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        });
      }
    } catch (error) {
      const message = errorMessage(error, "No se pudo cargar el Dashboard");
      console.error("[Dashboard]", error);
      void dependencies.reportError("dashboard", message);
      const chart = queryOne("#dashboard-sales-chart-v231");
      if (chart) {
        chart.innerHTML = dashboardEmpty(
          "No se pudo cargar el Dashboard. Revisá la migración v2.31."
        );
      }
    } finally {
      if (refresh instanceof HTMLButtonElement) refresh.disabled = false;
    }
  }

  async function open(options: DashboardLoadOptions = {}): Promise<void> {
    if (!dependencies.isSupervisor()) {
      dependencies.showToast("Tu rol no tiene acceso al Dashboard", "error");
      return;
    }
    dependencies.closeManagement();
    queryOne("#modal-dashboard-v231")?.classList.remove("hidden");
    await load(options);
  }

  function close(): void {
    queryOne("#modal-dashboard-v231")?.classList.add("hidden");
  }

  async function loadAlertBadge(): Promise<void> {
    if (!dependencies.isSupervisor() || !navigator.onLine) return;
    try {
      const alerts = await loadOperationalAlerts(dependencies.client, dependencies.getBranchId());
      updateAlertBadge(alerts);
    } catch {
      // The badge is non-critical and preserves the legacy silent failure contract.
    }
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#btn-dashboard-v231")?.addEventListener("click", () => void open());
    queryOne("#btn-alertas-v231")?.addEventListener(
      "click",
      () => void open({ focusAlerts: true })
    );
    queryOne("#btn-close-dashboard-v231")?.addEventListener("click", close);
    queryOne("#modal-dashboard-v231 .modal-backdrop")?.addEventListener("click", close);

    queryAll("[data-dashboard-days]").forEach((button) => {
      button.addEventListener("click", () => {
        days = Number(button.getAttribute("data-dashboard-days") ?? 7);
        queryAll("[data-dashboard-days]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });
        void load();
      });
    });

    queryOne("#btn-refresh-dashboard-v231")?.addEventListener("click", () => void load());
    queryOne("#btn-copy-summary-v231")?.addEventListener("click", () => void copySummary());
    queryOne("#modal-dashboard-v231")?.addEventListener("click", (event) => {
      const trigger = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-dashboard-target]")
        : null;
      if (trigger) {
        const target = trigger.getAttribute("data-dashboard-target");
        if (target === "sales" || target === "inventory" || target === "cash" || target === "purchases") {
          close();
          dependencies.navigateTo(target);
        }
      }
    });
  }

  return Object.freeze({ setup, open, close, load, loadAlertBadge });
}
