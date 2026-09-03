Warning: truncated output (original token count: 41067)
Total output lines: 5729

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
const MAX_IMG_SIZE = 400;


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


// ============================================================
// VENDIFY V2.3 - HELPERS LOGIN DUAL / EMPLEADOS
// ============================================================

function normalizarLoginInterno(valor) {
  return window.VendifyAuthV232.normalizeInternalLogin(valor);
}

function emailInternoEmpleado(codigoNegocio, username) {
  return window.VendifyAuthV232.buildEmployeeInternalEmail(codigoNegocio, username);
}

function generarPasswordTemporal() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const array = new Uint32Array(12);
  crypto.getRandomValues(array);
  return Array.from(array, (n) => chars[n % chars.length]).join("");
}

function mostrarPanelLogin(tipo) {
  const esOwner = tipo === "owner";

  $("#tab-owner")?.classList.toggle("active", esOwner);
  $("#tab-employee")?.classList.toggle("active", !esOwner);

  $("#auth-owner-panel")?.classList.toggle("hidden", !esOwner);
  $("#auth-employee-panel")?.classList.toggle("hidden", esOwner);

  $("#register-form")?.classList.add("hidden");
  $("#forgot-form")?.classList.add("hidden");
  $("#auth-message")?.classList.add("hidden");

  const loginError = $("#login-error");
  const employeeError = $("#employee-login-error");

  if (loginError) loginError.textContent = "";
  if (employeeError) employeeError.textContent = "";
}


let deferredInstallPrompt = null;
let sesionActual = null;
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
  const emailSesion = sesionActual?.user?.email || "";

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
    (sesionActual?.user?.email ? sesionActual.user.email.split("@")[0] : "") ||
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

  const selector = $("#branch-selector-v226");
  if (selector) selector.value = appContext.branch.id;

  actualizarContextoUI();

  await cargarCajasSucursalV227({ mantener: true });
  renderBranchOptionsV23013();
  renderCashOptionsV23013();
  actualizarContextSelectorLabelsV23013();
  guardarContextoOfflineV231?.();

  if (recargar) {
    posControllerV232.clearCart();
    await cargarProductos();
    actualizarFiltroCategorias();
    renderGrid();
    if (!$("#modal-venta")?.classList.contains("hidden")) renderVentaProductos();
  }

  suscribirRealtime();
  return data;
}

async function registrarVentaV2(items, medioPago) {
  if (!exigirPermisoV2("sell", "Tu usuario no tiene permiso para registrar ventas")) return null;
  if (!appContext.ready) throw new Error("El contexto del negocio todavía no está cargado");
  const data = await window.VendifySalesV232.registerLegacySale(
    supabaseClient,
    items || [],
    medioPago || null,
    appContext.branch.id,
    appContext.cashRegister.id
  );
  emitirCambioStockRealtime("venta");
  return data;
}

async function ajustarStockV2(productoId, delta, tipo = "ajuste") {
  if (!exigirPermisoV2("adjustStock", "Tu usuario no tiene permiso para modificar stock")) return null;
  if (!appContext?.branch?.id) throw new Error("No hay una sucursal activa");

  const { data, error } = await supabaseClient.rpc("ajustar_stock_sucursal_v1", {
    p_producto_id: productoId,
    p_sucursal_id: appContext.branch.id,
    p_delta: Number(delta),
    p_tipo: tipo,
  });

  if (error) throw new Error(error.message || "No se pudo ajustar el stock");
  emitirCambioStockRealtime("ajuste_stock");
  return data;
}

// =====================
// Autenticación Vendify — email + contraseña
// =====================
let flujoRecuperacionActivo = false;

function mostrarPanelAuth(panel) {
  return window.VendifyAuthV232.showAuthPanel(panel);
}

function mostrarMensajeAuth(mensaje, tipo = "info") {
  return window.VendifyAuthV232.showAuthMessage(mensaje, tipo);
}

async function initAuth() {
  return window.VendifyAuthV232.initializeAuthLifecycle(
    supabaseClient.auth,
    {
      setSession(session) {
        sesionActual = session;
      },
      isRecoveryActive() {
        return flujoRecuperacionActivo;
      },
      setRecoveryActive(active) {
        flujoRecuperacionActivo = active;
      },
      showLogin: mostrarLogin,
      showNewPasswordPanel() {
        mostrarPanelAuth("auth-new-password-panel");
      },
      showApp(session) {
        return mostrarAppSeguroVQA(session);
      },
      async handleSignedOut() {
        appBootUserIdVQA = null;
        appBootPromiseVQA = null;
        limpiarContextoApp();
        productos = [];
        posControllerV232.clearCart();
        mostrarLogin();
        if (realtimeChannel) {
          supabaseClient.removeChannel(realtimeChannel);
          realtimeChannel = null;
        }
      }
    }
  );
}

function mostrarLogin() {
  $("#auth-screen")?.classList.remove("hidden");
  $(".app")?.classList.add("hidden");
  if (!flujoRecuperacionActivo) mostrarPanelAuth("owner");
}

async function mostrarApp() {
  $("#auth-screen")?.classList.add("hidden");
  $(".app")?.classList.remove("hidden");
  try {
    await cargarContextoApp();
  } catch (error) {
    console.error(error);
    mostrarToast("No se pudo cargar el negocio: " + error.message, "error");
    return;
  }

  if (!navigator.onLine && appContext?.offlineMode) {
    cargarCategoriasOfflineV231?.();
    cargarProductosOfflineV231?.();
    actualizarFiltroCategorias();
    renderGrid();
    aplicarPermisosV2();
    actualizarContextSelectorLabelsV23013?.();
    restaurarPruebaCajaOfflineV2311?.();
    actualizarUIVentasOfflineV2311?.();

    if (restaurarCarritoV231?.()) {
      renderCarrito();
    }

    aplicarEstadoOfflineVentaV231?.();
    return;
  }

  await inicializarSucursalActivaV226();
  await inicializarCajaV227();
  await cargarCategorias();
  await cargarProductos();
  actualizarFiltroCategorias();
  renderGrid();
  aplicarPermisosV2();

  if (restaurarCarritoV231?.()) {
    renderCarrito();
  }

  suscribirRealtime();
  await cargarCommercialFoundationV231?.();
}

async function iniciarSesionPassword(e) {
  e.preventDefault();
  const email = $("#login-email")?.value.trim();
  const password = $("#login-password")?.value || "";
  const btn = $("#btn-login");
  const err = $("#login-error");
  if (!btn || !err) return;

  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Ingresando...";

  const result = await window.VendifyAuthV232.signInOwner(
    supabaseClient.auth,
    email,
    password
  );

  btn.disabled = false;
  btn.textContent = "Iniciar sesión";

  if (!result.ok) err.textContent = result.errorMessage || "";
}


async function loginEmpleado(e) {
  e.preventDefault();

  const code = $("#employee-business-code")?.value.trim() || "";
  const username = $("#employee-username")?.value.trim() || "";
  const password = $("#employee-password")?.value || "";
  const errorEl = $("#employee-login-error");
  const btn = $("#btn-employee-login");
  if (!errorEl || !btn) return;

  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Ingresando...";

  const result = await window.VendifyAuthV232.signInEmployee(
    supabaseClient.auth,
    code,
    username,
    password
  );

  btn.disabled = false;
  btn.textContent = "Entrar a Vendify";

  if (!result.ok) errorEl.textContent = result.errorMessage || "";
}

async function registrarCuenta(e) {
  e.preventDefault();
  const businessName = $("#register-business")?.value.trim();
  const email = $("#register-email")?.value.trim();
  const password = $("#register-password")?.value || "";
  const err = $("#register-error");
  const btn = $("#btn-register");
  if (!err || !btn) return;

  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Creando cuenta...";

  const result = await window.VendifyAuthV232.registerOwner(
    supabaseClient.auth,
    {
      businessName,
      email,
      password,
      redirectTo: window.location.origin + window.location.pathname
    }
  );

  btn.disabled = false;
  btn.textContent = "Crear cuenta";

  if (!result.ok) {
    err.textContent = result.errorMessage || "";
    return;
  }

  if (result.requiresConfirmation) {
    mostrarPanelAuth("owner");
    mostrarMensajeAuth(
      "Cuenta creada. Revisá tu email una sola vez para confirmarla y después ingresá con tu contraseña.",
      "success"
    );
  }
}

async function solicitarResetPassword(e) {
  e.preventDefault();
  const email = $("#forgot-email")?.value.trim();
  const btn = $("#btn-forgot-send");
  const err = $("#forgot-error");
  if (!btn || !err) return;

  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Enviando...";

  const result = await window.VendifyAuthV232.requestPasswordReset(
    supabaseClient.auth,
    email,
    window.location.origin + window.location.pathname
  );

  btn.disabled = false;
  btn.textContent = "Enviar recuperación";

  if (!result.ok) {
    err.textContent = result.errorMessage || "";
    return;
  }

  mostrarPanelAuth("owner");
  mostrarMensajeAuth("Te enviamos un enlace para cambiar tu contraseña.", "success");
}

async function guardarNuevaPassword(e) {
  e.preventDefault();
  const password = $("#new-password")?.value || "";
  const confirm = $("#new-password-confirm")?.value || "";
  const err = $("#new-password-error");
  const btn = $("#btn-new-password");
  if (!err || !btn) return;

  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Guardando...";

  const result = await window.VendifyAuthV232.updatePassword(
    supabaseClient.auth,
    password,
    confirm
  );

  btn.disabled = false;
  btn.textContent = "Guardar contraseña";

  if (!result.ok) {
    err.textContent = result.errorMessage || "";
    return;
  }

  flujoRecuperacionActivo = false;
  mostrarToast("Contraseña actualizada", "success");
  await mostrarApp();
}


function togglePassword(inputId, button) {
  const input = $("#" + inputId);
  if (!input) return;

  const mostrar = input.type === "password";
  input.type = mostrar ? "text" : "password";

  button.innerHTML = iconV23011(mostrar ? "eye-off" : "eye");
  button.setAttribute(
    "aria-label",
    mostrar ? "Ocultar contraseña" : "Mostrar contraseña"
  );
  button.title = mostrar ? "Ocultar contraseña" : "Mostrar contraseña";
}


function posicionarPopoverAncladoV23012(
  menu,
  trigger,
  { minWidth = 230, maxWidth = 290, gap = 8, margin = 10 } = {}
) {
  if (!menu || !trigger || menu.classList.contains("hidden")) return;

  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxAvailableWidth = Math.max(180, viewportWidth - margin * 2);
  const width = Math.min(maxWidth, maxAvailableWidth);

  let left = rect.right - width;
  left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

  menu.style.position = "fixed";
  menu.style.left = `${left}px`;
  menu.style.right = "auto";
  menu.style.width = `${Math.max(Math.min(minWidth, maxAvailableWidth), width)}px`;
  menu.style.maxWidth = `calc(100vw - ${margin * 2}px)`;

  const measuredHeight = Math.min(
    menu.scrollHeight || 240,
    viewportHeight - margin * 2
  );

  const below = viewportHeight - rect.bottom - margin;
  const above = rect.top - margin;
  const openAbove = below < Math.min(measuredHeight, 250) && above > below;

  if (openAbove) {
    menu.style.top = `${Math.max(margin, rect.top - measuredHeight - gap)}px`;
    menu.dataset.placement = "top";
  } else {
    menu.style.top = `${Math.min(
      rect.bottom + gap,
      Math.max(margin, viewportHeight - measuredHeight - margin)
    )}px`;
    menu.dataset.placement = "bottom";
  }
}

