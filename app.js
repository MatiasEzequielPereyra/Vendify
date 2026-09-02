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
let carrito = []; // [{id, nombre, precioVenta, stock, cantidad}]

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
    carrito = [];
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

  const payload = (items || []).map((item) => ({
    producto_id: item.id || item.producto_id,
    cantidad: Number(item.cantidad),
  }));

  const { data, error } = await supabaseClient.rpc("registrar_venta_v2", {
    p_items: payload,
    p_medio_pago: medioPago || null,
    p_sucursal_id: appContext.branch.id,
    p_caja_id: appContext.cashRegister.id,
  });

  if (error) throw new Error(error.message || "No se pudo registrar la venta");
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
        carrito = [];
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
    getCart: () => carrito,
    getBranchId: () => appContext.branch?.id || null,
    getEditingProductId: () => productoEditandoId,
    showToast: mostrarToast,
    emitStockChange: emitirCambioStockRealtime,
    renderProducts: () => { productsControllerV232.render(); },
    renderSaleProducts: () => { renderVentaProductos(); },
    addToCart: agregarAlCarrito,
    openProductEditor: (product) => { productsControllerV232.openEditor(product); },
    activateProductOverSale: activarProductoSobreVenta,
    lookupBarcode: (code) => productsControllerV232.lookupBarcode(code),
  });

async function cargarProductos() {
  return productsControllerV232.loadProducts();
}

async function cargarCategorias() {
  return productsControllerV232.loadCategories();
}

// =====================
// Tema (se mantiene local: es solo una preferencia visual del dispositivo)
// =====================
function cargarTema() {
  const tema = localStorage.getItem(THEME_KEY) || "dark";
  document.documentElement.setAttribute("data-theme", tema === "light" ? "light" : "");
  $("#theme-icon").textContent = tema === "light" ? "🌙" : "☀️";
}

function toggleTema() {
  const actual = document.documentElement.getAttribute("data-theme");
  const nuevo = actual === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", nuevo === "light" ? "light" : "");
  localStorage.setItem(THEME_KEY, nuevo);
  $("#theme-icon").textContent = nuevo === "light" ? "🌙" : "☀️";
  mostrarToast(nuevo === "light" ? "Tema claro activado" : "Tema oscuro activado", "info");
}

// =====================
// Utilidades
// =====================
function formatearPrecio(valor) {
  return window.VendifyCoreV232.formatArs(valor);
}


function nombreCompletoProducto(p) {
  return window.VendifyCoreV232.productDisplayName(p);
}

function escapeHtml(texto) {
  return window.VendifyCoreV232.escapeHtml(texto);
}

function mostrarToast(mensaje, tipo = "success") {
  const container = $("#toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.textContent = mensaje;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 250);
  }, 2600);
}

function comprimirImagen(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Archivo no válido"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMG_SIZE || height > MAX_IMG_SIZE) {
          if (width > height) {
            height = Math.round((height * MAX_IMG_SIZE) / width);
            width = MAX_IMG_SIZE;
          } else {
            width = Math.round((width * MAX_IMG_SIZE) / height);
            height = MAX_IMG_SIZE;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = () => reject(new Error("No se pudo leer la imagen"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsDataURL(file);
  });
}


async function leerArchivoImagen(file) {
  if (!file) throw new Error("No se recibió ninguna imagen");

  // createImageBitmap suele manejar mejor fotos grandes de cámara móvil
  // y respeta orientación EXIF en navegadores modernos.
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });

      // Normalizamos a canvas para evitar diferencias entre navegadores.
      const maxSide = 2200;
      let width = bitmap.width;
      let height = bitmap.height;

      if (Math.max(width, height) > maxSide) {
        const ratio = maxSide / Math.max(width, height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("No se pudo preparar la foto"));
        img.src = canvas.toDataURL("image/jpeg", 0.9);
      });

      return img;
    } catch (error) {
      console.warn("[Foto] createImageBitmap falló, usando fallback:", error);
    }
  }

  // Fallback compatible.
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error("Formato de imagen no compatible con este navegador"));

      img.src = reader.result;
    };

    reader.onerror = () =>
      reject(new Error("No se pudo leer la imagen"));

    reader.readAsDataURL(file);
  });
}

function abrirEditorRecorte(img) {
  if (!img || !img.width || !img.height) {
    throw new Error("La imagen no pudo cargarse correctamente");
  }

  const canvas = $("#crop-canvas");
  const modal = $("#modal-crop-foto");
  const zoom = $("#crop-zoom");

  if (!canvas || !modal || !zoom) {
    throw new Error("El editor de recorte no está disponible");
  }

  cropImage = img;

  const size = canvas.width;

  cropBaseScale = Math.max(
    size / img.width,
    size / img.height
  );

  cropScale = 1;
  cropOffsetX = 0;
  cropOffsetY = 0;

  zoom.value = "1";
  modal.classList.remove("hidden");

  requestAnimationFrame(() => {
    renderCropCanvas();
  });
}


function resetearCrop() {
  if (!cropImage) return;
  cropScale = 1;
  cropOffsetX = 0;
  cropOffsetY = 0;
  const zoom = $("#crop-zoom");
  if (zoom) zoom.value = "1";
  renderCropCanvas();
}

function cerrarEditorRecorte() {
  $("#modal-crop-foto")?.classList.add("hidden");
  cropImage = null;
  cropDragging = false;
}

function renderCropCanvas() {
  if (!cropImage) return;

  const canvas = $("#crop-canvas");
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const scale = cropBaseScale * cropScale;

  const drawW = cropImage.width * scale;
  const drawH = cropImage.height * scale;

  const centerX = size / 2 + cropOffsetX;
  const centerY = size / 2 + cropOffsetY;
  const x = centerX - drawW / 2;
  const y = centerY - drawH / 2;

  // Limitar desplazamiento para que nunca quede espacio vacío.
  const maxX = Math.max(0, (drawW - size) / 2);
  const maxY = Math.max(0, (drawH - size) / 2);
  cropOffsetX = Math.max(-maxX, Math.min(maxX, cropOffsetX));
  cropOffsetY = Math.max(-maxY, Math.min(maxY, cropOffsetY));

  const finalX = size / 2 + cropOffsetX - drawW / 2;
  const finalY = size / 2 + cropOffsetY - drawH / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(cropImage, finalX, finalY, drawW, drawH);
}

function aplicarRecorteFoto() {
  if (!cropImage) return;

  const source = $("#crop-canvas");
  const output = document.createElement("canvas");

  // Suficiente calidad para el producto sin guardar fotos gigantes.
  output.width = 800;
  output.height = 800;

  const ctx = output.getContext("2d");
  ctx.drawImage(source, 0, 0, 800, 800);

  fotoActualBase64 = output.toDataURL("image/jpeg", 0.82);
  mostrarPreviewFoto(fotoActualBase64);
  cerrarEditorRecorte();
  mostrarToast("Foto recortada", "success");
}

function puntoCropDesdeEvento(e) {
  const canvas = $("#crop-canvas");
  const rect = canvas.getBoundingClientRect();
  const source = e.touches?.[0] || e;

  return {
    x: (source.clientX - rect.left) * (canvas.width / rect.width),
    y: (source.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function iniciarDragCrop(e) {
  if (!cropImage) return;
  e.preventDefault();
  cropDragging = true;
  const p = puntoCropDesdeEvento(e);
  cropLastX = p.x;
  cropLastY = p.y;
}

function moverDragCrop(e) {
  if (!cropDragging || !cropImage) return;
  e.preventDefault();

  const p = puntoCropDesdeEvento(e);
  cropOffsetX += p.x - cropLastX;
  cropOffsetY += p.y - cropLastY;
  cropLastX = p.x;
  cropLastY = p.y;

  renderCropCanvas();
}

function terminarDragCrop() {
  cropDragging = false;
}


function mostrarPreviewFoto(base64) {
  const img = $("#foto-img");
  const placeholder = $("#foto-placeholder");
  if (base64) {
    img.src = base64;
    img.classList.remove("hidden");
    placeholder.classList.add("hidden");
  } else {
    img.src = "";
    img.classList.add("hidden");
    placeholder.classList.remove("hidden");
  }
}

// =====================
// Confirmación
// =====================
function confirmar(
  titulo,
  mensaje,
  {
    okText = null,
    cancelText = "Cancelar",
    danger = null,
  } = {}
) {
  return new Promise((resolve) => {
    const destructive =
      typeof danger === "boolean"
        ? danger
        : /eliminar|borrar|anular|desactivar|cerrar sesión|salir de vendify/i.test(
            `${titulo} ${mensaje}`
          );

    const okButton = $("#btn-confirm-ok");
    const cancelButton = $("#btn-confirm-cancel");

    $("#confirm-titulo").textContent = titulo;
    $("#confirm-mensaje").textContent = mensaje;

    if (okButton) {
      okButton.textContent =
        okText || (destructive ? "Confirmar" : "Aceptar");
      okButton.className = `btn ${destructive ? "btn-danger" : "btn-primary"}`;
    }

    if (cancelButton) cancelButton.textContent = cancelText;

    $("#modal-confirm").classList.remove("hidden");
    confirmCallback = resolve;

    if (okButton) {
      okButton.onclick = () => {
        cerrarConfirm();
        resolve(true);
      };
    }

    if (cancelButton) {
      cancelButton.onclick = () => {
        cerrarConfirm();
        resolve(false);
      };
    }

    $("#btn-cerrar-confirm").onclick = () => {
      cerrarConfirm();
      resolve(false);
    };
  });
}

function cerrarConfirm() {
  $("#modal-confirm").classList.add("hidden");
  confirmCallback = null;
}

// =====================
// Categorías delegadas a TypeScript
// =====================
function renderSelectCategorias(selected = "") {
  productsControllerV232.renderCategorySelect(selected);
}

function actualizarFiltroCategorias() {
  productsControllerV232.renderCategoryFilter();
}

function renderListaCategoriasConfig() {
  productsControllerV232.renderCategoryList();
}

// Filtros de stock migrados a products-controller.ts

// =====================
// Productos de ejemplo
// =====================

/* QA: implementación legacy removida (cargarEjemplos) */


// =====================
// Render grid
// =====================

/* QA: implementación legacy removida (filtrarYOrdenar) */



// QA: la vista actual es una lista compacta única.
// Limpiamos preferencias antiguas para que PC y teléfono no difieran por localStorage.
function normalizarVistaProductosVQA() {
  const cont = $("#productos-grid");
  if (cont) {
    cont.classList.remove("vista-grid");
    cont.classList.add("vista-lista");
  }
  try { localStorage.removeItem("vendify_product_view"); } catch {}
}

/* QA: implementación legacy removida (renderGrid) */


// =====================
// Modal Producto
// =====================

/* QA: implementación legacy removida (abrirModal) */


/* QA: implementación legacy removida (cerrarModal) */


// =====================
// Modal Config
// =====================
function activarTabConfigV224(tab) {
  const target = tab || "general";

  document.querySelectorAll(".config-tab-v224").forEach((btn) => {
    const active = btn.dataset.configTab === target;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.querySelectorAll(".config-panel-v224").forEach((panel) => {
    const active = panel.dataset.configPanel === target;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
    panel.style.display = active ? "block" : "none";
  });

  const content = $(".config-content-v224");
  if (content) content.scrollTop = 0;
}

function abrirConfig(tab = "general") {
  renderListaCategoriasConfig();
  actualizarContextoUI();

  const welcomeBusiness = $("#config-welcome-business");
  if (welcomeBusiness) {
    welcomeBusiness.textContent = appContext.business?.nombre || "Tu negocio";
  }

  activarTabConfigV224(tab || "general");
  $("#modal-config").classList.remove("hidden");
  actualizarEstadoPinDescuento();
  cargarPlanV231?.();
  cargarConfigOperativaV231?.();

  requestAnimationFrame(
    () => activarTabConfigV224(tab || "general")
  );
}

function cerrarConfig() {
  $("#modal-config").classList.add("hidden");
  actualizarFiltroCategorias();
}

// =====================
// Modal Stock (ajuste manual — usa la función atómica ajustar_stock)
// =====================
function abrirModalStock(id) {
  const p = productos.find((x) => x.id === id);
  if (!p) return;
  stockAjusteId = id;
  stockAjusteValor = p.stock;
  $("#stock-nombre").textContent = p.nombre;
  $("#stock-actual").textContent = stockAjusteValor;
  $("#stock-manual").value = stockAjusteValor;
  $("#stock-motivo").value = "correccion";
  $("#stock-nota").value = "";
  $("#modal-stock").classList.remove("hidden");
}

function cerrarModalStock() {
  $("#modal-stock").classList.add("hidden");
  stockAjusteId = null;
}

function aplicarDeltaStock(delta) {
  stockAjusteValor = Math.max(0, stockAjusteValor + delta);
  $("#stock-actual").textContent = stockAjusteValor;
  $("#stock-manual").value = stockAjusteValor;
}

async function confirmarAjusteStock() {
  if (!exigirPermisoV2("adjustStock", "No tenés permiso para ajustar stock")) return;
  if (!stockAjusteId) return;

  const p = productos.find((x) => x.id === stockAjusteId);
  if (!p) return;

  const manual = parseInt($("#stock-manual").value, 10);
  const valorFinal = Number.isFinite(manual)
    ? Math.max(0, manual)
    : stockAjusteValor;

  const delta = valorFinal - Number(p.stock || 0);

  if (delta === 0) {
    cerrarModalStock();
    return;
  }

  const motivo = $("#stock-motivo")?.value || "correccion";
  const nota = $("#stock-nota")?.value.trim() || null;

  let data;
  try {
    data = await window.VendifyInventoryV232.adjustStock(
      supabaseClient,
      {
        productId: p.id,
        branchId: appContext.branch.id,
        mode: "establecer",
        quantity: valorFinal,
        reason: motivo,
        note: nota,
      }
    );
  } catch (error) {
    mostrarToast(
      error.message || "No se pudo ajustar el stock",
      "error"
    );
    return;
  }

  p.stock = Number(data.stock || valorFinal);
  emitirCambioStockRealtime("ajuste_inventario");
  await cargarStockInteligente();
  renderGrid();

  mostrarToast(
    `Stock de "${p.nombre}" → ${Number(data.stock || valorFinal)}`,
    "success"
  );

  cerrarModalStock();
}

// CRUD, borrado masivo y cola de stock migrados a products-controller.ts








// ============================================================
// Security v2.30.1 — sesión inactiva
// ============================================================

const SECURITY_IDLE_TIMEOUT_MS_V2301 = 8 * 60 * 60 * 1000;
const SECURITY_ACTIVITY_KEY_V2301 = "vendify_last_activity_v2301";
let securityLastPersistV2301 = 0;
let securityIdleTimerV2301 = null;
let securityLogoutRunningV2301 = false;

function registrarActividadSeguraV2301() {
  const now = Date.now();

  // Evitar escribir localStorage por cada mousemove/touch.
  if (now - securityLastPersistV2301 < 30000) return;

  securityLastPersistV2301 = now;
  localStorage.setItem(SECURITY_ACTIVITY_KEY_V2301, String(now));
}

async function verificarSesionInactivaV2301() {
  if (securityLogoutRunningV2301 || !sesionActual?.user) return;

  const last = Number(
    localStorage.getItem(SECURITY_ACTIVITY_KEY_V2301) || Date.now()
  );

  if (Date.now() - last < SECURITY_IDLE_TIMEOUT_MS_V2301) return;

  securityLogoutRunningV2301 = true;

  try {
    mostrarToast(
      "La sesión se cerró por inactividad. Volvé a ingresar para continuar.",
      "info"
    );
    await cerrarSesion();
  } finally {
    securityLogoutRunningV2301 = false;
  }
}

function setupSecuritySessionGuardV2301() {
  registrarActividadSeguraV2301();

  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(
      eventName,
      registrarActividadSeguraV2301,
      { passive: true, capture: true }
    );
  });

  window.addEventListener("focus", () => {
    verificarSesionInactivaV2301();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      verificarSesionInactivaV2301();
    }
  });

  if (!securityIdleTimerV2301) {
    securityIdleTimerV2301 = setInterval(
      verificarSesionInactivaV2301,
      60000
    );
  }
}



// ============================================================
// Vendify v2.30.1.1 — Stability & Data Integrity
// ============================================================

const VENDIFY_VERSION_V23011 = "2.31.0";
let ventaRequestIdV23011 = null;
let ventaConfirmandoV23011 = false;
let cajaOperacionEnCursoV23011 = false;
let syncInFlightV23011 = null;

function nuevaRequestIdV23011() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function asegurarVentaRequestIdV23011() {
  if (!ventaRequestIdV23011) ventaRequestIdV23011 = nuevaRequestIdV23011();
  return ventaRequestIdV23011;
}

function setConnectionStateV23011(state = "online", label = null) {
  const el = $("#connection-status-v23011");
  const text = $("#connection-label-v23011");
  if (!el || !text) return;

  el.classList.remove("online", "offline", "syncing", "error");
  el.classList.add(state);

  const labels = {
    online: "Online",
    offline: "Sin conexión",
    syncing: "Sincronizando",
    error: "Error de sync",
  };

  text.textContent = label || labels[state] || state;

  const icon = el.querySelector("use");
  if (icon) {
    icon.setAttribute(
      "href",
      state === "offline" || state === "error" ? "#vi-wifi-off" : "#vi-wifi"
    );
  }
}

function actualizarEstadoConexionV23011() {
  setConnectionStateV23011(navigator.onLine ? "online" : "offline");
}

async function sincronizarTodoV23011({ toast = false } = {}) {
  if (syncInFlightV23011) return syncInFlightV23011;

  syncInFlightV23011 = (async () => {
    if (!navigator.onLine) {
      setConnectionStateV23011("offline");
      if (toast) mostrarToast("No hay conexión a internet", "info");
      return false;
    }

    setConnectionStateV23011("syncing");

    try {
      await cargarProductos();
      renderGrid();

      if (appContext?.cashRegister?.id) {
        await cargarEstadoCajaV227();
      }

      if (!$("#modal-historial")?.classList.contains("hidden")) {
        await renderHistorial();
      }

      await inventoryControllerV232.refreshOpenView();

      await purchasesControllerV232.refreshOpenViews();

      setConnectionStateV23011("online");
      if (toast) mostrarToast("Datos sincronizados", "success");
      return true;
    } catch (error) {
      console.error("[Vendify Stability] sync:", error);
      setConnectionStateV23011("error");
      if (toast) mostrarToast(error.message || "No se pudo sincronizar", "error");
      return false;
    }
  })().finally(() => {
    syncInFlightV23011 = null;
  });

  return syncInFlightV23011;
}

function modalVisibleV23011(modal) {
  return Boolean(modal && !modal.classList.contains("hidden") && !modal.hidden);
}

function cerrarMenusFlotantesV23011() {
  abrirCerrarMenuUsuarioV224?.(false);
  abrirCerrarGestionV230?.(false);
  cerrarContextPickersV23013?.();
}

function sincronizarEstadoOverlaysV23011() {
  const visibles = Array.from(document.querySelectorAll(".modal"))
    .filter(modalVisibleV23011);

  document.body.classList.toggle("vendify-modal-open-v23011", visibles.length > 0);

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.setAttribute(
      "aria-hidden",
      modalVisibleV23011(modal) ? "false" : "true"
    );
  });

  if (visibles.length) cerrarMenusFlotantesV23011();
}

