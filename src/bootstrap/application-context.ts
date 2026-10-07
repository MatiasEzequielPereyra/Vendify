import type {
  ContextRecord,
  ContextRpcClientPort
} from "../context/context-service.js";

export interface ApplicationUserRecord extends ContextRecord {
  readonly id?: string | null;
  readonly email?: string | null;
}

export interface ApplicationNamedRecord extends ContextRecord {
  readonly id?: string | null;
  readonly nombre?: string | null;
}

export interface ApplicationMembershipRecord extends ContextRecord {
  readonly role?: string | null;
}

export interface ApplicationEmployeeRecord extends ContextRecord {
  readonly nombre?: string | null;
  readonly username?: string | null;
}

export interface ApplicationContextState {
  user: ApplicationUserRecord | null;
  business: ApplicationNamedRecord | null;
  membership: ApplicationMembershipRecord | null;
  branch: ApplicationNamedRecord | null;
  cashRegister: ApplicationNamedRecord | null;
  permissions: Record<string, boolean>;
  employee: ApplicationEmployeeRecord | null;
  ready: boolean;
  offlineMode?: boolean;
  savedAt?: string;
}

export interface ApplicationContextSession {
  readonly user?: {
    readonly id?: string | null;
    readonly email?: string | null;
  } | null;
}

export interface ApplicationContextDependencies {
  readonly client: ContextRpcClientPort;
  readonly getApp: (client: ContextRpcClientPort) => Promise<ContextRecord>;
  readonly getPermissions: (client: ContextRpcClientPort) => Promise<ContextRecord>;
  readonly getEmployee: (client: ContextRpcClientPort) => Promise<ContextRecord>;
  readonly getSession: () => ApplicationContextSession | null;
  readonly showToast: (
    message: string,
    type?: "error" | "info" | "success"
  ) => void;
  readonly setConnectionState: (state: string, label?: string | null) => void;
  readonly storage?: Storage;
  readonly document?: Document;
  readonly logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface ApplicationContextAdapter {
  readonly get: () => ApplicationContextState;
  readonly setBranchAndCash: (
    branch: ContextRecord | null,
    cashRegister: ContextRecord | null
  ) => void;
  readonly setCashRegister: (cashRegister: ContextRecord | null) => void;
  readonly load: () => Promise<ApplicationContextState>;
  readonly clear: () => void;
  readonly hasPermission: (permission: string) => boolean;
  readonly requirePermission: (permission: string, message?: string) => boolean;
  readonly updateUi: () => void;
  readonly applyPermissions: () => void;
  readonly roleName: (role: string | null | undefined) => string;
  readonly persistOffline: () => void;
  readonly loadOffline: () => ApplicationContextState | null;
}

const CONTEXT_PREFIX = "vendify_context_v231";

function recordOrNull<T extends ContextRecord>(
  value: unknown
): T | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as T
    : null;
}

function booleanPermissions(value: unknown): Record<string, boolean> {
  const record = recordOrNull<ContextRecord>(value);
  if (!record) return {};

  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")
  );
}

