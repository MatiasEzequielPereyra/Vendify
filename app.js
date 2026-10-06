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



// El catálogo inicial vive en src/products/catalog-data.ts.

const productsStoreV232 = window.VendifyProductsV232.createStore();
let productoEditandoId = null;

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
        connectionStatusControllerV232.setState(
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

  // Equipo está disponible para propietario, administrador y encargado.
  const puedeGestionarEquipo = esOwner || esAdmin || esManager;

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
  contextPickerControllerV232.renderBranchOptions();
  contextPickerControllerV232.renderCashOptions();
  contextPickerControllerV232.updateLabels();
  guardarContextoOfflineV231?.();

  if (recargar) {
    posControllerV232.clearCart();
    await cargarProductos();
    actualizarFiltroCategorias();
    renderGrid();
    if (!$("#modal-venta")?.classList.contains("hidden")) renderVentaProductos();
  }

  realtimeControllerV232.subscribe();
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
    productsStoreV232.clear();
    posControllerV232.clearCart();
    realtimeControllerV232.disconnect();
  },
  showToast: mostrarToast,
  icon: iconV23011,
});

const inactivityGuardV232 = window.VendifyAuthV232.createInactivityGuard({
  getSession: () => authControllerV232.getSession(),
  signOut: () => authControllerV232.signOut(),
  showToast: mostrarToast,
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
    contextPickerControllerV232.updateLabels();
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

  realtimeControllerV232.subscribe();
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
async function refreshRealtimeCatalogV232() {
  await cargarProductos();
  actualizarFiltroCategorias();
  renderGrid();
  aplicarPermisosV2();
  if (!$("#modal-venta")?.classList.contains("hidden")) {
    renderVentaProductos();
    renderCarrito();
  }
}

async function syncRealtimeStockV232(render = true) {
  const branchId = appContext?.branch?.id;
  if (!branchId) return false;
  const { data, error } = await supabaseClient
    .from("producto_stock_sucursal")
    .select("producto_id,stock,stock_minimo")
    .eq("sucursal_id", branchId);
  if (error) throw error;

  let changed = false;
  const stockMap = new Map((data || []).map((row) => [row.producto_id, row]));
  productsStoreV232.list().forEach((product) => {
    const row = stockMap.get(product.id);
    if (!row) return;
    const stock = Number(row.stock || 0);
    const minimum = Number(row.stock_minimo || 0);
    if (Number(product.stock || 0) !== stock || Number(product.stockMinimo || 0) !== minimum) {
      productsStoreV232.patchStock(product.id, stock, minimum);
      changed = true;
    }
  });
  if (changed && render) {
    renderGrid();
    aplicarPermisosV2();
    if (!$("#modal-venta")?.classList.contains("hidden")) {
      renderVentaProductos();
      renderCarrito();
    }
  }
  return changed;
}

async function refreshRealtimeDependentViewsV232() {
  if (!$("#modal-historial")?.classList.contains("hidden")) await renderHistorial();
  await inventoryControllerV232.refreshOpenView(false);
  await purchasesControllerV232.refreshOpenViews();
  if (!$("#modal-caja-operativa-v227")?.classList.contains("hidden")) {
    await cargarEstadoCajaV227();
    await renderPanelCajaV227();
  }
}

const realtimeControllerV232 = window.VendifyRealtimeV232.createController({
  client: supabaseClient,
  getScope: () => ({
    ready: appContext?.ready === true,
    businessId: appContext?.business?.id || null,
    branchId: appContext?.branch?.id || null,
  }),
  getVisibility: () => document.visibilityState,
  setStatus: (status) => {
    document.documentElement.dataset.realtimeStatus = status.toLowerCase();
  },
  refreshCatalog: refreshRealtimeCatalogV232,
  refreshProducts: refreshRealtimeCatalogV232,
  syncStock: syncRealtimeStockV232,
  refreshSmartStock: async () => {
    await cargarStockInteligente();
    renderGrid();
  },
  refreshDependentViews: refreshRealtimeDependentViewsV232,
  addWindowListener: (event, listener) => window.addEventListener(event, listener),
  addVisibilityListener: (listener) => document.addEventListener("visibilitychange", listener),
  report: (level, context, error) => {
    const detail = error?.message || error;
    console[level](`[Vendify Realtime] ${context}`, ...(detail ? [detail] : []));
  },
  notifyCatalogFailure: () => mostrarToast("No se pudieron resincronizar los datos", "error"),
});


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
    store: productsStoreV232,
    getBusinessId: () => appContext.business?.id || null,
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
    emitStockChange: realtimeControllerV232.emitStockChange,
    scheduleSmartRefresh: realtimeControllerV232.scheduleSmartRefresh,
    renderSaleProducts: () => { renderVentaProductos(); },
    renderCart: () => { renderCarrito(); },
    isSaleOpen: () => !$("#modal-venta")?.classList.contains("hidden"),
    addToCart: agregarAlCarrito,
    openInventoryAdjustment: (id, delta) => {
      inventoryControllerV232.openAdjustmentFromProduct(id, delta);
    },
    setEditingProductId: (id) => { productoEditandoId = id; },
    getEditingProductId: () => productoEditandoId,
    restoreSaleBehindProduct: (focus = true) => {
      restaurarVentaDetrasProducto({ enfocar: focus });
    },
    shouldReturnCreatedProductToSale: () =>
      Boolean(scannerControllerV232?.shouldReturnCreatedProductToSale()),
    clearPendingScannerProduct: () => {
      scannerControllerV232?.clearPendingProduct();
    },
    returnToScannerFromEditor: () =>
      Boolean(scannerControllerV232?.returnFromProductEditor()),
    onEditorClose: () => dashboardNavigationV236.complete("product"),
  });