function posicionarMenuUsuarioMobile() {
  posicionarPopoverAncladoV23012(
    $("#user-menu"),
    $("#btn-user-menu"),
    { minWidth: 230, maxWidth: 270 }
  );
}

function limpiarPosicionMenuUsuario() {
  const menu = $("#user-menu");
  if (!menu) return;
  menu.style.position = "";
  menu.style.left = "";
  menu.style.right = "";
  menu.style.top = "";
  menu.style.width = "";
  menu.style.maxWidth = "";
  delete menu.dataset.placement;
}

function abrirCerrarMenuUsuarioV224(force) {
  const menu = $("#user-menu");
  const trigger = $("#btn-user-menu");
  if (!menu || !trigger) return;

  const abrir =
    typeof force === "boolean"
      ? force
      : menu.classList.contains("hidden");

  menu.classList.toggle("hidden", !abrir);
  trigger.setAttribute("aria-expanded", abrir ? "true" : "false");

  if (abrir) {
    if (typeof abrirCerrarGestionV230 === "function") {
      abrirCerrarGestionV230(false);
    }
    requestAnimationFrame(posicionarMenuUsuarioMobile);
  } else {
    limpiarPosicionMenuUsuario();
  }
}

async function cerrarSesion() {
  flujoRecuperacionActivo = false;
  limpiarContextoApp();
  await window.VendifyAuthV232.signOut(supabaseClient.auth);
}



// ============================================================
// V2.3 — EQUIPO / USUARIOS INTERNOS
// ============================================================

async function obtenerNegocioAdminV3() {
  return window.VendifyTeamV232.getAdminBusiness(supabaseClient);
}

async function listarEquipoV3() {
  const result = await window.VendifyTeamV232.listTeam(supabaseClient);
  if (result.stockPermissionWarning) {
    console.warn("[Equipo] permisos stock no disponibles:", result.stockPermissionWarning);
  }
  return result.members;
}

async function actualizarPermisoStockMiembroV23014(membershipId, permitir) {
  const result = await window.VendifyTeamV232.updateStockPermission(
    supabaseClient,
    membershipId,
    permitir
  );
  if (!result.ok) {
    throw new Error(result.errorMessage || "No se pudo actualizar el permiso de stock");
  }
  return result.data;
}

async function abrirEquipo() {
  if (!exigirPermisoV2("manageEmployees", "No tenés permiso para administrar el equipo")) return;

  const ownerCanSetStock = appContext.membership?.role === "owner";
  if ($("#equipo-permiso-stock")) {
    $("#equipo-permiso-stock").disabled = !ownerCanSetStock;
  }
  $("#equipo-permiso-stock-hint")?.classList.toggle("hidden", ownerCanSetStock);

  $("#modal-equipo")?.classList.remove("hidden");
  try {
    const negocio = await obtenerNegocioAdminV3();
    $("#equipo-business-code").textContent = negocio.codigo_acceso || "—";
  } catch (e) {
    mostrarToast(e.message, "error");
  }
  await renderEquipo();
}

function cerrarEquipo() {
  $("#modal-equipo")?.classList.add("hidden");
}

async function renderEquipo() {
  const lista = $("#equipo-lista");
  if (!lista) return;
  lista.innerHTML = `<p class="hint" style="text-align:center;padding:1rem;">Cargando equipo...</p>`;

  let personas;
  try {
    personas = await listarEquipoV3();
  } catch (error) {
    lista.innerHTML = "";
    mostrarToast(error.message, "error");
    return;
  }

  lista.innerHTML = personas.map((item) => {
    const esOwner = item.rol === "owner";
    const esYo = item.user_id === appContext.user?.id;
    const username = item.username
      ? `<span class="employee-username-badge">@${escapeHtml(item.username)}</span>`
      : `<span class="employee-username-badge">Email</span>`;

    const rolControl = esOwner
      ? `<span class="equipo-role-owner">Propietario</span>`
      : `
        <select class="select equipo-role-select" data-membership-id="${item.membership_id}" ${esYo ? "disabled" : ""}>
          <option value="cashier" ${item.rol === "cashier" ? "selected" : ""}>Cajero</option>
          <option value="manager" ${item.rol === "manager" ? "selected" : ""}>Encargado</option>
          <option value="admin" ${item.rol === "admin" ? "selected" : ""}>Administrador</option>
        </select>`;

    const acciones = (!esOwner && !esYo)
      ? `
         <button class="btn btn-ghost btn-sm"
                 data-equipo-action="edit-member"
                 data-id="${item.membership_id}"
                 data-nombre="${escapeHtml(item.nombre || "")}"
                 data-username="${escapeHtml(item.username || "")}"
                 data-rol="${item.rol}"
                 data-stock="${item.puede_gestionar_stock ? "1" : "0"}">
           Editar
         </button>
         <button class="btn btn-ghost btn-sm"
                 data-equipo-action="reset-password"
                 data-id="${item.membership_id}"
                 data-nombre="${escapeHtml(item.nombre || item.username || "Empleado")}">
           Reiniciar clave
         </button>
         <button class="btn ${item.activo ? "btn-ghost" : "btn-secondary"} btn-sm"
                 data-equipo-action="toggle-member"
                 data-id="${item.membership_id}"
                 data-activo="${item.activo ? "0" : "1"}">
            ${item.activo ? "Desactivar" : "Activar"}
         </button>
         ${appContext.membership?.role === "owner" ? `
           <button class="btn btn-danger btn-sm"
                   data-equipo-action="delete-member"
                   data-id="${item.membership_id}"
                   data-nombre="${escapeHtml(item.nombre || item.username || "Empleado")}">
             Eliminar
           </button>` : ""}`
      : "";

    return `
      <div class="equipo-item">
        <div class="equipo-persona">
          <div class="equipo-email">${escapeHtml(item.nombre || item.email || "Usuario")}${esYo ? " · Vos" : ""}</div>
          <div class="equipo-meta">
            ${username}
            <span class="equipo-status ${item.activo ? "active" : "inactive"}">${item.activo ? "Activo" : "Inactivo"}</span>
            ${
              esOwner
                ? `<span class="equipo-permission-badge-v23014 enabled">Stock manual</span>`
                : `<span class="equipo-permission-badge-v23014 ${item.puede_gestionar_stock ? "enabled" : "disabled"}">
                    Stock manual: ${item.puede_gestionar_stock ? "Sí" : "No"}
                  </span>`
            }
          </div>
        </div>
        <div>${rolControl}</div>
        <div class="equipo-actions">${acciones}</div>
      </div>`;
  }).join("");
}

async function crearEmpleadoV3(e) {
  e.preventDefault();

  if (!exigirPermisoV2("manageEmployees", "No tenés permiso para crear empleados")) return;

  const nombre = $("#equipo-nombre").value.trim();
  const username = normalizarLoginInterno($("#equipo-username").value);
  const rol = $("#equipo-rol").value;
  const password = $("#equipo-password").value;
  const permisoStockSolicitado =
    appContext.membership?.role === "owner" &&
    $("#equipo-permiso-stock")?.checked === true;
  const errorEl = $("#equipo-error");
  const btn = $("#btn-crear-empleado");

  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Creando...";

  const result = await window.VendifyTeamV232.createEmployee(
    supabaseClient.functions,
    { nombre, username, rol, password }
  );

  btn.disabled = false;
  btn.textContent = "Crear empleado";

  if (!result.ok) {
    errorEl.textContent = result.errorMessage || "No se pudo crear el empleado";
    return;
  }

  if (appContext.membership?.role === "owner") {
    try {
      const people = await listarEquipoV3();
      const created = people.find(
        (person) =>
          String(person.username || "").toLowerCase() === username.toLowerCase()
      );

      if (created?.membership_id) {
        await actualizarPermisoStockMiembroV23014(
          created.membership_id,
          permisoStockSolicitado
        );
      }
    } catch (permissionError) {
      console.error("[Equipo] empleado creado, permiso stock pendiente:", permissionError);
      mostrarToast(
        "Empleado creado, pero revisá su permiso de stock desde Editar",
        "info"
      );
    }
  }

  $("#equipo-nombre").value = "";
  $("#equipo-username").value = "";
  $("#equipo-password").value = "";
  if ($("#equipo-permiso-stock")) $("#equipo-permiso-stock").checked = false;

  mostrarToast(`Empleado @${username} creado`, "success");
  await renderEquipo();
}

async function cambiarRolEquipo(membershipId, rol, selectEl) {
  selectEl.disabled = true;
  const result = await window.VendifyTeamV232.updateMemberRole(
    supabaseClient,
    membershipId,
    rol
  );
  selectEl.disabled = false;

  if (!result.ok) {
    mostrarToast(result.errorMessage || "No se pudo actualizar el rol", "error");
    await renderEquipo();
    return;
  }
  mostrarToast(`Rol actualizado a ${nombreRolV2(rol)}`, "success");
}

async function cambiarEstadoEquipo(membershipId, activo) {
  const result = await window.VendifyTeamV232.setMemberActive(
    supabaseClient,
    membershipId,
    activo
  );
  if (!result.ok) {
    mostrarToast(result.errorMessage || "No se pudo actualizar el usuario", "error");
    return;
  }
  mostrarToast(activo ? "Usuario activado" : "Usuario desactivado", "success");
  await renderEquipo();
}




async function eliminarEmpleadoDefinitivo(btn) {
  if (appContext.membership?.role !== "owner") {
    mostrarToast("Solo el propietario puede eliminar usuarios", "error");
    return;
  }

  const nombre = btn.dataset.nombre || "este empleado";
  const ok = await confirmar(
    "Eliminar usuario",
    `¿Eliminar definitivamente a ${nombre}? Esta acción elimina su acceso a Vendify.`
  );

  if (!ok) return;

  const result = await window.VendifyTeamV232.deleteEmployee(
    supabaseClient.functions,
    btn.dataset.id
  );

  if (!result.ok) {
    mostrarToast(result.errorMessage || "No se pudo eliminar el usuario", "error");
    return;
  }

  mostrarToast("Usuario eliminado definitivamente", "success");
  await renderEquipo();
}

