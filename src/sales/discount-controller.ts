import { escapeHtml, queryOne } from "../core/dom.js";
import {
  discountAuthorizationMatches,
  normalizeDiscountRequest,
  type DiscountAuthorization,
  type DiscountRequest
} from "./sales-model.js";
import {
  authorizeDiscount,
  configureDiscountPin,
  getDiscountPinState,
  type SalesRpcClientPort
} from "./sales-service.js";

type Field = HTMLInputElement | HTMLSelectElement;

export interface DiscountControllerDependencies {
  readonly client: SalesRpcClientPort;
  readonly getBranchId: () => string | null;
  readonly getRole: () => string | null;
  readonly isAppReady: () => boolean;
  readonly getSubtotal: () => number;
  readonly formatCurrency: (value: number) => string;
  readonly icon: (name: string) => string;
  readonly showToast: (message: string, type: "error" | "info" | "success") => void;
  readonly recalculateTotals: () => void;
}

export interface DiscountController {
  readonly setup: () => void;
  readonly getRequest: () => DiscountRequest;
  readonly isAuthorized: () => boolean;
  readonly invalidate: (options?: { recalculate?: boolean }) => void;
  readonly render: () => void;
  readonly openAuthorization: () => void;
  readonly updatePinState: () => Promise<void>;
}

function field(selector: string): Field | null {
  const element = queryOne(selector);
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function scalarText(value: unknown, fallback: string): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : fallback;
}