const onboardingControllerV232 =
  window.VendifyCoreV232.createOnboardingController({
    onExamples: () => productsControllerV232.openCatalog(),
  });


const diagnosticsControllerV232 =
  window.VendifyObservabilityV232.createDiagnosticsController({
    getRole: () => appContext.membership?.role || null,
    isOnline: () => navigator.onLine,
    getBranchName: () => appContext.branch?.nombre || null,
    getCashRegisterName: () => appContext.cashRegister?.nombre || null,
    runDiagnostic: () =>
      window.VendifyContextV232.runDiagnostic(supabaseClient),
    showToast: mostrarToast,
  });
scannerControllerV232 =
  window.VendifyProductsV232.createScannerController({
    client: supabaseClient,
    store: productsStoreV232,
    getCart: () => posControllerV232.getCart(),
    getBranchId: () => appContext.branch?.id || null,
    getEditingProductId: () => productoEditandoId,
    showToast: mostrarToast,
    emitStockChange: realtimeControllerV232.emitStockChange,
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
  void teamControllerV232.refreshBusinessAccessCode();
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

// CRUD, borrado masivo y cola de stock migrados a products-controller.ts








// ============================================================
// Vendify v2.30.1.1 — Stability & Data Integrity
// ============================================================

const VENDIFY_VERSION_V23011 = "2.31.0";
let syncInFlightV23011 = null;

function asegurarVentaRequestIdV23011() {
  return posControllerV232.ensureRequestId();
}

async function sincronizarTodoV23011({ toast = false } = {}) {
  if (syncInFlightV23011) return syncInFlightV23011;

  syncInFlightV23011 = (async () => {
    if (!navigator.onLine) {
      connectionStatusControllerV232.setState("offline");
      if (toast) mostrarToast("No hay conexión a internet", "info");
      return false;
    }

    connectionStatusControllerV232.setState("syncing");

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

      connectionStatusControllerV232.setState("online");
      if (toast) mostrarToast("Datos sincronizados", "success");
      return true;
    } catch (error) {
      console.error("[Vendify Stability] sync:", error);
      connectionStatusControllerV232.setState("error");
      if (toast) mostrarToast(error.message || "No se pudo sincronizar", "error");
      return false;
    }
  })().finally(() => {
    syncInFlightV23011 = null;
  });

  return syncInFlightV23011;
}

const overlayStabilityControllerV232 =
  window.VendifyCoreV232.createOverlayStabilityController({
    closeUserMenu: () => abrirCerrarMenuUsuarioV224?.(false),
    closeManagementMenu: () => abrirCerrarGestionV230?.(false),
    closeContextPickers: () => contextPickerControllerV232.close(),
  });

function setupStabilityV23011() {
  connectionStatusControllerV232.setup();
  overlayStabilityControllerV232.setup();
}

// ============================================================
// Vendify v2.30.1.3 — Context pickers (Sucursal / Caja)
// Typed owner: window.VendifyContextV232.createContextPickerController
// ============================================================

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
  contextPickerControllerV232.close();

  return true;
}