function abrirEditarEmpleadoDesdeBoton(btn) {
  $("#editar-membership-id").value = btn.dataset.id || "";
  $("#editar-empleado-nombre").value = btn.dataset.nombre || "";
  $("#editar-empleado-username").value = btn.dataset.username || "";
  $("#editar-empleado-rol").value = btn.dataset.rol || "cashier";

  const stockPermission = $("#editar-empleado-permiso-stock");
  const ownerCanChangeStock = appContext.membership?.role === "owner";

  if (stockPermission) {
    stockPermission.checked = btn.dataset.stock === "1";
    stockPermission.disabled = !ownerCanChangeStock;
  }

  $("#editar-stock-owner-hint")?.classList.toggle("hidden", ownerCanChangeStock);

  $("#editar-empleado-error").textContent = "";
  $("#modal-editar-empleado").classList.remove("hidden");
}

function cerrarEditarEmpleado() {
  $("#modal-editar-empleado")?.classList.add("hidden");
}

async function guardarEdicionEmpleado(e) {
  e.preventDefault();

  const membershipId = $("#editar-membership-id").value;
  const nombre = $("#editar-empleado-nombre").value.trim();
  const username = normalizarLoginInterno($("#editar-empleado-username").value);
  const rol = $("#editar-empleado-rol").value;
  const permisoStock =
    $("#editar-empleado-permiso-stock")?.checked === true;
  const errorEl = $("#editar-empleado-error");
  const btn = $("#btn-guardar-editar-empleado");

  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Guardando...";

  const result = await window.VendifyTeamV232.updateEmployee(
    supabaseClient.functions,
    { membershipId, nombre, username, rol }
  );

  btn.disabled = false;
  btn.textContent = "Guardar cambios";

  if (!result.ok) {
    errorEl.textContent = result.errorMessage || "No se pudo actualizar";
    return;
  }

  if (appContext.membership?.role === "owner") {
    try {
      await actualizarPermisoStockMiembroV23014(
        membershipId,
        permisoStock
      );
    } catch (permissionError) {
      errorEl.textContent = permissionError.message;
      return;
    }
  }

  cerrarEditarEmpleado();
  mostrarToast("Empleado actualizado", "success");
  await renderEquipo();
}

function abrirResetEmpleadoDesdeBoton(btn) {
  $("#reset-membership-id").value = btn.dataset.id || "";
  $("#reset-empleado-info").textContent =
    `Nueva contraseña para ${btn.dataset.nombre || "el empleado"}.`;
  $("#reset-empleado-password").value = generarPasswordTemporal();
  $("#reset-empleado-error").textContent = "";
  $("#modal-reset-empleado").classList.remove("hidden");
}

function cerrarResetEmpleado() {
  $("#modal-reset-empleado")?.classList.add("hidden");
}

async function reiniciarPasswordEmpleado(e) {
  e.preventDefault();

  const membershipId = $("#reset-membership-id").value;
  const password = $("#reset-empleado-password").value;
  const errorEl = $("#reset-empleado-error");

  errorEl.textContent = "";

  const result = await window.VendifyTeamV232.resetEmployeePassword(
    supabaseClient.functions,
    membershipId,
    password
  );

  if (!result.ok) {
    errorEl.textContent = result.errorMessage || "No se pudo reiniciar la contraseña";
    return;
  }

  cerrarResetEmpleado();
  mostrarToast("Contraseña del empleado actualizada", "success");
  await renderEquipo();
}


// =====================
// Realtime robusto — stock sincronizado entre dispositivos
// =====================
let realtimeReloadTimerV226 = null;
let realtimeReconnectTimer = null;
let realtimeFallbackTimer = null;
let realtimeStatus = "IDLE";
let realtimeFullRefreshTimer = null;
let realtimeSyncInFlight = false;

let realtimeFullSyncInFlightVQA = false;
let realtimeDependentTimerVQA = null;
let realtimeLastFullSyncVQA = 0;

async function sincronizarCatalogoCompletoVQA({ silencioso = true } = {}) {
  if (
    realtimeFullSyncInFlightVQA ||
    !appContext?.ready ||
    !appContext?.branch?.id ||
    document.visibilityState === "hidden"
  ) return;

  realtimeFullSyncInFlightVQA = true;
  try {
    await cargarProductos();
    actualizarFiltroCategorias();
    renderGrid();
    aplicarPermisosV2();

    if (!$("#modal-venta")?.classList.contains("hidden")) {
      renderVentaProductos();
      renderCarrito();
    }

    realtimeLastFullSyncVQA = Date.now();
  } catch (error) {
    console.warn("[Vendify QA] sync completo falló:", error?.message || error);
    if (!silencioso) mostrarToast("No se pudieron resincronizar los datos", "error");
  } finally {
    realtimeFullSyncInFlightVQA = false;
  }
}

function refrescarVistasDependientesRealtimeVQA(reason = "data") {
  clearTimeout(realtimeDependentTimerVQA);

  realtimeDependentTimerVQA = setTimeout(async () => {
    try {
      if (!$("#modal-historial")?.classList.contains("hidden")) {
        await renderHistorial();
      }

      await inventoryControllerV232.refreshOpenView(false);

      await purchasesControllerV232.refreshOpenViews();

      if (!$("#modal-caja-operativa-v227")?.classList.contains("hidden")) {
        await cargarEstadoCajaV227();
        await renderPanelCajaV227();
      }
    } catch (error) {
      console.debug("[Vendify QA] refresh dependiente:", reason, error?.message || error);
    }
  }, 260);
}

function actualizarEstadoRealtimeUI(status) {
  realtimeStatus = status || "UNKNOWN";
  document.documentElement.dataset.realtimeStatus = realtimeStatus.toLowerCase();
}

async function sincronizarStockLigero({ render = true } = {}) {
  if (
    realtimeSyncInFlight ||
    !appContext?.ready ||
    !appContext?.branch?.id ||
    document.visibilityState === "hidden"
  ) {
    return;
  }

  realtimeSyncInFlight = true;

  try {
    const branchId = appContext.branch.id;

    const { data, error } = await supabaseClient
      .from("producto_stock_sucursal")
      .select("producto_id,stock,stock_minimo")
      .eq("sucursal_id", branchId);

    if (error) throw error;

    let huboCambios = false;
    const stockMap = new Map(
      (data || []).map((row) => [row.producto_id, row])
    );

    productos.forEach((p) => {
      const row = stockMap.get(p.id);
      if (!row) return;

      const nuevoStock = Number(row.stock || 0);
      const nuevoMin = Number(row.stock_minimo || 0);

      if (
        Number(p.stock || 0) !== nuevoStock ||
        Number(p.stockMinimo || 0) !== nuevoMin
      ) {
        p.stock = nuevoStock;
        p.stockMinimo = nuevoMin;
        huboCambios = true;
      }
    });

    if (huboCambios && render) {
      renderGrid();
      aplicarPermisosV2();

      if (!$("#modal-venta")?.classList.contains("hidden")) {
        renderVentaProductos();
        renderCarrito();
      }
    }

    return huboCambios;
  } catch (error) {
    console.warn("[Vendify Realtime] sync ligero falló:", error?.message || error);
    return false;
  } finally {
    realtimeSyncInFlight = false;
  }
}

function programarRefreshInteligenteRealtime() {
  clearTimeout(realtimeFullRefreshTimer);

  realtimeFullRefreshTimer = setTimeout(async () => {
    if (!appContext?.ready || !appContext?.branch?.id) return;

    try {
      await cargarStockInteligente();
      renderGrid();
    } catch (error) {
      console.debug(
        "[Vendify Realtime] stock inteligente pendiente:",
        error?.message || error
      );
    }
  }, 900);
}

function refrescarProductosRealtimeV226() {
  clearTimeout(realtimeReloadTimerV226);

  realtimeReloadTimerV226 = setTimeout(async () => {
    await cargarProductos();
    actualizarFiltroCategorias();
    renderGrid();
    aplicarPermisosV2();

    if (!$("#modal-venta")?.classList.contains("hidden")) {
      renderVentaProductos();
      renderCarrito();
    }
  }, 120);
}

function recibirCambioStockRealtime(payload) {
  const branchId =
    payload?.new?.sucursal_id ||
    payload?.old?.sucursal_id ||
    payload?.payload?.branch_id ||
    payload?.branch_id;

  if (branchId && branchId !== appContext?.branch?.id) return;

  sincronizarStockLigero({ render: true });
  programarRefreshInteligenteRealtime();
  refrescarVistasDependientesRealtimeVQA("stock");
}

function emitirCambioStockRealtime(reason = "stock") {
  // Security hardening:
  // no enviamos broadcasts públicos. PostgreSQL Realtime es la fuente
  // autoritativa y el watchdog reconcilia cualquier evento perdido.
  programarRefreshInteligenteRealtime();
  refrescarVistasDependientesRealtimeVQA(reason);
}

function programarReconexionRealtime() {
  clearTimeout(realtimeReconnectTimer);

  if (
    !appContext?.ready ||
    !appContext?.business?.id ||
    !appContext?.branch?.id ||
    document.visibilityState === "hidden"
  ) {
    return;
  }

  realtimeReconnectTimer = setTimeout(() => {
    console.info("[Vendify Realtime] reconectando canal...");
    suscribirRealtime();
  }, 1600);
}

