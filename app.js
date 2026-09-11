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
  let data;
  try {
    data = await window.VendifyContextV232.getApp(supabaseClient);
  } catch (error) {
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
    const customPermissions =
      await window.VendifyContextV232.getPermissions(supabaseClient);

    if (customPermissions && Object.keys(customPermissions).length) {
      appContext.permissions = {
        ...appContext.permissions,
        ...customPermissions,
      };
    }
  } catch (permissionError) {
    console.warn("[Vendify permisos] fallback a permisos por rol:", permissionError);
  }

  // Si es un usuario interno, recuperamos nombre y username reales.
  try {
    const employeeProfile = await window.VendifyContextV232.getEmployee(supabaseClient);
    if (Object.keys(employeeProfile).length) appContext.employee = employeeProfile;
  } catch (employeeProfileError) {
    console.warn("[Vendify empleados] perfil no disponible:", employeeProfileError);
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
  return window.VendifyContextV232.listBranches(supabaseClient);
}

async function cambiarSucursalV2(sucursalId, { recargar = true } = {}) {
  const data = await window.VendifyContextV232.getBranch(supabaseClient, sucursalId);

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

// ============================================================
// Autenticación Vendify — controlador TypeScript
// ============================================================
const authControllerV232 = window.VendifyAuthV232.createController({
  auth: supabaseClient.auth,
  showApp: mostrarAppSeguroVQA,
  beforeSignOut: limpiarContextoApp,
  async handleSignedOut() {
    appBootUserIdVQA = null;
    appBootPromiseVQA = null;
    limpiarContextoApp();
    productos = [];
    posControllerV232.clearCart();
    if (realtimeChannel) {
      supabaseClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  },
  showToast: mostrarToast,
  icon: iconV23011,
});

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

// ============================================================
// V2.3 — EQUIPO / USUARIOS INTERNOS — controlador TypeScript
// ============================================================
const teamControllerV232 = window.VendifyTeamV232.createController({
  client: supabaseClient,
  functions: supabaseClient.functions,
  getContext: () => window.appContext,
  requirePermission: exigirPermisoV2,
  showToast: mostrarToast,
  confirm: confirmar,
  roleName: nombreRolV2,
});


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
  window.VendifyCoreV232.loadTheme(THEME_KEY);
}

function toggleTema() {
  const nuevo = window.VendifyCoreV232.toggleTheme(THEME_KEY);
  mostrarToast(nuevo === "light" ? "Tema claro activado" : "Tema oscuro activado", "info");
}

// =====================
// Utilidades
// =====================
function formatearPrecio(valor) {
  return window.VendifyCoreV232.formatArs(valor);
}


function escapeHtml(texto) {
  return window.VendifyCoreV232.escapeHtml(texto);
}

function mostrarToast(mensaje, tipo = "success") {
  window.VendifyCoreV232.showToast(mensaje, tipo);
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
  return window.VendifyCoreV232.showConfirmation(titulo, mensaje, {
    okText,
    cancelText,
    danger,
  });
}

// =====================
// Categorías delegadas a TypeScript
// =====================
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
  if (securityLogoutRunningV2301 || !authControllerV232.getSession()?.user) return;

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
    await authControllerV232.signOut();
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
let syncInFlightV23011 = null;

function asegurarVentaRequestIdV23011() {
  return posControllerV232.ensureRequestId();
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
    const data = await window.VendifyContextV232.runDiagnostic(supabaseClient);
    renderDiagnosticoV23011(data);
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
  cashControllerV232.renderOptions();
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
    if (posControllerV232.getCart().length > 0) {
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
  const uid = authControllerV232.getSession()?.user?.id || "anon";
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
  const uid = authControllerV232.getSession()?.user?.id;
  if (!appContext?.ready || !uid) return;

  try {
    localStorage.setItem(
      `${VENDIFY_CONTEXT_PREFIX_V231}:${uid}`,
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
  const uid = authControllerV232.getSession()?.user?.id;
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

    const cart = posControllerV232.getCart();
    if (!cart.length) {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        carrito: cart,
      })
    );
  } catch {}
}

function restaurarCarritoV231() {
  if (posControllerV232.getCart().length || !productos.length) return false;

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

    posControllerV232.setCart(restored);
    return true;
  } catch {
    return false;
  }
}