function modalSuperiorVisibleV2311() {
  const visibles = Array.from(
    document.querySelectorAll(".modal")
  ).filter((modal) => overlayStabilityControllerV232.isModalVisible(modal));

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
const VENDIFY_CATALOG_PREFIX_V232 = "vendify_catalog_v232";
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
      safeBusinessKeyV231(VENDIFY_CATALOG_PREFIX_V232),
      window.VendifyProductsV232.serializeOfflineCache(
        { businessId: appContext.business.id, branchId: appContext.branch.id },
        productsStoreV232.list(),
        productsStoreV232.listCategories()
      )
    );
  } catch {}
}

function cargarProductosOfflineV231() {
  try {
    if (!appContext?.business?.id || !appContext?.branch?.id) return false;
    const scope = { businessId: appContext.business.id, branchId: appContext.branch.id };
    const snapshot = window.VendifyProductsV232.parseOfflineCache(
      localStorage.getItem(safeBusinessKeyV231(VENDIFY_CATALOG_PREFIX_V232)),
      scope
    ) || window.VendifyProductsV232.migrateLegacyOfflineCache(
      localStorage.getItem(safeBusinessKeyV231(VENDIFY_PRODUCTS_PREFIX_V231)),
      localStorage.getItem(safeBusinessKeyV231(VENDIFY_CATEGORIES_PREFIX_V231)),
      scope
    );
    if (!snapshot) return false;
    productsStoreV232.restoreProducts(scope, snapshot.products);
    productsStoreV232.replaceCategories(snapshot.categories);
    localStorage.setItem(
      safeBusinessKeyV231(VENDIFY_CATALOG_PREFIX_V232),
      window.VendifyProductsV232.serializeOfflineCache(
        scope, snapshot.products, snapshot.categories, snapshot.savedAt
      )
    );
    return true;
  } catch {
    return false;
  }
}

function guardarCategoriasOfflineV231() {
  guardarProductosOfflineV231();
}