function suscribirRealtime() {
  clearTimeout(realtimeReconnectTimer);

  if (realtimeChannel) {
    try {
      supabaseClient.removeChannel(realtimeChannel);
    } catch {}
    realtimeChannel = null;
  }

  if (!appContext?.business?.id || !appContext?.branch?.id) return;

  const businessId = appContext.business.id;
  const branchId = appContext.branch.id;

  actualizarEstadoRealtimeUI("CONNECTING");

  realtimeChannel = supabaseClient
    .channel(`vendify-${businessId}-${branchId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "productos",
        filter: `negocio_id=eq.${businessId}`,
      },
      refrescarProductosRealtimeV226
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "producto_stock_sucursal",
        filter: `sucursal_id=eq.${branchId}`,
      },
      recibirCambioStockRealtime
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "ventas",
        filter: `sucursal_id=eq.${branchId}`,
      },
      () => refrescarVistasDependientesRealtimeVQA("ventas")
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "movimientos",
        filter: `sucursal_id=eq.${branchId}`,
      },
      () => refrescarVistasDependientesRealtimeVQA("movimientos")
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "compras",
        filter: `sucursal_id=eq.${branchId}`,
      },
      () => refrescarVistasDependientesRealtimeVQA("compras")
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "proveedores",
        filter: `negocio_id=eq.${businessId}`,
      },
      () => refrescarVistasDependientesRealtimeVQA("proveedores")
    )
    .subscribe(async (status) => {
      console.info("[Vendify Realtime]", status);
      actualizarEstadoRealtimeUI(status);

      if (status === "SUBSCRIBED") {
        clearTimeout(realtimeReconnectTimer);

        // Al reconectar no confiamos en la memoria local:
        // se compara inmediatamente contra PostgreSQL.
        if (Date.now() - realtimeLastFullSyncVQA > 30000) {
          await sincronizarCatalogoCompletoVQA();
        } else {
          await sincronizarStockLigero({ render: true });
        }
        programarRefreshInteligenteRealtime();
        refrescarVistasDependientesRealtimeVQA("reconnect");
        return;
      }

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        programarReconexionRealtime();
      }
    });
}

function iniciarWatchdogRealtime() {
  if (realtimeFallbackTimer) return;

  // Respaldo liviano. Realtime debe ser instantáneo; esto corrige
  // teléfonos que suspenden el WebSocket al bloquear la pantalla.
  realtimeFallbackTimer = setInterval(async () => {
    if (
      document.visibilityState !== "visible" ||
      !appContext?.ready ||
      !appContext?.branch?.id
    ) {
      return;
    }

    if (Date.now() - realtimeLastFullSyncVQA > 60000) {
      await sincronizarCatalogoCompletoVQA();
    } else {
      await sincronizarStockLigero({ render: true });
    }

    if (realtimeStatus !== "SUBSCRIBED") {
      programarReconexionRealtime();
    }
  }, 10000);

  const resincronizar = async () => {
    if (!appContext?.ready || !appContext?.branch?.id) return;

    // Teléfonos suelen suspender WebSocket. Al volver a primer plano
    // reconstruimos el catálogo completo, no solo las filas que ya estaban en memoria.
    await sincronizarCatalogoCompletoVQA();
    programarRefreshInteligenteRealtime();
    refrescarVistasDependientesRealtimeVQA("focus");

    if (realtimeStatus !== "SUBSCRIBED") {
      suscribirRealtime();
    }
  };

  window.addEventListener("focus", resincronizar);
  window.addEventListener("online", resincronizar);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      resincronizar();
    }
  });
}


function aplicarCambioRemoto(payload) {
  productsControllerV232.applyRemoteChange(payload);
}

/* QA: implementación legacy removida (mapearProductoDB) */


// =====================
// Persistencia de productos delegada a TypeScript
// =====================
const mapearProductoDB = window.VendifyProductsV232.mapProductRow;
const productoEtiquetaV29 = window.VendifyProductsV232.productLabel;

let scannerControllerV232 = null;

const productsControllerV232 =
  window.VendifyProductsV232.createController({
    client: supabaseClient,
    getProducts: () => productos,
    setProducts: (next) => { productos = next; },
    getCategories: () => categorias,
    setCategories: (next) => { categorias = next; },
    getBranch: () => ({
      id: appContext.branch?.id || null,
      name: appContext.branch?.nombre || "Sucursal",
    }),
    getRole: () => appContext.membership?.role || "cashier",
    hasPermission: tienePermisoV2,
    requirePermission: exigirPermisoV2,
    showToast: mostrarToast,
    confirm: confirmar,
    formatPrice: formatearPrecio,
    applyPermissions: aplicarPermisosV2,
    loadProductsOffline: () => Boolean(cargarProductosOfflineV231?.()),
    saveProductsOffline: () => { guardarProductosOfflineV231?.(); },
    captureOfflineStockSnapshot: async (items) => {
      if (!window.VendifyOfflineV2312?.enabled) return;
      await window.VendifyOfflineV2312.captureStockSnapshot({
        businessId: appContext.business.id,
        branchId: appContext.branch.id,
        products: items.map((producto) => ({
          productId: producto.id,
          serverStock: Number(producto.stock || 0),
        })),
      });
    },
    loadCategoriesOffline: () => Boolean(cargarCategoriasOfflineV231?.()),
    saveCategoriesOffline: () => { guardarCategoriasOfflineV231?.(); },
    refreshOnboarding: () => { refrescarOnboardingComercialV231?.(); },
    emitStockChange: emitirCambioStockRealtime,
    scheduleSmartRefresh: programarRefreshInteligenteRealtime,
    renderSaleProducts: () => { renderVentaProductos(); },
    renderCart: () => { renderCarrito(); },
    isSaleOpen: () => !$("#modal-venta")?.classList.contains("hidden"),
    addToCart: agregarAlCarrito,
    openInventoryAdjustment: (id, delta) => {
      inventoryControllerV232.openAdjustmentFromProduct(id, delta);
    },
    openManualStockModal: abrirModalStock,
    setEditingProductId: (id) => { productoEditandoId = id; },
    getEditingProductId: () => productoEditandoId,
    setCurrentPhoto: (photo) => { fotoActualBase64 = photo; },
    restoreSaleBehindProduct: (focus = true) => {
      restaurarVentaDetrasProducto({ enfocar: focus });
    },
    shouldReturnCreatedProductToSale: () =>
      Boolean(scannerControllerV232?.shouldReturnCreatedProductToSale()),
    clearPendingScannerProduct: () => {
      scannerControllerV232?.clearPendingProduct();
    },
  });

scannerControllerV232 =
  window.VendifyProductsV232.createScannerController({
    client: supabaseClient,
    getProducts: () => productos,
    getCart: () => posControllerV232.getCart(),
    getBranchId: () => appContext.branch?.id || null,
    getEditingProductId: () => productoEditandoId,
    showTo…16067 tokens truncated…     class="btn btn-secondary btn-sm"
                    data-platform-save-plan="${row.id}">
              Guardar
            </button>
          </div>
        </div>`,
      "Todavía no hay negocios."
    );

    renderDashboardRowsV231(
      $("#platform-error-list-v231"),
      errorsResult.data || [],
      (row) => `
        <div class="platform-error-row-v231">
          <span class="dashboard-list-icon-v231 ${row.tipo === "window_error" ? "warning" : ""}">
            ${iconV23011("alert")}
          </span>
          <div class="dashboard-list-copy-v231">
            <strong>${escapeHtml(row.mensaje || "Error")}</strong>
            <small>
              ${escapeHtml(row.negocio_nombre || "Negocio")}
              · ${escapeHtml(row.version || "sin versión")}
              · ${row.creado ? new Date(row.creado).toLocaleString("es-AR") : ""}
            </small>
          </div>
          <span class="platform-status-v231">${escapeHtml(row.tipo || "client")}</span>
        </div>`,
      "No hay errores recientes."
    );
  } catch (error) {
    $("#platform-business-list-v231").innerHTML =
      dashboardEmptyV231(
        error.message ||
          "No se pudo cargar el backoffice."
      );
  }
}

async function guardarPlanPlataformaV231(button) {
  const row = button.closest("[data-platform-business]");
  if (!row) return;

  const negocioId = row.dataset.platformBusiness;
  const plan = row.querySelector(".platform-plan-select-v231")?.value;
  const estado = row.querySelector(".platform-state-select-v231")?.value;

  if (!negocioId || !plan || !estado) return;

  button.disabled = true;
  button.textContent = "Guardando...";

  try {
    const { data, error } = await supabaseClient.rpc(
      "actualizar_plan_negocio_plataforma_v1",
      {
        p_negocio_id: negocioId,
        p_plan_codigo: plan,
        p_estado: estado,
      }
    );

    if (error || data?.ok === false) {
      throw new Error(
        error?.message ||
        data?.message ||
        "No se pudo actualizar el plan"
      );
    }

    mostrarToast("Plan actualizado", "success");
    await abrirPlatformAdminV231();
  } catch (error) {
    mostrarToast(
      error.message || "No se pudo actualizar el plan",
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = "Guardar";
  }
}

function cerrarPlatformAdminV231() {
  $("#modal-platform-admin-v231")?.classList.add(
    "hidden"
  );
}

// ---------------------
// Lifecycle
// ---------------------
async function cargarCommercialFoundationV231() {
  if (!appContext?.ready) return;

  guardarContextoOfflineV231();

  if (!navigator.onLine) {
    aplicarEstadoOfflineVentaV231();
    return;
  }

  await Promise.allSettled([
    cargarConfigOperativaV231(),
    cargarPlanV231(),
    refrescarOnboardingComercialV231(),
    cargarBadgeAlertasV231(),
    verificarPlatformAdminV231(),
  ]);

  clearInterval(commercialRefreshTimerV231);

  commercialRefreshTimerV231 = setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      navigator.onLine
    ) {
      cargarBadgeAlertasV231();
    }
  }, 60000);
}

function setupCommercialFoundationV231() {
  setupObservabilityV231();
  setupOfflineSalesV2311();

  dashboardControllerV232.setup();

  $("#btn-hide-commercial-onboarding-v231")
    ?.addEventListener("click", () => {
      try {
        localStorage.setItem(
          onboardingHideKeyV231(),
          "1"
        );
      } catch {}

      $("#commercial-onboarding-v231")
        ?.classList.add("hidden");
    });

  $("#commercial-onboarding-steps-v231")
    ?.addEventListener("click", (event) => {
      const btn = event.target.closest(
        "[data-onboarding-action-v231]"
      );

      if (!btn) return;

      const action =
        btn.dataset.onboardingActionV231;

      if (action === "product") {
        if (tienePermisoV2("manageProducts")) {
          abrirModal();
        } else {
          abrirConfig("datos");
        }
      } else if (action === "cash") {
        abrirPanelCajaV227();
      } else if (action === "sale") {
        abrirVenta();
      } else if (action === "team") {
        abrirEquipo();
      }
    });

  $("#form-operacion-v231")?.addEventListener(
    "submit",
    guardarConfigOperativaV231
  );

  $("#btn-backup-json-v231")
    ?.addEventListener(
      "click",
      descargarBackupOperativoV231
    );

  $("#btn-template-csv-v231")
    ?.addEventListener(
      "click",
      descargarPlantillaCSVV231
    );

  $("#btn-import-csv-v231")
    ?.addEventListener("click", () => {
      $("#input-import-csv-v231")?.click();
    });

  $("#input-import-csv-v231")
    ?.addEventListener(
      "change",
      async (event) => {
        const file =
          event.target.files?.[0];

        event.target.value = "";

        if (file) {
          await importarCSVV231(file);
        }
      }
    );

  $("#btn-platform-admin-v231")
    ?.addEventListener("click", () => {
      abrirCerrarMenuUsuarioV224(false);
      abrirPlatformAdminV231();
    });

  $("#btn-close-platform-v231")
    ?.addEventListener(
      "click",
      cerrarPlatformAdminV231
    );

  $("#modal-platform-admin-v231 .modal-backdrop")
    ?.addEventListener(
      "click",
      cerrarPlatformAdminV231
    );

  $("#platform-business-list-v231")
    ?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-platform-save-plan]");
      if (btn) guardarPlanPlataformaV231(btn);
    });

}


// ============================================================
// Vendify v2.30 — Menú Gestión compacto
// ============================================================

function posicionarGestionMenuV230() {
  posicionarPopoverAncladoV23012(
    $("#gestion-menu-v230"),
    $("#btn-gestion-v230"),
    { minWidth: 252, maxWidth: 292 }
  );
}

