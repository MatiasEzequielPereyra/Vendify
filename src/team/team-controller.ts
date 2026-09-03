import { escapeHtml, queryOne } from "../core/dom.js";
import { normalizeInternalLogin } from "../auth/credentials.js";
import {
  createEmployee,
  deleteEmployee,
  resetEmployeePassword,
  updateEmployee,
  type TeamFunctionsClientPort
} from "./team-edge-service.js";
import {
  getAdminBusiness,
  listTeam,
  setMemberActive,
  updateMemberRole,
  updateStockPermission,
  type TeamMemberRecord,
  type TeamRpcClientPort
} from "./team-service.js";

interface TeamContext {
  readonly user?: { readonly id?: string | null } | null;
  readonly membership?: { readonly role?: string | null } | null;
}

export interface TeamControllerDependencies {
  readonly client: TeamRpcClientPort;
  readonly functions: TeamFunctionsClientPort;
  readonly getContext: () => TeamContext;
  readonly requirePermission: (permission: string, message: string) => boolean;
  readonly showToast: (message: string, type?: "error" | "info" | "success") => void;
  readonly confirm: (title: string, message: string) => Promise<boolean>;
  readonly roleName: (role: string) => string;
}

export interface TeamController {
  readonly setup: () => void;
  readonly open: () => Promise<void>;
  readonly close: () => void;
  readonly render: () => Promise<void>;
  readonly closeEditor: () => void;
  readonly closePasswordReset: () => void;
}

type TeamField = HTMLInputElement | HTMLSelectElement;