export function createDiscountController(
  dependencies: DiscountControllerDependencies
): DiscountController {
  let authorization: DiscountAuthorization | null = null;
  let setupComplete = false;

  function getRequest(): DiscountRequest {
    return normalizeDiscountRequest(
      dependencies.getSubtotal(),
      field("#venta-descuento-tipo-v228")?.value ?? "",
      Number(field("#venta-descuento-valor-v228")?.value ?? 0)
    );
  }

  function isAuthorized(): boolean {
    return discountAuthorizationMatches(authorization, getRequest());
  }

  function render(): void {
    const button = queryOne("#btn-autorizar-descuento");
    const status = queryOne("#discount-auth-status");
    const caption = queryOne("#discount-auth-caption");
    const request = getRequest();
    const requested = Boolean(request.tipo) && request.valor > 0 && request.subtotal > 0;
    const authorized = requested && isAuthorized();
    if (button instanceof HTMLButtonElement) {
      button.disabled = !requested || authorized;
      button.innerHTML = authorized
        ? `${dependencies.icon("check")}<span>Autorizado</span>`
        : `${dependencies.icon("lock")}<span>Autorizar</span>`;
    }
    if (status) {
      status.classList.remove("pending", "authorized", "required");
      if (!request.tipo || request.valor <= 0) {
        status.classList.add("pending");
        status.innerHTML = '<span class="discount-auth-dot"></span><span>Sin descuento aplicado</span>';
      } else if (authorized) {
        status.classList.add("authorized");
        status.innerHTML = `<span class="discount-auth-dot"></span><span>Autorizado por ${
          escapeHtml(authorization?.autorizador ?? "Administrador")
        }</span>`;
      } else {
        status.classList.add("required");
        status.innerHTML = '<span class="discount-auth-dot"></span><span>Ingresá un PIN de administrador para aplicar este descuento</span>';
      }
    }
    if (caption) caption.textContent = authorized ? "Autorizado" : "Requiere autorización";
  }

  function invalidate(options: { recalculate?: boolean } = {}): void {
    authorization = null;
    render();
    if (options.recalculate !== false) dependencies.recalculateTotals();
  }

  function openAuthorization(): void {
    const request = getRequest();
    if (!request.tipo || request.valor <= 0) {
      dependencies.showToast("Ingresá primero el descuento que querés aplicar", "info");
      return;
    }
    if (request.subtotal <= 0) {
      dependencies.showToast("Agregá productos antes de autorizar el descuento", "info");
      return;
    }
    const subtotal = queryOne("#discount-auth-subtotal");
    const requested = queryOne("#discount-auth-request");
    const pin = field("#discount-admin-pin");
    const error = queryOne("#discount-auth-error");
    if (subtotal) subtotal.textContent = dependencies.formatCurrency(request.subtotal);
    if (requested) {
      requested.textContent = request.tipo === "porcentaje"
        ? `${String(request.valor)}%`
        : dependencies.formatCurrency(request.valor);
    }
    if (pin) pin.value = "";
    if (error) error.textContent = "";
    queryOne("#modal-discount-auth")?.classList.remove("hidden");
    setTimeout(() => field("#discount-admin-pin")?.focus(), 60);
  }

  function closeAuthorization(): void {
    queryOne("#modal-discount-auth")?.classList.add("hidden");
    const pin = field("#discount-admin-pin");
    const error = queryOne("#discount-auth-error");
    if (pin) pin.value = "";
    if (error) error.textContent = "";
  }

  async function submitAuthorization(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const request = getRequest();
    const pin = field("#discount-admin-pin")?.value.trim() ?? "";
    const branchId = dependencies.getBranchId();
    const error = queryOne("#discount-auth-error");
    const button = queryOne("#btn-submit-discount-auth");
    if (error) error.textContent = "";
    if (!/^\d{4,8}$/.test(pin)) {
      if (error) error.textContent = "El PIN debe tener entre 4 y 8 números.";
      return;
    }
    if (!branchId) {
      if (error) error.textContent = "No hay una sucursal activa.";
      return;
    }
    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
      button.textContent = "Verificando...";
    }
    try {
      const data = await authorizeDiscount(dependencies.client, pin, branchId, request);
      if (data.ok !== true) {
        if (error) error.textContent = scalarText(data.message, "PIN incorrecto o autorización no disponible.");
        return;
      }
      authorization = {
        ok: true,
        tipo: request.tipo,
        valor: request.valor,
        subtotal: request.subtotal,
        autorizador: scalarText(data.autorizador_nombre, scalarText(data.autorizador_rol, "Administrador")),
        expiraMs: Date.now() + Math.max(30, Number(data.expira_segundos ?? 180)) * 1000
      };
      closeAuthorization();
      render();
      dependencies.recalculateTotals();
      dependencies.showToast(`Descuento autorizado por ${authorization.autorizador}`, "success");
    } catch (caught) {
      if (error) error.textContent = errorMessage(caught, "No se pudo autorizar el descuento");
    } finally {
      if (button instanceof HTMLButtonElement) {
        button.disabled = false;
        button.textContent = "Autorizar descuento";
      }
    }
  }

  async function updatePinState(): Promise<void> {
    const card = queryOne("#config-discount-pin-card");
    const status = queryOne("#pin-config-status");
    const button = queryOne("#btn-configurar-pin-descuento");
    if (!card || !status || !(button instanceof HTMLButtonElement) || !dependencies.isAppReady()) return;
    const allowed = ["owner", "admin"].includes(dependencies.getRole() ?? "");
    card.classList.toggle("hidden", !allowed);
    if (!allowed) return;
    status.textContent = "Consultando estado...";
    try {
      const data = await getDiscountPinState(dependencies.client);
      if (data.configurado) {
        status.innerHTML = '<span class="pin-status-dot configured"></span><span>Tu PIN está configurado</span>';
        button.textContent = "Cambiar PIN";
      } else {
        status.innerHTML = '<span class="pin-status-dot"></span><span>Todavía no configuraste tu PIN</span>';
        button.textContent = "Configurar PIN";
      }
      const count = Number(data.autorizadores_configurados ?? 0);
      if (count > 0) {
        status.innerHTML += `<small>${String(count)} ${
          count === 1 ? "autorizador disponible" : "autorizadores disponibles"
        } en el negocio</small>`;
      }
    } catch {
      status.textContent = "No se pudo consultar el estado del PIN.";
    }
  }

  function openPinConfiguration(): void {
    const pin = field("#config-discount-pin");
    const confirmation = field("#config-discount-pin-confirm");
    const error = queryOne("#config-discount-pin-error");
    if (pin) pin.value = "";
    if (confirmation) confirmation.value = "";
    if (error) error.textContent = "";
    queryOne("#modal-config-discount-pin")?.classList.remove("hidden");
    setTimeout(() => field("#config-discount-pin")?.focus(), 60);
  }

  function closePinConfiguration(): void {
    queryOne("#modal-config-discount-pin")?.classList.add("hidden");
    for (const selector of ["#config-discount-pin", "#config-discount-pin-confirm"]) {
      const element = field(selector);
      if (element) element.value = "";
    }
    const error = queryOne("#config-discount-pin-error");
    if (error) error.textContent = "";
  }

  async function savePin(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const pin = field("#config-discount-pin")?.value.trim() ?? "";
    const confirmation = field("#config-discount-pin-confirm")?.value.trim() ?? "";
    const error = queryOne("#config-discount-pin-error");
    const button = queryOne("#btn-save-config-pin");
    if (error) error.textContent = "";
    if (!/^\d{4,8}$/.test(pin)) {
      if (error) error.textContent = "Usá un PIN de 4 a 8 números.";
      return;
    }
    if (pin !== confirmation) {
      if (error) error.textContent = "Los PIN no coinciden.";
      return;
    }
    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
      button.textContent = "Guardando...";
    }
    try {
      const data = await configureDiscountPin(dependencies.client, pin);
      if (data.ok !== true) {
        if (error) error.textContent = scalarText(data.message, "No se pudo configurar el PIN.");
        return;
      }
      closePinConfiguration();
      await updatePinState();
      dependencies.showToast("PIN de descuentos configurado", "success");
    } catch (caught) {
      if (error) error.textContent = errorMessage(caught, "No se pudo configurar el PIN");
    } finally {
      if (button instanceof HTMLButtonElement) {
        button.disabled = false;
        button.textContent = "Guardar PIN";
      }
    }
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#venta-descuento-tipo-v228")?.addEventListener("change", (event) => {
      const input = field("#venta-descuento-valor-v228");
      const target = event.target;
      authorization = null;
      if (input && target instanceof HTMLSelectElement) {
        input.disabled = !target.value;
        if (!target.value) input.value = "0";
      }
      dependencies.recalculateTotals();
    });
    queryOne("#venta-descuento-valor-v228")?.addEventListener("input", () => {
      authorization = null;
      dependencies.recalculateTotals();
    });
    queryOne("#btn-autorizar-descuento")?.addEventListener("click", openAuthorization);
    queryOne("#form-discount-auth")?.addEventListener("submit", (event) => void submitAuthorization(event as SubmitEvent));
    queryOne("#btn-close-discount-auth")?.addEventListener("click", closeAuthorization);
    queryOne("#btn-cancel-discount-auth")?.addEventListener("click", closeAuthorization);
    queryOne("#modal-discount-auth .modal-backdrop")?.addEventListener("click", closeAuthorization);
    queryOne("#btn-configurar-pin-descuento")?.addEventListener("click", openPinConfiguration);
    queryOne("#form-config-discount-pin")?.addEventListener("submit", (event) => void savePin(event as SubmitEvent));
    queryOne("#btn-close-config-pin")?.addEventListener("click", closePinConfiguration);
    queryOne("#btn-cancel-config-pin")?.addEventListener("click", closePinConfiguration);
    queryOne("#modal-config-discount-pin .modal-backdrop")?.addEventListener("click", closePinConfiguration);
  }

  return Object.freeze({ setup, getRequest, isAuthorized, invalidate, render, openAuthorization, updatePinState });
}