function abrirCerrarGestionV230(force) {
  const menu = $("#gestion-menu-v230");
  const trigger = $("#btn-gestion-v230");
  if (!menu || !trigger) return;

  const open =
    typeof force === "boolean"
      ? force
      : menu.classList.contains("hidden");

  menu.classList.toggle("hidden", !open);
  trigger.setAttribute("aria-expanded", open ? "true" : "false");

  if (open) {
    abrirCerrarMenuUsuarioV224(false);
    requestAnimationFrame(posicionarGestionMenuV230);
  } else {
    menu.style.position = "";
    menu.style.left = "";
    menu.style.right = "";
    menu.style.top = "";
    menu.style.width = "";
    menu.style.maxWidth = "";
    delete menu.dataset.placement;
  }
}

function setupGestionMenuV230() {
  $("#btn-gestion-v230")?.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirCerrarGestionV230();
  });

  $("#gestion-menu-v230")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.closest("button")) abrirCerrarGestionV230(false);
  });

  document.addEventListener("click", () => abrirCerrarGestionV230(false));

  window.addEventListener("resize", () => {
    if (!$("#gestion-menu-v230")?.classList.contains("hidden")) {
      posicionarGestionMenuV230();
    }
  });

  window.addEventListener(
    "scroll",
    () => abrirCerrarGestionV230(false),
    { passive: true }
  );

  $(".header-actions-vpro")?.addEventListener(
    "scroll",
    () => abrirCerrarGestionV230(false),
    { passive: true }
  );
}


// ============================================================
// Vendify v2.29 — Inventario profesional
// ============================================================

const inventoryControllerV232 =
  window.VendifyInventoryV232.createController({
    client: supabaseClient,
    canManage: () =>
      ["owner", "admin", "manager"].includes(
        appContext.membership?.role
      ) || tienePermisoV2("adjustStock"),
    isSupervisor: () =>
      ["owner", "admin", "manager"].includes(
        appContext.membership?.role
      ),
    hasManualStockPermission: () =>
      tienePermisoV2("adjustStock"),
    requireManualStockPermission: (message) =>
      exigirPermisoV2("adjustStock", message),
    getBranch: () => ({
      id: appContext.branch?.id || null,
      name: appContext.branch?.nombre || "Sucursal",
    }),
    listBranches: listarSucursalesV2,
    getProducts: () => productos,
    mapProduct: mapearProductoDB,
    productLabel: productoEtiquetaV29,
    formatDate: formatearFechaHoraV227,
    isLowStock: esStockBajoInteligente,
    isOutOfStock: esSinStock,
    getSmartStock: obtenerStockInteligente,
    showToast: mostrarToast,
    confirm: confirmar,
    emitStockChange: emitirCambioStockRealtime,
    reloadProducts: cargarProductos,
    renderProducts: renderGrid,
  });
// ============================================================
// Vendify v2.30 — Compras y proveedores
// ============================================================

const purchasesControllerV232 =
  window.VendifyPurchasesV232.createController({
    client: supabaseClient,
    canManage: () =>
      ["owner", "admin", "manager"].includes(
        appContext.membership?.role
      ),
    getBranch: () => ({
      id: appContext.branch?.id || null,
      name: appContext.branch?.nombre || "Sucursal",
    }),
    listBranches: listarSucursalesV2,
    getProducts: () => productos,
    productLabel: productoEtiquetaV29,
    formatDate: formatearFechaHoraV227,
    showToast: mostrarToast,
    confirm: confirmar,
    emitStockChange: emitirCambioStockRealtime,
    reloadProducts: cargarProductos,
    renderProducts: renderGrid,
  });
// ============================================================
// Seguridad de descuentos + Ventas/POS — runtime modular
// ============================================================
const discountControllerV232 =
  window.VendifySalesV232.createDiscountController({
    client: supabaseClient,
    getBranchId: () => appContext.branch?.id || null,
    getRole: () => appContext.membership?.role || null,
    isAppReady: () => Boolean(appContext?.ready),
    getSubtotal: () => posControllerV232.getTotal(),
    formatCurrency: formatearPrecio,
    icon: iconV23011,
    showToast: mostrarToast,
    recalculateTotals: () => posControllerV232.updateTotals(),
  });

const salesHistoryControllerV232 =
  window.VendifySalesV232.createHistoryController({
    client: supabaseClient,
    getContext: () => ({
      businessName: appContext.business?.nombre || "Negocio",
      branchId: appContext.branch?.id || null,
      branchName: appContext.branch?.nombre || "",
      cashRegisterId: appContext.cashRegister?.id || null,
      cashRegisterName: appContext.cashRegister?.nombre || "",
      role: appContext.membership?.role || "",
    }),
    isCashOpenByCurrentUser: cajaAbiertaMiaV227,
    openCashPanel: () => abrirPanelCajaV227(),
    formatCurrency: formatearPrecio,
    showToast: mostrarToast,
    getAutoPrint: () => commercialConfigV231?.auto_imprimir_ticket === true,
    getTicketWidth: () => Number(commercialConfigV231?.ancho_ticket_mm) === 58 ? 58 : 80,
    emitStockChange: emitirCambioStockRealtime,
    reloadProducts: cargarProductos,
    renderProducts: renderGrid,
    reloadCash: cargarEstadoCajaV227,
  });

const posControllerV232 =
  window.VendifySalesV232.createPosController({
    client: supabaseClient,
    discount: discountControllerV232,
    getContext: () => ({
      ready: Boolean(appContext?.ready),
      branchId: appContext.branch?.id || null,
      cashRegisterId: appContext.cashRegister?.id || null,
    }),
    canSell: (message) => exigirPermisoV2("sell", message),
    getProducts: () => productos,
    isCashOpenByCurrentUser: cajaAbiertaMiaV227,
    hasCashSession: () => Boolean(cashControllerV232.getState()?.sesion),
    restoreOfflineCash: () => restaurarPruebaCajaOfflineV2311?.() === true,
    openCashPanel: () => abrirPanelCajaV227(),
    isOnline: () => navigator.onLine,
    formatCurrency: formatearPrecio,
    showToast: mostrarToast,
    renderSaleProducts: renderVentaProductos,
    persistCart: () => guardarCarritoV231?.(),
    applyOfflineSaleState: () => aplicarEstadoOfflineVentaV231?.(),
    validateOfflinePayments: validarPagosOfflineV2311,
    registerOfflineSale: (items, payments, totals, observation) =>
      offlineControllerV232.registerSale(items, payments, totals, observation),
    updateOfflineUi: actualizarUIVentasOfflineV2311,
    clearPersistedCart: () => {
      try {
        localStorage.removeItem(safeBusinessKeyV231(VENDIFY_CART_PREFIX_V231));
      } catch {}
    },
    reloadProducts: cargarProductos,
    renderProducts: renderGrid,
    reloadCash: cargarEstadoCajaV227,
    emitStockChange: emitirCambioStockRealtime,
    refreshDependentViews: refrescarVistasDependientesRealtimeVQA,
    showTicket: (data) => salesHistoryControllerV232.showTicket(data),
    afterOnlineSale: () => {
      refrescarOnboardingComercialV231?.();
      cargarBadgeAlertasV231?.();
    },
  });

