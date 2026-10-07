import { escapeHtml } from "../core/dom.js";
import type { CashRpcClientPort } from "../cash/cash-service.js";
import {
  exportOperationalBackup,
  getCommercialOnboarding,
  getCurrentPlan,
  getOperationalConfig,
  saveOperationalConfig
} from "./commercial-service.js";

type ToastType = "error" | "info" | "success";

interface CommercialBusiness {
  readonly id?: string | null;
  readonly nombre?: string | null;
}

interface CommercialStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CommercialDocumentPort {
  readonly visibilityState: DocumentVisibilityState;
  querySelector(selector: string): Element | null;
}

interface CommercialLogger {
  warn(...args: unknown[]): void;
}

export interface CommercialFoundationControllerDependencies {
  readonly client: CashRpcClientPort;
  readonly getAppReady: () => boolean;
  readonly getBusiness: () => CommercialBusiness | null;
  readonly getRole: () => string | null;
  readonly hasPermission: (permission: string) => boolean;
  readonly isOnline: () => boolean;
  readonly persistOfflineContext: () => void;
  readonly applyOfflineState: () => void;
  readonly openProduct: () => void;
  readonly openConfig: (tab: string) => void;
  readonly openCash: () => void | Promise<void>;
  readonly openSale: () => void;
  readonly openTeam: () => void | Promise<void>;
  readonly reloadDashboardAlertBadge: () => void | Promise<void>;
  readonly refreshPlatformAccess: () => void | Promise<void>;
  readonly showToast: (message: string, type: ToastType) => void;
  readonly downloadText: (content: string, mime: string, filename: string) => void;
  readonly icon: (name: string) => string;
  readonly storage?: CommercialStoragePort;
  readonly document?: CommercialDocumentPort;
  readonly setIntervalFn?: (callback: () => void, ms: number) => number;
  readonly clearIntervalFn?: (id: number) => void;
  readonly now?: () => Date;
  readonly logger?: CommercialLogger;
}

export interface CommercialFoundationController {
  readonly setup: () => void;
  readonly load: () => Promise<void>;
  readonly refreshOnboarding: () => Promise<void>;
  readonly loadPlan: () => Promise<void>;
  readonly loadOperationalConfig: () => Promise<void>;
  readonly saveOperationalConfig: (event?: Event) => Promise<void>;
  readonly downloadBackup: () => Promise<void>;
  readonly getAutoPrint: () => boolean;
  readonly getTicketWidth: () => number;
}

interface OperationalConfigState {
  stockCoverageAlert: number;
  largeAdjustmentUnits: number;
  cashDifferenceAlert: number;
  dailySummary: boolean;
  autoPrintTicket: boolean;
  ticketWidthMm: number;
}

const ONBOARDING_HIDE_PREFIX = "vendify_onboarding_hide_v231";

function numberValue(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function textValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
}