function emptyContext(): ApplicationContextState {
  return {
    user: null,
    business: null,
    membership: null,
    branch: null,
    cashRegister: null,
    permissions: {},
    employee: null,
    ready: false
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function createApplicationContextAdapter(
  dependencies: ApplicationContextDependencies
): ApplicationContextAdapter {
  const storage = dependencies.storage ?? globalThis.localStorage;
  const documentRef = dependencies.document ?? globalThis.document;
  const logger = dependencies.logger ?? console;
  let context = emptyContext();

  const publish = (): void => {
    window.appContext = context;
  };

  const roleName = (role: string | null | undefined): string => {
    const names: Readonly<Record<string, string>> = {
      owner: "Propietario",
      admin: "Administrador",
      manager: "Encargado",
      cashier: "Cajero"
    };
    return names[role ?? ""] ?? role ?? "Usuario";
  };

  const hasPermission = (permission: string): boolean =>
    context.permissions[permission] === true;

  const requirePermission = (
    permission: string,
    message = "No tenés permiso para realizar esta acción"
  ): boolean => {
    if (hasPermission(permission)) return true;
    dependencies.showToast(message, "error");
    return false;
  };

  const updateUi = (): void => {
    const query = (selector: string): Element | null =>
      documentRef.querySelector(selector);

    const currentSession = dependencies.getSession();
    const sessionEmail = currentSession?.user?.email ?? "";
    const employee = context.employee;

    const visibleName =
      text(employee?.nombre)
      || (
        sessionEmail && !sessionEmail.endsWith("@employees.vendify.internal")
          ? sessionEmail.split("@")[0] ?? ""
          : ""
      )
      || text(context.business?.nombre)
      || "Usuario";

    const sessionLabel = text(employee?.username)
      ? `@${text(employee?.username)}`
      : sessionEmail;
    const currentRoleName = roleName(context.membership?.role);

    const values: ReadonlyArray<readonly [string, string]> = [
      ["#context-usuario", visibleName],
      ["#context-rol", currentRoleName],
      ["#sesion-email", sessionLabel],
      ["#user-menu-name", visibleName],
      ["#user-menu-name-popover", visibleName],
      ["#user-menu-role", currentRoleName],
      ["#config-negocio", text(context.business?.nombre) || "—"],
      ["#config-sucursal", text(context.branch?.nombre) || "—"],
      ["#config-usuario", visibleName],
      ["#config-rol", currentRoleName]
    ];

    for (const [selector, value] of values) {
      const element = query(selector);
      if (element) element.textContent = value;
    }

    const avatar = query("#user-avatar");
    if (avatar) {
      avatar.setAttribute("title", visibleName);
      avatar.setAttribute("aria-label", `Cuenta de ${visibleName}`);
    }
  };

  const applyPermissions = (): void => {
    if (!context.ready) return;

    const role = context.membership?.role ?? "cashier";
    const owner = role === "owner";
    const admin = role === "admin";
    const manager = role === "manager";
    const cashier = role === "cashier";
    const canManageProducts = hasPermission("manageProducts");
    const canAdjustStock = hasPermission("adjustStock");
    const canConfigure = owner || admin || manager;
    const canExport = owner || admin || manager;
    const canViewHistory = owner || admin || manager;
    const canManageTeam = owner || admin || manager;

    documentRef.body.dataset.role = role;
    documentRef.body.classList.toggle("rol-cashier", cashier);

    const setHidden = (selector: string, hidden: boolean): void => {
      documentRef.querySelectorAll(selector).forEach((element) => {
        if (element instanceof HTMLElement) element.hidden = hidden;
        element.classList.toggle("permiso-hidden", hidden);
      });
    };

    setHidden(
      "#btn-nuevo, #btn-empty-nuevo, #btn-cargar-ejemplos, #btn-cargar-ejemplos-config",
      !canManageProducts
    );
    setHidden("#btn-equipo", !canManageTeam);
    setHidden("#btn-config-equipo", !canManageTeam);
    setHidden("#btn-user-settings", !canConfigure);
    setHidden("#config-discount-pin-card", !(owner || admin));
    setHidden("#btn-nueva-sucursal-v226", !(owner || admin));
    setHidden("#btn-transferir-stock-v226", !(owner || admin || manager));
    setHidden("#btn-eliminar-todos-productos", !(owner || admin));
    setHidden("#btn-export", !canExport);
    setHidden("#btn-historial", !canViewHistory);
    setHidden(
      "#btn-inventario",
      !(owner || admin || manager || canAdjustStock)
    );
    setHidden("#btn-compras", !(owner || admin || manager));
    setHidden("#btn-diagnostico-v23011", !(owner || admin));
    setHidden("#btn-dashboard-v231", !(owner || admin || manager));
    setHidden("#btn-alertas-v231", !(owner || admin || manager));

    documentRef
      .querySelector('[data-config-tab="operacion"]')
      ?.classList.toggle("permiso-hidden", !(owner || admin));

    setHidden(
      "#btn-gestion-v230",
      !(canViewHistory || canManageTeam || owner || admin || manager)
    );
    setHidden(".card-acciones", !canManageProducts);
    setHidden(".card-stock-controls", !canAdjustStock);
    documentRef.body.classList.toggle("ocultar-costos", cashier);

    if (!cashier) return;

    documentRef.querySelectorAll(
      '[data-action="editar"], [data-action="eliminar"]'
    ).forEach((element) => {
      if (element instanceof HTMLElement) element.hidden = true;
      element.classList.add("permiso-hidden");
    });

    if (canAdjustStock) return;

    documentRef.querySelectorAll(
      '[data-action="sumar"], [data-action="restar"], [data-action="ajustar"]'
    ).forEach((element) => {
      if (element instanceof HTMLElement) element.hidden = true;
      element.classList.add("permiso-hidden");
    });
  };

  const persistOffline = (): void => {
    const userId = dependencies.getSession()?.user?.id;
    if (!context.ready || !userId) return;

    try {
      storage.setItem(
        `${CONTEXT_PREFIX}:${userId}`,
        JSON.stringify({
          ...context,
          offlineMode: false,
          savedAt: new Date().toISOString()
        })
      );
    } catch {
      // Local persistence is best-effort.
    }
  };

  const loadOffline = (): ApplicationContextState | null => {
    const userId = dependencies.getSession()?.user?.id;
    if (!userId) return null;

    try {
      const raw = storage.getItem(`${CONTEXT_PREFIX}:${userId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      const record = recordOrNull<ContextRecord>(parsed);
      if (!record) return null;

      const business = recordOrNull<ApplicationNamedRecord>(record.business);
      const membership = recordOrNull<ApplicationMembershipRecord>(record.membership);
      if (!business?.id || !membership?.role) return null;

      return {
        user: recordOrNull<ApplicationUserRecord>(record.user),
        business,
        membership,
        branch: recordOrNull<ApplicationNamedRecord>(record.branch),
        cashRegister: recordOrNull<ApplicationNamedRecord>(record.cashRegister),
        permissions: booleanPermissions(record.permissions),
        employee: recordOrNull<ApplicationEmployeeRecord>(record.employee),
        ready: true,
        offlineMode: true,
        ...(text(record.savedAt) ? { savedAt: text(record.savedAt) } : {})
      };
    } catch {
      return null;
    }
  };

  const load = async (): Promise<ApplicationContextState> => {
    let data: ContextRecord;

    try {
      data = await dependencies.getApp(dependencies.client);
    } catch (error) {
      logger.error("[V2] Error cargando contexto:", error);

      if (!navigator.onLine) {
        const cached = loadOffline();
        if (cached) {
          context = cached;
          publish();
          updateUi();
          applyPermissions();
          dependencies.setConnectionState("offline", "Modo consulta");
          return context;
        }
      }

      throw new Error(
        errorMessage(error, "No se pudo cargar el contexto del negocio")
      );
    }

    context = {
      user: recordOrNull<ApplicationUserRecord>(data.user),
      business: recordOrNull<ApplicationNamedRecord>(data.business),
      membership: recordOrNull<ApplicationMembershipRecord>(data.membership),
      branch: recordOrNull<ApplicationNamedRecord>(data.branch),
      cashRegister: recordOrNull<ApplicationNamedRecord>(data.cashRegister),
      permissions: booleanPermissions(data.permissions),
      employee: null,
      ready: true
    };
    publish();

    try {
      const customPermissions = booleanPermissions(
        await dependencies.getPermissions(dependencies.client)
      );
      if (Object.keys(customPermissions).length > 0) {
        context.permissions = {
          ...context.permissions,
          ...customPermissions
        };
      }
    } catch (error) {
      logger.warn("[Vendify permisos] fallback a permisos por rol:", error);
    }

    try {
      const employee = recordOrNull<ApplicationEmployeeRecord>(
        await dependencies.getEmployee(dependencies.client)
      );
      if (employee && Object.keys(employee).length > 0) context.employee = employee;
    } catch (error) {
      logger.warn("[Vendify empleados] perfil no disponible:", error);
    }

    publish();
    updateUi();
    applyPermissions();
    logger.info("[V2] Contexto cargado", context);
    persistOffline();
    return context;
  };

  const clear = (): void => {
    context = emptyContext();
    publish();
    documentRef.body.removeAttribute("data-role");
    documentRef.body.classList.remove("rol-cashier");
  };

  const setBranchAndCash = (
    branch: ContextRecord | null,
    cashRegister: ContextRecord | null
  ): void => {
    context.branch = recordOrNull<ApplicationNamedRecord>(branch);
    context.cashRegister = recordOrNull<ApplicationNamedRecord>(cashRegister);
    publish();
  };

  const setCashRegister = (cashRegister: ContextRecord | null): void => {
    context.cashRegister = recordOrNull<ApplicationNamedRecord>(cashRegister);
    publish();
  };

  publish();

  return Object.freeze({
    get: () => context,
    setBranchAndCash,
    setCashRegister,
    load,
    clear,
    hasPermission,
    requirePermission,
    updateUi,
    applyPermissions,
    roleName,
    persistOffline,
    loadOffline
  });
}

declare global {
  interface Window {
    appContext?: ApplicationContextState;
  }
}