function actualizarEstadoPinDescuento() {
  return discountControllerV232.updatePinState();
}
function calcularTotalesVentaV228() {
  return posControllerV232.calculateTotals();
}
function actualizarTotalesVentaV228() {
  return posControllerV232.updateTotals();
}
function abrirVenta() {
  posControllerV232.open();
}
function cerrarVenta() {
  posControllerV232.close();
}
function agregarAlCarrito(id) {
  posControllerV232.addToCart(id);
}
function cambiarCantidadCarrito(id, delta) {
  posControllerV232.changeQuantity(id, delta);
}
function quitarDelCarrito(id) {
  posControllerV232.removeFromCart(id);
}
function calcularTotalCarrito() {
  return posControllerV232.getTotal();
}
function renderCarrito() {
  posControllerV232.renderCart();
}
function mostrarTicketV228(data) {
  salesHistoryControllerV232.showTicket(data);
}
// Export CSV
// =====================
function exportarCSV() {
  if (!exigirPermisoV2("viewReports", "No tenés permiso para exportar información")) return;
  if (productos.length === 0) {
    mostrarToast("No hay productos para exportar", "error");
    return;
  }
  const headers = ["Nombre", "Categoría", "Precio compra", "Precio venta", "Stock", "Stock mínimo"];
  const rows = productos.map((p) => [
    `"${(p.nombre || "").replace(/"/g, '""')}"`,
    `"${(p.categoria || "").replace(/"/g, '""')}"`,
    p.precioCompra || 0, p.precioVenta || 0, p.stock || 0, p.stockMinimo ?? 5,
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vendify-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarToast("CSV exportado");
}

// =====================
// Historial de ventas (tickets) — runtime modular
// =====================
async function abrirHistorial() {
  await salesHistoryControllerV232.open();
}
function cerrarHistorial() {
  salesHistoryControllerV232.close();
}
async function renderHistorial() {
  await salesHistoryControllerV232.render();
}
// Eventos
// =====================
function inicializarEventos() {
  $("#login-form")?.addEventListener("submit", iniciarSesionPassword);
  $("#employee-login-form")?.addEventListener("submit", loginEmpleado);
  $("#register-form")?.addEventListener("submit", registrarCuenta);
  $("#forgot-form")?.addEventListener("submit", solicitarResetPassword);
  $("#new-password-form")?.addEventListener("submit", guardarNuevaPassword);

  $("#tab-owner")?.addEventListener("click", () => mostrarPanelAuth("owner"));
  $("#tab-employee")?.addEventListener("click", () => mostrarPanelAuth("employee"));
  $("#btn-show-register")?.addEventListener("click", () => mostrarPanelAuth("register"));
  $("#btn-back-login")?.addEventListener("click", () => mostrarPanelAuth("owner"));
  $("#btn-forgot")?.addEventListener("click", () => {
    const email = $("#login-email")?.value.trim();
    if ($("#forgot-email") && email) $("#forgot-email").value = email;
    mostrarPanelAuth("forgot");
  });
  $("#btn-forgot-back")?.addEventListener("click", () => mostrarPanelAuth("owner"));

  document.querySelectorAll("[data-toggle-password]").forEach((btn) => {
    btn.addEventListener("click", () => togglePassword(btn.dataset.togglePassword, btn));
  });

  $("#btn-cerrar-sesion")?.addEventListener("click", cerrarSesion);

  $("#btn-equipo")?.addEventListener("click", abrirEquipo);
  $("#btn-cerrar-equipo")?.addEventListener("click", cerrarEquipo);
  $("#modal-equipo .modal-backdrop")?.addEventListener("click", cerrarEquipo);
  $("#form-crear-empleado")?.addEventListener("submit", crearEmpleadoV3);

  const createStockPermission = $("#equipo-permiso-stock");
  const createRole = $("#equipo-rol");

  if (createStockPermission) {
    const ownerCanSet = appContext.membership?.role === "owner";
    createStockPermission.disabled = !ownerCanSet;
    $("#equipo-permiso-stock-hint")?.classList.toggle("hidden", ownerCanSet);
  }

  createRole?.addEventListener("change", () => {
    if (!createStockPermission || appContext.membership?.role !== "owner") return;
    createStockPermission.checked =
      ["manager", "admin"].includes(createRole.value);
  });

  $("#btn-refrescar-equipo")?.addEventListener("click", renderEquipo);
  $("#btn-generar-password")?.addEventListener("click", () => {
    $("#equipo-password").value = generarPasswordTemporal();
  });
  $("#btn-copy-business-code")?.addEventListener("click", async () => {
    const code = $("#equipo-business-code")?.textContent?.trim();
    if (code && code !== "—") {
      await navigator.clipboard.writeText(code);
      mostrarToast("Código copiado", "success");
    }
  });

  $("#form-editar-empleado")?.addEventListener("submit", guardarEdicionEmpleado);
  $("#btn-cerrar-editar-empleado")?.addEventListener("click", cerrarEditarEmpleado);
  $("#btn-cancelar-editar-empleado")?.addEventListener("click", cerrarEditarEmpleado);
  $("#modal-editar-empleado .modal-backdrop")?.addEventListener("click", cerrarEditarEmpleado);

  $("#form-reset-empleado")?.addEventListener("submit", reiniciarPasswordEmpleado);
  $("#btn-cerrar-reset-empleado")?.addEventListener("click", cerrarResetEmpleado);
  $("#btn-cancelar-reset-empleado")?.addEventListener("click", cerrarResetEmpleado);
  $("#modal-reset-empleado .modal-backdrop")?.addEventListener("click", cerrarResetEmpleado);
  $("#btn-generar-reset-password")?.addEventListener("click", () => {
    $("#reset-empleado-password").value = generarPasswordTemporal();
  });

  $("#equipo-lista")?.addEventListener("change", (e) => {
    const select=e.target.closest(".equipo-role-select"); if(!select)return;
    cambiarRolEquipo(select.dataset.membershipId,select.value,select);
  });
  $("#equipo-lista")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-equipo-action]");
    if (!btn) return;

    if (btn.dataset.equipoAction === "toggle-member") {
      cambiarEstadoEquipo(btn.dataset.id, btn.dataset.activo === "1");
    } else if (btn.dataset.equipoAction === "edit-member") {
      abrirEditarEmpleadoDesdeBoton(btn);
    } else if (btn.dataset.equipoAction === "reset-password") {
      abrirResetEmpleadoDesdeBoton(btn);
    } else if (btn.dataset.equipoAction === "delete-member") {
      eliminarEmpleadoDefinitivo(btn);
    }
  });

  // Ventas/POS, descuentos, tickets e historial se conectan desde sus controladores TypeScript.

  $("#btn-theme").addEventListener("click", toggleTema);
  $("#btn-export").addEventListener("click", exportarCSV);

  $("#btn-user-menu")?.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirCerrarMenuUsuarioV224();
  });

  $("#user-menu")?.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("click", () => {
    abrirCerrarMenuUsuarioV224(false);
  });

  window.addEventListener("resize", () => {
    if (!$("#user-menu")?.classList.contains("hidden")) {
      posicionarMenuUsuarioMobile();
    }
  });

  window.addEventListener(
    "scroll",
    () => abrirCerrarMenuUsuarioV224(false),
    { passive: true }
  );

  $("#btn-user-settings")?.addEventListener("click", () => {
    abrirCerrarMenuUsuarioV224(false);
    abrirConfig("general");
  });

  document.querySelectorAll(".config-tab-v224").forEach((btn) => {
    btn.addEventListener("click", () => activarTabConfigV224(btn.dataset.configTab));
  });

  document.querySelectorAll("[data-config-go]").forEach((btn) => {
    btn.addEventListener("click", () => activarTabConfigV224(btn.dataset.configGo));
  });

  $("#btn-config-catalogo")?.addEventListener("click", () => {
    cerrarConfig();
    abrirCatalogoV29();
  });

  $("#btn-config-equipo")?.addEventListener("click", () => {
    cerrarConfig();
    abrirEquipo();
  });


  $("#btn-cerrar-config").addEventListener("click", cerrarConfig);
  $("#btn-cerrar-config-ok").addEventListener("click", cerrarConfig);
  $("#modal-config .modal-backdrop").addEventListener("click", cerrarConfig);

  async function manejarFoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const img = await leerArchivoImagen(file);
      abrirEditorRecorte(img);
      e.target.value = "";
    } catch (error) {
      console.error("[Foto] Error procesando imagen:", error);
      mostrarToast(
        error?.message || "No se pudo procesar la imagen",
        "error"
      );
    }
  }
  $("#foto-input").addEventListener("change", manejarFoto);
  $("#foto-camara").addEventListener("change", manejarFoto);

  $("#crop-zoom")?.addEventListener("input", (e) => {
    cropScale = Number(e.target.value);
    renderCropCanvas();
  });

  const cropCanvas = $("#crop-canvas");
  cropCanvas?.addEventListener("mousedown", iniciarDragCrop);
  cropCanvas?.addEventListener("mousemove", moverDragCrop);
  window.addEventListener("mouseup", terminarDragCrop);

  cropCanvas?.addEventListener("touchstart", iniciarDragCrop, { passive: false });
  cropCanvas?.addEventListener("touchmove", moverDragCrop, { passive: false });
  window.addEventListener("touchend", terminarDragCrop);

  $("#btn-crop-reset")?.addEventListener("click", resetearCrop);
  $("#btn-aplicar-crop")?.addEventListener("click", aplicarRecorteFoto);
  $("#btn-cancelar-crop")?.addEventListener("click", cerrarEditorRecorte);
  $("#btn-cerrar-crop")?.addEventListener("click", cerrarEditorRecorte);
  $("#modal-crop-foto .modal-backdrop")?.addEventListener("click", cerrarEditorRecorte);
  $("#btn-quitar-foto").addEventListener("click", () => {
    fotoActualBase64 = null;
    $("#foto-input").value = "";
    $("#foto-camara").value = "";
    mostrarPreviewFoto(null);
  });

  $("#modal-confirm .modal-backdrop").addEventListener("click", () => {
    cerrarConfirm();
    if (confirmCallback) confirmCallback(false);
  });

  $("#btn-cerrar-stock").addEventListener("click", cerrarModalStock);
  $("#btn-stock-cancel").addEventListener("click", cerrarModalStock);
  $("#modal-stock .modal-backdrop").addEventListener("click", cerrarModalStock);
  $("#btn-stock-ok").addEventListener("click", confirmarAjusteStock);
  $$(".btn-stock-big").forEach((btn) => {
    btn.addEventListener("click", () => aplicarDeltaStock(parseInt(btn.dataset.delta, 10)));
  });
  $("#stock-manual").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v)) {
      stockAjusteValor = Math.max(0, v);
      $("#stock-actual").textContent = stockAjusteValor;
    }
  });

  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    const escribiendo = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (e.key === "Escape") {
      if (!$("#modal").classList.contains("hidden")) cerrarModal();
      else if (!$("#modal-venta").classList.contains("hidden")) cerrarVenta();
      else if (!$("#modal-historial").classList.contains("hidden")) cerrarHistorial();
      else if (!$("#modal-equipo").classList.contains("hidden")) cerrarEquipo();
      else if (!$("#modal-crop-foto").classList.contains("hidden")) cerrarEditorRecorte();
      else if (!$("#modal-editar-empleado").classList.contains("hidden")) cerrarEditarEmpleado();
      else if (!$("#modal-reset-empleado").classList.contains("hidden")) cerrarResetEmpleado();
      else if (!$("#modal-config").classList.contains("hidden")) cerrarConfig();
      else if (!$("#modal-confirm").classList.contains("hidden")) {
        cerrarConfirm();
        if (confirmCallback) confirmCallback(false);
      } else if (!$("#modal-stock").classList.contains("hidden")) cerrarModalStock();
      return;
    }
    if (escribiendo) return;

    if (e.key === "v" || e.key === "V") { e.preventDefault(); abrirVenta(); }
    else if (e.key === "t" || e.key === "T") { e.preventDefault(); toggleTema(); }
    else if (e.key === "/") { e.preventDefault(); $("#buscador").focus(); }
    else if ((e.key === "n" || e.key === "N") && tienePermisoV2("manageProducts")) { e.preventDefault(); abrirModal(); }
  });
}

// =====================
// PWA + Onboarding
// =====================
function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (localStorage.getItem(INSTALL_DISMISS_KEY)) return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    $("#install-banner")?.classList.remove("hidden");
  });

  $("#btn-install")?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $("#install-banner")?.classList.add("hidden");
    if (outcome === "accepted") mostrarToast("¡App instalada!", "success");
  });

  $("#btn-install-dismiss")?.addEventListener("click", () => {
    localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    $("#install-banner")?.classList.add("hidden");
  });
}

function setupOnboarding() {
  const done = localStorage.getItem(ONBOARDING_KEY);
  if (done) return;
  const el = $("#onboarding");
  if (!el) return;
  el.classList.remove("hidden");

  const cerrar = () => {
    localStorage.setItem(ONBOARDING_KEY, "1");
    el.classList.add("hidden");
  };
  $("#btn-empezar")?.addEventListener("click", cerrar);
  $("#btn-empezar-ejemplos")?.addEventListener("click", () => { cerrar(); cargarEjemplos(); });
}


// ============================================================
// VENDIFY v2.32 — Productos + scanner modulares
// ============================================================

function obtenerStockInteligente(producto) {
  return productsControllerV232.getSmartStock(producto);
}

function esSinStock(producto) {
  return productsControllerV232.isOutOfStock(producto);
}

function esStockBajoInteligente(producto) {
  return productsControllerV232.isLowStock(producto);
}

async function cargarStockInteligente() {
  return productsControllerV232.loadSmartStock();
}

function renderGrid() {
  productsControllerV232.render();
}

let productoSobreVentaActivo = false;

function activarProductoSobreVenta() {
  const productoModal = $("#modal");
  const ventaModal = $("#modal-venta");
  if (!productoModal || !ventaModal) return;
  productoSobreVentaActivo = true;
  productoModal.classList.add("modal-product-over-sale");
  ventaModal.classList.add("modal-under-product");
  ventaModal.setAttribute("aria-hidden", "true");
}

function restaurarVentaDetrasProducto({ enfocar = true } = {}) {
  const productoModal = $("#modal");
  const ventaModal = $("#modal-venta");
  productoModal?.classList.remove("modal-product-over-sale");
  ventaModal?.classList.remove("modal-under-product");
  ventaModal?.removeAttribute("aria-hidden");
  productoSobreVentaActivo = false;
  if (enfocar && ventaModal && !ventaModal.classList.contains("hidden")) {
    setTimeout(() => $("#venta-buscador")?.focus(), 60);
  }
}

function abrirModal(producto = null) {
  productsControllerV232.openEditor(producto);
}

function cerrarModal({ preservarFlujoScanner = false } = {}) {
  productsControllerV232.closeEditor(preservarFlujoScanner);
}

async function buscarDatosBarcodeV29(code) {
  return productsControllerV232.lookupBarcode(String(code || ""));
}