function setupOverlayStabilityV23011() {
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.type === "attributes")) {
      sincronizarEstadoOverlaysV23011();
    }
  });

  document.querySelectorAll(".modal").forEach((modal) => {
    observer.observe(modal, {
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (!$("#gestion-menu-v230")?.classList.contains("hidden")) {
      abrirCerrarGestionV230(false);
      return;
    }

    if (!$("#user-menu")?.classList.contains("hidden")) {
      abrirCerrarMenuUsuarioV224(false);
      return;
    }

    const closable = [
      ["modal-confirm", "btn-confirm-cancel"],
      ["modal-discount-auth", "btn-cancel-discount-auth"],
      ["modal-scanner-v29", "btn-close-scanner-v29"],
      ["modal-ticket-v228", "btn-close-ticket-v228"],
      ["modal-dashboard-v231", "btn-close-dashboard-v231"],
      ["modal-platform-admin-v231", "btn-close-platform-v231"],
      ["modal-diagnostico-v23011", "btn-close-diagnostic-v23011"],
      ["modal-inventario", "btn-close-inventory"],
      ["modal-compras", "btn-close-compras"],
      ["modal-historial", "btn-cerrar-historial"],
      ["modal-caja-operativa-v227", "btn-cerrar-caja-panel-v227"],
      ["modal-config", "btn-cerrar-config"],
      ["modal-equipo", "btn-cerrar-equipo"],
    ];

    for (const [modalId, closeId] of closable) {
      const modal = document.getElementById(modalId);
      if (modalVisibleV23011(modal)) {
        e.preventDefault();
        document.getElementById(closeId)?.click();
        break;
      }
    }
  });

  sincronizarEstadoOverlaysV23011();
}

async function abrirDiagnosticoV23011() {
  const role = appContext.membership?.role;
  if (!["owner", "admin"].includes(role)) {
    mostrarToast("Solo Propietario o Administrador pueden ejecutar diagnósticos", "error");
    return;
  }

  $("#diag-connection-v23011").textContent = navigator.onLine ? "Online" : "Sin conexión";
  $("#diag-branch-v23011").textContent = appContext.branch?.nombre || "Sin sucursal";
  $("#diag-cash-v23011").textContent = appContext.cashRegister?.nombre || "Sin caja";
  $("#diagnostic-summary-v23011").textContent =
    "Ejecutá el diagnóstico para revisar la integridad.";
  $("#diagnostic-issues-v23011").innerHTML = "";

  $("#modal-diagnostico-v23011").classList.remove("hidden");
}

function cerrarDiagnosticoV23011() {
  $("#modal-diagnostico-v23011")?.classList.add("hidden");
}

function renderDiagnosticoV23011(data) {
  const summary = $("#diagnostic-summary-v23011");
  const issues = $("#diagnostic-issues-v23011");
  if (!summary || !issues) return;

  const rows = Array.isArray(data?.issues) ? data.issues : [];
  const critical = rows.filter((x) => x.severity === "critical").length;
  const warning = rows.filter((x) => x.severity === "warning").length;

  summary.className =
    `diagnostic-summary-v23011 ${critical ? "critical" : warning ? "warning" : "ok"}`;

  summary.innerHTML = critical
    ? `<strong>${critical} problema(s) crítico(s)</strong><span>Revisalos antes de continuar operando.</span>`
    : warning
      ? `<strong>${warning} advertencia(s)</strong><span>No bloquean la operación, pero conviene revisarlas.</span>`
      : `<strong>Integridad OK</strong><span>No se detectaron inconsistencias en los controles automáticos.</span>`;

  if (!rows.length) {
    issues.innerHTML = `
      <div class="diagnostic-empty-v23011">
        <svg class="vendify-icon"><use href="#vi-check"></use></svg>
        <span>Sin problemas detectados.</span>
      </div>`;
    return;
  }

  issues.innerHTML = rows.map((issue) => `
    <article class="diagnostic-issue-v23011 ${escapeHtml(issue.severity || "warning")}">
      <div class="diagnostic-issue-icon-v23011">
        <svg class="vendify-icon"><use href="#vi-${issue.severity === "critical" ? "alert" : "diagnostic"}"></use></svg>
      </div>
      <div>
        <strong>${escapeHtml(issue.title || "Control")}</strong>
        <p>${escapeHtml(issue.detail || "")}</p>
      </div>
      <span>${Number(issue.count || 0)}</span>
    </article>
  `).join("");
}

async function ejecutarDiagnosticoV23011() {
  const btn = $("#btn-run-diagnostic-v23011");
  const original = btn?.innerHTML;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "Ejecutando...";
  }

  try {
    const { data, error } = await supabaseClient.rpc(
      "diagnostico_integridad_v1"
    );

    if (error) throw error;
    renderDiagnosticoV23011(data || {});
  } catch (error) {
    $("#diagnostic-summary-v23011").className =
      "diagnostic-summary-v23011 critical";
    $("#diagnostic-summary-v23011").innerHTML =
      `<strong>No se pudo ejecutar el diagnóstico</strong><span>${escapeHtml(error.message || "Error desconocido")}</span>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

function setupStabilityV23011() {
  actualizarEstadoConexionV23011();

  window.addEventListener("online", () => {
    setConnectionStateV23011("syncing");
    sincronizarTodoV23011();
  });

  window.addEventListener("offline", actualizarEstadoConexionV23011);

  $("#connection-status-v23011")?.addEventListener(
    "click",
    async () => {
      if (
        navigator.onLine &&
        typeof leerVentasOfflineV2311 === "function" &&
        leerVentasOfflineV2311().length > 0
      ) {
        await sincronizarVentasOfflineV2311({
          mostrarResumen: true,
          incluirRevision: true,
        });
      }

      await sincronizarTodoV23011({
        toast: true,
      });
    }
  );

  $("#btn-diagnostico-v23011")?.addEventListener(
    "click",
    abrirDiagnosticoV23011
  );

  $("#btn-close-diagnostic-v23011")?.addEventListener(
    "click",
    cerrarDiagnosticoV23011
  );

  $("#modal-diagnostico-v23011 .modal-backdrop")?.addEventListener(
    "click",
    cerrarDiagnosticoV23011
  );

  $("#btn-sync-now-v23011")?.addEventListener(
    "click",
    () => sincronizarTodoV23011({ toast: true })
  );

  $("#btn-run-diagnostic-v23011")?.addEventListener(
    "click",
    ejecutarDiagnosticoV23011
  );

  setupOverlayStabilityV23011();
}


// ============================================================
// Vendify v2.30.1.3 — Context pickers (Sucursal / Caja)
// ============================================================

function cerrarContextPickersV23013(except = null) {
  [
    ["branch-menu-v23013", "branch-trigger-v23013"],
    ["cash-menu-v23013", "cash-trigger-v23013"],
  ].forEach(([menuId, triggerId]) => {
    if (except === menuId) return;
    const menu = document.getElementById(menuId);
    const trigger = document.getElementById(triggerId);
    menu?.classList.add("hidden");
    trigger?.setAttribute("aria-expanded", "false");
  });
}

function abrirCerrarContextPickerV23013(kind, force) {
  const isBranch = kind === "branch";
  const menu = document.getElementById(
    isBranch ? "branch-menu-v23013" : "cash-menu-v23013"
  );
  const trigger = document.getElementById(
    isBranch ? "branch-trigger-v23013" : "cash-trigger-v23013"
  );

  if (!menu || !trigger) return;

  const open =
    typeof force === "boolean"
      ? force
      : menu.classList.contains("hidden");

  if (!open) {
    menu.classList.add("hidden");
    trigger.setAttribute("aria-expanded", "false");
    return;
  }

  cerrarContextPickersV23013(menu.id);
  abrirCerrarMenuUsuarioV224?.(false);
  abrirCerrarGestionV230?.(false);

  menu.classList.remove("hidden");
  trigger.setAttribute("aria-expanded", "true");

  requestAnimationFrame(() => {
    posicionarPopoverAncladoV23012(menu, trigger, {
      minWidth: 248,
      maxWidth: 300,
      gap: 8,
      margin: 10,
    });
  });
}

function actualizarContextSelectorLabelsV23013() {
  const branchLabel = $("#branch-current-label-v23013");
  const cashLabel = $("#cash-current-label-v23013");

  if (branchLabel) {
    branchLabel.textContent = appContext.branch?.nombre || "Sin sucursal";
    branchLabel.title = appContext.branch?.nombre || "";
  }

  if (cashLabel) {
    cashLabel.textContent = appContext.cashRegister?.nombre || "Sin caja";
    cashLabel.title = appContext.cashRegister?.nombre || "";
  }
}

function renderBranchOptionsV23013() {
  const cont = $("#branch-options-v23013");
  if (!cont) return;

  if (!sucursalesV226.length) {
    cont.innerHTML = `
      <div class="context-picker-empty-v23013">
        No hay sucursales disponibles.
      </div>`;
    actualizarContextSelectorLabelsV23013();
    return;
  }

  cont.innerHTML = sucursalesV226
    .map((s) => {
      const active = s.id === appContext.branch?.id;
      return `
        <button type="button"
                class="context-picker-option-v23013 ${active ? "active" : ""}"
                role="option"
                aria-selected="${active ? "true" : "false"}"
                data-context-branch="${s.id}">
          <span class="context-option-icon-v23013">
            ${iconV23011("store")}
          </span>
          <span class="context-option-copy-v23013">
            <strong>${escapeHtml(s.nombre)}</strong>
            <small>${active ? "Sucursal actual" : "Cambiar a esta sucursal"}</small>
          </span>
          <span class="context-option-check-v23013">
            ${active ? iconV23011("check") : ""}
          </span>
        </button>`;
    })
    .join("");

  actualizarContextSelectorLabelsV23013();
}

function renderCashOptionsV23013() {
  const cont = $("#cash-options-v23013");
  if (!cont) return;

  if (!cajasSucursalV227.length) {
    cont.innerHTML = `
      <div class="context-picker-empty-v23013">
        Esta sucursal no tiene cajas disponibles.
      </div>`;
    actualizarContextSelectorLabelsV23013();
    return;
  }

  cont.innerHTML = cajasSucursalV227
    .map((c) => {
      const active = c.id === appContext.cashRegister?.id;
      return `
        <button type="button"
                class="context-picker-option-v23013 ${active ? "active" : ""}"
                role="option"
                aria-selected="${active ? "true" : "false"}"
                data-context-cash="${c.id}">
          <span class="context-option-icon-v23013">
            ${iconV23011("register")}
          </span>
          <span class="context-option-copy-v23013">
            <strong>${escapeHtml(c.nombre)}</strong>
            <small>${active ? "Caja actual" : "Cambiar a esta caja"}</small>
          </span>
          <span class="context-option-check-v23013">
            ${active ? iconV23011("check") : ""}
          </span>
        </button>`;
    })
    .join("");

  actualizarContextSelectorLabelsV23013();
}

async function seleccionarSucursalV23013(id) {
  const selector = $("#branch-selector-v226");
  if (!selector || !id || id === appContext.branch?.id) {
    abrirCerrarContextPickerV23013("branch", false);
    return;
  }

  selector.value = id;
  await cambiarSucursalDesdeSelectorV226({ target: selector });
  renderBranchOptionsV23013();
  renderCashOptionsV23013();
  actualizarContextSelectorLabelsV23013();
  abrirCerrarContextPickerV23013("branch", false);
}

async function seleccionarCajaV23013(id) {
  const selector = $("#cash-selector-v227");
  if (!selector || !id || id === appContext.cashRegister?.id) {
    abrirCerrarContextPickerV23013("cash", false);
    return;
  }

  selector.value = id;
  await cambiarCajaDesdeSelectorV227({ target: selector });
  renderCashOptionsV23013();
  actualizarContextSelectorLabelsV23013();
  abrirCerrarContextPickerV23013("cash", false);
}

function setupContextPickersV23013() {
  $("#branch-trigger-v23013")?.addEventListener("click", () => {
    abrirCerrarContextPickerV23013("branch");
  });

  $("#cash-trigger-v23013")?.addEventListener("click", () => {
    abrirCerrarContextPickerV23013("cash");
  });

  $("#branch-options-v23013")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-context-branch]");
    if (btn) seleccionarSucursalV23013(btn.dataset.contextBranch);
  });

  $("#cash-options-v23013")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-context-cash]");
    if (btn) seleccionarCajaV23013(btn.dataset.contextCash);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".context-picker-v23013")) {
      cerrarContextPickersV23013();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") cerrarContextPickersV23013();
  });

  const closeOnScroll = () => cerrarContextPickersV23013();

  window.addEventListener("scroll", closeOnScroll, { passive: true });
  $(".header-actions-vpro")?.addEventListener("scroll", closeOnScroll, {
    passive: true,
  });

  window.addEventListener("resize", () => {
    const branchMenu = $("#branch-menu-v23013");
    const cashMenu = $("#cash-menu-v23013");

    if (branchMenu && !branchMenu.classList.contains("hidden")) {
      posicionarPopoverAncladoV23012(
        branchMenu,
        $("#branch-trigger-v23013"),
        { minWidth: 248, maxWidth: 300 }
      );
    }

    if (cashMenu && !cashMenu.classList.contains("hidden")) {
      posicionarPopoverAncladoV23012(
        cashMenu,
        $("#cash-trigger-v23013"),
        { minWidth: 248, maxWidth: 300 }
      );
    }
  });

  renderBranchOptionsV23013();
  renderCashOptionsV23013();
}


// ============================================================
// Vendify v2.31.1 — Navegación Atrás / salida accidental
// ============================================================

let backGuardInstalledV2311 = false;
let backGuardExitConfirmingV2311 = false;
let backGuardEnabledV2311 = true;

function appVisibleV2311() {
  return (
    appContext?.ready === true &&
    !$(".app")?.classList.contains("hidden")
  );
}

function armarBackGuardV2311() {
  if (!backGuardEnabledV2311) return;

  const current = history.state || {};

  history.replaceState(
    {
      ...current,
      vendifyBaseV2311: true,
    },
    "",
    location.href
  );

  history.pushState(
    {
      vendifyGuardV2311: true,
    },
    "",
    location.href
  );
}

function rearmarBackGuardV2311() {
  if (!backGuardEnabledV2311) return;

  const state = history.state || {};
  if (state.vendifyGuardV2311) return;

  history.pushState(
    {
      vendifyGuardV2311: true,
    },
    "",
    location.href
  );
}

function popoverAbiertoV2311() {
  const menus = [
    $("#gestion-menu-v230"),
    $("#user-menu"),
    $("#branch-menu-v23013"),
    $("#cash-menu-v23013"),
  ];

  return menus.some(
    (menu) =>
      menu &&
      !menu.classList.contains("hidden")
  );
}

function cerrarPopoverAbiertoV2311() {
  if (!popoverAbiertoV2311()) return false;

  abrirCerrarGestionV230?.(false);
  abrirCerrarMenuUsuarioV224?.(false);
  cerrarContextPickersV23013?.();

  return true;
}

function modalSuperiorVisibleV2311() {
  const visibles = Array.from(
    document.querySelectorAll(".modal")
  ).filter((modal) => modalVisibleV23011(modal));

  if (!visibles.length) return null;

  return visibles
    .map((modal, index) => ({
      modal,
      index,
      z: Number.parseInt(
        getComputedStyle(modal).zIndex || "0",
        10
      ) || 0,
    }))
    .sort((a, b) => {
      if (b.z !== a.z) return b.z - a.z;
      return b.index - a.index;
    })[0]?.modal || null;
}

async function cerrarCapaSuperiorV2311() {
  if (cerrarPopoverAbiertoV2311()) {
    return true;
  }

  const modal = modalSuperiorVisibleV2311();
  if (!modal) return false;

  // Venta requiere cuidado para no perder el carrito con un gesto accidental.
  if (modal.id === "modal-venta") {
    if (carrito.length > 0) {
      const cerrar = await confirmar(
        "¿Cerrar esta venta?",
        "El carrito actual se descartará.",
        {
          okText: "Cerrar venta",
          cancelText: "Seguir vendiendo",
          danger: false,
        }
      );

      if (cerrar) cerrarVenta();
    } else {
      cerrarVenta();
    }

    return true;
  }

  // La confirmación genérica se interpreta como Cancelar al volver.
  if (modal.id === "modal-confirm") {
    $("#btn-confirm-cancel")?.click();
    return true;
  }

  const closeButton =
    modal.querySelector(
      'button[id*="close"], button[id*="cerrar"]'
    ) ||
    modal.querySelector(
      'button[id*="cancel"], button[id*="cancelar"]'
    );

  if (closeButton) {
    closeButton.click();
    return true;
  }

  // Fallback seguro: solo ocultamos una capa que realmente es modal.
  modal.classList.add("hidden");
  return true;
}

function intentarSalirVendifyV2311() {
  backGuardEnabledV2311 = false;
  window.removeEventListener(
    "popstate",
    manejarBackVendifyV2311
  );

  const currentUrl = location.href;
  let moved = false;

  const markMoved = () => {
    moved = location.href !== currentUrl;
  };

  window.addEventListener(
    "pagehide",
    () => {
      moved = true;
    },
    { once: true }
  );

  // En una pestaña normal, vuelve a la página anterior si existe.
  history.back();

  // Una ventana/PWA instalada puede no tener historial anterior.
  // window.close() es un intento adicional; algunos contenedores PWA
  // lo permiten y los navegadores comunes pueden ignorarlo.
  setTimeout(() => {
    markMoved();
    if (moved || document.visibilityState === "hidden") return;

    try {
      window.close();
    } catch {}
  }, 180);

  // Si el sistema operativo no permite cierre programático, dejamos de
  // interceptar Atrás para que el siguiente gesto sea nativo.
  setTimeout(() => {
    markMoved();

    if (!moved && document.visibilityState !== "hidden") {
      mostrarToast(
        "El sistema no permite cerrar esta PWA por código. El próximo gesto Atrás saldrá normalmente.",
        "info"
      );
    }
  }, 550);
}

async function manejarBackVendifyV2311() {
  if (!backGuardEnabledV2311 || !appVisibleV2311()) {
    return;
  }

  // En este punto el navegador ya consumió la entrada "guard" y estamos
  // sobre la entrada base.
  const handled = await cerrarCapaSuperiorV2311();

  if (handled) {
    rearmarBackGuardV2311();
    return;
  }

  if (backGuardExitConfirmingV2311) {
    rearmarBackGuardV2311();
    return;
  }

  backGuardExitConfirmingV2311 = true;

  const salir = await confirmar(
    "¿Salir de Vendify?",
    "No hay ninguna pantalla abierta. ¿Querés salir de la aplicación?",
    {
      okText: "Salir",
      cancelText: "Seguir en Vendify",
      danger: true,
    }
  );

  backGuardExitConfirmingV2311 = false;

  if (!salir) {
    rearmarBackGuardV2311();
    return;
  }

  intentarSalirVendifyV2311();
}

function setupBackGuardV2311() {
  if (backGuardInstalledV2311) return;
  backGuardInstalledV2311 = true;
  backGuardEnabledV2311 = true;

  armarBackGuardV2311();

  window.addEventListener(
    "popstate",
    manejarBackVendifyV2311
  );
}

// ============================================================
// Vendify v2.31 — Commercial Foundation
// ============================================================

const VENDIFY_VERSION_V231 = "2.31.1";
const VENDIFY_CART_PREFIX_V231 = "vendify_cart_v231";
const VENDIFY_CONTEXT_PREFIX_V231 = "vendify_context_v231";
const VENDIFY_PRODUCTS_PREFIX_V231 = "vendify_products_v231";
const VENDIFY_CATEGORIES_PREFIX_V231 = "vendify_categories_v231";
const VENDIFY_ONBOARDING_HIDE_PREFIX_V231 = "vendify_onboarding_hide_v231";

let commercialConfigV231 = {
  stock_cobertura_alerta: 3,
  ajuste_grande_unidades: 10,
  diferencia_caja_alerta: 10000,
  resumen_diario: true,
  auto_imprimir_ticket: false,
  ancho_ticket_mm: 80,
};

let commercialRefreshTimerV231 = null;
let errorLogThrottleV231 = new Map();

function esSupervisorV231() {
  return ["owner", "admin", "manager"].includes(appContext.membership?.role);
}

function esOwnerV231() {
  return appContext.membership?.role === "owner";
}

function safeBusinessKeyV231(prefix) {
  const uid = sesionActual?.user?.id || "anon";
  const business = appContext.business?.id || "none";
  const branch = appContext.branch?.id || "none";
  return `${prefix}:${uid}:${business}:${branch}`;
}

function descargarBlobV231(contenido, tipo, nombre) {
  const blob =
    contenido instanceof Blob
      ? contenido
      : new Blob([contenido], { type: tipo });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------
// Offline seguro
// ---------------------
function guardarContextoOfflineV231() {
  if (!appContext?.ready || !sesionActual?.user?.id) return;

  try {
    localStorage.setItem(
      `${VENDIFY_CONTEXT_PREFIX_V231}:${sesionActual.user.id}`,
      JSON.stringify({
        user: appContext.user,
        business: appContext.business,
        membership: appContext.membership,
        branch: appContext.branch,
        cashRegister: appContext.cashRegister,
        permissions: appContext.permissions,
        employee: appContext.employee,
        ready: true,
        offlineMode: false,
        savedAt: new Date().toISOString(),
      })
    );
  } catch {}
}

function cargarContextoOfflineV231() {
  const uid = sesionActual?.user?.id;
  if (!uid) return null;

  try {
    const raw = localStorage.getItem(
      `${VENDIFY_CONTEXT_PREFIX_V231}:${uid}`
    );
    if (!raw) return null;

    const data = JSON.parse(raw);
    if (!data?.business?.id || !data?.membership?.role) return null;

    return {
      ...data,
      ready: true,
      offlineMode: true,
    };
  } catch {
    return null;
  }
}

function guardarProductosOfflineV231() {
  if (!appContext?.business?.id || !appContext?.branch?.id) return;

  try {
    localStorage.setItem(
      safeBusinessKeyV231(VENDIFY_PRODUCTS_PREFIX_V231),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        productos,
      })
    );
  } catch {}
}

function cargarProductosOfflineV231() {
  try {
    const raw = localStorage.getItem(
      safeBusinessKeyV231(VENDIFY_PRODUCTS_PREFIX_V231)
    );
    if (!raw) return false;

    const snapshot = JSON.parse(raw);
    if (!Array.isArray(snapshot?.productos)) return false;

    productos = snapshot.productos;
    return true;
  } catch {
    return false;
  }
}

function guardarCategoriasOfflineV231() {
  if (!appContext?.business?.id) return;

  try {
    localStorage.setItem(
      safeBusinessKeyV231(VENDIFY_CATEGORIES_PREFIX_V231),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        categorias,
      })
    );
  } catch {}
}

function cargarCategoriasOfflineV231() {
  try {
    const raw = localStorage.getItem(
      safeBusinessKeyV231(VENDIFY_CATEGORIES_PREFIX_V231)
    );

    if (!raw) return false;

    const snapshot = JSON.parse(raw);

    if (!Array.isArray(snapshot?.categorias)) {
      return false;
    }

    categorias = snapshot.categorias;
    return true;
  } catch {
    return false;
  }
}

function guardarCarritoV231() {
  if (!appContext?.business?.id || !appContext?.branch?.id) return;

  try {
    const key = safeBusinessKeyV231(VENDIFY_CART_PREFIX_V231);

    if (!carrito.length) {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        carrito,
      })
    );
  } catch {}
}

function restaurarCarritoV231() {
  if (carrito.length || !productos.length) return false;

  try {
    const raw = localStorage.getItem(
      safeBusinessKeyV231(VENDIFY_CART_PREFIX_V231)
    );
    if (!raw) return false;

    const snapshot = JSON.parse(raw);
    const restored = (snapshot?.carrito || [])
      .map((item) => {
        const product = productos.find((p) => p.id === item.id);
        if (!product || Number(product.stock || 0) <= 0) return null;

        return {
          id: product.id,
          nombre: product.nombre,
          precioVenta: product.precioVenta,
          stock: product.stock,
          cantidad: Math.max(
            1,
            Math.min(
              Number(item.cantidad || 1),
              Number(product.stock || 0)
            )
          ),
        };
      })
      .filter(Boolean);

    if (!restored.length) return false;

    carrito = restored;
    return true;
  } catch {
    return false;
  }
}

const VENDIFY_OFFLINE_SALES_PREFIX_V2311 =
  "vendify_offline_sales_v2311";
const VENDIFY_CASH_PROOF_PREFIX_V2311 =
  "vendify_cash_proof_v2311";
const VENDIFY_OFFLINE_MAX_SALES_V2311 = 200;
const VENDIFY_OFFLINE_CASH_PROOF_MAX_MS_V2311 =
  18 * 60 * 60 * 1000;

let offlineSalesSyncPromiseV2311 = null;

function offlineSalesKeyV2311() {
  const uid = sesionActual?.user?.id || "anon";
  const business = appContext.business?.id || "none";

  return `${VENDIFY_OFFLINE_SALES_PREFIX_V2311}:${uid}:${business}`;
}

function cashProofKeyV2311() {
  const uid = sesionActual?.user?.id || "anon";
  const business = appContext.business?.id || "none";
  const branch = appContext.branch?.id || "none";
  const cash = appContext.cashRegister?.id || "none";

  return `${VENDIFY_CASH_PROOF_PREFIX_V2311}:${uid}:${business}:${branch}:${cash}`;
}

function leerVentasOfflineV2311() {
  try {
    const raw = localStorage.getItem(
      offlineSalesKeyV2311()
    );

    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function guardarVentasOfflineV2311(queue) {
  try {
    localStorage.setItem(
      offlineSalesKeyV2311(),
      JSON.stringify(queue || [])
    );
    return true;
  } catch (error) {
    console.error("[Offline sales] storage:", error);
    return false;
  }
}

function resumenColaOfflineV2311() {
  const queue = leerVentasOfflineV2311();

  return {
    total: queue.length,
    pending: queue.filter(
      (sale) => sale.status !== "revision"
    ).length,
    revision: queue.filter(
      (sale) => sale.status === "revision"
    ).length,
    queue,
  };
}

function guardarPruebaCajaOfflineV2311() {
  if (
    !cajaAbiertaMiaV227() ||
    !sesionActual?.user?.id ||
    !appContext?.business?.id ||
    !appContext?.branch?.id ||
    !appContext?.cashRegister?.id
  ) {
    return;
  }

  try {
    localStorage.setItem(
      cashProofKeyV2311(),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        userId: sesionActual.user.id,
        businessId: appContext.business.id,
        branchId: appContext.branch.id,
        cashId: appContext.cashRegister.id,
        estado: cajaEstadoV227,
      })
    );
  } catch {}
}

function restaurarPruebaCajaOfflineV2311() {
  if (
    !sesionActual?.user?.id ||
    !appContext?.business?.id ||
    !appContext?.branch?.id ||
    !appContext?.cashRegister?.id
  ) {
    return false;
  }

  try {
    const raw = localStorage.getItem(
      cashProofKeyV2311()
    );

    if (!raw) return false;

    const proof = JSON.parse(raw);
    const savedAt = new Date(
      proof?.savedAt || 0
    ).getTime();

    const valid =
      proof?.userId === sesionActual.user.id &&
      proof?.businessId === appContext.business.id &&
      proof?.branchId === appContext.branch.id &&
      proof?.cashId === appContext.cashRegister.id &&
      proof?.estado?.sesion &&
      proof?.estado?.es_mia === true &&
      Number.isFinite(savedAt) &&
      Date.now() - savedAt <=
        VENDIFY_OFFLINE_CASH_PROOF_MAX_MS_V2311;

    if (!valid) return false;

    cajaEstadoV227 = proof.estado;
    renderEstadoCajaHeaderV227();
    return true;
  } catch {
    return false;
  }
}

function cajaOfflineHabilitadaV2311() {
  if (cajaAbiertaMiaV227()) return true;
  return restaurarPruebaCajaOfflineV2311();
}

function puedeCobrarOfflineV2311() {
  if (navigator.onLine) return false;
  if (!appContext?.ready) return false;
  if (!tienePermisoV2("sell")) return false;
  if (!appContext?.branch?.id) return false;
  if (!appContext?.cashRegister?.id) return false;
  if (!cajaOfflineHabilitadaV2311()) return false;

  const { total } = resumenColaOfflineV2311();
  return total < VENDIFY_OFFLINE_MAX_SALES_V2311;
}

function actualizarUIVentasOfflineV2311() {
  const state = resumenColaOfflineV2311();
  const globalBanner = $("#offline-sync-banner-v2311");
  const globalText = $("#offline-sync-text-v2311");
  const retry = $("#btn-sync-offline-sales-v2311");
  const saleBanner = $("#offline-sale-banner-v2311");
  const saleMessage = $("#offline-sale-message-v2311");
  const connection = $("#connection-status-v23011");

  const showGlobal =
    state.total > 0;

  globalBanner?.classList.toggle(
    "hidden",
    !showGlobal
  );

  if (globalText && showGlobal) {
    if (state.revision > 0) {
      globalText.textContent =
        `${state.total} venta${state.total === 1 ? "" : "s"} pendiente${state.total === 1 ? "" : "s"} · ${state.revision} requiere${state.revision === 1 ? "" : "n"} revisión`;
    } else if (navigator.onLine) {
      globalText.textContent =
        `${state.total} venta${state.total === 1 ? "" : "s"} esperando sincronización`;
    } else {
      globalText.textContent =
        `${state.total} venta${state.total === 1 ? "" : "s"} guardada${state.total === 1 ? "" : "s"} sin conexión`;
    }
  }

  if (retry) {
    retry.disabled = !navigator.onLine;
    retry.textContent =
      navigator.onLine
        ? "Sincronizar"
        : "Esperando internet";
  }

  if (connection) {
    connection.dataset.pendingOffline =
      String(state.total);

    connection.classList.toggle(
      "has-offline-sales-v2311",
      state.total > 0
    );
  }

  const offline = !navigator.onLine;
  saleBanner?.classList.toggle(
    "hidden",
    !offline
  );

  if (saleMessage && offline) {
    if (puedeCobrarOfflineV2311()) {
      saleMessage.textContent =
        state.total > 0
          ? `Podés seguir vendiendo. Hay ${state.total} venta${state.total === 1 ? "" : "s"} pendiente${state.total === 1 ? "" : "s"} de sincronización.`
          : "Podés cobrar en Efectivo o Transferencia. La venta se sincronizará automáticamente al volver internet.";
    } else {
      saleMessage.textContent =
        "Para vender sin conexión, esta caja debe haber sido abierta y verificada previamente con internet.";
    }
  }
}

function aplicarEstadoOfflineVentaV231() {
  const btn = $("#btn-cobrar");
  if (!btn) return;

  const offline = !navigator.onLine;

  btn.classList.toggle(
    "offline-enabled-v2311",
    offline && puedeCobrarOfflineV2311()
  );

  btn.classList.toggle(
    "offline-disabled-v231",
    offline && !puedeCobrarOfflineV2311()
  );

  if (offline) {
    const enabled = puedeCobrarOfflineV2311();

    btn.textContent = enabled
      ? "Cobrar offline"
      : "Cobro offline no disponible";

    btn.disabled =
      carrito.length === 0 ||
      ventaConfirmandoV23011 ||
      !enabled;

    btn.title = enabled
      ? "La venta quedará pendiente de sincronización"
      : "La caja debe haber sido verificada abierta con internet";
  } else {
    btn.textContent = "Cobrar";
    btn.title = "";
    btn.disabled =
      carrito.length === 0 ||
      ventaConfirmandoV23011;
  }

  actualizarUIVentasOfflineV2311();
}

function validarPagosOfflineV2311(pagos) {
  const permitidos = new Set([
    "Efectivo",
    "Transferencia",
  ]);

  const invalidos = (pagos || []).filter(
    (pago) => !permitidos.has(pago.medio_pago)
  );

  if (invalidos.length) {
    throw new Error(
      "Sin internet solo se permiten cobros en Efectivo o Transferencia."
    );
  }
}

function validarStockLocalVentaV2311(items) {
  for (const item of items || []) {
    const product = productos.find(
      (p) => p.id === item.id
    );

    if (!product) {
      throw new Error(
        `No se encontró "${item.nombre}" en el catálogo local.`
      );
    }

    if (
      Number(product.stock || 0) <
      Number(item.cantidad || 0)
    ) {
      throw new Error(
        `Stock local insuficiente de "${product.nombre}".`
      );
    }
  }
}

function aplicarVentaAlStockLocalV2311(items) {
  for (const item of items || []) {
    const product = productos.find(
      (p) => p.id === item.id
    );

    if (!product) continue;

    product.stock = Math.max(
      0,
      Number(product.stock || 0) -
        Number(item.cantidad || 0)
    );
  }

  guardarProductosOfflineV231?.();
  renderGrid();

  if (
    !$("#modal-venta")?.classList.contains("hidden")
  ) {
    renderVentaProductos();
  }
}

function aplicarVentaCajaLocalV2311(pagos, total) {
  if (!cajaEstadoV227?.sesion || !cajaEstadoV227?.es_mia) {
    return;
  }

  const cash = (pagos || [])
    .filter(
      (pago) => pago.medio_pago === "Efectivo"
    )
    .reduce(
      (sum, pago) =>
        sum + Number(pago.monto || 0),
      0
    );

  const session = cajaEstadoV227.sesion;

  session.ventas_total =
    Number(session.ventas_total || 0) +
    Number(total || 0);

  session.ventas_efectivo =
    Number(session.ventas_efectivo || 0) +
    cash;

  session.efectivo_esperado =
    Number(session.efectivo_esperado || 0) +
    cash;

  session.tickets =
    Number(session.tickets || 0) + 1;

  guardarPruebaCajaOfflineV2311();
  renderEstadoCajaHeaderV227();
}

function construirTicketOfflineV2311(sale) {
  return {
    venta: {
      id: sale.request_id,
      creado: sale.created_at,
      subtotal: sale.totales.subtotal,
      descuento_total: 0,
      total: sale.totales.total,
      estado: "pendiente_sincronizacion",
      observacion: sale.observacion || null,
    },
    items: sale.items.map((item) => ({
      producto_nombre: item.producto_nombre,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      subtotal:
        Number(item.precio_unitario || 0) *
        Number(item.cantidad || 0),
    })),
    pagos: sale.pagos.map((pago) => ({
      ...pago,
      operacion: "cobro",
    })),
  };
}

function registrarVentaOfflineV2311(
  items,
  pagos,
  totales,
  observacion
) {
  if (!puedeCobrarOfflineV2311()) {
    throw new Error(
      "La caja no está habilitada para ventas offline."
    );
  }

  if (
    totales?.tipo ||
    Number(totales?.descuento || 0) > 0
  ) {
    throw new Error(
      "Los descuentos requieren conexión para validar la autorización."
    );
  }

  validarPagosOfflineV2311(pagos);
  validarStockLocalVentaV2311(items);

  const queue = leerVentasOfflineV2311();

  if (
    queue.length >=
    VENDIFY_OFFLINE_MAX_SALES_V2311
  ) {
    throw new Error(
      "Se alcanzó el máximo de ventas offline pendientes. Reconectá internet antes de continuar."
    );
  }

  const requestId =
    asegurarVentaRequestIdV23011();

  const sale = {
    request_id: requestId,
    status: "pending",
    attempts: 0,
    last_error: null,
    created_at: new Date().toISOString(),

    user_id: sesionActual?.user?.id || null,
    negocio_id: appContext.business.id,
    sucursal_id: appContext.branch.id,
    caja_id: appContext.cashRegister.id,

    items: (items || []).map((item) => ({
      producto_id: item.id,
      producto_nombre: item.nombre,
      cantidad: Number(item.cantidad),
      precio_unitario: Number(item.precioVenta),
    })),

    pagos: (pagos || []).map((pago) => ({
      medio_pago: pago.medio_pago,
      monto: Number(pago.monto),
    })),

    totales: {
      subtotal: Number(totales.subtotal || 0),
      total: Number(totales.total || 0),
    },

    observacion:
      String(observacion || "").trim() || null,
  };

  const saved = guardarVentasOfflineV2311([
    ...queue,
    sale,
  ]);

  if (!saved) {
    throw new Error(
      "No hay espacio suficiente para guardar la venta sin conexión."
    );
  }

  aplicarVentaAlStockLocalV2311(items);
  aplicarVentaCajaLocalV2311(
    pagos,
    totales.total
  );

  try {
    localStorage.removeItem(
      safeBusinessKeyV231(
        VENDIFY_CART_PREFIX_V231
      )
    );
  } catch {}

  actualizarUIVentasOfflineV2311();

  return construirTicketOfflineV2311(sale);
}

function esErrorRedV2311(error) {
  const text = String(
    error?.message ||
    error ||
    ""
  ).toLowerCase();

  return (
    !navigator.onLine ||
    text.includes("failed to fetch") ||
    text.includes("network") ||
    text.includes("load failed") ||
    text.includes("internet")
  );
}

async function sincronizarVentasOfflineV2311({
  mostrarResumen = false,
  incluirRevision = false,
} = {}) {
  if (!navigator.onLine) {
    actualizarUIVentasOfflineV2311();
    return {
      synced: 0,
      revision: 0,
      pending: resumenColaOfflineV2311().total,
    };
  }

  if (offlineSalesSyncPromiseV2311) {
    return offlineSalesSyncPromiseV2311;
  }

  offlineSalesSyncPromiseV2311 = (async () => {
    let queue = leerVentasOfflineV2311();
    let synced = 0;
    let revision = 0;
    let stoppedByNetwork = false;

    for (let index = 0; index < queue.length;) {
      const sale = queue[index];

      if (
        sale.status === "revision" &&
        !incluirRevision
      ) {
        revision += 1;
        index += 1;
        continue;
      }

      const payload = sale.items.map(
        (item) => ({
          producto_id: item.producto_id,
          cantidad: Number(item.cantidad),
        })
      );

      let response;

      try {
        response = await supabaseClient.rpc(
          "registrar_venta_v4",
          {
            p_items: payload,
            p_pagos: sale.pagos,
            p_descuento_tipo: null,
            p_descuento_valor: 0,
            p_observacion: sale.observacion,
            p_sucursal_id: sale.sucursal_id,
            p_caja_id: sale.caja_id,
            p_request_id: sale.request_id,
          }
        );
      } catch (error) {
        response = {
          data: null,
          error,
        };
      }

      if (response?.error) {
        if (esErrorRedV2311(response.error)) {
          stoppedByNetwork = true;
          break;
        }

        sale.attempts =
          Number(sale.attempts || 0) + 1;

        sale.last_error =
          response.error.message ||
          "La venta necesita revisión.";

        sale.status = "revision";
        revision += 1;
        queue[index] = sale;
        guardarVentasOfflineV2311(queue);
        index += 1;
        continue;
      }

      // registrar_venta_v4 es idempotente. Si el servidor ya la recibió
      // antes de perder la respuesta, devuelve la misma venta y podemos
      // quitarla de la cola sin duplicarla.
      queue.splice(index, 1);
      guardarVentasOfflineV2311(queue);
      synced += 1;
    }

    actualizarUIVentasOfflineV2311();

    if (synced > 0) {
      try {
        await cargarProductos();
        renderGrid();
        await cargarEstadoCajaV227();
      } catch (refreshError) {
        console.warn(
          "[Offline sales] sincronizada, refresh pendiente:",
          refreshError
        );
      }
    }

    const remaining = leerVentasOfflineV2311();
    const reviewSales = remaining.filter(
      (sale) => sale.status === "revision"
    );

    if (mostrarResumen) {
      if (synced > 0 && reviewSales.length === 0) {
        mostrarToast(
          `${synced} venta${synced === 1 ? "" : "s"} offline sincronizada${synced === 1 ? "" : "s"}`,
          "success"
        );
      } else if (reviewSales.length > 0) {
        const firstError =
          reviewSales[0]?.last_error ||
          "Revisá stock y estado de caja.";

        mostrarToast(
          `${reviewSales.length} venta${reviewSales.length === 1 ? "" : "s"} requiere${reviewSales.length === 1 ? "" : "n"} revisión: ${firstError}`,
          "error"
        );
      } else if (
        stoppedByNetwork &&
        remaining.length > 0
      ) {
        mostrarToast(
          "La conexión volvió a cortarse. Las ventas siguen guardadas.",
          "info"
        );
      }
    }

    return {
      synced,
      revision: reviewSales.length,
      pending: remaining.length,
    };
  })().finally(() => {
    offlineSalesSyncPromiseV2311 = null;
  });

  return offlineSalesSyncPromiseV2311;
}

function setupOfflineSalesV2311() {
  $("#btn-sync-offline-sales-v2311")
    ?.addEventListener("click", async () => {
      await sincronizarVentasOfflineV2311({
        mostrarResumen: true,
        incluirRevision: true,
      });
    });

  actualizarUIVentasOfflineV2311();

  if (
    navigator.onLine &&
    leerVentasOfflineV2311().length > 0
  ) {
    setTimeout(() => {
      sincronizarVentasOfflineV2311({
        mostrarResumen: true,
      });
    }, 800);
  }
}

// ---------------------
// Observabilidad
// ---------------------
async function registrarErrorClienteV231(
  tipo,
  mensaje,
  contexto = {}
) {
  if (
    !navigator.onLine ||
    !sesionActual?.user ||
    !appContext?.business?.id
  ) {
    return;
  }

  const cleanMessage = String(mensaje || "Error")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 1000);

  const key = `${tipo}:${cleanMessage.slice(0, 140)}`;
  const last = errorLogThrottleV231.get(key) || 0;

  if (Date.now() - last < 30000) return;
  errorLogThrottleV231.set(key, Date.now());

  try {
    await supabaseClient.rpc("registrar_error_cliente_v1", {
      p_tipo: String(tipo || "client").slice(0, 50),
      p_mensaje: cleanMessage,
      p_version: VENDIFY_VERSION_V231,
      p_contexto: {
        path: location.pathname,
        role: appContext.membership?.role || null,
        branch_id: appContext.branch?.id || null,
        online: navigator.onLine,
        ...contexto,
      },
    });
  } catch {}
}

function setupObservabilityV231() {
  window.addEventListener("error", (event) => {
    registrarErrorClienteV231(
      "window_error",
      event.message ||
        event.error?.message ||
        "Error JavaScript",
      {
        file: event.filename
          ? event.filename.split("/").pop()
          : null,
        line: event.lineno || null,
        col: event.colno || null,
      }
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    registrarErrorClienteV231(
      "unhandled_rejection",
      reason?.message || String(reason || "Promise rechazada")
    );
  });
}



// ---------------------
// Dashboard
// ---------------------
const dashboardControllerV232 =
  window.VendifyDashboardV232.createController({
    client: supabaseClient,
    isSupervisor: esSupervisorV231,
    getBranchId: () => appContext.branch?.id || null,
    getBusinessName: () =>
      appContext.business?.nombre || "Negocio",
    closeManagement: () => abrirCerrarGestionV230(false),
    icon: iconV23011,
    showToast: mostrarToast,
    reportError: registrarErrorClienteV231,
  });

function dashboardEmptyV231(text) {
  return window.VendifyDashboardV232.dashboardEmpty(text);
}

function renderDashboardRowsV231(
  container,
  rows,
  renderRow,
  emptyText
) {
  window.VendifyDashboardV232.renderDashboardRows(
    container,
    rows,
    renderRow,
    emptyText
  );
}

async function cargarBadgeAlertasV231() {
  await dashboardControllerV232.loadAlertBadge();
}
// ---------------------
// Onboarding comercial
// ---------------------
function onboardingHideKeyV231() {
  return `${VENDIFY_ONBOARDING_HIDE_PREFIX_V231}:${
    appContext.business?.id || "none"
  }`;
}

function renderOnboardingComercialV231(data) {
  const el = $("#commercial-onboarding-v231");
  const cont = $("#commercial-onboarding-steps-v231");

  if (!el || !cont || !esOwnerV231()) {
    el?.classList.add("hidden");
    return;
  }

  if (data?.completado) {
    el.classList.add("hidden");
    try {
      localStorage.removeItem(onboardingHideKeyV231());
    } catch {}
    return;
  }

  if (localStorage.getItem(onboardingHideKeyV231()) === "1") {
    el.classList.add("hidden");
    return;
  }

  const steps = [
    {
      done: Number(data?.productos || 0) > 0,
      title: "Cargá tu catálogo",
      detail:
        Number(data?.productos || 0) > 0
          ? `${Number(data.productos)} productos listos`
          : "Agregá productos o importá un CSV.",
      action: "product",
      actionLabel: "Cargar productos",
      icon: "inventory",
    },
    {
      done: Boolean(data?.caja_utilizada),
      title: "Prepará una caja",
      detail: data?.caja_utilizada
        ? "La caja ya fue utilizada"
        : "Abrí tu primer turno de caja.",
      action: "cash",
      actionLabel: "Abrir caja",
      icon: "register",
    },
    {
      done: Number(data?.ventas || 0) > 0,
      title: "Registrá la primera venta",
      detail:
        Number(data?.ventas || 0) > 0
          ? `${Number(data.ventas)} venta(s) registradas`
          : "Probá el flujo completo de cobro.",
      action: "sale",
      actionLabel: "Vender",
      icon: "cart",
    },
    {
      done: Number(data?.miembros || 0) > 1,
      title: "Sumá a tu equipo",
      detail:
        Number(data?.miembros || 0) > 1
          ? `${Number(data.miembros)} usuarios activos`
          : "Creá al menos un empleado.",
      action: "team",
      actionLabel: "Crear empleado",
      icon: "team",
    },
  ];

  const completed = steps.filter((x) => x.done).length;
  const pct = Math.round((completed / steps.length) * 100);

  $("#commercial-progress-bar-v231").style.width = `${pct}%`;
  $("#commercial-progress-label-v231").textContent =
    `${pct}% completo · ${completed} de ${steps.length} pasos`;

  cont.innerHTML = steps
    .map(
      (step) => `
        <article class="commercial-step-v231 ${
          step.done ? "done" : ""
        }">
          <span class="commercial-step-icon-v231">
            ${iconV23011(step.done ? "check" : step.icon)}
          </span>
          <div class="commercial-step-copy-v231">
            <strong>${escapeHtml(step.title)}</strong>
            <small>${escapeHtml(step.detail)}</small>
          </div>
          ${
            step.done
              ? `<span class="commercial-step-done-v231">Listo</span>`
              : `<button type="button"
                         class="btn btn-secondary btn-sm"
                         data-onboarding-action-v231="${step.action}">
                   ${escapeHtml(step.actionLabel)}
                 </button>`
          }
        </article>`
    )
    .join("");

  el.classList.remove("hidden");
}

async function refrescarOnboardingComercialV231() {
  if (!esOwnerV231() || !navigator.onLine) return;

  try {
    const { data, error } = await supabaseClient.rpc(
      "estado_onboarding_comercial_v1"
    );

    if (!error) {
      renderOnboardingComercialV231(data || {});
    }
  } catch {}
}

// ---------------------
// Plan y configuración
// ---------------------
async function cargarPlanV231() {
  if (!navigator.onLine || !appContext?.ready) return;

  const name = $("#config-plan-name-v231");
  const detail = $("#config-plan-detail-v231");
  const usage = $("#config-plan-usage-v231");

  try {
    const { data, error } = await supabaseClient.rpc(
      "obtener_plan_actual_v1"
    );

    if (error) throw error;

    if (name) {
      name.textContent = data?.nombre || "Plan";
    }

    if (detail) {
      detail.textContent =
        data?.trial_dias_restantes != null
          ? `Prueba · ${Number(
              data.trial_dias_restantes
            )} día(s) restantes`
          : data?.estado === "legacy"
            ? "Cuenta existente sin límites comerciales aplicados."
            : `Estado: ${data?.estado || "activo"}`;
    }

    if (usage) {
      const limits = data?.limites || {};
      const use = data?.uso || {};

      const row = (label, current, limit) => `
        <span>
          <strong>${escapeHtml(label)}</strong>
          <small>
            ${Number(current || 0)}
            ${limit == null ? "" : ` / ${Number(limit)}`}
          </small>
        </span>`;

      usage.innerHTML = [
        row("Sucursales", use.sucursales, limits.sucursales),
        row("Usuarios", use.usuarios, limits.usuarios),
        row("Productos", use.productos, limits.productos),
      ].join("");
    }
  } catch {
    if (name) name.textContent = "No disponible";
    if (detail) {
      detail.textContent =
        "Ejecutá la migración comercial v2.31.";
    }
  }
}

async function cargarConfigOperativaV231() {
  if (!navigator.onLine || !esSupervisorV231()) return;

  try {
    const { data, error } = await supabaseClient.rpc(
      "obtener_config_operativa_v1"
    );

    if (error) throw error;

    commercialConfigV231 = {
      ...commercialConfigV231,
      ...(data || {}),
    };

    if ($("#config-stock-days-v231")) {
      $("#config-stock-days-v231").value =
        commercialConfigV231.stock_cobertura_alerta ?? 3;

      $("#config-adjust-threshold-v231").value =
        commercialConfigV231.ajuste_grande_unidades ?? 10;

      $("#config-cash-diff-v231").value =
        commercialConfigV231.diferencia_caja_alerta ?? 10000;

      $("#config-daily-summary-v231").checked =
        commercialConfigV231.resumen_diario !== false;

      $("#config-auto-print-v231").checked =
        commercialConfigV231.auto_imprimir_ticket === true;

      $("#config-ticket-width-v231").value = String(
        Number(commercialConfigV231.ancho_ticket_mm) === 58
          ? 58
          : 80
      );
    }
  } catch (error) {
    console.warn("[Config v2.31]", error);
  }
}

async function guardarConfigOperativaV231(event) {
  event.preventDefault();

  if (
    !["owner", "admin"].includes(
      appContext.membership?.role
    )
  ) {
    mostrarToast(
      "Solo Propietario o Administrador pueden cambiar esta configuración",
      "error"
    );
    return;
  }

  const btn = $("#btn-save-operacion-v231");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Guardando...";
  }

  try {
    const { data, error } = await supabaseClient.rpc(
      "guardar_config_operativa_v1",
      {
        p_stock_cobertura_alerta: Number(
          $("#config-stock-days-v231").value || 3
        ),
        p_ajuste_grande_unidades: Number(
          $("#config-adjust-threshold-v231").value || 10
        ),
        p_diferencia_caja_alerta: Number(
          $("#config-cash-diff-v231").value || 0
        ),
        p_resumen_diario:
          $("#config-daily-summary-v231").checked,
        p_auto_imprimir_ticket:
          $("#config-auto-print-v231").checked,
        p_ancho_ticket_mm: Number(
          $("#config-ticket-width-v231").value || 80
        ),
      }
    );

    if (error || data?.ok === false) {
      throw new Error(
        error?.message ||
          data?.message ||
          "No se pudo guardar"
      );
    }

    await cargarConfigOperativaV231();
    await cargarBadgeAlertasV231();
    mostrarToast(
      "Configuración operativa guardada",
      "success"
    );
  } catch (error) {
    mostrarToast(
      error.message || "No se pudo guardar",
      "error"
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Guardar configuración";
    }
  }
}

// ---------------------
// Respaldo
// ---------------------
async function descargarBackupOperativoV231() {
  if (!esOwnerV231()) {
    mostrarToast(
      "Solo el propietario puede descargar un respaldo completo",
      "error"
    );
    return;
  }

  const btn = $("#btn-backup-json-v231");
  if (btn) btn.disabled = true;

  try {
    const { data, error } = await supabaseClient.rpc(
      "exportar_respaldo_operativo_v1"
    );

    if (error) throw error;

    const date = new Date().toISOString().slice(0, 10);
    const business = String(
      appContext.business?.nombre || "negocio"
    )
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "");

    descargarBlobV231(
      JSON.stringify(data, null, 2),
      "application/json;charset=utf-8",
      `vendify-backup-${
        business || "negocio"
      }-${date}.json`
    );

    mostrarToast("Respaldo descargado", "success");
  } catch (error) {
    mostrarToast(
      error.message ||
        "No se pudo generar el respaldo",
      "error"
    );
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------------------
// Importación CSV
// ---------------------
function parseCSVLineV231(line) {
  const cells = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += ch;
    }
  }

  cells.push(value.trim());
  return cells;
}

function normalizarHeaderCSVV231(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function descargarPlantillaCSVV231() {
  const csv = [
    "nombre,marca,presentacion,categoria,codigo_barras,precio_compra,precio_venta,stock",
    '"Coca-Cola Original 500 ml","Coca-Cola","500 ml","Gaseosas","7790000000000","800","1200","24"',
    '"Alfajor Triple","Marca","80 g","Golosinas","","500","850","12"',
  ].join("\n");

  descargarBlobV231(
    "\uFEFF" + csv,
    "text/csv;charset=utf-8",
    "vendify-plantilla-productos.csv"
  );
}

async function importarCSVV231(file) {
  if (!file) return;

  if (!tienePermisoV2("manageProducts")) {
    mostrarToast(
      "No tenés permiso para importar productos",
      "error"
    );
    return;
  }

  const text = await file.text();
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length);

  if (lines.length < 2) {
    mostrarToast("El CSV está vacío", "error");
    return;
  }

  if (lines.length > 2001) {
    mostrarToast(
      "Importá como máximo 2000 productos por archivo",
      "error"
    );
    return;
  }

  const headers = parseCSVLineV231(lines[0]).map(
    normalizarHeaderCSVV231
  );

  const idx = (name) => headers.indexOf(name);

  if (idx("nombre") < 0) {
    mostrarToast(
      'El CSV necesita una columna "nombre"',
      "error"
    );
    return;
  }

  const num = (value) => {
    const n = Number(
      String(value || "").replace(",", ".")
    );
    return Number.isFinite(n) ? n : 0;
  };

  const items = lines
    .slice(1)
    .map((line) => {
      const row = parseCSVLineV231(line);

      return {
        nombre: row[idx("nombre")] || "",
        marca:
          idx("marca") >= 0
            ? row[idx("marca")] || ""
            : "",
        presentacion:
          idx("presentacion") >= 0
            ? row[idx("presentacion")] || ""
            : "",
        categoria:
          idx("categoria") >= 0
            ? row[idx("categoria")] || ""
            : "",
        codigo_barras:
          idx("codigo_barras") >= 0
            ? row[idx("codigo_barras")] || ""
            : "",
        precio_compra:
          idx("precio_compra") >= 0
            ? num(row[idx("precio_compra")])
            : 0,
        precio_venta:
          idx("precio_venta") >= 0
            ? num(row[idx("precio_venta")])
            : 0,
        stock:
          idx("stock") >= 0
            ? Math.max(
                0,
                Math.trunc(num(row[idx("stock")]))
              )
            : 0,
      };
    })
    .filter((item) => item.nombre.trim());

  if (!items.length) {
    mostrarToast(
      "No se encontraron productos válidos",
      "error"
    );
    return;
  }

  const ok = await confirmar(
    "Importar catálogo",
    `Se procesarán ${items.length} productos en ${
      appContext.branch?.nombre || "la sucursal activa"
    }.`,
    {
      okText: "Importar",
      cancelText: "Cancelar",
    }
  );

  if (!ok) return;

  const btn = $("#btn-import-csv-v231");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Importando...";
  }

  try {
    const { data, error } = await supabaseClient.rpc(
      "importar_productos_masivo_v1",
      {
        p_sucursal_id: appContext.branch.id,
        p_items: items,
      }
    );

    if (error || data?.ok === false) {
      throw new Error(
        error?.message ||
          data?.message ||
          "No se pudo importar"
      );
    }

    await cargarCategorias();
    await cargarProductos();
    actualizarFiltroCategorias();
    renderGrid();
    await refrescarOnboardingComercialV231();

    mostrarToast(
      `${Number(
        data?.importados || 0
      )} producto(s) importados · ${Number(
        data?.omitidos || 0
      )} omitidos`,
      "success"
    );
  } catch (error) {
    mostrarToast(
      error.message || "No se pudo importar el CSV",
      "error"
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        `${iconV23011(
          "upload"
        )}<span>Importar CSV</span>`;
    }
  }
}



// ---------------------
// Platform backoffice
// ---------------------
async function verificarPlatformAdminV231() {
  const btn = $("#btn-platform-admin-v231");
  if (!btn || !navigator.onLine) return;

  try {
    const { data, error } =
      await supabaseClient.rpc("es_admin_plataforma_v1");

    btn.classList.toggle(
      "hidden",
      error || data !== true
    );
  } catch {
    btn.classList.add("hidden");
  }
}

async function abrirPlatformAdminV231() {
  $("#modal-platform-admin-v231")?.classList.remove(
    "hidden"
  );

  try {
    const [overview, businesses, errorsResult] = await Promise.all([
      supabaseClient.rpc("platform_overview_v1"),
      supabaseClient.rpc(
        "listar_negocios_plataforma_v1",
        { p_limit: 50 }
      ),
      supabaseClient.rpc(
        "listar_errores_plataforma_v1",
        { p_limit: 30 }
      ),
    ]);

    if (overview.error) throw overview.error;
    if (businesses.error) throw businesses.error;
    if (errorsResult.error) throw errorsResult.error;

    const data = overview.data || {};

    $("#platform-businesses-v231").textContent =
      Number(data.negocios || 0);

    $("#platform-trials-v231").textContent =
      Number(data.trials || 0);

    $("#platform-sales-v231").textContent =
      formatearPrecio(Number(data.ventas_hoy || 0));

    $("#platform-errors-v231").textContent =
      Number(data.errores_24h || 0);

    renderDashboardRowsV231(
      $("#platform-business-list-v231"),
      businesses.data || [],
      (row) => `
        <div class="platform-business-row-v231" data-platform-business="${row.id}">
          <span class="dashboard-list-icon-v231">
            ${iconV23011("store")}
          </span>

          <div class="dashboard-list-copy-v231">
            <strong>${escapeHtml(row.nombre || "Negocio")}</strong>
            <small>
              ${Number(row.usuarios || 0)} usuario(s) ·
              ${Number(row.productos || 0)} productos
              ${
                row.trial_hasta
                  ? ` · trial hasta ${new Date(row.trial_hasta).toLocaleDateString("es-AR")}`
                  : ""
              }
            </small>
          </div>

          <div class="platform-plan-controls-v231">
            <select class="platform-plan-select-v231" aria-label="Plan del negocio">
              ${["legacy","trial","starter","pro","business"]
                .map((plan) =>
                  `<option value="${plan}" ${row.plan_codigo === plan ? "selected" : ""}>${plan === "trial" ? "Prueba Pro" : plan.charAt(0).toUpperCase() + plan.slice(1)}</option>`
                )
                .join("")}
            </select>

            <select class="platform-state-select-v231" aria-label="Estado de suscripción">
              ${["legacy","trial","activo","vencido","suspendido"]
                .map((state) =>
                  `<option value="${state}" ${row.estado === state ? "selected" : ""}>${state}</option>`
                )
                .join("")}
            </select>

            <button type="button"
                    class="btn btn-secondary btn-sm"
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

  window.addEventListener("offline", () => {
    guardarCarritoV231();
    guardarPruebaCajaOfflineV2311?.();
    aplicarEstadoOfflineVentaV231();
    actualizarUIVentasOfflineV2311();
  });

  window.addEventListener(
    "online",
    async () => {
      setConnectionStateV23011?.(
        "syncing",
        "Sincronizando"
      );

      await sincronizarVentasOfflineV2311({
        mostrarResumen: true,
      });

      aplicarEstadoOfflineVentaV231();
      await cargarCommercialFoundationV231();

      try {
        await cargarEstadoCajaV227();
      } catch {}

      renderCarrito();
      actualizarUIVentasOfflineV2311();

      if (navigator.onLine) {
        setConnectionStateV23011?.(
          "online"
        );
      }
    }
  );

  window.addEventListener("focus", () => {
    if (
      navigator.onLine &&
      leerVentasOfflineV2311().length > 0
    ) {
      sincronizarVentasOfflineV2311({
        mostrarResumen: false,
      });
    }
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
// Seguridad de descuentos — PIN Owner/Admin
// ============================================================

let descuentoAutorizacion = null;

function solicitudDescuentoActual() {
  const subtotal = Number(calcularTotalCarrito().toFixed(2));
  const tipo = $("#venta-descuento-tipo-v228")?.value || "";
  let valor = Number($("#venta-descuento-valor-v228")?.value || 0);

  if (tipo === "porcentaje") {
    valor = Math.max(0, Math.min(100, valor));
  } else if (tipo === "monto") {
    valor = Math.max(0, Math.min(subtotal, valor));
  } else {
    valor = 0;
  }

  return {
    subtotal,
    tipo: tipo || null,
    valor: Number(valor.toFixed(2)),
  };
}

function autorizacionDescuentoCoincide() {
  if (!descuentoAutorizacion?.ok) return false;

  const actual = solicitudDescuentoActual();

  return (
    actual.tipo === descuentoAutorizacion.tipo &&
    Math.abs(actual.valor - descuentoAutorizacion.valor) <= 0.001 &&
    Math.abs(actual.subtotal - descuentoAutorizacion.subtotal) <= 0.01 &&
    Date.now() < descuentoAutorizacion.expiraMs
  );
}

function actualizarUIAutorizacionDescuento() {
  const btn = $("#btn-autorizar-descuento");
  const status = $("#discount-auth-status");
  const caption = $("#discount-auth-caption");
  const solicitud = solicitudDescuentoActual();

  const tieneSolicitud =
    Boolean(solicitud.tipo) &&
    solicitud.valor > 0 &&
    solicitud.subtotal > 0;

  const autorizada = tieneSolicitud && autorizacionDescuentoCoincide();

  if (btn) {
    btn.disabled = !tieneSolicitud || autorizada;
    const checkIcon =
      typeof iconV23011 === "function"
        ? iconV23011("check")
        : '<span aria-hidden="true">✓</span>';

    const lockIcon =
      typeof iconV23011 === "function"
        ? iconV23011("lock")
        : '<span aria-hidden="true">•</span>';

    btn.innerHTML = autorizada
      ? `${checkIcon}<span>Autorizado</span>`
      : `${lockIcon}<span>Autorizar</span>`;
  }

  if (status) {
    status.classList.remove("pending", "authorized", "required");

    if (!solicitud.tipo || solicitud.valor <= 0) {
      status.classList.add("pending");
      status.innerHTML =
        '<span class="discount-auth-dot"></span><span>Sin descuento aplicado</span>';
    } else if (autorizada) {
      status.classList.add("authorized");
      status.innerHTML =
        `<span class="discount-auth-dot"></span>` +
        `<span>Autorizado por ${escapeHtml(descuentoAutorizacion.autorizador || "Administrador")}</span>`;
    } else {
      status.classList.add("required");
      status.innerHTML =
        '<span class="discount-auth-dot"></span><span>Ingresá un PIN de administrador para aplicar este descuento</span>';
    }
  }

  if (caption) {
    caption.textContent = autorizada
      ? "Autorizado"
      : "Requiere autorización";
  }
}

function invalidarAutorizacionDescuento({ recalcular = true } = {}) {
  descuentoAutorizacion = null;
  actualizarUIAutorizacionDescuento();
  if (recalcular) actualizarTotalesVentaV228();
}

function abrirAutorizacionDescuento() {
  const solicitud = solicitudDescuentoActual();

  if (!solicitud.tipo || solicitud.valor <= 0) {
    mostrarToast("Ingresá primero el descuento que querés aplicar", "info");
    return;
  }

  if (solicitud.subtotal <= 0) {
    mostrarToast("Agregá productos antes de autorizar el descuento", "info");
    return;
  }

  const request =
    solicitud.tipo === "porcentaje"
      ? `${solicitud.valor}%`
      : formatearPrecio(solicitud.valor);

  $("#discount-auth-subtotal").textContent =
    formatearPrecio(solicitud.subtotal);
  $("#discount-auth-request").textContent = request;
  $("#discount-admin-pin").value = "";
  $("#discount-auth-error").textContent = "";

  $("#modal-discount-auth").classList.remove("hidden");
  setTimeout(() => $("#discount-admin-pin")?.focus(), 60);
}

function cerrarAutorizacionDescuento() {
  $("#modal-discount-auth")?.classList.add("hidden");
  $("#discount-admin-pin").value = "";
  $("#discount-auth-error").textContent = "";
}

async function enviarAutorizacionDescuento(e) {
  e.preventDefault();

  const solicitud = solicitudDescuentoActual();
  const pin = $("#discount-admin-pin").value.trim();
  const errorEl = $("#discount-auth-error");
  const btn = $("#btn-submit-discount-auth");

  errorEl.textContent = "";

  if (!/^\d{4,8}$/.test(pin)) {
    errorEl.textContent = "El PIN debe tener entre 4 y 8 números.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Verificando...";

  const { data, error } = await supabaseClient.rpc(
    "autorizar_descuento_v1",
    {
      p_pin: pin,
      p_sucursal_id: appContext.branch.id,
      p_subtotal: solicitud.subtotal,
      p_descuento_tipo: solicitud.tipo,
      p_descuento_valor: solicitud.valor,
    }
  );

  btn.disabled = false;
  btn.textContent = "Autorizar descuento";

  if (error) {
    errorEl.textContent = error.message;
    return;
  }

  if (!data?.ok) {
    errorEl.textContent =
      data?.message || "PIN incorrecto o autorización no disponible.";
    return;
  }

  descuentoAutorizacion = {
    ok: true,
    tipo: solicitud.tipo,
    valor: solicitud.valor,
    subtotal: solicitud.subtotal,
    autorizador: data.autorizador_nombre || data.autorizador_rol || "Administrador",
    expiraMs: Date.now() + Math.max(30, Number(data.expira_segundos || 180)) * 1000,
  };

  cerrarAutorizacionDescuento();
  actualizarUIAutorizacionDescuento();
  actualizarTotalesVentaV228();

  mostrarToast(
    `Descuento autorizado por ${descuentoAutorizacion.autorizador}`,
    "success"
  );
}

async function actualizarEstadoPinDescuento() {
  const card = $("#config-discount-pin-card");
  const status = $("#pin-config-status");
  const btn = $("#btn-configurar-pin-descuento");

  if (!card || !status || !btn || !appContext?.ready) return;

  const role = appContext.membership?.role;
  const puede = role === "owner" || role === "admin";

  card.classList.toggle("hidden", !puede);

  if (!puede) return;

  status.textContent = "Consultando estado...";

  const { data, error } = await supabaseClient.rpc("estado_pin_descuento_v1");

  if (error) {
    status.textContent = "No se pudo consultar el estado del PIN.";
    return;
  }

  if (data?.configurado) {
    status.innerHTML =
      '<span class="pin-status-dot configured"></span>' +
      '<span>Tu PIN está configurado</span>';
    btn.textContent = "Cambiar PIN";
  } else {
    status.innerHTML =
      '<span class="pin-status-dot"></span>' +
      '<span>Todavía no configuraste tu PIN</span>';
    btn.textContent = "Configurar PIN";
  }

  const count = Number(data?.autorizadores_configurados || 0);
  if (count > 0) {
    status.innerHTML +=
      `<small>${count} ${count === 1 ? "autorizador disponible" : "autorizadores disponibles"} en el negocio</small>`;
  }
}

function abrirConfigPinDescuento() {
  $("#config-discount-pin").value = "";
  $("#config-discount-pin-confirm").value = "";
  $("#config-discount-pin-error").textContent = "";
  $("#modal-config-discount-pin").classList.remove("hidden");
  setTimeout(() => $("#config-discount-pin")?.focus(), 60);
}

function cerrarConfigPinDescuento() {
  $("#modal-config-discount-pin")?.classList.add("hidden");
  $("#config-discount-pin").value = "";
  $("#config-discount-pin-confirm").value = "";
  $("#config-discount-pin-error").textContent = "";
}

async function guardarConfigPinDescuento(e) {
  e.preventDefault();

  const pin = $("#config-discount-pin").value.trim();
  const confirm = $("#config-discount-pin-confirm").value.trim();
  const errorEl = $("#config-discount-pin-error");
  const btn = $("#btn-save-config-pin");

  errorEl.textContent = "";

  if (!/^\d{4,8}$/.test(pin)) {
    errorEl.textContent = "Usá un PIN de 4 a 8 números.";
    return;
  }

  if (pin !== confirm) {
    errorEl.textContent = "Los PIN no coinciden.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Guardando...";

  const { data, error } = await supabaseClient.rpc(
    "configurar_pin_descuento_v1",
    { p_pin: pin }
  );

  btn.disabled = false;
  btn.textContent = "Guardar PIN";

  if (error) {
    errorEl.textContent = error.message;
    return;
  }

  if (!data?.ok) {
    errorEl.textContent = data?.message || "No se pudo configurar el PIN.";
    return;
  }

  cerrarConfigPinDescuento();
  await actualizarEstadoPinDescuento();
  mostrarToast("PIN de descuentos configurado", "success");
}


// ============================================================
// Vendify v2.28 — Ventas profesionales
// ============================================================

let pagoModoV228 = "single";
let historialVentasV228 = [];
let ticketActualV228 = null;
let gestionVentaV228 = null;

const MEDIOS_PAGO_V228 = [
  "Efectivo",
  "Débito",
  "Crédito",
  "Transferencia",
  "Mercado Pago",
  "Otro",
];

function calcularTotalesVentaV228() {
  const subtotal = calcularTotalCarrito();
  const solicitud = solicitudDescuentoActual();
  const autorizada = autorizacionDescuentoCoincide();

  let tipo = null;
  let valor = 0;
  let descuento = 0;

  if (autorizada && solicitud.tipo === "porcentaje") {
    tipo = solicitud.tipo;
    valor = solicitud.valor;
    descuento = subtotal * valor / 100;
  } else if (autorizada && solicitud.tipo === "monto") {
    tipo = solicitud.tipo;
    valor = solicitud.valor;
    descuento = Math.min(subtotal, valor);
  }

  descuento = Math.round(descuento * 100) / 100;
  const total = Math.max(0, Math.round((subtotal - descuento) * 100) / 100);

  return { subtotal, tipo, valor, descuento, total };
}

function actualizarTotalesVentaV228() {
  const t = calcularTotalesVentaV228();

  const subtotalEl = $("#venta-subtotal-v228");
  const descuentoEl = $("#venta-descuento-total-v228");
  const descuentoRow = $("#venta-descuento-row-v228");
  const totalEl = $("#carrito-total");

  if (subtotalEl) subtotalEl.textContent = formatearPrecio(t.subtotal);
  if (descuentoEl) descuentoEl.textContent = `−${formatearPrecio(t.descuento)}`;
  if (descuentoRow) descuentoRow.classList.toggle("hidden", t.descuento <= 0);
  if (totalEl) totalEl.textContent = formatearPrecio(t.total);

  actualizarRestantePagoMixtoV228();
  actualizarUIAutorizacionDescuento();
  return t;
}

function resetVentaProfesionalV228() {
  pagoModoV228 = "single";
  descuentoAutorizacion = null;

  document.querySelectorAll("[data-pay-mode-v228]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.payModeV228 === "single");
  });

  $("#single-payment-v228")?.classList.remove("hidden");
  $("#mixed-payment-v228")?.classList.add("hidden");

  if ($("#medio-pago")) $("#medio-pago").value = "Efectivo";
  if ($("#venta-descuento-tipo-v228")) $("#venta-descuento-tipo-v228").value = "";
  if ($("#venta-descuento-valor-v228")) {
    $("#venta-descuento-valor-v228").value = "0";
    $("#venta-descuento-valor-v228").disabled = true;
  }
  if ($("#venta-observacion-v228")) $("#venta-observacion-v228").value = "";

  renderPagosMixtosV228([
    { medio_pago: "Efectivo", monto: 0 },
    { medio_pago: "Transferencia", monto: 0 },
  ]);

  actualizarTotalesVentaV228();
}

function activarModoPagoV228(modo) {
  pagoModoV228 = modo === "mixed" ? "mixed" : "single";

  document.querySelectorAll("[data-pay-mode-v228]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.payModeV228 === pagoModoV228);
  });

  $("#single-payment-v228")?.classList.toggle("hidden", pagoModoV228 !== "single");
  $("#mixed-payment-v228")?.classList.toggle("hidden", pagoModoV228 !== "mixed");

  if (pagoModoV228 === "mixed") {
    const rows = $("#mixed-payment-rows-v228");
    if (rows && !rows.children.length) {
      renderPagosMixtosV228([
        { medio_pago: "Efectivo", monto: calcularTotalesVentaV228().total },
        { medio_pago: "Transferencia", monto: 0 },
      ]);
    } else {
      const inputs = [...document.querySelectorAll(".mixed-pay-amount-v228")];
      const sum = inputs.reduce((a, el) => a + Number(el.value || 0), 0);
      if (sum <= 0 && inputs[0]) {
        inputs[0].value = calcularTotalesVentaV228().total.toFixed(2);
      }
    }
  }

  actualizarRestantePagoMixtoV228();
}

function pagoOptionsV228(selected) {
  return MEDIOS_PAGO_V228
    .map(
      (m) =>
        `<option value="${escapeHtml(m)}" ${m === selected ? "selected" : ""}>${escapeHtml(m)}</option>`
    )
    .join("");
}

function renderPagosMixtosV228(pagos = []) {
  const cont = $("#mixed-payment-rows-v228");
  if (!cont) return;

  cont.innerHTML = pagos
    .map(
      (p, i) => `
        <div class="mixed-pay-row-v228" data-pay-index="${i}">
          <select class="select mixed-pay-method-v228">
            ${pagoOptionsV228(p.medio_pago || "Efectivo")}
          </select>
          <div class="mixed-pay-amount-wrap-v228">
            <span>$</span>
            <input class="mixed-pay-amount-v228" type="number" min="0" step="0.01"
                   value="${Number(p.monto || 0).toFixed(2)}" />
          </div>
          <button type="button" class="btn btn-ghost btn-sm mixed-pay-rest-v228"
                  data-pay-rest title="Completar con el restante">Restante</button>
          <button type="button" class="btn-icon danger mixed-pay-remove-v228"
                  data-pay-remove title="Quitar">✕</button>
        </div>
      `
    )
    .join("");

  actualizarRestantePagoMixtoV228();
}

function pagosMixtosDesdeDOMV228() {
  return [...document.querySelectorAll(".mixed-pay-row-v228")].map((row) => ({
    medio_pago: row.querySelector(".mixed-pay-method-v228")?.value || "Otro",
    monto: Number(row.querySelector(".mixed-pay-amount-v228")?.value || 0),
  }));
}

function agregarPagoMixtoV228() {
  const pagos = pagosMixtosDesdeDOMV228();
  pagos.push({ medio_pago: "Efectivo", monto: 0 });
  renderPagosMixtosV228(pagos);
}

function actualizarRestantePagoMixtoV228() {
  const el = $("#mixed-payment-remaining-v228");
  if (!el) return;

  const total = calcularTotalesVentaV228().total;
  const pagos = pagosMixtosDesdeDOMV228();
  const sum = pagos.reduce((a, p) => a + Number(p.monto || 0), 0);
  const restante = Math.round((total - sum) * 100) / 100;

  el.textContent =
    Math.abs(restante) <= 0.01
      ? "Pago completo"
      : restante > 0
        ? `Restante ${formatearPrecio(restante)}`
        : `Excede ${formatearPrecio(Math.abs(restante))}`;

  el.classList.toggle("ok", Math.abs(restante) <= 0.01);
  el.classList.toggle("error", restante < -0.01);
}

function completarRestantePagoV228(row) {
  const total = calcularTotalesVentaV228().total;
  const rows = [...document.querySelectorAll(".mixed-pay-row-v228")];
  let otros = 0;

  rows.forEach((r) => {
    if (r === row) return;
    otros += Number(r.querySelector(".mixed-pay-amount-v228")?.value || 0);
  });

  const input = row.querySelector(".mixed-pay-amount-v228");
  if (input) input.value = Math.max(0, total - otros).toFixed(2);

  actualizarRestantePagoMixtoV228();
}

function obtenerPagosVentaV228(total) {
  if (total <= 0.001) return [];

  if (pagoModoV228 === "single") {
    return [
      {
        medio_pago: $("#medio-pago")?.value || "Efectivo",
        monto: Number(total.toFixed(2)),
      },
    ];
  }

  const pagos = pagosMixtosDesdeDOMV228()
    .filter((p) => p.monto > 0)
    .map((p) => ({ ...p, monto: Number(p.monto.toFixed(2)) }));

  const suma = pagos.reduce((a, p) => a + p.monto, 0);

  if (!pagos.length) {
    throw new Error("Ingresá al menos un medio de pago");
  }

  if (Math.abs(suma - total) > 0.01) {
    throw new Error(
      suma < total
        ? `Faltan ${formatearPrecio(total - suma)} para completar el pago`
        : `Los pagos exceden el total por ${formatearPrecio(suma - total)}`
    );
  }

  return pagos;
}

async function registrarVentaV3(items, pagos, totales, observacion) {
  if (!exigirPermisoV2("sell", "Tu usuario no tiene permiso para registrar ventas")) return null;
  if (!appContext.ready) throw new Error("El contexto del negocio todavía no está cargado");

  const payload = (items || []).map((item) => ({
    producto_id: item.id || item.producto_id,
    cantidad: Number(item.cantidad),
  }));

  const { data, error } = await supabaseClient.rpc("registrar_venta_v4", {
    p_items: payload,
    p_pagos: pagos,
    p_descuento_tipo: totales.tipo,
    p_descuento_valor: Number(totales.valor || 0),
    p_observacion: observacion || null,
    p_sucursal_id: appContext.branch.id,
    p_caja_id: appContext.cashRegister.id,
    p_request_id: asegurarVentaRequestIdV23011(),
  });

  if (error) throw new Error(error.message || "No se pudo registrar la venta");
  emitirCambioStockRealtime("venta_profesional");
  refrescarVistasDependientesRealtimeVQA("venta_local");
  return data;
}

function estadoVentaLabelV228(estado) {
  const map = {
    completada: "Completada",
    parcialmente_devuelta: "Dev. parcial",
    devuelta: "Devuelta",
    anulada: "Anulada",
    pendiente_sincronizacion: "Pendiente de sincronizar",
  };
  return map[estado] || "Completada";
}

function ventaNetaV228(v) {
  return Math.max(0, Number(v?.total || 0) - Number(v?.total_devuelto || 0));
}

function pagosVentaTextoV228(pagos = [], operacion = "cobro") {
  const list = (pagos || []).filter((p) => p.operacion === operacion);
  if (!list.length) return "";
  return list
    .map((p) => `${p.medio_pago}: ${formatearPrecio(Number(p.monto || 0))}`)
    .join(" · ");
}

function ticketNumeroV228(id) {
  return String(id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
}

function construirTicketHTMLV228(data) {
  const venta = data?.venta || data || {};
  const items = data?.items || venta.venta_items || [];
  const pagos = data?.pagos || venta.venta_pagos || [];
  const fecha = venta.creado ? new Date(venta.creado) : new Date();

  const itemsHtml = items
    .map((it) => {
      const qty = Number(it.cantidad || 0);
      const subtotalGross = Number(it.subtotal ?? (it.precio_unitario || 0) * qty);
      return `
        <div class="receipt-item-v228">
          <div>
            <strong>${qty}× ${escapeHtml(it.producto_nombre || "Producto")}</strong>
            <small>${formatearPrecio(Number(it.precio_unitario || 0))} c/u</small>
          </div>
          <span>${formatearPrecio(subtotalGross)}</span>
        </div>
      `;
    })
    .join("");

  const pagosHtml = pagos
    .filter((p) => p.operacion !== "devolucion")
    .map(
      (p) => `
        <div class="receipt-line-v228">
          <span>${escapeHtml(p.medio_pago)}</span>
          <span>${formatearPrecio(Number(p.monto || 0))}</span>
        </div>`
    )
    .join("");

  const estado = venta.estado || "completada";

  return `
    <div class="receipt-v228">
      <div class="receipt-head-v228">
        <div class="receipt-brand-v228">VENDIFY</div>
        <strong>${escapeHtml(appContext.business?.nombre || "Negocio")}</strong>
        <span>${escapeHtml(appContext.branch?.nombre || "")}${appContext.cashRegister?.nombre ? ` · ${escapeHtml(appContext.cashRegister.nombre)}` : ""}</span>
      </div>

      <div class="receipt-meta-v228">
        <span>Ticket #${ticketNumeroV228(venta.id)}</span>
        <span>${fecha.toLocaleString("es-AR")}</span>
      </div>

      ${estado !== "completada" ? `<div class="receipt-status-v228">${escapeHtml(estadoVentaLabelV228(estado))}</div>` : ""}

      <div class="receipt-items-v228">${itemsHtml}</div>

      <div class="receipt-totals-v228">
        <div class="receipt-line-v228">
          <span>Subtotal</span>
          <span>${formatearPrecio(Number(venta.subtotal ?? venta.total ?? 0))}</span>
        </div>
        ${
          Number(venta.descuento_total || 0) > 0
            ? `<div class="receipt-line-v228">
                 <span>Descuento</span>
                 <span>−${formatearPrecio(Number(venta.descuento_total || 0))}</span>
               </div>`
            : ""
        }
        <div class="receipt-line-v228 total">
          <span>Total</span>
          <strong>${formatearPrecio(Number(venta.total || 0))}</strong>
        </div>
        ${
          Number(venta.total_devuelto || 0) > 0
            ? `<div class="receipt-line-v228 refund">
                 <span>Devuelto</span>
                 <span>−${formatearPrecio(Number(venta.total_devuelto || 0))}</span>
               </div>`
            : ""
        }
      </div>

      ${
        pagosHtml
          ? `<div class="receipt-payment-v228">
               <small>Pago</small>
               ${pagosHtml}
             </div>`
          : ""
      }

      ${
        venta.observacion
          ? `<div class="receipt-note-v228">
               <small>Observación</small>
               <p>${escapeHtml(venta.observacion)}</p>
             </div>`
          : ""
      }

      <div class="receipt-footer-v228">
        Gracias por tu compra
        <small>Gestionado con Vendify</small>
      </div>
    </div>
  `;
}

function mostrarTicketV228(data) {
  ticketActualV228 = data;
  const preview = $("#ticket-preview-v228");
  if (preview) {
    preview.innerHTML =
      construirTicketHTMLV228(data);
  }

  $("#modal-ticket-v228")?.classList.remove("hidden");

  if (
    commercialConfigV231?.auto_imprimir_ticket ===
    true
  ) {
    setTimeout(
      () => imprimirTicketV228(),
      120
    );
  }
}

function cerrarTicketV228() {
  $("#modal-ticket-v228")?.classList.add("hidden");
}

function imprimirTicketV228() {
  if (!ticketActualV228) return;

  const htmlTicket =
    construirTicketHTMLV228(ticketActualV228);

  const ticketWidthV231 =
    Number(
      commercialConfigV231?.ancho_ticket_mm
    ) === 58
      ? 58
      : 80;
  const w = window.open("", "_blank", "width=420,height=720");

  if (!w) {
    mostrarToast("El navegador bloqueó la ventana de impresión", "error");
    return;
  }

  w.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Ticket Vendify</title>
        <style>
          *{box-sizing:border-box}
          body{font-family:Arial,sans-serif;margin:0;padding:16px;color:#111;background:#fff}
          .receipt-v228{max-width:320px;margin:auto;font-size:12px}
          .receipt-head-v228{text-align:center;display:flex;flex-direction:column;gap:3px}
          .receipt-brand-v228{font-size:20px;font-weight:800;letter-spacing:1px}
          .receipt-head-v228 span,.receipt-meta-v228,.receipt-footer-v228 small{font-size:10px;color:#555}
          .receipt-meta-v228{display:flex;justify-content:space-between;border-top:1px dashed #aaa;border-bottom:1px dashed #aaa;padding:8px 0;margin:10px 0}
          .receipt-item-v228{display:flex;justify-content:space-between;gap:10px;padding:5px 0}
          .receipt-item-v228>div{display:flex;flex-direction:column}
          .receipt-item-v228 small{color:#666}
          .receipt-totals-v228,.receipt-payment-v228,.receipt-note-v228{border-top:1px dashed #aaa;margin-top:8px;padding-top:8px}
          .receipt-line-v228{display:flex;justify-content:space-between;gap:12px;padding:2px 0}
          .receipt-line-v228.total{font-size:15px;padding-top:6px}
          .receipt-line-v228.refund{color:#b91c1c}
          .receipt-status-v228{text-align:center;font-weight:700;border:1px solid #111;padding:4px;margin-bottom:8px}
          .receipt-note-v228 p{margin:4px 0 0}
          .receipt-footer-v228{text-align:center;border-top:1px dashed #aaa;margin-top:12px;padding-top:10px;display:flex;flex-direction:column;gap:4px}
          @media print{body{padding:0}.receipt-v228{max-width:none;width:${ticketWidthV231}mm}}
        </style>
      </head>
      <body>${htmlTicket}<script>window.onload=()=>{window.print();}<\/script></body>
    </html>
  `);

  w.document.close();
}

function abrirGestionVentaV228(venta, modo) {
  if (!venta) return;

  if (!cajaAbiertaMiaV227()) {
    mostrarToast("Abrí una caja propia antes de realizar reintegros", "info");
    abrirPanelCajaV227();
    return;
  }

  gestionVentaV228 = { venta, modo };
  const esAnular = modo === "anular";

  $("#return-title-v228").textContent = esAnular ? "Anular venta" : "Devolver artículos";
  $("#return-subtitle-v228").textContent = esAnular
    ? "La venta quedará anulada, se restaurará el stock y se registrará el reintegro."
    : "El stock seleccionado volverá a la sucursal original.";

  $("#return-items-section-v228")?.classList.toggle("hidden", esAnular);
  $("#return-warning-v228")?.classList.toggle("hidden", !esAnular);

  if (esAnular) {
    $("#return-warning-v228").innerHTML = `
      <strong>Esta acción no borra la venta.</strong>
      <span>Quedará registrada como anulada en el historial y en la auditoría.</span>
    `;
  }

  const pagosCobro = (venta.venta_pagos || []).filter((p) => p.operacion === "cobro");
  const method = pagosCobro[0]?.medio_pago || "Efectivo";
  if ($("#return-method-v228")) $("#return-method-v228").value =
    MEDIOS_PAGO_V228.includes(method) ? method : "Otro";

  $("#return-reason-v228").value = "";
  $("#return-error-v228").textContent = "";

  const items = venta.venta_items || [];
  const cont = $("#return-items-v228");

  if (!esAnular) {
    cont.innerHTML = items
      .map((it) => {
        const disponible = Math.max(
          0,
          Number(it.cantidad || 0) - Number(it.cantidad_devuelta || 0)
        );

        return `
          <div class="return-item-v228 ${disponible <= 0 ? "disabled" : ""}"
               data-return-item-id="${it.id}"
               data-return-price="${Number(it.precio_neto_unitario || it.precio_unitario || 0)}">
            <div class="return-item-copy-v228">
              <strong>${escapeHtml(it.producto_nombre)}</strong>
              <small>Disponible para devolver: ${disponible}</small>
            </div>
            <input type="number" class="return-item-qty-v228"
                   min="0" max="${disponible}" step="1" value="0"
                   ${disponible <= 0 ? "disabled" : ""} />
          </div>
        `;
      })
      .join("");
  } else {
    cont.innerHTML = "";
  }

  $("#btn-submit-return-v228").textContent =
    esAnular ? "Anular y reintegrar" : "Confirmar devolución";
  $("#btn-submit-return-v228").classList.toggle("btn-danger", esAnular);
  $("#btn-submit-return-v228").classList.toggle("btn-primary", !esAnular);

  actualizarTotalDevolucionV228();
  $("#modal-return-v228").classList.remove("hidden");
}

function cerrarGestionVentaV228() {
  $("#modal-return-v228")?.classList.add("hidden");
  gestionVentaV228 = null;
}

function actualizarTotalDevolucionV228() {
  const el = $("#return-total-v228");
  if (!el || !gestionVentaV228) return;

  if (gestionVentaV228.modo === "anular") {
    el.textContent = formatearPrecio(ventaNetaV228(gestionVentaV228.venta));
    return;
  }

  let total = 0;
  document.querySelectorAll(".return-item-v228").forEach((row) => {
    const qty = Number(row.querySelector(".return-item-qty-v228")?.value || 0);
    const price = Number(row.dataset.returnPrice || 0);
    total += qty * price;
  });

  const restante = ventaNetaV228(gestionVentaV228.venta);
  total = Math.min(restante, Math.round(total * 100) / 100);
  el.textContent = formatearPrecio(total);
}

async function guardarGestionVentaV228(e) {
  e.preventDefault();
  if (!gestionVentaV228) return;

  const venta = gestionVentaV228.venta;
  const modo = gestionVentaV228.modo;
  const errorEl = $("#return-error-v228");
  const motivo = $("#return-reason-v228").value.trim();
  const medio = $("#return-method-v228").value;

  errorEl.textContent = "";

  if (motivo.length < 2) {
    errorEl.textContent = "Ingresá el motivo.";
    return;
  }

  let response;

  if (modo === "anular") {
    response = await supabaseClient.rpc("anular_venta_v1", {
      p_venta_id: venta.id,
      p_caja_id: appContext.cashRegister.id,
      p_medio_reintegro: medio,
      p_motivo: motivo,
    });
  } else {
    const items = [...document.querySelectorAll(".return-item-v228")]
      .map((row) => ({
        item_id: row.dataset.returnItemId,
        cantidad: Number(row.querySelector(".return-item-qty-v228")?.value || 0),
      }))
      .filter((x) => x.cantidad > 0);

    if (!items.length) {
      errorEl.textContent = "Seleccioná al menos un artículo.";
      return;
    }

    response = await supabaseClient.rpc("devolver_venta_v1", {
      p_venta_id: venta.id,
      p_items: items,
      p_caja_id: appContext.cashRegister.id,
      p_medio_reintegro: medio,
      p_motivo: motivo,
    });
  }

  if (response.error) {
    errorEl.textContent = response.error.message;
    return;
  }

  cerrarGestionVentaV228();

  emitirCambioStockRealtime(modo === "anular" ? "anulacion" : "devolucion");
  await cargarProductos();
  renderGrid();
  await cargarEstadoCajaV227();
  await renderHistorial();

  mostrarToast(
    modo === "anular" ? "Venta anulada y stock restaurado" : "Devolución registrada",
    "success"
  );
}

// =====================
// Venta (POS) — carrito y cobro
// =====================
function abrirVenta() {
  ventaRequestIdV23011 = nuevaRequestIdV23011();
  ventaConfirmandoV23011 = false;

  if (!appContext?.cashRegister?.id) {
    mostrarToast("Seleccioná una caja antes de vender", "error");
    return;
  }

  if (
    !cajaAbiertaMiaV227() &&
    !(
      !navigator.onLine &&
      restaurarPruebaCajaOfflineV2311?.()
    )
  ) {
    mostrarToast(
      !navigator.onLine
        ? "Para vender offline, esta caja debe haber sido abierta previamente con internet"
        : cajaEstadoV227?.sesion
          ? "Esta caja está abierta por otro usuario"
          : "Abrí la caja antes de comenzar a vender",
      "info"
    );

    if (navigator.onLine) {
      abrirPanelCajaV227();
    }

    return;
  }

  carrito = [];
  $("#venta-buscador").value = "";
  resetVentaProfesionalV228();
  renderVentaProductos();
  renderCarrito();
  $("#modal-venta").classList.remove("hidden");
  setTimeout(() => $("#venta-buscador").focus(), 50);
}

function cerrarVenta() {
  $("#modal-venta").classList.add("hidden");
  carrito = [];
}

/* QA: implementación legacy removida (renderVentaProductos) */


function agregarAlCarrito(id) {
  invalidarAutorizacionDescuento({ recalcular: false });
  const p = productos.find((x) => x.id === id);
  if (!p) return;
  const item = carrito.find((c) => c.id === id);
  const enCarrito = item?.cantidad || 0;
  if (enCarrito >= p.stock) {
    mostrarToast(`No queda más stock de "${p.nombre}"`, "error");
    return;
  }
  if (item) {
    item.cantidad += 1;
  } else {
    carrito.push({ id: p.id, nombre: p.nombre, precioVenta: p.precioVenta, stock: p.stock, cantidad: 1 });
  }
  renderVentaProductos();
  renderCarrito();
}

function cambiarCantidadCarrito(id, delta) {
  invalidarAutorizacionDescuento({ recalcular: false });
  const item = carrito.find((c) => c.id === id);
  if (!item) return;
  const p = productos.find((x) => x.id === id);
  const max = p ? p.stock : item.stock;
  item.cantidad = Math.max(1, Math.min(max, item.cantidad + delta));
  renderVentaProductos();
  renderCarrito();
}

function quitarDelCarrito(id) {
  invalidarAutorizacionDescuento({ recalcular: false });
  carrito = carrito.filter((c) => c.id !== id);
  renderVentaProductos();
  renderCarrito();
}

function calcularTotalCarrito() {
  return carrito.reduce((a, c) => a + c.precioVenta * c.cantidad, 0);
}

function renderCarrito() {
  const cont = $("#carrito-items");
  const countEl = $("#carrito-count-v210");
  const unidadesCarrito = carrito.reduce(
    (sum, item) => sum + Number(item.cantidad || 0),
    0
  );

  if (countEl) {
    countEl.textContent =
      `${unidadesCarrito} ${unidadesCarrito === 1 ? "artículo" : "artículos"}`;
  }

  const btnCobrar = $("#btn-cobrar");

  if (carrito.length === 0) {
    cont.innerHTML =
      `<p class="carrito-vacio" id="carrito-vacio">Tocá un producto para agregarlo</p>`;
    actualizarTotalesVentaV228();
    btnCobrar.disabled = true;
    guardarCarritoV231?.();
    aplicarEstadoOfflineVentaV231?.();
    return;
  }

  cont.innerHTML = carrito
    .map(
      (c) => `
        <div class="carrito-item" data-id="${c.id}">
          <div class="carrito-item-info">
            <div class="carrito-item-nombre">${escapeHtml(c.nombre)}</div>
            <div class="carrito-item-sub">
              ${formatearPrecio(c.precioVenta)} c/u ·
              ${formatearPrecio(c.precioVenta * c.cantidad)}
            </div>
          </div>
          <div class="carrito-item-qty">
            <button type="button" data-qty="-1">−</button>
            <span>${c.cantidad}</span>
            <button type="button" data-qty="1">+</button>
          </div>
          <button type="button" class="carrito-item-quitar" data-quitar title="Quitar">🗑️</button>
        </div>
      `
    )
    .join("");

  actualizarTotalesVentaV228();
  btnCobrar.disabled = false;
  guardarCarritoV231?.();
  aplicarEstadoOfflineVentaV231?.();
}

async function confirmarVenta() {
  if (
    carrito.length === 0 ||
    ventaConfirmandoV23011
  ) return;

  const btn = $("#btn-cobrar");
  const offline = !navigator.onLine;

  const solicitudDescuento =
    solicitudDescuentoActual();

  if (
    offline &&
    solicitudDescuento.tipo &&
    Number(solicitudDescuento.valor || 0) > 0
  ) {
    mostrarToast(
      "Los descuentos requieren conexión para validar la autorización.",
      "error"
    );
    return;
  }

  if (
    !offline &&
    solicitudDescuento.tipo &&
    solicitudDescuento.valor > 0 &&
    !autorizacionDescuentoCoincide()
  ) {
    mostrarToast(
      "Autorizá el descuento con un PIN de administrador",
      "error"
    );
    abrirAutorizacionDescuento();
    return;
  }

  const totales =
    calcularTotalesVentaV228();

  let pagos;

  try {
    pagos =
      obtenerPagosVentaV228(
        totales.total
      );

    if (offline) {
      validarPagosOfflineV2311(pagos);
    }
  } catch (error) {
    mostrarToast(
      error.message,
      "error"
    );
    return;
  }

  ventaConfirmandoV23011 = true;
  btn.disabled = true;
  btn.textContent = offline
    ? "Guardando..."
    : "Cobrando...";

  try {
    if (offline) {
      const localTicket =
        registrarVentaOfflineV2311(
          carrito,
          pagos,
          totales,
          $("#venta-observacion-v228")
            .value.trim()
        );

      mostrarToast(
        "Venta guardada offline. Se sincronizará automáticamente.",
        "success"
      );

      descuentoAutorizacion = null;
      ventaRequestIdV23011 = null;

      cerrarVenta();
      mostrarTicketV228(localTicket);
      actualizarUIVentasOfflineV2311();
      return;
    }

    const data = await registrarVentaV3(
      carrito,
      pagos,
      totales,
      $("#venta-observacion-v228")
        .value.trim()
    );

    if (!data) return;

    // El servidor es la autoridad.
    await cargarProductos();
    renderGrid();
    await cargarEstadoCajaV227();

    const total = Number(
      data?.venta?.total ??
      totales.total
    );

    mostrarToast(
      `Venta cobrada: ${formatearPrecio(total)}`,
      "success"
    );

    descuentoAutorizacion = null;
    ventaRequestIdV23011 = null;

    try {
      localStorage.removeItem(
        safeBusinessKeyV231(
          VENDIFY_CART_PREFIX_V231
        )
      );
    } catch {}

    cerrarVenta();
    mostrarTicketV228(data);
    refrescarOnboardingComercialV231?.();
    cargarBadgeAlertasV231?.();

  } catch (error) {
    mostrarToast(
      error.message ||
      "No se pudo registrar la venta",
      "error"
    );

  } finally {
    ventaConfirmandoV23011 = false;

    if (btn) {
      aplicarEstadoOfflineVentaV231();
    }
  }
}

// =====================
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
// Historial de ventas (tickets)
// =====================
function rangoFechas(clave) {
  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  let desde = null;
  let hasta = null;

  switch (clave) {
    case "hoy":
      desde = inicioHoy;
      break;
    case "ayer": {
      desde = new Date(inicioHoy);
      desde.setDate(desde.getDate() - 1);
      hasta = new Date(inicioHoy);
      break;
    }
    case "7dias":
      desde = new Date(inicioHoy);
      desde.setDate(desde.getDate() - 6);
      break;
    case "mes":
      desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      break;
    case "todo":
    default:
      desde = null;
  }
  return { desde, hasta };
}

async function abrirHistorial() {
  $("#modal-historial").classList.remove("hidden");
  await renderHistorial();
}

function cerrarHistorial() {
  $("#modal-historial").classList.add("hidden");
}

async function renderHistorial() {
  const cont = $("#historial-lista");
  const vacio = $("#historial-vacio");
  const resumen = $("#historial-resumen");

  cont.innerHTML =
    `<p class="hint" style="text-align:center;padding:1rem;">Cargando...</p>`;
  vacio.classList.add("hidden");

  const clave = $("#historial-rango").value;
  const { desde, hasta } = rangoFechas(clave);

  let query = supabaseClient
    .from("ventas")
    .select("*, venta_items(*), venta_pagos(*), venta_devoluciones(*)")
    .order("creado", { ascending: false });

  if (appContext?.branch?.id) {
    query = query.eq("sucursal_id", appContext.branch.id);
  }

  if (desde) query = query.gte("creado", desde.toISOString());
  if (hasta) query = query.lt("creado", hasta.toISOString());

  const { data, error } = await query;

  if (error) {
    console.error("[V2.28] historial:", error);
    cont.innerHTML = "";
    mostrarToast("No se pudo cargar el historial", "error");
    return;
  }

  historialVentasV228 = data || [];

  if (!historialVentasV228.length) {
    cont.innerHTML = "";
    resumen.innerHTML = "";
    vacio.classList.remove("hidden");
    return;
  }

  vacio.classList.add("hidden");

  const ventasActivas = historialVentasV228.filter((v) => v.estado !== "anulada");
  const totalPeriodo = historialVentasV228.reduce(
    (a, v) => a + ventaNetaV228(v),
    0
  );

  const devueltoPeriodo = historialVentasV228.reduce(
    (a, v) => a + Number(v.total_devuelto || 0),
    0
  );

  resumen.innerHTML = `
    <span><strong>${ventasActivas.length}</strong> ticket${ventasActivas.length === 1 ? "" : "s"} netos</span>
    <span><strong>${formatearPrecio(totalPeriodo)}</strong> vendido neto</span>
    ${
      devueltoPeriodo > 0
        ? `<span><strong>${formatearPrecio(devueltoPeriodo)}</strong> devuelto</span>`
        : ""
    }
  `;

  const rol = appContext.membership?.role;
  const puedeGestionar = ["owner", "admin", "manager"].includes(rol);

  cont.innerHTML = historialVentasV228
    .map((v) => {
      const fecha = new Date(v.creado);
      const fechaTexto = fecha.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const horaTexto = fecha.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const items = (v.venta_items || []).sort((a, b) =>
        a.producto_nombre.localeCompare(b.producto_nombre, "es")
      );

      const itemsHtml = items
        .map((it) => {
          const dev = Number(it.cantidad_devuelta || 0);
          return `
            <div class="ticket-item-row">
              <span>
                ${it.cantidad}× ${escapeHtml(it.producto_nombre)}
                ${dev > 0 ? `<small class="ticket-returned-v228"> · ${dev} devuelto${dev === 1 ? "" : "s"}</small>` : ""}
              </span>
              <span>${formatearPrecio(it.subtotal)}</span>
            </div>
          `;
        })
        .join("");

      const neto = ventaNetaV228(v);
      const pagos = pagosVentaTextoV228(v.venta_pagos || [], "cobro");
      const reintegros = pagosVentaTextoV228(v.venta_pagos || [], "devolucion");
      const estado = v.estado || "completada";
      const puedeDevolver =
        puedeGestionar &&
        !["devuelta", "anulada"].includes(estado) &&
        neto > 0.01;

      const puedeAnular =
        puedeGestionar &&
        estado === "completada" &&
        Number(v.total_devuelto || 0) <= 0.01;

      return `
        <details class="ticket-card ticket-card-v228 ${estado}">
          <summary>
            <span class="ticket-fecha">${fechaTexto} · ${horaTexto}</span>
            <span class="sale-status-v228 ${estado}">${estadoVentaLabelV228(estado)}</span>
            ${v.medio_pago ? `<span class="ticket-medio">${escapeHtml(v.medio_pago)}</span>` : ""}
            <span class="ticket-total">${formatearPrecio(neto)}</span>
          </summary>

          <div class="ticket-detail-v228">
            <div class="ticket-items">${itemsHtml || '<p class="hint">Sin detalle de artículos</p>'}</div>

            <div class="ticket-finance-v228">
              <div><span>Subtotal</span><strong>${formatearPrecio(Number(v.subtotal ?? v.total ?? 0))}</strong></div>
              ${
                Number(v.descuento_total || 0) > 0
                  ? `<div><span>Descuento</span><strong>−${formatearPrecio(Number(v.descuento_total))}</strong></div>`
                  : ""
              }
              <div><span>Total original</span><strong>${formatearPrecio(Number(v.total || 0))}</strong></div>
              ${
                Number(v.total_devuelto || 0) > 0
                  ? `<div class="refund"><span>Devuelto</span><strong>−${formatearPrecio(Number(v.total_devuelto))}</strong></div>`
                  : ""
              }
              <div class="net"><span>Neto</span><strong>${formatearPrecio(neto)}</strong></div>
            </div>

            ${
              pagos
                ? `<p class="ticket-payment-note-v228"><strong>Cobro:</strong> ${escapeHtml(pagos)}</p>`
                : ""
            }
            ${
              reintegros
                ? `<p class="ticket-payment-note-v228 refund"><strong>Reintegros:</strong> ${escapeHtml(reintegros)}</p>`
                : ""
            }
            ${
              v.observacion
                ? `<p class="ticket-observation-v228">${escapeHtml(v.observacion)}</p>`
                : ""
            }

            <div class="ticket-actions-row-v228">
              <button type="button" class="btn btn-secondary btn-sm"
                      data-sale-action-v228="ticket" data-id="${v.id}">
                🖨 Ticket
              </button>
              ${
                puedeDevolver
                  ? `<button type="button" class="btn btn-secondary btn-sm"
                             data-sale-action-v228="return" data-id="${v.id}">
                       ↩ Devolver
                     </button>`
                  : ""
              }
              ${
                puedeAnular
                  ? `<button type="button" class="btn btn-danger btn-sm"
                             data-sale-action-v228="void" data-id="${v.id}">
                       Anular
                     </button>`
                  : ""
              }
            </div>
          </div>
        </details>
      `;
    })
    .join("");
}

// =====================
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

  $("#btn-vender").addEventListener("click", abrirVenta);
  $("#btn-cerrar-venta").addEventListener("click", cerrarVenta);
  $("#modal-venta .modal-backdrop").addEventListener("click", cerrarVenta);


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

  $("#btn-historial")?.addEventListener("click", abrirHistorial);
  $("#btn-cerrar-historial")?.addEventListener("click", cerrarHistorial);
  $("#modal-historial .modal-backdrop")?.addEventListener("click", cerrarHistorial);
  $("#historial-rango")?.addEventListener("change", renderHistorial);
  $("#venta-buscador").addEventListener("input", renderVentaProductos);
  $("#venta-productos-lista").addEventListener("click", (e) => {
    const item = e.target.closest(".venta-producto-item");
    if (!item || item.classList.contains("sin-stock")) return;
    agregarAlCarrito(item.dataset.id);
  });
  $("#carrito-items").addEventListener("click", (e) => {
    const fila = e.target.closest(".carrito-item");
    if (!fila) return;
    const id = fila.dataset.id;
    const qtyBtn = e.target.closest("[data-qty]");
    if (qtyBtn) { cambiarCantidadCarrito(id, parseInt(qtyBtn.dataset.qty, 10)); return; }
    if (e.target.closest("[data-quitar]")) quitarDelCarrito(id);
  });
  $("#btn-cobrar").addEventListener("click", confirmarVenta);

  document.querySelectorAll("[data-pay-mode-v228]").forEach((btn) => {
    btn.addEventListener("click", () => activarModoPagoV228(btn.dataset.payModeV228));
  });

  $("#venta-descuento-tipo-v228")?.addEventListener("change", (e) => {
    const input = $("#venta-descuento-valor-v228");
    descuentoAutorizacion = null;
    input.disabled = !e.target.value;
    if (!e.target.value) input.value = "0";
    actualizarTotalesVentaV228();
  });

  $("#venta-descuento-valor-v228")?.addEventListener("input", () => {
    descuentoAutorizacion = null;
    actualizarTotalesVentaV228();
  });

  $("#btn-autorizar-descuento")?.addEventListener("click", abrirAutorizacionDescuento);

  $("#form-discount-auth")?.addEventListener("submit", enviarAutorizacionDescuento);
  $("#btn-close-discount-auth")?.addEventListener("click", cerrarAutorizacionDescuento);
  $("#btn-cancel-discount-auth")?.addEventListener("click", cerrarAutorizacionDescuento);
  $("#modal-discount-auth .modal-backdrop")?.addEventListener("click", cerrarAutorizacionDescuento);

  $("#btn-configurar-pin-descuento")?.addEventListener("click", abrirConfigPinDescuento);
  $("#form-config-discount-pin")?.addEventListener("submit", guardarConfigPinDescuento);
  $("#btn-close-config-pin")?.addEventListener("click", cerrarConfigPinDescuento);
  $("#btn-cancel-config-pin")?.addEventListener("click", cerrarConfigPinDescuento);
  $("#modal-config-discount-pin .modal-backdrop")?.addEventListener("click", cerrarConfigPinDescuento);

  $("#btn-add-payment-v228")?.addEventListener("click", agregarPagoMixtoV228);

  $("#mixed-payment-rows-v228")?.addEventListener("input", actualizarRestantePagoMixtoV228);
  $("#mixed-payment-rows-v228")?.addEventListener("change", actualizarRestantePagoMixtoV228);
  $("#mixed-payment-rows-v228")?.addEventListener("click", (e) => {
    const row = e.target.closest(".mixed-pay-row-v228");
    if (!row) return;

    if (e.target.closest("[data-pay-remove]")) {
      const pagos = pagosMixtosDesdeDOMV228();
      const index = Number(row.dataset.payIndex);
      pagos.splice(index, 1);
      renderPagosMixtosV228(pagos.length ? pagos : [{ medio_pago: "Efectivo", monto: 0 }]);
      return;
    }

    if (e.target.closest("[data-pay-rest]")) {
      completarRestantePagoV228(row);
    }
  });

  $("#btn-close-ticket-v228")?.addEventListener("click", cerrarTicketV228);
  $("#btn-close-ticket-bottom-v228")?.addEventListener("click", cerrarTicketV228);
  $("#modal-ticket-v228 .modal-backdrop")?.addEventListener("click", cerrarTicketV228);
  $("#btn-print-ticket-v228")?.addEventListener("click", imprimirTicketV228);

  $("#historial-lista")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sale-action-v228]");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const venta = historialVentasV228.find((v) => v.id === btn.dataset.id);
    if (!venta) return;

    if (btn.dataset.saleActionV228 === "ticket") {
      mostrarTicketV228({
        venta,
        items: venta.venta_items || [],
        pagos: venta.venta_pagos || [],
      });
    } else if (btn.dataset.saleActionV228 === "return") {
      abrirGestionVentaV228(venta, "devolver");
    } else if (btn.dataset.saleActionV228 === "void") {
      abrirGestionVentaV228(venta, "anular");
    }
  });

  $("#form-return-v228")?.addEventListener("submit", guardarGestionVentaV228);
  $("#return-items-v228")?.addEventListener("input", actualizarTotalDevolucionV228);
  $("#btn-close-return-v228")?.addEventListener("click", cerrarGestionVentaV228);
  $("#btn-cancel-return-v228")?.addEventListener("click", cerrarGestionVentaV228);
  $("#modal-return-v228 .modal-backdrop")?.addEventListener("click", cerrarGestionVentaV228);

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
    const item = carrito.find((candidate) => candidate.id === p.id);
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
let cajasSucursalV227=[]; let cajaEstadoV227=null; let cajaMovimientosV227=[]; let cashMovementTypeV227=null;
async function cargarCajasSucursalV227({ mantener = true } = {}) {
  const selector = $("#cash-selector-v227");

  if (!appContext?.branch?.id) {
    cajasSucursalV227 = [];
    if (selector) selector.innerHTML = `<option value="">Sin sucursal</option>`;
    appContext.cashRegister = null;
    renderCashOptionsV23013();
    actualizarContextSelectorLabelsV23013();
    await cargarEstadoCajaV227();
    return;
  }

  const { data, error } = await supabaseClient.rpc(
    "listar_cajas_sucursal_v1",
    { p_sucursal_id: appContext.branch.id }
  );

  if (error) {
    console.error("[V2.27] cajas", error);
    cajasSucursalV227 = [];
    if (selector) selector.innerHTML = `<option value="">Sin cajas</option>`;
    appContext.cashRegister = null;
    renderCashOptionsV23013();
    actualizarContextSelectorLabelsV23013();
    await cargarEstadoCajaV227();
    return;
  }

  cajasSucursalV227 = data || [];

  if (selector) {
    selector.innerHTML = cajasSucursalV227
      .map((c) => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`)
      .join("");
  }

  const key =
    appContext.business?.id && appContext.branch?.id
      ? `vendify_cash_${appContext.business.id}_${appContext.branch.id}`
      : null;

  const saved = mantener && key ? localStorage.getItem(key) : null;
  const current = appContext.cashRegister?.id;

  const chosen =
    cajasSucursalV227.find((c) => c.id === saved) ||
    cajasSucursalV227.find((c) => c.id === current) ||
    cajasSucursalV227[0] ||
    null;

  appContext.cashRegister = chosen
    ? { id: chosen.id, nombre: chosen.nombre }
    : null;

  if (selector && chosen) selector.value = chosen.id;
  if (key && chosen) localStorage.setItem(key, chosen.id);

  renderCashOptionsV23013();
  actualizarContextSelectorLabelsV23013();
  await cargarEstadoCajaV227();
}

async function cambiarCajaDesdeSelectorV227(e) {
  const id = e.target.value;
  const c = cajasSucursalV227.find((x) => x.id === id);

  if (!c) {
    e.target.value = appContext.cashRegister?.id || "";
    return;
  }

  if (carrito.length) {
    const ok = await confirmar(
      "Cambiar de caja",
      "El carrito actual se vaciará al cambiar de caja."
    );

    if (!ok) {
      e.target.value = appContext.cashRegister?.id || "";
      renderCashOptionsV23013();
      return;
    }

    carrito = [];
    renderCarrito();
  }

  appContext.cashRegister = { id: c.id, nombre: c.nombre };

  localStorage.setItem(
    `vendify_cash_${appContext.business.id}_${appContext.branch.id}`,
    c.id
  );

  actualizarContextSelectorLabelsV23013();
  renderCashOptionsV23013();
  guardarContextoOfflineV231?.();
  await cargarEstadoCajaV227();
}

async function cargarEstadoCajaV227() {
  if (!appContext?.cashRegister?.id) {
    cajaEstadoV227 = null;
    renderEstadoCajaHeaderV227();
    return;
  }

  if (!navigator.onLine) {
    if (restaurarPruebaCajaOfflineV2311?.()) {
      return;
    }

    cajaEstadoV227 = null;
    renderEstadoCajaHeaderV227();
    return;
  }

  const { data, error } = await supabaseClient.rpc(
    "obtener_estado_caja_v1",
    {
      p_caja_id: appContext.cashRegister.id,
    }
  );

  if (error) {
    console.error("[V2.27] estado", error);

    if (
      !navigator.onLine &&
      restaurarPruebaCajaOfflineV2311?.()
    ) {
      return;
    }

    cajaEstadoV227 = null;
    renderEstadoCajaHeaderV227();
    return;
  }

  cajaEstadoV227 = data;
  guardarPruebaCajaOfflineV2311?.();
  renderEstadoCajaHeaderV227();
}
function cajaAbiertaMiaV227(){return Boolean(cajaEstadoV227?.sesion&&cajaEstadoV227?.es_mia);}
function renderEstadoCajaHeaderV227(){const btn=$("#btn-caja-v227"),dot=$("#cash-status-dot-v227"),label=$("#cash-status-label-v227");if(!btn||!dot||!label)return;dot.classList.remove("open","closed","busy");if(!appContext?.cashRegister?.id){dot.classList.add("closed");label.textContent="Sin caja";return;}if(!cajaEstadoV227?.sesion){dot.classList.add("closed");label.textContent="Caja cerrada";return;}if(cajaEstadoV227.es_mia){dot.classList.add("open");label.textContent="Caja abierta";}else{dot.classList.add("busy");label.textContent="Caja ocupada";}}
async function abrirPanelCajaV227(){if(!appContext?.cashRegister?.id){mostrarToast("Esta sucursal no tiene una caja activa","error");return;}await cargarEstadoCajaV227();await renderPanelCajaV227();await renderHistorialCajaV227();$("#cash-context-v227").textContent=`${appContext.branch?.nombre||"Sucursal"} · ${appContext.cashRegister?.nombre||"Caja"}`;$("#modal-caja-operativa-v227").classList.remove("hidden");}
function cerrarPanelCajaV227(){$("#modal-caja-operativa-v227")?.classList.add("hidden");}
async function renderPanelCajaV227(){const cont=$("#cash-current-v227");if(!cont)return;if(!appContext?.cashRegister?.id){cont.innerHTML=`<div class="cash-empty-v227">No hay una caja activa.</div>`;return;}if(!cajaEstadoV227?.sesion){cont.innerHTML=`<section class="cash-status-card-v227 closed"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 closed"></span><div><strong>Caja cerrada</strong><small>${escapeHtml(appContext.cashRegister.nombre)}</small></div></div><form id="form-open-cash-v227" class="cash-open-form-v227"><div class="form-group"><label for="cash-opening-fund-v227">Fondo inicial</label><input type="number" id="cash-opening-fund-v227" value="0" min="0" step="0.01" required/><small class="hint">Efectivo físico antes de empezar.</small></div><div class="form-group"><label for="cash-opening-note-v227">Nota</label><input id="cash-opening-note-v227" maxlength="200" placeholder="Opcional"/></div><span class="field-error" id="cash-opening-error-v227"></span><button type="submit" class="btn btn-primary btn-lg">Abrir caja</button></form></section>`;$("#form-open-cash-v227")?.addEventListener("submit",abrirCajaV227);return;}const s=cajaEstadoV227.sesion;if(!cajaEstadoV227.es_mia){cont.innerHTML=`<section class="cash-status-card-v227 busy"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 busy"></span><div><strong>Caja en uso</strong><small>Abierta por ${escapeHtml(s.usuario_nombre||"otro usuario")}</small></div></div><p class="cash-busy-copy-v227">Seleccioná otra caja o esperá el cierre del turno.</p>${cajaEstadoV227.puede_supervisar?`<button type="button" class="btn btn-secondary" id="btn-supervisor-close-v227">Cerrar como supervisor</button>`:""}</section>`;$("#btn-supervisor-close-v227")?.addEventListener("click",abrirCierreCajaV227);return;}cont.innerHTML=`<section class="cash-status-card-v227 open"><div class="cash-open-head-v227"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 open"></span><div><strong>Turno abierto</strong><small>Desde ${escapeHtml(formatearFechaHoraV227(s.abierta_en))}</small></div></div><button type="button" class="btn btn-danger btn-sm" id="btn-open-cash-close-v227">Cerrar caja</button></div><div class="cash-summary-grid-v227"><div class="cash-summary-item-v227"><span>Ventas</span><strong>${formatearPrecio(Number(s.ventas_total||0))}</strong><small>${Number(s.tickets||0)} tickets</small></div><div class="cash-summary-item-v227"><span>Efectivo vendido</span><strong>${formatearPrecio(Number(s.ventas_efectivo||0))}</strong><small>Ventas en efectivo</small></div><div class="cash-summary-item-v227"><span>Ingresos</span><strong class="positive">${formatearPrecio(Number(s.ingresos_total||0))}</strong><small>Movimientos manuales</small></div><div class="cash-summary-item-v227"><span>Retiros</span><strong class="negative">${formatearPrecio(Number(s.retiros_total||0))}</strong><small>Salidas manuales</small></div><div class="cash-summary-item-v227 featured"><span>Efectivo esperado</span><strong>${formatearPrecio(Number(s.efectivo_esperado||0))}</strong><small>Incluye fondo inicial</small></div></div><div class="cash-actions-v227"><button type="button" class="btn btn-secondary" data-cash-movement="ingreso">＋ Ingreso</button><button type="button" class="btn btn-secondary" data-cash-movement="retiro">− Retiro</button></div><div class="cash-movements-section-v227"><div class="cash-section-head-v227"><div><h3>Movimientos</h3><p>Ingresos y retiros del turno.</p></div></div><div id="cash-movements-v227" class="cash-movements-v227"></div></div></section>`;$("#btn-open-cash-close-v227")?.addEventListener("click",abrirCierreCajaV227);cont.querySelectorAll("[data-cash-movement]").forEach(btn=>btn.addEventListener("click",()=>abrirMovimientoCajaV227(btn.dataset.cashMovement)));await renderMovimientosCajaV227();}
async function abrirCajaV227(e){
  e.preventDefault();
  if(cajaOperacionEnCursoV23011)return;
  cajaOperacionEnCursoV23011=true;
  const er=$("#cash-opening-error-v227");
  er.textContent="";
  const btn=e.submitter;
  if(btn){btn.disabled=true;btn.textContent="Abriendo...";}
  try{
    const{data,error}=await supabaseClient.rpc("abrir_caja_v1",{
      p_caja_id:appContext.cashRegister.id,
      p_fondo_inicial:Number($("#cash-opening-fund-v227").value||0),
      p_nota:$("#cash-opening-note-v227").value.trim()||null
    });
    if(error){er.textContent=error.message;return;}
    cajaEstadoV227=data;
    renderEstadoCajaHeaderV227();
    await renderPanelCajaV227();
    await renderHistorialCajaV227();
    mostrarToast("Caja abierta","success");
  }finally{
    cajaOperacionEnCursoV23011=false;
    if(btn){btn.disabled=false;btn.textContent="Abrir caja";}
  }
}
function abrirMovimientoCajaV227(tipo){cashMovementTypeV227=tipo;$("#cash-movement-type-v227").value=tipo;$("#cash-movement-title-v227").textContent=tipo==="ingreso"?"Registrar ingreso":"Registrar retiro";$("#cash-movement-amount-v227").value="";$("#cash-movement-reason-v227").value="";$("#cash-movement-error-v227").textContent="";$("#modal-caja-movimiento-v227").classList.remove("hidden");}
function cerrarMovimientoCajaV227(){$("#modal-caja-movimiento-v227")?.classList.add("hidden");}
async function guardarMovimientoCajaV227(e){
  e.preventDefault();
  if(cajaOperacionEnCursoV23011)return;
  cajaOperacionEnCursoV23011=true;
  const er=$("#cash-movement-error-v227");
  er.textContent="";
  const btn=e.submitter;
  if(btn){btn.disabled=true;btn.textContent="Registrando...";}
  try{
    const{data,error}=await supabaseClient.rpc("registrar_movimiento_caja_v1",{
      p_caja_id:appContext.cashRegister.id,
      p_tipo:$("#cash-movement-type-v227").value,
      p_monto:Number($("#cash-movement-amount-v227").value),
      p_motivo:$("#cash-movement-reason-v227").value.trim()
    });
    if(error){er.textContent=error.message;return;}
    cajaEstadoV227=data;
    cerrarMovimientoCajaV227();
    renderEstadoCajaHeaderV227();
    await renderPanelCajaV227();
    mostrarToast(cashMovementTypeV227==="ingreso"?"Ingreso registrado":"Retiro registrado","success");
  }finally{
    cajaOperacionEnCursoV23011=false;
    if(btn){btn.disabled=false;btn.textContent="Registrar";}
  }
}
async function renderMovimientosCajaV227(){const cont=$("#cash-movements-v227");if(!cont||!cajaEstadoV227?.sesion)return;const{data,error}=await supabaseClient.rpc("listar_movimientos_caja_abierta_v1",{p_caja_id:appContext.cashRegister.id});if(error){cont.innerHTML=`<p class="hint">No se pudieron cargar los movimientos.</p>`;return;}cajaMovimientosV227=data||[];if(!cajaMovimientosV227.length){cont.innerHTML=`<p class="cash-no-movements-v227">Todavía no hay movimientos manuales.</p>`;return;}cont.innerHTML=cajaMovimientosV227.map(m=>`<div class="cash-movement-row-v227 ${m.tipo}"><div><strong>${m.tipo==="ingreso"?"Ingreso":"Retiro"}</strong><small>${escapeHtml(m.motivo)} · ${escapeHtml(formatearFechaHoraV227(m.creado))}</small></div><strong>${m.tipo==="ingreso"?"+":"−"}${formatearPrecio(Number(m.monto||0))}</strong></div>`).join("");}
function abrirCierreCajaV227(){if(!cajaEstadoV227?.sesion)return;const esperado=Number(cajaEstadoV227.sesion.efectivo_esperado||0);$("#cash-close-expected-v227").textContent=formatearPrecio(esperado);$("#cash-close-declared-v227").value=esperado.toFixed(2);$("#cash-close-note-v227").value="";$("#cash-close-error-v227").textContent="";actualizarPreviewCierreV227();$("#modal-cash-close-v227").classList.remove("hidden");}
function cerrarCierreCajaV227(){$("#modal-cash-close-v227")?.classList.add("hidden");}
function actualizarPreviewCierreV227(){const esperado=Number(cajaEstadoV227?.sesion?.efectivo_esperado||0),declarado=Number($("#cash-close-declared-v227")?.value||0),dif=declarado-esperado,el=$("#cash-difference-preview-v227");if(!el)return;el.classList.remove("positive","negative","neutral");el.classList.add(Math.abs(dif)<.005?"neutral":dif>0?"positive":"negative");el.textContent=`Diferencia: ${dif>0?"+":""}${formatearPrecio(dif)}`;}
async function cerrarCajaV227(e){
  e.preventDefault();
  if(cajaOperacionEnCursoV23011)return;
  cajaOperacionEnCursoV23011=true;
  const er=$("#cash-close-error-v227");
  er.textContent="";
  const btn=e.submitter;
  if(btn){btn.disabled=true;btn.textContent="Cerrando...";}
  try{
    const{data,error}=await supabaseClient.rpc("cerrar_caja_v1",{
      p_caja_id:appContext.cashRegister.id,
      p_efectivo_declarado:Number($("#cash-close-declared-v227").value),
      p_nota:$("#cash-close-note-v227").value.trim()||null
    });
    if(error){er.textContent=error.message;return;}
    const s=data?.sesion;
    cerrarCierreCajaV227();
    await cargarEstadoCajaV227();
    await renderPanelCajaV227();
    await renderHistorialCajaV227();
    const dif=Number(s?.diferencia||0);
    mostrarToast(
      Math.abs(dif)<.005
        ?"Caja cerrada sin diferencias"
        :`Caja cerrada · diferencia ${dif>0?"+":""}${formatearPrecio(dif)}`,
      Math.abs(dif)<.005?"success":"info"
    );
  }finally{
    cajaOperacionEnCursoV23011=false;
    if(btn){btn.disabled=false;btn.textContent="Cerrar caja";}
  }
}
async function renderHistorialCajaV227(){const cont=$("#cash-history-v227");if(!cont||!appContext?.branch?.id)return;const{data,error}=await supabaseClient.rpc("listar_historial_cajas_v1",{p_sucursal_id:appContext.branch.id,p_limit:12});if(error){cont.innerHTML=`<p class="hint">No se pudo cargar el historial.</p>`;return;}const list=data||[];if(!list.length){cont.innerHTML=`<p class="cash-no-movements-v227">Todavía no hay cierres registrados.</p>`;return;}cont.innerHTML=list.map(s=>{const d=Number(s.diferencia||0);return`<div class="cash-history-row-v227"><div class="cash-history-main-v227"><strong>${escapeHtml(s.caja_nombre)} · ${escapeHtml(s.usuario_nombre)}</strong><small>${escapeHtml(formatearFechaHoraV227(s.cerrada_en))} · ${Number(s.tickets||0)} tickets</small></div><div class="cash-history-sales-v227"><span>Ventas</span><strong>${formatearPrecio(Number(s.ventas_total||0))}</strong></div><div class="cash-history-diff-v227 ${Math.abs(d)<.005?"zero":d>0?"positive":"negative"}"><span>Diferencia</span><strong>${d>0?"+":""}${formatearPrecio(d)}</strong></div></div>`;}).join("");}
function formatearFechaHoraV227(v){if(!v)return"—";try{return new Intl.DateTimeFormat("es-AR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(v));}catch{return String(v);}}
async function inicializarCajaV227(){await cargarCajasSucursalV227();}
function setupCajaV227(){$("#cash-selector-v227")?.addEventListener("change",cambiarCajaDesdeSelectorV227);$("#btn-caja-v227")?.addEventListener("click",abrirPanelCajaV227);$("#btn-cerrar-caja-panel-v227")?.addEventListener("click",cerrarPanelCajaV227);$("#modal-caja-operativa-v227 .modal-backdrop")?.addEventListener("click",cerrarPanelCajaV227);$("#form-cash-movement-v227")?.addEventListener("submit",guardarMovimientoCajaV227);$("#btn-close-cash-movement-v227")?.addEventListener("click",cerrarMovimientoCajaV227);$("#btn-cancel-cash-movement-v227")?.addEventListener("click",cerrarMovimientoCajaV227);$("#modal-caja-movimiento-v227 .modal-backdrop")?.addEventListener("click",cerrarMovimientoCajaV227);$("#form-cash-close-v227")?.addEventListener("submit",cerrarCajaV227);$("#btn-close-cash-close-v227")?.addEventListener("click",cerrarCierreCajaV227);$("#btn-cancel-cash-close-v227")?.addEventListener("click",cerrarCierreCajaV227);$("#modal-cash-close-v227 .modal-backdrop")?.addEventListener("click",cerrarCierreCajaV227);$("#cash-close-declared-v227")?.addEventListener("input",actualizarPreviewCierreV227);}

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

  if (carrito.length) {
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
      const { error } = await supabaseClient.rpc("cambiar_estado_caja_v1", {
        p_caja_id: btn.dataset.cajaId,
        p_activa: btn.dataset.activa === "1",
      });

      if (error) {
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

  const { error } = await supabaseClient.rpc("crear_caja_v1", {
    p_sucursal_id: $("#caja-sucursal-id-v226").value,
    p_nombre: $("#caja-nombre-v226").value.trim(),
  });

  if (error) {
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

document.addEventListener("DOMContentLoaded", init);