function leerVentasOfflineV2311() {
  return offlineControllerV232.readLegacySales();
}

function guardarPruebaCajaOfflineV2311() {
  offlineControllerV232.persistCashProof();
}

function restaurarPruebaCajaOfflineV2311() {
  return offlineControllerV232.restoreCashProof();
}

function actualizarUIVentasOfflineV2311() {
  offlineControllerV232.updateUi();
}

function aplicarEstadoOfflineVentaV231() {
  offlineControllerV232.applySaleState();
}

function validarPagosOfflineV2311(pagos) {
  offlineControllerV232.validatePayments(pagos);
}

function validarStockLocalVentaV2311(items) {
  offlineControllerV232.validateLocalStock(items);
}

function aplicarVentaAlStockLocalV2311(items) {
  offlineControllerV232.applySaleToLocalStock(items);
}

function aplicarVentaCajaLocalV2311(pagos, total) {
  offlineControllerV232.applySaleToLocalCash(pagos, total);
}

function construirTicketOfflineV2311(sale) {
  return offlineControllerV232.buildTicket(sale);
}

function registrarVentaOfflineV2311(items, pagos, totales, observacion) {
  return offlineControllerV232.registerLegacySale(items, pagos, totales, observacion);
}

async function sincronizarVentasOfflineV2311(options = {}) {
  return offlineControllerV232.sync(options);
}

