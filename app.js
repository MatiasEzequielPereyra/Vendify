console.log("[Vendify] app loaded");

// Vendify UI icon helper — must exist before any application flow runs.
function iconV23011(name, className = "vendify-icon") {
  const safe = String(name || "").replace(/[^a-z0-9-]/gi, "");
  return `<svg class="${className}" aria-hidden="true"><use href="#vi-${safe}"></use></svg>`;
}

/**
 * Vendify v2.28 — Login dual y empleados internos
 * Basado en Stock Kiosco v6 — Fase 2: multi-dispositivo en vivo
 * - Login por email + contraseña vía Supabase Auth
 * - Datos en Supabase Postgres (antes: localStorage)
 * - Realtime: los cambios se ven al instante en todos los dispositivos
 * - Venta / reposición atómica (sin pisar stock entre dispositivos)
 * - PWA instalable + onboarding (se mantienen igual que antes)
 */

const THEME_KEY = "kiosco_theme";
const ONBOARDING_KEY = "kiosco_onboarding_done";
const INSTALL_DISMISS_KEY = "kiosco_install_dismiss";


// ============================================================
// QA — Integridad de entorno / arranque único
// ============================================================
const VENDIFY_EXPECTED_SUPABASE_REF = "puhkmblnptntorwptvld";
let appBootPromiseVQA = null;
let appBootUserIdVQA = null;

function mostrarErrorEntornoVQA(mensaje) {
  let box = document.querySelector("#vendify-environment-error-vqa");
  if (!box) {
    box = document.createElement("div");
    box.id = "vendify-environment-error-vqa";
    box.className = "vendify-environment-error-vqa";
    document.body.appendChild(box);
  }
  box.innerHTML = `
    <div>
      <strong>Vendify no puede iniciar</strong>
      <p>${escapeHtml(String(mensaje || "Configuración inválida"))}</p>
      <small>Revisá supabase-config.js antes de continuar.</small>
    </div>`;
}

function validarEntornoSupabaseVQA() {
  if (typeof supabaseClient === "undefined") {
    mostrarErrorEntornoVQA("No se cargó la configuración de Supabase.");
    return false;
  }

  let url = "";
  try {
    if (typeof SUPABASE_URL !== "undefined") url = String(SUPABASE_URL || "");
  } catch {}
  if (!url) url = String(supabaseClient?.supabaseUrl || "");

  if (!url.includes(VENDIFY_EXPECTED_SUPABASE_REF)) {
    mostrarErrorEntornoVQA(
      `El frontend está apuntando a otro proyecto de Supabase (${url || "URL desconocida"}).`
    );
    console.error("[Vendify QA] Supabase project mismatch", { url });
    return false;
  }

  return true;
}

async function mostrarAppSeguroVQA(session) {
  const uid = session?.user?.id || null;
  if (!uid) return;

  if (appBootPromiseVQA) return appBootPromiseVQA;
  if (appBootUserIdVQA === uid && appContext?.ready) return;

  appBootUserIdVQA = uid;
  appBootPromiseVQA = mostrarApp()
    .catch((error) => {
      appBootUserIdVQA = null;
      throw error;
    })
    .finally(() => {
      appBootPromiseVQA = null;
    });

  return appBootPromiseVQA;
}


let deferredInstallPrompt = null;
let realtimeChannel = null;

// El catálogo inicial vive en src/products/catalog-data.ts.

let productos = [];
let categorias = [];
let productoEditandoId = null;
let fotoActualBase64 = null;

// Editor de recorte
let cropImage = null;
let cropScale = 1;
let cropBaseScale = 1;
let cropOffsetX = 0;
let cropOffsetY = 0;
let cropDragging = false;
let cropLastX = 0;
let cropLastY = 0;
let stockAjusteId = null;
let stockAjusteValor = 0;
let confirmCallback = null;

// Compatibility aliases while the remaining legacy runtime is compacted.
// The implementation now lives in src/core and is loaded before app.js.
const $ = (sel) => window.VendifyCoreV232.queryOne(sel);
const $$ = (sel) => window.VendifyCoreV232.queryAll(sel);

// ============================================================
// V2 — CONTEXTO SAAS / MULTIEMPRESA
// ============================================================
window.appContext = {
  user: null,
  business: null,
  membership: null,
  branch: null,
  cashRegister: null,
  permissions: {},
  employee: null,
  ready: false,
};

