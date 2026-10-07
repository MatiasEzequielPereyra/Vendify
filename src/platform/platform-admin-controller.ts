import { escapeHtml } from "../core/dom.js";
import {
  dashboardEmpty,
  renderDashboardRows
} from "../dashboard/dashboard-ui.js";
import {
  isPlatformAdmin,
  loadPlatformBackoffice,
  updateBusinessPlan,
  type PlatformRpcClientPort
} from "./platform-service.js";

type ToastType = "error" | "info" | "success";

interface PlatformDocumentPort {
  querySelector(selector: string): Element | null;
}

export interface PlatformAdminControllerDependencies {
  readonly client: PlatformRpcClientPort;
  readonly isOnline: () => boolean;
  readonly closeUserMenu: () => void;
  readonly formatPrice: (value: number) => string;
  readonly icon: (name: string) => string;
  readonly showToast: (message: string, type: ToastType) => void;
  readonly document?: PlatformDocumentPort;
}

export interface PlatformAdminController {
  readonly setup: () => void;
  readonly refreshAccess: () => Promise<void>;
  readonly open: () => Promise<void>;
  readonly close: () => void;
  readonly savePlan: (button: HTMLButtonElement) => Promise<void>;
}

function numberValue(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function textValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createPlatformAdminController(
  dependencies: PlatformAdminControllerDependencies
): PlatformAdminController {
  const documentRef =
    dependencies.document ??
    (globalThis.document as unknown as PlatformDocumentPort);

  let setupComplete = false;

  function query<T extends Element = Element>(selector: string): T | null {
    return documentRef.querySelector(selector) as T | null;
  }

  async function refreshAccess(): Promise<void> {
    const button = query("#btn-platform-admin-v231");
    if (!button) return;

    if (!dependencies.isOnline()) {
      button.classList.add("hidden");
      return;
    }

    try {
      const admin = await isPlatformAdmin(dependencies.client);
      button.classList.toggle("hidden", admin !== true);
    } catch {
      button.classList.add("hidden");
    }
  }

  function close(): void {
    query("#modal-platform-admin-v231")?.classList.add("hidden");
  }

  function renderBusinesses(rows: unknown): void {
    renderDashboardRows(
      query("#platform-business-list-v231"),
      rows,
      (row) => {
        const trial = row.trial_hasta
          ? ` · trial hasta ${new Date(textValue(row.trial_hasta)).toLocaleDateString("es-AR")}`
          : "";
        const planCode = textValue(row.plan_codigo);
        const status = textValue(row.estado);

        return `
          <div class="platform-business-row-v231" data-platform-business="${escapeHtml(textValue(row.id))}">
            <span class="dashboard-list-icon-v231">
              ${dependencies.icon("store")}
            </span>

            <div class="dashboard-list-copy-v231">
              <strong>${escapeHtml(textValue(row.nombre, "Negocio"))}</strong>
              <small>
                ${numberValue(row.usuarios)} usuario(s) ·
                ${numberValue(row.productos)} productos
                ${trial}
              </small>
            </div>

            <div class="platform-plan-controls-v231">
              <select class="platform-plan-select-v231" aria-label="Plan del negocio">
                ${["legacy", "trial", "starter", "pro", "business"]
                  .map((plan) =>
                    `<option value="${plan}" ${planCode === plan ? "selected" : ""}>${
                      plan === "trial"
                        ? "Prueba Pro"
                        : plan.charAt(0).toUpperCase() + plan.slice(1)
                    }</option>`
                  )
                  .join("")}
              </select>

              <select class="platform-state-select-v231" aria-label="Estado de suscripción">
                ${["legacy", "trial", "activo", "vencido", "suspendido"]
                  .map((state) =>
                    `<option value="${state}" ${status === state ? "selected" : ""}>${state}</option>`
                  )
                  .join("")}
              </select>

              <button type="button"
                      class="btn btn-secondary btn-sm"
                      data-platform-save-plan="${escapeHtml(textValue(row.id))}">
                Guardar
              </button>
            </div>
          </div>`;
      },
      "Todavía no hay negocios."
    );
  }

  function renderErrors(rows: unknown): void {
    renderDashboardRows(
      query("#platform-error-list-v231"),
      rows,
      (row) => `
        <div class="platform-error-row-v231">
          <span class="dashboard-list-icon-v231 ${row.tipo === "window_error" ? "warning" : ""}">
            ${dependencies.icon("alert")}
          </span>
          <div class="dashboard-list-copy-v231">
            <strong>${escapeHtml(textValue(row.mensaje, "Error"))}</strong>
            <small>
              ${escapeHtml(textValue(row.negocio_nombre, "Negocio"))}
              · ${escapeHtml(textValue(row.version, "sin versión"))}
              · ${row.creado ? new Date(textValue(row.creado)).toLocaleString("es-AR") : ""}
            </small>
          </div>
          <span class="platform-status-v231">${escapeHtml(textValue(row.tipo, "client"))}</span>
        </div>`,
      "No hay errores recientes."
    );
  }

  async function open(): Promise<void> {
    query("#modal-platform-admin-v231")?.classList.remove("hidden");

    try {
      const { overview, businesses, errors } =
        await loadPlatformBackoffice(dependencies.client);

      const businessCount = query<HTMLElement>("#platform-businesses-v231");
      if (businessCount) businessCount.textContent = String(numberValue(overview.negocios));

      const trials = query<HTMLElement>("#platform-trials-v231");
      if (trials) trials.textContent = String(numberValue(overview.trials));

      const sales = query<HTMLElement>("#platform-sales-v231");
      if (sales) sales.textContent = dependencies.formatPrice(numberValue(overview.ventas_hoy));

      const errorsCount = query<HTMLElement>("#platform-errors-v231");
      if (errorsCount) errorsCount.textContent = String(numberValue(overview.errores_24h));

      renderBusinesses(businesses);
      renderErrors(errors);
    } catch (error) {
      const list = query<HTMLElement>("#platform-business-list-v231");
      if (list) {
        list.innerHTML = dashboardEmpty(
          errorMessage(error, "No se pudo cargar el backoffice.")
        );
      }
    }
  }

  async function savePlan(button: HTMLButtonElement): Promise<void> {
    const row = button.closest<HTMLElement>("[data-platform-business]");
    if (!row) return;

    const businessId = row.dataset.platformBusiness;
    const plan = row.querySelector<HTMLSelectElement>(".platform-plan-select-v231")?.value;
    const status = row.querySelector<HTMLSelectElement>(".platform-state-select-v231")?.value;
    if (!businessId || !plan || !status) return;

    button.disabled = true;
    button.textContent = "Guardando...";

    try {
      await updateBusinessPlan(
        dependencies.client,
        businessId,
        plan,
        status
      );
      dependencies.showToast("Plan actualizado", "success");
      await open();
    } catch (error) {
      dependencies.showToast(
        errorMessage(error, "No se pudo actualizar el plan"),
        "error"
      );
    } finally {
      button.disabled = false;
      button.textContent = "Guardar";
    }
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;

    query("#btn-platform-admin-v231")?.addEventListener("click", () => {
      dependencies.closeUserMenu();
      void open();
    });

    query("#btn-close-platform-v231")?.addEventListener("click", close);
    query("#modal-platform-admin-v231 .modal-backdrop")?.addEventListener(
      "click",
      close
    );

    query("#platform-business-list-v231")?.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const button = target?.closest<HTMLButtonElement>("[data-platform-save-plan]");
      if (button) void savePlan(button);
    });
  }

  return Object.freeze({
    setup,
    refreshAccess,
    open,
    close,
    savePlan
  });
}
