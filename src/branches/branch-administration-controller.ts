import {
  createBranch,
  listAdminBranches,
  updateBranch,
  type BranchRecord
} from "./branches-service.js";
import {
  createCashRegister,
  setCashRegisterActive,
  type CashRpcClientPort
} from "../cash/cash-service.js";
import { escapeHtml } from "../core/dom.js";

type ToastType = "error" | "info" | "success";
type Schedule = (callback: () => void, delay: number) => unknown;

export interface BranchAdministrationControllerDependencies {
  readonly client: CashRpcClientPort;
  readonly getRole: () => string | null;
  readonly getCurrentBranchId: () => string | null;
  readonly refreshBranches: () => Promise<void>;
  readonly reloadCashRegisters: (
    options: { readonly keep: boolean }
  ) => Promise<void>;
  readonly showToast: (message: string, type: ToastType) => void;
  readonly document?: Document;
  readonly schedule?: Schedule;
}

export interface BranchAdministrationController {
  readonly render: () => Promise<void>;
  readonly openBranch: (branch?: BranchRecord | null) => void;
  readonly closeBranch: () => void;
  readonly openCash: (branchId: string, branchName: string) => void;
  readonly closeCash: () => void;
  readonly setup: () => void;
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback;
}

function escapeAttribute(value: unknown): string {
  return escapeHtml(text(value))
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createBranchAdministrationController(
  dependencies: BranchAdministrationControllerDependencies
): BranchAdministrationController {
  const documentRef = dependencies.document ?? document;
  const schedule =
    dependencies.schedule ??
    ((callback: () => void, delay: number): ReturnType<typeof setTimeout> =>
      setTimeout(callback, delay));

  let adminBranches: BranchRecord[] = [];
  let installed = false;

  function element(id: string): HTMLElement | null {
    return documentRef.getElementById(id);
  }

  function input(id: string): HTMLInputElement | null {
    const node = element(id);
    return node instanceof HTMLInputElement ? node : null;
  }

  function isAdmin(): boolean {
    return ["owner", "admin"].includes(dependencies.getRole() ?? "");
  }

  function closeBranch(): void {
    element("modal-sucursal-v226")?.classList.add("hidden");
  }

  function openBranch(branch: BranchRecord | null = null): void {
    const editing = Boolean(branch);

    const title = element("sucursal-modal-title-v226");
    if (title) {
      title.textContent = editing ? "Editar sucursal" : "Nueva sucursal";
    }

    const id = input("sucursal-id-v226");
    const name = input("sucursal-nombre-v226");
    const address = input("sucursal-direccion-v226");
    const phone = input("sucursal-telefono-v226");
    const active = input("sucursal-activa-v226");
    const activeRow = element("sucursal-activa-row-v226");
    const error = element("sucursal-error-v226");

    if (id) id.value = text(branch?.id);
    if (name) name.value = text(branch?.nombre);
    if (address) address.value = text(branch?.direccion);
    if (phone) phone.value = text(branch?.telefono);
    if (active) active.checked = branch ? boolean(branch.activa) : true;
    activeRow?.classList.toggle("hidden", !editing);
    if (error) error.textContent = "";

    element("modal-sucursal-v226")?.classList.remove("hidden");

    schedule(() => {
      input("sucursal-nombre-v226")?.focus();
    }, 50);
  }

  function closeCash(): void {
    element("modal-caja-v226")?.classList.add("hidden");
  }

  function openCash(branchId: string, branchName: string): void {
    const branch = input("caja-sucursal-id-v226");
    const label = element("caja-sucursal-label-v226");
    const name = input("caja-nombre-v226");
    const error = element("caja-error-v226");

    if (branch) branch.value = branchId;
    if (label) label.textContent = branchName;
    if (name) name.value = "";
    if (error) error.textContent = "";

    element("modal-caja-v226")?.classList.remove("hidden");

    schedule(() => {
      input("caja-nombre-v226")?.focus();
    }, 50);
  }

  async function render(): Promise<void> {
    const container = element("sucursales-list-v226");
    if (!container) return;

    container.innerHTML =
      '<p class="hint" style="padding:1rem;text-align:center;">Cargando sucursales...</p>';

    try {
      adminBranches = await listAdminBranches(dependencies.client);
    } catch (error) {
      adminBranches = [];
      container.innerHTML = "";
      dependencies.showToast(
        errorMessage(error, "No se pudieron cargar las sucursales"),
        "error"
      );
      return;
    }

    const admin = isAdmin();
    const currentBranchId = dependencies.getCurrentBranchId();

    container.innerHTML = adminBranches
      .map((branch) => {
        const branchId = text(branch.id);
        const branchName = text(branch.nombre);
        const active = boolean(branch.activa);
        const cashRegisters = Array.isArray(branch.cajas)
          ? branch.cajas.filter(
              (item): item is Record<string, unknown> =>
                typeof item === "object" &&
                item !== null &&
                !Array.isArray(item)
            )
          : [];

        const cashHtml = cashRegisters.length
          ? cashRegisters
              .map((cash) => {
                const cashId = text(cash.id);
                const cashActive = boolean(cash.activa);

                return `
                <div class="caja-chip-v226 ${cashActive ? "" : "inactive"}">
                  <span>${escapeHtml(text(cash.nombre))}</span>
                  ${
                    admin
                      ? `<button
                           type="button"
                           data-branch-action="toggle-box"
                           data-caja-id="${escapeAttribute(cashId)}"
                           data-activa="${cashActive ? "0" : "1"}"
                           title="${cashActive ? "Desactivar" : "Activar"}">
                           ${cashActive ? "●" : "○"}
                         </button>`
                      : ""
                  }
                </div>`;
              })
              .join("")
          : '<span class="hint">Sin cajas</span>';

        return `
        <article class="branch-card-v226 ${active ? "" : "inactive"}">
          <div class="branch-card-main-v226">
            <div class="branch-card-icon-v226">⌂</div>
            <div class="branch-card-copy-v226">
              <div class="branch-card-title-v226">
                <strong>${escapeHtml(branchName)}</strong>
                <span class="branch-status-v226 ${active ? "active" : "inactive"}">
                  ${active ? "Activa" : "Inactiva"}
                </span>
                ${
                  branchId === currentBranchId
                    ? '<span class="branch-status-v226 current">Actual</span>'
                    : ""
                }
              </div>
              <small>${escapeHtml(
                text(branch.direccion, "Sin dirección") || "Sin dirección"
              )}</small>
            </div>

            <div class="branch-stat-v226">
              <span>Stock</span>
              <strong>${String(number(branch.stock_total))}</strong>
            </div>
          </div>

          <div class="branch-cajas-v226">
            <span class="branch-cajas-label-v226">Cajas</span>
            <div class="branch-cajas-list-v226">${cashHtml}</div>
          </div>

          ${
            admin
              ? `<div class="branch-card-actions-v226">
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    data-branch-action="edit"
                    data-id="${escapeAttribute(branchId)}">
                    Editar
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    data-branch-action="add-box"
                    data-id="${escapeAttribute(branchId)}"
                    data-name="${escapeAttribute(branchName)}">
                    ＋ Caja
                  </button>
                </div>`
              : ""
          }
        </article>`;
      })
      .join("");

    container
      .querySelectorAll<HTMLElement>('[data-branch-action="edit"]')
      .forEach((button) => {
        button.addEventListener("click", () => {
          const branch = adminBranches.find(
            (item) => text(item.id) === button.dataset.id
          );
          if (branch) openBranch(branch);
        });
      });

    container
      .querySelectorAll<HTMLElement>('[data-branch-action="add-box"]')
      .forEach((button) => {
        button.addEventListener("click", () => {
          const branch = adminBranches.find(
            (item) => text(item.id) === button.dataset.id
          );

          if (branch) {
            openCash(text(branch.id), text(branch.nombre));
          }
        });
      });

    container
      .querySelectorAll<HTMLElement>('[data-branch-action="toggle-box"]')
      .forEach((button) => {
        button.addEventListener("click", () => {
          void toggleCash(button);
        });
      });
  }

  async function toggleCash(button: HTMLElement): Promise<void> {
    const cashId = button.dataset.cajaId ?? "";
    const active = button.dataset.activa === "1";

    try {
      await setCashRegisterActive(
        dependencies.client,
        cashId,
        active
      );
    } catch (error) {
      dependencies.showToast(
        errorMessage(error, "No se pudo cambiar el estado de la caja"),
        "error"
      );
      return;
    }

    await render();
    await dependencies.refreshBranches();
    await dependencies.reloadCashRegisters({ keep: true });
  }

  async function saveBranch(event: Event): Promise<void> {
    event.preventDefault();

    const id = input("sucursal-id-v226")?.value ?? "";
    const error = element("sucursal-error-v226");
    const button = element("btn-guardar-sucursal-v226");

    if (error) error.textContent = "";

    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
      button.textContent = "Guardando...";
    }

    const branchInput = {
      name: input("sucursal-nombre-v226")?.value.trim() ?? "",
      address:
        (input("sucursal-direccion-v226")?.value.trim() ?? "") === ""
          ? null
          : input("sucursal-direccion-v226")?.value.trim() ?? null,
      phone:
        (input("sucursal-telefono-v226")?.value.trim() ?? "") === ""
          ? null
          : input("sucursal-telefono-v226")?.value.trim() ?? null,
      active: input("sucursal-activa-v226")?.checked ?? true
    };

    try {
      if (id) {
        await updateBranch(
          dependencies.client,
          id,
          branchInput
        );
      } else {
        await createBranch(dependencies.client, {
          name: branchInput.name,
          address: branchInput.address,
          phone: branchInput.phone
        });
      }
    } catch (caught) {
      if (error) {
        error.textContent = errorMessage(
          caught,
          id
            ? "No se pudo actualizar la sucursal"
            : "No se pudo crear la sucursal"
        );
      }
      return;
    } finally {
      if (button instanceof HTMLButtonElement) {
        button.disabled = false;
        button.textContent = "Guardar";
      }
    }

    closeBranch();
    await dependencies.refreshBranches();
    await render();

    dependencies.showToast(
      id ? "Sucursal actualizada" : "Sucursal creada con Caja 1",
      "success"
    );
  }

  async function createCash(event: Event): Promise<void> {
    event.preventDefault();

    const error = element("caja-error-v226");
    if (error) error.textContent = "";

    try {
      await createCashRegister(
        dependencies.client,
        input("caja-sucursal-id-v226")?.value ?? "",
        input("caja-nombre-v226")?.value.trim() ?? ""
      );
    } catch (caught) {
      if (error) {
        error.textContent = errorMessage(
          caught,
          "No se pudo crear la caja"
        );
      }
      return;
    }

    closeCash();
    await render();
    await dependencies.refreshBranches();
    await dependencies.reloadCashRegisters({ keep: true });
    dependencies.showToast("Caja creada", "success");
  }

  function setup(): void {
    if (installed) return;
    installed = true;

    element("btn-nueva-sucursal-v226")?.addEventListener(
      "click",
      () => {
        openBranch();
      }
    );

    element("form-sucursal-v226")?.addEventListener(
      "submit",
      (event) => void saveBranch(event)
    );

    element("btn-cerrar-sucursal-v226")?.addEventListener(
      "click",
      closeBranch
    );

    element("btn-cancelar-sucursal-v226")?.addEventListener(
      "click",
      closeBranch
    );

    documentRef
      .querySelector("#modal-sucursal-v226 .modal-backdrop")
      ?.addEventListener("click", closeBranch);

    element("form-caja-v226")?.addEventListener(
      "submit",
      (event) => void createCash(event)
    );

    element("btn-cerrar-caja-v226")?.addEventListener(
      "click",
      closeCash
    );

    element("btn-cancelar-caja-v226")?.addEventListener(
      "click",
      closeCash
    );

    documentRef
      .querySelector("#modal-caja-v226 .modal-backdrop")
      ?.addEventListener("click", closeCash);

    documentRef
      .querySelector('[data-config-tab="sucursales"]')
      ?.addEventListener("click", () => void render());

    documentRef
      .querySelector('[data-config-go="sucursales"]')
      ?.addEventListener("click", () => void render());
  }

  return Object.freeze({
    render,
    openBranch,
    closeBranch,
    openCash,
    closeCash,
    setup
  });
}