export function createCommercialFoundationController(
  dependencies: CommercialFoundationControllerDependencies
): CommercialFoundationController {
  const storage = dependencies.storage ?? globalThis.localStorage;
  const documentRef = dependencies.document ?? globalThis.document;
  const setIntervalFn =
    dependencies.setIntervalFn ??
    ((callback, ms) => globalThis.setInterval(callback, ms));
  const clearIntervalFn =
    dependencies.clearIntervalFn ??
    ((id) => {
      globalThis.clearInterval(id);
    });
  const now = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;

  let setupComplete = false;
  let refreshTimer: number | null = null;
  let operationalConfig: OperationalConfigState = {
    stockCoverageAlert: 3,
    largeAdjustmentUnits: 10,
    cashDifferenceAlert: 10000,
    dailySummary: true,
    autoPrintTicket: false,
    ticketWidthMm: 80
  };

  function query(selector: string): Element | null {
    return documentRef.querySelector(selector);
  }

  function html(selector: string): HTMLElement | null {
    return documentRef.querySelector(selector) as HTMLElement | null;
  }

  function input(selector: string): HTMLInputElement | null {
    return documentRef.querySelector(selector) as HTMLInputElement | null;
  }

  function select(selector: string): HTMLSelectElement | null {
    return documentRef.querySelector(selector) as HTMLSelectElement | null;
  }

  function button(selector: string): HTMLButtonElement | null {
    return documentRef.querySelector(selector) as HTMLButtonElement | null;
  }

  function role(): string | null {
    return dependencies.getRole();
  }

  function isOwner(): boolean {
    return role() === "owner";
  }

  function isSupervisor(): boolean {
    return ["owner", "admin", "manager"].includes(role() ?? "");
  }

  function onboardingHideKey(): string {
    const businessId = dependencies.getBusiness()?.id;
    const suffix = businessId ? businessId : "none";
    return `${ONBOARDING_HIDE_PREFIX}:${suffix}`;
  }

  function hideOnboarding(): void {
    query("#commercial-onboarding-v231")?.classList.add("hidden");
  }

  function renderOnboarding(data: Record<string, unknown>): void {
    const element = query("#commercial-onboarding-v231");
    const container = query("#commercial-onboarding-steps-v231");
    if (!element || !container || !isOwner()) {
      element?.classList.add("hidden");
      return;
    }

    if (data.completado) {
      element.classList.add("hidden");
      try {
        storage.removeItem(onboardingHideKey());
      } catch {
        // Storage may be unavailable in hardened browser contexts.
      }
      return;
    }

    try {
      if (storage.getItem(onboardingHideKey()) === "1") {
        element.classList.add("hidden");
        return;
      }
    } catch {
        // Storage may be unavailable in hardened browser contexts.
      }

    const productCount = numberValue(data.productos);
    const saleCount = numberValue(data.ventas);
    const memberCount = numberValue(data.miembros);
    const steps = [
      {
        done: productCount > 0,
        title: "Cargá tu catálogo",
        detail: productCount > 0
          ? `${String(productCount)} productos listos`
          : "Agregá productos o importá un CSV.",
        action: "product",
        actionLabel: "Cargar productos",
        icon: "inventory"
      },
      {
        done: Boolean(data.caja_utilizada),
        title: "Prepará una caja",
        detail: data.caja_utilizada
          ? "La caja ya fue utilizada"
          : "Abrí tu primer turno de caja.",
        action: "cash",
        actionLabel: "Abrir caja",
        icon: "register"
      },
      {
        done: saleCount > 0,
        title: "Registrá la primera venta",
        detail: saleCount > 0
          ? `${String(saleCount)} venta(s) registradas`
          : "Probá el flujo completo de cobro.",
        action: "sale",
        actionLabel: "Vender",
        icon: "cart"
      },
      {
        done: memberCount > 1,
        title: "Sumá a tu equipo",
        detail: memberCount > 1
          ? `${String(memberCount)} usuarios activos`
          : "Creá al menos un empleado.",
        action: "team",
        actionLabel: "Crear empleado",
        icon: "team"
      }
    ];

    const completed = steps.filter((step) => step.done).length;
    const progress = Math.round((completed / steps.length) * 100);
    const bar = html("#commercial-progress-bar-v231");
    const label = html("#commercial-progress-label-v231");
    if (bar) bar.style.width = `${String(progress)}%`;
    if (label) {
      label.textContent =
        `${String(progress)}% completo · ${String(completed)} de ${String(steps.length)} pasos`;
    }

    container.innerHTML = steps.map((step) => `
      <article class="commercial-step-v231 ${step.done ? "done" : ""}">
        <span class="commercial-step-icon-v231">
          ${dependencies.icon(step.done ? "check" : step.icon)}
        </span>
        <div class="commercial-step-copy-v231">
          <strong>${escapeHtml(step.title)}</strong>
          <small>${escapeHtml(step.detail)}</small>
        </div>
        ${step.done
          ? '<span class="commercial-step-done-v231">Listo</span>'
          : `<button type="button"
                     class="btn btn-secondary btn-sm"
                     data-onboarding-action-v231="${step.action}">
               ${escapeHtml(step.actionLabel)}
             </button>`}
      </article>`).join("");

    element.classList.remove("hidden");
  }

  async function refreshOnboarding(): Promise<void> {
    if (!isOwner()) {
      hideOnboarding();
      return;
    }
    if (!dependencies.isOnline()) return;

    try {
      const data = await getCommercialOnboarding(dependencies.client);
      renderOnboarding(data);
    } catch {
        // Storage may be unavailable in hardened browser contexts.
      }
  }

  async function loadPlan(): Promise<void> {
    if (!dependencies.isOnline() || !dependencies.getAppReady()) return;

    const name = html("#config-plan-name-v231");
    const detail = html("#config-plan-detail-v231");
    const usage = html("#config-plan-usage-v231");

    try {
      const data = await getCurrentPlan(dependencies.client);
      if (name) name.textContent = textValue(data.nombre, "Plan");

      if (detail) {
        detail.textContent = data.trial_dias_restantes != null
          ? `Prueba · ${String(numberValue(data.trial_dias_restantes))} día(s) restantes`
          : data.estado === "legacy"
            ? "Cuenta existente sin límites comerciales aplicados."
            : `Estado: ${textValue(data.estado, "activo")}`;
      }

      if (usage) {
        const limits = record(data.limites);
        const current = record(data.uso);
        const row = (labelText: string, value: unknown, limit: unknown): string => `
          <span>
            <strong>${escapeHtml(labelText)}</strong>
            <small>
              ${String(numberValue(value))}
              ${limit == null ? "" : ` / ${String(numberValue(limit))}`}
            </small>
          </span>`;

        usage.innerHTML = [
          row("Sucursales", current.sucursales, limits.sucursales),
          row("Usuarios", current.usuarios, limits.usuarios),
          row("Productos", current.productos, limits.productos)
        ].join("");
      }
    } catch {
      if (name) name.textContent = "No disponible";
      if (detail) detail.textContent = "Ejecutá la migración comercial v2.31.";
    }
  }

  function applyOperationalConfigToDom(): void {
    const stockDays = input("#config-stock-days-v231");
    if (!stockDays) return;

    stockDays.value = String(operationalConfig.stockCoverageAlert);

    const threshold = input("#config-adjust-threshold-v231");
    if (threshold) threshold.value = String(operationalConfig.largeAdjustmentUnits);

    const cashDifference = input("#config-cash-diff-v231");
    if (cashDifference) cashDifference.value = String(operationalConfig.cashDifferenceAlert);

    const dailySummary = input("#config-daily-summary-v231");
    if (dailySummary) dailySummary.checked = operationalConfig.dailySummary;

    const autoPrint = input("#config-auto-print-v231");
    if (autoPrint) autoPrint.checked = operationalConfig.autoPrintTicket;

    const width = select("#config-ticket-width-v231");
    if (width) width.value = String(operationalConfig.ticketWidthMm === 58 ? 58 : 80);
  }

  async function loadOperationalConfig(): Promise<void> {
    if (!dependencies.isOnline() || !isSupervisor()) return;

    try {
      const data = await getOperationalConfig(dependencies.client);
      operationalConfig = {
        stockCoverageAlert: numberValue(
          data.stock_cobertura_alerta,
          operationalConfig.stockCoverageAlert
        ),
        largeAdjustmentUnits: numberValue(
          data.ajuste_grande_unidades,
          operationalConfig.largeAdjustmentUnits
        ),
        cashDifferenceAlert: numberValue(
          data.diferencia_caja_alerta,
          operationalConfig.cashDifferenceAlert
        ),
        dailySummary: data.resumen_diario !== false,
        autoPrintTicket: data.auto_imprimir_ticket === true,
        ticketWidthMm: numberValue(data.ancho_ticket_mm, 80) === 58 ? 58 : 80
      };
      applyOperationalConfigToDom();
    } catch (error) {
      logger.warn("[Config v2.31]", error);
    }
  }

  function inputValue(selector: string, fallback: string): string {
    const value = input(selector)?.value;
    return value ? value : fallback;
  }

  function checked(selector: string): boolean {
    return input(selector)?.checked === true;
  }

  async function saveConfig(event?: Event): Promise<void> {
    event?.preventDefault();

    if (!["owner", "admin"].includes(role() ?? "")) {
      dependencies.showToast(
        "Solo Propietario o Administrador pueden cambiar esta configuración",
        "error"
      );
      return;
    }

    const button = button("#btn-save-operacion-v231");
    if (button) {
      button.disabled = true;
      button.textContent = "Guardando...";
    }

    try {
      await saveOperationalConfig(dependencies.client, {
        stockCoverageAlert: Number(inputValue("#config-stock-days-v231", "3")),
        largeAdjustmentUnits: Number(inputValue("#config-adjust-threshold-v231", "10")),
        cashDifferenceAlert: Number(inputValue("#config-cash-diff-v231", "0")),
        dailySummary: checked("#config-daily-summary-v231"),
        autoPrintTicket: checked("#config-auto-print-v231"),
        ticketWidthMm: Number(inputValue("#config-ticket-width-v231", "80"))
      });
      await loadOperationalConfig();
      await dependencies.reloadDashboardAlertBadge();
      dependencies.showToast("Configuración operativa guardada", "success");
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo guardar"), "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Guardar configuración";
      }
    }
  }

  async function downloadBackup(): Promise<void> {
    if (!isOwner()) {
      dependencies.showToast(
        "Solo el propietario puede descargar un respaldo completo",
        "error"
      );
      return;
    }

    const button = button("#btn-backup-json-v231");
    if (button) button.disabled = true;

    try {
      const data = await exportOperationalBackup(dependencies.client);
      const date = now().toISOString().slice(0, 10);
      const businessSlug = slug(dependencies.getBusiness()?.nombre ?? "negocio");
      const business = businessSlug.length > 0 ? businessSlug : "negocio";
      dependencies.downloadText(
        JSON.stringify(data, null, 2),
        "application/json;charset=utf-8",
        `vendify-backup-${business}-${date}.json`
      );
      dependencies.showToast("Respaldo descargado", "success");
    } catch (error) {
      dependencies.showToast(
        errorMessage(error, "No se pudo generar el respaldo"),
        "error"
      );
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;

    query("#btn-hide-commercial-onboarding-v231")?.addEventListener("click", () => {
      try {
        storage.setItem(onboardingHideKey(), "1");
      } catch {
        // Storage may be unavailable in hardened browser contexts.
      }
      hideOnboarding();
    });

    query("#commercial-onboarding-steps-v231")?.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const button = target?.closest<HTMLElement>("[data-onboarding-action-v231]");
      const action = button?.dataset.onboardingActionV231;
      if (!action) return;

      if (action === "product") {
        if (dependencies.hasPermission("manageProducts")) dependencies.openProduct();
        else dependencies.openConfig("datos");
      } else if (action === "cash") {
        void dependencies.openCash();
      } else if (action === "sale") {
        dependencies.openSale();
      } else if (action === "team") {
        void dependencies.openTeam();
      }
    });

    query("#form-operacion-v231")?.addEventListener("submit", (event) => {
      void saveConfig(event);
    });

    query("#btn-backup-json-v231")?.addEventListener("click", () => {
      void downloadBackup();
    });
  }

  async function load(): Promise<void> {
    if (!dependencies.getAppReady()) return;

    dependencies.persistOfflineContext();

    if (!dependencies.isOnline()) {
      dependencies.applyOfflineState();
      return;
    }

    await Promise.allSettled([
      loadOperationalConfig(),
      loadPlan(),
      refreshOnboarding(),
      Promise.resolve(dependencies.reloadDashboardAlertBadge()),
      Promise.resolve(dependencies.refreshPlatformAccess())
    ]);

    if (refreshTimer !== null) clearIntervalFn(refreshTimer);
    refreshTimer = setIntervalFn(() => {
      if (documentRef.visibilityState === "visible" && dependencies.isOnline()) {
        void dependencies.reloadDashboardAlertBadge();
      }
    }, 60000);
  }

  return Object.freeze({
    setup,
    load,
    refreshOnboarding,
    loadPlan,
    loadOperationalConfig,
    saveOperationalConfig: saveConfig,
    downloadBackup,
    getAutoPrint: () => operationalConfig.autoPrintTicket,
    getTicketWidth: () => operationalConfig.ticketWidthMm === 58 ? 58 : 80
  });
}