function abrirCatalogoV29() {
  productsControllerV232.openCatalog();
}

async function cargarEjemplos() {
  productsControllerV232.openCatalog();
}

async function abrirScannerV29(mode) {
  return scannerControllerV232.open(mode);
}

function cerrarScannerV29() {
  scannerControllerV232.close();
}

function renderVentaProductos() {
  const texto = $("#venta-buscador")?.value.trim().toLowerCase() || "";
  const lista = productos
    .filter((p) =>
      !texto ||
      [p.nombre, p.marca, p.presentacion, p.codigoBarras, p.categoria]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto)
    )
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const cont = $("#venta-productos-lista");
  if (!cont) return;
  if (!lista.length) {
    cont.innerHTML = '<p class="carrito-vacio">Sin resultados</p>';
    return;
  }
  cont.innerHTML = lista.map((p) => {
    const item = posControllerV232.getCart().find((candidate) => candidate.id === p.id);
    const disponible = p.stock - (item?.cantidad || 0);
    return `<div class="venta-producto-item ${disponible <= 0 ? "sin-stock" : ""}" data-id="${p.id}">
      <div class="venta-producto-thumb">${escapeHtml((p.marca || p.nombre).slice(0, 1).toUpperCase())}</div>
      <div class="venta-producto-info">
        <div class="venta-producto-nombre">${escapeHtml(p.nombre)}</div>
        <div class="venta-producto-meta">${p.codigoBarras ? `EAN ${escapeHtml(p.codigoBarras)} · ` : ""}${formatearPrecio(p.precioVenta)} · quedan ${disponible}</div>
      </div>
    </div>`;
  }).join("");
}

function setupV29() {
  productsControllerV232.setup();
  scannerControllerV232.setup();
}




// ============================================================
// Vendify v2.28 — Sucursales / cajas / stock por sucursal
// ============================================================


// ============================================================
// Vendify v2.28 — Caja profesional
// ============================================================
const cashControllerV232 = window.VendifyCashV232.createController({
  client: supabaseClient,
  getContext: () => ({
    businessId: appContext?.business?.id || null,
    branch: { id: appContext?.branch?.id || null, name: appContext?.branch?.nombre || "Sucursal" },
    cashRegister: { id: appContext?.cashRegister?.id || null, name: appContext?.cashRegister?.nombre || "Caja" },
  }),
  setCashRegister: (cashRegister) => { appContext.cashRegister = cashRegister; },
  getCartSize: () => posControllerV232.getCart().length,
  clearCart: () => { posControllerV232.clearCart(); renderCarrito(); },
  confirm: confirmar,
  showToast: mostrarToast,
  formatCurrency: formatearPrecio,
  icon: iconV23011,
  updateContextLabels: actualizarContextSelectorLabelsV23013,
  persistOfflineContext: () => guardarContextoOfflineV231?.(),
  restoreOfflineState: () => restaurarPruebaCajaOfflineV2311?.() === true,
  persistOfflineState: () => guardarPruebaCajaOfflineV2311?.(),
  isOnline: () => navigator.onLine,
});

const offlineControllerV232 = window.VendifyOfflineCompatV232.createController({
  client: supabaseClient,
  storage: localStorage,
  getContext: () => ({
    ready: Boolean(appContext?.ready),
    userId: sesionActual?.user?.id || null,
    businessId: appContext?.business?.id || null,
    branchId: appContext?.branch?.id || null,
    cashRegisterId: appContext?.cashRegister?.id || null,
  }),
  getProducts: () => productos,
  getCartSize: () => posControllerV232.getCart().length,
  isSaleConfirming: () => posControllerV232.isConfirming(),
  hasSellPermission: () => tienePermisoV2("sell"),
  isCashOpenByCurrentUser: () => cashControllerV232.isOpenByCurrentUser(),
  getCashState: () => cashControllerV232.getState(),
  setCashState: (state) => cashControllerV232.setState(state),
  ensureRequestId: () => posControllerV232.ensureRequestId(),
  clearPersistedCart: () => {
    try {
      localStorage.removeItem(safeBusinessKeyV231(VENDIFY_CART_PREFIX_V231));
    } catch {}
  },
  persistProducts: () => guardarProductosOfflineV231?.(),
  persistCart: () => guardarCarritoV231?.(),
  renderProducts: renderGrid,
  renderSaleProducts: renderVentaProductos,
  renderCashHeader: () => cashControllerV232.renderHeader(),
  renderCart: renderCarrito,
  reloadProducts: cargarProductos,
  reloadCash: cargarEstadoCajaV227,
  reloadCommercialFoundation: cargarCommercialFoundationV231,
  setConnectionState: (state, label) => setConnectionStateV23011?.(state, label),
  showToast: mostrarToast,
});

async function cargarCajasSucursalV227({ mantener = true } = {}) {
  await cashControllerV232.loadRegisters({ keep: mantener });
}

async function cambiarCajaDesdeSelectorV227(e) {
  await cashControllerV232.selectRegister(e.target.value);
}

async function cargarEstadoCajaV227() {
  await cashControllerV232.loadState();
}
function cajaAbiertaMiaV227(){return cashControllerV232.isOpenByCurrentUser();}
function renderEstadoCajaHeaderV227(){cashControllerV232.renderHeader();}
async function abrirPanelCajaV227(){await cashControllerV232.openPanel();}
async function renderPanelCajaV227(){await cashControllerV232.renderPanel();}
function formatearFechaHoraV227(v){if(!v)return"—";try{return new Intl.DateTimeFormat("es-AR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(v));}catch{return String(v);}}
async function inicializarCajaV227(){await cashControllerV232.initialize();}
function setupCajaV227(){cashControllerV232.setup();}

let sucursalesV226 = [];
let productosTransferV226 = [];

async function inicializarSucursalActivaV226() {
  let lista;

  try {
    lista = await listarSucursalesV2();
  } catch (error) {
    console.error("[V2.26] listarSucursales:", error);
    return;
  }

  sucursalesV226 = lista || [];
  renderSelectorSucursalesV226();

  if (!sucursalesV226.length) return;

  const key = appContext.business?.id
    ? `vendify_branch_${appContext.business.id}`
    : null;

  const guardada = key ? localStorage.getItem(key) : null;

  const target =
    sucursalesV226.find((s) => s.id === guardada) ||
    sucursalesV226.find((s) => s.id === appContext.branch?.id) ||
    sucursalesV226[0];

  if (target && target.id !== appContext.branch?.id) {
    await cambiarSucursalV2(target.id, { recargar: false });
  }

  const selector = $("#branch-selector-v226");
  if (selector && appContext.branch?.id) {
    selector.value = appContext.branch.id;
  }
}

function renderSelectorSucursalesV226() {
  const selector = $("#branch-selector-v226");
  if (!selector) return;

  selector.innerHTML = sucursalesV226
    .map(
      (s) =>
        `<option value="${s.id}">${escapeHtml(s.nombre)}</option>`
    )
    .join("");

  if (appContext.branch?.id) selector.value = appContext.branch.id;
  renderBranchOptionsV23013();
  actualizarContextSelectorLabelsV23013();
}

async function cambiarSucursalDesdeSelectorV226(e) {
  const nuevaId = e.target.value;
  const anteriorId = appContext.branch?.id;

  if (!nuevaId || nuevaId === anteriorId) return;

  if (posControllerV232.getCart().length) {
    const ok = await confirmar(
      "Cambiar de sucursal",
      "El carrito actual se vaciará al cambiar de sucursal."
    );

    if (!ok) {
      e.target.value = anteriorId || "";
      return;
    }
  }

  try {
    await cambiarSucursalV2(nuevaId);
    mostrarToast(`Sucursal activa: ${appContext.branch.nombre}`, "success");
  } catch (error) {
    e.target.value = anteriorId || "";
    mostrarToast(error.message, "error");
  }
}

async function listarSucursalesAdminV226() {
  const { data, error } = await supabaseClient.rpc("listar_sucursales_admin_v1");
  if (error) throw new Error(error.message);
  return data || [];
}

async function renderSucursalesConfigV226() {
  const cont = $("#sucursales-list-v226");
  if (!cont) return;

  cont.innerHTML = `<p class="hint" style="padding:1rem;text-align:center;">Cargando sucursales...</p>`;

  let lista;

  try {
    lista = await listarSucursalesAdminV226();
  } catch (error) {
    cont.innerHTML = "";
    mostrarToast(error.message, "error");
    return;
  }

  const role = appContext.membership?.role;
  const admin = ["owner", "admin"].includes(role);

  cont.innerHTML = lista
    .map((s) => {
      const cajas = Array.isArray(s.cajas) ? s.cajas : [];
      const cajaHtml = cajas.length
        ? cajas
            .map(
              (c) => `
                <div class="caja-chip-v226 ${c.activa ? "" : "inactive"}">
                  <span>${escapeHtml(c.nombre)}</span>
                  ${
                    admin
                      ? `<button
                           type="button"
                           data-branch-action="toggle-box"
                           data-caja-id="${c.id}"
                           data-activa="${c.activa ? "0" : "1"}"
                           title="${c.activa ? "Desactivar" : "Activar"}">
                           ${c.activa ? "●" : "○"}
                         </button>`
                      : ""
                  }
                </div>`
            )
            .join("")
        : `<span class="hint">Sin cajas</span>`;

      return `
        <article class="branch-card-v226 ${s.activa ? "" : "inactive"}">
          <div class="branch-card-main-v226">
            <div class="branch-card-icon-v226">⌂</div>
            <div class="branch-card-copy-v226">
              <div class="branch-card-title-v226">
                <strong>${escapeHtml(s.nombre)}</strong>
                <span class="branch-status-v226 ${s.activa ? "active" : "inactive"}">
                  ${s.activa ? "Activa" : "Inactiva"}
                </span>
                ${
                  s.id === appContext.branch?.id
                    ? `<span class="branch-status-v226 current">Actual</span>`
                    : ""
                }
              </div>
              <small>${escapeHtml(s.direccion || "Sin dirección")}</small>
            </div>

            <div class="branch-stat-v226">
              <span>Stock</span>
              <strong>${Number(s.stock_total || 0)}</strong>
            </div>
          </div>

          <div class="branch-cajas-v226">
            <span class="branch-cajas-label-v226">Cajas</span>
            <div class="branch-cajas-list-v226">${cajaHtml}</div>
          </div>

          ${
            admin
              ? `<div class="branch-card-actions-v226">
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    data-branch-action="edit"
                    data-id="${s.id}">
                    Editar
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    data-branch-action="add-box"
                    data-id="${s.id}"
                    data-name="${escapeHtml(s.nombre)}">
                    ＋ Caja
                  </button>
                </div>`
              : ""
          }
        </article>
      `;
    })
    .join("");

  cont.querySelectorAll('[data-branch-action="edit"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = lista.find((x) => x.id === btn.dataset.id);
      abrirModalSucursalV226(s);
    });
  });

  cont.querySelectorAll('[data-branch-action="add-box"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      abrirModalCajaV226(btn.dataset.id, btn.dataset.name);
    });
  });

  cont.querySelectorAll('[data-branch-action="toggle-box"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await window.VendifyCashV232.setRegisterActive(
          supabaseClient,
          btn.dataset.cajaId,
          btn.dataset.activa === "1"
        );
      } catch (error) {
        mostrarToast(error.message, "error");
        return;
      }

      await renderSucursalesConfigV226();
      await refrescarSucursalesV226();
      await cargarCajasSucursalV227({ mantener: true });
    });
  });
}