async function cargarContextoApp() {
  const { data, error } = await supabaseClient.rpc("obtener_contexto_app");

  if (error) {
    console.error("[V2] Error cargando contexto:", error);

    if (!navigator.onLine) {
      const cachedContext = cargarContextoOfflineV231?.();

      if (cachedContext) {
        window.appContext = cachedContext;
        actualizarContextoUI();
        aplicarPermisosV2();
        setConnectionStateV23011?.(
          "offline",
          "Modo consulta"
        );
        return window.appContext;
      }
    }

    throw new Error(
      error.message ||
        "No se pudo cargar el contexto del negocio"
    );
  }

  window.appContext = {
    user: data?.user || null,
    business: data?.business || null,
    membership: data?.membership || null,
    branch: data?.branch || null,
    cashRegister: data?.cashRegister || null,
    permissions: data?.permissions || {},
    employee: null,
    ready: true,
  };

  // Permisos personalizados del miembro prevalecen sobre los defaults
  // históricos por rol.
  try {
    const { data: customPermissions, error: customPermissionsError } =
      await supabaseClient.rpc("obtener_permisos_personalizados_v1");

    if (!customPermissionsError && customPermissions) {
      appContext.permissions = {
        ...appContext.permissions,
        ...customPermissions,
      };
    } else if (customPermissionsError) {
      console.warn("[Vendify permisos] overrides no disponibles:", customPermissionsError);
    }
  } catch (permissionError) {
    console.warn("[Vendify permisos] fallback a permisos por rol:", permissionError);
  }

  // Si es un usuario interno, recuperamos nombre y username reales.
  const { data: employeeProfile, error: employeeProfileError } =
    await supabaseClient.rpc("obtener_perfil_empleado_actual");

  if (!employeeProfileError && employeeProfile) {
    appContext.employee = employeeProfile;
  }

  actualizarContextoUI();
  aplicarPermisosV2();

  console.info("[V2] Contexto cargado", window.appContext);
  guardarContextoOfflineV231?.();
  return window.appContext;
}

function limpiarContextoApp() {
  window.appContext = {
    user: null,
    business: null,
    membership: null,
    branch: null,
    cashRegister: null,
    permissions: {},
    employee: null,
    ready: false,
  };
  document.body.removeAttribute("data-role");
  document.body.classList.remove("rol-cashier");
}

function tienePermisoV2(permiso) {
  return window.appContext?.permissions?.[permiso] === true;
}

function exigirPermisoV2(permiso, mensaje = "No tenés permiso para realizar esta acción") {
  if (tienePermisoV2(permiso)) return true;
  mostrarToast(mensaje, "error");
  return false;
}

function actualizarContextoUI() {
  const usuarioEl = $("#context-usuario");
  const rolEl = $("#context-rol");
  const sesionEl = $("#sesion-email");

  const perfilEmpleado = appContext.employee;
  const currentSession = authControllerV232.getSession();
  const emailSesion = currentSession?.user?.email || "";

  let nombreVisible;

  if (perfilEmpleado?.nombre) {
    nombreVisible = perfilEmpleado.nombre;
  } else {
    // Para propietarios/admins con email mostramos la parte anterior al @.
    nombreVisible =
      emailSesion && !emailSesion.endsWith("@employees.vendify.internal")
        ? emailSesion.split("@")[0]
        : appContext.business?.nombre || "Usuario";
  }

  if (usuarioEl) usuarioEl.textContent = nombreVisible;
  if (rolEl) rolEl.textContent = nombreRolV2(appContext.membership?.role);

  // Evitamos mostrar el email técnico de empleados.
  if (sesionEl) {
    sesionEl.textContent = perfilEmpleado?.username
      ? `@${perfilEmpleado.username}`
      : emailSesion;
  }

  const roleName = nombreRolV2(appContext.membership?.role);
  const visibleName =
    appContext.employee?.nombre ||
    (currentSession?.user?.email ? currentSession.user.email.split("@")[0] : "") ||
    appContext.business?.nombre ||
    "Usuario";

  const userMenuName = $("#user-menu-name");
  const userMenuNamePopover = $("#user-menu-name-popover");
  const userMenuRole = $("#user-menu-role");
  const userAvatar = $("#user-avatar");

  if (userMenuName) userMenuName.textContent = visibleName;
  if (userMenuNamePopover) userMenuNamePopover.textContent = visibleName;
  if (userMenuRole) userMenuRole.textContent = roleName;
  if (userAvatar) {
    userAvatar.title = visibleName;
    userAvatar.setAttribute("aria-label", `Cuenta de ${visibleName}`);
  }

  const cn = $("#config-negocio");
  const cs = $("#config-sucursal");
  const cu = $("#config-usuario");
  const cr = $("#config-rol");

  if (cn) cn.textContent = appContext.business?.nombre || "—";
  if (cs) cs.textContent = appContext.branch?.nombre || "—";
  if (cu) cu.textContent = visibleName;
  if (cr) cr.textContent = roleName;
}

