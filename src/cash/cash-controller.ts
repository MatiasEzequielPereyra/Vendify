import { escapeHtml, queryAll, queryOne } from "../core/dom.js";
import {
  closeCashRegister,
  getCashState,
  listCashHistory,
  listCashRegisters,
  listOpenCashMovements,
  openCashRegister,
  registerCashMovement,
  type CashRecord,
  type CashRpcClientPort
} from "./cash-service.js";

interface CashContextItem {
  readonly id: string | null;
  readonly name: string;
}

interface CashContext {
  readonly businessId: string | null;
  readonly branch: CashContextItem;
  readonly cashRegister: CashContextItem;
}

export interface CashControllerDependencies {
  readonly client: CashRpcClientPort;
  readonly getContext: () => CashContext;
  readonly setCashRegister: (cashRegister: CashRecord | null) => void;
  readonly getCartSize: () => number;
  readonly clearCart: () => void;
  readonly confirm: (title: string, message: string) => Promise<boolean>;
  readonly showToast: (message: string, type: "error" | "info" | "success") => void;
  readonly formatCurrency: (value: number) => string;
  readonly icon: (name: string) => string;
  readonly updateContextLabels: () => void;
  readonly persistOfflineContext: () => void;
  readonly restoreOfflineState: () => boolean;
  readonly persistOfflineState: () => void;
  readonly isOnline: () => boolean;
}

export interface CashController {
  readonly setup: () => void;
  readonly initialize: () => Promise<void>;
  readonly loadRegisters: (options?: { keep?: boolean }) => Promise<void>;
  readonly selectRegister: (id: string) => Promise<void>;
  readonly loadState: () => Promise<void>;
  readonly getState: () => CashRecord | null;
  readonly setState: (state: CashRecord | null) => void;
  readonly getRegisters: () => CashRecord[];
  readonly isOpenByCurrentUser: () => boolean;
  readonly renderOptions: () => void;
  readonly renderHeader: () => void;
  readonly renderPanel: () => Promise<void>;
  readonly openPanel: () => Promise<void>;
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

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function number(value: unknown): number {
  return Number(value ?? 0);
}

function nullableTrimmed(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
}

function nestedRecord(value: unknown): CashRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as CashRecord
    : null;
}