function setupOfflineSalesV2311() {
  offlineControllerV232.setup();
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
    !authControllerV232.getSession()?.user ||
    !appContext?.business?.id
  ) {
    return;
  }

  const cleanMessage = window.VendifyObservabilityV232.sanitizeClientErrorMessage(mensaje);

  const key = `${tipo}:${cleanMessage.slice(0, 140)}`;
  const last = errorLogThrottleV231.get(key) || 0;

  if (Date.now() - last < 30000) return;
  errorLogThrottleV231.set(key, Date.now());

  try {
    await window.VendifyObservabilityV232.logClientError(supabaseClient, {
      type: tipo,
      message: cleanMessage,
      version: VENDIFY_VERSION_V231,
      context: {
        path: location.pathname,
        role: appContext.membership?.role || null,
        branch_id: appContext.branch?.id || null,
        online: navigator.onLine,
        ...contexto,
      }
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
    const data = await window.VendifyCommercialV232.getOnboarding(supabaseClient);
    renderOnboardingComercialV231(data);
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
    const data = await window.VendifyCommercialV232.getPlan(supabaseClient);

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
    const data = await window.VendifyCommercialV232.getOperationalConfig(supabaseClient);

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
    await window.VendifyCommercialV232.saveOperationalConfig(supabaseClient, {
      stockCoverageAlert: Number($("#config-stock-days-v231").value || 3),
      largeAdjustmentUnits: Number($("#config-adjust-threshold-v231").value || 10),
      cashDifferenceAlert: Number($("#config-cash-diff-v231").value || 0),
      dailySummary: $("#config-daily-summary-v231").checked,
      autoPrintTicket: $("#config-auto-print-v231").checked,
      ticketWidthMm: Number($("#config-ticket-width-v231").value || 80),
    });

    await cargarConfigOperativaV231();
    await dashboardControllerV232.loadAlertBadge();
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
    const data = await window.VendifyCommercialV232.exportBackup(supabaseClient);

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
  return window.VendifyProductsV232.parseCsvLine(line);
}

function normalizarHeaderCSVV231(value) {
  return window.VendifyProductsV232.normalizeCsvHeader(value);
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
    const data = await window.VendifyProductsV232.importBulkCatalog(
      supabaseClient,
      appContext.branch.id,
      items
    );

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
    const data = await window.VendifyPlatformV232.isAdmin(supabaseClient);

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
    const { overview: data, businesses, errors: errorsResult } =
      await window.VendifyPlatformV232.loadBackoffice(supabaseClient);

    $("#platform-businesses-v231").textContent =
      Number(data.negocios || 0);

    $("#platform-trials-v231").textContent =
      Number(data.trials || 0);

    $("#platform-sales-v231").textContent =
      formatearPrecio(Number(data.ventas_hoy || 0));

    $("#platform-errors-v231").textContent =
      Number(data.errores_24h || 0);

    window.VendifyDashboardV232.renderDashboardRows(
      $("#platform-business-list-v231"),
      businesses,
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

    window.VendifyDashboardV232.renderDashboardRows(
      $("#platform-error-list-v231"),
      errorsResult,
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
      window.VendifyDashboardV232.dashboardEmpty(
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
    await window.VendifyPlatformV232.updatePlan(
      supabaseClient, negocioId, plan, estado
    );

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
    dashboardControllerV232.loadAlertBadge(),
    verificarPlatformAdminV231(),
  ]);

  clearInterval(commercialRefreshTimerV231);

  commercialRefreshTimerV231 = setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      navigator.onLine
    ) {
      void dashboardControllerV232.loadAlertBadge();
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
        void teamControllerV232.open();
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

const branchTransferControllerV232 =
  window.VendifyInventoryV232.createBranchTransferController({
    client: supabaseClient,
    canManage: () =>
      ["owner", "admin", "manager"].includes(
        appContext.membership?.role
      ),
    getActiveBranchId: () => appContext.branch?.id || null,
    listBranches: listarSucursalesV2,
    mapProduct: mapearProductoDB,
    productLabel: productoEtiquetaV29,
    showToast: mostrarToast,
    emitStockChange: emitirCambioStockRealtime,
    reloadProducts: cargarProductos,
    renderProducts: renderGrid,
    refreshBranchSettings: renderSucursalesConfigV226,
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
      void dashboardControllerV232.loadAlertBadge();
    },
  });

function actualizarEstadoPinDescuento() {
  return discountControllerV232.updatePinState();
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
function renderCarrito() {
  posControllerV232.renderCart();
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
function cerrarHistorial() {
  salesHistoryControllerV232.close();
}
async function renderHistorial() {
  await salesHistoryControllerV232.render();
}
// Eventos
// =====================
function inicializarEventos() {
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
    void teamControllerV232.open();
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
    window.VendifyCoreV232.dismissConfirmation();
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
      else if (!$("#modal-equipo").classList.contains("hidden")) teamControllerV232.close();
      else if (!$("#modal-crop-foto").classList.contains("hidden")) cerrarEditorRecorte();
      else if (!$("#modal-editar-empleado").classList.contains("hidden")) teamControllerV232.closeEditor();
      else if (!$("#modal-reset-empleado").classList.contains("hidden")) teamControllerV232.closePasswordReset();
      else if (!$("#modal-config").classList.contains("hidden")) cerrarConfig();
      else if (!$("#modal-confirm").classList.contains("hidden")) {
        window.VendifyCoreV232.dismissConfirmation();
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
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("[PWA] No se pudo registrar el service worker:", error);
  });
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

function abrirCatalogoV29() {
  productsControllerV232.openCatalog();
}

async function cargarEjemplos() {
  productsControllerV232.openCatalog();
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
    userId: authControllerV232.getSession()?.user?.id || null,
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
async function abrirPanelCajaV227(){await cashControllerV232.openPanel();}
async function renderPanelCajaV227(){await cashControllerV232.renderPanel();}
function formatearFechaHoraV227(v){if(!v)return"—";try{return new Intl.DateTimeFormat("es-AR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(v));}catch{return String(v);}}
async function inicializarCajaV227(){await cashControllerV232.initialize();}
function setupCajaV227(){cashControllerV232.setup();}

let sucursalesV226 = [];

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
  return window.VendifyBranchesV232.listAdmin(supabaseClient);
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

  const input = {
    name: $("#sucursal-nombre-v226").value.trim(),
    address: $("#sucursal-direccion-v226").value.trim() || null,
    phone: $("#sucursal-telefono-v226").value.trim() || null,
    active: $("#sucursal-activa-v226").checked,
  };

  try {
    if (id) {
      await window.VendifyBranchesV232.update(supabaseClient, id, input);
    } else {
      await window.VendifyBranchesV232.create(supabaseClient, input);
    }
  } catch (error) {
    errorEl.textContent = error.message;
    return;
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar";
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

  branchTransferControllerV232.setup();

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
  authControllerV232.setup();
  teamControllerV232.setup();
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
  void authControllerV232.initialize();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  void init();
}
