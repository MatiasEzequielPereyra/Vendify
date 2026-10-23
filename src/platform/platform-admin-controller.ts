import { escapeHtml } from "../core/dom.js";
import { dashboardEmpty, renderDashboardRows } from "../dashboard/dashboard-ui.js";
import { isPlatformAdmin, loadPlatformSummary, updateBusinessPlan, type PlatformRpcClientPort } from "./platform-service.js";
import { listPlatformBusinesses } from "./business-read-service.js";
import { normalizeBusinessListInput, parseBusinessId, type BusinessCursor, type BusinessListInput, type BusinessQuery, type PlatformBusiness } from "./business-read-model.js";

type ToastType = "error" | "info" | "success";
interface PlatformDocumentPort { querySelector(selector: string): Element | null; }
export interface PlatformAdminControllerDependencies {
  readonly client: PlatformRpcClientPort;
  readonly isOnline: () => boolean;
  readonly getSessionKey?: () => string | null;
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
  readonly setQuery: (input: BusinessListInput) => Promise<void>;
  readonly nextPage: () => Promise<void>;
  readonly previousPage: () => Promise<void>;
}
const plans = ["legacy", "trial", "starter", "pro", "business"];
const states = ["legacy", "trial", "activo", "vencido", "suspendido"];
function numberValue(value: unknown): number { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function textValue(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function attribute(value: string): string { return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function options(values: readonly string[], selected: string | null): string {
  return values.map((value) => `<option value="${attribute(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
}
function resource(used: number, limit: number | null | undefined): string {
  const label = limit === undefined ? "sin límite informado" : String(limit ?? "sin límite");
  return `${String(used)} / ${label}`;
}
export function createPlatformAdminController(dependencies: PlatformAdminControllerDependencies): PlatformAdminController {
  const documentRef = dependencies.document ?? globalThis.document;
  const query = (selector: string): HTMLElement | null => documentRef.querySelector(selector) as HTMLElement | null;
  const session = (): string | null => dependencies.getSessionKey?.() ?? null;
  let epoch = 0;
  let setupComplete = false;
  let visible = false;
  let busy = false;
  let saving = false;
  let authorized = false;
  let owner: string | null = null;
  let messageState: string | undefined;
  let filter: BusinessQuery = { search: null, plan_codigo: null, estado: null };
  let cursor: BusinessCursor | null = null;
  let next: BusinessCursor | null = null;
  let history: (BusinessCursor | null)[] = [];
  let rows: readonly PlatformBusiness[] = [];

  function clearPrivate(): void {
    rows = [];
    next = null;
    for (const selector of ["#platform-business-list-v231", "#platform-error-list-v231"]) {
      const node = query(selector); if (node) node.innerHTML = "";
    }
    for (const selector of ["#platform-businesses-v231", "#platform-trials-v231", "#platform-sales-v231", "#platform-errors-v231"]) {
      const node = query(selector); if (node) node.textContent = "—";
    }
  }
  function current(request: number, identity: string | null): boolean {
    if (request !== epoch) return false;
    if (session() !== identity || !dependencies.isOnline()) {
      ++epoch;
      busy = false;
      unavailable("La sesión o la conexión cambió. Volvé a abrir la administración.");
      return false;
    }
    return true;
  }
  function unavailable(message: string): void {
    authorized = false;
    clearPrivate();
    query("#btn-platform-admin-v231")?.classList.add("hidden");
    renderBusinesses(message);
  }
  function controls(): string {
    return `<form data-platform-search-form>
      <label>Buscar negocio <input name="search" data-platform-search type="search" maxlength="120" value="${attribute(filter.search ?? "")}" placeholder="Nombre o identificador"></label>
      <label>Plan <input name="plan" data-platform-plan-filter type="text" value="${attribute(filter.plan_codigo ?? "")}" maxlength="50" placeholder="Todos"></label>
      <label>Estado <select name="state" data-platform-state-filter><option value="">Todos</option>${options(states, filter.estado)}</select></label>
      <button type="submit" class="btn btn-secondary btn-sm" ${busy || saving ? "disabled" : ""}>Buscar</button>
      <button type="button" class="btn btn-secondary btn-sm" data-platform-refresh ${busy || saving ? "disabled" : ""}>Actualizar</button>
    </form>`;
  }
  function renderBusinesses(message?: string): void {
    messageState = message;
    const list = query("#platform-business-list-v231");
    if (!list) return;
    list.innerHTML = controls() + `<div role="status" aria-live="polite">${message ? escapeHtml(message) : `Página ${String(history.length + 1)} · ${String(rows.length)} negocio(s)`}</div>` + (rows.length ? rows.map((row) => {
      const sub = row.suscripcion;
      const plan = sub?.plan_codigo ?? "";
      const state = sub?.estado ?? "";
      const availablePlans = plan && !plans.includes(plan) ? [plan, ...plans] : plans;
      return `<div class="platform-business-row-v231" data-platform-business="${row.id}">
        <span class="dashboard-list-icon-v231">${dependencies.icon("store")}</span>
        <div class="dashboard-list-copy-v231"><strong>${escapeHtml(row.nombre)}</strong>
          <small>${row.activo ? "Negocio activo" : "Negocio inactivo"} · ${sub ? `${escapeHtml(sub.plan_nombre)} · ${escapeHtml(sub.estado)}` : "Sin suscripción"}</small>
          <small>Usuarios: ${resource(row.uso.usuarios, sub?.limites.usuarios)} · Sucursales: ${resource(row.uso.sucursales, sub?.limites.sucursales)} · Productos: ${resource(row.uso.productos, sub?.limites.productos)}</small>
          ${sub?.trial_hasta ? `<small>Prueba hasta ${escapeHtml(new Date(sub.trial_hasta).toLocaleDateString("es-AR"))}</small>` : ""}
        </div>
        <div class="platform-plan-controls-v231">
          <select class="platform-plan-select-v231" aria-label="Plan del negocio"><option value="">Seleccionar plan</option>${options(availablePlans, plan)}</select>
          <select class="platform-state-select-v231" aria-label="Estado de suscripción"><option value="">Seleccionar estado</option>${options(states, state)}</select>
          <button type="button" class="btn btn-secondary btn-sm" data-platform-save-plan="${row.id}" ${busy || saving ? "disabled" : ""}>Guardar</button>
        </div></div>`;
    }).join("") : dashboardEmpty(message ?? "No hay negocios para esta búsqueda.")) + `<div>
      <button type="button" class="btn btn-secondary btn-sm" data-platform-previous ${busy || !history.length ? "disabled" : ""}>Anterior</button>
      <button type="button" class="btn btn-secondary btn-sm" data-platform-next ${busy || !next ? "disabled" : ""}>Siguiente</button>
    </div>`;
  }
  function renderErrors(value: unknown): void {
    renderDashboardRows(query("#platform-error-list-v231"), value, (row) => `<div class="platform-error-row-v231"><span class="dashboard-list-icon-v231">${dependencies.icon("alert")}</span><div class="dashboard-list-copy-v231"><strong>${escapeHtml(textValue(row.mensaje, "Error"))}</strong><small>${escapeHtml(textValue(row.negocio_nombre, "Negocio"))} · ${escapeHtml(textValue(row.version, "sin versión"))}</small></div><span class="platform-status-v231">${escapeHtml(textValue(row.tipo, "client"))}</span></div>`, "No hay errores recientes.");
  }
  async function refreshAccess(): Promise<void> {
    const request = ++epoch;
    const identity = session();
    authorized = false;
    busy = false;
    clearPrivate();
    query("#btn-platform-admin-v231")?.classList.add("hidden");
    if (!dependencies.isOnline()) { if (visible) renderBusinesses("Sin conexión. Conectate y volvé a intentar."); return; }
    try {
      const admin = await isPlatformAdmin(dependencies.client);
      if (!current(request, identity)) return;
      authorized = admin;
      owner = identity;
      query("#btn-platform-admin-v231")?.classList.toggle("hidden", !admin);
      if (admin && visible) await load();
      if (!admin && visible) unavailable("No tenés acceso a la administración de plataforma.");
    } catch { if (current(request, identity)) unavailable("No se pudo verificar tu acceso. Volvé a intentar."); }
  }
  function close(): void {
    ++epoch;
    visible = false;
    authorized = false;
    busy = false;
    clearPrivate();
    query("#modal-platform-admin-v231")?.classList.add("hidden");
  }
  async function load(): Promise<void> {
    const request = ++epoch;
    const identity = session();
    busy = true;
    authorized = false;
    clearPrivate();
    renderBusinesses("Cargando negocios...");
    if (!dependencies.isOnline()) { busy = false; unavailable("Sin conexión. Conectate y volvé a intentar."); return; }
    try {
      if (!await isPlatformAdmin(dependencies.client)) throw new Error("access");
      if (!current(request, identity)) return;
      const [page, summary] = await Promise.all([
        listPlatformBusinesses(dependencies.client, { search: filter.search, planCode: filter.plan_codigo, state: filter.estado, cursor, limit: 50 }),
        loadPlatformSummary(dependencies.client)
      ]);
      if (!current(request, identity)) return;
      rows = page.items;
      next = page.next_cursor;
      authorized = true;
      owner = identity;
      busy = false;
      query("#btn-platform-admin-v231")?.classList.remove("hidden");
      for (const [selector, value] of [["#platform-businesses-v231", String(numberValue(summary.overview.negocios))], ["#platform-trials-v231", String(numberValue(summary.overview.trials))], ["#platform-sales-v231", dependencies.formatPrice(numberValue(summary.overview.ventas_hoy))], ["#platform-errors-v231", String(numberValue(summary.overview.errores_24h))]]) {
        const node = selector ? query(selector) : null; if (node && value !== undefined) node.textContent = value;
      }
      renderBusinesses();
      renderErrors(summary.errors);
    } catch {
      if (!current(request, identity)) return;
      busy = false;
      unavailable("No se pudieron cargar los negocios. Verificá tu acceso y volvé a intentar.");
    }
  }
  async function open(): Promise<void> {
    visible = true;
    query("#modal-platform-admin-v231")?.classList.remove("hidden");
    history = []; cursor = null;
    await load();
  }
  async function setQuery(input: BusinessListInput): Promise<void> {
    if (saving) return;
    try { filter = normalizeBusinessListInput(input).query; }
    catch { dependencies.showToast("Revisá la búsqueda, el plan y el estado.", "error"); return; }
    history = []; cursor = null;
    await load();
  }
  async function nextPage(): Promise<void> {
    if (busy || saving || !next) return;
    history.push(cursor); cursor = next;
    await load();
  }
  async function previousPage(): Promise<void> {
    if (busy || saving || !history.length) return;
    cursor = history.pop() ?? null;
    await load();
  }
  function renderAfterSave(): void { if (!busy && visible) renderBusinesses(messageState); }
  async function savePlan(button: HTMLButtonElement): Promise<void> {
    if (saving || busy) return;
    const row = button.closest<HTMLElement>("[data-platform-business]");
    const id = row?.dataset.platformBusiness;
    const plan = row?.querySelector<HTMLSelectElement>(".platform-plan-select-v231")?.value;
    const state = row?.querySelector<HTMLSelectElement>(".platform-state-select-v231")?.value;
    if (!row || !id || !plan || !state) { dependencies.showToast("Seleccioná un plan y un estado.", "error"); return; }
    if (!authorized || session() !== owner || !dependencies.isOnline()) { ++epoch; unavailable("Verificá tu acceso y conexión antes de guardar."); return; }
    try {
      parseBusinessId(id);
      normalizeBusinessListInput({ planCode: plan, state: state as BusinessQuery["estado"] });
      if (!rows.some((business) => business.id === id) || !states.includes(state) || (!plans.includes(plan) && rows.find((business) => business.id === id)?.suscripcion?.plan_codigo !== plan)) throw new Error("invalid");
    } catch { dependencies.showToast("El negocio, plan o estado no es válido.", "error"); return; }
    const request = epoch;
    const identity = session();
    saving = true;
    button.disabled = true;
    button.textContent = "Guardando...";
    try {
      await updateBusinessPlan(dependencies.client, id, plan, state);
      if (!current(request, identity)) return;
      dependencies.showToast("Plan actualizado", "success");
      history = []; cursor = null;
      await load();
    } catch {
      if (current(request, identity)) {
        ++epoch;
        unavailable("No se pudo actualizar el plan. Verificá tu acceso y volvé a cargar los negocios.");
        dependencies.showToast("No se pudo actualizar el plan.", "error");
      }
    } finally { saving = false; button.disabled = false; button.textContent = "Guardar"; renderAfterSave(); }
  }
  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    const events: { addEventListener?: (type: string, listener: () => void) => void } = globalThis;
    events.addEventListener?.("offline", () => {
      ++epoch;
      busy = false;
      unavailable("Sin conexión. Conectate y volvé a intentar.");
    });
    query("#btn-platform-admin-v231")?.addEventListener("click", () => { dependencies.closeUserMenu(); void open(); });
    query("#btn-close-platform-v231")?.addEventListener("click", close);
    query("#modal-platform-admin-v231 .modal-backdrop")?.addEventListener("click", close);
    query("#platform-business-list-v231")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = (event.target as Element | null)?.closest<HTMLFormElement>("[data-platform-search-form]");
      if (!form) return;
      const search = form.querySelector<HTMLInputElement>("[data-platform-search]")?.value ?? "";
      const planCode = form.querySelector<HTMLInputElement>("[data-platform-plan-filter]")?.value ?? "";
      const state = form.querySelector<HTMLSelectElement>("[data-platform-state-filter]")?.value ?? "";
      void setQuery({ search, planCode: planCode === "" ? null : planCode, state: (state === "" ? null : state) as BusinessQuery["estado"] });
    });
    query("#platform-business-list-v231")?.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const button = target?.closest<HTMLButtonElement>("[data-platform-save-plan]");
      if (button) { void savePlan(button); return; }
      if (target?.closest("[data-platform-next]")) void nextPage();
      if (target?.closest("[data-platform-previous]")) void previousPage();
      if (!saving && target?.closest("[data-platform-refresh]")) { history = []; cursor = null; void load(); }
    });
  }
  return Object.freeze({ setup, refreshAccess, open, close, savePlan, setQuery, nextPage, previousPage });
}