function formatDateTime(value: unknown): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(text(value)));
  } catch {
    return text(value);
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createCashController(dependencies: CashControllerDependencies): CashController {
  let registers: CashRecord[] = [];
  let state: CashRecord | null = null;
  let movementType: string | null = null;
  let operationInProgress = false;
  let setupComplete = false;

  function context(): CashContext {
    return dependencies.getContext();
  }

  function session(): CashRecord | null {
    return nestedRecord(state?.sesion);
  }

  function isOpenByCurrentUser(): boolean {
    return Boolean(session() && state?.es_mia);
  }

  function setState(nextState: CashRecord | null): void {
    state = nextState;
    renderHeader();
  }

  function renderOptions(): void {
    const selector = queryOne("#cash-selector-v227");
    if (selector instanceof HTMLSelectElement) {
      selector.innerHTML = registers.length
        ? registers.map((register) =>
          `<option value="${escapeHtml(text(register.id))}">${escapeHtml(text(register.nombre))}</option>`
        ).join("")
        : '<option value="">Sin cajas</option>';
      if (context().cashRegister.id) selector.value = context().cashRegister.id ?? "";
    }

    const container = queryOne("#cash-options-v23013");
    if (!container) return;
    if (!registers.length) {
      container.innerHTML = `
        <div class="context-picker-empty-v23013">
          Esta sucursal no tiene cajas disponibles.
        </div>`;
      dependencies.updateContextLabels();
      return;
    }

    container.innerHTML = registers.map((register) => {
      const id = text(register.id);
      const active = id === context().cashRegister.id;
      return `
        <button type="button"
                class="context-picker-option-v23013 ${active ? "active" : ""}"
                role="option"
                aria-selected="${active ? "true" : "false"}"
                data-context-cash="${escapeHtml(id)}">
          <span class="context-option-icon-v23013">${dependencies.icon("register")}</span>
          <span class="context-option-copy-v23013">
            <strong>${escapeHtml(text(register.nombre))}</strong>
            <small>${active ? "Caja actual" : "Cambiar a esta caja"}</small>
          </span>
          <span class="context-option-check-v23013">${active ? dependencies.icon("check") : ""}</span>
        </button>`;
    }).join("");
    dependencies.updateContextLabels();
  }

  function renderHeader(): void {
    const dot = queryOne("#cash-status-dot-v227");
    const label = queryOne("#cash-status-label-v227");
    if (!dot || !label) return;
    dot.classList.remove("open", "closed", "busy");
    if (!context().cashRegister.id) {
      dot.classList.add("closed");
      label.textContent = "Sin caja";
    } else if (!session()) {
      dot.classList.add("closed");
      label.textContent = "Caja cerrada";
    } else if (state?.es_mia) {
      dot.classList.add("open");
      label.textContent = "Caja abierta";
    } else {
      dot.classList.add("busy");
      label.textContent = "Caja ocupada";
    }
  }

  async function loadState(): Promise<void> {
    const cashRegisterId = context().cashRegister.id;
    if (!cashRegisterId) {
      setState(null);
      return;
    }
    if (!dependencies.isOnline()) {
      if (!dependencies.restoreOfflineState()) setState(null);
      return;
    }
    try {
      setState(await getCashState(dependencies.client, cashRegisterId));
      dependencies.persistOfflineState();
    } catch (error) {
      console.error("[Caja] estado:", error);
      if (!dependencies.isOnline() && dependencies.restoreOfflineState()) return;
      setState(null);
    }
  }

  async function loadRegisters(options: { keep?: boolean } = {}): Promise<void> {
    const branchId = context().branch.id;
    if (!branchId) {
      registers = [];
      dependencies.setCashRegister(null);
      renderOptions();
      await loadState();
      return;
    }
    try {
      registers = await listCashRegisters(dependencies.client, branchId);
    } catch (error) {
      console.error("[Caja] cajas:", error);
      registers = [];
      dependencies.setCashRegister(null);
      renderOptions();
      await loadState();
      return;
    }

    const businessId = context().businessId;
    const storageKey = businessId
      ? `vendify_cash_${businessId}_${branchId}`
      : null;
    const saved = options.keep !== false && storageKey ? localStorage.getItem(storageKey) : null;
    const current = context().cashRegister.id;
    const chosen = registers.find((register) => register.id === saved) ??
      registers.find((register) => register.id === current) ?? registers[0] ?? null;
    dependencies.setCashRegister(chosen
      ? { id: text(chosen.id), nombre: text(chosen.nombre) }
      : null);
    if (storageKey && chosen) localStorage.setItem(storageKey, text(chosen.id));
    renderOptions();
    await loadState();
  }

  async function selectRegister(id: string): Promise<void> {
    const selected = registers.find((register) => register.id === id);
    if (!selected) {
      renderOptions();
      return;
    }
    if (dependencies.getCartSize()) {
      const accepted = await dependencies.confirm(
        "Cambiar de caja",
        "El carrito actual se vaciará al cambiar de caja."
      );
      if (!accepted) {
        renderOptions();
        return;
      }
      dependencies.clearCart();
    }
    dependencies.setCashRegister({ id: text(selected.id), nombre: text(selected.nombre) });
    const current = context();
    if (current.businessId && current.branch.id) {
      localStorage.setItem(`vendify_cash_${current.businessId}_${current.branch.id}`, id);
    }
    renderOptions();
    dependencies.persistOfflineContext();
    await loadState();
  }

  async function renderMovements(): Promise<void> {
    const container = queryOne("#cash-movements-v227");
    const cashRegisterId = context().cashRegister.id;
    if (!container || !session() || !cashRegisterId) return;
    try {
      const movements = await listOpenCashMovements(dependencies.client, cashRegisterId);
      if (!movements.length) {
        container.innerHTML = '<p class="cash-no-movements-v227">Todavía no hay movimientos manuales.</p>';
        return;
      }
      container.innerHTML = movements.map((movement) => {
        const type = text(movement.tipo);
        return `<div class="cash-movement-row-v227 ${escapeHtml(type)}"><div><strong>${
          type === "ingreso" ? "Ingreso" : "Retiro"
        }</strong><small>${escapeHtml(text(movement.motivo))} · ${
          escapeHtml(formatDateTime(movement.creado))
        }</small></div><strong>${type === "ingreso" ? "+" : "−"}${
          dependencies.formatCurrency(number(movement.monto))
        }</strong></div>`;
      }).join("");
    } catch {
      container.innerHTML = '<p class="hint">No se pudieron cargar los movimientos.</p>';
    }
  }

  function openMovement(type: string): void {
    movementType = type;
    const typeField = field("#cash-movement-type-v227");
    const title = queryOne("#cash-movement-title-v227");
    if (typeField) typeField.value = type;
    if (title) title.textContent = type === "ingreso" ? "Registrar ingreso" : "Registrar retiro";
    const amount = field("#cash-movement-amount-v227");
    const reason = field("#cash-movement-reason-v227");
    const error = queryOne("#cash-movement-error-v227");
    if (amount) amount.value = "";
    if (reason) reason.value = "";
    if (error) error.textContent = "";
    queryOne("#modal-caja-movimiento-v227")?.classList.remove("hidden");
  }

  function closeMovement(): void {
    queryOne("#modal-caja-movimiento-v227")?.classList.add("hidden");
  }

  async function saveMovement(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const cashRegisterId = context().cashRegister.id;
    if (operationInProgress || !cashRegisterId) return;
    operationInProgress = true;
    const errorElement = queryOne("#cash-movement-error-v227");
    if (errorElement) errorElement.textContent = "";
    const button = event.submitter instanceof HTMLButtonElement ? event.submitter : null;
    if (button) {
      button.disabled = true;
      button.textContent = "Registrando...";
    }
    try {
      state = await registerCashMovement(
        dependencies.client,
        cashRegisterId,
        field("#cash-movement-type-v227")?.value ?? "",
        number(field("#cash-movement-amount-v227")?.value),
        field("#cash-movement-reason-v227")?.value.trim() ?? ""
      );
      closeMovement();
      renderHeader();
      await renderPanel();
      dependencies.showToast(
        movementType === "ingreso" ? "Ingreso registrado" : "Retiro registrado",
        "success"
      );
    } catch (error) {
      if (errorElement) errorElement.textContent = errorMessage(error, "No se pudo registrar");
    } finally {
      operationInProgress = false;
      if (button) {
        button.disabled = false;
        button.textContent = "Registrar";
      }
    }
  }

  async function openRegister(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const cashRegisterId = context().cashRegister.id;
    if (operationInProgress || !cashRegisterId) return;
    operationInProgress = true;
    const errorElement = queryOne("#cash-opening-error-v227");
    if (errorElement) errorElement.textContent = "";
    const button = event.submitter instanceof HTMLButtonElement ? event.submitter : null;
    if (button) {
      button.disabled = true;
      button.textContent = "Abriendo...";
    }
    try {
      state = await openCashRegister(
        dependencies.client,
        cashRegisterId,
        number(field("#cash-opening-fund-v227")?.value),
        nullableTrimmed(field("#cash-opening-note-v227")?.value)
      );
      renderHeader();
      await renderPanel();
      await renderHistory();
      dependencies.showToast("Caja abierta", "success");
    } catch (error) {
      if (errorElement) errorElement.textContent = errorMessage(error, "No se pudo abrir la caja");
    } finally {
      operationInProgress = false;
      if (button) {
        button.disabled = false;
        button.textContent = "Abrir caja";
      }
    }
  }

  function updateClosePreview(): void {
    const expected = number(session()?.efectivo_esperado);
    const declared = number(field("#cash-close-declared-v227")?.value);
    const difference = declared - expected;
    const element = queryOne("#cash-difference-preview-v227");
    if (!element) return;
    element.classList.remove("positive", "negative", "neutral");
    element.classList.add(Math.abs(difference) < 0.005 ? "neutral" : difference > 0 ? "positive" : "negative");
    element.textContent = `Diferencia: ${difference > 0 ? "+" : ""}${dependencies.formatCurrency(difference)}`;
  }

  function openCloseDialog(): void {
    const currentSession = session();
    if (!currentSession) return;
    const expected = number(currentSession.efectivo_esperado);
    const expectedElement = queryOne("#cash-close-expected-v227");
    const declared = field("#cash-close-declared-v227");
    const note = field("#cash-close-note-v227");
    const error = queryOne("#cash-close-error-v227");
    if (expectedElement) expectedElement.textContent = dependencies.formatCurrency(expected);
    if (declared) declared.value = expected.toFixed(2);
    if (note) note.value = "";
    if (error) error.textContent = "";
    updateClosePreview();
    queryOne("#modal-cash-close-v227")?.classList.remove("hidden");
  }

  function closeCloseDialog(): void {
    queryOne("#modal-cash-close-v227")?.classList.add("hidden");
  }

  async function closeRegister(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const cashRegisterId = context().cashRegister.id;
    if (operationInProgress || !cashRegisterId) return;
    operationInProgress = true;
    const errorElement = queryOne("#cash-close-error-v227");
    if (errorElement) errorElement.textContent = "";
    const button = event.submitter instanceof HTMLButtonElement ? event.submitter : null;
    if (button) {
      button.disabled = true;
      button.textContent = "Cerrando...";
    }
    try {
      const result = await closeCashRegister(
        dependencies.client,
        cashRegisterId,
        number(field("#cash-close-declared-v227")?.value),
        nullableTrimmed(field("#cash-close-note-v227")?.value)
      );
      const closedSession = nestedRecord(result.sesion);
      closeCloseDialog();
      await loadState();
      await renderPanel();
      await renderHistory();
      const difference = number(closedSession?.diferencia);
      dependencies.showToast(
        Math.abs(difference) < 0.005
          ? "Caja cerrada sin diferencias"
          : `Caja cerrada · diferencia ${difference > 0 ? "+" : ""}${dependencies.formatCurrency(difference)}`,
        Math.abs(difference) < 0.005 ? "success" : "info"
      );
    } catch (error) {
      if (errorElement) errorElement.textContent = errorMessage(error, "No se pudo cerrar la caja");
    } finally {
      operationInProgress = false;
      if (button) {
        button.disabled = false;
        button.textContent = "Cerrar caja";
      }
    }
  }

  async function renderHistory(): Promise<void> {
    const container = queryOne("#cash-history-v227");
    const branchId = context().branch.id;
    if (!container || !branchId) return;
    try {
      const history = await listCashHistory(dependencies.client, branchId, 12);
      if (!history.length) {
        container.innerHTML = '<p class="cash-no-movements-v227">Todavía no hay cierres registrados.</p>';
        return;
      }
      container.innerHTML = history.map((item) => {
        const difference = number(item.diferencia);
        return `<div class="cash-history-row-v227"><div class="cash-history-main-v227"><strong>${
          escapeHtml(text(item.caja_nombre))
        } · ${escapeHtml(text(item.usuario_nombre))}</strong><small>${
          escapeHtml(formatDateTime(item.cerrada_en))
        } · ${String(number(item.tickets))} tickets</small></div><div class="cash-history-sales-v227"><span>Ventas</span><strong>${
          dependencies.formatCurrency(number(item.ventas_total))
        }</strong></div><div class="cash-history-diff-v227 ${
          Math.abs(difference) < 0.005 ? "zero" : difference > 0 ? "positive" : "negative"
        }"><span>Diferencia</span><strong>${difference > 0 ? "+" : ""}${
          dependencies.formatCurrency(difference)
        }</strong></div></div>`;
      }).join("");
    } catch {
      container.innerHTML = '<p class="hint">No se pudo cargar el historial.</p>';
    }
  }

  async function renderPanel(): Promise<void> {
    const container = queryOne("#cash-current-v227");
    if (!container) return;
    const current = context();
    if (!current.cashRegister.id) {
      container.innerHTML = '<div class="cash-empty-v227">No hay una caja activa.</div>';
      return;
    }
    const currentSession = session();
    if (!currentSession) {
      container.innerHTML = `<section class="cash-status-card-v227 closed"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 closed"></span><div><strong>Caja cerrada</strong><small>${
        escapeHtml(current.cashRegister.name)
      }</small></div></div><form id="form-open-cash-v227" class="cash-open-form-v227"><div class="form-group"><label for="cash-opening-fund-v227">Fondo inicial</label><input type="number" id="cash-opening-fund-v227" value="0" min="0" step="0.01" required/><small class="hint">Efectivo físico antes de empezar.</small></div><div class="form-group"><label for="cash-opening-note-v227">Nota</label><input id="cash-opening-note-v227" maxlength="200" placeholder="Opcional"/></div><span class="field-error" id="cash-opening-error-v227"></span><button type="submit" class="btn btn-primary btn-lg">Abrir caja</button></form></section>`;
      queryOne("#form-open-cash-v227")?.addEventListener("submit", (event) => {
        void openRegister(event as SubmitEvent);
      });
      return;
    }
    if (!state?.es_mia) {
      container.innerHTML = `<section class="cash-status-card-v227 busy"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 busy"></span><div><strong>Caja en uso</strong><small>Abierta por ${
        escapeHtml(text(currentSession.usuario_nombre, "otro usuario"))
      }</small></div></div><p class="cash-busy-copy-v227">Seleccioná otra caja o esperá el cierre del turno.</p>${
        state?.puede_supervisar
          ? '<button type="button" class="btn btn-secondary" id="btn-supervisor-close-v227">Cerrar como supervisor</button>'
          : ""
      }</section>`;
      queryOne("#btn-supervisor-close-v227")?.addEventListener("click", openCloseDialog);
      return;
    }
    container.innerHTML = `<section class="cash-status-card-v227 open"><div class="cash-open-head-v227"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 open"></span><div><strong>Turno abierto</strong><small>Desde ${
      escapeHtml(formatDateTime(currentSession.abierta_en))
    }</small></div></div><button type="button" class="btn btn-danger btn-sm" id="btn-open-cash-close-v227">Cerrar caja</button></div><div class="cash-summary-grid-v227"><div class="cash-summary-item-v227"><span>Ventas</span><strong>${
      dependencies.formatCurrency(number(currentSession.ventas_total))
    }</strong><small>${String(number(currentSession.tickets))} tickets</small></div><div class="cash-summary-item-v227"><span>Efectivo vendido</span><strong>${
      dependencies.formatCurrency(number(currentSession.ventas_efectivo))
    }</strong><small>Ventas en efectivo</small></div><div class="cash-summary-item-v227"><span>Ingresos</span><strong class="positive">${
      dependencies.formatCurrency(number(currentSession.ingresos_total))
    }</strong><small>Movimientos manuales</small></div><div class="cash-summary-item-v227"><span>Retiros</span><strong class="negative">${
      dependencies.formatCurrency(number(currentSession.retiros_total))
    }</strong><small>Salidas manuales</small></div><div class="cash-summary-item-v227 featured"><span>Efectivo esperado</span><strong>${
      dependencies.formatCurrency(number(currentSession.efectivo_esperado))
    }</strong><small>Incluye fondo inicial</small></div></div><div class="cash-actions-v227"><button type="button" class="btn btn-secondary" data-cash-movement="ingreso">＋ Ingreso</button><button type="button" class="btn btn-secondary" data-cash-movement="retiro">− Retiro</button></div><div class="cash-movements-section-v227"><div class="cash-section-head-v227"><div><h3>Movimientos</h3><p>Ingresos y retiros del turno.</p></div></div><div id="cash-movements-v227" class="cash-movements-v227"></div></div></section>`;
    queryOne("#btn-open-cash-close-v227")?.addEventListener("click", openCloseDialog);
    queryAll("[data-cash-movement]", container).forEach((button) => {
      button.addEventListener("click", () => {
        openMovement(button.getAttribute("data-cash-movement") ?? "");
      });
    });
    await renderMovements();
  }

  async function openPanel(): Promise<void> {
    const current = context();
    if (!current.cashRegister.id) {
      dependencies.showToast("Esta sucursal no tiene una caja activa", "error");
      return;
    }
    await loadState();
    await renderPanel();
    await renderHistory();
    const label = queryOne("#cash-context-v227");
    if (label) label.textContent = `${current.branch.name || "Sucursal"} · ${current.cashRegister.name || "Caja"}`;
    queryOne("#modal-caja-operativa-v227")?.classList.remove("hidden");
  }

  function closePanel(): void {
    queryOne("#modal-caja-operativa-v227")?.classList.add("hidden");
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#cash-selector-v227")?.addEventListener("change", (event) => {
      const target = event.target;
      if (target instanceof HTMLSelectElement) void selectRegister(target.value);
    });
    queryOne("#btn-caja-v227")?.addEventListener("click", () => void openPanel());
    queryOne("#btn-cerrar-caja-panel-v227")?.addEventListener("click", closePanel);
    queryOne("#modal-caja-operativa-v227 .modal-backdrop")?.addEventListener("click", closePanel);
    queryOne("#form-cash-movement-v227")?.addEventListener("submit", (event) => void saveMovement(event as SubmitEvent));
    queryOne("#btn-close-cash-movement-v227")?.addEventListener("click", closeMovement);
    queryOne("#btn-cancel-cash-movement-v227")?.addEventListener("click", closeMovement);
    queryOne("#modal-caja-movimiento-v227 .modal-backdrop")?.addEventListener("click", closeMovement);
    queryOne("#form-cash-close-v227")?.addEventListener("submit", (event) => void closeRegister(event as SubmitEvent));
    queryOne("#btn-close-cash-close-v227")?.addEventListener("click", closeCloseDialog);
    queryOne("#btn-cancel-cash-close-v227")?.addEventListener("click", closeCloseDialog);
    queryOne("#modal-cash-close-v227 .modal-backdrop")?.addEventListener("click", closeCloseDialog);
    queryOne("#cash-close-declared-v227")?.addEventListener("input", updateClosePreview);
  }

  return Object.freeze({
    setup,
    initialize: () => loadRegisters(),
    loadRegisters,
    selectRegister,
    loadState,
    getState: () => state,
    setState,
    getRegisters: () => [...registers],
    isOpenByCurrentUser,
    renderOptions,
    renderHeader,
    renderPanel,
    openPanel
  });
}