function abrirModalSucursalV226(sucursal = null) {
  const editando = Boolean(sucursal);

  $("#sucursal-modal-title-v226").textContent =
    editando ? "Editar sucursal" : "Nueva sucursal";

  $("#sucursal-id-v226").value = sucursal?.id || "";
  $("#sucursal-nombre-v226").value = sucursal?.nombre || "";
  $("#sucursal-direccion-v226").value = sucursal?.direccion || "";
  $("#sucursal-telefono-v226").value = sucursal?.telefono || "";
  $("#sucursal-activa-v226").checked = sucursal?.activa ?? true;
  $("#sucursal-activa-row-v226").classList.toggle("hidden", !editando);
  $("#sucursal-error-v226").textContent = "";

  $("#modal-sucursal-v226").classList.remove("hidden");
  setTimeout(() => $("#sucursal-nombre-v226")?.focus(), 50);
}

function cerrarModalSucursalV226() {
  $("#modal-sucursal-v226")?.classList.add("hidden");
}

async function guardarSucursalV226(e) {
  e.preventDefault();

  const id = $("#sucursal-id-v226").value;
  const errorEl = $("#sucursal-error-v226");
  const btn = $("#btn-guardar-sucursal-v226");

  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Guardando...";

  let response;

  if (id) {
    response = await supabaseClient.rpc("actualizar_sucursal_v1", {
      p_sucursal_id: id,
      p_nombre: $("#sucursal-nombre-v226").value.trim(),
      p_direccion: $("#sucursal-direccion-v226").value.trim() || null,
      p_telefono: $("#sucursal-telefono-v226").value.trim() || null,
      p_activa: $("#sucursal-activa-v226").checked,
    });
  } else {
    response = await supabaseClient.rpc("crear_sucursal_v1", {
      p_nombre: $("#sucursal-nombre-v226").value.trim(),
      p_direccion: $("#sucursal-direccion-v226").value.trim() || null,
      p_telefono: $("#sucursal-telefono-v226").value.trim() || null,
    });
  }

  btn.disabled = false;
  btn.textContent = "Guardar";

  if (response.error) {
    errorEl.textContent = response.error.message;
    return;
  }

  cerrarModalSucursalV226();
  await refrescarSucursalesV226();
  await renderSucursalesConfigV226();
  mostrarToast(id ? "Sucursal actualizada" : "Sucursal creada con Caja 1", "success");
}

function abrirModalCajaV226(sucursalId, nombreSucursal) {
  $("#caja-sucursal-id-v226").value = sucursalId;
  $("#caja-sucursal-label-v226").textContent = nombreSucursal || "";
  $("#caja-nombre-v226").value = "";
  $("#caja-error-v226").textContent = "";
  $("#modal-caja-v226").classList.remove("hidden");
  setTimeout(() => $("#caja-nombre-v226")?.focus(), 50);
}

function cerrarModalCajaV226() {
  $("#modal-caja-v226")?.classList.add("hidden");
}

async function crearCajaV226(e) {
  e.preventDefault();
  try {
    await window.VendifyCashV232.createRegister(
      supabaseClient,
      $("#caja-sucursal-id-v226").value,
      $("#caja-nombre-v226").value.trim()
    );
  } catch (error) {
    $("#caja-error-v226").textContent = error.message;
    return;
  }

  cerrarModalCajaV226();
  await renderSucursalesConfigV226();
  await refrescarSucursalesV226();
  await cargarCajasSucursalV227({ mantener: true });
  mostrarToast("Caja creada", "success");
}

async function refrescarSucursalesV226() {
  try {
    sucursalesV226 = await listarSucursalesV2();
    renderSelectorSucursalesV226();

    // Si la sucursal activa fue desactivada, pasar a la primera disponible.
    if (
      appContext.branch?.id &&
      !sucursalesV226.some((s) => s.id === appContext.branch.id) &&
      sucursalesV226[0]
    ) {
      await cambiarSucursalV2(sucursalesV226[0].id);
    }
  } catch (error) {
    console.error("[V2.26] refrescar sucursales:", error);
  }
}

async function abrirTransferenciaV226() {
  if (!["owner", "admin", "manager"].includes(appContext.membership?.role)) {
    mostrarToast("No tenés permiso para transferir stock", "error");
    return;
  }

  const activas = (await listarSucursalesV2()) || [];

  if (activas.length < 2) {
    mostrarToast("Necesitás al menos dos sucursales activas", "info");
    return;
  }

  const origen = $("#transfer-origen-v226");
  const destino = $("#transfer-destino-v226");

  const options = activas
    .map((s) => `<option value="${s.id}">${escapeHtml(s.nombre)}</option>`)
    .join("");

  origen.innerHTML = options;
  destino.innerHTML = options;

  origen.value = appContext.branch?.id || activas[0].id;
  destino.value =
    activas.find((s) => s.id !== origen.value)?.id || activas[0].id;

  $("#transfer-cantidad-v226").value = 1;
  $("#transfer-error-v226").textContent = "";

  await cargarProductosTransferV226();
  $("#modal-transferencia-v226").classList.remove("hidden");
}

function cerrarTransferenciaV226() {
  $("#modal-transferencia-v226")?.classList.add("hidden");
}

async function cargarProductosTransferV226() {
  const origenId = $("#transfer-origen-v226")?.value;
  const productoSel = $("#transfer-producto-v226");
  if (!origenId || !productoSel) return;

  const { data, error } = await supabaseClient.rpc(
    "listar_productos_sucursal_v1",
    { p_sucursal_id: origenId }
  );

  if (error) {
    mostrarToast(error.message, "error");
    return;
  }

  productosTransferV226 = (data || []).map(mapearProductoDB);

  productoSel.innerHTML = productosTransferV226
    .map(
      (p) =>
        `<option value="${p.id}">${escapeHtml(productoEtiquetaV29(p))} · stock ${p.stock}</option>`
    )
    .join("");

  actualizarDisponibleTransferV226();
}

function actualizarDisponibleTransferV226() {
  const id = $("#transfer-producto-v226")?.value;
  const p = productosTransferV226.find((x) => x.id === id);
  const el = $("#transfer-stock-disponible-v226");
  if (el) {
    el.textContent = p ? `Disponible en origen: ${p.stock}` : "";
  }
}

async function transferirStockV226(e) {
  e.preventDefault();

  const origen = $("#transfer-origen-v226").value;
  const destino = $("#transfer-destino-v226").value;
  const producto = $("#transfer-producto-v226").value;
  const cantidad = Number($("#transfer-cantidad-v226").value);
  const errorEl = $("#transfer-error-v226");

  errorEl.textContent = "";

  if (origen === destino) {
    errorEl.textContent = "Origen y destino deben ser distintos.";
    return;
  }

  const { error } = await supabaseClient.rpc("transferir_stock_v1", {
    p_producto_id: producto,
    p_origen_id: origen,
    p_destino_id: destino,
    p_cantidad: cantidad,
  });

  if (error) {
    errorEl.textContent = error.message;
    return;
  }

  cerrarTransferenciaV226();
  emitirCambioStockRealtime("transferencia");

  if ([origen, destino].includes(appContext.branch?.id)) {
    await cargarProductos();
    renderGrid();
  }

  await renderSucursalesConfigV226();
  mostrarToast("Stock transferido", "success");
}

async function abrirConfigSucursalesV226() {
  activarTabConfigV224("sucursales");
  await renderSucursalesConfigV226();
}

function setupSucursalesV226() {
  $("#branch-selector-v226")?.addEventListener(
    "change",
    cambiarSucursalDesdeSelectorV226
  );

  $("#btn-nueva-sucursal-v226")?.addEventListener(
    "click",
    () => abrirModalSucursalV226()
  );

  $("#form-sucursal-v226")?.addEventListener("submit", guardarSucursalV226);
  $("#btn-cerrar-sucursal-v226")?.addEventListener("click", cerrarModalSucursalV226);
  $("#btn-cancelar-sucursal-v226")?.addEventListener("click", cerrarModalSucursalV226);
  $("#modal-sucursal-v226 .modal-backdrop")?.addEventListener(
    "click",
    cerrarModalSucursalV226
  );

  $("#form-caja-v226")?.addEventListener("submit", crearCajaV226);
  $("#btn-cerrar-caja-v226")?.addEventListener("click", cerrarModalCajaV226);
  $("#btn-cancelar-caja-v226")?.addEventListener("click", cerrarModalCajaV226);
  $("#modal-caja-v226 .modal-backdrop")?.addEventListener(
    "click",
    cerrarModalCajaV226
  );

  $("#btn-transferir-stock-v226")?.addEventListener(
    "click",
    abrirTransferenciaV226
  );
  $("#form-transferencia-v226")?.addEventListener("submit", transferirStockV226);
  $("#btn-cerrar-transferencia-v226")?.addEventListener(
    "click",
    cerrarTransferenciaV226
  );
  $("#btn-cancelar-transferencia-v226")?.addEventListener(
    "click",
    cerrarTransferenciaV226
  );
  $("#modal-transferencia-v226 .modal-backdrop")?.addEventListener(
    "click",
    cerrarTransferenciaV226
  );

  $("#transfer-origen-v226")?.addEventListener(
    "change",
    cargarProductosTransferV226
  );
  $("#transfer-producto-v226")?.addEventListener(
    "change",
    actualizarDisponibleTransferV226
  );

  document
    .querySelector('[data-config-tab="sucursales"]')
    ?.addEventListener("click", renderSucursalesConfigV226);

  document
    .querySelector('[data-config-go="sucursales"]')
    ?.addEventListener("click", renderSucursalesConfigV226);
}

function init() {
  if (!validarEntornoSupabaseVQA()) return;

  registrarServiceWorker();
  cargarTema();
  normalizarVistaProductosVQA();
  inicializarEventos();
  setupV29();
  discountControllerV232.setup();
  posControllerV232.setup();
  salesHistoryControllerV232.setup();
  setupSucursalesV226();
  setupCajaV227();
  setupContextPickersV23013();
  inventoryControllerV232.setup();
  setupGestionMenuV230();
  purchasesControllerV232.setup();
  setupSecuritySessionGuardV2301();
  setupStabilityV23011();
  setupBackGuardV2311();
  setupCommercialFoundationV231();
  iniciarWatchdogRealtime();
  setupInstallPrompt();
  setupOnboarding();
  initAuth();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  void init();
}