function cargarCategoriasOfflineV231() {
  return cargarProductosOfflineV231();
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
  if (posControllerV232.getCart().length || !productsStoreV232.list().length) return false;

  try {
    const raw = localStorage.getItem(
      safeBusinessKeyV231(VENDIFY_CART_PREFIX_V231)
    );
    if (!raw) return false;

    const snapshot = JSON.parse(raw);
    const restored = (snapshot?.carrito || [])
      .map((item) => {
        const product = productsStoreV232.getById(item.id);
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
    openDestination: abrirDestinoDesdeDashboardV235,
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
    getProducts: () => productsStoreV232.list(),
    mapProduct: mapearProductoDB,
    productLabel: productoEtiquetaV29,
    formatDate: formatearFechaHoraV227,
    isLowStock: esStockBajoInteligente,
    isOutOfStock: esSinStock,
    getSmartStock: obtenerStockInteligente,
    showToast: mostrarToast,
    confirm: confirmar,
    emitStockChange: realtimeControllerV232.emitStockChange,
    reloadProducts: cargarProductos,
    renderProducts: renderGrid,
    onClose: () => {
      dashboardNavigationV236.complete("inventory");
      dashboardNavigationV236.complete("restock");
    },
  });

const branchAdministrationControllerV232 =
  window.VendifyBranchesV232.createBranchAdministrationController({
    client: supabaseClient,
    getRole: () => appContext.membership?.role || null,
    getCurrentBranchId: () => appContext.branch?.id || null,
    refreshBranches: refrescarSucursalesV226,
    reloadCashRegisters: async ({ keep }) => {
      await cargarCajasSucursalV227({ mantener: keep });
    },
    showToast: mostrarToast,
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
    emitStockChange: realtimeControllerV232.emitStockChange,
    reloadProducts: cargarProductos,
    renderProducts: renderGrid,
    refreshBranchSettings: () => branchAdministrationControllerV232.render(),
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
    getProducts: () => productsStoreV232.list(),
    productLabel: productoEtiquetaV29,
    formatDate: formatearFechaHoraV227,
    showToast: mostrarToast,
    confirm: confirmar,
    emitStockChange: realtimeControllerV232.emitStockChange,
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

const dashboardNavigationV236 =
  window.VendifyDashboardV232.createNavigationCoordinator(
    () => dashboardControllerV232.open()
  );

async function abrirDestinoDesdeDashboardV235(destination) {
  if (destination.kind === "sales") {
    dashboardNavigationV236.begin(destination);
    dashboardControllerV232.close();
    await salesHistoryControllerV232.open();
    return;
  }
  if (destination.kind === "inventory") {
    const canManageInventory = ["owner", "admin", "manager"].includes(
      appContext.membership?.role
    ) || tienePermisoV2("adjustStock");
    if (!canManageInventory) {
      mostrarToast("Tu rol no permite administrar inventario", "error");
      return;
    }
    dashboardNavigationV236.begin(destination);
    dashboardControllerV232.close();
    await inventoryControllerV232.openFiltered(destination.filter);
    return;
  }
  const product = productsStoreV232.getById(destination.productId);
  if (!product) {
    mostrarToast("El producto ya no está disponible. Actualizamos el Dashboard.", "info");
    await dashboardControllerV232.load();
    return;
  }
  if (destination.kind === "restock") {
    if (!exigirPermisoV2("adjustStock", "No tenés permiso para ajustar stock")) return;
    dashboardNavigationV236.begin(destination);
    dashboardControllerV232.close();
    await inventoryControllerV232.openAdjustmentFromProduct(destination.productId);
    return;
  }
  if (destination.kind === "product") {
    if (!exigirPermisoV2("manageProducts", "No tenés permiso para modificar productos")) return;
    dashboardNavigationV236.begin(destination);
    dashboardControllerV232.close();
    productsControllerV232.openEditor(product);
    return;
  }
  if (destination.kind === "cash" && appContext.cashRegister?.id) {
    dashboardNavigationV236.begin(destination);
    dashboardControllerV232.close();
    try {
      await cashControllerV232.openPanel();
    } catch (error) {
      dashboardNavigationV236.complete("cash");
      mostrarToast(error?.message || "No se pudo abrir la caja", "error");
    }
  }
}

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
    emitStockChange: realtimeControllerV232.emitStockChange,
    reloadProducts: cargarProductos,
    renderProducts: renderGrid,
    reloadCash: cargarEstadoCajaV227,
    onClose: () => dashboardNavigationV236.complete("sales"),
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
    getProducts: () => productsStoreV232.list(),
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
    emitStockChange: realtimeControllerV232.emitStockChange,
    refreshDependentViews: realtimeControllerV232.refreshDependentViews,
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
  const catalog = productsStoreV232.list();
  if (catalog.length === 0) {
    mostrarToast("No hay productos para exportar", "error");
    return;
  }
  const csv = window.VendifyProductsV232.buildCsv(catalog);
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

  $("#modal-confirm .modal-backdrop").addEventListener("click", () => {
    window.VendifyCoreV232.dismissConfirmation();
  });

  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    const escribiendo = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (e.key === "Escape") {
      const escapeTargets = [
        ["modal-confirm", () => window.VendifyCoreV232.dismissConfirmation()],
        ["modal-ticket-v228", () => $("#btn-close-ticket-v228")?.click()],
        ["modal-return-v228", () => $("#btn-close-return-v228")?.click()],
        ["modal-caja-movimiento-v227", () => $("#btn-close-cash-movement-v227")?.click()],
        ["modal-cash-close-v227", () => $("#btn-close-cash-close-v227")?.click()],
        ["modal-editar-empleado", () => teamControllerV232.closeEditor()],
        ["modal-reset-empleado", () => teamControllerV232.closePasswordReset()],
        ["modal-proveedor-editor", () => $("#btn-close-proveedor-editor")?.click()],
        ["modal-compra-editor", () => $("#btn-close-compra-editor")?.click()],
        ["modal-scanner-v29", () => scannerControllerV232.close()],
        ["modal", () => cerrarModal()],
        ["modal-catalogo-v29", () => $("#btn-close-catalogo-v29")?.click()],
        ["modal-historial", () => cerrarHistorial()],
        ["modal-compras", () => $("#btn-close-compras")?.click()],
        ["modal-inventario", () => $("#btn-close-inventory")?.click()],
        ["modal-caja-operativa-v227", () => $("#btn-cerrar-caja-panel-v227")?.click()],
        ["modal-dashboard-v231", () => $("#btn-close-dashboard-v231")?.click()],
        ["modal-equipo", () => teamControllerV232.close()],
        ["modal-venta", () => cerrarVenta()],
        ["modal-config", () => cerrarConfig()],
      ].map(([id, close]) => ({
        isOpen: () => {
          const modal = $("#" + id);
          return Boolean(modal && !modal.classList.contains("hidden"));
        },
        close,
      }));
      if (window.VendifyCoreV232.closeTopOpenModal(escapeTargets)) {
        e.preventDefault();
        return;
      }
      if (!$("#modal").classList.contains("hidden")) cerrarModal();
      else if (!$("#modal-venta").classList.contains("hidden")) cerrarVenta();
      else if (!$("#modal-historial").classList.contains("hidden")) cerrarHistorial();
      else if (!$("#modal-equipo").classList.contains("hidden")) teamControllerV232.close();
      else if (!$("#modal-editar-empleado").classList.contains("hidden")) teamControllerV232.closeEditor();
      else if (!$("#modal-reset-empleado").classList.contains("hidden")) teamControllerV232.closePasswordReset();
      else if (!$("#modal-config").classList.contains("hidden")) cerrarConfig();
      else if (!$("#modal-confirm").classList.contains("hidden")) {
        window.VendifyCoreV232.dismissConfirmation();
      }
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
// PWA registration compatibility
// =====================
function registrarServiceWorker() {
  if (window.VendifyPwaV232) {
    window.VendifyPwaV232.registerServiceWorker();
    return;
  }
  // The classic release does not load the modular core yet; remove this fallback
  // when its bootstrap is replaced by the typed composition.
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("[PWA] No se pudo registrar el service worker:", error);
  });
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

function renderVentaProductos() {
  const cont = $("#venta-productos-lista");
  if (!cont) return;
  cont.innerHTML = window.VendifyProductsV232.renderSaleProductsHtml({
    store: productsStoreV232,
    query: $("#venta-buscador")?.value || "",
    cart: posControllerV232.getCart(),
    formatCurrency: formatearPrecio,
  });
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
  updateContextLabels: () => contextPickerControllerV232.updateLabels(),
  persistOfflineContext: () => guardarContextoOfflineV231?.(),
  restoreOfflineState: () => restaurarPruebaCajaOfflineV2311?.() === true,
  persistOfflineState: () => guardarPruebaCajaOfflineV2311?.(),
  isOnline: () => navigator.onLine,
  onPanelClose: () => dashboardNavigationV236.complete("cash"),
});

const contextPickerControllerV232 =
  window.VendifyContextV232.createContextPickerController({
    getContext: () => ({
      branch: {
        id: appContext?.branch?.id || null,
        name: appContext?.branch?.nombre || "",
      },
      cashRegister: {
        id: appContext?.cashRegister?.id || null,
        name: appContext?.cashRegister?.nombre || "",
      },
    }),
    getBranches: () =>
      sucursalesV226.map((branch) => ({
        id: branch.id,
        name: branch.nombre,
      })),
    selectBranch: async (id) => {
      const selector = $("#branch-selector-v226");
      if (!selector) return;

      selector.value = id;
      await cambiarSucursalDesdeSelectorV226({
        target: selector,
      });
    },
    selectCash: async (id) => {
      const selector = $("#cash-selector-v227");
      if (!selector) return;

      selector.value = id;
      await cambiarCajaDesdeSelectorV227({
        target: selector,
      });
    },
    renderCashOptions: () => cashControllerV232.renderOptions(),
    closeUserMenu: () => abrirCerrarMenuUsuarioV224?.(false),
    closeManagementMenu: () => abrirCerrarGestionV230?.(false),
    positionPopover: posicionarPopoverAncladoV23012,
    icon: iconV23011,
  });

const connectionStatusControllerV232 =
  window.VendifyOfflineCompatV232.createConnectionStatusController({
    isOnline: () => navigator.onLine,
    getPendingOfflineSalesCount: () => leerVentasOfflineV2311().length,
    syncPendingOfflineSales: () =>
      sincronizarVentasOfflineV2311({
        mostrarResumen: true,
        incluirRevision: true,
      }),
    syncAll: (showToast) =>
      sincronizarTodoV23011({
        toast: showToast,
      }),
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
  getProducts: () => productsStoreV232.list(),
  updateProductStock: (productId, stock) => productsStoreV232.patchStock(productId, stock),
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
  setConnectionState: (state, label) => connectionStatusControllerV232.setState(state, label),
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
  contextPickerControllerV232.renderBranchOptions();
  contextPickerControllerV232.updateLabels();
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

  branchTransferControllerV232.setup();
  branchAdministrationControllerV232.setup();
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
  contextPickerControllerV232.setup();
  inventoryControllerV232.setup();
  setupGestionMenuV230();
  purchasesControllerV232.setup();
  inactivityGuardV232.start();
  setupStabilityV23011();
  diagnosticsControllerV232.setup();
  setupBackGuardV2311();
  setupCommercialFoundationV231();
  realtimeControllerV232.startWatchdog();
  window.VendifyPwaV232.setupInstallPrompt();
  onboardingControllerV232.setup();
  void authControllerV232.initialize();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  void init();
}