function field(selector: string): TeamField | null {
  const element = queryOne(selector);
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement
    ? element
    : null;
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function memberValue(member: TeamMemberRecord, key: string): unknown {
  return member[key];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function generateTemporaryPassword(): string {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const values = new Uint32Array(12);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => characters[value % characters.length]).join("");
}

export function renderTeamMembers(
  members: TeamMemberRecord[],
  currentUserId: string | null,
  currentRole: string
): string {
  return members.map((member) => {
    const owner = member.rol === "owner";
    const currentUser = text(memberValue(member, "user_id")) === currentUserId;
    const usernameValue = text(memberValue(member, "username"));
    const name = text(memberValue(member, "nombre"));
    const email = text(memberValue(member, "email"));
    const active = memberValue(member, "activo") === true;
    const canManageStock = memberValue(member, "puede_gestionar_stock") === true;
    const username = usernameValue
      ? `<span class="employee-username-badge">@${escapeHtml(usernameValue)}</span>`
      : '<span class="employee-username-badge">Email</span>';

    const roleControl = owner
      ? '<span class="equipo-role-owner">Propietario</span>'
      : `
        <select class="select equipo-role-select" data-membership-id="${escapeHtml(member.membership_id)}" ${currentUser ? "disabled" : ""}>
          <option value="cashier" ${member.rol === "cashier" ? "selected" : ""}>Cajero</option>
          <option value="manager" ${member.rol === "manager" ? "selected" : ""}>Encargado</option>
          <option value="admin" ${member.rol === "admin" ? "selected" : ""}>Administrador</option>
        </select>`;

    const actions = !owner && !currentUser
      ? `
         <button class="btn btn-ghost btn-sm"
                 data-equipo-action="edit-member"
                 data-id="${escapeHtml(member.membership_id)}"
                 data-nombre="${escapeHtml(name)}"
                 data-username="${escapeHtml(usernameValue)}"
                 data-rol="${escapeHtml(member.rol)}"
                 data-stock="${canManageStock ? "1" : "0"}">
           Editar
         </button>
         <button class="btn btn-ghost btn-sm"
                 data-equipo-action="reset-password"
                 data-id="${escapeHtml(member.membership_id)}"
                 data-nombre="${escapeHtml(name || usernameValue || "Empleado")}">
           Reiniciar clave
         </button>
         <button class="btn ${active ? "btn-ghost" : "btn-secondary"} btn-sm"
                 data-equipo-action="toggle-member"
                 data-id="${escapeHtml(member.membership_id)}"
                 data-activo="${active ? "0" : "1"}">
            ${active ? "Desactivar" : "Activar"}
         </button>
         ${currentRole === "owner" ? `
           <button class="btn btn-danger btn-sm"
                   data-equipo-action="delete-member"
                   data-id="${escapeHtml(member.membership_id)}"
                   data-nombre="${escapeHtml(name || usernameValue || "Empleado")}">
             Eliminar
           </button>` : ""}`
      : "";

    return `
      <div class="equipo-item">
        <div class="equipo-persona">
          <div class="equipo-email">${escapeHtml(name || email || "Usuario")}${currentUser ? " · Vos" : ""}</div>
          <div class="equipo-meta">
            ${username}
            <span class="equipo-status ${active ? "active" : "inactive"}">${active ? "Activo" : "Inactivo"}</span>
            ${
              owner
                ? '<span class="equipo-permission-badge-v23014 enabled">Stock manual</span>'
                : `<span class="equipo-permission-badge-v23014 ${canManageStock ? "enabled" : "disabled"}">
                    Stock manual: ${canManageStock ? "Sí" : "No"}
                  </span>`
            }
          </div>
        </div>
        <div>${roleControl}</div>
        <div class="equipo-actions">${actions}</div>
      </div>`;
  }).join("");
}

export function createTeamController(
  dependencies: TeamControllerDependencies
): TeamController {
  let setupComplete = false;

  function context(): TeamContext {
    return dependencies.getContext();
  }

  function ownerCanSetStock(): boolean {
    return context().membership?.role === "owner";
  }

  async function members(): Promise<TeamMemberRecord[]> {
    const result = await listTeam(dependencies.client);
    if (result.stockPermissionWarning) {
      console.warn("[Equipo] permisos stock no disponibles:", result.stockPermissionWarning);
    }
    return result.members;
  }

  async function setStockPermission(membershipId: string, allow: boolean): Promise<unknown> {
    const result = await updateStockPermission(dependencies.client, membershipId, allow);
    if (!result.ok) {
      throw new Error(result.errorMessage ?? "No se pudo actualizar el permiso de stock");
    }
    return result.data;
  }

  async function open(): Promise<void> {
    if (!dependencies.requirePermission(
      "manageEmployees",
      "No tenés permiso para administrar el equipo"
    )) return;

    const allowStock = ownerCanSetStock();
    const permission = field("#equipo-permiso-stock");
    if (permission instanceof HTMLInputElement) permission.disabled = !allowStock;
    queryOne("#equipo-permiso-stock-hint")?.classList.toggle("hidden", allowStock);
    queryOne("#modal-equipo")?.classList.remove("hidden");

    try {
      const business = await getAdminBusiness(dependencies.client);
      const code = typeof business === "object" && business !== null
        ? text((business as Record<string, unknown>).codigo_acceso, "—")
        : "—";
      const codeElement = queryOne("#equipo-business-code");
      if (codeElement) codeElement.textContent = code || "—";
    } catch (error) {
      dependencies.showToast(errorMessage(error, "No se pudo cargar el negocio"), "error");
    }
    await render();
  }

  function close(): void {
    queryOne("#modal-equipo")?.classList.add("hidden");
  }

  async function render(): Promise<void> {
    const list = queryOne("#equipo-lista");
    if (!list) return;
    list.innerHTML = '<p class="hint" style="text-align:center;padding:1rem;">Cargando equipo...</p>';

    try {
      const people = await members();
      list.innerHTML = renderTeamMembers(
        people,
        context().user?.id ?? null,
        context().membership?.role ?? "cashier"
      );
    } catch (error) {
      list.innerHTML = "";
      dependencies.showToast(errorMessage(error, "No se pudo cargar el equipo"), "error");
    }
  }

  async function createFromForm(event: Event): Promise<void> {
    event.preventDefault();
    if (!dependencies.requirePermission(
      "manageEmployees",
      "No tenés permiso para crear empleados"
    )) return;

    const nameField = field("#equipo-nombre");
    const usernameField = field("#equipo-username");
    const roleField = field("#equipo-rol");
    const passwordField = field("#equipo-password");
    const errorElement = queryOne("#equipo-error");
    const button = queryOne("#btn-crear-empleado");
    if (
      !(nameField instanceof HTMLInputElement) ||
      !(usernameField instanceof HTMLInputElement) ||
      !(roleField instanceof HTMLSelectElement) ||
      !(passwordField instanceof HTMLInputElement) ||
      !errorElement ||
      !(button instanceof HTMLButtonElement)
    ) return;

    const name = nameField.value.trim();
    const username = normalizeInternalLogin(usernameField.value);
    const role = roleField.value;
    const password = passwordField.value;
    const permission = field("#equipo-permiso-stock");
    const requestedStock = ownerCanSetStock() &&
      permission instanceof HTMLInputElement && permission.checked;

    errorElement.textContent = "";
    button.disabled = true;
    button.textContent = "Creando...";
    const result = await createEmployee(
      dependencies.functions,
      { nombre: name, username, rol: role, password }
    );
    button.disabled = false;
    button.textContent = "Crear empleado";

    if (!result.ok) {
      errorElement.textContent = result.errorMessage ?? "No se pudo crear el empleado";
      return;
    }

    if (ownerCanSetStock()) {
      try {
        const created = (await members()).find(
          (person) => text(memberValue(person, "username")).toLowerCase() === username.toLowerCase()
        );
        if (created) await setStockPermission(created.membership_id, requestedStock);
      } catch (error) {
        console.error("[Equipo] empleado creado, permiso stock pendiente:", error);
        dependencies.showToast(
          "Empleado creado, pero revisá su permiso de stock desde Editar",
          "info"
        );
      }
    }

    nameField.value = "";
    usernameField.value = "";
    passwordField.value = "";
    if (permission instanceof HTMLInputElement) permission.checked = false;
    dependencies.showToast(`Empleado @${username} creado`, "success");
    await render();
  }

  async function changeRole(select: HTMLSelectElement): Promise<void> {
    const membershipId = select.dataset.membershipId ?? "";
    select.disabled = true;
    const result = await updateMemberRole(dependencies.client, membershipId, select.value);
    select.disabled = false;
    if (!result.ok) {
      dependencies.showToast(result.errorMessage ?? "No se pudo actualizar el rol", "error");
      await render();
      return;
    }
    dependencies.showToast(`Rol actualizado a ${dependencies.roleName(select.value)}`, "success");
  }

  async function changeActive(button: HTMLElement): Promise<void> {
    const active = button.dataset.activo === "1";
    const result = await setMemberActive(dependencies.client, button.dataset.id ?? "", active);
    if (!result.ok) {
      dependencies.showToast(result.errorMessage ?? "No se pudo actualizar el usuario", "error");
      return;
    }
    dependencies.showToast(active ? "Usuario activado" : "Usuario desactivado", "success");
    await render();
  }

  async function remove(button: HTMLElement): Promise<void> {
    if (!ownerCanSetStock()) {
      dependencies.showToast("Solo el propietario puede eliminar usuarios", "error");
      return;
    }
    const name = button.dataset.nombre?.trim()
      ? button.dataset.nombre
      : "este empleado";
    if (!await dependencies.confirm(
      "Eliminar usuario",
      `¿Eliminar definitivamente a ${name}? Esta acción elimina su acceso a Vendify.`
    )) return;

    const result = await deleteEmployee(dependencies.functions, button.dataset.id ?? "");
    if (!result.ok) {
      dependencies.showToast(result.errorMessage ?? "No se pudo eliminar el usuario", "error");
      return;
    }
    dependencies.showToast("Usuario eliminado definitivamente", "success");
    await render();
  }

  function openEditor(button: HTMLElement): void {
    const membershipId = field("#editar-membership-id");
    const name = field("#editar-empleado-nombre");
    const username = field("#editar-empleado-username");
    const role = field("#editar-empleado-rol");
    if (membershipId) membershipId.value = button.dataset.id ?? "";
    if (name) name.value = button.dataset.nombre ?? "";
    if (username) username.value = button.dataset.username ?? "";
    if (role) role.value = button.dataset.rol ?? "cashier";

    const permission = field("#editar-empleado-permiso-stock");
    const allowStock = ownerCanSetStock();
    if (permission instanceof HTMLInputElement) {
      permission.checked = button.dataset.stock === "1";
      permission.disabled = !allowStock;
    }
    queryOne("#editar-stock-owner-hint")?.classList.toggle("hidden", allowStock);
    const error = queryOne("#editar-empleado-error");
    if (error) error.textContent = "";
    queryOne("#modal-editar-empleado")?.classList.remove("hidden");
  }

  function closeEditor(): void {
    queryOne("#modal-editar-empleado")?.classList.add("hidden");
  }

  async function saveEditor(event: Event): Promise<void> {
    event.preventDefault();
    const membershipId = field("#editar-membership-id")?.value ?? "";
    const name = field("#editar-empleado-nombre")?.value.trim() ?? "";
    const username = normalizeInternalLogin(field("#editar-empleado-username")?.value ?? "");
    const role = field("#editar-empleado-rol")?.value ?? "cashier";
    const permission = field("#editar-empleado-permiso-stock");
    const stock = permission instanceof HTMLInputElement && permission.checked;
    const errorElement = queryOne("#editar-empleado-error");
    const button = queryOne("#btn-guardar-editar-empleado");
    if (!errorElement || !(button instanceof HTMLButtonElement)) return;

    errorElement.textContent = "";
    button.disabled = true;
    button.textContent = "Guardando...";
    const result = await updateEmployee(
      dependencies.functions,
      { membershipId, nombre: name, username, rol: role }
    );
    button.disabled = false;
    button.textContent = "Guardar cambios";

    if (!result.ok) {
      errorElement.textContent = result.errorMessage ?? "No se pudo actualizar";
      return;
    }
    if (ownerCanSetStock()) {
      try {
        await setStockPermission(membershipId, stock);
      } catch (error) {
        errorElement.textContent = errorMessage(error, "No se pudo actualizar el permiso de stock");
        return;
      }
    }
    closeEditor();
    dependencies.showToast("Empleado actualizado", "success");
    await render();
  }

  function openPasswordReset(button: HTMLElement): void {
    const membershipId = field("#reset-membership-id");
    const password = field("#reset-empleado-password");
    if (membershipId) membershipId.value = button.dataset.id ?? "";
    if (password) password.value = generateTemporaryPassword();
    const info = queryOne("#reset-empleado-info");
    const name = button.dataset.nombre?.trim()
      ? button.dataset.nombre
      : "el empleado";
    if (info) info.textContent = `Nueva contraseña para ${name}.`;
    const error = queryOne("#reset-empleado-error");
    if (error) error.textContent = "";
    queryOne("#modal-reset-empleado")?.classList.remove("hidden");
  }

  function closePasswordReset(): void {
    queryOne("#modal-reset-empleado")?.classList.add("hidden");
  }

  async function savePasswordReset(event: Event): Promise<void> {
    event.preventDefault();
    const errorElement = queryOne("#reset-empleado-error");
    if (!errorElement) return;
    errorElement.textContent = "";
    const result = await resetEmployeePassword(
      dependencies.functions,
      field("#reset-membership-id")?.value ?? "",
      field("#reset-empleado-password")?.value ?? ""
    );
    if (!result.ok) {
      errorElement.textContent = result.errorMessage ?? "No se pudo reiniciar la contraseña";
      return;
    }
    closePasswordReset();
    dependencies.showToast("Contraseña del empleado actualizada", "success");
    await render();
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#btn-equipo")?.addEventListener("click", () => { void open(); });
    queryOne("#btn-cerrar-equipo")?.addEventListener("click", close);
    queryOne("#modal-equipo .modal-backdrop")?.addEventListener("click", close);
    queryOne("#form-crear-empleado")?.addEventListener("submit", (event) => {
      void createFromForm(event);
    });

    const createPermission = field("#equipo-permiso-stock");
    const createRole = field("#equipo-rol");
    if (createPermission instanceof HTMLInputElement) {
      const allowStock = ownerCanSetStock();
      createPermission.disabled = !allowStock;
      queryOne("#equipo-permiso-stock-hint")?.classList.toggle("hidden", allowStock);
    }
    createRole?.addEventListener("change", () => {
      if (!(createPermission instanceof HTMLInputElement) || !ownerCanSetStock()) return;
      createPermission.checked = ["manager", "admin"].includes(createRole.value);
    });

    queryOne("#btn-refrescar-equipo")?.addEventListener("click", () => { void render(); });
    queryOne("#btn-generar-password")?.addEventListener("click", () => {
      const password = field("#equipo-password");
      if (password) password.value = generateTemporaryPassword();
    });
    queryOne("#btn-copy-business-code")?.addEventListener("click", () => {
      const code = queryOne("#equipo-business-code")?.textContent?.trim();
      if (code && code !== "—") {
        void navigator.clipboard.writeText(code).then(() => {
          dependencies.showToast("Código copiado", "success");
        });
      }
    });

    queryOne("#form-editar-empleado")?.addEventListener("submit", (event) => {
      void saveEditor(event);
    });
    queryOne("#btn-cerrar-editar-empleado")?.addEventListener("click", closeEditor);
    queryOne("#btn-cancelar-editar-empleado")?.addEventListener("click", closeEditor);
    queryOne("#modal-editar-empleado .modal-backdrop")?.addEventListener("click", closeEditor);

    queryOne("#form-reset-empleado")?.addEventListener("submit", (event) => {
      void savePasswordReset(event);
    });
    queryOne("#btn-cerrar-reset-empleado")?.addEventListener("click", closePasswordReset);
    queryOne("#btn-cancelar-reset-empleado")?.addEventListener("click", closePasswordReset);
    queryOne("#modal-reset-empleado .modal-backdrop")?.addEventListener("click", closePasswordReset);
    queryOne("#btn-generar-reset-password")?.addEventListener("click", () => {
      const password = field("#reset-empleado-password");
      if (password) password.value = generateTemporaryPassword();
    });

    queryOne("#equipo-lista")?.addEventListener("change", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest(".equipo-role-select")
        : null;
      if (target instanceof HTMLSelectElement) void changeRole(target);
    });
    queryOne("#equipo-lista")?.addEventListener("click", (event) => {
      const button = event.target instanceof Element
        ? event.target.closest("[data-equipo-action]")
        : null;
      if (!(button instanceof HTMLElement)) return;
      const action = button.dataset.equipoAction;
      if (action === "toggle-member") void changeActive(button);
      else if (action === "edit-member") openEditor(button);
      else if (action === "reset-password") openPasswordReset(button);
      else if (action === "delete-member") void remove(button);
    });
  }

  return Object.freeze({
    setup,
    open,
    close,
    render,
    closeEditor,
    closePasswordReset
  });
}