function nombreRolV2(rol) {
  const nombres = {
    owner: "Propietario",
    admin: "Administrador",
    manager: "Encargado",
    cashier: "Cajero",
  };
  return nombres[rol] || rol || "Usuario";
}

function aplicarPermisosV2() {
  if (!appContext.ready) return;

  const role = appContext.membership?.role || "cashier";

  const esOwner = role === "owner";
  const esAdmin = role === "admin";
  const esManager = role === "manager";
  const esCashier = role === "cashier";

  const puedeGestionarProductos = tienePermisoV2("manageProducts");
  const puedeAjustarStock = tienePermisoV2("adjustStock");
  const puedeConfigurar = esOwner || esAdmin || esManager;
  const puedeExportar = esOwner || esAdmin || esManager;
  const puedeVerHistorial = esOwner || esAdmin || esManager;

  // Equipo queda solamente para propietario y administrador.
  const puedeGestionarEquipo = esOwner || esAdmin;

  document.body.dataset.role = role;
  document.body.classList.toggle("rol-cashier", esCashier);

  const setHidden = (selector, hidden) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.hidden = hidden;
      el.classList.toggle("permiso-hidden", hidden);
    });
  };

  setHidden(
    "#btn-nuevo, #btn-empty-nuevo, #btn-cargar-ejemplos, #btn-cargar-ejemplos-config",
    !puedeGestionarProductos
  );

  setHidden("#btn-equipo", !puedeGestionarEquipo);
  setHidden("#btn-config-equipo", !puedeGestionarEquipo);
  setHidden("#btn-user-settings", !puedeConfigurar);
  setHidden("#config-discount-pin-card", !(esOwner || esAdmin));
  setHidden("#btn-nueva-sucursal-v226", !(esOwner || esAdmin));
  setHidden("#btn-transferir-stock-v226", !(esOwner || esAdmin || esManager));
  setHidden("#btn-eliminar-todos-productos", !(esOwner || esAdmin));
  setHidden("#btn-export", !puedeExportar);
  setHidden("#btn-historial", !puedeVerHistorial);
  setHidden("#btn-inventario", !(esOwner || esAdmin || esManager || puedeAjustarStock));
  setHidden("#btn-compras", !(esOwner || esAdmin || esManager));
  setHidden("#btn-diagnostico-v23011", !(esOwner || esAdmin));
  setHidden(
    "#btn-dashboard-v231",
    !(esOwner || esAdmin || esManager)
  );
  setHidden(
    "#btn-alertas-v231",
    !(esOwner || esAdmin || esManager)
  );

  document
    .querySelector('[data-config-tab="operacion"]')
    ?.classList.toggle(
      "permiso-hidden",
      !(esOwner || esAdmin)
    );

  const gestionVisible =
    puedeVerHistorial ||
    puedeGestionarEquipo ||
    esOwner || esAdmin || esManager;

  setHidden("#btn-gestion-v230", !gestionVisible);

  setHidden(".card-acciones", !puedeGestionarProductos);
  setHidden(".card-stock-controls", !puedeAjustarStock);

  // Los costos son información sensible para cajeros.
  document.body.classList.toggle("ocultar-costos", esCashier);

  // Si por cualquier motivo un cajero quedó con permissions antiguas
  // en memoria, el rol real sigue teniendo prioridad en la UI.
  if (esCashier) {
    document.querySelectorAll(
      '[data-action="editar"], [data-action="eliminar"]'
    ).forEach((el) => {
      el.hidden = true;
      el.classList.add("permiso-hidden");
    });

    if (!puedeAjustarStock) {
      document.querySelectorAll(
        '[data-action="sumar"], [data-action="restar"], [data-action="ajustar"]'
      ).forEach((el) => {
        el.hidden = true;
        el.classList.add("permiso-hidden");
      });
    }
  }
}

async function listarSucursalesV2() {
  const { data, error } = await supabaseClient.rpc("listar_sucursales_app");
  if (error) throw new Error(error.message);
  return data || [];
}

async function cambiarSucursalV2(sucursalId, { recargar = true } = {}) {
  const { data, error } = await supabaseClient.rpc("obtener_contexto_sucursal", {
    p_sucursal_id: sucursalId,
  });

  if (error) throw new Error(error.message);

  appContext.branch = data.branch;
  appContext.cashRegister = data.cashRegister;

  if (appContext.business?.id) {
    localStorage.setItem(
      `vendify_branch_${appContext.business.id}`,
      appContext.branch.id
    );
  }

