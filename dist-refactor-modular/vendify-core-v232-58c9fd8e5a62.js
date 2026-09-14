(function() {
  "use strict";
  const EMPLOYEE_DOMAIN = "employees.vendify.internal";
  const AUTH_PANEL_ALIASES = Object.freeze({
    "auth-login-panel": "owner",
    "auth-register-panel": "register",
    "auth-reset-panel": "forgot",
    "auth-new-password-panel": "new-password"
  });
  function normalizeInternalLogin(value) {
    return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  }
  function buildEmployeeInternalEmail(businessCode, username) {
    const code = normalizeInternalLogin(businessCode);
    const user = normalizeInternalLogin(username);
    return `${code}.${user}@${EMPLOYEE_DOMAIN}`;
  }
  function resolveAuthPanel(panel) {
    return AUTH_PANEL_ALIASES[panel] ?? panel;
  }
  function validateRegistrationInput(businessName, password) {
    if (!(businessName ?? "").trim()) return "Ingresá el nombre del negocio.";
    if ((password ?? "").length < 8) return "La contraseña debe tener al menos 8 caracteres.";
    return null;
  }
  function validateNewPasswordInput(password, confirmation) {
    if ((password ?? "").length < 8) return "La contraseña debe tener al menos 8 caracteres.";
    if ((password ?? "") !== (confirmation ?? "")) return "Las contraseñas no coinciden.";
    return null;
  }
  const REGISTERED_EMAIL_MESSAGE = "Ya existe un negocio asociado a este email. Iniciá sesión o recuperá tu contraseña.";
  function errorMessage$d(error) {
    if (error == null ? void 0 : error.message) return error.message;
    return "Error de autenticación";
  }
  function isAlreadyRegisteredError(error) {
    return (error == null ? void 0 : error.code) === "user_already_exists" || /user already registered/i.test((error == null ? void 0 : error.message) ?? "");
  }
  async function signInOwner(auth, email, password) {
    const { error } = await auth.signInWithPassword({
      email: (email ?? "").trim(),
      password: password ?? ""
    });
    if (!error) return { ok: true, errorMessage: null };
    return {
      ok: false,
      errorMessage: error.message === "Invalid login credentials" ? "Email o contraseña incorrectos." : errorMessage$d(error)
    };
  }
  async function signInEmployee(auth, businessCode, username, password) {
    const { error } = await auth.signInWithPassword({
      email: buildEmployeeInternalEmail(businessCode, username),
      password: password ?? ""
    });
    return error ? { ok: false, errorMessage: "Código, usuario o contraseña incorrectos." } : { ok: true, errorMessage: null };
  }
  async function registerOwner(auth, input2) {
    var _a;
    const validationError = validateRegistrationInput(input2.businessName, input2.password);
    if (validationError) {
      return { ok: false, errorMessage: validationError, requiresConfirmation: false };
    }
    const businessName = (input2.businessName ?? "").trim();
    const { data, error } = await auth.signUp({
      email: (input2.email ?? "").trim(),
      password: input2.password ?? "",
      options: {
        emailRedirectTo: input2.redirectTo,
        data: { business_name: businessName }
      }
    });
    if (error) {
      return {
        ok: false,
        errorMessage: isAlreadyRegisteredError(error) ? REGISTERED_EMAIL_MESSAGE : errorMessage$d(error),
        requiresConfirmation: false
      };
    }
    if (Array.isArray((_a = data.user) == null ? void 0 : _a.identities) && data.user.identities.length === 0) {
      return {
        ok: false,
        errorMessage: REGISTERED_EMAIL_MESSAGE,
        requiresConfirmation: false
      };
    }
    return {
      ok: true,
      errorMessage: null,
      requiresConfirmation: !data.session
    };
  }
  async function requestPasswordReset(auth, email, redirectTo) {
    const { error } = await auth.resetPasswordForEmail((email ?? "").trim(), {
      redirectTo
    });
    return error ? { ok: false, errorMessage: errorMessage$d(error) } : { ok: true, errorMessage: null };
  }
  async function updatePassword(auth, password, confirmation) {
    const validationError = validateNewPasswordInput(password, confirmation);
    if (validationError) return { ok: false, errorMessage: validationError };
    const { error } = await auth.updateUser({ password: password ?? "" });
    return error ? { ok: false, errorMessage: errorMessage$d(error) } : { ok: true, errorMessage: null };
  }
  async function signOut(auth) {
    const { error } = await auth.signOut();
    return error ? { ok: false, errorMessage: errorMessage$d(error) } : { ok: true, errorMessage: null };
  }
  async function handleAuthStateChange(event, session, callbacks) {
    callbacks.setSession(session);
    if (event === "PASSWORD_RECOVERY") {
      callbacks.setRecoveryActive(true);
      callbacks.showLogin();
      callbacks.showNewPasswordPanel();
      return;
    }
    if (event === "INITIAL_SESSION") return;
    if (session && !callbacks.isRecoveryActive()) {
      await callbacks.showApp(session);
      return;
    }
    if (!session) await callbacks.handleSignedOut();
  }
  async function initializeAuthLifecycle(auth, callbacks) {
    const { data } = await auth.getSession();
    const initialSession = data.session;
    callbacks.setSession(initialSession);
    auth.onAuthStateChange(async (event, session) => {
      await handleAuthStateChange(event, session, callbacks);
    });
    if (initialSession && !callbacks.isRecoveryActive()) {
      await callbacks.showApp(initialSession);
    } else {
      callbacks.showLogin();
    }
  }
  function queryOne(selector, root = document) {
    return root.querySelector(selector);
  }
  function queryAll(selector, root = document) {
    return root.querySelectorAll(selector);
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  const AUTH_ERROR_SELECTORS = Object.freeze([
    "#login-error",
    "#employee-login-error",
    "#register-error",
    "#forgot-error",
    "#new-password-error"
  ]);
  function getAuthPanelState(panel) {
    const target = resolveAuthPanel(panel);
    return Object.freeze({
      target,
      owner: target === "owner",
      employee: target === "employee",
      register: target === "register",
      forgot: target === "forgot",
      newPassword: target === "new-password",
      tabsVisible: target === "owner" || target === "employee"
    });
  }
  function showAuthPanel(panel, root = document) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const state = getAuthPanelState(panel);
    (_a = queryOne("#auth-owner-panel", root)) == null ? void 0 : _a.classList.toggle("hidden", !state.owner);
    (_b = queryOne("#auth-employee-panel", root)) == null ? void 0 : _b.classList.toggle("hidden", !state.employee);
    (_c = queryOne("#register-form", root)) == null ? void 0 : _c.classList.toggle("hidden", !state.register);
    (_d = queryOne("#forgot-form", root)) == null ? void 0 : _d.classList.toggle("hidden", !state.forgot);
    (_e = queryOne("#new-password-form", root)) == null ? void 0 : _e.classList.toggle("hidden", !state.newPassword);
    (_f = queryOne("#tab-owner", root)) == null ? void 0 : _f.classList.toggle("active", state.owner);
    (_g = queryOne("#tab-employee", root)) == null ? void 0 : _g.classList.toggle("active", state.employee);
    (_h = queryOne("#auth-tabs-wrap", root)) == null ? void 0 : _h.classList.toggle("hidden", !state.tabsVisible);
    (_i = queryOne("#auth-message", root)) == null ? void 0 : _i.classList.add("hidden");
    for (const selector of AUTH_ERROR_SELECTORS) {
      const element2 = queryOne(selector, root);
      if (element2) element2.textContent = "";
    }
  }
  function showAuthMessage(message2, type = "info", root = document) {
    const element2 = queryOne("#auth-message", root);
    if (!element2) return;
    element2.setAttribute("class", `auth-message ${type}`);
    element2.textContent = message2;
    element2.classList.remove("hidden");
  }
  function input(selector) {
    const element2 = queryOne(selector);
    return element2 instanceof HTMLInputElement ? element2 : null;
  }
  function button$1(selector) {
    const element2 = queryOne(selector);
    return element2 instanceof HTMLButtonElement ? element2 : null;
  }
  function setButtonState(element2, disabled, text2) {
    element2.disabled = disabled;
    element2.textContent = text2;
  }
  function createAuthController(dependencies) {
    let session = null;
    let recoveryActive = false;
    let setupComplete = false;
    function getSession() {
      return session;
    }
    function showLogin() {
      var _a, _b;
      (_a = queryOne("#auth-screen")) == null ? void 0 : _a.classList.remove("hidden");
      (_b = queryOne(".app")) == null ? void 0 : _b.classList.add("hidden");
      if (!recoveryActive) showAuthPanel("owner");
    }
    async function initialize() {
      await initializeAuthLifecycle(dependencies.auth, {
        setSession(nextSession) {
          session = nextSession;
        },
        isRecoveryActive() {
          return recoveryActive;
        },
        setRecoveryActive(active) {
          recoveryActive = active;
        },
        showLogin,
        showNewPasswordPanel() {
          showAuthPanel("auth-new-password-panel");
        },
        showApp(nextSession) {
          return dependencies.showApp(nextSession);
        },
        async handleSignedOut() {
          await dependencies.handleSignedOut();
          showLogin();
        }
      });
    }
    async function ownerSignIn(event) {
      var _a, _b;
      event.preventDefault();
      const submit = button$1("#btn-login");
      const error = queryOne("#login-error");
      if (!submit || !error) return;
      error.textContent = "";
      setButtonState(submit, true, "Ingresando...");
      const result = await signInOwner(
        dependencies.auth,
        (_a = input("#login-email")) == null ? void 0 : _a.value.trim(),
        ((_b = input("#login-password")) == null ? void 0 : _b.value) ?? ""
      );
      setButtonState(submit, false, "Iniciar sesión");
      if (!result.ok) error.textContent = result.errorMessage ?? "";
    }
    async function employeeSignIn(event) {
      var _a, _b, _c;
      event.preventDefault();
      const submit = button$1("#btn-employee-login");
      const error = queryOne("#employee-login-error");
      if (!submit || !error) return;
      error.textContent = "";
      setButtonState(submit, true, "Ingresando...");
      const result = await signInEmployee(
        dependencies.auth,
        ((_a = input("#employee-business-code")) == null ? void 0 : _a.value.trim()) ?? "",
        ((_b = input("#employee-username")) == null ? void 0 : _b.value.trim()) ?? "",
        ((_c = input("#employee-password")) == null ? void 0 : _c.value) ?? ""
      );
      setButtonState(submit, false, "Entrar a Vendify");
      if (!result.ok) error.textContent = result.errorMessage ?? "";
    }
    async function register(event) {
      var _a, _b, _c;
      event.preventDefault();
      const submit = button$1("#btn-register");
      const error = queryOne("#register-error");
      if (!submit || !error) return;
      error.textContent = "";
      setButtonState(submit, true, "Creando cuenta...");
      const result = await registerOwner(dependencies.auth, {
        businessName: (_a = input("#register-business")) == null ? void 0 : _a.value.trim(),
        email: (_b = input("#register-email")) == null ? void 0 : _b.value.trim(),
        password: ((_c = input("#register-password")) == null ? void 0 : _c.value) ?? "",
        redirectTo: window.location.origin + window.location.pathname
      });
      setButtonState(submit, false, "Crear cuenta");
      if (!result.ok) {
        error.textContent = result.errorMessage ?? "";
        return;
      }
      if (result.requiresConfirmation) {
        showAuthPanel("owner");
        showAuthMessage(
          "Cuenta creada. Revisá tu email una sola vez para confirmarla y después ingresá con tu contraseña.",
          "success"
        );
      }
    }
    async function requestReset(event) {
      var _a;
      event.preventDefault();
      const submit = button$1("#btn-forgot-send");
      const error = queryOne("#forgot-error");
      if (!submit || !error) return;
      error.textContent = "";
      setButtonState(submit, true, "Enviando...");
      const result = await requestPasswordReset(
        dependencies.auth,
        (_a = input("#forgot-email")) == null ? void 0 : _a.value.trim(),
        window.location.origin + window.location.pathname
      );
      setButtonState(submit, false, "Enviar recuperación");
      if (!result.ok) {
        error.textContent = result.errorMessage ?? "";
        return;
      }
      showAuthPanel("owner");
      showAuthMessage("Te enviamos un enlace para cambiar tu contraseña.", "success");
    }
    async function saveNewPassword(event) {
      var _a, _b;
      event.preventDefault();
      const submit = button$1("#btn-new-password");
      const error = queryOne("#new-password-error");
      if (!submit || !error) return;
      error.textContent = "";
      setButtonState(submit, true, "Guardando...");
      const result = await updatePassword(
        dependencies.auth,
        ((_a = input("#new-password")) == null ? void 0 : _a.value) ?? "",
        ((_b = input("#new-password-confirm")) == null ? void 0 : _b.value) ?? ""
      );
      setButtonState(submit, false, "Guardar contraseña");
      if (!result.ok) {
        error.textContent = result.errorMessage ?? "";
        return;
      }
      recoveryActive = false;
      dependencies.showToast("Contraseña actualizada", "success");
      if (session) await dependencies.showApp(session);
    }
    function togglePassword(element2) {
      if (!(element2 instanceof HTMLButtonElement)) return;
      const target = element2.dataset.togglePassword;
      const password = target ? input(`#${target}`) : null;
      if (!password) return;
      const reveal = password.type === "password";
      password.type = reveal ? "text" : "password";
      element2.innerHTML = dependencies.icon(reveal ? "eye-off" : "eye");
      const label = reveal ? "Ocultar contraseña" : "Mostrar contraseña";
      element2.setAttribute("aria-label", label);
      element2.title = label;
    }
    async function performSignOut() {
      recoveryActive = false;
      dependencies.beforeSignOut();
      await signOut(dependencies.auth);
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#login-form")) == null ? void 0 : _a.addEventListener("submit", (event) => {
        void ownerSignIn(event);
      });
      (_b = queryOne("#employee-login-form")) == null ? void 0 : _b.addEventListener("submit", (event) => {
        void employeeSignIn(event);
      });
      (_c = queryOne("#register-form")) == null ? void 0 : _c.addEventListener("submit", (event) => {
        void register(event);
      });
      (_d = queryOne("#forgot-form")) == null ? void 0 : _d.addEventListener("submit", (event) => {
        void requestReset(event);
      });
      (_e = queryOne("#new-password-form")) == null ? void 0 : _e.addEventListener("submit", (event) => {
        void saveNewPassword(event);
      });
      (_f = queryOne("#tab-owner")) == null ? void 0 : _f.addEventListener("click", () => {
        showAuthPanel("owner");
      });
      (_g = queryOne("#tab-employee")) == null ? void 0 : _g.addEventListener("click", () => {
        showAuthPanel("employee");
      });
      (_h = queryOne("#btn-show-register")) == null ? void 0 : _h.addEventListener("click", () => {
        showAuthPanel("register");
      });
      (_i = queryOne("#btn-back-login")) == null ? void 0 : _i.addEventListener("click", () => {
        showAuthPanel("owner");
      });
      (_j = queryOne("#btn-forgot")) == null ? void 0 : _j.addEventListener("click", () => {
        var _a2;
        const email = (_a2 = input("#login-email")) == null ? void 0 : _a2.value.trim();
        const resetEmail = input("#forgot-email");
        if (resetEmail && email) resetEmail.value = email;
        showAuthPanel("forgot");
      });
      (_k = queryOne("#btn-forgot-back")) == null ? void 0 : _k.addEventListener("click", () => {
        showAuthPanel("owner");
      });
      queryAll("[data-toggle-password]").forEach((element2) => {
        element2.addEventListener("click", () => {
          togglePassword(element2);
        });
      });
      (_l = queryOne("#btn-cerrar-sesion")) == null ? void 0 : _l.addEventListener("click", () => {
        void performSignOut();
      });
    }
    return Object.freeze({
      setup,
      initialize,
      getSession,
      signOut: performSignOut
    });
  }
  window.VendifyAuthV232 = Object.freeze({
    createController: createAuthController,
    normalizeInternalLogin,
    buildEmployeeInternalEmail,
    resolveAuthPanel,
    validateRegistrationInput,
    validateNewPasswordInput,
    getAuthPanelState,
    showAuthPanel,
    showAuthMessage,
    signInOwner,
    signInEmployee,
    registerOwner,
    requestPasswordReset,
    updatePassword,
    signOut,
    initializeAuthLifecycle
  });
  function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }
  function asRecords(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const branch = asRecord(item);
      return Object.keys(branch).length ? [branch] : [];
    });
  }
  function fail$6(error, fallback) {
    if (error) throw new Error(error.message ?? fallback);
  }
  async function listAdminBranches(client) {
    const { data, error } = await client.rpc("listar_sucursales_admin_v1");
    fail$6(error, "No se pudieron cargar las sucursales");
    return asRecords(data);
  }
  async function createBranch(client, input2) {
    const { data, error } = await client.rpc("crear_sucursal_v1", {
      p_nombre: input2.name,
      p_direccion: input2.address,
      p_telefono: input2.phone
    });
    fail$6(error, "No se pudo crear la sucursal");
    return asRecord(data);
  }
  async function updateBranch(client, branchId, input2) {
    const { data, error } = await client.rpc("actualizar_sucursal_v1", {
      p_sucursal_id: branchId,
      p_nombre: input2.name,
      p_direccion: input2.address,
      p_telefono: input2.phone,
      p_activa: input2.active
    });
    fail$6(error, "No se pudo actualizar la sucursal");
    return asRecord(data);
  }
  window.VendifyBranchesV232 = Object.freeze({
    listAdmin: listAdminBranches,
    create: createBranch,
    update: updateBranch
  });
  function record$9(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }
  function records$8(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const parsed = record$9(item);
      return Object.keys(parsed).length ? [parsed] : [];
    });
  }
  function fail$5(error, fallback) {
    if (error) throw new Error(error.message ?? fallback);
  }
  async function listCashRegisters(client, branchId) {
    const { data, error } = await client.rpc("listar_cajas_sucursal_v1", {
      p_sucursal_id: branchId
    });
    fail$5(error, "No se pudieron cargar las cajas");
    return records$8(data);
  }
  async function getCashState(client, cashRegisterId) {
    const { data, error } = await client.rpc("obtener_estado_caja_v1", {
      p_caja_id: cashRegisterId
    });
    fail$5(error, "No se pudo cargar el estado de caja");
    return record$9(data);
  }
  async function openCashRegister(client, cashRegisterId, openingFund, note) {
    const { data, error } = await client.rpc("abrir_caja_v1", {
      p_caja_id: cashRegisterId,
      p_fondo_inicial: openingFund,
      p_nota: note
    });
    fail$5(error, "No se pudo abrir la caja");
    return record$9(data);
  }
  async function registerCashMovement(client, cashRegisterId, type, amount, reason) {
    const { data, error } = await client.rpc("registrar_movimiento_caja_v1", {
      p_caja_id: cashRegisterId,
      p_tipo: type,
      p_monto: amount,
      p_motivo: reason
    });
    fail$5(error, "No se pudo registrar el movimiento");
    return record$9(data);
  }
  async function listOpenCashMovements(client, cashRegisterId) {
    const { data, error } = await client.rpc("listar_movimientos_caja_abierta_v1", {
      p_caja_id: cashRegisterId
    });
    fail$5(error, "No se pudieron cargar los movimientos");
    return records$8(data);
  }
  async function closeCashRegister(client, cashRegisterId, declaredCash, note) {
    const { data, error } = await client.rpc("cerrar_caja_v1", {
      p_caja_id: cashRegisterId,
      p_efectivo_declarado: declaredCash,
      p_nota: note
    });
    fail$5(error, "No se pudo cerrar la caja");
    return record$9(data);
  }
  async function listCashHistory(client, branchId, limit = 12) {
    const { data, error } = await client.rpc("listar_historial_cajas_v1", {
      p_sucursal_id: branchId,
      p_limit: limit
    });
    fail$5(error, "No se pudo cargar el historial");
    return records$8(data);
  }
  async function createCashRegister(client, branchId, name) {
    const { data, error } = await client.rpc("crear_caja_v1", {
      p_sucursal_id: branchId,
      p_nombre: name
    });
    fail$5(error, "No se pudo crear la caja");
    return record$9(data);
  }
  async function setCashRegisterActive(client, cashRegisterId, active) {
    const { data, error } = await client.rpc("cambiar_estado_caja_v1", {
      p_caja_id: cashRegisterId,
      p_activa: active
    });
    fail$5(error, "No se pudo cambiar el estado de la caja");
    return record$9(data);
  }
  function field$8(selector) {
    const element2 = queryOne(selector);
    return element2 instanceof HTMLInputElement || element2 instanceof HTMLSelectElement || element2 instanceof HTMLTextAreaElement ? element2 : null;
  }
  function text$8(value, fallback = "") {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
  }
  function number$8(value) {
    return Number(value ?? 0);
  }
  function nullableTrimmed(value) {
    const trimmed = (value == null ? void 0 : value.trim()) ?? "";
    return trimmed.length ? trimmed : null;
  }
  function nestedRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  }
  function formatDateTime(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(text$8(value)));
    } catch {
      return text$8(value);
    }
  }
  function errorMessage$c(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  function createCashController(dependencies) {
    let registers = [];
    let state = null;
    let movementType = null;
    let operationInProgress = false;
    let setupComplete = false;
    function context() {
      return dependencies.getContext();
    }
    function session() {
      return nestedRecord(state == null ? void 0 : state.sesion);
    }
    function isOpenByCurrentUser() {
      return Boolean(session() && (state == null ? void 0 : state.es_mia));
    }
    function setState(nextState) {
      state = nextState;
      renderHeader();
    }
    function renderOptions() {
      const selector = queryOne("#cash-selector-v227");
      if (selector instanceof HTMLSelectElement) {
        selector.innerHTML = registers.length ? registers.map(
          (register) => `<option value="${escapeHtml(text$8(register.id))}">${escapeHtml(text$8(register.nombre))}</option>`
        ).join("") : '<option value="">Sin cajas</option>';
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
        const id = text$8(register.id);
        const active = id === context().cashRegister.id;
        return `
        <button type="button"
                class="context-picker-option-v23013 ${active ? "active" : ""}"
                role="option"
                aria-selected="${active ? "true" : "false"}"
                data-context-cash="${escapeHtml(id)}">
          <span class="context-option-icon-v23013">${dependencies.icon("register")}</span>
          <span class="context-option-copy-v23013">
            <strong>${escapeHtml(text$8(register.nombre))}</strong>
            <small>${active ? "Caja actual" : "Cambiar a esta caja"}</small>
          </span>
          <span class="context-option-check-v23013">${active ? dependencies.icon("check") : ""}</span>
        </button>`;
      }).join("");
      dependencies.updateContextLabels();
    }
    function renderHeader() {
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
      } else if (state == null ? void 0 : state.es_mia) {
        dot.classList.add("open");
        label.textContent = "Caja abierta";
      } else {
        dot.classList.add("busy");
        label.textContent = "Caja ocupada";
      }
    }
    async function loadState() {
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
    async function loadRegisters(options = {}) {
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
      const storageKey = businessId ? `vendify_cash_${businessId}_${branchId}` : null;
      const saved = options.keep !== false && storageKey ? localStorage.getItem(storageKey) : null;
      const current = context().cashRegister.id;
      const chosen = registers.find((register) => register.id === saved) ?? registers.find((register) => register.id === current) ?? registers[0] ?? null;
      dependencies.setCashRegister(chosen ? { id: text$8(chosen.id), nombre: text$8(chosen.nombre) } : null);
      if (storageKey && chosen) localStorage.setItem(storageKey, text$8(chosen.id));
      renderOptions();
      await loadState();
    }
    async function selectRegister(id) {
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
      dependencies.setCashRegister({ id: text$8(selected.id), nombre: text$8(selected.nombre) });
      const current = context();
      if (current.businessId && current.branch.id) {
        localStorage.setItem(`vendify_cash_${current.businessId}_${current.branch.id}`, id);
      }
      renderOptions();
      dependencies.persistOfflineContext();
      await loadState();
    }
    async function renderMovements() {
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
          const type = text$8(movement.tipo);
          return `<div class="cash-movement-row-v227 ${escapeHtml(type)}"><div><strong>${type === "ingreso" ? "Ingreso" : "Retiro"}</strong><small>${escapeHtml(text$8(movement.motivo))} · ${escapeHtml(formatDateTime(movement.creado))}</small></div><strong>${type === "ingreso" ? "+" : "−"}${dependencies.formatCurrency(number$8(movement.monto))}</strong></div>`;
        }).join("");
      } catch {
        container.innerHTML = '<p class="hint">No se pudieron cargar los movimientos.</p>';
      }
    }
    function openMovement(type) {
      var _a;
      movementType = type;
      const typeField = field$8("#cash-movement-type-v227");
      const title = queryOne("#cash-movement-title-v227");
      if (typeField) typeField.value = type;
      if (title) title.textContent = type === "ingreso" ? "Registrar ingreso" : "Registrar retiro";
      const amount = field$8("#cash-movement-amount-v227");
      const reason = field$8("#cash-movement-reason-v227");
      const error = queryOne("#cash-movement-error-v227");
      if (amount) amount.value = "";
      if (reason) reason.value = "";
      if (error) error.textContent = "";
      (_a = queryOne("#modal-caja-movimiento-v227")) == null ? void 0 : _a.classList.remove("hidden");
    }
    function closeMovement() {
      var _a;
      (_a = queryOne("#modal-caja-movimiento-v227")) == null ? void 0 : _a.classList.add("hidden");
    }
    async function saveMovement(event) {
      var _a, _b, _c;
      event.preventDefault();
      const cashRegisterId = context().cashRegister.id;
      if (operationInProgress || !cashRegisterId) return;
      operationInProgress = true;
      const errorElement = queryOne("#cash-movement-error-v227");
      if (errorElement) errorElement.textContent = "";
      const button2 = event.submitter instanceof HTMLButtonElement ? event.submitter : null;
      if (button2) {
        button2.disabled = true;
        button2.textContent = "Registrando...";
      }
      try {
        state = await registerCashMovement(
          dependencies.client,
          cashRegisterId,
          ((_a = field$8("#cash-movement-type-v227")) == null ? void 0 : _a.value) ?? "",
          number$8((_b = field$8("#cash-movement-amount-v227")) == null ? void 0 : _b.value),
          ((_c = field$8("#cash-movement-reason-v227")) == null ? void 0 : _c.value.trim()) ?? ""
        );
        closeMovement();
        renderHeader();
        await renderPanel();
        dependencies.showToast(
          movementType === "ingreso" ? "Ingreso registrado" : "Retiro registrado",
          "success"
        );
      } catch (error) {
        if (errorElement) errorElement.textContent = errorMessage$c(error, "No se pudo registrar");
      } finally {
        operationInProgress = false;
        if (button2) {
          button2.disabled = false;
          button2.textContent = "Registrar";
        }
      }
    }
    async function openRegister(event) {
      var _a, _b;
      event.preventDefault();
      const cashRegisterId = context().cashRegister.id;
      if (operationInProgress || !cashRegisterId) return;
      operationInProgress = true;
      const errorElement = queryOne("#cash-opening-error-v227");
      if (errorElement) errorElement.textContent = "";
      const button2 = event.submitter instanceof HTMLButtonElement ? event.submitter : null;
      if (button2) {
        button2.disabled = true;
        button2.textContent = "Abriendo...";
      }
      try {
        state = await openCashRegister(
          dependencies.client,
          cashRegisterId,
          number$8((_a = field$8("#cash-opening-fund-v227")) == null ? void 0 : _a.value),
          nullableTrimmed((_b = field$8("#cash-opening-note-v227")) == null ? void 0 : _b.value)
        );
        renderHeader();
        await renderPanel();
        await renderHistory();
        dependencies.showToast("Caja abierta", "success");
      } catch (error) {
        if (errorElement) errorElement.textContent = errorMessage$c(error, "No se pudo abrir la caja");
      } finally {
        operationInProgress = false;
        if (button2) {
          button2.disabled = false;
          button2.textContent = "Abrir caja";
        }
      }
    }
    function updateClosePreview() {
      var _a, _b;
      const expected = number$8((_a = session()) == null ? void 0 : _a.efectivo_esperado);
      const declared = number$8((_b = field$8("#cash-close-declared-v227")) == null ? void 0 : _b.value);
      const difference = declared - expected;
      const element2 = queryOne("#cash-difference-preview-v227");
      if (!element2) return;
      element2.classList.remove("positive", "negative", "neutral");
      element2.classList.add(Math.abs(difference) < 5e-3 ? "neutral" : difference > 0 ? "positive" : "negative");
      element2.textContent = `Diferencia: ${difference > 0 ? "+" : ""}${dependencies.formatCurrency(difference)}`;
    }
    function openCloseDialog() {
      var _a;
      const currentSession = session();
      if (!currentSession) return;
      const expected = number$8(currentSession.efectivo_esperado);
      const expectedElement = queryOne("#cash-close-expected-v227");
      const declared = field$8("#cash-close-declared-v227");
      const note = field$8("#cash-close-note-v227");
      const error = queryOne("#cash-close-error-v227");
      if (expectedElement) expectedElement.textContent = dependencies.formatCurrency(expected);
      if (declared) declared.value = expected.toFixed(2);
      if (note) note.value = "";
      if (error) error.textContent = "";
      updateClosePreview();
      (_a = queryOne("#modal-cash-close-v227")) == null ? void 0 : _a.classList.remove("hidden");
    }
    function closeCloseDialog() {
      var _a;
      (_a = queryOne("#modal-cash-close-v227")) == null ? void 0 : _a.classList.add("hidden");
    }
    async function closeRegister(event) {
      var _a, _b;
      event.preventDefault();
      const cashRegisterId = context().cashRegister.id;
      if (operationInProgress || !cashRegisterId) return;
      operationInProgress = true;
      const errorElement = queryOne("#cash-close-error-v227");
      if (errorElement) errorElement.textContent = "";
      const button2 = event.submitter instanceof HTMLButtonElement ? event.submitter : null;
      if (button2) {
        button2.disabled = true;
        button2.textContent = "Cerrando...";
      }
      try {
        const result = await closeCashRegister(
          dependencies.client,
          cashRegisterId,
          number$8((_a = field$8("#cash-close-declared-v227")) == null ? void 0 : _a.value),
          nullableTrimmed((_b = field$8("#cash-close-note-v227")) == null ? void 0 : _b.value)
        );
        const closedSession = nestedRecord(result.sesion);
        closeCloseDialog();
        await loadState();
        await renderPanel();
        await renderHistory();
        const difference = number$8(closedSession == null ? void 0 : closedSession.diferencia);
        dependencies.showToast(
          Math.abs(difference) < 5e-3 ? "Caja cerrada sin diferencias" : `Caja cerrada · diferencia ${difference > 0 ? "+" : ""}${dependencies.formatCurrency(difference)}`,
          Math.abs(difference) < 5e-3 ? "success" : "info"
        );
      } catch (error) {
        if (errorElement) errorElement.textContent = errorMessage$c(error, "No se pudo cerrar la caja");
      } finally {
        operationInProgress = false;
        if (button2) {
          button2.disabled = false;
          button2.textContent = "Cerrar caja";
        }
      }
    }
    async function renderHistory() {
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
          const difference = number$8(item.diferencia);
          return `<div class="cash-history-row-v227"><div class="cash-history-main-v227"><strong>${escapeHtml(text$8(item.caja_nombre))} · ${escapeHtml(text$8(item.usuario_nombre))}</strong><small>${escapeHtml(formatDateTime(item.cerrada_en))} · ${String(number$8(item.tickets))} tickets</small></div><div class="cash-history-sales-v227"><span>Ventas</span><strong>${dependencies.formatCurrency(number$8(item.ventas_total))}</strong></div><div class="cash-history-diff-v227 ${Math.abs(difference) < 5e-3 ? "zero" : difference > 0 ? "positive" : "negative"}"><span>Diferencia</span><strong>${difference > 0 ? "+" : ""}${dependencies.formatCurrency(difference)}</strong></div></div>`;
        }).join("");
      } catch {
        container.innerHTML = '<p class="hint">No se pudo cargar el historial.</p>';
      }
    }
    async function renderPanel() {
      var _a, _b, _c;
      const container = queryOne("#cash-current-v227");
      if (!container) return;
      const current = context();
      if (!current.cashRegister.id) {
        container.innerHTML = '<div class="cash-empty-v227">No hay una caja activa.</div>';
        return;
      }
      const currentSession = session();
      if (!currentSession) {
        container.innerHTML = `<section class="cash-status-card-v227 closed"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 closed"></span><div><strong>Caja cerrada</strong><small>${escapeHtml(current.cashRegister.name)}</small></div></div><form id="form-open-cash-v227" class="cash-open-form-v227"><div class="form-group"><label for="cash-opening-fund-v227">Fondo inicial</label><input type="number" id="cash-opening-fund-v227" value="0" min="0" step="0.01" required/><small class="hint">Efectivo físico antes de empezar.</small></div><div class="form-group"><label for="cash-opening-note-v227">Nota</label><input id="cash-opening-note-v227" maxlength="200" placeholder="Opcional"/></div><span class="field-error" id="cash-opening-error-v227"></span><button type="submit" class="btn btn-primary btn-lg">Abrir caja</button></form></section>`;
        (_a = queryOne("#form-open-cash-v227")) == null ? void 0 : _a.addEventListener("submit", (event) => {
          void openRegister(event);
        });
        return;
      }
      if (!(state == null ? void 0 : state.es_mia)) {
        container.innerHTML = `<section class="cash-status-card-v227 busy"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 busy"></span><div><strong>Caja en uso</strong><small>Abierta por ${escapeHtml(text$8(currentSession.usuario_nombre, "otro usuario"))}</small></div></div><p class="cash-busy-copy-v227">Seleccioná otra caja o esperá el cierre del turno.</p>${(state == null ? void 0 : state.puede_supervisar) ? '<button type="button" class="btn btn-secondary" id="btn-supervisor-close-v227">Cerrar como supervisor</button>' : ""}</section>`;
        (_b = queryOne("#btn-supervisor-close-v227")) == null ? void 0 : _b.addEventListener("click", openCloseDialog);
        return;
      }
      container.innerHTML = `<section class="cash-status-card-v227 open"><div class="cash-open-head-v227"><div class="cash-status-title-v227"><span class="cash-big-dot-v227 open"></span><div><strong>Turno abierto</strong><small>Desde ${escapeHtml(formatDateTime(currentSession.abierta_en))}</small></div></div><button type="button" class="btn btn-danger btn-sm" id="btn-open-cash-close-v227">Cerrar caja</button></div><div class="cash-summary-grid-v227"><div class="cash-summary-item-v227"><span>Ventas</span><strong>${dependencies.formatCurrency(number$8(currentSession.ventas_total))}</strong><small>${String(number$8(currentSession.tickets))} tickets</small></div><div class="cash-summary-item-v227"><span>Efectivo vendido</span><strong>${dependencies.formatCurrency(number$8(currentSession.ventas_efectivo))}</strong><small>Ventas en efectivo</small></div><div class="cash-summary-item-v227"><span>Ingresos</span><strong class="positive">${dependencies.formatCurrency(number$8(currentSession.ingresos_total))}</strong><small>Movimientos manuales</small></div><div class="cash-summary-item-v227"><span>Retiros</span><strong class="negative">${dependencies.formatCurrency(number$8(currentSession.retiros_total))}</strong><small>Salidas manuales</small></div><div class="cash-summary-item-v227 featured"><span>Efectivo esperado</span><strong>${dependencies.formatCurrency(number$8(currentSession.efectivo_esperado))}</strong><small>Incluye fondo inicial</small></div></div><div class="cash-actions-v227"><button type="button" class="btn btn-secondary" data-cash-movement="ingreso">＋ Ingreso</button><button type="button" class="btn btn-secondary" data-cash-movement="retiro">− Retiro</button></div><div class="cash-movements-section-v227"><div class="cash-section-head-v227"><div><h3>Movimientos</h3><p>Ingresos y retiros del turno.</p></div></div><div id="cash-movements-v227" class="cash-movements-v227"></div></div></section>`;
      (_c = queryOne("#btn-open-cash-close-v227")) == null ? void 0 : _c.addEventListener("click", openCloseDialog);
      queryAll("[data-cash-movement]", container).forEach((button2) => {
        button2.addEventListener("click", () => {
          openMovement(button2.getAttribute("data-cash-movement") ?? "");
        });
      });
      await renderMovements();
    }
    async function openPanel() {
      var _a;
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
      (_a = queryOne("#modal-caja-operativa-v227")) == null ? void 0 : _a.classList.remove("hidden");
    }
    function closePanel() {
      var _a;
      (_a = queryOne("#modal-caja-operativa-v227")) == null ? void 0 : _a.classList.add("hidden");
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#cash-selector-v227")) == null ? void 0 : _a.addEventListener("change", (event) => {
        const target = event.target;
        if (target instanceof HTMLSelectElement) void selectRegister(target.value);
      });
      (_b = queryOne("#btn-caja-v227")) == null ? void 0 : _b.addEventListener("click", () => void openPanel());
      (_c = queryOne("#btn-cerrar-caja-panel-v227")) == null ? void 0 : _c.addEventListener("click", closePanel);
      (_d = queryOne("#modal-caja-operativa-v227 .modal-backdrop")) == null ? void 0 : _d.addEventListener("click", closePanel);
      (_e = queryOne("#form-cash-movement-v227")) == null ? void 0 : _e.addEventListener("submit", (event) => void saveMovement(event));
      (_f = queryOne("#btn-close-cash-movement-v227")) == null ? void 0 : _f.addEventListener("click", closeMovement);
      (_g = queryOne("#btn-cancel-cash-movement-v227")) == null ? void 0 : _g.addEventListener("click", closeMovement);
      (_h = queryOne("#modal-caja-movimiento-v227 .modal-backdrop")) == null ? void 0 : _h.addEventListener("click", closeMovement);
      (_i = queryOne("#form-cash-close-v227")) == null ? void 0 : _i.addEventListener("submit", (event) => void closeRegister(event));
      (_j = queryOne("#btn-close-cash-close-v227")) == null ? void 0 : _j.addEventListener("click", closeCloseDialog);
      (_k = queryOne("#btn-cancel-cash-close-v227")) == null ? void 0 : _k.addEventListener("click", closeCloseDialog);
      (_l = queryOne("#modal-cash-close-v227 .modal-backdrop")) == null ? void 0 : _l.addEventListener("click", closeCloseDialog);
      (_m = queryOne("#cash-close-declared-v227")) == null ? void 0 : _m.addEventListener("input", updateClosePreview);
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
  window.VendifyCashV232 = Object.freeze({
    createController: createCashController,
    listRegisters: listCashRegisters,
    getState: getCashState,
    open: openCashRegister,
    registerMovement: registerCashMovement,
    listOpenMovements: listOpenCashMovements,
    close: closeCashRegister,
    listHistory: listCashHistory,
    createRegister: createCashRegister,
    setRegisterActive: setCashRegisterActive
  });
  function record$8(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }
  function fail$4(error, fallback) {
    if (error) throw new Error(error.message ?? fallback);
  }
  async function callRecord(client, name, args, fallback) {
    const { data, error } = await client.rpc(name, args);
    fail$4(error, fallback);
    return record$8(data);
  }
  function getCommercialOnboarding(client) {
    return callRecord(client, "estado_onboarding_comercial_v1", void 0, "No se pudo cargar el onboarding");
  }
  function getCurrentPlan(client) {
    return callRecord(client, "obtener_plan_actual_v1", void 0, "No se pudo cargar el plan");
  }
  function getOperationalConfig(client) {
    return callRecord(client, "obtener_config_operativa_v1", void 0, "No se pudo cargar la configuración");
  }
  async function saveOperationalConfig(client, input2) {
    const result = await callRecord(client, "guardar_config_operativa_v1", {
      p_stock_cobertura_alerta: input2.stockCoverageAlert,
      p_ajuste_grande_unidades: input2.largeAdjustmentUnits,
      p_diferencia_caja_alerta: input2.cashDifferenceAlert,
      p_resumen_diario: input2.dailySummary,
      p_auto_imprimir_ticket: input2.autoPrintTicket,
      p_ancho_ticket_mm: input2.ticketWidthMm
    }, "No se pudo guardar la configuración");
    if (result.ok === false) {
      const message2 = typeof result.message === "string" ? result.message : "No se pudo guardar";
      throw new Error(message2);
    }
    return result;
  }
  function exportOperationalBackup(client) {
    return callRecord(client, "exportar_respaldo_operativo_v1", void 0, "No se pudo generar el respaldo");
  }
  window.VendifyCommercialV232 = Object.freeze({
    getOnboarding: getCommercialOnboarding,
    getPlan: getCurrentPlan,
    getOperationalConfig,
    saveOperationalConfig,
    exportBackup: exportOperationalBackup
  });
  function record$7(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }
  function records$7(value) {
    return Array.isArray(value) ? value.map(record$7) : [];
  }
  async function call(client, name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.message ?? "No se pudo cargar el contexto");
    return data;
  }
  async function getAppContext(client) {
    return record$7(await call(client, "obtener_contexto_app"));
  }
  async function getCustomPermissions(client) {
    return record$7(await call(client, "obtener_permisos_personalizados_v1"));
  }
  async function getCurrentEmployeeProfile(client) {
    return record$7(await call(client, "obtener_perfil_empleado_actual"));
  }
  async function listAppBranches(client) {
    return records$7(await call(client, "listar_sucursales_app"));
  }
  async function getBranchContext(client, branchId) {
    return record$7(await call(client, "obtener_contexto_sucursal", { p_sucursal_id: branchId }));
  }
  async function runIntegrityDiagnostic(client) {
    return record$7(await call(client, "diagnostico_integridad_v1"));
  }
  window.VendifyContextV232 = Object.freeze({ getApp: getAppContext, getPermissions: getCustomPermissions, getEmployee: getCurrentEmployeeProfile, listBranches: listAppBranches, getBranch: getBranchContext, runDiagnostic: runIntegrityDiagnostic });
  function errorMessage$b(error, fallback) {
    return (error == null ? void 0 : error.message) ?? fallback;
  }
  async function loadDashboard(authenticatedClient, branchId, days) {
    const { data, error } = await authenticatedClient.rpc("dashboard_propietario_v1", {
      p_sucursal_id: branchId,
      p_dias: days
    });
    if (error) {
      throw new Error(errorMessage$b(error, "No se pudo cargar el Dashboard"));
    }
    return data;
  }
  async function loadOperationalAlerts(authenticatedClient, branchId) {
    const { data, error } = await authenticatedClient.rpc("alertas_operativas_v1", {
      p_sucursal_id: branchId
    });
    if (error) {
      throw new Error(errorMessage$b(error, "No se pudieron cargar las alertas operativas"));
    }
    return data;
  }
  const ARS_FORMATTER = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  function normalizeComparableText(value) {
    return String(value ?? "").toLowerCase().replace(/\s+/g, " ").replace(",", ".").trim();
  }
  function formatArs(value) {
    const normalized = value ? Number(value) : 0;
    return ARS_FORMATTER.format(normalized);
  }
  function productDisplayName(product) {
    const name = String((product == null ? void 0 : product.nombre) ?? "").trim();
    const presentation = String((product == null ? void 0 : product.presentacion) ?? "").trim();
    if (!presentation) return name;
    if (normalizeComparableText(name).includes(normalizeComparableText(presentation))) {
      return name;
    }
    return `${name} ${presentation}`.trim();
  }
  function dashboardRows(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item) => typeof item === "object" && item !== null && !Array.isArray(item)
    );
  }
  function dashboardEmpty(text2) {
    return `<div class="dashboard-empty-v231">${escapeHtml(text2)}</div>`;
  }
  function renderDashboardRows(container, rows, renderRow, emptyText) {
    if (!container) return;
    const records2 = dashboardRows(rows);
    container.innerHTML = records2.length ? records2.map(renderRow).join("") : dashboardEmpty(emptyText);
  }
  function numberValue(value) {
    return Number(value ?? 0);
  }
  function textValue(value, fallback = "") {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
  }
  function errorMessage$a(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  function formatPct(value) {
    const number2 = numberValue(value);
    if (!Number.isFinite(number2)) return "—";
    return `${number2 >= 0 ? "+" : ""}${number2.toFixed(1)}%`;
  }
  function formatCompactNumber(value) {
    return new Intl.NumberFormat("es-AR", {
      notation: "compact",
      maximumFractionDigits: 1
    }).format(numberValue(value));
  }
  function marginQualityText(data) {
    const quality = textValue(data.margen_calidad);
    const coverage = Math.max(0, Math.min(100, numberValue(data.margen_cobertura_pct)));
    if (quality === "sin_ventas") return "Sin ventas en el período";
    if (quality === "completo") return "Costo histórico disponible en toda la venta";
    return `Costo histórico disponible en ${coverage.toFixed(1)}% de la venta`;
  }
  function setText$3(selector, value) {
    const element2 = queryOne(selector);
    if (element2) element2.textContent = String(value);
  }
  function createDashboardController(dependencies) {
    let days = 7;
    let dashboardData = null;
    let setupComplete = false;
    function updateAlertBadge(alertsValue) {
      const total = dashboardRows(alertsValue).reduce(
        (sum, row) => sum + numberValue(row.count),
        0
      );
      const badge = queryOne("#alertas-badge-v231");
      if (!badge) return;
      badge.textContent = total > 99 ? "99+" : String(total);
      badge.classList.toggle("hidden", total <= 0);
    }
    function renderBars(seriesValue) {
      const container = queryOne("#dashboard-sales-chart-v231");
      if (!container) return;
      const series = dashboardRows(seriesValue);
      if (!series.length) {
        container.innerHTML = dashboardEmpty("Todavía no hay ventas para graficar.");
        return;
      }
      const max = Math.max(1, ...series.map((row) => numberValue(row.total)));
      container.innerHTML = series.map((row) => {
        const total = numberValue(row.total);
        const height = Math.max(4, Math.round(total / max * 100));
        const date = /* @__PURE__ */ new Date(`${textValue(row.fecha)}T12:00:00`);
        const label = date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
        return `
          <div class="dashboard-bar-column-v231" title="${label} · ${formatArs(total)}">
            <div class="dashboard-bar-value-v231">
              ${total > 0 ? formatCompactNumber(total) : ""}
            </div>
            <div class="dashboard-bar-track-v231">
              <div class="dashboard-bar-v231" style="height:${String(height)}%"></div>
            </div>
            <small>${label}</small>
          </div>`;
      }).join("");
    }
    function render(data) {
      dashboardData = data;
      setText$3("#dash-sales-v231", formatArs(numberValue(data.ventas_netas)));
      const change = data.variacion_pct;
      const changeElement = queryOne("#dash-sales-change-v231");
      if (changeElement) {
        changeElement.textContent = change == null ? "Sin período anterior comparable" : `${formatPct(change)} vs período anterior`;
        changeElement.className = `dashboard-kpi-change-v231 ${numberValue(change) >= 0 ? "positive" : "negative"}`;
      }
      setText$3("#dash-tickets-v231", numberValue(data.tickets));
      setText$3("#dash-average-v231", `Ticket promedio ${formatArs(numberValue(data.ticket_promedio))}`);
      setText$3("#dash-margin-v231", formatArs(numberValue(data.margen_estimado)));
      setText$3("#dash-margin-quality-v231", marginQualityText(data));
      setText$3("#dash-refunds-v231", formatArs(numberValue(data.devoluciones_total)));
      setText$3(
        "#dash-refund-count-v231",
        `${String(numberValue(data.devoluciones_cantidad))} operación(es)`
      );
      setText$3("#dash-open-cash-v231", numberValue(data.cajas_abiertas));
      const alerts = dashboardRows(data.alertas);
      setText$3(
        "#dash-alerts-v231",
        alerts.reduce((sum, row) => sum + numberValue(row.count), 0)
      );
      setText$3("#dash-stock-alert-v231", `${String(alerts.length)} tipo(s) de alerta`);
      renderBars(data.serie);
      renderDashboardRows(
        queryOne("#dashboard-top-products-v231"),
        data.top_productos,
        (row, index) => `
        <div class="dashboard-list-row-v231">
          <span class="dashboard-rank-v231">${String(index + 1)}</span>
          <div class="dashboard-list-copy-v231">
            <strong>${escapeHtml(textValue(row.nombre, "Producto"))}</strong>
            <small>${String(numberValue(row.unidades))} unidades</small>
          </div>
          <strong>${formatArs(numberValue(row.total))}</strong>
        </div>`,
        "Todavía no hay productos vendidos en este período."
      );
      const paymentRows = dashboardRows(data.medios_pago);
      const paymentTotal = paymentRows.reduce((sum, row) => sum + numberValue(row.total), 0);
      renderDashboardRows(
        queryOne("#dashboard-payments-v231"),
        paymentRows,
        (row) => {
          const pct = paymentTotal > 0 ? Math.round(numberValue(row.total) / paymentTotal * 100) : 0;
          return `
          <div class="dashboard-payment-row-v231">
            <div class="dashboard-list-copy-v231">
              <strong>${escapeHtml(textValue(row.medio_pago, "Otro"))}</strong>
              <small>${String(pct)}% del cobro</small>
            </div>
            <strong>${formatArs(numberValue(row.total))}</strong>
            <div class="dashboard-mini-progress-v231"><span style="width:${String(pct)}%"></span></div>
          </div>`;
        },
        "Todavía no hay cobros en el período."
      );
      renderDashboardRows(
        queryOne("#dashboard-restock-v231"),
        data.reposicion,
        (row) => `
        <div class="dashboard-list-row-v231">
          <span class="dashboard-list-icon-v231 warning">${dependencies.icon("inventory")}</span>
          <div class="dashboard-list-copy-v231">
            <strong>${escapeHtml(textValue(row.nombre, "Producto"))}</strong>
            <small>
              Stock ${String(numberValue(row.stock))}
              ${row.dias_cobertura == null ? "" : ` · ${numberValue(row.dias_cobertura).toFixed(1)} días`}
            </small>
          </div>
          <strong>+${String(numberValue(row.reposicion_sugerida))}</strong>
        </div>`,
        "No hay reposiciones urgentes sugeridas."
      );
      renderDashboardRows(
        queryOne("#dashboard-alerts-list-v231"),
        alerts,
        (row) => {
          const severity = textValue(row.severity, "info");
          return `
          <div class="dashboard-alert-row-v231 ${escapeHtml(severity)}">
            <span class="dashboard-list-icon-v231">
              ${dependencies.icon(severity === "critical" ? "alert" : "bell")}
            </span>
            <div class="dashboard-list-copy-v231">
              <strong>${escapeHtml(textValue(row.title, "Alerta"))}</strong>
              <small>${escapeHtml(textValue(row.detail))}</small>
            </div>
            <strong>${String(numberValue(row.count))}</strong>
          </div>`;
        },
        "Sin alertas operativas activas."
      );
      renderDashboardRows(
        queryOne("#dashboard-activity-v231"),
        data.actividad,
        (row) => `
        <div class="dashboard-list-row-v231">
          <span class="dashboard-list-icon-v231">${dependencies.icon(textValue(row.icon, "history"))}</span>
          <div class="dashboard-list-copy-v231">
            <strong>${escapeHtml(textValue(row.title, "Actividad"))}</strong>
            <small>${escapeHtml(textValue(row.detail))}</small>
          </div>
          <time>${row.fecha == null ? "" : new Date(textValue(row.fecha)).toLocaleString("es-AR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        })}</time>
        </div>`,
        "Todavía no hay actividad reciente."
      );
      updateAlertBadge(alerts);
    }
    function buildSummary() {
      if (!dashboardData) return "";
      const top = dashboardRows(dashboardData.top_productos)[0];
      const alertCount = dashboardRows(dashboardData.alertas).reduce(
        (sum, row) => sum + numberValue(row.count),
        0
      );
      return [
        `Vendify · ${dependencies.getBusinessName() || "Negocio"}`,
        `Resumen ${days === 1 ? "de hoy" : `últimos ${String(days)} días`}`,
        `Ventas netas: ${formatArs(numberValue(dashboardData.ventas_netas))}`,
        `Tickets: ${String(numberValue(dashboardData.tickets))}`,
        `Ticket promedio: ${formatArs(numberValue(dashboardData.ticket_promedio))}`,
        `Margen estimado: ${formatArs(numberValue(dashboardData.margen_estimado))}`,
        `Devoluciones: ${formatArs(numberValue(dashboardData.devoluciones_total))}`,
        top ? `Más vendido: ${textValue(top.nombre)} · ${String(numberValue(top.unidades))} unidades` : null,
        `Alertas activas: ${String(alertCount)}`
      ].filter((line) => line !== null).join("\n");
    }
    async function copySummary() {
      const summary = buildSummary();
      if (!summary) {
        dependencies.showToast("Primero cargá el Dashboard", "info");
        return;
      }
      try {
        await navigator.clipboard.writeText(summary);
        dependencies.showToast("Resumen copiado", "success");
      } catch {
        dependencies.showToast("No se pudo copiar automáticamente", "error");
      }
    }
    async function load(options = {}) {
      if (!dependencies.isSupervisor()) return;
      const refresh = queryOne("#btn-refresh-dashboard-v231");
      if (refresh instanceof HTMLButtonElement) refresh.disabled = true;
      try {
        const response = await loadDashboard(dependencies.client, dependencies.getBranchId(), days);
        const data = typeof response === "object" && response !== null && !Array.isArray(response) ? response : {};
        render(data);
        if (options.focusAlerts) {
          requestAnimationFrame(() => {
            var _a;
            (_a = queryOne("#dashboard-alerts-panel-v231")) == null ? void 0 : _a.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
          });
        }
      } catch (error) {
        const message2 = errorMessage$a(error, "No se pudo cargar el Dashboard");
        console.error("[Dashboard]", error);
        void dependencies.reportError("dashboard", message2);
        const chart = queryOne("#dashboard-sales-chart-v231");
        if (chart) {
          chart.innerHTML = dashboardEmpty(
            "No se pudo cargar el Dashboard. Revisá la migración v2.31."
          );
        }
      } finally {
        if (refresh instanceof HTMLButtonElement) refresh.disabled = false;
      }
    }
    async function open(options = {}) {
      var _a;
      if (!dependencies.isSupervisor()) {
        dependencies.showToast("Tu rol no tiene acceso al Dashboard", "error");
        return;
      }
      dependencies.closeManagement();
      (_a = queryOne("#modal-dashboard-v231")) == null ? void 0 : _a.classList.remove("hidden");
      await load(options);
    }
    function close() {
      var _a;
      (_a = queryOne("#modal-dashboard-v231")) == null ? void 0 : _a.classList.add("hidden");
    }
    async function loadAlertBadge() {
      if (!dependencies.isSupervisor() || !navigator.onLine) return;
      try {
        const alerts = await loadOperationalAlerts(dependencies.client, dependencies.getBranchId());
        updateAlertBadge(alerts);
      } catch {
      }
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#btn-dashboard-v231")) == null ? void 0 : _a.addEventListener("click", () => void open());
      (_b = queryOne("#btn-alertas-v231")) == null ? void 0 : _b.addEventListener(
        "click",
        () => void open({ focusAlerts: true })
      );
      (_c = queryOne("#btn-close-dashboard-v231")) == null ? void 0 : _c.addEventListener("click", close);
      (_d = queryOne("#modal-dashboard-v231 .modal-backdrop")) == null ? void 0 : _d.addEventListener("click", close);
      queryAll("[data-dashboard-days]").forEach((button2) => {
        button2.addEventListener("click", () => {
          days = Number(button2.getAttribute("data-dashboard-days") ?? 7);
          queryAll("[data-dashboard-days]").forEach((item) => {
            item.classList.toggle("active", item === button2);
          });
          void load();
        });
      });
      (_e = queryOne("#btn-refresh-dashboard-v231")) == null ? void 0 : _e.addEventListener("click", () => void load());
      (_f = queryOne("#btn-copy-summary-v231")) == null ? void 0 : _f.addEventListener("click", () => void copySummary());
    }
    return Object.freeze({ setup, open, close, load, loadAlertBadge });
  }
  window.VendifyDashboardV232 = Object.freeze({
    loadDashboard,
    loadOperationalAlerts,
    createController: createDashboardController,
    dashboardEmpty,
    renderDashboardRows
  });
  function record$6(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }
  function records$6(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const parsed = record$6(item);
      return Object.keys(parsed).length ? [parsed] : [];
    });
  }
  function fail$3(error, fallback) {
    if (error) throw new Error(error.message ?? fallback);
  }
  async function listInventoryMovements(client, branchId, limit) {
    const { data, error } = await client.rpc("listar_movimientos_inventario_v1", {
      p_sucursal_id: branchId,
      p_limit: limit
    });
    fail$3(error, "No se pudo cargar el historial de inventario");
    return records$6(data);
  }
  async function adjustInventoryStock(client, input2) {
    const { data, error } = await client.rpc("ajustar_stock_inventario_v2", {
      p_producto_id: input2.productId,
      p_sucursal_id: input2.branchId,
      p_modo: input2.mode,
      p_cantidad: input2.quantity,
      p_motivo: input2.reason,
      p_nota: input2.note
    });
    fail$3(error, "No se pudo ajustar el stock");
    return record$6(data);
  }
  async function applyPhysicalCount(client, branchId, items, note) {
    const { data, error } = await client.rpc("aplicar_conteo_fisico_v2", {
      p_sucursal_id: branchId,
      p_items: items.map((item) => ({
        producto_id: item.productId,
        stock_contado: item.countedStock
      })),
      p_nota: note
    });
    fail$3(error, "No se pudo aplicar el conteo físico");
    return record$6(data);
  }
  async function listTransferProducts(client, originId) {
    const { data, error } = await client.rpc("listar_productos_sucursal_seguro_v1", {
      p_sucursal_id: originId
    });
    fail$3(error, "No se pudieron cargar los productos de la sucursal");
    return records$6(data);
  }
  async function transferInventoryStock(client, input2) {
    const { quantity } = input2;
    if (!input2.productId || !input2.originId || !input2.destinationId) {
      throw new Error("Revisá producto y sucursales");
    }
    if (input2.originId === input2.destinationId) {
      throw new Error("Origen y destino deben ser distintos");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("La cantidad debe ser un número entero mayor a cero");
    }
    const { data, error } = await client.rpc("transferir_stock_v2", {
      p_producto_id: input2.productId,
      p_origen_id: input2.originId,
      p_destino_id: input2.destinationId,
      p_cantidad: quantity,
      p_motivo: input2.reason
    });
    fail$3(error, "No se pudo transferir el stock");
    return record$6(data);
  }
  function field$7(selector) {
    const element2 = queryOne(selector);
    return element2 instanceof HTMLInputElement || element2 instanceof HTMLSelectElement || element2 instanceof HTMLTextAreaElement ? element2 : null;
  }
  function text$7(value, fallback = "") {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
  }
  function number$7(value) {
    return Number(value ?? 0);
  }
  function errorMessage$9(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  function createBranchTransferController(dependencies) {
    let products = [];
    let submissionInProgress = false;
    let setupComplete = false;
    function setError(message2) {
      const element2 = queryOne("#transfer-error-v226");
      if (element2) element2.textContent = message2;
    }
    function close() {
      var _a;
      (_a = queryOne("#modal-transferencia-v226")) == null ? void 0 : _a.classList.add("hidden");
    }
    function updateAvailable() {
      var _a;
      const productId = (_a = field$7("#transfer-producto-v226")) == null ? void 0 : _a.value;
      const product = products.find((item) => text$7(item.id) === productId);
      const element2 = queryOne("#transfer-stock-disponible-v226");
      if (element2) {
        element2.textContent = product ? `Disponible en origen: ${String(number$7(product.stock))}` : "";
      }
    }
    async function loadProducts() {
      var _a;
      const originId = (_a = field$7("#transfer-origen-v226")) == null ? void 0 : _a.value;
      const select = field$7("#transfer-producto-v226");
      if (!originId || !(select instanceof HTMLSelectElement)) return;
      try {
        const rows = await listTransferProducts(dependencies.client, originId);
        products = rows.map(dependencies.mapProduct);
        select.innerHTML = products.map(
          (product) => `<option value="${escapeHtml(text$7(product.id))}">${escapeHtml(dependencies.productLabel(product))} · stock ${String(number$7(product.stock))}</option>`
        ).join("");
        setError("");
        updateAvailable();
      } catch (error) {
        products = [];
        select.innerHTML = "";
        updateAvailable();
        const message2 = errorMessage$9(error, "No se pudieron cargar los productos");
        setError(message2);
        dependencies.showToast(message2, "error");
      }
    }
    async function open() {
      var _a, _b, _c, _d;
      if (!dependencies.canManage()) {
        dependencies.showToast("No tenés permiso para transferir stock", "error");
        return;
      }
      try {
        const branches = await dependencies.listBranches();
        if (branches.length < 2) {
          dependencies.showToast("Necesitás al menos dos sucursales activas", "info");
          return;
        }
        const origin = field$7("#transfer-origen-v226");
        const destination = field$7("#transfer-destino-v226");
        if (!(origin instanceof HTMLSelectElement) || !(destination instanceof HTMLSelectElement)) {
          throw new Error("No se encontró el formulario de transferencia");
        }
        const options = branches.map(
          (branch) => `<option value="${escapeHtml(text$7(branch.id))}">${escapeHtml(text$7(branch.nombre))}</option>`
        ).join("");
        origin.innerHTML = options;
        destination.innerHTML = options;
        origin.value = dependencies.getActiveBranchId() ?? text$7((_a = branches[0]) == null ? void 0 : _a.id);
        destination.value = text$7(
          (_b = branches.find((branch) => text$7(branch.id) !== origin.value)) == null ? void 0 : _b.id,
          text$7((_c = branches[0]) == null ? void 0 : _c.id)
        );
        const quantity = field$7("#transfer-cantidad-v226");
        if (quantity) quantity.value = "1";
        setError("");
        await loadProducts();
        (_d = queryOne("#modal-transferencia-v226")) == null ? void 0 : _d.classList.remove("hidden");
      } catch (error) {
        dependencies.showToast(errorMessage$9(error, "No se pudo abrir la transferencia"), "error");
      }
    }
    async function submit(event) {
      var _a, _b, _c, _d;
      event.preventDefault();
      if (submissionInProgress) return;
      const originId = ((_a = field$7("#transfer-origen-v226")) == null ? void 0 : _a.value) ?? "";
      const destinationId = ((_b = field$7("#transfer-destino-v226")) == null ? void 0 : _b.value) ?? "";
      const productId = ((_c = field$7("#transfer-producto-v226")) == null ? void 0 : _c.value) ?? "";
      const quantity = Number((_d = field$7("#transfer-cantidad-v226")) == null ? void 0 : _d.value);
      setError("");
      submissionInProgress = true;
      const submitter = event instanceof SubmitEvent && event.submitter instanceof HTMLButtonElement ? event.submitter : null;
      if (submitter) submitter.disabled = true;
      try {
        await transferInventoryStock(dependencies.client, {
          productId,
          originId,
          destinationId,
          quantity,
          reason: "Transferencia entre sucursales"
        });
        close();
        dependencies.emitStockChange("transferencia");
        const currentBranch = dependencies.getActiveBranchId();
        if (currentBranch === originId || currentBranch === destinationId) {
          await dependencies.reloadProducts();
          dependencies.renderProducts();
        }
        await dependencies.refreshBranchSettings();
        dependencies.showToast("Stock transferido", "success");
      } catch (error) {
        setError(errorMessage$9(error, "No se pudo transferir el stock"));
      } finally {
        submissionInProgress = false;
        if (submitter) submitter.disabled = false;
      }
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f, _g;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#btn-transferir-stock-v226")) == null ? void 0 : _a.addEventListener("click", () => void open());
      (_b = queryOne("#form-transferencia-v226")) == null ? void 0 : _b.addEventListener("submit", (event) => void submit(event));
      (_c = queryOne("#btn-cerrar-transferencia-v226")) == null ? void 0 : _c.addEventListener("click", close);
      (_d = queryOne("#btn-cancelar-transferencia-v226")) == null ? void 0 : _d.addEventListener("click", close);
      (_e = queryOne("#modal-transferencia-v226 .modal-backdrop")) == null ? void 0 : _e.addEventListener("click", close);
      (_f = queryOne("#transfer-origen-v226")) == null ? void 0 : _f.addEventListener("change", () => void loadProducts());
      (_g = queryOne("#transfer-producto-v226")) == null ? void 0 : _g.addEventListener("change", updateAvailable);
    }
    return Object.freeze({ setup });
  }
  function field$6(selector) {
    const element2 = queryOne(selector);
    return element2 instanceof HTMLInputElement || element2 instanceof HTMLSelectElement || element2 instanceof HTMLTextAreaElement ? element2 : null;
  }
  function text$6(value, fallback = "") {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
  }
  function number$6(value) {
    return Number(value ?? 0);
  }
  function errorMessage$8(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  function setText$2(selector, value) {
    const element2 = queryOne(selector);
    if (element2) element2.textContent = String(value);
  }
  function setValue$2(selector, value) {
    const element2 = field$6(selector);
    if (element2) element2.value = String(value);
  }
  function movementLabel(type) {
    const key = text$6(type);
    const labels = {
      venta: "Venta",
      compra: "Compra",
      stock_inicial: "Carga inicial",
      ingreso: "Ingreso",
      ajuste: "Corrección",
      rotura: "Rotura",
      vencimiento: "Vencimiento",
      perdida: "Pérdida / merma",
      inventario: "Conteo físico",
      transferencia_salida: "Transferencia saliente",
      transferencia_entrada: "Transferencia entrante",
      devolucion: "Devolución"
    };
    return labels[key] ?? (key ? key : "Movimiento");
  }
  function movementClass(type) {
    const key = text$6(type);
    if (["ingreso", "compra", "stock_inicial", "transferencia_entrada", "devolucion"].includes(key)) {
      return "positive";
    }
    if (["rotura", "vencimiento", "perdida", "transferencia_salida", "venta"].includes(key)) {
      return "negative";
    }
    return "neutral";
  }
  function createInventoryController(dependencies) {
    let movements = [];
    const countDraft = /* @__PURE__ */ new Map();
    let transferProducts = [];
    let activeTab = "resumen";
    let countInProgress = false;
    let transferInProgress = false;
    let setupComplete = false;
    function applyPermissions() {
      var _a, _b, _c, _d, _e;
      const supervisor = dependencies.isSupervisor();
      const manualStock = dependencies.hasManualStockPermission();
      (_a = queryOne('[data-inventory-tab="ajuste"]')) == null ? void 0 : _a.classList.toggle("permiso-hidden", !manualStock);
      (_b = queryOne('[data-inventory-tab="conteo"]')) == null ? void 0 : _b.classList.toggle("permiso-hidden", !manualStock);
      (_c = queryOne('[data-inventory-tab="movimientos"]')) == null ? void 0 : _c.classList.toggle("permiso-hidden", !supervisor);
      (_d = queryOne('[data-inventory-tab="transferencias"]')) == null ? void 0 : _d.classList.toggle("permiso-hidden", !supervisor);
      (_e = queryOne("#inventory-recent-card-v23014")) == null ? void 0 : _e.classList.toggle("permiso-hidden", !supervisor);
    }
    function safeTab(tab) {
      const requested = ["movimientos", "ajuste", "conteo", "transferencias"].includes(tab ?? "") ? tab : "resumen";
      if (["movimientos", "transferencias"].includes(requested) && !dependencies.isSupervisor()) {
        return "resumen";
      }
      if (["ajuste", "conteo"].includes(requested) && !dependencies.hasManualStockPermission()) {
        return "resumen";
      }
      return requested;
    }
    function activateTab(tab, load = true) {
      activeTab = safeTab(tab);
      queryAll(".inventory-tab").forEach((button2) => {
        const active = button2.getAttribute("data-inventory-tab") === activeTab;
        button2.classList.toggle("active", active);
        button2.setAttribute("aria-selected", active ? "true" : "false");
      });
      queryAll(".inventory-panel").forEach((panel) => {
        const active = panel.getAttribute("data-inventory-panel") === activeTab;
        panel.classList.toggle("active", active);
        if (panel instanceof HTMLElement) panel.hidden = !active;
      });
      const content = queryOne(".inventory-content");
      if (content instanceof HTMLElement) content.scrollTop = 0;
      if (!load) return;
      if (activeTab === "movimientos") void loadMovements();
      else if (activeTab === "ajuste") prepareAdjustment();
      else if (activeTab === "conteo") renderPhysicalCount();
      else if (activeTab === "transferencias") void prepareTransfer();
    }
    function renderRecentMovements(rows) {
      const container = queryOne("#inventory-recent-list");
      if (!container) return;
      if (!rows.length) {
        container.innerHTML = '<div class="inventory-empty">Todavía no hay movimientos registrados.</div>';
        return;
      }
      container.innerHTML = rows.map((movement) => {
        const delta = number$6(movement.delta);
        const cssClass = movementClass(movement.tipo);
        return `
        <div class="inventory-recent-row">
          <span class="inventory-recent-icon ${cssClass}">${delta >= 0 ? "↑" : "↓"}</span>
          <span class="inventory-recent-copy">
            <strong>${escapeHtml(text$6(movement.producto_nombre, "Producto"))}</strong>
            <small>${escapeHtml(movementLabel(movement.tipo))} · ${escapeHtml(text$6(movement.motivo, "Sin observación"))}</small>
          </span>
          <span class="inventory-recent-value ${cssClass}">${delta > 0 ? "+" : ""}${String(delta)}</span>
        </div>`;
      }).join("");
    }
    function renderMovements() {
      var _a, _b;
      const container = queryOne("#inventory-movement-list");
      if (!container) return;
      const query = (((_a = field$6("#inventory-movement-search")) == null ? void 0 : _a.value) ?? "").trim().toLowerCase();
      const type = ((_b = field$6("#inventory-movement-type")) == null ? void 0 : _b.value) ?? "";
      const filtered = movements.filter((movement) => {
        const queryMatches = !query || text$6(movement.producto_nombre).toLowerCase().includes(query) || text$6(movement.motivo).toLowerCase().includes(query);
        return queryMatches && (!type || movement.tipo === type);
      });
      if (!filtered.length) {
        container.innerHTML = '<div class="inventory-empty inventory-table-empty">No hay movimientos para esos filtros.</div>';
        return;
      }
      container.innerHTML = filtered.map((movement) => {
        const delta = number$6(movement.delta);
        const cssClass = movementClass(movement.tipo);
        return `
        <div class="inventory-movement-row">
          <span class="inventory-movement-product">
            <strong>${escapeHtml(text$6(movement.producto_nombre, "Producto"))}</strong>
            <small>${escapeHtml(text$6(movement.motivo, "Sin motivo"))}</small>
          </span>
          <span><span class="inventory-type-pill ${cssClass}">${escapeHtml(movementLabel(movement.tipo))}</span></span>
          <strong class="inventory-delta ${cssClass}">${delta > 0 ? "+" : ""}${String(delta)}</strong>
          <strong>${String(number$6(movement.stock_resultante))}</strong>
          <span class="inventory-movement-user">
            <strong>${escapeHtml(text$6(movement.usuario_nombre, "Usuario"))}</strong>
            <small>${escapeHtml(dependencies.formatDate(movement.creado))}</small>
          </span>
        </div>`;
      }).join("");
    }
    async function loadMovements(options = {}) {
      const branchId = dependencies.getBranch().id;
      if (!branchId) return;
      const limit = options.limit ?? 100;
      const target = options.target ?? "table";
      try {
        const rows = await listInventoryMovements(dependencies.client, branchId, limit);
        if (target === "recent") renderRecentMovements(rows);
        else {
          movements = rows;
          renderMovements();
        }
      } catch (error) {
        console.error("[Inventario] movimientos:", error);
        const container = queryOne(target === "recent" ? "#inventory-recent-list" : "#inventory-movement-list");
        if (container) {
          container.innerHTML = target === "recent" ? '<div class="inventory-empty">No se pudo cargar la actividad.</div>' : '<div class="inventory-empty">No se pudo cargar el historial.</div>';
        }
      }
    }
    function renderSummary() {
      const products = dependencies.getProducts();
      setText$2("#inventory-stat-products", products.length);
      setText$2(
        "#inventory-stat-units",
        products.reduce((sum, product) => sum + number$6(product.stock), 0).toLocaleString("es-AR")
      );
      setText$2("#inventory-stat-low", products.filter(dependencies.isLowStock).length);
      setText$2("#inventory-stat-zero", products.filter(dependencies.isOutOfStock).length);
      const attention = products.map((product) => ({ product, info: dependencies.getSmartStock(product) })).filter(
        ({ product, info }) => dependencies.isOutOfStock(product) || dependencies.isLowStock(product) || (info == null ? void 0 : info.estado) === "proximo"
      ).sort((a, b) => {
        var _a, _b;
        if (dependencies.isOutOfStock(a.product) !== dependencies.isOutOfStock(b.product)) {
          return dependencies.isOutOfStock(a.product) ? -1 : 1;
        }
        return number$6(((_a = a.info) == null ? void 0 : _a.diasCobertura) ?? 9999) - number$6(((_b = b.info) == null ? void 0 : _b.diasCobertura) ?? 9999);
      }).slice(0, 8);
      const list = queryOne("#inventory-attention-list");
      if (!list) return;
      if (!attention.length) {
        list.innerHTML = '<div class="inventory-empty">No hay productos críticos en esta sucursal.</div>';
      } else {
        list.innerHTML = attention.map(({ product, info }) => {
          const out = dependencies.isOutOfStock(product);
          const state = out ? "Sin stock" : dependencies.isLowStock(product) ? "Stock bajo" : "Próximo";
          const days = (info == null ? void 0 : info.diasCobertura) == null ? "Sin estimación" : `${number$6(info.diasCobertura).toFixed(1)} días de cobertura`;
          const id = text$6(product.id);
          return `
          <button type="button" class="inventory-attention-row" data-inventory-adjust-product="${escapeHtml(id)}">
            <span class="inventory-attention-dot ${out ? "danger" : "warning"}"></span>
            <span class="inventory-attention-copy">
              <strong>${escapeHtml(dependencies.productLabel(product))}</strong>
              <small>${escapeHtml(days)}</small>
            </span>
            <span class="inventory-attention-stock">
              <strong>${String(number$6(product.stock))}</strong><small>${state}</small>
            </span>
          </button>`;
        }).join("");
        list.querySelectorAll("[data-inventory-adjust-product]").forEach((button2) => {
          button2.addEventListener("click", () => {
            activateTab("ajuste", false);
            prepareAdjustment(button2.getAttribute("data-inventory-adjust-product"));
          });
        });
      }
      if (dependencies.isSupervisor()) void loadMovements({ limit: 6, target: "recent" });
    }
    function productOptions(selectedId = null) {
      return dependencies.getProducts().map((product) => {
        const id = text$6(product.id);
        return `<option value="${escapeHtml(id)}" ${id === selectedId ? "selected" : ""}>${escapeHtml(dependencies.productLabel(product))} · stock ${String(number$6(product.stock))}</option>`;
      }).join("");
    }
    function updateAdjustmentPreview() {
      var _a, _b, _c;
      const id = (_a = field$6("#inventory-adjust-product")) == null ? void 0 : _a.value;
      const product = dependencies.getProducts().find((item) => text$6(item.id) === id);
      const current = number$6(product == null ? void 0 : product.stock);
      const mode = ((_b = field$6("#inventory-adjust-mode")) == null ? void 0 : _b.value) ?? "sumar";
      const amount = Math.max(0, Number(((_c = field$6("#inventory-adjust-amount")) == null ? void 0 : _c.value) ?? 0));
      let result = current;
      if (mode === "sumar") result = current + amount;
      if (mode === "restar") result = Math.max(0, current - amount);
      if (mode === "establecer") result = amount;
      setText$2("#inventory-adjust-current", `Stock actual: ${String(current)}`);
      const preview = queryOne("#inventory-adjust-preview");
      if (preview) {
        const difference = result - current;
        preview.innerHTML = `Stock resultante: <strong>${String(result)}</strong> <span>(${difference >= 0 ? "+" : ""}${String(difference)})</span>`;
      }
    }
    function prepareAdjustment(productId = null, mode = null, amount = null) {
      var _a;
      const select = field$6("#inventory-adjust-product");
      if (!(select instanceof HTMLSelectElement)) return;
      const selected = productId ?? (select.value ? select.value : text$6((_a = dependencies.getProducts()[0]) == null ? void 0 : _a.id));
      select.innerHTML = productOptions(selected);
      if (selected) select.value = selected;
      if (mode) setValue$2("#inventory-adjust-mode", mode);
      if (amount != null) {
        const absoluteAmount = Math.abs(amount);
        setValue$2("#inventory-adjust-amount", absoluteAmount === 0 ? 1 : absoluteAmount);
      }
      updateAdjustmentPreview();
    }
    async function submitAdjustment(event) {
      var _a, _b, _c, _d, _e;
      event.preventDefault();
      const branchId = dependencies.getBranch().id;
      const productId = ((_a = field$6("#inventory-adjust-product")) == null ? void 0 : _a.value) ?? "";
      const mode = ((_b = field$6("#inventory-adjust-mode")) == null ? void 0 : _b.value) ?? "sumar";
      const amount = Number((_c = field$6("#inventory-adjust-amount")) == null ? void 0 : _c.value);
      const reason = ((_d = field$6("#inventory-adjust-reason")) == null ? void 0 : _d.value) ?? "correccion";
      const noteValue = ((_e = field$6("#inventory-adjust-note")) == null ? void 0 : _e.value.trim()) ?? "";
      setText$2("#inventory-adjust-error", "");
      if (!branchId || !productId || !Number.isFinite(amount) || amount < 0) {
        setText$2("#inventory-adjust-error", "Revisá producto y cantidad.");
        return;
      }
      try {
        const data = await adjustInventoryStock(dependencies.client, {
          productId,
          branchId,
          mode,
          quantity: Math.round(amount),
          reason,
          note: noteValue ? noteValue : null
        });
        dependencies.emitStockChange("inventario_ajuste");
        await dependencies.reloadProducts();
        dependencies.renderProducts();
        prepareAdjustment(productId);
        renderSummary();
        dependencies.showToast(`Stock actualizado a ${String(number$6(data.stock))}`, "success");
      } catch (error) {
        setText$2("#inventory-adjust-error", errorMessage$8(error, "No se pudo ajustar el stock"));
      }
    }
    function updateCountDifference(productId) {
      const product = dependencies.getProducts().find((item) => text$6(item.id) === productId);
      const element2 = document.querySelector(`[data-count-diff="${CSS.escape(productId)}"]`);
      if (!product || !element2) return;
      if (!countDraft.has(productId)) {
        element2.textContent = "—";
        element2.className = "inventory-count-diff";
        return;
      }
      const difference = number$6(countDraft.get(productId)) - number$6(product.stock);
      element2.textContent = `${difference > 0 ? "+" : ""}${String(difference)}`;
      element2.className = `inventory-count-diff ${difference > 0 ? "positive" : difference < 0 ? "negative" : "zero"}`;
    }
    function updateCountProgress() {
      const differences = Array.from(countDraft.entries()).filter(([id, counted]) => {
        const product = dependencies.getProducts().find((item) => text$6(item.id) === id);
        return product && counted !== number$6(product.stock);
      }).length;
      setText$2("#inventory-count-progress", `${String(countDraft.size)} contados · ${String(differences)} con diferencia`);
    }
    function renderPhysicalCount() {
      var _a;
      const container = queryOne("#inventory-count-list");
      if (!container) return;
      const query = (((_a = field$6("#inventory-count-search")) == null ? void 0 : _a.value) ?? "").trim().toLowerCase();
      const visible = dependencies.getProducts().filter(
        (product) => !query || dependencies.productLabel(product).toLowerCase().includes(query)
      );
      if (!visible.length) {
        container.innerHTML = '<div class="inventory-empty">No hay productos para mostrar.</div>';
        return;
      }
      container.innerHTML = visible.map((product) => {
        const id = text$6(product.id);
        const stored = countDraft.has(id) ? String(countDraft.get(id)) : "";
        return `
        <div class="inventory-count-row" data-count-row="${escapeHtml(id)}">
          <span class="inventory-count-product">
            <strong>${escapeHtml(dependencies.productLabel(product))}</strong>
            <small>${escapeHtml(text$6(product.categoria, "Sin categoría"))}</small>
          </span>
          <span class="inventory-system-stock"><small>Sistema</small><strong>${String(number$6(product.stock))}</strong></span>
          <label class="inventory-count-input"><small>Contado</small>
            <input type="number" min="0" step="1" inputmode="numeric" data-count-product="${escapeHtml(id)}" value="${stored}" placeholder="—" />
          </label>
          <span class="inventory-count-diff" data-count-diff="${escapeHtml(id)}">—</span>
        </div>`;
      }).join("");
      container.querySelectorAll("[data-count-product]").forEach((element2) => {
        element2.addEventListener("input", () => {
          if (!(element2 instanceof HTMLInputElement)) return;
          const id = element2.getAttribute("data-count-product");
          if (!id) return;
          if (element2.value === "") countDraft.delete(id);
          else countDraft.set(id, Math.max(0, Number(element2.value || 0)));
          updateCountDifference(id);
          updateCountProgress();
        });
      });
      visible.forEach((product) => {
        updateCountDifference(text$6(product.id));
      });
      updateCountProgress();
    }
    function clearPhysicalCount() {
      countDraft.clear();
      setValue$2("#inventory-count-note", "");
      renderPhysicalCount();
    }
    async function submitPhysicalCount() {
      var _a;
      if (!dependencies.requireManualStockPermission(
        "El propietario no habilitó los conteos de stock para tu usuario"
      )) return;
      if (countInProgress) return;
      if (!countDraft.size) {
        dependencies.showToast("Ingresá al menos un producto contado", "info");
        return;
      }
      const branchId = dependencies.getBranch().id;
      if (!branchId) return;
      const countItems = Array.from(countDraft.entries()).map(([productId, countedStock]) => ({
        productId,
        countedStock: Math.max(0, Math.round(countedStock))
      }));
      const differences = countItems.filter((item) => {
        const product = dependencies.getProducts().find((candidate) => text$6(candidate.id) === item.productId);
        return product && number$6(product.stock) !== item.countedStock;
      });
      const confirmed = await dependencies.confirm(
        "Aplicar conteo físico",
        differences.length ? `Se ajustarán ${String(differences.length)} productos con diferencias. El conteo quedará auditado.` : "No hay diferencias. ¿Querés guardar igualmente este conteo?"
      );
      if (!confirmed) return;
      countInProgress = true;
      const button2 = queryOne("#btn-apply-count");
      if (button2 instanceof HTMLButtonElement) {
        button2.disabled = true;
        button2.textContent = "Aplicando...";
      }
      try {
        const noteValue = ((_a = field$6("#inventory-count-note")) == null ? void 0 : _a.value.trim()) ?? "";
        const data = await applyPhysicalCount(
          dependencies.client,
          branchId,
          countItems,
          noteValue ? noteValue : null
        );
        countDraft.clear();
        setValue$2("#inventory-count-note", "");
        dependencies.emitStockChange("conteo_fisico");
        await dependencies.reloadProducts();
        dependencies.renderProducts();
        renderPhysicalCount();
        renderSummary();
        dependencies.showToast(
          `Conteo guardado · ${String(number$6(data.productos_ajustados))} ajustes`,
          "success"
        );
      } catch (error) {
        dependencies.showToast(errorMessage$8(error, "No se pudo aplicar el conteo físico"), "error");
      } finally {
        countInProgress = false;
        if (button2 instanceof HTMLButtonElement) {
          button2.disabled = false;
          button2.textContent = "Aplicar diferencias";
        }
      }
    }
    function updateTransferAvailable() {
      var _a;
      const id = (_a = field$6("#inventory-transfer-product")) == null ? void 0 : _a.value;
      const product = transferProducts.find((item) => text$6(item.id) === id);
      setText$2(
        "#inventory-transfer-available",
        product ? `Disponible en origen: ${String(number$6(product.stock))}` : "Disponible: —"
      );
    }
    async function loadTransferProductList() {
      var _a;
      const originId = (_a = field$6("#inventory-transfer-origin")) == null ? void 0 : _a.value;
      if (!originId) return;
      try {
        const rows = await listTransferProducts(dependencies.client, originId);
        transferProducts = rows.map(dependencies.mapProduct);
        const select = field$6("#inventory-transfer-product");
        if (select instanceof HTMLSelectElement) {
          select.innerHTML = transferProducts.map(
            (product) => `<option value="${escapeHtml(text$6(product.id))}">${escapeHtml(dependencies.productLabel(product))} · stock ${String(number$6(product.stock))}</option>`
          ).join("");
        }
        updateTransferAvailable();
      } catch (error) {
        setText$2("#inventory-transfer-error", errorMessage$8(error, "No se pudieron cargar los productos"));
      }
    }
    async function prepareTransfer() {
      var _a, _b, _c;
      const origin = field$6("#inventory-transfer-origin");
      const destination = field$6("#inventory-transfer-destination");
      if (!(origin instanceof HTMLSelectElement) || !(destination instanceof HTMLSelectElement)) return;
      try {
        const branches = await dependencies.listBranches();
        const options = branches.map(
          (branch) => `<option value="${escapeHtml(text$6(branch.id))}">${escapeHtml(text$6(branch.nombre))}</option>`
        ).join("");
        origin.innerHTML = options;
        destination.innerHTML = options;
        origin.value = dependencies.getBranch().id ?? text$6((_a = branches[0]) == null ? void 0 : _a.id);
        destination.value = text$6(
          (_b = branches.find((branch) => text$6(branch.id) !== origin.value)) == null ? void 0 : _b.id,
          text$6((_c = branches[0]) == null ? void 0 : _c.id)
        );
        await loadTransferProductList();
      } catch (error) {
        setText$2("#inventory-transfer-error", errorMessage$8(error, "No se cargaron las sucursales"));
      }
    }
    async function submitTransfer(event) {
      var _a, _b, _c, _d, _e;
      event.preventDefault();
      if (transferInProgress) return;
      const originId = ((_a = field$6("#inventory-transfer-origin")) == null ? void 0 : _a.value) ?? "";
      const destinationId = ((_b = field$6("#inventory-transfer-destination")) == null ? void 0 : _b.value) ?? "";
      const productId = ((_c = field$6("#inventory-transfer-product")) == null ? void 0 : _c.value) ?? "";
      const quantity = Number((_d = field$6("#inventory-transfer-amount")) == null ? void 0 : _d.value);
      const note = ((_e = field$6("#inventory-transfer-note")) == null ? void 0 : _e.value.trim()) ?? "";
      setText$2("#inventory-transfer-error", "");
      if (originId === destinationId) {
        setText$2("#inventory-transfer-error", "Origen y destino deben ser distintos.");
        return;
      }
      transferInProgress = true;
      const submitter = event instanceof SubmitEvent && event.submitter instanceof HTMLButtonElement ? event.submitter : null;
      if (submitter) submitter.disabled = true;
      try {
        await transferInventoryStock(dependencies.client, {
          productId,
          originId,
          destinationId,
          quantity: Math.round(quantity),
          reason: note ? note : "Transferencia entre sucursales"
        });
        dependencies.emitStockChange("transferencia_inventario");
        const currentBranch = dependencies.getBranch().id;
        if (currentBranch === originId || currentBranch === destinationId) {
          await dependencies.reloadProducts();
          dependencies.renderProducts();
        }
        setValue$2("#inventory-transfer-note", "");
        setValue$2("#inventory-transfer-amount", "1");
        await loadTransferProductList();
        renderSummary();
        dependencies.showToast(`Transferencia realizada · ${String(quantity)} unidades`, "success");
      } catch (error) {
        setText$2("#inventory-transfer-error", errorMessage$8(error, "No se pudo transferir el stock"));
      } finally {
        transferInProgress = false;
        if (submitter) submitter.disabled = false;
      }
    }
    async function refresh(reloadProducts = true) {
      if (reloadProducts) await dependencies.reloadProducts();
      renderSummary();
      if (activeTab === "movimientos") await loadMovements();
      else if (activeTab === "ajuste") prepareAdjustment();
      else if (activeTab === "conteo") renderPhysicalCount();
      else if (activeTab === "transferencias") await prepareTransfer();
    }
    async function refreshOpenView(reloadProducts = true) {
      var _a;
      if (((_a = queryOne("#modal-inventario")) == null ? void 0 : _a.classList.contains("hidden")) !== false) return;
      await refresh(reloadProducts);
    }
    async function open(tab = "resumen") {
      var _a;
      if (!dependencies.canManage()) {
        dependencies.showToast("Tu rol no permite administrar inventario", "error");
        return;
      }
      const branch = dependencies.getBranch();
      if (!branch.id) {
        dependencies.showToast("Seleccioná una sucursal", "error");
        return;
      }
      const branchName = branch.name ? branch.name : "Sucursal";
      setText$2("#inventory-branch-badge", branchName);
      setText$2("#inventory-summary-title", `Inventario · ${branchName}`);
      (_a = queryOne("#modal-inventario")) == null ? void 0 : _a.classList.remove("hidden");
      applyPermissions();
      activateTab(tab, false);
      await refresh();
    }
    function close() {
      var _a;
      (_a = queryOne("#modal-inventario")) == null ? void 0 : _a.classList.add("hidden");
    }
    async function openAdjustmentFromProduct(productId, delta = null) {
      await open("ajuste");
      const product = dependencies.getProducts().find((item) => text$6(item.id) === productId);
      if (delta == null) prepareAdjustment(productId, "establecer", number$6(product == null ? void 0 : product.stock));
      else prepareAdjustment(productId, delta >= 0 ? "sumar" : "restar", Math.abs(delta));
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#btn-inventario")) == null ? void 0 : _a.addEventListener("click", () => void open());
      (_b = queryOne("#btn-close-inventory")) == null ? void 0 : _b.addEventListener("click", close);
      (_c = queryOne("#modal-inventario .modal-backdrop")) == null ? void 0 : _c.addEventListener("click", close);
      queryAll(".inventory-tab").forEach((button2) => {
        button2.addEventListener("click", () => {
          activateTab(button2.getAttribute("data-inventory-tab"));
        });
      });
      queryAll("[data-inventory-go]").forEach((button2) => {
        button2.addEventListener("click", () => {
          activateTab(button2.getAttribute("data-inventory-go"));
        });
      });
      (_d = queryOne("#btn-refresh-inventory")) == null ? void 0 : _d.addEventListener("click", () => void refresh());
      (_e = queryOne("#btn-refresh-movements")) == null ? void 0 : _e.addEventListener("click", () => void loadMovements());
      (_f = queryOne("#inventory-movement-search")) == null ? void 0 : _f.addEventListener("input", renderMovements);
      (_g = queryOne("#inventory-movement-type")) == null ? void 0 : _g.addEventListener("change", renderMovements);
      (_h = queryOne("#inventory-adjust-form")) == null ? void 0 : _h.addEventListener("submit", (event) => void submitAdjustment(event));
      (_i = queryOne("#inventory-adjust-product")) == null ? void 0 : _i.addEventListener("change", updateAdjustmentPreview);
      (_j = queryOne("#inventory-adjust-mode")) == null ? void 0 : _j.addEventListener("change", updateAdjustmentPreview);
      (_k = queryOne("#inventory-adjust-amount")) == null ? void 0 : _k.addEventListener("input", updateAdjustmentPreview);
      (_l = queryOne("#inventory-count-search")) == null ? void 0 : _l.addEventListener("input", renderPhysicalCount);
      (_m = queryOne("#btn-clear-count")) == null ? void 0 : _m.addEventListener("click", clearPhysicalCount);
      (_n = queryOne("#btn-apply-count")) == null ? void 0 : _n.addEventListener("click", () => void submitPhysicalCount());
      (_o = queryOne("#inventory-transfer-form")) == null ? void 0 : _o.addEventListener("submit", (event) => void submitTransfer(event));
      (_p = queryOne("#inventory-transfer-origin")) == null ? void 0 : _p.addEventListener("change", () => void loadTransferProductList());
      (_q = queryOne("#inventory-transfer-product")) == null ? void 0 : _q.addEventListener("change", updateTransferAvailable);
    }
    return Object.freeze({ setup, refreshOpenView, openAdjustmentFromProduct });
  }
  window.VendifyInventoryV232 = Object.freeze({
    createController: createInventoryController,
    createBranchTransferController,
    listMovements: listInventoryMovements,
    adjustStock: adjustInventoryStock,
    applyPhysicalCount,
    listTransferProducts,
    transferStock: transferInventoryStock
  });
  function sanitizeClientErrorMessage(message2) {
    const raw = typeof message2 === "string" ? message2 : message2 instanceof Error ? message2.message : "Error";
    return raw.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").slice(0, 1e3);
  }
  async function logClientError(client, input2) {
    await client.rpc("registrar_error_cliente_v1", {
      p_tipo: (input2.type.length ? input2.type : "client").slice(0, 50),
      p_mensaje: sanitizeClientErrorMessage(input2.message),
      p_version: input2.version,
      p_contexto: input2.context
    });
  }
  window.VendifyObservabilityV232 = Object.freeze({
    logClientError,
    sanitizeClientErrorMessage
  });
  function parseLegacyOfflineQueue(raw) {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  function legacyOfflineSalesStorageKey(scope) {
    return [
      "vendify_offline_sales_v2311",
      scope.userId ?? "anon",
      scope.businessId ?? "none",
      scope.branchId ?? "none"
    ].join(":");
  }
  function legacyOfflineSalesPreBranchStorageKey(scope) {
    return [
      "vendify_offline_sales_v2311",
      scope.userId ?? "anon",
      scope.businessId ?? "none"
    ].join(":");
  }
  function partitionLegacyOfflineSalesByScope(queue, scope) {
    if (!scope.userId || !scope.businessId || !scope.branchId) {
      return { scoped: [], remaining: [...queue] };
    }
    const scoped = [];
    const remaining = [];
    for (const sale of queue) {
      if (sale.user_id === scope.userId && sale.negocio_id === scope.businessId && sale.sucursal_id === scope.branchId) {
        scoped.push(sale);
      } else {
        remaining.push(sale);
      }
    }
    return { scoped, remaining };
  }
  function summarizeLegacyOfflineQueue(queue) {
    return {
      total: queue.length,
      pending: queue.filter((sale) => sale.status !== "revision").length,
      revision: queue.filter((sale) => sale.status === "revision").length,
      queue
    };
  }
  function validateLegacyOfflinePayments(payments) {
    const allowed = /* @__PURE__ */ new Set(["Efectivo", "Transferencia"]);
    if (payments.some((payment) => !allowed.has(payment.medio_pago))) {
      throw new Error(
        "Sin internet solo se permiten cobros en Efectivo o Transferencia."
      );
    }
  }
  function createLegacyOfflineSale(input2) {
    return {
      request_id: input2.requestId,
      status: "pending",
      attempts: 0,
      last_error: null,
      created_at: input2.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      user_id: input2.userId,
      negocio_id: input2.businessId,
      sucursal_id: input2.branchId,
      caja_id: input2.cashRegisterId,
      items: input2.items.map((item) => ({
        producto_id: item.id,
        producto_nombre: item.nombre,
        cantidad: item.cantidad,
        precio_unitario: item.precioVenta
      })),
      pagos: input2.payments.map((payment) => ({
        medio_pago: payment.medio_pago,
        monto: payment.monto
      })),
      totales: {
        subtotal: input2.totals.subtotal,
        total: input2.totals.total
      },
      observacion: input2.observation.trim() || null
    };
  }
  function buildLegacyOfflineTicket(sale) {
    return {
      venta: {
        id: sale.request_id,
        creado: sale.created_at,
        subtotal: sale.totales.subtotal,
        descuento_total: 0,
        total: sale.totales.total,
        estado: "pendiente_sincronizacion",
        observacion: sale.observacion
      },
      items: sale.items.map((item) => ({
        producto_nombre: item.producto_nombre,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        subtotal: item.precio_unitario * item.cantidad
      })),
      pagos: sale.pagos.map((payment) => ({
        ...payment,
        operacion: "cobro"
      }))
    };
  }
  function isLegacyOfflineNetworkError(error, online) {
    const value = typeof error === "object" && error !== null && "message" in error ? error.message : error;
    const text2 = typeof value === "string" ? value.toLowerCase() : typeof value === "number" || typeof value === "boolean" ? String(value).toLowerCase() : "";
    return !online || ["failed to fetch", "network", "load failed", "internet"].some((marker) => text2.includes(marker));
  }
  const CASH_PROOF_PREFIX = "vendify_cash_proof_v2311";
  const MAX_OFFLINE_SALES = 200;
  const CASH_PROOF_MAX_MS = 18 * 60 * 60 * 1e3;
  function element(selector) {
    return document.querySelector(selector);
  }
  function button(selector) {
    return document.querySelector(selector);
  }
  function countText(value) {
    return String(value);
  }
  function errorText(error) {
    return error instanceof Error ? error.message : "Error de red";
  }
  function createOfflineCompatController(dependencies) {
    const now = dependencies.now ?? Date.now;
    const isOnline = dependencies.isOnline ?? (() => navigator.onLine);
    let syncPromise = null;
    let setupComplete = false;
    function salesKey() {
      return legacyOfflineSalesStorageKey(currentLegacyScope());
    }
    function preBranchSalesKey() {
      return legacyOfflineSalesPreBranchStorageKey(currentLegacyScope());
    }
    function currentLegacyScope() {
      const context = dependencies.getContext();
      return {
        userId: context.userId,
        businessId: context.businessId,
        branchId: context.branchId
      };
    }
    function cashProofKey() {
      const context = dependencies.getContext();
      return [
        CASH_PROOF_PREFIX,
        context.userId ?? "anon",
        context.businessId ?? "none",
        context.branchId ?? "none",
        context.cashRegisterId ?? "none"
      ].join(":");
    }
    function readLegacySales() {
      try {
        const scopedRaw = dependencies.storage.getItem(salesKey());
        if (scopedRaw !== null) return parseLegacyOfflineQueue(scopedRaw);
        const previousKey = preBranchSalesKey();
        const previousQueue = parseLegacyOfflineQueue(dependencies.storage.getItem(previousKey));
        const { scoped, remaining } = partitionLegacyOfflineSalesByScope(
          previousQueue,
          currentLegacyScope()
        );
        if (scoped.length === 0) return [];
        dependencies.storage.setItem(salesKey(), JSON.stringify(scoped));
        if (remaining.length === 0) {
          dependencies.storage.removeItem(previousKey);
        } else {
          dependencies.storage.setItem(previousKey, JSON.stringify(remaining));
        }
        return scoped;
      } catch {
        return [];
      }
    }
    function saveLegacySales(queue) {
      try {
        dependencies.storage.setItem(salesKey(), JSON.stringify(queue));
        return true;
      } catch (error) {
        console.error("[Offline sales] storage:", error);
        return false;
      }
    }
    function persistCashProof() {
      const context = dependencies.getContext();
      const state = dependencies.getCashState();
      if (!dependencies.isCashOpenByCurrentUser() || !context.userId || !context.businessId || !context.branchId || !context.cashRegisterId) return;
      try {
        dependencies.storage.setItem(cashProofKey(), JSON.stringify({
          savedAt: new Date(now()).toISOString(),
          userId: context.userId,
          businessId: context.businessId,
          branchId: context.branchId,
          cashId: context.cashRegisterId,
          estado: state
        }));
      } catch {
      }
    }
    function restoreCashProof() {
      var _a, _b;
      const context = dependencies.getContext();
      if (!context.userId || !context.businessId || !context.branchId || !context.cashRegisterId) {
        return false;
      }
      try {
        const raw = dependencies.storage.getItem(cashProofKey());
        if (!raw) return false;
        const proof = JSON.parse(raw);
        const savedAt = new Date(proof.savedAt ?? 0).getTime();
        const valid = proof.userId === context.userId && proof.businessId === context.businessId && proof.branchId === context.branchId && proof.cashId === context.cashRegisterId && Boolean((_a = proof.estado) == null ? void 0 : _a.sesion) && ((_b = proof.estado) == null ? void 0 : _b.es_mia) === true && Number.isFinite(savedAt) && now() - savedAt <= CASH_PROOF_MAX_MS;
        if (!valid) return false;
        dependencies.setCashState(proof.estado);
        return true;
      } catch {
        return false;
      }
    }
    function cashEnabledOffline() {
      return dependencies.isCashOpenByCurrentUser() || restoreCashProof();
    }
    function canChargeOffline() {
      const context = dependencies.getContext();
      if (isOnline() || !context.ready || !dependencies.hasSellPermission()) return false;
      if (!context.branchId || !context.cashRegisterId || !cashEnabledOffline()) return false;
      return readLegacySales().length < MAX_OFFLINE_SALES;
    }
    function updateUi() {
      const state = summarizeLegacyOfflineQueue(readLegacySales());
      const globalBanner = element("#offline-sync-banner-v2311");
      const globalText = element("#offline-sync-text-v2311");
      const retry = button("#btn-sync-offline-sales-v2311");
      const saleBanner = element("#offline-sale-banner-v2311");
      const saleMessage = element("#offline-sale-message-v2311");
      const connection = element("#connection-status-v23011");
      globalBanner == null ? void 0 : globalBanner.classList.toggle("hidden", state.total === 0);
      if (globalText && state.total > 0) {
        if (state.revision > 0) {
          globalText.textContent = `${countText(state.total)} venta${state.total === 1 ? "" : "s"} pendiente${state.total === 1 ? "" : "s"} · ${countText(state.revision)} requiere${state.revision === 1 ? "" : "n"} revisión`;
        } else if (isOnline()) {
          globalText.textContent = `${countText(state.total)} venta${state.total === 1 ? "" : "s"} esperando sincronización`;
        } else {
          globalText.textContent = `${countText(state.total)} venta${state.total === 1 ? "" : "s"} guardada${state.total === 1 ? "" : "s"} sin conexión`;
        }
      }
      if (retry) {
        retry.disabled = !isOnline();
        retry.textContent = isOnline() ? "Sincronizar" : "Esperando internet";
      }
      if (connection) {
        connection.dataset.pendingOffline = String(state.total);
        connection.classList.toggle("has-offline-sales-v2311", state.total > 0);
      }
      const offline = !isOnline();
      saleBanner == null ? void 0 : saleBanner.classList.toggle("hidden", !offline);
      if (saleMessage && offline) {
        saleMessage.textContent = canChargeOffline() ? state.total > 0 ? `Podés seguir vendiendo. Hay ${countText(state.total)} venta${state.total === 1 ? "" : "s"} pendiente${state.total === 1 ? "" : "s"} de sincronización.` : "Podés cobrar en Efectivo o Transferencia. La venta se sincronizará automáticamente al volver internet." : "Para vender sin conexión, esta caja debe haber sido abierta y verificada previamente con internet.";
      }
    }
    function applySaleState() {
      const saleButton = button("#btn-cobrar");
      if (!saleButton) return;
      const offline = !isOnline();
      const enabled = canChargeOffline();
      saleButton.classList.toggle("offline-enabled-v2311", offline && enabled);
      saleButton.classList.toggle("offline-disabled-v231", offline && !enabled);
      if (offline) {
        saleButton.textContent = enabled ? "Cobrar offline" : "Cobro offline no disponible";
        saleButton.disabled = dependencies.getCartSize() === 0 || dependencies.isSaleConfirming() || !enabled;
        saleButton.title = enabled ? "La venta quedará pendiente de sincronización" : "La caja debe haber sido verificada abierta con internet";
      } else {
        saleButton.textContent = "Cobrar";
        saleButton.title = "";
        saleButton.disabled = dependencies.getCartSize() === 0 || dependencies.isSaleConfirming();
      }
      updateUi();
    }
    function validateLocalStock(items) {
      for (const item of items) {
        const product = dependencies.getProducts().find((candidate) => candidate.id === item.id);
        if (!product) throw new Error(`No se encontró "${item.nombre}" en el catálogo local.`);
        if (product.stock < item.cantidad) {
          throw new Error(`Stock local insuficiente de "${product.nombre}".`);
        }
      }
    }
    function applySaleToLocalStock(items) {
      var _a;
      for (const item of items) {
        const product = dependencies.getProducts().find((candidate) => candidate.id === item.id);
        if (product) {
          product.stock = Math.max(0, product.stock - item.cantidad);
        }
      }
      dependencies.persistProducts();
      dependencies.renderProducts();
      if (!((_a = element("#modal-venta")) == null ? void 0 : _a.classList.contains("hidden"))) {
        dependencies.renderSaleProducts();
      }
    }
    function applySaleToLocalCash(payments, total) {
      const state = dependencies.getCashState();
      if (!(state == null ? void 0 : state.sesion) || !state.es_mia) return;
      const cash = payments.filter((payment) => payment.medio_pago === "Efectivo").reduce((sum, payment) => sum + payment.monto, 0);
      const session = state.sesion;
      session.ventas_total = (session.ventas_total ?? 0) + total;
      session.ventas_efectivo = (session.ventas_efectivo ?? 0) + cash;
      session.efectivo_esperado = (session.efectivo_esperado ?? 0) + cash;
      session.tickets = (session.tickets ?? 0) + 1;
      persistCashProof();
      dependencies.renderCashHeader();
    }
    function buildTicket(sale) {
      return buildLegacyOfflineTicket(sale);
    }
    function registerLegacySale(items, payments, totals, observation) {
      const context = dependencies.getContext();
      if (!canChargeOffline()) throw new Error("La caja no está habilitada para ventas offline.");
      if ((totals.tipo ?? "").trim() || (totals.descuento ?? 0) > 0) {
        throw new Error("Los descuentos requieren conexión para validar la autorización.");
      }
      validateLegacyOfflinePayments(payments);
      validateLocalStock(items);
      const queue = readLegacySales();
      if (queue.length >= MAX_OFFLINE_SALES) {
        throw new Error(
          "Se alcanzó el máximo de ventas offline pendientes. Reconectá internet antes de continuar."
        );
      }
      if (!context.businessId || !context.branchId || !context.cashRegisterId) {
        throw new Error("No se pudo determinar el contexto para la venta offline.");
      }
      const sale = createLegacyOfflineSale({
        requestId: dependencies.ensureRequestId(),
        userId: context.userId,
        businessId: context.businessId,
        branchId: context.branchId,
        cashRegisterId: context.cashRegisterId,
        items,
        payments,
        totals,
        observation
      });
      if (!saveLegacySales([...queue, sale])) {
        throw new Error("No hay espacio suficiente para guardar la venta sin conexión.");
      }
      applySaleToLocalStock(items);
      applySaleToLocalCash(payments, totals.total);
      dependencies.clearPersistedCart();
      updateUi();
      return buildLegacyOfflineTicket(sale);
    }
    async function registerSale2(items, payments, totals, observation) {
      var _a;
      if (((_a = window.VendifyOfflineV2312) == null ? void 0 : _a.enabled) && typeof window.registrarVentaOfflineIndexedDbV2312 === "function") {
        return window.registrarVentaOfflineIndexedDbV2312(items, payments, totals, observation);
      }
      return registerLegacySale(items, payments, totals, observation);
    }
    async function syncLegacy(options = {}) {
      if (!isOnline()) {
        updateUi();
        return { synced: 0, revision: 0, pending: readLegacySales().length };
      }
      if (syncPromise) return syncPromise;
      syncPromise = (async () => {
        var _a;
        const queue = readLegacySales();
        let synced = 0;
        let stoppedByNetwork = false;
        for (let index = 0; index < queue.length; ) {
          const sale = queue[index];
          if (!sale) break;
          if (sale.status === "revision" && options.incluirRevision !== true) {
            index += 1;
            continue;
          }
          let response;
          try {
            response = await dependencies.client.rpc("registrar_venta_v4", {
              p_items: sale.items.map((item) => ({
                producto_id: item.producto_id,
                cantidad: item.cantidad
              })),
              p_pagos: sale.pagos,
              p_descuento_tipo: null,
              p_descuento_valor: 0,
              p_observacion: sale.observacion,
              p_sucursal_id: sale.sucursal_id,
              p_caja_id: sale.caja_id,
              p_request_id: sale.request_id
            });
          } catch (error) {
            response = { data: null, error: { message: errorText(error) } };
          }
          if (response.error) {
            if (isLegacyOfflineNetworkError(response.error, isOnline())) {
              stoppedByNetwork = true;
              break;
            }
            sale.attempts += 1;
            sale.last_error = response.error.message ?? "La venta necesita revisión.";
            sale.status = "revision";
            queue[index] = sale;
            saveLegacySales(queue);
            index += 1;
            continue;
          }
          queue.splice(index, 1);
          saveLegacySales(queue);
          synced += 1;
        }
        updateUi();
        if (synced > 0) {
          try {
            await dependencies.reloadProducts();
            dependencies.renderProducts();
            await dependencies.reloadCash();
          } catch (error) {
            console.warn("[Offline sales] sincronizada, refresh pendiente:", error);
          }
        }
        const remaining = readLegacySales();
        const reviewSales = remaining.filter((sale) => sale.status === "revision");
        if (options.mostrarResumen) {
          if (synced > 0 && reviewSales.length === 0) {
            dependencies.showToast(
              `${countText(synced)} venta${synced === 1 ? "" : "s"} offline sincronizada${synced === 1 ? "" : "s"}`,
              "success"
            );
          } else if (reviewSales.length > 0) {
            const firstError = ((_a = reviewSales[0]) == null ? void 0 : _a.last_error) ?? "Revisá stock y estado de caja.";
            dependencies.showToast(
              `${countText(reviewSales.length)} venta${reviewSales.length === 1 ? "" : "s"} requiere${reviewSales.length === 1 ? "" : "n"} revisión: ${firstError}`,
              "error"
            );
          } else if (stoppedByNetwork && remaining.length > 0) {
            dependencies.showToast(
              "La conexión volvió a cortarse. Las ventas siguen guardadas.",
              "info"
            );
          }
        }
        return { synced, revision: reviewSales.length, pending: remaining.length };
      })().finally(() => {
        syncPromise = null;
      });
      return syncPromise;
    }
    async function sync(options = {}) {
      var _a;
      if (((_a = window.VendifyOfflineV2312) == null ? void 0 : _a.enabled) && typeof window.sincronizarVentasOfflineIndexedDbV2312 === "function") {
        return window.sincronizarVentasOfflineIndexedDbV2312(options);
      }
      return syncLegacy(options);
    }
    function setup() {
      var _a;
      if (setupComplete) return;
      setupComplete = true;
      (_a = button("#btn-sync-offline-sales-v2311")) == null ? void 0 : _a.addEventListener("click", () => void sync({
        mostrarResumen: true,
        incluirRevision: true
      }));
      updateUi();
      if (isOnline() && readLegacySales().length > 0) {
        window.setTimeout(() => void sync({ mostrarResumen: true }), 800);
      }
      window.addEventListener("offline", () => {
        dependencies.persistCart();
        persistCashProof();
        applySaleState();
        updateUi();
      });
      window.addEventListener("online", () => {
        void (async () => {
          dependencies.setConnectionState("syncing", "Sincronizando");
          await sync({ mostrarResumen: true });
          applySaleState();
          await dependencies.reloadCommercialFoundation();
          try {
            await dependencies.reloadCash();
          } catch {
          }
          dependencies.renderCart();
          updateUi();
          if (isOnline()) dependencies.setConnectionState("online");
        })();
      });
      window.addEventListener("focus", () => {
        var _a2;
        if (isOnline() && (readLegacySales().length > 0 || ((_a2 = window.VendifyOfflineV2312) == null ? void 0 : _a2.enabled) === true)) void sync({ mostrarResumen: false });
      });
    }
    return {
      setup,
      readLegacySales,
      persistCashProof,
      restoreCashProof,
      canChargeOffline,
      updateUi,
      applySaleState,
      validatePayments: validateLegacyOfflinePayments,
      validateLocalStock,
      applySaleToLocalStock,
      applySaleToLocalCash,
      buildTicket,
      registerLegacySale,
      registerSale: registerSale2,
      sync
    };
  }
  window.VendifyOfflineCompatV232 = Object.freeze({
    createController: createOfflineCompatController,
    parseLegacyQueue: parseLegacyOfflineQueue,
    summarizeLegacyQueue: summarizeLegacyOfflineQueue,
    validatePayments: validateLegacyOfflinePayments,
    createLegacySale: createLegacyOfflineSale,
    buildLegacyTicket: buildLegacyOfflineTicket,
    isNetworkError: isLegacyOfflineNetworkError
  });
  function record$5(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }
  function records$5(value) {
    return Array.isArray(value) ? value.map(record$5).filter((item) => Object.keys(item).length > 0) : [];
  }
  function fail$2(error, fallback) {
    if (error) throw new Error(error.message ?? fallback);
  }
  async function isPlatformAdmin(client) {
    const { data, error } = await client.rpc("es_admin_plataforma_v1");
    fail$2(error, "No se pudo verificar el acceso de plataforma");
    return data === true;
  }
  async function loadPlatformBackoffice(client) {
    const [overview, businesses, errors] = await Promise.all([
      client.rpc("platform_overview_v1"),
      client.rpc("listar_negocios_plataforma_v1", { p_limit: 50 }),
      client.rpc("listar_errores_plataforma_v1", { p_limit: 30 })
    ]);
    fail$2(overview.error, "No se pudo cargar el backoffice");
    fail$2(businesses.error, "No se pudo cargar los negocios");
    fail$2(errors.error, "No se pudieron cargar los errores");
    return { overview: record$5(overview.data), businesses: records$5(businesses.data), errors: records$5(errors.data) };
  }
  async function updateBusinessPlan(client, businessId, planCode, status) {
    const { data, error } = await client.rpc("actualizar_plan_negocio_plataforma_v1", { p_negocio_id: businessId, p_plan_codigo: planCode, p_estado: status });
    fail$2(error, "No se pudo actualizar el plan");
    const result = record$5(data);
    if (result.ok === false) throw new Error(typeof result.message === "string" ? result.message : "No se pudo actualizar el plan");
    return result;
  }
  window.VendifyPlatformV232 = Object.freeze({
    isAdmin: isPlatformAdmin,
    loadBackoffice: loadPlatformBackoffice,
    updatePlan: updateBusinessPlan
  });
  function text$5(value) {
    return typeof value === "string" ? value : "";
  }
  function number$5(value, fallback = 0) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  function mapProductRow(row) {
    return {
      ...row,
      id: text$5(row.id),
      nombre: text$5(row.nombre),
      marca: text$5(row.marca),
      presentacion: text$5(row.presentacion),
      codigoBarras: text$5(row.codigo_barras),
      categoria: text$5(row.categoria),
      precioCompra: number$5(row.precio_compra),
      precioVenta: number$5(row.precio_venta),
      stock: number$5(row.stock),
      stockMinimo: row.stock_minimo == null ? 5 : number$5(row.stock_minimo, 5),
      foto: text$5(row.foto) || null,
      creado: row.creado
    };
  }
  function productLabel(product) {
    const name = text$5(product.nombre);
    if (name) return name;
    const fallback = [text$5(product.marca), text$5(product.presentacion)].filter(Boolean).join(" ");
    return fallback || "Producto";
  }
  function mapSmartStockRow(row) {
    return {
      ...row,
      vendidos7d: number$5(row.vendidos_7d),
      vendidos30d: number$5(row.vendidos_30d),
      promedioDiario: number$5(row.promedio_diario),
      stockBajo: number$5(row.stock_bajo_calculado),
      diasCobertura: row.dias_cobertura == null ? null : number$5(row.dias_cobertura),
      reposicion7d: number$5(row.reposicion_sugerida_7d),
      estado: text$5(row.estado) || "sin_datos",
      tieneHistorial: Boolean(row.tiene_historial),
      esBajo: row.estado === "bajo"
    };
  }
  function isOutOfStock(product) {
    return number$5(product.stock) <= 0;
  }
  function isLowStock(product, info) {
    const stock = number$5(product.stock);
    if (stock <= 0) return false;
    if (!info) return stock <= number$5(product.stockMinimo);
    return info.esBajo;
  }
  function smartStockText(product, info) {
    const stock = number$5(product.stock);
    if (!info) return `Stock actual: ${String(stock)}`;
    if (stock <= 0) return "Sin stock";
    if (!info.tieneHistorial) return "Sin historial suficiente de ventas";
    const days = info.diasCobertura == null ? "—" : `${info.diasCobertura.toFixed(1)} días`;
    return [
      `Stock bajo calculado: ≤ ${String(info.stockBajo)}`,
      `Venta estimada: ${info.promedioDiario.toFixed(2)}/día`,
      `Cobertura actual: ${days}`
    ].join(" · ");
  }
  const PRODUCT_CATALOG = [{ "nombre": "Coca-Cola Original 354 ml lata", "marca": "Coca-Cola", "presentacion": "354 ml lata", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Coca-Cola Original 500 ml", "marca": "Coca-Cola", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Coca-Cola Original 1,5 L", "marca": "Coca-Cola", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Coca-Cola Original 2,25 L", "marca": "Coca-Cola", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Coca-Cola Zero 354 ml lata", "marca": "Coca-Cola", "presentacion": "354 ml lata", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Coca-Cola Zero 500 ml", "marca": "Coca-Cola", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Coca-Cola Zero 1,5 L", "marca": "Coca-Cola", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Coca-Cola Zero 2,25 L", "marca": "Coca-Cola", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Sprite Original 354 ml lata", "marca": "Sprite", "presentacion": "354 ml lata", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Sprite Original 500 ml", "marca": "Sprite", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Sprite Original 1,5 L", "marca": "Sprite", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Sprite Original 2,25 L", "marca": "Sprite", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Fanta Naranja 500 ml", "marca": "Fanta", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Fanta Naranja 1,5 L", "marca": "Fanta", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Fanta Naranja 2,25 L", "marca": "Fanta", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pepsi Original 354 ml lata", "marca": "Pepsi", "presentacion": "354 ml lata", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pepsi Original 500 ml", "marca": "Pepsi", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pepsi Original 1,5 L", "marca": "Pepsi", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pepsi Original 2,25 L", "marca": "Pepsi", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pepsi Black 354 ml lata", "marca": "Pepsi", "presentacion": "354 ml lata", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pepsi Black 500 ml", "marca": "Pepsi", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pepsi Black 1,5 L", "marca": "Pepsi", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "7UP Original 500 ml", "marca": "7UP", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "7UP Original 1,5 L", "marca": "7UP", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "7UP Original 2,25 L", "marca": "7UP", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Mirinda Naranja 500 ml", "marca": "Mirinda", "presentacion": "500 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Mirinda Naranja 1,5 L", "marca": "Mirinda", "presentacion": "1,5 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Mirinda Naranja 2,25 L", "marca": "Mirinda", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Manaos Cola 600 ml", "marca": "Manaos", "presentacion": "600 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Manaos Cola 2,25 L", "marca": "Manaos", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Manaos Cola 3 L", "marca": "Manaos", "presentacion": "3 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Manaos Naranja 600 ml", "marca": "Manaos", "presentacion": "600 ml", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Manaos Naranja 2,25 L", "marca": "Manaos", "presentacion": "2,25 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Manaos Naranja 3 L", "marca": "Manaos", "presentacion": "3 L", "categoria": "Gaseosas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Villavicencio Sin gas 500 ml", "marca": "Villavicencio", "presentacion": "500 ml", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Villavicencio Sin gas 1,5 L", "marca": "Villavicencio", "presentacion": "1,5 L", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Villavicencio Sin gas 2 L", "marca": "Villavicencio", "presentacion": "2 L", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Villa del Sur Sin gas 500 ml", "marca": "Villa del Sur", "presentacion": "500 ml", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Villa del Sur Sin gas 1,5 L", "marca": "Villa del Sur", "presentacion": "1,5 L", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Villa del Sur Sin gas 2,25 L", "marca": "Villa del Sur", "presentacion": "2,25 L", "categoria": "Aguas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Levité Pomelo 500 ml", "marca": "Levité", "presentacion": "500 ml", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Levité Pomelo 1,5 L", "marca": "Levité", "presentacion": "1,5 L", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Levité Manzana 500 ml", "marca": "Levité", "presentacion": "500 ml", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Levité Manzana 1,5 L", "marca": "Levité", "presentacion": "1,5 L", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Aquarius Pomelo 500 ml", "marca": "Aquarius", "presentacion": "500 ml", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Aquarius Pomelo 1,5 L", "marca": "Aquarius", "presentacion": "1,5 L", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Aquarius Pera 500 ml", "marca": "Aquarius", "presentacion": "500 ml", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Aquarius Pera 1,5 L", "marca": "Aquarius", "presentacion": "1,5 L", "categoria": "Aguas saborizadas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Speed Unlimited 250 ml", "marca": "Speed", "presentacion": "250 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Speed Unlimited 473 ml", "marca": "Speed", "presentacion": "473 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Monster Energy 473 ml", "marca": "Monster", "presentacion": "473 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Monster Mango Loco 473 ml", "marca": "Monster", "presentacion": "473 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Monster Ultra 473 ml", "marca": "Monster", "presentacion": "473 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Red Bull Energy Drink 250 ml", "marca": "Red Bull", "presentacion": "250 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Red Bull Energy Drink 355 ml", "marca": "Red Bull", "presentacion": "355 ml", "categoria": "Energizantes", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Gatorade Manzana 500 ml", "marca": "Gatorade", "presentacion": "500 ml", "categoria": "Isotónicas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Gatorade Manzana 750 ml", "marca": "Gatorade", "presentacion": "750 ml", "categoria": "Isotónicas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Gatorade Cool Blue 500 ml", "marca": "Gatorade", "presentacion": "500 ml", "categoria": "Isotónicas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Gatorade Cool Blue 750 ml", "marca": "Gatorade", "presentacion": "750 ml", "categoria": "Isotónicas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cepita Naranja 200 ml", "marca": "Cepita", "presentacion": "200 ml", "categoria": "Jugos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cepita Naranja 1 L", "marca": "Cepita", "presentacion": "1 L", "categoria": "Jugos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Baggio Multifruta 200 ml", "marca": "Baggio", "presentacion": "200 ml", "categoria": "Jugos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Baggio Multifruta 1 L", "marca": "Baggio", "presentacion": "1 L", "categoria": "Jugos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Tang Naranja sobre", "marca": "Tang", "presentacion": "sobre", "categoria": "Jugos en polvo", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Tang Pomelo sobre", "marca": "Tang", "presentacion": "sobre", "categoria": "Jugos en polvo", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Clight Naranja sobre", "marca": "Clight", "presentacion": "sobre", "categoria": "Jugos en polvo", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Quilmes Clásica 473 ml lata", "marca": "Quilmes", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Quilmes Clásica 710 ml botella", "marca": "Quilmes", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Brahma Clásica 473 ml lata", "marca": "Brahma", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Brahma Clásica 710 ml botella", "marca": "Brahma", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Schneider Clásica 473 ml lata", "marca": "Schneider", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Schneider Clásica 710 ml botella", "marca": "Schneider", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Imperial Clásica 473 ml lata", "marca": "Imperial", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Imperial Clásica 710 ml botella", "marca": "Imperial", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Andes Origen Clásica 473 ml lata", "marca": "Andes Origen", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Andes Origen Clásica 710 ml botella", "marca": "Andes Origen", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Heineken Original 473 ml lata", "marca": "Heineken", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Heineken Original 710 ml botella", "marca": "Heineken", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Stella Artois Original 473 ml lata", "marca": "Stella Artois", "presentacion": "473 ml lata", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Stella Artois Original 710 ml botella", "marca": "Stella Artois", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Corona Extra 330 ml botella", "marca": "Corona", "presentacion": "330 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Corona Extra 710 ml botella", "marca": "Corona", "presentacion": "710 ml botella", "categoria": "Cervezas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Lay's Clásicas chica", "marca": "Lay's", "presentacion": "chica", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Lay's Clásicas mediana", "marca": "Lay's", "presentacion": "mediana", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Lay's Clásicas grande", "marca": "Lay's", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Lay's Jamón Serrano chica", "marca": "Lay's", "presentacion": "chica", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Lay's Jamón Serrano mediana", "marca": "Lay's", "presentacion": "mediana", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Lay's Jamón Serrano grande", "marca": "Lay's", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pehuamar Clásicas chica", "marca": "Pehuamar", "presentacion": "chica", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pehuamar Clásicas mediana", "marca": "Pehuamar", "presentacion": "mediana", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pehuamar Clásicas grande", "marca": "Pehuamar", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Krachitos Clásicas chica", "marca": "Krachitos", "presentacion": "chica", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Krachitos Clásicas mediana", "marca": "Krachitos", "presentacion": "mediana", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Krachitos Clásicas grande", "marca": "Krachitos", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Doritos Queso chico", "marca": "Doritos", "presentacion": "chico", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Doritos Queso mediano", "marca": "Doritos", "presentacion": "mediano", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Doritos Queso grande", "marca": "Doritos", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cheetos Queso chico", "marca": "Cheetos", "presentacion": "chico", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cheetos Queso mediano", "marca": "Cheetos", "presentacion": "mediano", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cheetos Queso grande", "marca": "Cheetos", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "3D Original chico", "marca": "3D", "presentacion": "chico", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "3D Original mediano", "marca": "3D", "presentacion": "mediano", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "3D Original grande", "marca": "3D", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Chizitos Queso chico", "marca": "Chizitos", "presentacion": "chico", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Chizitos Queso mediano", "marca": "Chizitos", "presentacion": "mediano", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Chizitos Queso grande", "marca": "Chizitos", "presentacion": "grande", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Maní Salado 50 g", "marca": "Maní", "presentacion": "50 g", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Maní Salado 100 g", "marca": "Maní", "presentacion": "100 g", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Maní Salado 250 g", "marca": "Maní", "presentacion": "250 g", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Palitos Salados 80 g", "marca": "Palitos", "presentacion": "80 g", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Palitos Salados 150 g", "marca": "Palitos", "presentacion": "150 g", "categoria": "Snacks", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Guaymallén Chocolate simple", "marca": "Guaymallén", "presentacion": "simple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Guaymallén Chocolate triple", "marca": "Guaymallén", "presentacion": "triple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Guaymallén Blanco simple", "marca": "Guaymallén", "presentacion": "simple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Guaymallén Blanco triple", "marca": "Guaymallén", "presentacion": "triple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Jorgito Chocolate simple", "marca": "Jorgito", "presentacion": "simple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Jorgelin Chocolate triple", "marca": "Jorgelin", "presentacion": "triple", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Terrabusi Tita unidad", "marca": "Terrabusi", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Terrabusi Rhodesia unidad", "marca": "Terrabusi", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Havanna Chocolate unidad", "marca": "Havanna", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Havanna 70% Cacao unidad", "marca": "Havanna", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cachafaz Chocolate unidad", "marca": "Cachafaz", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Rasta Negro unidad", "marca": "Rasta", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Rasta Blanco unidad", "marca": "Rasta", "presentacion": "unidad", "categoria": "Alfajores", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Milka Chocolate con leche 55 g", "marca": "Milka", "presentacion": "55 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Milka Chocolate con leche 100 g", "marca": "Milka", "presentacion": "100 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Milka Oreo 55 g", "marca": "Milka", "presentacion": "55 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Milka Oreo 100 g", "marca": "Milka", "presentacion": "100 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cofler Block 38 g", "marca": "Cofler", "presentacion": "38 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cofler Block 110 g", "marca": "Cofler", "presentacion": "110 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Águila Chocolate 60 g", "marca": "Águila", "presentacion": "60 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Shot Maní 35 g", "marca": "Shot", "presentacion": "35 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Shot Maní 90 g", "marca": "Shot", "presentacion": "90 g", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Bon o Bon Bombón unidad", "marca": "Bon o Bon", "presentacion": "unidad", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Bon o Bon Bombón pack x6", "marca": "Bon o Bon", "presentacion": "pack x6", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Ferrero Rocher Bombones pack x3", "marca": "Ferrero Rocher", "presentacion": "pack x3", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Ferrero Rocher Bombones pack x8", "marca": "Ferrero Rocher", "presentacion": "pack x8", "categoria": "Chocolates", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Beldent Menta pack", "marca": "Beldent", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Beldent Frutilla pack", "marca": "Beldent", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Topline Menta pack", "marca": "Topline", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Topline Seven pack", "marca": "Topline", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Halls Menta pack", "marca": "Halls", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Halls Strong pack", "marca": "Halls", "presentacion": "pack", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Mentos Menta rollo", "marca": "Mentos", "presentacion": "rollo", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Mentos Fruta rollo", "marca": "Mentos", "presentacion": "rollo", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Sugus Caramelos unidad", "marca": "Sugus", "presentacion": "unidad", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Sugus Caramelos bolsa", "marca": "Sugus", "presentacion": "bolsa", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Flynn Paff Caramelo unidad", "marca": "Flynn Paff", "presentacion": "unidad", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Chupetín Pico Dulce unidad", "marca": "Chupetín", "presentacion": "unidad", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Rocklets Confites 35 g", "marca": "Rocklets", "presentacion": "35 g", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Rocklets Confites 80 g", "marca": "Rocklets", "presentacion": "80 g", "categoria": "Golosinas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Oreo Original 118 g", "marca": "Oreo", "presentacion": "118 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Oreo Original 182 g", "marca": "Oreo", "presentacion": "182 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pepitos Chips 118 g", "marca": "Pepitos", "presentacion": "118 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pepitos Chips 357 g", "marca": "Pepitos", "presentacion": "357 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Chocolinas Chocolate 170 g", "marca": "Chocolinas", "presentacion": "170 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Chocolinas Chocolate 250 g", "marca": "Chocolinas", "presentacion": "250 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Sonrisas Frutilla 118 g", "marca": "Sonrisas", "presentacion": "118 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Merengadas Original 93 g", "marca": "Merengadas", "presentacion": "93 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Melitas Miel 170 g", "marca": "Melitas", "presentacion": "170 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Don Satur Bizcochos salados 200 g", "marca": "Don Satur", "presentacion": "200 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Don Satur Bizcochos dulces 200 g", "marca": "Don Satur", "presentacion": "200 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Criollitas Original 100 g", "marca": "Criollitas", "presentacion": "100 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Criollitas Original 300 g", "marca": "Criollitas", "presentacion": "300 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Maná Vainilla 145 g", "marca": "Maná", "presentacion": "145 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Terrabusi Variedad 300 g", "marca": "Terrabusi", "presentacion": "300 g", "categoria": "Galletitas", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Marlboro Box 20 unidades", "marca": "Marlboro", "presentacion": "20 unidades", "categoria": "Cigarrillos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 3 }, { "nombre": "Philip Morris Box 20 unidades", "marca": "Philip Morris", "presentacion": "20 unidades", "categoria": "Cigarrillos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 3 }, { "nombre": "Lucky Strike Box 20 unidades", "marca": "Lucky Strike", "presentacion": "20 unidades", "categoria": "Cigarrillos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 3 }, { "nombre": "Camel Box 20 unidades", "marca": "Camel", "presentacion": "20 unidades", "categoria": "Cigarrillos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 3 }, { "nombre": "Chesterfield Box 20 unidades", "marca": "Chesterfield", "presentacion": "20 unidades", "categoria": "Cigarrillos", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 3 }, { "nombre": "BIC Encendedor unidad", "marca": "BIC", "presentacion": "unidad", "categoria": "Accesorios", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pilas AA Alcalinas pack x2", "marca": "Pilas AA", "presentacion": "pack x2", "categoria": "Accesorios", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pilas AA Alcalinas pack x4", "marca": "Pilas AA", "presentacion": "pack x4", "categoria": "Accesorios", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pilas AAA Alcalinas pack x2", "marca": "Pilas AAA", "presentacion": "pack x2", "categoria": "Accesorios", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pilas AAA Alcalinas pack x4", "marca": "Pilas AAA", "presentacion": "pack x4", "categoria": "Accesorios", "catalogos": ["kiosco", "almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "La Serenísima Leche entera 1 L", "marca": "La Serenísima", "presentacion": "1 L", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "La Serenísima Leche descremada 1 L", "marca": "La Serenísima", "presentacion": "1 L", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Milkaut Leche entera 1 L", "marca": "Milkaut", "presentacion": "1 L", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Yogur Bebible 190 ml", "marca": "Yogur", "presentacion": "190 ml", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Yogur Bebible 900 ml", "marca": "Yogur", "presentacion": "900 ml", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Yogur Firme 120 g", "marca": "Yogur", "presentacion": "120 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Yogur Firme 190 g", "marca": "Yogur", "presentacion": "190 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Manteca 100 g", "marca": "Manteca", "presentacion": "100 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Manteca 200 g", "marca": "Manteca", "presentacion": "200 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Queso crema 190 g", "marca": "Queso crema", "presentacion": "190 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Queso crema 300 g", "marca": "Queso crema", "presentacion": "300 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Queso rallado 40 g", "marca": "Queso rallado", "presentacion": "40 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Queso rallado 120 g", "marca": "Queso rallado", "presentacion": "120 g", "categoria": "Lácteos", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Molinos Ala Arroz largo fino 500 g", "marca": "Molinos Ala", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Molinos Ala Arroz largo fino 1 kg", "marca": "Molinos Ala", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Gallo Arroz 500 g", "marca": "Gallo", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Gallo Arroz 1 kg", "marca": "Gallo", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Lucchetti Fideos Spaghetti 500 g", "marca": "Lucchetti", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Matarazzo Fideos Tallarín 500 g", "marca": "Matarazzo", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Matarazzo Fideos Tirabuzón 500 g", "marca": "Matarazzo", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Favorita Harina 000 1 kg", "marca": "Favorita", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pureza Harina 0000 1 kg", "marca": "Pureza", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Chango Azúcar 1 kg", "marca": "Chango", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Ledesma Azúcar 1 kg", "marca": "Ledesma", "presentacion": "1 kg", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Celusal Sal fina 500 g", "marca": "Celusal", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Dos Anclas Sal fina 500 g", "marca": "Dos Anclas", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Natura Aceite girasol 900 ml", "marca": "Natura", "presentacion": "900 ml", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Natura Aceite girasol 1,5 L", "marca": "Natura", "presentacion": "1,5 L", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cañuelas Aceite girasol 900 ml", "marca": "Cañuelas", "presentacion": "900 ml", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cañuelas Aceite girasol 1,5 L", "marca": "Cañuelas", "presentacion": "1,5 L", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "La Campagnola Puré de tomate 520 g", "marca": "La Campagnola", "presentacion": "520 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Arcor Puré de tomate 520 g", "marca": "Arcor", "presentacion": "520 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Arcor Choclo en lata 300 g", "marca": "Arcor", "presentacion": "300 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "La Campagnola Arvejas 300 g", "marca": "La Campagnola", "presentacion": "300 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Knorr Caldo pack", "marca": "Knorr", "presentacion": "pack", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Alicante Orégano 25 g", "marca": "Alicante", "presentacion": "25 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Alicante Pimentón 25 g", "marca": "Alicante", "presentacion": "25 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Playadito Yerba mate 500 g", "marca": "Playadito", "presentacion": "500 g", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Playadito Yerba mate 1 kg", "marca": "Playadito", "presentacion": "1 kg", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Taragüi Yerba mate 500 g", "marca": "Taragüi", "presentacion": "500 g", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Taragüi Yerba mate 1 kg", "marca": "Taragüi", "presentacion": "1 kg", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Rosamonte Yerba mate 500 g", "marca": "Rosamonte", "presentacion": "500 g", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Rosamonte Yerba mate 1 kg", "marca": "Rosamonte", "presentacion": "1 kg", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Amanda Yerba mate 500 g", "marca": "Amanda", "presentacion": "500 g", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Amanda Yerba mate 1 kg", "marca": "Amanda", "presentacion": "1 kg", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Mañanita Yerba mate 500 g", "marca": "Mañanita", "presentacion": "500 g", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Mañanita Yerba mate 1 kg", "marca": "Mañanita", "presentacion": "1 kg", "categoria": "Yerba", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "La Virginia Café molido 250 g", "marca": "La Virginia", "presentacion": "250 g", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "La Virginia Café molido 500 g", "marca": "La Virginia", "presentacion": "500 g", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Nescafé Café instantáneo 100 g", "marca": "Nescafé", "presentacion": "100 g", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Nescafé Café instantáneo 170 g", "marca": "Nescafé", "presentacion": "170 g", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "La Virginia Té 25 saquitos", "marca": "La Virginia", "presentacion": "25 saquitos", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "La Virginia Té 50 saquitos", "marca": "La Virginia", "presentacion": "50 saquitos", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cabrales Café molido 250 g", "marca": "Cabrales", "presentacion": "250 g", "categoria": "Infusiones", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Arcor Mermelada frutilla 454 g", "marca": "Arcor", "presentacion": "454 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Arcor Mermelada durazno 454 g", "marca": "Arcor", "presentacion": "454 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "La Serenísima Dulce de leche 400 g", "marca": "La Serenísima", "presentacion": "400 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "La Serenísima Dulce de leche 1 kg", "marca": "La Serenísima", "presentacion": "1 kg", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Nesquik Cacao 180 g", "marca": "Nesquik", "presentacion": "180 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Nesquik Cacao 360 g", "marca": "Nesquik", "presentacion": "360 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Quaker Avena 300 g", "marca": "Quaker", "presentacion": "300 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Quaker Avena 500 g", "marca": "Quaker", "presentacion": "500 g", "categoria": "Desayuno", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Magistral Detergente 300 ml", "marca": "Magistral", "presentacion": "300 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Magistral Detergente 500 ml", "marca": "Magistral", "presentacion": "500 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Magistral Detergente 750 ml", "marca": "Magistral", "presentacion": "750 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Ala Detergente 500 ml", "marca": "Ala", "presentacion": "500 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Ayudín Lavandina 1 L", "marca": "Ayudín", "presentacion": "1 L", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Ayudín Lavandina 2 L", "marca": "Ayudín", "presentacion": "2 L", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Ayudín Lavandina 4 L", "marca": "Ayudín", "presentacion": "4 L", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Poett Limpiador 900 ml", "marca": "Poett", "presentacion": "900 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cif Crema 375 ml", "marca": "Cif", "presentacion": "375 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Cif Crema 750 ml", "marca": "Cif", "presentacion": "750 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Skip Jabón líquido 800 ml", "marca": "Skip", "presentacion": "800 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Skip Jabón líquido 3 L", "marca": "Skip", "presentacion": "3 L", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Ala Jabón en polvo 400 g", "marca": "Ala", "presentacion": "400 g", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Ala Jabón en polvo 800 g", "marca": "Ala", "presentacion": "800 g", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Comfort Suavizante 900 ml", "marca": "Comfort", "presentacion": "900 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Vanish Quitamanchas 450 ml", "marca": "Vanish", "presentacion": "450 ml", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Virulana Esponja unidad", "marca": "Virulana", "presentacion": "unidad", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Patito Bolsas residuos pack", "marca": "Patito", "presentacion": "pack", "categoria": "Limpieza", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Colgate Pasta dental 70 g", "marca": "Colgate", "presentacion": "70 g", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Colgate Pasta dental 90 g", "marca": "Colgate", "presentacion": "90 g", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Oral-B Cepillo dental unidad", "marca": "Oral-B", "presentacion": "unidad", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Dove Jabón 90 g", "marca": "Dove", "presentacion": "90 g", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Rexona Desodorante aerosol 150 ml", "marca": "Rexona", "presentacion": "150 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Axe Desodorante aerosol 150 ml", "marca": "Axe", "presentacion": "150 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Sedal Shampoo 190 ml", "marca": "Sedal", "presentacion": "190 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Sedal Shampoo 340 ml", "marca": "Sedal", "presentacion": "340 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pantene Shampoo 200 ml", "marca": "Pantene", "presentacion": "200 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pantene Shampoo 400 ml", "marca": "Pantene", "presentacion": "400 ml", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Elite Papel higiénico pack x4", "marca": "Elite", "presentacion": "pack x4", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Elite Papel higiénico pack x6", "marca": "Elite", "presentacion": "pack x6", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Higienol Papel higiénico pack x4", "marca": "Higienol", "presentacion": "pack x4", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Sussex Rollo cocina pack x2", "marca": "Sussex", "presentacion": "pack x2", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Always Toallitas pack", "marca": "Always", "presentacion": "pack", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Gillette Máquina afeitar unidad", "marca": "Gillette", "presentacion": "unidad", "categoria": "Higiene", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Hellmann's Mayonesa 250 g", "marca": "Hellmann's", "presentacion": "250 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Hellmann's Mayonesa 500 g", "marca": "Hellmann's", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Natura Mayonesa 250 g", "marca": "Natura", "presentacion": "250 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Natura Mayonesa 500 g", "marca": "Natura", "presentacion": "500 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Savora Mostaza 250 g", "marca": "Savora", "presentacion": "250 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Danica Ketchup 250 g", "marca": "Danica", "presentacion": "250 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "La Campagnola Atún 170 g", "marca": "La Campagnola", "presentacion": "170 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Arcor Duraznos en lata 820 g", "marca": "Arcor", "presentacion": "820 g", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Dos Anclas Vinagre 500 ml", "marca": "Dos Anclas", "presentacion": "500 ml", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Dos Anclas Vinagre 1 L", "marca": "Dos Anclas", "presentacion": "1 L", "categoria": "Almacén", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pan Lactal chico", "marca": "Pan", "presentacion": "chico", "categoria": "Panadería", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pan Lactal grande", "marca": "Pan", "presentacion": "grande", "categoria": "Panadería", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Pan Hamburguesa pack", "marca": "Pan", "presentacion": "pack", "categoria": "Panadería", "catalogos": ["almacen", "minimercado"], "stockMinimo": 5 }, { "nombre": "Papas fritas Congeladas 400 g", "marca": "Papas fritas", "presentacion": "400 g", "categoria": "Congelados", "catalogos": ["minimercado"], "stockMinimo": 5 }, { "nombre": "Papas fritas Congeladas 1 kg", "marca": "Papas fritas", "presentacion": "1 kg", "categoria": "Congelados", "catalogos": ["minimercado"], "stockMinimo": 5 }, { "nombre": "Helado Pote 500 g", "marca": "Helado", "presentacion": "500 g", "categoria": "Helados", "catalogos": ["minimercado"], "stockMinimo": 5 }, { "nombre": "Helado Pote 1 kg", "marca": "Helado", "presentacion": "1 kg", "categoria": "Helados", "catalogos": ["minimercado"], "stockMinimo": 5 }, { "nombre": "Helado Palito unidad", "marca": "Helado", "presentacion": "unidad", "categoria": "Helados", "catalogos": ["minimercado"], "stockMinimo": 5 }];
  function parseCsvLine(line) {
    const cells = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index] ?? "";
      if (character === '"') {
        if (quoted && line[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === "," && !quoted) {
        cells.push(value.trim());
        value = "";
      } else {
        value += character;
      }
    }
    cells.push(value.trim());
    return cells;
  }
  function normalizeCsvHeader(value) {
    const text2 = typeof value === "string" || typeof value === "number" ? String(value) : "";
    return text2.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
  }
  function record$4(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }
  function records$4(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const parsed = record$4(item);
      return Object.keys(parsed).length ? [parsed] : [];
    });
  }
  function fail$1(error, fallback) {
    if (error) throw new Error(error.message ?? fallback);
  }
  function requireOk(data, fallback) {
    const parsed = record$4(data);
    if (parsed.ok !== true) {
      const message2 = typeof parsed.message === "string" ? parsed.message : fallback;
      throw new Error(message2);
    }
    return parsed;
  }
  async function listProducts(client, branchId) {
    const { data, error } = await client.rpc("listar_productos_sucursal_seguro_v1", {
      p_sucursal_id: branchId
    });
    fail$1(error, "No se pudieron cargar los productos de la sucursal");
    return records$4(data);
  }
  async function listCategories(client) {
    const { data, error } = await client.rpc("listar_categorias_seguras_v1");
    fail$1(error, "No se pudieron cargar las categorías");
    return records$4(data);
  }
  async function initializeCategories(client, names) {
    const { data, error } = await client.rpc("inicializar_categorias_seguras_v1", {
      p_nombres: [...names]
    });
    fail$1(error, "No se pudieron inicializar las categorías");
    return records$4(data);
  }
  async function saveCategory(client, name) {
    const { data, error } = await client.rpc("guardar_categoria_segura_v1", { p_nombre: name });
    fail$1(error, "No se pudo guardar la categoría");
    return requireOk(data, "No se pudo guardar la categoría");
  }
  async function deleteCategory(client, name) {
    const { data, error } = await client.rpc("eliminar_categoria_segura_v1", { p_nombre: name });
    fail$1(error, "No se pudo eliminar la categoría");
    return requireOk(data, "No se pudo eliminar la categoría");
  }
  async function saveProduct(client, input2) {
    const { data, error } = await client.rpc("guardar_producto_seguro_v2", {
      p_producto_id: input2.productId,
      p_sucursal_id: input2.branchId,
      p_nombre: input2.name,
      p_marca: input2.brand,
      p_presentacion: input2.presentation,
      p_codigo_barras: input2.barcode,
      p_categoria: input2.category,
      p_precio_compra: input2.purchasePrice,
      p_precio_venta: input2.salePrice,
      p_stock: input2.stock
    });
    fail$1(error, "No se pudo guardar el producto");
    const parsed = requireOk(data, "No se pudo guardar el producto");
    const product = record$4(parsed.producto);
    if (!Object.keys(product).length) throw new Error("No se pudo guardar el producto");
    return product;
  }
  async function deleteProduct(client, productId) {
    const { data, error } = await client.rpc("eliminar_producto_seguro_v1", {
      p_producto_id: productId
    });
    fail$1(error, "No se pudo eliminar el producto");
    return requireOk(data, "No se pudo eliminar el producto");
  }
  async function deleteAllProducts(client) {
    const { data, error } = await client.rpc("eliminar_todos_productos_seguro_v1");
    fail$1(error, "No se pudieron eliminar los productos");
    return requireOk(data, "No se pudieron eliminar los productos");
  }
  async function adjustInitialStock(client, productId, branchId, delta) {
    const { data, error } = await client.rpc("ajustar_stock_inicial_rapido_v2", {
      p_producto_id: productId,
      p_sucursal_id: branchId,
      p_delta: delta > 0 ? 1 : -1
    });
    fail$1(error, "No se pudo modificar el stock");
    return record$4(data);
  }
  async function listSmartStock(client, branchId) {
    const { data, error } = await client.rpc("obtener_stock_inteligente_sucursal", {
      p_sucursal_id: branchId
    });
    fail$1(error, "Stock inteligente no disponible");
    return records$4(data);
  }
  async function confirmScannedStock(client, productId, branchId, requiredStock) {
    const { data, error } = await client.rpc("confirmar_stock_por_scanner_v2", {
      p_producto_id: productId,
      p_sucursal_id: branchId,
      p_stock_minimo_necesario: requiredStock
    });
    fail$1(error, "No se pudo confirmar la unidad escaneada");
    return record$4(data);
  }
  async function importCatalog(client, branchId, items) {
    const { data, error } = await client.rpc("importar_productos_seguro_v1", {
      p_sucursal_id: branchId,
      p_items: items.map((item) => ({
        nombre: item.nombre,
        marca: item.marca,
        presentacion: item.presentacion,
        categoria: item.categoria
      }))
    });
    fail$1(error, "No se pudo importar el catálogo");
    return requireOk(data, "No se pudo importar el catálogo");
  }
  async function importBulkCatalog(client, branchId, items) {
    const { data, error } = await client.rpc("importar_productos_masivo_v1", {
      p_sucursal_id: branchId,
      p_items: items.map((item) => ({ ...item }))
    });
    fail$1(error, "No se pudo importar el catálogo");
    return requireOk(data, "No se pudo importar el catálogo");
  }
  const DEFAULT_CATEGORIES = [
    "Bebidas",
    "Golosinas",
    "Snacks",
    "Cigarrillos",
    "Lácteos",
    "Panadería",
    "Helados",
    "Limpieza",
    "Útiles",
    "Otros"
  ];
  function field$5(selector) {
    const element2 = queryOne(selector);
    return element2 instanceof HTMLInputElement || element2 instanceof HTMLSelectElement || element2 instanceof HTMLTextAreaElement ? element2 : null;
  }
  function text$4(value) {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  }
  function number$4(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function nullableText(value) {
    const normalized = (value == null ? void 0 : value.trim()) ?? "";
    return normalized ? normalized : null;
  }
  function errorMessage$7(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  function setText$1(selector, value) {
    const element2 = queryOne(selector);
    if (element2) element2.textContent = String(value);
  }
  function setValue$1(selector, value) {
    const element2 = field$5(selector);
    if (element2) element2.value = String(value);
  }
  function mapExternalCategory(categories) {
    const normalized = categories.toLowerCase();
    if (normalized.includes("beer") || normalized.includes("cerve")) return "Cervezas";
    if (normalized.includes("soda") || normalized.includes("gase")) return "Gaseosas";
    if (normalized.includes("water") || normalized.includes("agua")) return "Aguas";
    if (normalized.includes("chocolate")) return "Chocolates";
    if (normalized.includes("snack") || normalized.includes("chip")) return "Snacks";
    if (normalized.includes("biscuit") || normalized.includes("cookie") || normalized.includes("gallet")) {
      return "Galletitas";
    }
    if (normalized.includes("dairy") || normalized.includes("milk") || normalized.includes("láct")) {
      return "Lácteos";
    }
    return "Otros";
  }
  function createProductsController(dependencies) {
    let smartStock = /* @__PURE__ */ new Map();
    let legacyLowStockFilter = false;
    let catalogKind = "kiosco";
    let catalogSelection = /* @__PURE__ */ new Set();
    const stockQueue = /* @__PURE__ */ new Map();
    let setupComplete = false;
    function products() {
      return dependencies.getProducts();
    }
    function categories() {
      return dependencies.getCategories();
    }
    function getSmartStock(product) {
      const id = text$4(product.id);
      return id ? smartStock.get(id) ?? null : null;
    }
    function productIsLow(product) {
      return isLowStock(product, getSmartStock(product));
    }
    async function loadSmartStock() {
      smartStock = /* @__PURE__ */ new Map();
      const branchId = dependencies.getBranch().id;
      if (!branchId) return;
      try {
        const rows = await listSmartStock(dependencies.client, branchId);
        rows.forEach((row) => {
          const productId = text$4(row.producto_id);
          if (productId) smartStock.set(productId, mapSmartStockRow(row));
        });
      } catch (error) {
        console.warn("[Vendify] Stock inteligente no disponible:", errorMessage$7(error, "Sin datos"));
      }
    }
    async function loadProducts() {
      const branchId = dependencies.getBranch().id;
      if (!branchId) {
        dependencies.setProducts([]);
        return;
      }
      try {
        const rows = await listProducts(dependencies.client, branchId);
        const mapped = rows.map(mapProductRow);
        dependencies.setProducts(mapped);
        await dependencies.captureOfflineStockSnapshot(mapped);
        dependencies.saveProductsOffline();
        await loadSmartStock();
        dependencies.refreshOnboarding();
      } catch (error) {
        console.error("[V2.26] Error cargando productos de sucursal:", error);
        if (!navigator.onLine && dependencies.loadProductsOffline()) {
          dependencies.showToast("Sin conexión · mostrando el último catálogo guardado", "info");
          return;
        }
        dependencies.showToast("No se pudieron cargar los productos de la sucursal", "error");
        dependencies.setProducts([]);
      }
    }
    async function initializeDefaultCategories() {
      try {
        const rows = await initializeCategories(dependencies.client, DEFAULT_CATEGORIES);
        const names = rows.map((row) => text$4(row.nombre)).filter(Boolean);
        dependencies.setCategories(names.length ? names : [...DEFAULT_CATEGORIES]);
        dependencies.saveCategoriesOffline();
      } catch (error) {
        console.error("[Security] categorías iniciales:", error);
        dependencies.setCategories([...DEFAULT_CATEGORIES]);
      }
    }
    async function loadCategories() {
      try {
        const rows = await listCategories(dependencies.client);
        const names = rows.map((row) => text$4(row.nombre)).filter(Boolean);
        if (!names.length) await initializeDefaultCategories();
        else dependencies.setCategories(names);
        dependencies.saveCategoriesOffline();
      } catch (error) {
        console.error("[Security] categorías:", error);
        if (!navigator.onLine && dependencies.loadCategoriesOffline()) return;
        dependencies.setCategories([...DEFAULT_CATEGORIES]);
      }
    }
    function renderCategorySelect(selected = "") {
      const select = field$5("#categoria");
      if (!(select instanceof HTMLSelectElement)) return;
      select.innerHTML = '<option value="">Sin categoría</option>';
      categories().forEach((category) => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        option.selected = category === selected;
        select.appendChild(option);
      });
    }
    function renderCategoryFilter() {
      const select = field$5("#filtro-categoria");
      if (!(select instanceof HTMLSelectElement)) return;
      const current = select.value;
      const used = [.../* @__PURE__ */ new Set([
        ...categories(),
        ...products().map((product) => product.categoria).filter(Boolean)
      ])].sort((a, b) => a.localeCompare(b, "es"));
      select.innerHTML = '<option value="">Todas las categorías</option>';
      used.forEach((category) => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
      });
      if (used.includes(current)) select.value = current;
    }
    function renderCategoryList() {
      const list = queryOne("#lista-categorias-config");
      if (!list) return;
      if (!categories().length) {
        list.innerHTML = '<li style="justify-content:center;color:var(--text-muted);">No hay categorías. Agregá una.</li>';
        return;
      }
      list.innerHTML = categories().map((category, index) => `
      <li>
        <span>${escapeHtml(category)}</span>
        <button type="button" class="btn-icon danger" data-cat-index="${String(index)}" title="Eliminar">🗑️</button>
      </li>`).join("");
    }
    async function addCategory() {
      if (!dependencies.requirePermission("manageProducts", "No tenés permiso para administrar categorías")) return;
      const input2 = field$5("#nueva-categoria");
      if (!(input2 instanceof HTMLInputElement)) return;
      const name = input2.value.trim();
      if (!name) {
        dependencies.showToast("Escribí un nombre de categoría", "error");
        return;
      }
      if (categories().some((category) => category.toLowerCase() === name.toLowerCase())) {
        dependencies.showToast("Esa categoría ya existe", "error");
        return;
      }
      try {
        await saveCategory(dependencies.client, name);
        dependencies.setCategories([...categories(), name].sort((a, b) => a.localeCompare(b, "es")));
        renderCategoryList();
        renderCategoryFilter();
        input2.value = "";
        input2.focus();
        dependencies.showToast(`Categoría "${name}" agregada`, "success");
      } catch (error) {
        dependencies.showToast(errorMessage$7(error, "No se pudo guardar la categoría"), "error");
      }
    }
    async function removeCategory(index) {
      if (!dependencies.requirePermission("manageProducts", "No tenés permiso para administrar categorías")) return;
      const name = categories()[index];
      if (!name) return;
      const inUse = products().some((product) => product.categoria === name);
      const message2 = inUse ? `La categoría "${name}" está en uso. ¿La eliminás igual? Los productos quedan sin categoría.` : `¿Eliminar la categoría "${name}"?`;
      if (!await dependencies.confirm("Eliminar categoría", message2)) return;
      try {
        await deleteCategory(dependencies.client, name);
        if (inUse) {
          dependencies.setProducts(products().map(
            (product) => product.categoria === name ? { ...product, categoria: "" } : product
          ));
        }
        dependencies.setCategories(categories().filter((_, current) => current !== index));
        renderCategoryList();
        renderCategoryFilter();
        render();
        dependencies.showToast("Categoría eliminada", "success");
      } catch (error) {
        dependencies.showToast(errorMessage$7(error, "No se pudo eliminar la categoría"), "error");
      }
    }
    function updateQuickFilterUi() {
      var _a, _b, _c, _d;
      const value = ((_a = field$5("#filtro-stock-v29")) == null ? void 0 : _a.value) ?? "";
      (_b = queryOne("#stat-bajo-card")) == null ? void 0 : _b.classList.toggle("active", legacyLowStockFilter || value === "bajo");
      (_c = queryOne("#stat-sin-card")) == null ? void 0 : _c.classList.toggle("active", value === "sin");
      const active = legacyLowStockFilter || value === "bajo" || value === "sin";
      (_d = queryOne("#filtro-activo")) == null ? void 0 : _d.classList.toggle("hidden", !active);
      setText$1(
        "#filtro-activo-texto",
        value === "sin" ? "Mostrando productos sin stock" : "Mostrando productos con stock bajo inteligente"
      );
    }
    function filteredProducts() {
      var _a, _b, _c, _d;
      const search = (((_a = field$5("#buscador")) == null ? void 0 : _a.value) ?? "").trim().toLowerCase();
      const category = ((_b = field$5("#filtro-categoria")) == null ? void 0 : _b.value) ?? "";
      const stockFilter = ((_c = field$5("#filtro-stock-v29")) == null ? void 0 : _c.value) ?? "";
      const [sortField = "nombre", direction = "asc"] = (((_d = field$5("#orden")) == null ? void 0 : _d.value) ?? "nombre-asc").split("-");
      const result = products().filter((product) => {
        const haystack = [
          product.nombre,
          product.marca,
          product.presentacion,
          product.codigoBarras,
          product.categoria
        ].filter(Boolean).join(" ").toLowerCase();
        const low = productIsLow(product);
        const out = isOutOfStock(product);
        return (!search || haystack.includes(search)) && (!category || product.categoria === category) && (!legacyLowStockFilter || low) && (!stockFilter || stockFilter === "bajo" && low || stockFilter === "sin" && out);
      });
      result.sort((a, b) => {
        const leftValue = a[sortField];
        const rightValue = b[sortField];
        const left = typeof leftValue === "string" ? leftValue.toLowerCase() : number$4(leftValue);
        const right = typeof rightValue === "string" ? rightValue.toLowerCase() : number$4(rightValue);
        if (left < right) return direction === "asc" ? -1 : 1;
        if (left > right) return direction === "asc" ? 1 : -1;
        return 0;
      });
      return result;
    }
    function render() {
      const grid = queryOne("#productos-grid");
      if (!grid) return;
      const productList = products();
      const visible = filteredProducts();
      const canManage = dependencies.hasPermission("manageProducts");
      const canAdjust = dependencies.hasPermission("adjustStock");
      const canViewCosts = dependencies.hasPermission("viewCosts");
      const totalStock = productList.reduce((sum, product) => sum + number$4(product.stock), 0);
      const totalCost = productList.reduce(
        (sum, product) => sum + number$4(product.stock) * number$4(product.precioCompra),
        0
      );
      const totalSale = productList.reduce(
        (sum, product) => sum + number$4(product.stock) * number$4(product.precioVenta),
        0
      );
      setText$1("#stat-productos", productList.length);
      setText$1("#stat-stock", totalStock);
      setText$1("#stat-costo", canViewCosts ? dependencies.formatPrice(totalCost) : "—");
      setText$1("#stat-venta", dependencies.formatPrice(totalSale));
      setText$1("#stat-bajo", productList.filter(productIsLow).length);
      setText$1("#stat-sin", productList.filter(isOutOfStock).length);
      const empty = queryOne("#empty-state");
      const noResults = queryOne("#no-results");
      if (!productList.length) {
        grid.innerHTML = "";
        empty == null ? void 0 : empty.classList.toggle("hidden", !canManage);
        noResults == null ? void 0 : noResults.classList.add("hidden");
        return;
      }
      empty == null ? void 0 : empty.classList.add("hidden");
      if (!visible.length) {
        grid.innerHTML = "";
        noResults == null ? void 0 : noResults.classList.remove("hidden");
        return;
      }
      noResults == null ? void 0 : noResults.classList.add("hidden");
      grid.innerHTML = visible.map((product) => {
        const low = productIsLow(product);
        const stock = number$4(product.stock);
        const stockClass = stock === 0 ? "stock-zero-v29" : low ? "stock-low-v29" : "";
        const label = productLabel(product);
        const initial = (product.marca || product.nombre || "P").slice(0, 1).toUpperCase();
        const category = product.categoria || "Sin categoría";
        const stockHtml = canAdjust ? `<div class="row-stock-actions-v29" title="${escapeHtml(smartStockText(product, getSmartStock(product)))}">
            <button data-action="restar" aria-label="Restar stock">−</button>
            <button class="stock-number-v29 ${stockClass}" data-action="ajustar">${String(stock)}</button>
            <button data-action="sumar" aria-label="Sumar stock">+</button>
          </div>` : `<strong class="stock-number-v29 ${stockClass}" title="${escapeHtml(smartStockText(product, getSmartStock(product)))}">${String(stock)}</strong>`;
        const actions = canManage ? '<div class="row-actions-v29"><button class="btn btn-ghost btn-sm" data-action="editar">Editar</button><button class="btn-icon danger" data-action="eliminar" title="Eliminar" aria-label="Eliminar">🗑</button></div>' : "";
        return `
        <article class="producto-card producto-row-v29 producto-row-v223" data-id="${escapeHtml(product.id)}"
          data-mobile-editable="${canManage ? "true" : "false"}"
          ${canManage ? `tabindex="0" role="button" aria-label="Editar ${escapeHtml(label)}"` : ""}>
          <div class="producto-v223-media">${product.foto ? `<img src="${escapeHtml(product.foto)}" alt="" class="producto-v223-img">` : `<div class="producto-v223-icon">${escapeHtml(initial)}</div>`}</div>
          <div class="producto-v223-info"><strong class="producto-v223-nombre">${escapeHtml(label)}</strong>
            <small class="producto-v223-categoria">${escapeHtml(category)}</small></div>
          <div class="producto-v223-stock">${stockHtml}</div>
          <div class="producto-v223-precio"><strong>${dependencies.formatPrice(product.precioVenta)}</strong>${canViewCosts ? `<small>Costo ${dependencies.formatPrice(product.precioCompra)}</small>` : ""}</div>
          <div class="producto-v223-acciones">${actions}</div>
        </article>`;
      }).join("");
      dependencies.applyPermissions();
    }
    function updateSmartStockForm(product) {
      if (!product) {
        setText$1("#stock-smart-form-value", "Se calculará según las ventas");
        setText$1("#stock-smart-form-hint", "Cuando el producto tenga historial, Vendify calculará su umbral automáticamente.");
        return;
      }
      const info = getSmartStock(product);
      if (!(info == null ? void 0 : info.tieneHistorial)) {
        setText$1("#stock-smart-form-value", "Todavía sin historial");
        setText$1("#stock-smart-form-hint", "El umbral aparecerá cuando existan ventas suficientes del producto.");
        return;
      }
      setText$1("#stock-smart-form-value", `≤ ${String(info.stockBajo)} unidades`);
      const days = info.diasCobertura == null ? "—" : `${info.diasCobertura.toFixed(1)} días`;
      setText$1(
        "#stock-smart-form-hint",
        `${info.promedioDiario.toFixed(2)} unidades/día · cobertura actual ${days}`
      );
    }
    function openEditor(product = null) {
      if (!dependencies.requirePermission("manageProducts", "No tenés permiso para modificar productos")) return;
      const mapped = product ? product : null;
      const editingId = (mapped == null ? void 0 : mapped.id) ?? null;
      dependencies.setEditingProductId(editingId);
      dependencies.setCurrentPhoto((mapped == null ? void 0 : mapped.foto) ?? null);
      setText$1("#modal-titulo", mapped ? "Editar producto" : "Nuevo producto");
      setText$1("#producto-branch-hint-v226", `Stock de sucursal: ${dependencies.getBranch().name || "—"}`);
      setValue$1("#producto-id", editingId ?? "");
      setValue$1("#nombre", (mapped == null ? void 0 : mapped.nombre) ?? "");
      setValue$1("#marca", (mapped == null ? void 0 : mapped.marca) ?? "");
      setValue$1("#presentacion", (mapped == null ? void 0 : mapped.presentacion) ?? "");
      setValue$1("#codigo-barras", (mapped == null ? void 0 : mapped.codigoBarras) ?? "");
      setValue$1("#precio-compra", (mapped == null ? void 0 : mapped.precioCompra) ?? "");
      setValue$1("#precio-venta", (mapped == null ? void 0 : mapped.precioVenta) ?? "");
      setValue$1("#stock", (mapped == null ? void 0 : mapped.stock) ?? 0);
      setValue$1("#stock-minimo", 0);
      const stock = field$5("#stock");
      if (stock instanceof HTMLInputElement) {
        stock.disabled = !dependencies.hasPermission("adjustStock");
        stock.title = stock.disabled ? "El propietario no habilitó la modificación manual de stock" : "";
      }
      updateSmartStockForm(mapped);
      setText$1("#error-nombre", "");
      setText$1("#barcode-status-v29", "");
      renderCategorySelect((mapped == null ? void 0 : mapped.categoria) ?? "");
      const modal = queryOne("#modal");
      const content = modal == null ? void 0 : modal.querySelector(".modal-content");
      modal == null ? void 0 : modal.classList.remove("hidden");
      requestAnimationFrame(() => {
        if (content instanceof HTMLElement) content.scrollTop = 0;
        const initial = field$5(mapped ? "#nombre" : "#marca");
        try {
          initial == null ? void 0 : initial.focus({ preventScroll: true });
        } catch {
          initial == null ? void 0 : initial.focus();
        }
        if (content instanceof HTMLElement) content.scrollTop = 0;
      });
    }
    function closeEditor(preserveScannerFlow = false) {
      var _a;
      (_a = queryOne("#modal")) == null ? void 0 : _a.classList.add("hidden");
      const form = queryOne("#form-producto");
      if (form instanceof HTMLFormElement) form.reset();
      dependencies.setEditingProductId(null);
      dependencies.setCurrentPhoto(null);
      dependencies.restoreSaleBehindProduct(!preserveScannerFlow);
      if (!preserveScannerFlow) dependencies.clearPendingScannerProduct();
    }
    async function submitProduct(event) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i;
      event.preventDefault();
      if (!dependencies.requirePermission("manageProducts", "No tenés permiso para modificar productos")) return;
      const branch = dependencies.getBranch();
      if (!branch.id) {
        dependencies.showToast("Seleccioná una sucursal antes de guardar", "error");
        return;
      }
      const name = ((_a = field$5("#nombre")) == null ? void 0 : _a.value.trim()) ?? "";
      const barcode = ((_b = field$5("#codigo-barras")) == null ? void 0 : _b.value.trim()) ?? "";
      const editingId = dependencies.getEditingProductId();
      if (!name) {
        setText$1("#error-nombre", "El nombre es obligatorio");
        return;
      }
      const duplicate = barcode && products().find(
        (product) => product.codigoBarras === barcode && product.id !== editingId
      );
      if (duplicate) {
        dependencies.showToast(`Ese código ya pertenece a "${duplicate.nombre}"`, "error");
        return;
      }
      const button2 = queryOne("#btn-guardar");
      if (button2 instanceof HTMLButtonElement) button2.disabled = true;
      try {
        const row = await saveProduct(dependencies.client, {
          productId: editingId,
          branchId: branch.id,
          name,
          brand: nullableText((_c = field$5("#marca")) == null ? void 0 : _c.value),
          presentation: nullableText((_d = field$5("#presentacion")) == null ? void 0 : _d.value),
          barcode: nullableText(barcode),
          category: nullableText((_e = field$5("#categoria")) == null ? void 0 : _e.value),
          purchasePrice: Math.max(0, Number.parseFloat(((_f = field$5("#precio-compra")) == null ? void 0 : _f.value) ?? "") || 0),
          salePrice: Math.max(0, Number.parseFloat(((_g = field$5("#precio-venta")) == null ? void 0 : _g.value) ?? "") || 0),
          stock: Math.max(0, Number.parseInt(((_h = field$5("#stock")) == null ? void 0 : _h.value) ?? "", 10) || 0)
        });
        const mapped = mapProductRow(row);
        const editing = Boolean(editingId);
        if (editing) {
          dependencies.setProducts(products().map((product) => product.id === editingId ? mapped : product));
        } else dependencies.setProducts([...products(), mapped]);
        await loadSmartStock();
        renderCategoryFilter();
        render();
        const returnToSale = !editing && dependencies.shouldReturnCreatedProductToSale();
        closeEditor(returnToSale);
        if (returnToSale) {
          dependencies.clearPendingScannerProduct();
          (_i = queryOne("#modal-venta")) == null ? void 0 : _i.classList.remove("hidden");
          dependencies.restoreSaleBehindProduct(false);
          dependencies.addToCart(mapped.id);
          dependencies.renderSaleProducts();
          dependencies.renderCart();
          setTimeout(() => {
            var _a2;
            return (_a2 = field$5("#venta-buscador")) == null ? void 0 : _a2.focus();
          }, 80);
          dependencies.showToast(`${mapped.nombre} registrado en ${branch.name} y agregado a la venta`, "success");
          return;
        }
        dependencies.showToast(
          editing ? `Producto actualizado en ${branch.name}` : `Producto agregado a ${branch.name}`,
          "success"
        );
      } catch (error) {
        dependencies.showToast(errorMessage$7(error, "No se pudo guardar el producto"), "error");
      } finally {
        if (button2 instanceof HTMLButtonElement) button2.disabled = false;
      }
    }
    async function removeProduct(productId) {
      if (!["owner", "admin", "manager"].includes(dependencies.getRole())) {
        dependencies.showToast("Tu rol no permite eliminar productos", "error");
        return;
      }
      if (!dependencies.requirePermission("manageProducts", "No tenés permiso para eliminar productos")) return;
      const product = products().find((candidate) => candidate.id === productId);
      if (!product) return;
      if (!await dependencies.confirm(
        "Eliminar producto",
        `¿Seguro que querés eliminar "${product.nombre}"? Esta acción no se puede deshacer.`
      )) return;
      try {
        await deleteProduct(dependencies.client, productId);
        dependencies.setProducts(products().filter((candidate) => candidate.id !== productId));
        renderCategoryFilter();
        render();
        dependencies.showToast("Producto eliminado", "success");
      } catch (error) {
        dependencies.showToast(errorMessage$7(error, "No se pudo eliminar el producto"), "error");
      }
    }
    async function removeAllProducts() {
      if (!["owner", "admin"].includes(dependencies.getRole())) {
        dependencies.showToast("Solo propietario o administrador pueden eliminar todos los productos", "error");
        return;
      }
      if (!products().length) {
        dependencies.showToast("No hay productos para eliminar", "info");
        return;
      }
      const amount = products().length;
      if (!await dependencies.confirm(
        "Eliminar todos los productos",
        `Vas a eliminar ${String(amount)} productos del negocio. Esta acción no se puede deshacer.`
      )) return;
      if (!await dependencies.confirm(
        "Confirmación final",
        `¿Realmente querés eliminar los ${String(amount)} productos? Las ventas históricas no deberían borrarse, pero el catálogo actual quedará vacío.`
      )) return;
      const button2 = queryOne("#btn-eliminar-todos-productos");
      if (button2 instanceof HTMLButtonElement) {
        button2.disabled = true;
        button2.textContent = "Eliminando...";
      }
      try {
        await deleteAllProducts(dependencies.client);
        dependencies.setProducts([]);
        renderCategoryFilter();
        render();
        dependencies.showToast(`${String(amount)} productos eliminados`, "success");
      } catch (error) {
        console.error("[Vendify Security] Error eliminando productos:", error);
        dependencies.showToast(errorMessage$7(error, "No se pudieron eliminar los productos"), "error");
      } finally {
        if (button2 instanceof HTMLButtonElement) {
          button2.disabled = false;
          button2.textContent = "🗑 Eliminar todos";
        }
      }
    }
    async function executeStockChange(productId, delta) {
      if (!dependencies.requirePermission(
        "adjustStock",
        "El propietario no habilitó la modificación manual de stock para tu usuario"
      )) return;
      const product = products().find((candidate) => candidate.id === productId);
      const branchId = dependencies.getBranch().id;
      if (!product || !branchId) return;
      if (delta < 0 && number$4(product.stock) <= 0) {
        dependencies.showToast(`"${product.nombre}" ya está en stock 0`, "info");
        return;
      }
      try {
        const data = await adjustInitialStock(dependencies.client, productId, branchId, delta);
        if (data.requiere_motivo) {
          dependencies.openInventoryAdjustment(productId, delta);
          return;
        }
        product.stock = number$4(data.stock ?? number$4(product.stock) + delta);
        dependencies.emitStockChange("stock_inicial");
        render();
        dependencies.scheduleSmartRefresh();
        if (dependencies.isSaleOpen()) {
          dependencies.renderSaleProducts();
          dependencies.renderCart();
        }
      } catch (error) {
        dependencies.showToast(errorMessage$7(error, "No se pudo modificar el stock"), "error");
      }
    }
    function changeStock(productId, delta) {
      const previous = stockQueue.get(productId) ?? Promise.resolve();
      const next = previous.catch(() => void 0).then(() => executeStockChange(productId, delta)).finally(() => {
        if (stockQueue.get(productId) === next) stockQueue.delete(productId);
      });
      stockQueue.set(productId, next);
      return next;
    }
    async function ensureCategory(name) {
      if (!name || categories().includes(name)) return;
      try {
        await saveCategory(dependencies.client, name);
        dependencies.setCategories([...categories(), name].sort((a, b) => a.localeCompare(b, "es")));
        renderCategoryFilter();
      } catch {
      }
    }
    async function lookupBarcode(code) {
      var _a, _b, _c, _d, _e;
      const normalized = code.trim();
      if (!normalized) return null;
      setText$1("#barcode-status-v29", "Buscando datos del producto...");
      try {
        const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(normalized)}.json?fields=code,product_name,brands,quantity,categories`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Consulta no disponible");
        const payload = await response.json();
        const product = typeof payload.product === "object" && payload.product !== null ? payload.product : null;
        if (payload.status !== 1 || !product) {
          setText$1("#barcode-status-v29", "Código no encontrado. Podés completar los datos manualmente.");
          return null;
        }
        const brand = ((_a = text$4(product.brands).split(",")[0]) == null ? void 0 : _a.trim()) ?? "";
        const name = text$4(product.product_name).trim();
        const quantity = text$4(product.quantity).trim();
        if (!((_b = field$5("#marca")) == null ? void 0 : _b.value)) setValue$1("#marca", brand);
        if (!((_c = field$5("#presentacion")) == null ? void 0 : _c.value)) setValue$1("#presentacion", quantity);
        if (!((_d = field$5("#nombre")) == null ? void 0 : _d.value)) {
          setValue$1("#nombre", [brand, name, quantity].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
        }
        const localCategory = mapExternalCategory(text$4(product.categories));
        if (!((_e = field$5("#categoria")) == null ? void 0 : _e.value)) {
          await ensureCategory(localCategory);
          renderCategorySelect(localCategory);
        }
        setText$1("#barcode-status-v29", "Datos encontrados. Revisalos y completá precio/stock.");
        return product;
      } catch (error) {
        console.warn("OpenFoodFacts", error);
        setText$1("#barcode-status-v29", "No pudimos consultar la base externa. El código quedó cargado.");
        return null;
      }
    }
    function catalogItems() {
      return PRODUCT_CATALOG.filter((item) => item.catalogos.includes(catalogKind));
    }
    function renderCatalog() {
      var _a;
      queryAll(".catalog-tab-v29").forEach((button2) => {
        button2.classList.toggle("active", button2.getAttribute("data-catalog") === catalogKind);
      });
      const search = (((_a = field$5("#catalog-search-v29")) == null ? void 0 : _a.value) ?? "").trim().toLowerCase();
      const existing = new Set(products().map((product) => product.nombre.toLowerCase()));
      const visible = catalogItems().filter(
        (item) => !search || [item.nombre, item.marca, item.presentacion, item.categoria].join(" ").toLowerCase().includes(search)
      );
      const list = queryOne("#catalog-list-v29");
      if (list) {
        list.innerHTML = visible.map((item) => {
          const exists = existing.has(item.nombre.toLowerCase());
          return `<label class="catalog-row-v29 ${exists ? "already-v29" : ""}">
          <input type="checkbox" data-catalog-name="${escapeHtml(item.nombre)}" ${catalogSelection.has(item.nombre) && !exists ? "checked" : ""} ${exists ? "disabled" : ""}>
          <span><strong>${escapeHtml(item.nombre)}</strong><small>${escapeHtml(item.categoria)}${exists ? " · ya cargado" : ""}</small></span></label>`;
        }).join("");
      }
      setText$1(
        "#catalog-selected-count-v29",
        [...catalogSelection].filter((name) => !existing.has(name.toLowerCase())).length
      );
    }
    function openCatalog() {
      var _a;
      if (!dependencies.requirePermission("manageProducts", "No tenés permiso para cargar catálogos")) return;
      catalogKind = "kiosco";
      catalogSelection = new Set(catalogItems().map((item) => item.nombre));
      setValue$1("#catalog-search-v29", "");
      (_a = queryOne("#modal-catalogo-v29")) == null ? void 0 : _a.classList.remove("hidden");
      renderCatalog();
    }
    function closeCatalog() {
      var _a;
      (_a = queryOne("#modal-catalogo-v29")) == null ? void 0 : _a.classList.add("hidden");
    }
    async function submitCatalog() {
      const branchId = dependencies.getBranch().id;
      if (!branchId) return;
      const existing = new Set(products().map((product) => product.nombre.toLowerCase()));
      const selected = PRODUCT_CATALOG.filter(
        (item) => catalogSelection.has(item.nombre) && !existing.has(item.nombre.toLowerCase())
      );
      if (!selected.length) {
        dependencies.showToast("No hay productos nuevos seleccionados", "info");
        return;
      }
      try {
        const data = await importCatalog(dependencies.client, branchId, selected);
        await loadCategories();
        await loadProducts();
        renderCategoryFilter();
        render();
        closeCatalog();
        dependencies.showToast(
          `${String(number$4(data.importados))} productos importados. Ahora cargá precios y stock.`,
          "success"
        );
      } catch (error) {
        console.error(error);
        dependencies.showToast(errorMessage$7(error, "No se pudo importar el catálogo"), "error");
      }
    }
    function toggleLowStock() {
      const select = field$5("#filtro-stock-v29");
      if (select) select.value = "";
      legacyLowStockFilter = !legacyLowStockFilter;
      updateQuickFilterUi();
      render();
      if (legacyLowStockFilter) {
        dependencies.showToast("Filtrando stock bajo según velocidad de venta", "info");
      }
    }
    function toggleOutOfStock() {
      const select = field$5("#filtro-stock-v29");
      if (!select) return;
      legacyLowStockFilter = false;
      select.value = select.value === "sin" ? "" : "sin";
      updateQuickFilterUi();
      render();
      if (select.value === "sin") dependencies.showToast("Filtrando productos sin stock", "info");
    }
    function clearStockFilter() {
      legacyLowStockFilter = false;
      const select = field$5("#filtro-stock-v29");
      if (select) select.value = "";
      updateQuickFilterUi();
      render();
    }
    function applyRemoteChange(payload) {
      const current = products();
      const next = payload.new;
      const old = payload.old;
      if (payload.eventType === "INSERT" && next && !current.some((product) => product.id === text$4(next.id))) {
        dependencies.setProducts([...current, mapProductRow(next)]);
      } else if (payload.eventType === "UPDATE" && next) {
        dependencies.setProducts(current.map((product) => product.id === text$4(next.id) ? mapProductRow(next) : product));
      } else if (payload.eventType === "DELETE" && old) {
        dependencies.setProducts(current.filter((product) => product.id !== text$4(old.id)));
      }
      renderCategoryFilter();
      render();
      dependencies.applyPermissions();
      if (dependencies.isSaleOpen()) dependencies.renderSaleProducts();
    }
    function handleGridAction(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button2 = target.closest("[data-action]");
      const card = target.closest(".producto-card");
      const productId = card == null ? void 0 : card.dataset.id;
      if (!productId) return;
      if (!button2) {
        if (!window.matchMedia("(max-width: 700px)").matches || card.dataset.mobileEditable !== "true") return;
        const product = products().find((candidate) => candidate.id === productId);
        if (product) openEditor(product);
        return;
      }
      const action = button2.getAttribute("data-action");
      if (action === "sumar" || action === "restar") {
        void changeStock(productId, action === "sumar" ? 1 : -1);
      } else if (action === "ajustar") {
        dependencies.openManualStockModal(productId);
      } else if (action === "editar") {
        const product = products().find((candidate) => candidate.id === productId);
        if (product) openEditor(product);
      } else if (action === "eliminar") void removeProduct(productId);
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#btn-nuevo")) == null ? void 0 : _a.addEventListener("click", () => {
        openEditor();
      });
      (_b = queryOne("#btn-empty-nuevo")) == null ? void 0 : _b.addEventListener("click", () => {
        openEditor();
      });
      (_c = queryOne("#form-producto")) == null ? void 0 : _c.addEventListener("submit", (event) => {
        void submitProduct(event);
      });
      (_d = queryOne("#btn-cerrar-modal")) == null ? void 0 : _d.addEventListener("click", () => {
        closeEditor();
      });
      (_e = queryOne("#btn-cancelar")) == null ? void 0 : _e.addEventListener("click", () => {
        closeEditor();
      });
      (_f = queryOne("#modal .modal-backdrop")) == null ? void 0 : _f.addEventListener("click", () => {
        closeEditor();
      });
      (_g = queryOne("#buscador")) == null ? void 0 : _g.addEventListener("input", render);
      (_h = queryOne("#filtro-categoria")) == null ? void 0 : _h.addEventListener("change", render);
      (_i = queryOne("#orden")) == null ? void 0 : _i.addEventListener("change", render);
      (_j = queryOne("#filtro-stock-v29")) == null ? void 0 : _j.addEventListener("change", () => {
        legacyLowStockFilter = false;
        updateQuickFilterUi();
        render();
      });
      (_k = queryOne("#stat-bajo-card")) == null ? void 0 : _k.addEventListener("click", toggleLowStock);
      (_l = queryOne("#stat-sin-card")) == null ? void 0 : _l.addEventListener("click", toggleOutOfStock);
      (_m = queryOne("#btn-limpiar-filtro")) == null ? void 0 : _m.addEventListener("click", clearStockFilter);
      (_n = queryOne("#btn-add-categoria")) == null ? void 0 : _n.addEventListener("click", () => {
        void addCategory();
      });
      (_o = queryOne("#nueva-categoria")) == null ? void 0 : _o.addEventListener("keydown", (event) => {
        if (event instanceof KeyboardEvent && event.key === "Enter") {
          event.preventDefault();
          void addCategory();
        }
      });
      (_p = queryOne("#lista-categorias-config")) == null ? void 0 : _p.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button2 = target.closest("[data-cat-index]");
        if (button2) void removeCategory(Number(button2.dataset.catIndex));
      });
      (_q = queryOne("#productos-grid")) == null ? void 0 : _q.addEventListener("click", handleGridAction);
      (_r = queryOne("#productos-grid")) == null ? void 0 : _r.addEventListener("keydown", (event) => {
        if (!(event instanceof KeyboardEvent) || event.key !== "Enter" && event.key !== " ") return;
        const target = event.target;
        if (!(target instanceof Element) || target.closest("[data-action]")) return;
        const card = target.closest('.producto-card[data-mobile-editable="true"]');
        const product = products().find((candidate) => candidate.id === (card == null ? void 0 : card.dataset.id));
        if (product) {
          event.preventDefault();
          openEditor(product);
        }
      });
      (_s = queryOne("#btn-catalogo-v29")) == null ? void 0 : _s.addEventListener("click", openCatalog);
      (_t = queryOne("#btn-cargar-ejemplos")) == null ? void 0 : _t.addEventListener("click", openCatalog);
      (_u = queryOne("#btn-cargar-ejemplos-config")) == null ? void 0 : _u.addEventListener("click", openCatalog);
      (_v = queryOne("#btn-eliminar-todos-productos")) == null ? void 0 : _v.addEventListener("click", () => {
        void removeAllProducts();
      });
      (_w = queryOne("#btn-buscar-barcode")) == null ? void 0 : _w.addEventListener("click", () => {
        var _a2;
        void lookupBarcode(((_a2 = field$5("#codigo-barras")) == null ? void 0 : _a2.value) ?? "");
      });
      (_x = queryOne("#btn-close-catalogo-v29")) == null ? void 0 : _x.addEventListener("click", closeCatalog);
      (_y = queryOne("#btn-cancel-catalogo-v29")) == null ? void 0 : _y.addEventListener("click", closeCatalog);
      (_z = queryOne("#modal-catalogo-v29 .modal-backdrop")) == null ? void 0 : _z.addEventListener("click", closeCatalog);
      (_A = queryOne("#catalog-search-v29")) == null ? void 0 : _A.addEventListener("input", renderCatalog);
      queryAll(".catalog-tab-v29").forEach((button2) => {
        button2.addEventListener("click", () => {
          const kind = button2.getAttribute("data-catalog");
          if (kind === "kiosco" || kind === "almacen" || kind === "minimercado") catalogKind = kind;
          catalogSelection = new Set(catalogItems().map((item) => item.nombre));
          renderCatalog();
        });
      });
      (_B = queryOne("#catalog-list-v29")) == null ? void 0 : _B.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const checkbox = target.closest("[data-catalog-name]");
        const name = checkbox == null ? void 0 : checkbox.dataset.catalogName;
        if (!checkbox || !name) return;
        if (checkbox.checked) catalogSelection.add(name);
        else catalogSelection.delete(name);
        renderCatalog();
      });
      (_C = queryOne("#catalog-select-all-v29")) == null ? void 0 : _C.addEventListener("click", () => {
        queryAll("#catalog-list-v29 input:not(:disabled)").forEach((element2) => {
          if (element2 instanceof HTMLInputElement && element2.dataset.catalogName) {
            catalogSelection.add(element2.dataset.catalogName);
          }
        });
        renderCatalog();
      });
      (_D = queryOne("#catalog-clear-v29")) == null ? void 0 : _D.addEventListener("click", () => {
        queryAll("#catalog-list-v29 input:not(:disabled)").forEach((element2) => {
          if (element2 instanceof HTMLInputElement && element2.dataset.catalogName) {
            catalogSelection.delete(element2.dataset.catalogName);
          }
        });
        renderCatalog();
      });
      (_E = queryOne("#btn-import-catalogo-v29")) == null ? void 0 : _E.addEventListener("click", () => {
        void submitCatalog();
      });
    }
    return Object.freeze({
      setup,
      loadProducts,
      loadCategories,
      loadSmartStock,
      render,
      renderCategoryFilter,
      renderCategorySelect,
      renderCategoryList,
      getSmartStock,
      isLowStock: productIsLow,
      isOutOfStock,
      openEditor,
      closeEditor,
      lookupBarcode,
      ensureCategory,
      openCatalog,
      applyRemoteChange
    });
  }
  const PROFILE_KEY = "vendify_scanner_profile_v2";
  function number$3(value, fallback = 0) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  function errorMessage$6(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  function scannerVideo() {
    const video = queryOne("#scanner-video-v29");
    return video instanceof HTMLVideoElement ? video : null;
  }
  function zxingApi() {
    const candidate = window.ZXingBrowser;
    return candidate ?? null;
  }
  function detectorConstructor() {
    const candidate = window.BarcodeDetector;
    return candidate ?? null;
  }
  function advancedConstraint(value) {
    return { advanced: [value] };
  }
  function createScannerController(dependencies) {
    let mode = null;
    let controls = null;
    let reader = null;
    let lastCode = "";
    let lastCodeAt = 0;
    let track = null;
    let detector = null;
    let detectorFrame = null;
    let detectorBusy = false;
    let assistTimer = null;
    let autoZoomTimer = null;
    let openedAt = 0;
    let lastSuccessAt = 0;
    let currentZoom = 1;
    let zoomCapabilities = null;
    let torchOn = false;
    let torchSupported = false;
    let profile = null;
    let pendingCode = null;
    let returnToSale = false;
    let addAfterCreate = false;
    let usbBuffer = "";
    let usbStartedAt = 0;
    let usbLastAt = 0;
    let setupComplete = false;
    function loadProfile() {
      if (profile) return profile;
      try {
        const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null");
        if (typeof parsed === "object" && parsed !== null) profile = parsed;
      } catch {
        profile = null;
      }
      profile ?? (profile = {
        successes: 0,
        preferredZoom: 1,
        avgReadMs: null,
        engines: {},
        formats: {}
      });
      return profile;
    }
    function saveProfile() {
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(loadProfile()));
      } catch {
      }
    }
    function updateAdaptiveText() {
      const element2 = queryOne("#scanner-adaptive-text-vpro");
      if (!element2) return;
      const current = loadProfile();
      if (!current.successes) {
        element2.textContent = "Optimizando para este dispositivo";
        return;
      }
      const average = current.avgReadMs ? `${(current.avgReadMs / 1e3).toFixed(1)} s` : "—";
      element2.textContent = `Perfil adaptativo · ${String(current.successes)} lecturas · promedio ${average}`;
    }
    function registerSuccess(engine, format) {
      const current = loadProfile();
      const elapsed = Math.max(0, Date.now() - openedAt);
      current.successes = number$3(current.successes) + 1;
      current.engines[engine] = number$3(current.engines[engine]) + 1;
      if (format) current.formats[format] = number$3(current.formats[format]) + 1;
      if (elapsed > 0 && elapsed < 3e4) {
        current.avgReadMs = current.avgReadMs == null ? elapsed : Math.round(current.avgReadMs * 0.8 + elapsed * 0.2);
      }
      current.preferredZoom = Number((number$3(current.preferredZoom, 1) * 0.72 + currentZoom * 0.28).toFixed(2));
      lastSuccessAt = Date.now();
      saveProfile();
      updateAdaptiveText();
    }
    function setEngine(label) {
      const element2 = queryOne("#scanner-engine-vpro");
      if (element2) element2.textContent = label ? label : "Auto";
    }
    function showHint(message2 = "", type = "info") {
      const element2 = queryOne("#scanner-hint-vpro");
      if (!(element2 instanceof HTMLElement)) return;
      if (!message2) {
        element2.classList.add("hidden");
        element2.textContent = "";
        element2.dataset.type = "";
        return;
      }
      element2.textContent = message2;
      element2.dataset.type = type;
      element2.classList.remove("hidden");
    }
    function setAnimating(active) {
      var _a, _b;
      (_a = queryOne(".scanner-video-wrap-v29")) == null ? void 0 : _a.classList.toggle("is-scanning", active);
      (_b = queryOne("#modal-scanner-v29")) == null ? void 0 : _b.classList.toggle("scanner-reading-active", active);
    }
    function updateZoomUi() {
      const element2 = queryOne("#scanner-zoom-value-vpro");
      if (element2) element2.textContent = `${currentZoom.toFixed(1)}×`;
    }
    async function applyZoom(value, silent = false) {
      if (!track || !zoomCapabilities) return;
      const zoom = Math.max(zoomCapabilities.min, Math.min(Math.min(zoomCapabilities.max, 3), value));
      try {
        await track.applyConstraints(advancedConstraint({ zoom }));
        currentZoom = zoom;
        updateZoomUi();
        if (!silent) {
          showHint(`Zoom ${zoom.toFixed(1)}×`);
          setTimeout(() => {
            var _a, _b;
            if ((_b = (_a = queryOne("#scanner-hint-vpro")) == null ? void 0 : _a.textContent) == null ? void 0 : _b.startsWith("Zoom")) showHint();
          }, 900);
        }
      } catch (error) {
        console.debug("[Scanner Pro] zoom no aplicable:", error);
      }
    }
    async function changeZoom(delta) {
      if (!zoomCapabilities) return;
      await applyZoom(currentZoom + delta * Math.max(0.1, zoomCapabilities.step) * 2);
    }
    async function toggleTorch() {
      if (!track || !torchSupported) return;
      torchOn = !torchOn;
      try {
        await track.applyConstraints(advancedConstraint({ torch: torchOn }));
        const button2 = queryOne("#btn-scanner-torch-vpro");
        button2 == null ? void 0 : button2.classList.toggle("active", torchOn);
        const label = button2 == null ? void 0 : button2.querySelector("small");
        if (label) label.textContent = torchOn ? "Apagar" : "Linterna";
      } catch (error) {
        torchOn = false;
        console.debug("[Scanner Pro] torch no aplicable:", error);
      }
    }
    async function configureTrack() {
      var _a, _b, _c, _d, _e;
      const source = (_a = scannerVideo()) == null ? void 0 : _a.srcObject;
      track = source instanceof MediaStream ? source.getVideoTracks()[0] ?? null : null;
      if (!track) return;
      let capabilities = {};
      try {
        capabilities = track.getCapabilities();
      } catch {
      }
      let settings = {};
      try {
        settings = track.getSettings();
      } catch {
      }
      const width = number$3(settings.width);
      const resolution = queryOne("#scanner-resolution-badge-vpro");
      if (resolution) resolution.textContent = width >= 1800 ? "FHD" : width >= 1200 ? "HD+" : width >= 700 ? "HD" : "CAM";
      const continuousFocus = ((_b = capabilities.focusMode) == null ? void 0 : _b.includes("continuous")) === true;
      const focusBadge = queryOne("#scanner-focus-badge-vpro");
      if (focusBadge) focusBadge.textContent = continuousFocus ? "AF continuo" : "AF";
      if (continuousFocus) {
        try {
          await track.applyConstraints(advancedConstraint({ focusMode: "continuous" }));
        } catch (error) {
          console.debug("[Scanner Pro] focusMode no aplicable:", error);
        }
      }
      torchSupported = Boolean(capabilities.torch);
      (_c = queryOne("#btn-scanner-torch-vpro")) == null ? void 0 : _c.classList.toggle("hidden", !torchSupported);
      const zoom = capabilities.zoom;
      if ((zoom == null ? void 0 : zoom.min) != null && zoom.max != null) {
        zoomCapabilities = {
          min: number$3(zoom.min, 1),
          max: number$3(zoom.max, 1),
          step: number$3(zoom.step, 0.1)
        };
        (_d = queryOne("#scanner-zoom-wrap-vpro")) == null ? void 0 : _d.classList.remove("hidden");
        const preferred = Math.max(
          zoomCapabilities.min,
          Math.min(Math.min(zoomCapabilities.max, 2.2), number$3(loadProfile().preferredZoom, number$3(settings.zoom, 1)))
        );
        await applyZoom(preferred, true);
      } else {
        zoomCapabilities = null;
        (_e = queryOne("#scanner-zoom-wrap-vpro")) == null ? void 0 : _e.classList.add("hidden");
        currentZoom = 1;
        updateZoomUi();
      }
    }
    async function startNativeDetector() {
      const Detector = detectorConstructor();
      if (!Detector) return false;
      try {
        const wanted = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "codabar"];
        const browserFormats = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : wanted;
        const supported = wanted.filter((format) => browserFormats.includes(format));
        if (!supported.length) return false;
        detector = new Detector({ formats: supported });
        setEngine("Nativo + ZXing");
        const loop = () => {
          detectorFrame = requestAnimationFrame(() => {
            void detectFrame(loop);
          });
        };
        loop();
        return true;
      } catch (error) {
        console.debug("[Scanner Pro] BarcodeDetector no disponible:", error);
        detector = null;
        return false;
      }
    }
    async function detectFrame(next) {
      var _a;
      const video = scannerVideo();
      if (!detector || detectorBusy || ((_a = queryOne("#modal-scanner-v29")) == null ? void 0 : _a.classList.contains("hidden"))) {
        next();
        return;
      }
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        detectorBusy = true;
        try {
          const codes = await detector.detect(video);
          const hit = codes.find((code) => Boolean(code.rawValue));
          if (hit == null ? void 0 : hit.rawValue) await processCode(hit.rawValue, "native", hit.format ?? "");
        } catch {
        } finally {
          detectorBusy = false;
        }
      }
      next();
    }
    function stopNativeDetector() {
      if (detectorFrame != null) cancelAnimationFrame(detectorFrame);
      detectorFrame = null;
      detector = null;
      detectorBusy = false;
    }
    function startAssistance() {
      stopAssistance();
      assistTimer = setInterval(() => {
        var _a, _b;
        const video = scannerVideo();
        if (!video || video.readyState < 2 || video.videoWidth < 2) return;
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 48;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let luminance = 0;
          for (let index = 0; index < pixels.length; index += 16) {
            luminance += 0.2126 * number$3(pixels[index]) + 0.7152 * number$3(pixels[index + 1]) + 0.0722 * number$3(pixels[index + 2]);
          }
          const average = pixels.length ? luminance / (pixels.length / 16) : 120;
          if (average < 52 && torchSupported && !torchOn) {
            showHint("Hay poca luz · probá encender la linterna", "warning");
          } else if ((_b = (_a = queryOne("#scanner-hint-vpro")) == null ? void 0 : _a.textContent) == null ? void 0 : _b.includes("poca luz")) showHint();
        } catch {
        }
      }, 1300);
      autoZoomTimer = setInterval(() => {
        var _a;
        if (!zoomCapabilities || lastSuccessAt >= openedAt || ((_a = queryOne("#modal-scanner-v29")) == null ? void 0 : _a.classList.contains("hidden")) || Date.now() - openedAt < 2600) return;
        const maximum = Math.min(zoomCapabilities.max, 1.8);
        if (currentZoom < maximum - 0.05) {
          void applyZoom(Math.min(maximum, currentZoom + 0.2), true).then(() => {
            const status = queryOne("#scanner-status-v29");
            if (status) status.textContent = `Buscando · autozoom ${currentZoom.toFixed(1)}×`;
          });
        }
      }, 2200);
    }
    function stopAssistance() {
      if (assistTimer != null) clearInterval(assistTimer);
      if (autoZoomTimer != null) clearInterval(autoZoomTimer);
      assistTimer = null;
      autoZoomTimer = null;
    }
    function createFrame(options) {
      const video = scannerVideo();
      if (!(video == null ? void 0 : video.videoWidth) || !video.videoHeight) return null;
      const sourceX = Math.round(video.videoWidth * options.crop);
      const sourceY = Math.round(video.videoHeight * options.crop);
      const sourceWidth = Math.round(video.videoWidth * (1 - options.crop * 2));
      const sourceHeight = Math.round(video.videoHeight * (1 - options.crop * 2));
      const scale = Math.min(1, 1600 / sourceWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      if (options.contrast !== 1 || options.threshold != null) {
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < image.data.length; index += 4) {
          let gray = 0.299 * number$3(image.data[index]) + 0.587 * number$3(image.data[index + 1]) + 0.114 * number$3(image.data[index + 2]);
          gray = Math.max(0, Math.min(255, (gray - 128) * options.contrast + 128));
          if (options.threshold != null) gray = gray >= options.threshold ? 255 : 0;
          image.data[index] = gray;
          image.data[index + 1] = gray;
          image.data[index + 2] = gray;
        }
        context.putImageData(image, 0, 0);
      }
      return canvas;
    }
    async function tryCanvas(canvas) {
      var _a, _b, _c, _d, _e, _f;
      const Detector = detectorConstructor();
      if (Detector) {
        try {
          const currentDetector = detector ?? new Detector({
            formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"]
          });
          const hit = (await currentDetector.detect(canvas)).find((code) => Boolean(code.rawValue));
          if (hit == null ? void 0 : hit.rawValue) {
            await processCode(hit.rawValue, "capture", hit.format ?? "");
            return true;
          }
        } catch {
        }
      }
      const Reader = (_a = zxingApi()) == null ? void 0 : _a.BrowserMultiFormatReader;
      if (!Reader) return false;
      try {
        const result = await ((_c = (_b = new Reader()).decodeFromCanvas) == null ? void 0 : _c.call(_b, canvas));
        if (result == null ? void 0 : result.getText()) {
          await processCode(result.getText(), "capture", ((_f = (_e = (_d = result.getBarcodeFormat) == null ? void 0 : _d.call(result)) == null ? void 0 : _e.toString) == null ? void 0 : _f.call(_e)) ?? "");
          return true;
        }
      } catch {
      }
      return false;
    }
    async function captureAndAnalyze() {
      var _a;
      const button2 = queryOne("#btn-scanner-capture-vpro");
      const status = queryOne("#scanner-status-v29");
      if (!((_a = scannerVideo()) == null ? void 0 : _a.videoWidth)) {
        showHint("La cámara todavía no está lista", "warning");
        return;
      }
      if (button2 instanceof HTMLButtonElement) button2.disabled = true;
      setAnimating(false);
      if (status) status.textContent = "Analizando captura con varios filtros…";
      try {
        const variants = [
          { contrast: 1, threshold: null, crop: 0.02 },
          { contrast: 1.45, threshold: null, crop: 0.04 },
          { contrast: 1.8, threshold: null, crop: 0.07 },
          { contrast: 1.25, threshold: 125, crop: 0.04 },
          { contrast: 1.25, threshold: 155, crop: 0.04 }
        ];
        for (const options of variants) {
          const canvas = createFrame(options);
          if (canvas && await tryCanvas(canvas)) return;
        }
        if (status) status.textContent = "No pude leer esa captura";
        showHint("Probá estirar el envase, cambiar el ángulo o usar un poco de zoom", "warning");
        if (typeof navigator.vibrate === "function") navigator.vibrate([35, 45, 35]);
        setAnimating(true);
      } finally {
        if (button2 instanceof HTMLButtonElement) button2.disabled = false;
      }
    }
    function showMissingCode(code) {
      var _a;
      setAnimating(false);
      pendingCode = code.trim();
      const status = queryOne("#scanner-status-v29");
      if (status) status.textContent = `Código ${pendingCode} no registrado`;
      const description = queryOne("#scanner-not-found-text-v214");
      if (description) {
        description.textContent = `El código ${pendingCode} no existe en tu catálogo. Podés registrarlo ahora y volver automáticamente a esta venta.`;
      }
      (_a = queryOne("#scanner-not-found-actions-v214")) == null ? void 0 : _a.classList.remove("hidden");
    }
    function hideMissingCode() {
      var _a;
      (_a = queryOne("#scanner-not-found-actions-v214")) == null ? void 0 : _a.classList.add("hidden");
      const description = queryOne("#scanner-not-found-text-v214");
      if (description) description.textContent = "";
    }
    async function registerMissingProduct() {
      if (!pendingCode) return;
      const code = pendingCode;
      const fromSale = mode === "venta";
      returnToSale = fromSale;
      addAfterCreate = fromSale;
      close();
      dependencies.openProductEditor();
      if (fromSale) dependencies.activateProductOverSale();
      const barcode = queryOne("#codigo-barras");
      if (barcode instanceof HTMLInputElement) barcode.value = code;
      const stock = queryOne("#stock");
      if (stock instanceof HTMLInputElement && number$3(stock.value) <= 0) stock.value = "1";
      try {
        await dependencies.lookupBarcode(code);
      } catch (error) {
        console.warn("[V2.14] Búsqueda externa:", error);
      }
      dependencies.showToast("Completá los datos y guardá el producto", "info");
    }
    function cancelMissingProduct() {
      pendingCode = null;
      setAnimating(true);
      hideMissingCode();
      const status = queryOne("#scanner-status-v29");
      if (status) status.textContent = "Cámara activa · mantené el código dentro del marco";
      openedAt = Date.now();
      lastSuccessAt = 0;
    }
    async function ensurePhysicalUnit(product) {
      var _a;
      const branchId = dependencies.getBranchId();
      if (!branchId) return true;
      const required = number$3((_a = dependencies.getCart().find((item) => item.id === product.id)) == null ? void 0 : _a.cantidad) + 1;
      if (number$3(product.stock) >= required) return true;
      try {
        const data = await confirmScannedStock(dependencies.client, product.id, branchId, required);
        product.stock = number$3(data.stock, required);
        dependencies.emitStockChange("scanner_stock_fisico");
        dependencies.renderProducts();
        return true;
      } catch (error) {
        console.error("[Scanner stock]", error);
        dependencies.showToast(errorMessage$6(error, "No se pudo confirmar la unidad escaneada"), "error");
        return false;
      }
    }
    async function processCode(code, engine = "manual", format = "") {
      const normalized = code.replace(/\D/g, "").trim();
      if (!normalized) return;
      const now = Date.now();
      if (normalized === lastCode && now - lastCodeAt < 900) return;
      lastCode = normalized;
      lastCodeAt = now;
      setAnimating(false);
      if (engine !== "manual" && engine !== "usb") registerSuccess(engine, format);
      if (mode === "venta") {
        const product = dependencies.getProducts().find((candidate) => candidate.codigoBarras === normalized);
        if (!product) {
          showMissingCode(normalized);
          return;
        }
        if (!await ensurePhysicalUnit(product)) {
          setAnimating(true);
          return;
        }
        dependencies.addToCart(product.id);
        dependencies.renderSaleProducts();
        const status = queryOne("#scanner-status-v29");
        if (status) {
          const suffix = engine === "native" ? " · detector nativo" : engine === "capture" ? " · captura mejorada" : engine === "zxing" ? " · ZXing" : "";
          status.textContent = `✓ ${product.nombre} agregado${suffix}`;
        }
        if (typeof navigator.vibrate === "function") navigator.vibrate(70);
        setTimeout(close, 260);
        return;
      }
      if (mode === "producto") {
        const existing = dependencies.getProducts().find(
          (candidate) => candidate.codigoBarras === normalized && candidate.id !== dependencies.getEditingProductId()
        );
        close();
        if (existing) {
          dependencies.showToast(`El código ya corresponde a ${existing.nombre}`, "info");
          dependencies.openProductEditor(existing);
          return;
        }
        const barcode = queryOne("#codigo-barras");
        if (barcode instanceof HTMLInputElement) barcode.value = normalized;
        const stock = queryOne("#stock");
        if (!dependencies.getEditingProductId() && stock instanceof HTMLInputElement && number$3(stock.value) <= 0) {
          stock.value = "1";
        }
        await dependencies.lookupBarcode(normalized);
      }
    }
    async function open(requestedMode) {
      var _a;
      mode = requestedMode;
      lastCode = "";
      lastCodeAt = 0;
      pendingCode = null;
      openedAt = Date.now();
      lastSuccessAt = 0;
      torchOn = false;
      currentZoom = 1;
      hideMissingCode();
      showHint();
      updateAdaptiveText();
      setEngine("Preparando");
      document.body.classList.add("scanner-v29-open");
      const scannerModal = queryOne("#modal-scanner-v29");
      const saleModal = queryOne("#modal-venta");
      if (scannerModal instanceof HTMLElement) {
        scannerModal.style.zIndex = "12000";
        scannerModal.classList.remove("hidden");
      }
      if (requestedMode === "venta" && saleModal) {
        saleModal.classList.add("modal-behind-scanner");
        saleModal.setAttribute("aria-hidden", "true");
      }
      const modeLabel = queryOne("#scanner-mode-label-v29");
      if (modeLabel) {
        modeLabel.textContent = requestedMode === "venta" ? "Escaneá productos: se agregan directamente al carrito." : "Apuntá la cámara al código del producto.";
      }
      const status = queryOne("#scanner-status-v29");
      if (status) status.textContent = "Abriendo cámara trasera en alta resolución…";
      setAnimating(false);
      try {
        const api = zxingApi();
        const Reader = api == null ? void 0 : api.BrowserMultiFormatReader;
        const video = scannerVideo();
        if (!Reader || !video) throw new Error("El lector de códigos no cargó");
        reader = new Reader();
        const constraints = {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920, min: 720 },
            height: { ideal: 1080, min: 480 },
            frameRate: { ideal: 30, min: 15 }
          }
        };
        const callback = (result) => {
          var _a2, _b, _c;
          if (result) {
            void processCode(result.getText(), "zxing", ((_c = (_b = (_a2 = result.getBarcodeFormat) == null ? void 0 : _a2.call(result)) == null ? void 0 : _b.toString) == null ? void 0 : _c.call(_b)) ?? "");
          }
        };
        if (reader.decodeFromConstraints) {
          controls = await reader.decodeFromConstraints(constraints, video, callback);
        } else if (reader.decodeFromVideoDevice) {
          let selectedDeviceId;
          try {
            const devices = await ((_a = api.BrowserCodeReader) == null ? void 0 : _a.listVideoInputDevices()) ?? [];
            const back = devices.find((device) => /back|rear|environment|trasera/i.test(device.label)) ?? devices.at(-1);
            selectedDeviceId = back == null ? void 0 : back.deviceId;
          } catch {
          }
          controls = await reader.decodeFromVideoDevice(selectedDeviceId, video, callback);
        } else throw new Error("El lector de códigos no es compatible");
        await new Promise((resolve) => setTimeout(resolve, 120));
        await configureTrack();
        if (!await startNativeDetector()) setEngine("ZXing");
        startAssistance();
        if (status) status.textContent = "Cámara activa · mantené el código dentro del marco";
        setAnimating(true);
      } catch (error) {
        setAnimating(false);
        stopNativeDetector();
        stopAssistance();
        console.error("[Scanner Pro]", error);
        if (status) status.textContent = "No se pudo abrir la cámara. Revisá permisos o ingresá el código manualmente.";
        showHint("Si el teléfono tiene varias cámaras, probá cerrar y volver a abrir el scanner.", "warning");
      }
    }
    function close() {
      var _a, _b, _c;
      setAnimating(false);
      stopNativeDetector();
      stopAssistance();
      try {
        (_a = controls == null ? void 0 : controls.stop) == null ? void 0 : _a.call(controls);
      } catch {
      }
      controls = null;
      reader = null;
      mode = null;
      detector = null;
      track = null;
      zoomCapabilities = null;
      torchOn = false;
      torchSupported = false;
      const video = scannerVideo();
      if ((video == null ? void 0 : video.srcObject) instanceof MediaStream) {
        video.srcObject.getTracks().forEach((mediaTrack) => {
          mediaTrack.stop();
        });
        video.srcObject = null;
      }
      const scannerModal = queryOne("#modal-scanner-v29");
      const saleModal = queryOne("#modal-venta");
      scannerModal == null ? void 0 : scannerModal.classList.add("hidden");
      if (scannerModal instanceof HTMLElement) scannerModal.style.zIndex = "";
      document.body.classList.remove("scanner-v29-open");
      saleModal == null ? void 0 : saleModal.classList.remove("modal-behind-scanner");
      saleModal == null ? void 0 : saleModal.removeAttribute("aria-hidden");
      showHint();
      (_b = queryOne("#btn-scanner-torch-vpro")) == null ? void 0 : _b.classList.remove("active");
      (_c = queryOne("#scanner-zoom-wrap-vpro")) == null ? void 0 : _c.classList.add("hidden");
    }
    function shouldReturnCreatedProductToSale() {
      return returnToSale && addAfterCreate;
    }
    function clearPendingProduct() {
      pendingCode = null;
      returnToSale = false;
      addAfterCreate = false;
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#btn-scan-producto")) == null ? void 0 : _a.addEventListener("click", () => {
        void open("producto");
      });
      (_b = queryOne("#btn-scan-venta")) == null ? void 0 : _b.addEventListener("click", () => {
        void open("venta");
      });
      (_c = queryOne("#btn-close-scanner-v29")) == null ? void 0 : _c.addEventListener("click", close);
      (_d = queryOne("#modal-scanner-v29 .modal-backdrop")) == null ? void 0 : _d.addEventListener("click", close);
      (_e = queryOne("#btn-use-manual-code-v29")) == null ? void 0 : _e.addEventListener("click", () => {
        const input2 = queryOne("#scanner-manual-code-v29");
        void processCode(input2 instanceof HTMLInputElement ? input2.value : "", "manual");
      });
      (_f = queryOne("#btn-scanner-torch-vpro")) == null ? void 0 : _f.addEventListener("click", () => {
        void toggleTorch();
      });
      (_g = queryOne("#btn-scanner-zoom-out-vpro")) == null ? void 0 : _g.addEventListener("click", () => {
        void changeZoom(-1);
      });
      (_h = queryOne("#btn-scanner-zoom-in-vpro")) == null ? void 0 : _h.addEventListener("click", () => {
        void changeZoom(1);
      });
      (_i = queryOne("#btn-scanner-capture-vpro")) == null ? void 0 : _i.addEventListener("click", () => {
        void captureAndAnalyze();
      });
      (_j = queryOne("#btn-register-scanned-v214")) == null ? void 0 : _j.addEventListener("click", () => {
        void registerMissingProduct();
      });
      (_k = queryOne("#btn-cancel-register-scanned-v214")) == null ? void 0 : _k.addEventListener("click", cancelMissingProduct);
      (_l = queryOne("#scanner-manual-code-v29")) == null ? void 0 : _l.addEventListener("keydown", (event) => {
        if (event instanceof KeyboardEvent && event.key === "Enter") {
          event.preventDefault();
          const target = event.target;
          void processCode(target instanceof HTMLInputElement ? target.value : "", "manual");
        }
      });
      document.addEventListener("keydown", (event) => {
        var _a2, _b2;
        const saleOpen = ((_a2 = queryOne("#modal-venta")) == null ? void 0 : _a2.classList.contains("hidden")) === false;
        const productOpen = ((_b2 = queryOne("#modal")) == null ? void 0 : _b2.classList.contains("hidden")) === false;
        if (!saleOpen && !productOpen) return;
        const now = performance.now();
        if (event.key === "Enter") {
          if (usbBuffer.length >= 6 && now - usbStartedAt < 2500) {
            event.preventDefault();
            const code = usbBuffer;
            usbBuffer = "";
            mode = saleOpen ? "venta" : "producto";
            void processCode(code, "usb").finally(() => {
              if (productOpen) mode = null;
            });
          } else usbBuffer = "";
          return;
        }
        if (/^\d$/.test(event.key)) {
          if (now - usbLastAt > 180) {
            usbBuffer = "";
            usbStartedAt = now;
          }
          if (!usbBuffer) usbStartedAt = now;
          usbBuffer += event.key;
          usbLastAt = now;
        }
      }, true);
    }
    return Object.freeze({
      setup,
      open,
      close,
      processCode,
      shouldReturnCreatedProductToSale,
      clearPendingProduct
    });
  }
  window.VendifyProductsV232 = Object.freeze({
    createController: createProductsController,
    createScannerController,
    mapProductRow,
    productLabel,
    isOutOfStock,
    listProducts,
    listCategories,
    initializeCategories,
    saveCategory,
    deleteCategory,
    saveProduct,
    deleteProduct,
    deleteAllProducts,
    adjustInitialStock,
    listSmartStock,
    confirmScannedStock,
    importCatalog,
    importBulkCatalog,
    parseCsvLine,
    normalizeCsvHeader
  });
  function record$3(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  }
  function records$3(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const parsed = record$3(item);
      return parsed ? [parsed] : [];
    });
  }
  function message(error, data, fallback) {
    const response = record$3(data);
    return (error == null ? void 0 : error.message) ?? (typeof (response == null ? void 0 : response.message) === "string" ? response.message : fallback);
  }
  function requireSuccess(error, data, fallback) {
    const response = record$3(data);
    if (error || (response == null ? void 0 : response.ok) !== true) throw new Error(message(error, data, fallback));
    return response;
  }
  async function listSuppliers(client) {
    const { data, error } = await client.rpc("listar_proveedores_v1");
    if (error) throw new Error(message(error, data, "No se pudieron cargar los proveedores"));
    return records$3(data);
  }
  async function saveSupplier(client, input2) {
    const { data, error } = await client.rpc("guardar_proveedor_v1", {
      p_id: input2.id,
      p_nombre: input2.name,
      p_cuit: input2.taxId,
      p_contacto: input2.contact,
      p_telefono: input2.phone,
      p_email: input2.email,
      p_direccion: input2.address,
      p_notas: input2.notes
    });
    return requireSuccess(error, data, "No se pudo guardar el proveedor.");
  }
  async function listPurchases(client, branchId, limit = 150) {
    const { data, error } = await client.rpc("listar_compras_v1", {
      p_sucursal_id: branchId,
      p_limit: limit
    });
    if (error) throw new Error(message(error, data, "No se pudieron cargar las compras"));
    return records$3(data);
  }
  async function getPurchase(client, purchaseId) {
    const { data, error } = await client.rpc("obtener_compra_v1", {
      p_compra_id: purchaseId
    });
    const response = record$3(data);
    if (error || !response || !record$3(response.compra)) {
      throw new Error(message(error, data, "No se pudo abrir la compra"));
    }
    return response;
  }
  async function savePurchaseDraft(client, input2) {
    const { data, error } = await client.rpc("guardar_compra_borrador_v1", {
      p_compra_id: input2.purchaseId,
      p_sucursal_id: input2.branchId,
      p_proveedor_id: input2.supplierId,
      p_numero_comprobante: input2.receiptNumber,
      p_nota: input2.notes,
      p_items: input2.items.map((item) => ({
        producto_id: item.productId,
        cantidad: item.quantity,
        costo_unitario: item.unitCost
      }))
    });
    return requireSuccess(error, data, "No se pudo guardar la compra.");
  }
  async function receivePurchase(client, purchaseId) {
    const { data, error } = await client.rpc("recibir_compra_v1", {
      p_compra_id: purchaseId
    });
    return requireSuccess(
      error,
      data,
      "La compra quedó guardada como borrador, pero no se pudo recibir."
    );
  }
  async function cancelPurchaseDraft(client, purchaseId) {
    const { data, error } = await client.rpc("anular_compra_borrador_v1", {
      p_compra_id: purchaseId
    });
    return requireSuccess(error, data, "No se pudo anular");
  }
  function field$4(selector) {
    const element2 = queryOne(selector);
    return element2 instanceof HTMLInputElement || element2 instanceof HTMLSelectElement || element2 instanceof HTMLTextAreaElement ? element2 : null;
  }
  function record$2(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  }
  function records$2(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const parsed = record$2(item);
      return parsed ? [parsed] : [];
    });
  }
  function text$3(value, fallback = "") {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
  }
  function firstText(values, fallback) {
    for (const value of values) {
      const candidate = text$3(value);
      if (candidate) return candidate;
    }
    return fallback;
  }
  function number$2(value) {
    return Number(value ?? 0);
  }
  function errorMessage$5(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  function setText(selector, value) {
    const element2 = queryOne(selector);
    if (element2) element2.textContent = String(value);
  }
  function setValue(selector, value) {
    const element2 = field$4(selector);
    if (element2) element2.value = text$3(value);
  }
  function nullableField(selector) {
    var _a;
    const value = ((_a = field$4(selector)) == null ? void 0 : _a.value.trim()) ?? "";
    return value || null;
  }
  function createPurchasesController(dependencies) {
    let suppliers = [];
    let purchases = [];
    let items = [];
    let editingPurchaseId = null;
    let editingPurchaseState = "borrador";
    let editingSupplierId = null;
    let activeTab = "compras";
    let operationInProgress = false;
    let setupComplete = false;
    function renderPurchaseStats() {
      const now = /* @__PURE__ */ new Date();
      const receivedThisMonth = purchases.filter((purchase) => {
        if (purchase.estado !== "recibida" || !purchase.recibida_en) return false;
        const date = new Date(text$3(purchase.recibida_en));
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      });
      setText("#compras-stat-count", receivedThisMonth.length);
      setText(
        "#compras-stat-total",
        formatArs(receivedThisMonth.reduce((sum, purchase) => sum + number$2(purchase.total), 0))
      );
      setText(
        "#compras-stat-providers",
        suppliers.filter((supplier) => supplier.activo !== false).length
      );
    }
    function updateSupplierSelect(selected = null) {
      const select = field$4("#compra-proveedor");
      if (!(select instanceof HTMLSelectElement)) return;
      const active = suppliers.filter((supplier) => supplier.activo !== false);
      select.innerHTML = active.length ? active.map((supplier) => {
        const id = text$3(supplier.id);
        return `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${escapeHtml(text$3(supplier.nombre))}</option>`;
      }).join("") : '<option value="">Creá un proveedor primero</option>';
    }
    function closeSupplierEditor() {
      var _a;
      (_a = queryOne("#modal-proveedor-editor")) == null ? void 0 : _a.classList.add("hidden");
      editingSupplierId = null;
      const form = queryOne("#form-proveedor-v230");
      if (form instanceof HTMLFormElement) form.reset();
    }
    function openSupplierEditor(supplier = null) {
      var _a;
      editingSupplierId = supplier ? text$3(supplier.id) || null : null;
      setText("#proveedor-editor-title", supplier ? "Editar proveedor" : "Nuevo proveedor");
      setValue("#proveedor-id-v230", supplier == null ? void 0 : supplier.id);
      setValue("#proveedor-nombre-v230", supplier == null ? void 0 : supplier.nombre);
      setValue("#proveedor-cuit-v230", supplier == null ? void 0 : supplier.cuit);
      setValue("#proveedor-contacto-v230", supplier == null ? void 0 : supplier.contacto);
      setValue("#proveedor-telefono-v230", supplier == null ? void 0 : supplier.telefono);
      setValue("#proveedor-email-v230", supplier == null ? void 0 : supplier.email);
      setValue("#proveedor-direccion-v230", supplier == null ? void 0 : supplier.direccion);
      setValue("#proveedor-notas-v230", supplier == null ? void 0 : supplier.notas);
      setText("#proveedor-editor-error", "");
      (_a = queryOne("#modal-proveedor-editor")) == null ? void 0 : _a.classList.remove("hidden");
      setTimeout(() => {
        var _a2;
        return (_a2 = field$4("#proveedor-nombre-v230")) == null ? void 0 : _a2.focus();
      }, 50);
    }
    function renderSuppliers() {
      var _a;
      const container = queryOne("#proveedores-list-v230");
      if (!container) return;
      const query = (((_a = field$4("#proveedores-search")) == null ? void 0 : _a.value) ?? "").trim().toLowerCase();
      const filtered = suppliers.filter((supplier) => {
        if (!query) return true;
        return [
          supplier.nombre,
          supplier.cuit,
          supplier.contacto,
          supplier.telefono,
          supplier.email
        ].map((value) => text$3(value)).filter(Boolean).join(" ").toLowerCase().includes(query);
      });
      if (!filtered.length) {
        container.innerHTML = `<div class="inventory-empty compras-empty-v230">${suppliers.length ? "No hay proveedores para esa búsqueda." : "Todavía no cargaste proveedores."}</div>`;
        return;
      }
      container.innerHTML = filtered.map((supplier) => {
        const id = text$3(supplier.id);
        const name = text$3(supplier.nombre, "P");
        return `
        <article class="proveedor-card-v230" data-provider-id="${escapeHtml(id)}">
          <div class="proveedor-card-head-v230">
            <div class="proveedor-avatar-v230">${escapeHtml(name.slice(0, 1).toUpperCase())}</div>
            <div class="proveedor-title-v230">
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(firstText([supplier.contacto, supplier.cuit], "Proveedor"))}</small>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-provider-edit="${escapeHtml(id)}">Editar</button>
          </div>
          <div class="proveedor-metrics-v230">
            <div><span>Total comprado</span><strong>${formatArs(number$2(supplier.total_comprado))}</strong></div>
            <div><span>Compras</span><strong>${String(number$2(supplier.compras_recibidas))}</strong></div>
          </div>
          <div class="proveedor-meta-v230">
            <span>${supplier.telefono ? `Tel. ${escapeHtml(text$3(supplier.telefono))}` : "Sin teléfono"}</span>
            <span>${supplier.ultima_compra ? `Última compra ${escapeHtml(dependencies.formatDate(supplier.ultima_compra))}` : "Sin compras recibidas"}</span>
          </div>
        </article>`;
      }).join("");
      container.querySelectorAll("[data-provider-edit]").forEach((button2) => {
        button2.addEventListener("click", () => {
          const id = button2.getAttribute("data-provider-edit");
          const supplier = suppliers.find((item) => text$3(item.id) === id);
          if (supplier) openSupplierEditor(supplier);
        });
      });
    }
    async function loadSupplierList(options = {}) {
      const shouldRender = options.render ?? true;
      try {
        suppliers = await listSuppliers(dependencies.client);
        if (shouldRender) renderSuppliers();
        updateSupplierSelect();
        renderPurchaseStats();
      } catch (error) {
        console.error("[Proveedores]", error);
        const container = queryOne("#proveedores-list-v230");
        if (shouldRender && container) {
          container.innerHTML = '<div class="inventory-empty">No se pudieron cargar los proveedores.</div>';
        }
      }
    }
    async function submitSupplier(event) {
      var _a;
      event.preventDefault();
      const wasEditing = Boolean(editingSupplierId);
      const name = ((_a = field$4("#proveedor-nombre-v230")) == null ? void 0 : _a.value.trim()) ?? "";
      setText("#proveedor-editor-error", "");
      if (!name) {
        setText("#proveedor-editor-error", "El nombre es obligatorio.");
        return;
      }
      try {
        await saveSupplier(dependencies.client, {
          id: editingSupplierId,
          name,
          taxId: nullableField("#proveedor-cuit-v230"),
          contact: nullableField("#proveedor-contacto-v230"),
          phone: nullableField("#proveedor-telefono-v230"),
          email: nullableField("#proveedor-email-v230"),
          address: nullableField("#proveedor-direccion-v230"),
          notes: nullableField("#proveedor-notas-v230")
        });
        closeSupplierEditor();
        await loadSupplierList({ render: activeTab === "proveedores" });
        dependencies.showToast(wasEditing ? "Proveedor actualizado" : "Proveedor creado", "success");
      } catch (error) {
        setText("#proveedor-editor-error", errorMessage$5(error, "No se pudo guardar el proveedor."));
      }
    }
    function renderPurchases() {
      var _a, _b;
      const container = queryOne("#compras-list-v230");
      if (!container) return;
      const query = (((_a = field$4("#compras-search")) == null ? void 0 : _a.value) ?? "").trim().toLowerCase();
      const state = ((_b = field$4("#compras-filter-state")) == null ? void 0 : _b.value) ?? "";
      const filtered = purchases.filter((purchase) => {
        const stateMatches = !state || purchase.estado === state;
        const searchable = [purchase.proveedor_nombre, purchase.numero_comprobante, purchase.nota].map((value) => text$3(value)).filter(Boolean).join(" ").toLowerCase();
        return stateMatches && (!query || searchable.includes(query));
      });
      if (!filtered.length) {
        container.innerHTML = `<div class="inventory-empty compras-empty-v230">${purchases.length ? "No hay compras para esos filtros." : "Todavía no registraste compras en esta sucursal."}</div>`;
        return;
      }
      container.innerHTML = filtered.map((purchase) => {
        const id = text$3(purchase.id);
        const stateValue = text$3(purchase.estado, "borrador");
        const stateLabel = stateValue === "recibida" ? "Recibida" : stateValue === "anulada" ? "Anulada" : "Borrador";
        return `
        <article class="compra-card-v230" data-purchase-id="${escapeHtml(id)}">
          <div class="compra-status-v230 ${escapeHtml(stateValue)}"><span></span>${stateLabel}</div>
          <div class="compra-card-main-v230">
            <div>
              <strong>${escapeHtml(text$3(purchase.proveedor_nombre, "Sin proveedor"))}</strong>
              <small>${escapeHtml(text$3(purchase.numero_comprobante, "Sin comprobante"))} · ${String(number$2(purchase.items_count))} productos</small>
            </div>
            <div class="compra-card-total-v230">
              <strong>${formatArs(number$2(purchase.total))}</strong>
              <small>${escapeHtml(dependencies.formatDate(purchase.creado))}</small>
            </div>
          </div>
          <div class="compra-card-actions-v230">
            <button type="button" class="btn btn-secondary btn-sm" data-purchase-open="${escapeHtml(id)}">${stateValue === "borrador" ? "Continuar" : "Ver detalle"}</button>
            ${stateValue === "borrador" ? `<button type="button" class="btn btn-ghost btn-sm danger" data-purchase-cancel="${escapeHtml(id)}">Anular borrador</button>` : ""}
          </div>
        </article>`;
      }).join("");
      container.querySelectorAll("[data-purchase-open]").forEach((button2) => {
        button2.addEventListener("click", () => {
          const id = button2.getAttribute("data-purchase-open");
          if (id) void openExistingPurchase(id);
        });
      });
      container.querySelectorAll("[data-purchase-cancel]").forEach((button2) => {
        button2.addEventListener("click", () => {
          const id = button2.getAttribute("data-purchase-cancel");
          if (id) void cancelDraft(id);
        });
      });
    }
    async function loadPurchaseList(options = {}) {
      const branchId = dependencies.getBranch().id;
      if (!branchId) return;
      const shouldRender = options.render ?? true;
      try {
        purchases = await listPurchases(dependencies.client, branchId);
        if (shouldRender) renderPurchases();
        renderPurchaseStats();
      } catch (error) {
        console.error("[Compras]", error);
        const container = queryOne("#compras-list-v230");
        if (shouldRender && container) {
          container.innerHTML = '<div class="inventory-empty">No se pudieron cargar las compras.</div>';
        }
      }
    }
    function activateTab(tabValue, load = true) {
      activeTab = tabValue === "proveedores" ? "proveedores" : "compras";
      queryAll(".compras-tab-v230").forEach((button2) => {
        button2.classList.toggle("active", button2.getAttribute("data-compras-tab") === activeTab);
      });
      queryAll(".compras-panel-v230").forEach((panel) => {
        const active = panel.getAttribute("data-compras-panel") === activeTab;
        panel.classList.toggle("active", active);
        if (panel instanceof HTMLElement) panel.hidden = !active;
      });
      if (!load) return;
      if (activeTab === "compras") void loadPurchaseList();
      else void loadSupplierList();
    }
    async function openPurchases(tab = "compras") {
      var _a;
      if (!dependencies.canManage()) {
        dependencies.showToast("Tu rol no permite administrar compras", "error");
        return;
      }
      setText("#compras-branch-badge-v230", dependencies.getBranch().name || "Sucursal");
      (_a = queryOne("#modal-compras")) == null ? void 0 : _a.classList.remove("hidden");
      activateTab(tab, false);
      await loadSupplierList({ render: tab === "proveedores" });
      await loadPurchaseList({ render: tab === "compras" });
    }
    function closePurchases() {
      var _a;
      (_a = queryOne("#modal-compras")) == null ? void 0 : _a.classList.add("hidden");
    }
    async function fillBranchSelect(selected = null) {
      const select = field$4("#compra-sucursal");
      if (!(select instanceof HTMLSelectElement)) return;
      const branches = await dependencies.listBranches();
      select.innerHTML = branches.map((branch) => {
        const id = text$3(branch.id);
        return `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${escapeHtml(text$3(branch.nombre))}</option>`;
      }).join("");
      if (!selected && dependencies.getBranch().id) select.value = dependencies.getBranch().id ?? "";
    }
    function updateProductCost() {
      var _a;
      const selectedId = (_a = field$4("#compra-item-producto")) == null ? void 0 : _a.value;
      const product = dependencies.getProducts().find((item) => text$3(item.id) === selectedId);
      const cost = field$4("#compra-item-costo");
      if (product && cost) cost.value = number$2(product.precioCompra).toFixed(2);
    }
    function fillProductSelect(selected = null) {
      const select = field$4("#compra-item-producto");
      if (!(select instanceof HTMLSelectElement)) return;
      select.innerHTML = dependencies.getProducts().map((product) => {
        const id = text$3(product.id);
        return `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${escapeHtml(dependencies.productLabel(product))}</option>`;
      }).join("");
      updateProductCost();
    }
    function setEditorReadonly(readonly) {
      var _a, _b, _c;
      ["#compra-proveedor", "#compra-sucursal", "#compra-comprobante", "#compra-nota"].forEach((selector) => {
        const element2 = field$4(selector);
        if (element2) element2.disabled = readonly;
      });
      (_a = queryOne("#compra-add-item-box-v230")) == null ? void 0 : _a.classList.toggle("hidden", readonly);
      (_b = queryOne("#btn-save-compra-draft")) == null ? void 0 : _b.classList.toggle("hidden", readonly);
      (_c = queryOne("#btn-receive-compra")) == null ? void 0 : _c.classList.toggle("hidden", readonly);
      document.body.classList.toggle("compra-readonly-v230", readonly);
    }
    function closePurchaseEditor() {
      var _a;
      (_a = queryOne("#modal-compra-editor")) == null ? void 0 : _a.classList.add("hidden");
      editingPurchaseId = null;
      editingPurchaseState = "borrador";
      items = [];
      document.body.classList.remove("compra-readonly-v230");
    }
    function renderPurchaseItems() {
      const container = queryOne("#compra-items-list-v230");
      if (!container) return;
      const readonly = editingPurchaseState !== "borrador";
      container.innerHTML = items.length ? items.map((item, index) => `
          <div class="compra-item-row-v230">
            <span class="compra-item-name-v230"><strong>${escapeHtml(item.productName)}</strong></span>
            <label><input type="number" min="1" step="1" data-compra-qty="${String(index)}"
              value="${String(item.quantity)}" ${readonly ? "disabled" : ""} /></label>
            <label><input type="number" min="0" step="0.01" data-compra-cost="${String(index)}"
              value="${item.unitCost.toFixed(2)}" ${readonly ? "disabled" : ""} /></label>
            <strong>${formatArs(item.quantity * item.unitCost)}</strong>
            <button type="button" class="btn-icon danger" data-compra-remove="${String(index)}"
              ${readonly ? "hidden" : ""}>✕</button>
          </div>`).join("") : '<div class="inventory-empty">Agregá los productos incluidos en la compra.</div>';
      if (!readonly) {
        container.querySelectorAll("[data-compra-qty]").forEach((element2) => {
          element2.addEventListener("input", () => {
            if (!(element2 instanceof HTMLInputElement)) return;
            const item = items[Number(element2.getAttribute("data-compra-qty"))];
            if (!item) return;
            item.quantity = Math.max(1, Math.round(Number(element2.value || 1)));
            renderPurchaseItems();
          });
        });
        container.querySelectorAll("[data-compra-cost]").forEach((element2) => {
          element2.addEventListener("change", () => {
            if (!(element2 instanceof HTMLInputElement)) return;
            const item = items[Number(element2.getAttribute("data-compra-cost"))];
            if (!item) return;
            item.unitCost = Math.max(0, Number(element2.value || 0));
            renderPurchaseItems();
          });
        });
        container.querySelectorAll("[data-compra-remove]").forEach((button2) => {
          button2.addEventListener("click", () => {
            items.splice(Number(button2.getAttribute("data-compra-remove")), 1);
            renderPurchaseItems();
          });
        });
      }
      setText(
        "#compra-total-value-v230",
        formatArs(items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0))
      );
    }
    function addPurchaseItem() {
      var _a, _b, _c;
      const productId = ((_a = field$4("#compra-item-producto")) == null ? void 0 : _a.value) ?? "";
      const product = dependencies.getProducts().find((item) => text$3(item.id) === productId);
      if (!product) return;
      const quantity = Math.max(1, Math.round(Number(((_b = field$4("#compra-item-cantidad")) == null ? void 0 : _b.value) ?? 1)));
      const unitCost = Math.max(0, Number(((_c = field$4("#compra-item-costo")) == null ? void 0 : _c.value) ?? 0));
      const existing = items.find((item) => item.productId === productId);
      if (existing) {
        existing.quantity += quantity;
        existing.unitCost = unitCost;
      } else {
        items.push({
          productId,
          productName: dependencies.productLabel(product),
          quantity,
          unitCost
        });
      }
      setValue("#compra-item-cantidad", "1");
      renderPurchaseItems();
    }
    async function openNewPurchase() {
      var _a;
      if (!suppliers.length) await loadSupplierList({ render: false });
      if (!suppliers.some((supplier) => supplier.activo !== false)) {
        dependencies.showToast("Primero cargá al menos un proveedor", "info");
        activateTab("proveedores");
        openSupplierEditor();
        return;
      }
      editingPurchaseId = null;
      editingPurchaseState = "borrador";
      items = [];
      setText("#compra-editor-title", "Nueva compra");
      setText("#compra-editor-subtitle", "Guardala como borrador o recibí la mercadería ahora.");
      setValue("#compra-comprobante", "");
      setValue("#compra-nota", "");
      setText("#compra-editor-error", "");
      updateSupplierSelect();
      await fillBranchSelect(dependencies.getBranch().id);
      fillProductSelect();
      setEditorReadonly(false);
      renderPurchaseItems();
      (_a = queryOne("#modal-compra-editor")) == null ? void 0 : _a.classList.remove("hidden");
    }
    async function openExistingPurchase(id) {
      var _a;
      try {
        const response = await getPurchase(dependencies.client, id);
        const purchase = record$2(response.compra);
        if (!purchase) throw new Error("No se pudo abrir la compra");
        editingPurchaseId = text$3(purchase.id);
        editingPurchaseState = text$3(purchase.estado, "borrador");
        items = records$2(response.items).map((item) => ({
          productId: text$3(item.producto_id),
          productName: text$3(item.producto_nombre, "Producto"),
          quantity: number$2(item.cantidad),
          unitCost: number$2(item.costo_unitario)
        }));
        setText(
          "#compra-editor-title",
          editingPurchaseState === "borrador" ? "Editar compra" : "Detalle de compra"
        );
        setText(
          "#compra-editor-subtitle",
          editingPurchaseState === "recibida" ? `Mercadería recibida ${purchase.recibida_en ? dependencies.formatDate(purchase.recibida_en) : ""}` : editingPurchaseState === "anulada" ? "Esta compra fue anulada." : "Podés modificar el borrador antes de recibirlo."
        );
        await loadSupplierList({ render: false });
        updateSupplierSelect(text$3(purchase.proveedor_id));
        setValue("#compra-proveedor", purchase.proveedor_id);
        await fillBranchSelect(text$3(purchase.sucursal_id));
        setValue("#compra-sucursal", purchase.sucursal_id);
        setValue("#compra-comprobante", purchase.numero_comprobante);
        setValue("#compra-nota", purchase.nota);
        setText("#compra-editor-error", "");
        fillProductSelect();
        setEditorReadonly(editingPurchaseState !== "borrador");
        renderPurchaseItems();
        (_a = queryOne("#modal-compra-editor")) == null ? void 0 : _a.classList.remove("hidden");
      } catch (error) {
        dependencies.showToast(errorMessage$5(error, "No se pudo abrir la compra"), "error");
      }
    }
    async function savePurchase(receive = false) {
      var _a, _b;
      if (operationInProgress) return;
      operationInProgress = true;
      const errorElement = queryOne("#compra-editor-error");
      if (errorElement) errorElement.textContent = "";
      const supplierId = ((_a = field$4("#compra-proveedor")) == null ? void 0 : _a.value) ?? "";
      const branchId = ((_b = field$4("#compra-sucursal")) == null ? void 0 : _b.value) ?? "";
      if (!supplierId || !branchId || !items.length) {
        setText(
          "#compra-editor-error",
          !supplierId ? "Seleccioná un proveedor." : !branchId ? "Seleccioná una sucursal." : "Agregá al menos un producto."
        );
        operationInProgress = false;
        return;
      }
      const actionButton = queryOne(receive ? "#btn-receive-compra" : "#btn-save-compra-draft");
      const originalText = (actionButton == null ? void 0 : actionButton.textContent) ?? "";
      if (actionButton instanceof HTMLButtonElement) {
        actionButton.disabled = true;
        actionButton.textContent = receive ? "Recibiendo..." : "Guardando...";
      }
      try {
        const saved = await savePurchaseDraft(dependencies.client, {
          purchaseId: editingPurchaseId,
          branchId,
          supplierId,
          receiptNumber: nullableField("#compra-comprobante"),
          notes: nullableField("#compra-nota"),
          items: items.map((item) => ({
            productId: item.productId,
            quantity: Math.max(1, Math.round(item.quantity)),
            unitCost: Math.max(0, item.unitCost)
          }))
        });
        editingPurchaseId = text$3(saved.compra_id) || editingPurchaseId;
        if (!editingPurchaseId) throw new Error("No se pudo identificar la compra guardada.");
        if (receive) {
          const received = await receivePurchase(dependencies.client, editingPurchaseId);
          dependencies.emitStockChange("compra_recibida");
          await dependencies.reloadProducts();
          dependencies.renderProducts();
          dependencies.showToast(
            `Compra recibida · ${String(number$2(received.unidades_ingresadas))} unidades ingresadas`,
            "success"
          );
        } else {
          dependencies.showToast("Compra guardada como borrador", "success");
        }
        closePurchaseEditor();
        await Promise.all([
          loadPurchaseList(),
          loadSupplierList({ render: activeTab === "proveedores" })
        ]);
      } catch (error) {
        setText("#compra-editor-error", errorMessage$5(error, "No se pudo guardar la compra."));
      } finally {
        if (actionButton instanceof HTMLButtonElement) {
          actionButton.disabled = false;
          actionButton.textContent = originalText;
        }
        operationInProgress = false;
      }
    }
    async function cancelDraft(id) {
      const confirmed = await dependencies.confirm(
        "Anular borrador",
        "La compra dejará de aparecer como pendiente. No se modificará el stock."
      );
      if (!confirmed) return;
      try {
        await cancelPurchaseDraft(dependencies.client, id);
        await loadPurchaseList();
        dependencies.showToast("Borrador anulado", "success");
      } catch (error) {
        dependencies.showToast(errorMessage$5(error, "No se pudo anular"), "error");
      }
    }
    async function refreshOpenViews() {
      var _a;
      if (((_a = queryOne("#modal-compras")) == null ? void 0 : _a.classList.contains("hidden")) !== false) return;
      await Promise.all([
        loadPurchaseList({ render: activeTab === "compras" }),
        loadSupplierList({ render: activeTab === "proveedores" })
      ]);
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#btn-compras")) == null ? void 0 : _a.addEventListener("click", () => void openPurchases());
      (_b = queryOne("#btn-close-compras")) == null ? void 0 : _b.addEventListener("click", closePurchases);
      (_c = queryOne("#modal-compras .modal-backdrop")) == null ? void 0 : _c.addEventListener("click", closePurchases);
      queryAll(".compras-tab-v230").forEach((button2) => {
        button2.addEventListener("click", () => {
          activateTab(button2.getAttribute("data-compras-tab"));
        });
      });
      (_d = queryOne("#btn-nueva-compra")) == null ? void 0 : _d.addEventListener("click", () => void openNewPurchase());
      (_e = queryOne("#btn-refresh-compras")) == null ? void 0 : _e.addEventListener("click", () => void loadPurchaseList());
      (_f = queryOne("#compras-search")) == null ? void 0 : _f.addEventListener("input", renderPurchases);
      (_g = queryOne("#compras-filter-state")) == null ? void 0 : _g.addEventListener("change", renderPurchases);
      (_h = queryOne("#btn-nuevo-proveedor")) == null ? void 0 : _h.addEventListener("click", () => {
        openSupplierEditor();
      });
      (_i = queryOne("#btn-refresh-proveedores")) == null ? void 0 : _i.addEventListener("click", () => void loadSupplierList());
      (_j = queryOne("#proveedores-search")) == null ? void 0 : _j.addEventListener("input", renderSuppliers);
      (_k = queryOne("#form-proveedor-v230")) == null ? void 0 : _k.addEventListener("submit", (event) => void submitSupplier(event));
      (_l = queryOne("#btn-close-proveedor-editor")) == null ? void 0 : _l.addEventListener("click", closeSupplierEditor);
      (_m = queryOne("#btn-cancel-proveedor-editor")) == null ? void 0 : _m.addEventListener("click", closeSupplierEditor);
      (_n = queryOne("#modal-proveedor-editor .modal-backdrop")) == null ? void 0 : _n.addEventListener("click", closeSupplierEditor);
      (_o = queryOne("#btn-close-compra-editor")) == null ? void 0 : _o.addEventListener("click", closePurchaseEditor);
      (_p = queryOne("#btn-cancel-compra-editor")) == null ? void 0 : _p.addEventListener("click", closePurchaseEditor);
      (_q = queryOne("#modal-compra-editor .modal-backdrop")) == null ? void 0 : _q.addEventListener("click", closePurchaseEditor);
      (_r = queryOne("#compra-item-producto")) == null ? void 0 : _r.addEventListener("change", updateProductCost);
      (_s = queryOne("#btn-add-compra-item")) == null ? void 0 : _s.addEventListener("click", addPurchaseItem);
      (_t = queryOne("#btn-save-compra-draft")) == null ? void 0 : _t.addEventListener("click", () => void savePurchase(false));
      (_u = queryOne("#btn-receive-compra")) == null ? void 0 : _u.addEventListener("click", () => void savePurchase(true));
    }
    return Object.freeze({ setup, refreshOpenViews });
  }
  window.VendifyPurchasesV232 = Object.freeze({
    createController: createPurchasesController,
    listSuppliers,
    saveSupplier,
    listPurchases,
    getPurchase,
    savePurchaseDraft,
    receivePurchase,
    cancelPurchaseDraft
  });
  function roundMoney(value) {
    return Math.round(value * 100) / 100;
  }
  function scalarText$1(value) {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  }
  function normalizeDiscountRequest(subtotalValue, typeValue, amountValue) {
    const subtotal = roundMoney(Math.max(0, subtotalValue || 0));
    const tipo = typeValue === "porcentaje" || typeValue === "monto" ? typeValue : null;
    let valor = amountValue || 0;
    if (tipo === "porcentaje") valor = Math.max(0, Math.min(100, valor));
    else if (tipo === "monto") valor = Math.max(0, Math.min(subtotal, valor));
    else valor = 0;
    return { subtotal, tipo, valor: roundMoney(valor) };
  }
  function discountAuthorizationMatches(authorization, request, now = Date.now()) {
    return Boolean(
      (authorization == null ? void 0 : authorization.ok) && request.tipo === authorization.tipo && Math.abs(request.valor - authorization.valor) <= 1e-3 && Math.abs(request.subtotal - authorization.subtotal) <= 0.01 && now < authorization.expiraMs
    );
  }
  function calculateSaleTotals(request, authorized) {
    let tipo = null;
    let valor = 0;
    let descuento = 0;
    if (authorized && request.tipo === "porcentaje") {
      tipo = request.tipo;
      valor = request.valor;
      descuento = request.subtotal * valor / 100;
    } else if (authorized && request.tipo === "monto") {
      tipo = request.tipo;
      valor = request.valor;
      descuento = Math.min(request.subtotal, valor);
    }
    descuento = roundMoney(descuento);
    return {
      subtotal: request.subtotal,
      tipo,
      valor,
      descuento,
      total: Math.max(0, roundMoney(request.subtotal - descuento))
    };
  }
  function normalizeSalePayments(mode, total, singleMethod, mixedPayments, formatCurrency) {
    if (total <= 1e-3) return [];
    if (mode === "single") {
      return [{ medio_pago: singleMethod || "Efectivo", monto: roundMoney(total) }];
    }
    const payments = mixedPayments.filter((payment) => payment.monto > 0).map((payment) => ({ medio_pago: payment.medio_pago, monto: roundMoney(payment.monto) }));
    const sum = payments.reduce((accumulator, payment) => accumulator + payment.monto, 0);
    if (!payments.length) throw new Error("Ingresá al menos un medio de pago");
    if (Math.abs(sum - total) > 0.01) {
      throw new Error(
        sum < total ? `Faltan ${formatCurrency(total - sum)} para completar el pago` : `Los pagos exceden el total por ${formatCurrency(sum - total)}`
      );
    }
    return payments;
  }
  function saleStatusLabel(status) {
    const labels = {
      completada: "Completada",
      parcialmente_devuelta: "Dev. parcial",
      devuelta: "Devuelta",
      anulada: "Anulada",
      pendiente_sincronizacion: "Pendiente de sincronizar"
    };
    return labels[scalarText$1(status)] ?? "Completada";
  }
  function netSaleTotal(sale) {
    return Math.max(0, Number(sale.total ?? 0) - Number(sale.total_devuelto ?? 0));
  }
  function salePaymentsText(payments, operation, formatCurrency) {
    return payments.filter((payment) => payment.operacion === operation).map((payment) => `${scalarText$1(payment.medio_pago)}: ${formatCurrency(Number(payment.monto ?? 0))}`).join(" · ");
  }
  function ticketNumber(id) {
    return scalarText$1(id).replace(/-/g, "").slice(0, 8).toUpperCase();
  }
  function salesDateRange(key, now = /* @__PURE__ */ new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (key === "hoy") return { desde: today, hasta: null };
    if (key === "ayer") {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { desde: yesterday, hasta: new Date(today) };
    }
    if (key === "7dias") {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { desde: start, hasta: null };
    }
    if (key === "mes") return { desde: new Date(now.getFullYear(), now.getMonth(), 1), hasta: null };
    return { desde: null, hasta: null };
  }
  function record$1(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }
  function records$1(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item)) : [];
  }
  function fail(error, fallback) {
    if (error) throw new Error(error.message ?? fallback);
  }
  async function registerSale(client, input2) {
    const { data, error } = await client.rpc("registrar_venta_v4", {
      p_items: input2.items.map((item) => ({
        producto_id: item.id ?? item.producto_id,
        cantidad: item.cantidad
      })),
      p_pagos: input2.payments,
      p_descuento_tipo: input2.totals.tipo,
      p_descuento_valor: input2.totals.valor,
      p_observacion: input2.observation,
      p_sucursal_id: input2.branchId,
      p_caja_id: input2.cashRegisterId,
      p_request_id: input2.requestId
    });
    fail(error, "No se pudo registrar la venta");
    return record$1(data);
  }
  async function authorizeDiscount(client, pin, branchId, request) {
    const { data, error } = await client.rpc("autorizar_descuento_v1", {
      p_pin: pin,
      p_sucursal_id: branchId,
      p_subtotal: request.subtotal,
      p_descuento_tipo: request.tipo,
      p_descuento_valor: request.valor
    });
    fail(error, "No se pudo autorizar el descuento");
    return record$1(data);
  }
  async function getDiscountPinState(client) {
    const { data, error } = await client.rpc("estado_pin_descuento_v1");
    fail(error, "No se pudo consultar el estado del PIN");
    return record$1(data);
  }
  async function configureDiscountPin(client, pin) {
    const { data, error } = await client.rpc("configurar_pin_descuento_v1", { p_pin: pin });
    fail(error, "No se pudo configurar el PIN");
    return record$1(data);
  }
  async function voidSale(client, saleId, cashRegisterId, refundMethod, reason) {
    const { data, error } = await client.rpc("anular_venta_v1", {
      p_venta_id: saleId,
      p_caja_id: cashRegisterId,
      p_medio_reintegro: refundMethod,
      p_motivo: reason
    });
    fail(error, "No se pudo anular la venta");
    return record$1(data);
  }
  async function returnSaleItems(client, saleId, items, cashRegisterId, refundMethod, reason) {
    const { data, error } = await client.rpc("devolver_venta_v1", {
      p_venta_id: saleId,
      p_items: items,
      p_caja_id: cashRegisterId,
      p_medio_reintegro: refundMethod,
      p_motivo: reason
    });
    fail(error, "No se pudo registrar la devolución");
    return record$1(data);
  }
  async function listSales(client, branchId, from, to) {
    let query = client.from("ventas").select("*, venta_items(*), venta_pagos(*), venta_devoluciones(*)").order("creado", { ascending: false });
    if (branchId) query = query.eq("sucursal_id", branchId);
    if (from) query = query.gte("creado", from.toISOString());
    if (to) query = query.lt("creado", to.toISOString());
    const { data, error } = await query;
    fail(error, "No se pudo cargar el historial");
    return records$1(data);
  }
  function field$3(selector) {
    const element2 = queryOne(selector);
    return element2 instanceof HTMLInputElement || element2 instanceof HTMLSelectElement ? element2 : null;
  }
  function errorMessage$4(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  function scalarText(value, fallback) {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : fallback;
  }
  function createDiscountController(dependencies) {
    let authorization = null;
    let setupComplete = false;
    function getRequest() {
      var _a, _b;
      return normalizeDiscountRequest(
        dependencies.getSubtotal(),
        ((_a = field$3("#venta-descuento-tipo-v228")) == null ? void 0 : _a.value) ?? "",
        Number(((_b = field$3("#venta-descuento-valor-v228")) == null ? void 0 : _b.value) ?? 0)
      );
    }
    function isAuthorized() {
      return discountAuthorizationMatches(authorization, getRequest());
    }
    function render() {
      const button2 = queryOne("#btn-autorizar-descuento");
      const status = queryOne("#discount-auth-status");
      const caption = queryOne("#discount-auth-caption");
      const request = getRequest();
      const requested = Boolean(request.tipo) && request.valor > 0 && request.subtotal > 0;
      const authorized = requested && isAuthorized();
      if (button2 instanceof HTMLButtonElement) {
        button2.disabled = !requested || authorized;
        button2.innerHTML = authorized ? `${dependencies.icon("check")}<span>Autorizado</span>` : `${dependencies.icon("lock")}<span>Autorizar</span>`;
      }
      if (status) {
        status.classList.remove("pending", "authorized", "required");
        if (!request.tipo || request.valor <= 0) {
          status.classList.add("pending");
          status.innerHTML = '<span class="discount-auth-dot"></span><span>Sin descuento aplicado</span>';
        } else if (authorized) {
          status.classList.add("authorized");
          status.innerHTML = `<span class="discount-auth-dot"></span><span>Autorizado por ${escapeHtml((authorization == null ? void 0 : authorization.autorizador) ?? "Administrador")}</span>`;
        } else {
          status.classList.add("required");
          status.innerHTML = '<span class="discount-auth-dot"></span><span>Ingresá un PIN de administrador para aplicar este descuento</span>';
        }
      }
      if (caption) caption.textContent = authorized ? "Autorizado" : "Requiere autorización";
    }
    function invalidate(options = {}) {
      authorization = null;
      render();
      if (options.recalculate !== false) dependencies.recalculateTotals();
    }
    function openAuthorization() {
      var _a;
      const request = getRequest();
      if (!request.tipo || request.valor <= 0) {
        dependencies.showToast("Ingresá primero el descuento que querés aplicar", "info");
        return;
      }
      if (request.subtotal <= 0) {
        dependencies.showToast("Agregá productos antes de autorizar el descuento", "info");
        return;
      }
      const subtotal = queryOne("#discount-auth-subtotal");
      const requested = queryOne("#discount-auth-request");
      const pin = field$3("#discount-admin-pin");
      const error = queryOne("#discount-auth-error");
      if (subtotal) subtotal.textContent = dependencies.formatCurrency(request.subtotal);
      if (requested) {
        requested.textContent = request.tipo === "porcentaje" ? `${String(request.valor)}%` : dependencies.formatCurrency(request.valor);
      }
      if (pin) pin.value = "";
      if (error) error.textContent = "";
      (_a = queryOne("#modal-discount-auth")) == null ? void 0 : _a.classList.remove("hidden");
      setTimeout(() => {
        var _a2;
        return (_a2 = field$3("#discount-admin-pin")) == null ? void 0 : _a2.focus();
      }, 60);
    }
    function closeAuthorization() {
      var _a;
      (_a = queryOne("#modal-discount-auth")) == null ? void 0 : _a.classList.add("hidden");
      const pin = field$3("#discount-admin-pin");
      const error = queryOne("#discount-auth-error");
      if (pin) pin.value = "";
      if (error) error.textContent = "";
    }
    async function submitAuthorization(event) {
      var _a;
      event.preventDefault();
      const request = getRequest();
      const pin = ((_a = field$3("#discount-admin-pin")) == null ? void 0 : _a.value.trim()) ?? "";
      const branchId = dependencies.getBranchId();
      const error = queryOne("#discount-auth-error");
      const button2 = queryOne("#btn-submit-discount-auth");
      if (error) error.textContent = "";
      if (!/^\d{4,8}$/.test(pin)) {
        if (error) error.textContent = "El PIN debe tener entre 4 y 8 números.";
        return;
      }
      if (!branchId) {
        if (error) error.textContent = "No hay una sucursal activa.";
        return;
      }
      if (button2 instanceof HTMLButtonElement) {
        button2.disabled = true;
        button2.textContent = "Verificando...";
      }
      try {
        const data = await authorizeDiscount(dependencies.client, pin, branchId, request);
        if (data.ok !== true) {
          if (error) error.textContent = scalarText(data.message, "PIN incorrecto o autorización no disponible.");
          return;
        }
        authorization = {
          ok: true,
          tipo: request.tipo,
          valor: request.valor,
          subtotal: request.subtotal,
          autorizador: scalarText(data.autorizador_nombre, scalarText(data.autorizador_rol, "Administrador")),
          expiraMs: Date.now() + Math.max(30, Number(data.expira_segundos ?? 180)) * 1e3
        };
        closeAuthorization();
        render();
        dependencies.recalculateTotals();
        dependencies.showToast(`Descuento autorizado por ${authorization.autorizador}`, "success");
      } catch (caught) {
        if (error) error.textContent = errorMessage$4(caught, "No se pudo autorizar el descuento");
      } finally {
        if (button2 instanceof HTMLButtonElement) {
          button2.disabled = false;
          button2.textContent = "Autorizar descuento";
        }
      }
    }
    async function updatePinState() {
      const card = queryOne("#config-discount-pin-card");
      const status = queryOne("#pin-config-status");
      const button2 = queryOne("#btn-configurar-pin-descuento");
      if (!card || !status || !(button2 instanceof HTMLButtonElement) || !dependencies.isAppReady()) return;
      const allowed = ["owner", "admin"].includes(dependencies.getRole() ?? "");
      card.classList.toggle("hidden", !allowed);
      if (!allowed) return;
      status.textContent = "Consultando estado...";
      try {
        const data = await getDiscountPinState(dependencies.client);
        if (data.configurado) {
          status.innerHTML = '<span class="pin-status-dot configured"></span><span>Tu PIN está configurado</span>';
          button2.textContent = "Cambiar PIN";
        } else {
          status.innerHTML = '<span class="pin-status-dot"></span><span>Todavía no configuraste tu PIN</span>';
          button2.textContent = "Configurar PIN";
        }
        const count = Number(data.autorizadores_configurados ?? 0);
        if (count > 0) {
          status.innerHTML += `<small>${String(count)} ${count === 1 ? "autorizador disponible" : "autorizadores disponibles"} en el negocio</small>`;
        }
      } catch {
        status.textContent = "No se pudo consultar el estado del PIN.";
      }
    }
    function openPinConfiguration() {
      var _a;
      const pin = field$3("#config-discount-pin");
      const confirmation = field$3("#config-discount-pin-confirm");
      const error = queryOne("#config-discount-pin-error");
      if (pin) pin.value = "";
      if (confirmation) confirmation.value = "";
      if (error) error.textContent = "";
      (_a = queryOne("#modal-config-discount-pin")) == null ? void 0 : _a.classList.remove("hidden");
      setTimeout(() => {
        var _a2;
        return (_a2 = field$3("#config-discount-pin")) == null ? void 0 : _a2.focus();
      }, 60);
    }
    function closePinConfiguration() {
      var _a;
      (_a = queryOne("#modal-config-discount-pin")) == null ? void 0 : _a.classList.add("hidden");
      for (const selector of ["#config-discount-pin", "#config-discount-pin-confirm"]) {
        const element2 = field$3(selector);
        if (element2) element2.value = "";
      }
      const error = queryOne("#config-discount-pin-error");
      if (error) error.textContent = "";
    }
    async function savePin(event) {
      var _a, _b;
      event.preventDefault();
      const pin = ((_a = field$3("#config-discount-pin")) == null ? void 0 : _a.value.trim()) ?? "";
      const confirmation = ((_b = field$3("#config-discount-pin-confirm")) == null ? void 0 : _b.value.trim()) ?? "";
      const error = queryOne("#config-discount-pin-error");
      const button2 = queryOne("#btn-save-config-pin");
      if (error) error.textContent = "";
      if (!/^\d{4,8}$/.test(pin)) {
        if (error) error.textContent = "Usá un PIN de 4 a 8 números.";
        return;
      }
      if (pin !== confirmation) {
        if (error) error.textContent = "Los PIN no coinciden.";
        return;
      }
      if (button2 instanceof HTMLButtonElement) {
        button2.disabled = true;
        button2.textContent = "Guardando...";
      }
      try {
        const data = await configureDiscountPin(dependencies.client, pin);
        if (data.ok !== true) {
          if (error) error.textContent = scalarText(data.message, "No se pudo configurar el PIN.");
          return;
        }
        closePinConfiguration();
        await updatePinState();
        dependencies.showToast("PIN de descuentos configurado", "success");
      } catch (caught) {
        if (error) error.textContent = errorMessage$4(caught, "No se pudo configurar el PIN");
      } finally {
        if (button2 instanceof HTMLButtonElement) {
          button2.disabled = false;
          button2.textContent = "Guardar PIN";
        }
      }
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#venta-descuento-tipo-v228")) == null ? void 0 : _a.addEventListener("change", (event) => {
        const input2 = field$3("#venta-descuento-valor-v228");
        const target = event.target;
        authorization = null;
        if (input2 && target instanceof HTMLSelectElement) {
          input2.disabled = !target.value;
          if (!target.value) input2.value = "0";
        }
        dependencies.recalculateTotals();
      });
      (_b = queryOne("#venta-descuento-valor-v228")) == null ? void 0 : _b.addEventListener("input", () => {
        authorization = null;
        dependencies.recalculateTotals();
      });
      (_c = queryOne("#btn-autorizar-descuento")) == null ? void 0 : _c.addEventListener("click", openAuthorization);
      (_d = queryOne("#form-discount-auth")) == null ? void 0 : _d.addEventListener("submit", (event) => void submitAuthorization(event));
      (_e = queryOne("#btn-close-discount-auth")) == null ? void 0 : _e.addEventListener("click", closeAuthorization);
      (_f = queryOne("#btn-cancel-discount-auth")) == null ? void 0 : _f.addEventListener("click", closeAuthorization);
      (_g = queryOne("#modal-discount-auth .modal-backdrop")) == null ? void 0 : _g.addEventListener("click", closeAuthorization);
      (_h = queryOne("#btn-configurar-pin-descuento")) == null ? void 0 : _h.addEventListener("click", openPinConfiguration);
      (_i = queryOne("#form-config-discount-pin")) == null ? void 0 : _i.addEventListener("submit", (event) => void savePin(event));
      (_j = queryOne("#btn-close-config-pin")) == null ? void 0 : _j.addEventListener("click", closePinConfiguration);
      (_k = queryOne("#btn-cancel-config-pin")) == null ? void 0 : _k.addEventListener("click", closePinConfiguration);
      (_l = queryOne("#modal-config-discount-pin .modal-backdrop")) == null ? void 0 : _l.addEventListener("click", closePinConfiguration);
    }
    return Object.freeze({ setup, getRequest, isAuthorized, invalidate, render, openAuthorization, updatePinState });
  }
  function field$2(selector) {
    const element2 = queryOne(selector);
    return element2 instanceof HTMLInputElement || element2 instanceof HTMLSelectElement || element2 instanceof HTMLTextAreaElement ? element2 : null;
  }
  function number$1(value) {
    return Number(value ?? 0);
  }
  function normalizeCartQuantity(value, maximum) {
    const safeMaximum = Math.max(1, Math.floor(Number.isFinite(maximum) ? maximum : 1));
    const safeValue = Math.floor(Number.isFinite(value) ? value : 1);
    return Math.max(1, Math.min(safeMaximum, safeValue));
  }
  function text$2(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }
  function createRequestId() {
    var _a;
    const optionalCrypto = crypto;
    const generated = (_a = optionalCrypto.randomUUID) == null ? void 0 : _a.call(crypto);
    if (generated) return generated;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function errorMessage$3(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  function createPosController(dependencies) {
    let cart = [];
    let paymentMode = "single";
    let requestId = null;
    let confirming = false;
    let setupComplete = false;
    const paymentMethods = ["Efectivo", "Débito", "Crédito", "Transferencia", "Mercado Pago", "Otro"];
    function getTotal() {
      return cart.reduce((total, item) => total + item.precioVenta * item.cantidad, 0);
    }
    function calculateTotals() {
      return calculateSaleTotals(dependencies.discount.getRequest(), dependencies.discount.isAuthorized());
    }
    function mixedPaymentsFromDom() {
      return [...queryAll(".mixed-pay-row-v228")].map((row) => {
        const method = row.querySelector(".mixed-pay-method-v228");
        const amount = row.querySelector(".mixed-pay-amount-v228");
        return {
          medio_pago: method instanceof HTMLSelectElement ? method.value : "Otro",
          monto: amount instanceof HTMLInputElement ? number$1(amount.value) : 0
        };
      });
    }
    function paymentOptions(selected) {
      return paymentMethods.map(
        (method) => `<option value="${escapeHtml(method)}" ${method === selected ? "selected" : ""}>${escapeHtml(method)}</option>`
      ).join("");
    }
    function renderMixedPayments(payments) {
      const container = queryOne("#mixed-payment-rows-v228");
      if (!container) return;
      container.innerHTML = payments.map(
        (payment, index) => `<div class="mixed-pay-row-v228" data-pay-index="${String(index)}"><select class="select mixed-pay-method-v228">${paymentOptions(payment.medio_pago || "Efectivo")}</select><div class="mixed-pay-amount-wrap-v228"><span>$</span><input class="mixed-pay-amount-v228" type="number" min="0" step="0.01" value="${number$1(payment.monto).toFixed(2)}"/></div><button type="button" class="btn btn-ghost btn-sm mixed-pay-rest-v228" data-pay-rest title="Completar con el restante">Restante</button><button type="button" class="btn-icon danger mixed-pay-remove-v228" data-pay-remove title="Quitar">✕</button></div>`
      ).join("");
      updateRemainingPayment();
    }
    function updateRemainingPayment() {
      const element2 = queryOne("#mixed-payment-remaining-v228");
      if (!element2) return;
      const total = calculateTotals().total;
      const paid = mixedPaymentsFromDom().reduce((sum, payment) => sum + number$1(payment.monto), 0);
      const remaining = Math.round((total - paid) * 100) / 100;
      element2.textContent = Math.abs(remaining) <= 0.01 ? "Pago completo" : remaining > 0 ? `Restante ${dependencies.formatCurrency(remaining)}` : `Excede ${dependencies.formatCurrency(Math.abs(remaining))}`;
      element2.classList.toggle("ok", Math.abs(remaining) <= 0.01);
      element2.classList.toggle("error", remaining < -0.01);
    }
    function updateTotals() {
      const totals = calculateTotals();
      const subtotal = queryOne("#venta-subtotal-v228");
      const discount = queryOne("#venta-descuento-total-v228");
      const discountRow = queryOne("#venta-descuento-row-v228");
      const total = queryOne("#carrito-total");
      if (subtotal) subtotal.textContent = dependencies.formatCurrency(totals.subtotal);
      if (discount) discount.textContent = `−${dependencies.formatCurrency(totals.descuento)}`;
      discountRow == null ? void 0 : discountRow.classList.toggle("hidden", totals.descuento <= 0);
      if (total) total.textContent = dependencies.formatCurrency(totals.total);
      updateRemainingPayment();
      dependencies.discount.render();
      return totals;
    }
    function resetSale() {
      var _a, _b;
      paymentMode = "single";
      dependencies.discount.invalidate({ recalculate: false });
      queryAll("[data-pay-mode-v228]").forEach((button2) => {
        button2.classList.toggle("active", button2.getAttribute("data-pay-mode-v228") === "single");
      });
      (_a = queryOne("#single-payment-v228")) == null ? void 0 : _a.classList.remove("hidden");
      (_b = queryOne("#mixed-payment-v228")) == null ? void 0 : _b.classList.add("hidden");
      const method = field$2("#medio-pago");
      const discountType = field$2("#venta-descuento-tipo-v228");
      const discountValue = field$2("#venta-descuento-valor-v228");
      const observation = field$2("#venta-observacion-v228");
      if (method) method.value = "Efectivo";
      if (discountType) discountType.value = "";
      if (discountValue) {
        discountValue.value = "0";
        discountValue.disabled = true;
      }
      if (observation) observation.value = "";
      renderMixedPayments([
        { medio_pago: "Efectivo", monto: 0 },
        { medio_pago: "Transferencia", monto: 0 }
      ]);
      updateTotals();
    }
    function activatePaymentMode(mode) {
      var _a, _b;
      paymentMode = mode === "mixed" ? "mixed" : "single";
      queryAll("[data-pay-mode-v228]").forEach((button2) => {
        button2.classList.toggle("active", button2.getAttribute("data-pay-mode-v228") === paymentMode);
      });
      (_a = queryOne("#single-payment-v228")) == null ? void 0 : _a.classList.toggle("hidden", paymentMode !== "single");
      (_b = queryOne("#mixed-payment-v228")) == null ? void 0 : _b.classList.toggle("hidden", paymentMode !== "mixed");
      if (paymentMode === "mixed") {
        const rows = queryOne("#mixed-payment-rows-v228");
        if (rows && !rows.children.length) {
          renderMixedPayments([
            { medio_pago: "Efectivo", monto: calculateTotals().total },
            { medio_pago: "Transferencia", monto: 0 }
          ]);
        } else {
          const inputs = [...queryAll(".mixed-pay-amount-v228")].filter(
            (element2) => element2 instanceof HTMLInputElement
          );
          const paid = inputs.reduce((sum, input2) => sum + number$1(input2.value), 0);
          const first = inputs[0];
          if (paid <= 0 && first) first.value = calculateTotals().total.toFixed(2);
        }
      }
      updateRemainingPayment();
    }
    function addMixedPayment() {
      renderMixedPayments([...mixedPaymentsFromDom(), { medio_pago: "Efectivo", monto: 0 }]);
    }
    function completeRemainingPayment(row) {
      let otherPayments = 0;
      queryAll(".mixed-pay-row-v228").forEach((candidate) => {
        if (candidate === row) return;
        const input22 = candidate.querySelector(".mixed-pay-amount-v228");
        if (input22 instanceof HTMLInputElement) otherPayments += number$1(input22.value);
      });
      const input2 = row.querySelector(".mixed-pay-amount-v228");
      if (input2 instanceof HTMLInputElement) {
        input2.value = Math.max(0, calculateTotals().total - otherPayments).toFixed(2);
      }
      updateRemainingPayment();
    }
    function paymentsForSale(total) {
      var _a;
      return normalizeSalePayments(
        paymentMode,
        total,
        ((_a = field$2("#medio-pago")) == null ? void 0 : _a.value) ?? "Efectivo",
        mixedPaymentsFromDom(),
        dependencies.formatCurrency
      );
    }
    function renderCart() {
      const container = queryOne("#carrito-items");
      const count = queryOne("#carrito-count-v210");
      const charge = queryOne("#btn-cobrar");
      if (!container) return;
      const units = cart.reduce((sum, item) => sum + number$1(item.cantidad), 0);
      if (count) count.textContent = `${String(units)} ${units === 1 ? "artículo" : "artículos"}`;
      if (!cart.length) {
        container.innerHTML = '<p class="carrito-vacio" id="carrito-vacio">Tocá un producto para agregarlo</p>';
        updateTotals();
        if (charge instanceof HTMLButtonElement) charge.disabled = true;
        dependencies.persistCart();
        dependencies.applyOfflineSaleState();
        return;
      }
      container.innerHTML = cart.map(
        (item) => `<div class="carrito-item" data-id="${escapeHtml(item.id)}"><div class="carrito-item-info"><div class="carrito-item-nombre">${escapeHtml(item.nombre)}</div><div class="carrito-item-sub">${dependencies.formatCurrency(item.precioVenta)} c/u · ${dependencies.formatCurrency(item.precioVenta * item.cantidad)}</div></div><div class="carrito-item-qty"><button type="button" data-qty="-1" aria-label="Restar una unidad">−</button><input type="number" inputmode="numeric" min="1" max="${String(Math.max(1, item.stock))}" step="1" value="${String(item.cantidad)}" data-qty-input aria-label="Cantidad de ${escapeHtml(item.nombre)}"/><button type="button" data-qty="1" aria-label="Sumar una unidad">+</button></div><button type="button" class="carrito-item-quitar" data-quitar title="Quitar">🗑️</button></div>`
      ).join("");
      updateTotals();
      if (charge instanceof HTMLButtonElement) charge.disabled = false;
      dependencies.persistCart();
      dependencies.applyOfflineSaleState();
    }
    function addToCart(id) {
      dependencies.discount.invalidate({ recalculate: false });
      const product = dependencies.getProducts().find((candidate) => candidate.id === id);
      if (!product) return;
      const item = cart.find((candidate) => candidate.id === id);
      const inCart = (item == null ? void 0 : item.cantidad) ?? 0;
      const stock = number$1(product.stock);
      if (inCart >= stock) {
        dependencies.showToast(`No queda más stock de "${text$2(product.nombre)}"`, "error");
        return;
      }
      if (item) item.cantidad += 1;
      else {
        cart.push({
          id: text$2(product.id),
          nombre: text$2(product.nombre),
          precioVenta: number$1(product.precioVenta),
          stock,
          cantidad: 1
        });
      }
      dependencies.renderSaleProducts();
      renderCart();
    }
    function changeQuantity(id, delta) {
      dependencies.discount.invalidate({ recalculate: false });
      const item = cart.find((candidate) => candidate.id === id);
      if (!item) return;
      const product = dependencies.getProducts().find((candidate) => candidate.id === id);
      const maximum = product ? number$1(product.stock) : item.stock;
      item.cantidad = normalizeCartQuantity(item.cantidad + delta, maximum);
      dependencies.renderSaleProducts();
      renderCart();
    }
    function setQuantity(id, quantity) {
      dependencies.discount.invalidate({ recalculate: false });
      const item = cart.find((candidate) => candidate.id === id);
      if (!item) return;
      const product = dependencies.getProducts().find((candidate) => candidate.id === id);
      const maximum = product ? number$1(product.stock) : item.stock;
      const normalized = normalizeCartQuantity(quantity, maximum);
      if (quantity > maximum) {
        dependencies.showToast(`Stock máximo disponible: ${String(Math.max(0, maximum))}`, "info");
      }
      item.cantidad = normalized;
      dependencies.renderSaleProducts();
      renderCart();
    }
    function removeFromCart(id) {
      dependencies.discount.invalidate({ recalculate: false });
      cart = cart.filter((item) => item.id !== id);
      dependencies.renderSaleProducts();
      renderCart();
    }
    function setCart(items) {
      cart = items.map((item) => ({ ...item }));
    }
    function clearCart() {
      cart = [];
    }
    function ensureRequestId() {
      requestId ?? (requestId = createRequestId());
      return requestId;
    }
    function resetRequestId() {
      requestId = null;
    }
    function open() {
      var _a;
      requestId = createRequestId();
      confirming = false;
      const context = dependencies.getContext();
      if (!context.cashRegisterId) {
        dependencies.showToast("Seleccioná una caja antes de vender", "error");
        return;
      }
      if (!dependencies.isCashOpenByCurrentUser() && !(!dependencies.isOnline() && dependencies.restoreOfflineCash())) {
        dependencies.showToast(
          !dependencies.isOnline() ? "Para vender offline, esta caja debe haber sido abierta previamente con internet" : dependencies.hasCashSession() ? "Esta caja está abierta por otro usuario" : "Abrí la caja antes de comenzar a vender",
          "info"
        );
        if (dependencies.isOnline()) dependencies.openCashPanel();
        return;
      }
      cart = [];
      const search = field$2("#venta-buscador");
      if (search) search.value = "";
      resetSale();
      dependencies.renderSaleProducts();
      renderCart();
      (_a = queryOne("#modal-venta")) == null ? void 0 : _a.classList.remove("hidden");
      setTimeout(() => {
        var _a2;
        return (_a2 = field$2("#venta-buscador")) == null ? void 0 : _a2.focus();
      }, 50);
    }
    function close() {
      var _a;
      (_a = queryOne("#modal-venta")) == null ? void 0 : _a.classList.add("hidden");
      cart = [];
    }
    async function confirmSale() {
      var _a;
      if (!cart.length || confirming) return;
      const button2 = queryOne("#btn-cobrar");
      const offline = !dependencies.isOnline();
      const discountRequest = dependencies.discount.getRequest();
      if (offline && discountRequest.tipo && discountRequest.valor > 0) {
        dependencies.showToast("Los descuentos requieren conexión para validar la autorización.", "error");
        return;
      }
      if (!offline && discountRequest.tipo && discountRequest.valor > 0 && !dependencies.discount.isAuthorized()) {
        dependencies.showToast("Autorizá el descuento con un PIN de administrador", "error");
        dependencies.discount.openAuthorization();
        return;
      }
      const totals = calculateTotals();
      let payments;
      try {
        payments = paymentsForSale(totals.total);
        if (offline) dependencies.validateOfflinePayments(payments);
      } catch (error) {
        dependencies.showToast(errorMessage$3(error, "Revisá los medios de pago"), "error");
        return;
      }
      confirming = true;
      if (button2 instanceof HTMLButtonElement) {
        button2.disabled = true;
        button2.textContent = offline ? "Guardando..." : "Cobrando...";
      }
      try {
        const observation = ((_a = field$2("#venta-observacion-v228")) == null ? void 0 : _a.value.trim()) ?? "";
        if (offline) {
          const ticket = await dependencies.registerOfflineSale(cart, payments, totals, observation);
          dependencies.showToast("Venta guardada offline. Se sincronizará automáticamente.", "success");
          dependencies.discount.invalidate({ recalculate: false });
          requestId = null;
          close();
          dependencies.showTicket(ticket);
          dependencies.updateOfflineUi();
          return;
        }
        if (!dependencies.canSell("Tu usuario no tiene permiso para registrar ventas")) return;
        const context = dependencies.getContext();
        if (!context.ready) throw new Error("El contexto del negocio todavía no está cargado");
        if (!context.branchId || !context.cashRegisterId) throw new Error("No hay una caja activa");
        const data = await registerSale(dependencies.client, {
          items: cart,
          payments,
          totals,
          observation: observation || null,
          branchId: context.branchId,
          cashRegisterId: context.cashRegisterId,
          requestId: ensureRequestId()
        });
        dependencies.emitStockChange("venta_profesional");
        dependencies.refreshDependentViews("venta_local");
        await dependencies.reloadProducts();
        dependencies.renderProducts();
        await dependencies.reloadCash();
        const nestedSale = typeof data.venta === "object" && data.venta !== null ? data.venta : null;
        dependencies.showToast(
          `Venta cobrada: ${dependencies.formatCurrency(number$1((nestedSale == null ? void 0 : nestedSale.total) ?? totals.total))}`,
          "success"
        );
        dependencies.discount.invalidate({ recalculate: false });
        requestId = null;
        dependencies.clearPersistedCart();
        close();
        dependencies.showTicket(data);
        dependencies.afterOnlineSale();
      } catch (error) {
        dependencies.showToast(errorMessage$3(error, "No se pudo registrar la venta"), "error");
      } finally {
        confirming = false;
        if (button2 instanceof HTMLButtonElement) dependencies.applyOfflineSaleState();
      }
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#btn-vender")) == null ? void 0 : _a.addEventListener("click", open);
      (_b = queryOne("#btn-cerrar-venta")) == null ? void 0 : _b.addEventListener("click", close);
      (_c = queryOne("#modal-venta .modal-backdrop")) == null ? void 0 : _c.addEventListener("click", close);
      (_d = queryOne("#venta-buscador")) == null ? void 0 : _d.addEventListener("input", dependencies.renderSaleProducts);
      (_e = queryOne("#venta-productos-lista")) == null ? void 0 : _e.addEventListener("click", (event) => {
        const target = event.target;
        const item = target instanceof Element ? target.closest(".venta-producto-item") : null;
        if (!(item instanceof HTMLElement) || item.classList.contains("sin-stock") || !item.dataset.id) return;
        addToCart(item.dataset.id);
      });
      (_f = queryOne("#carrito-items")) == null ? void 0 : _f.addEventListener("click", (event) => {
        const target = event.target;
        const row = target instanceof Element ? target.closest(".carrito-item") : null;
        if (!(row instanceof HTMLElement) || !row.dataset.id || !(target instanceof Element)) return;
        const quantityButton = target.closest("[data-qty]");
        if (quantityButton instanceof HTMLElement) {
          changeQuantity(row.dataset.id, Number.parseInt(quantityButton.dataset.qty ?? "0", 10));
        } else if (target.closest("[data-quitar]")) removeFromCart(row.dataset.id);
      });
      (_g = queryOne("#carrito-items")) == null ? void 0 : _g.addEventListener("change", (event) => {
        const target = event.target;
        const row = target instanceof Element ? target.closest(".carrito-item") : null;
        if (!(row instanceof HTMLElement) || !row.dataset.id || !(target instanceof HTMLInputElement)) return;
        if (target.matches("[data-qty-input]")) {
          setQuantity(row.dataset.id, Number.parseInt(target.value, 10));
        }
      });
      (_h = queryOne("#btn-cobrar")) == null ? void 0 : _h.addEventListener("click", () => void confirmSale());
      queryAll("[data-pay-mode-v228]").forEach((button2) => {
        button2.addEventListener("click", () => {
          activatePaymentMode(button2.getAttribute("data-pay-mode-v228") ?? "single");
        });
      });
      (_i = queryOne("#btn-add-payment-v228")) == null ? void 0 : _i.addEventListener("click", addMixedPayment);
      (_j = queryOne("#mixed-payment-rows-v228")) == null ? void 0 : _j.addEventListener("input", updateRemainingPayment);
      (_k = queryOne("#mixed-payment-rows-v228")) == null ? void 0 : _k.addEventListener("change", updateRemainingPayment);
      (_l = queryOne("#mixed-payment-rows-v228")) == null ? void 0 : _l.addEventListener("click", (event) => {
        const target = event.target;
        const row = target instanceof Element ? target.closest(".mixed-pay-row-v228") : null;
        if (!row || !(target instanceof Element)) return;
        if (target.closest("[data-pay-remove]")) {
          const payments = mixedPaymentsFromDom();
          const index = number$1(row.dataset.payIndex);
          payments.splice(index, 1);
          renderMixedPayments(payments.length ? payments : [{ medio_pago: "Efectivo", monto: 0 }]);
        } else if (target.closest("[data-pay-rest]")) completeRemainingPayment(row);
      });
    }
    return Object.freeze({
      setup,
      open,
      close,
      addToCart,
      changeQuantity,
      setQuantity,
      removeFromCart,
      getCart: () => cart,
      isConfirming: () => confirming,
      setCart,
      clearCart,
      getTotal,
      renderCart,
      calculateTotals,
      updateTotals,
      ensureRequestId,
      resetRequestId
    });
  }
  function field$1(selector) {
    const element2 = queryOne(selector);
    return element2 instanceof HTMLInputElement || element2 instanceof HTMLSelectElement || element2 instanceof HTMLTextAreaElement ? element2 : null;
  }
  function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  }
  function records(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item)) : [];
  }
  function number(value) {
    return Number(value ?? 0);
  }
  function text$1(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }
  function errorMessage$2(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  function createSalesHistoryController(dependencies) {
    let sales = [];
    let currentTicket = null;
    let management = null;
    let setupComplete = false;
    function buildTicketHtml(data) {
      const nestedSale = record(data.venta);
      const sale = Object.keys(nestedSale).length ? nestedSale : data;
      const items = records(data.items).length ? records(data.items) : records(sale.venta_items);
      const payments = records(data.pagos).length ? records(data.pagos) : records(sale.venta_pagos);
      const created = sale.creado ? new Date(text$1(sale.creado)) : /* @__PURE__ */ new Date();
      const itemsHtml = items.map((item) => {
        const quantity = number(item.cantidad);
        const subtotal = number(item.subtotal ?? number(item.precio_unitario) * quantity);
        return `<div class="receipt-item-v228"><div><strong>${String(quantity)}× ${escapeHtml(text$1(item.producto_nombre, "Producto"))}</strong><small>${dependencies.formatCurrency(number(item.precio_unitario))} c/u</small></div><span>${dependencies.formatCurrency(subtotal)}</span></div>`;
      }).join("");
      const paymentsHtml = payments.filter((payment) => payment.operacion !== "devolucion").map(
        (payment) => `<div class="receipt-line-v228"><span>${escapeHtml(text$1(payment.medio_pago))}</span><span>${dependencies.formatCurrency(number(payment.monto))}</span></div>`
      ).join("");
      const status = text$1(sale.estado, "completada");
      const context = dependencies.getContext();
      return `<div class="receipt-v228"><div class="receipt-head-v228"><div class="receipt-brand-v228">VENDIFY</div><strong>${escapeHtml(context.businessName || "Negocio")}</strong><span>${escapeHtml(context.branchName)}${context.cashRegisterName ? ` · ${escapeHtml(context.cashRegisterName)}` : ""}</span></div><div class="receipt-meta-v228"><span>Ticket #${ticketNumber(sale.id)}</span><span>${created.toLocaleString("es-AR")}</span></div>${status !== "completada" ? `<div class="receipt-status-v228">${escapeHtml(saleStatusLabel(status))}</div>` : ""}<div class="receipt-items-v228">${itemsHtml}</div><div class="receipt-totals-v228"><div class="receipt-line-v228"><span>Subtotal</span><span>${dependencies.formatCurrency(number(sale.subtotal ?? sale.total))}</span></div>${number(sale.descuento_total) > 0 ? `<div class="receipt-line-v228"><span>Descuento</span><span>−${dependencies.formatCurrency(number(sale.descuento_total))}</span></div>` : ""}<div class="receipt-line-v228 total"><span>Total</span><strong>${dependencies.formatCurrency(number(sale.total))}</strong></div>${number(sale.total_devuelto) > 0 ? `<div class="receipt-line-v228 refund"><span>Devuelto</span><span>−${dependencies.formatCurrency(number(sale.total_devuelto))}</span></div>` : ""}</div>${paymentsHtml ? `<div class="receipt-payment-v228"><small>Pago</small>${paymentsHtml}</div>` : ""}${sale.observacion ? `<div class="receipt-note-v228"><small>Observación</small><p>${escapeHtml(text$1(sale.observacion))}</p></div>` : ""}<div class="receipt-footer-v228">Gracias por tu compra<small>Gestionado con Vendify</small></div></div>`;
    }
    function showTicket(data) {
      var _a;
      currentTicket = data;
      const preview = queryOne("#ticket-preview-v228");
      if (preview) preview.innerHTML = buildTicketHtml(data);
      (_a = queryOne("#modal-ticket-v228")) == null ? void 0 : _a.classList.remove("hidden");
      if (dependencies.getAutoPrint()) setTimeout(printTicket, 120);
    }
    function closeTicket() {
      var _a;
      (_a = queryOne("#modal-ticket-v228")) == null ? void 0 : _a.classList.add("hidden");
    }
    function printTicket() {
      if (!currentTicket) return;
      const popup = window.open("", "_blank", "width=420,height=720");
      if (!popup) {
        dependencies.showToast("El navegador bloqueó la ventana de impresión", "error");
        return;
      }
      const width = dependencies.getTicketWidth() === 58 ? 58 : 80;
      popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket Vendify</title><style>
      *{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;padding:16px;color:#111;background:#fff}.receipt-v228{max-width:320px;margin:auto;font-size:12px}.receipt-head-v228{text-align:center;display:flex;flex-direction:column;gap:3px}.receipt-brand-v228{font-size:20px;font-weight:800;letter-spacing:1px}.receipt-head-v228 span,.receipt-meta-v228,.receipt-footer-v228 small{font-size:10px;color:#555}.receipt-meta-v228{display:flex;justify-content:space-between;border-top:1px dashed #aaa;border-bottom:1px dashed #aaa;padding:8px 0;margin:10px 0}.receipt-item-v228{display:flex;justify-content:space-between;gap:10px;padding:5px 0}.receipt-item-v228>div{display:flex;flex-direction:column}.receipt-item-v228 small{color:#666}.receipt-totals-v228,.receipt-payment-v228,.receipt-note-v228{border-top:1px dashed #aaa;margin-top:8px;padding-top:8px}.receipt-line-v228{display:flex;justify-content:space-between;gap:12px;padding:2px 0}.receipt-line-v228.total{font-size:15px;padding-top:6px}.receipt-line-v228.refund{color:#b91c1c}.receipt-status-v228{text-align:center;font-weight:700;border:1px solid #111;padding:4px;margin-bottom:8px}.receipt-note-v228 p{margin:4px 0 0}.receipt-footer-v228{text-align:center;border-top:1px dashed #aaa;margin-top:12px;padding-top:10px;display:flex;flex-direction:column;gap:4px}@media print{body{padding:0}.receipt-v228{max-width:none;width:${String(width)}mm}}
    </style></head><body>${buildTicketHtml(currentTicket)}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
      popup.document.close();
    }
    function openManagement(sale, mode) {
      var _a, _b, _c, _d;
      if (!dependencies.isCashOpenByCurrentUser()) {
        dependencies.showToast("Abrí una caja propia antes de realizar reintegros", "info");
        dependencies.openCashPanel();
        return;
      }
      management = { sale, mode };
      const isVoid = mode === "anular";
      const title = queryOne("#return-title-v228");
      const subtitle = queryOne("#return-subtitle-v228");
      if (title) title.textContent = isVoid ? "Anular venta" : "Devolver artículos";
      if (subtitle) subtitle.textContent = isVoid ? "La venta quedará anulada, se restaurará el stock y se registrará el reintegro." : "El stock seleccionado volverá a la sucursal original.";
      (_a = queryOne("#return-items-section-v228")) == null ? void 0 : _a.classList.toggle("hidden", isVoid);
      (_b = queryOne("#return-warning-v228")) == null ? void 0 : _b.classList.toggle("hidden", !isVoid);
      if (isVoid) {
        const warning = queryOne("#return-warning-v228");
        if (warning) warning.innerHTML = "<strong>Esta acción no borra la venta.</strong><span>Quedará registrada como anulada en el historial y en la auditoría.</span>";
      }
      const chargedPayments = records(sale.venta_pagos).filter((payment) => payment.operacion === "cobro");
      const method = text$1((_c = chargedPayments[0]) == null ? void 0 : _c.medio_pago, "Efectivo");
      const methodField = field$1("#return-method-v228");
      if (methodField) methodField.value = ["Efectivo", "Débito", "Crédito", "Transferencia", "Mercado Pago", "Otro"].includes(method) ? method : "Otro";
      const reason = field$1("#return-reason-v228");
      const error = queryOne("#return-error-v228");
      if (reason) reason.value = "";
      if (error) error.textContent = "";
      const container = queryOne("#return-items-v228");
      if (container) {
        container.innerHTML = isVoid ? "" : records(sale.venta_items).map((item) => {
          const available = Math.max(0, number(item.cantidad) - number(item.cantidad_devuelta));
          return `<div class="return-item-v228 ${available <= 0 ? "disabled" : ""}" data-return-item-id="${escapeHtml(text$1(item.id))}" data-return-price="${String(number(item.precio_neto_unitario ?? item.precio_unitario))}"><div class="return-item-copy-v228"><strong>${escapeHtml(text$1(item.producto_nombre))}</strong><small>Disponible para devolver: ${String(available)}</small></div><input type="number" class="return-item-qty-v228" min="0" max="${String(available)}" step="1" value="0" ${available <= 0 ? "disabled" : ""}/></div>`;
        }).join("");
      }
      const submit = queryOne("#btn-submit-return-v228");
      if (submit instanceof HTMLButtonElement) {
        submit.textContent = isVoid ? "Anular y reintegrar" : "Confirmar devolución";
        submit.classList.toggle("btn-danger", isVoid);
        submit.classList.toggle("btn-primary", !isVoid);
      }
      updateReturnTotal();
      (_d = queryOne("#modal-return-v228")) == null ? void 0 : _d.classList.remove("hidden");
    }
    function closeManagement() {
      var _a;
      (_a = queryOne("#modal-return-v228")) == null ? void 0 : _a.classList.add("hidden");
      management = null;
    }
    function updateReturnTotal() {
      const element2 = queryOne("#return-total-v228");
      if (!element2 || !management) return;
      if (management.mode === "anular") {
        element2.textContent = dependencies.formatCurrency(netSaleTotal(management.sale));
        return;
      }
      let total = 0;
      queryAll(".return-item-v228").forEach((row) => {
        const input2 = row.querySelector(".return-item-qty-v228");
        const quantity = input2 instanceof HTMLInputElement ? number(input2.value) : 0;
        total += quantity * number(row.dataset.returnPrice);
      });
      total = Math.min(netSaleTotal(management.sale), Math.round(total * 100) / 100);
      element2.textContent = dependencies.formatCurrency(total);
    }
    async function saveManagement(event) {
      var _a, _b;
      event.preventDefault();
      if (!management) return;
      const reason = ((_a = field$1("#return-reason-v228")) == null ? void 0 : _a.value.trim()) ?? "";
      const method = ((_b = field$1("#return-method-v228")) == null ? void 0 : _b.value) ?? "Efectivo";
      const error = queryOne("#return-error-v228");
      const cashRegisterId = dependencies.getContext().cashRegisterId;
      if (error) error.textContent = "";
      if (reason.length < 2) {
        if (error) error.textContent = "Ingresá el motivo.";
        return;
      }
      if (!cashRegisterId) {
        if (error) error.textContent = "No hay una caja activa.";
        return;
      }
      try {
        if (management.mode === "anular") {
          await voidSale(dependencies.client, text$1(management.sale.id), cashRegisterId, method, reason);
        } else {
          const items = [...queryAll(".return-item-v228")].flatMap((row) => {
            const input2 = row.querySelector(".return-item-qty-v228");
            const quantity = input2 instanceof HTMLInputElement ? number(input2.value) : 0;
            const id = row.dataset.returnItemId;
            return quantity > 0 && id ? [{ item_id: id, cantidad: quantity }] : [];
          });
          if (!items.length) {
            if (error) error.textContent = "Seleccioná al menos un artículo.";
            return;
          }
          await returnSaleItems(dependencies.client, text$1(management.sale.id), items, cashRegisterId, method, reason);
        }
        const mode = management.mode;
        closeManagement();
        dependencies.emitStockChange(mode === "anular" ? "anulacion" : "devolucion");
        await dependencies.reloadProducts();
        dependencies.renderProducts();
        await dependencies.reloadCash();
        await render();
        dependencies.showToast(mode === "anular" ? "Venta anulada y stock restaurado" : "Devolución registrada", "success");
      } catch (caught) {
        if (error) error.textContent = errorMessage$2(caught, "No se pudo gestionar la venta");
      }
    }
    async function render() {
      var _a;
      const container = queryOne("#historial-lista");
      const empty = queryOne("#historial-vacio");
      const summary = queryOne("#historial-resumen");
      if (!container || !empty || !summary) return;
      container.innerHTML = '<p class="hint" style="text-align:center;padding:1rem;">Cargando...</p>';
      empty.classList.add("hidden");
      const range = salesDateRange(((_a = field$1("#historial-rango")) == null ? void 0 : _a.value) ?? "todo");
      try {
        sales = await listSales(dependencies.client, dependencies.getContext().branchId, range.desde, range.hasta);
      } catch (error) {
        console.error("[Ventas] historial:", error);
        container.innerHTML = "";
        dependencies.showToast("No se pudo cargar el historial", "error");
        return;
      }
      if (!sales.length) {
        container.innerHTML = "";
        summary.innerHTML = "";
        empty.classList.remove("hidden");
        return;
      }
      const activeSales = sales.filter((sale) => sale.estado !== "anulada");
      const netTotal = sales.reduce((accumulator, sale) => accumulator + netSaleTotal(sale), 0);
      const returnedTotal = sales.reduce((accumulator, sale) => accumulator + number(sale.total_devuelto), 0);
      summary.innerHTML = `<span><strong>${String(activeSales.length)}</strong> ticket${activeSales.length === 1 ? "" : "s"} netos</span><span><strong>${dependencies.formatCurrency(netTotal)}</strong> vendido neto</span>${returnedTotal > 0 ? `<span><strong>${dependencies.formatCurrency(returnedTotal)}</strong> devuelto</span>` : ""}`;
      const canManage = ["owner", "admin", "manager"].includes(dependencies.getContext().role);
      container.innerHTML = sales.map((sale) => {
        const date = new Date(text$1(sale.creado));
        const dateText = date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
        const timeText = date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
        const items = [...records(sale.venta_items)].sort(
          (left, right) => text$1(left.producto_nombre).localeCompare(text$1(right.producto_nombre), "es")
        );
        const itemsHtml = items.map((item) => {
          const returned = number(item.cantidad_devuelta);
          return `<div class="ticket-item-row"><span>${String(number(item.cantidad))}× ${escapeHtml(text$1(item.producto_nombre))}${returned > 0 ? `<small class="ticket-returned-v228"> · ${String(returned)} devuelto${returned === 1 ? "" : "s"}</small>` : ""}</span><span>${dependencies.formatCurrency(number(item.subtotal))}</span></div>`;
        }).join("");
        const net = netSaleTotal(sale);
        const payments = salePaymentsText(records(sale.venta_pagos), "cobro", dependencies.formatCurrency);
        const refunds = salePaymentsText(records(sale.venta_pagos), "devolucion", dependencies.formatCurrency);
        const status = text$1(sale.estado, "completada");
        const canReturn = canManage && !["devuelta", "anulada"].includes(status) && net > 0.01;
        const canVoid = canManage && status === "completada" && number(sale.total_devuelto) <= 0.01;
        return `<details class="ticket-card ticket-card-v228 ${escapeHtml(status)}"><summary><span class="ticket-fecha">${dateText} · ${timeText}</span><span class="sale-status-v228 ${escapeHtml(status)}">${saleStatusLabel(status)}</span>${sale.medio_pago ? `<span class="ticket-medio">${escapeHtml(text$1(sale.medio_pago))}</span>` : ""}<span class="ticket-total">${dependencies.formatCurrency(net)}</span></summary><div class="ticket-detail-v228"><div class="ticket-items">${itemsHtml || '<p class="hint">Sin detalle de artículos</p>'}</div><div class="ticket-finance-v228"><div><span>Subtotal</span><strong>${dependencies.formatCurrency(number(sale.subtotal ?? sale.total))}</strong></div>${number(sale.descuento_total) > 0 ? `<div><span>Descuento</span><strong>−${dependencies.formatCurrency(number(sale.descuento_total))}</strong></div>` : ""}<div><span>Total original</span><strong>${dependencies.formatCurrency(number(sale.total))}</strong></div>${number(sale.total_devuelto) > 0 ? `<div class="refund"><span>Devuelto</span><strong>−${dependencies.formatCurrency(number(sale.total_devuelto))}</strong></div>` : ""}<div class="net"><span>Neto</span><strong>${dependencies.formatCurrency(net)}</strong></div></div>${payments ? `<p class="ticket-payment-note-v228"><strong>Cobro:</strong> ${escapeHtml(payments)}</p>` : ""}${refunds ? `<p class="ticket-payment-note-v228 refund"><strong>Reintegros:</strong> ${escapeHtml(refunds)}</p>` : ""}${sale.observacion ? `<p class="ticket-observation-v228">${escapeHtml(text$1(sale.observacion))}</p>` : ""}<div class="ticket-actions-row-v228"><button type="button" class="btn btn-secondary btn-sm" data-sale-action-v228="ticket" data-id="${escapeHtml(text$1(sale.id))}">🖨 Ticket</button>${canReturn ? `<button type="button" class="btn btn-secondary btn-sm" data-sale-action-v228="return" data-id="${escapeHtml(text$1(sale.id))}">↩ Devolver</button>` : ""}${canVoid ? `<button type="button" class="btn btn-danger btn-sm" data-sale-action-v228="void" data-id="${escapeHtml(text$1(sale.id))}">Anular</button>` : ""}</div></div></details>`;
      }).join("");
    }
    async function open() {
      var _a;
      (_a = queryOne("#modal-historial")) == null ? void 0 : _a.classList.remove("hidden");
      await render();
    }
    function close() {
      var _a;
      (_a = queryOne("#modal-historial")) == null ? void 0 : _a.classList.add("hidden");
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#btn-historial")) == null ? void 0 : _a.addEventListener("click", () => void open());
      (_b = queryOne("#btn-cerrar-historial")) == null ? void 0 : _b.addEventListener("click", close);
      (_c = queryOne("#modal-historial .modal-backdrop")) == null ? void 0 : _c.addEventListener("click", close);
      (_d = queryOne("#historial-rango")) == null ? void 0 : _d.addEventListener("change", () => void render());
      (_e = queryOne("#btn-close-ticket-v228")) == null ? void 0 : _e.addEventListener("click", closeTicket);
      (_f = queryOne("#btn-close-ticket-bottom-v228")) == null ? void 0 : _f.addEventListener("click", closeTicket);
      (_g = queryOne("#modal-ticket-v228 .modal-backdrop")) == null ? void 0 : _g.addEventListener("click", closeTicket);
      (_h = queryOne("#btn-print-ticket-v228")) == null ? void 0 : _h.addEventListener("click", printTicket);
      (_i = queryOne("#historial-lista")) == null ? void 0 : _i.addEventListener("click", (event) => {
        const target = event.target;
        const button2 = target instanceof Element ? target.closest("[data-sale-action-v228]") : null;
        if (!(button2 instanceof HTMLElement)) return;
        event.preventDefault();
        event.stopPropagation();
        const sale = sales.find((item) => item.id === button2.dataset.id);
        if (!sale) return;
        if (button2.dataset.saleActionV228 === "ticket") {
          showTicket({ venta: sale, items: records(sale.venta_items), pagos: records(sale.venta_pagos) });
        } else if (button2.dataset.saleActionV228 === "return") openManagement(sale, "devolver");
        else if (button2.dataset.saleActionV228 === "void") openManagement(sale, "anular");
      });
      (_j = queryOne("#form-return-v228")) == null ? void 0 : _j.addEventListener("submit", (event) => void saveManagement(event));
      (_k = queryOne("#return-items-v228")) == null ? void 0 : _k.addEventListener("input", updateReturnTotal);
      (_l = queryOne("#btn-close-return-v228")) == null ? void 0 : _l.addEventListener("click", closeManagement);
      (_m = queryOne("#btn-cancel-return-v228")) == null ? void 0 : _m.addEventListener("click", closeManagement);
      (_n = queryOne("#modal-return-v228 .modal-backdrop")) == null ? void 0 : _n.addEventListener("click", closeManagement);
    }
    return Object.freeze({ setup, open, close, render, showTicket, getSales: () => [...sales] });
  }
  window.VendifySalesV232 = Object.freeze({
    createDiscountController,
    createPosController,
    createHistoryController: createSalesHistoryController,
    normalizeDiscountRequest,
    authorizationMatches: discountAuthorizationMatches,
    calculateTotals: calculateSaleTotals,
    normalizePayments: normalizeSalePayments,
    statusLabel: saleStatusLabel,
    netTotal: netSaleTotal,
    paymentsText: salePaymentsText,
    ticketNumber,
    dateRange: salesDateRange,
    registerSale,
    authorizeDiscount,
    getDiscountPinState,
    configureDiscountPin,
    voidSale,
    returnSaleItems,
    listSales
  });
  const STOCK_MANAGEMENT_DEFAULT_ROLES = /* @__PURE__ */ new Set(["owner", "admin", "manager"]);
  function isRecord$1(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function toTeamMembers(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => {
      if (!isRecord$1(item)) return false;
      return typeof item.membership_id === "string" && typeof item.rol === "string";
    });
  }
  function stockPermissionMap(value) {
    const map = /* @__PURE__ */ new Map();
    if (!Array.isArray(value)) return map;
    for (const item of value) {
      if (!isRecord$1(item) || typeof item.membership_id !== "string") continue;
      map.set(item.membership_id, item.puede_gestionar_stock === true);
    }
    return map;
  }
  function errorMessage$1(error, fallback) {
    if (error == null ? void 0 : error.message) return error.message;
    return fallback;
  }
  async function getAdminBusiness(authenticatedClient) {
    const { data, error } = await authenticatedClient.rpc("obtener_negocio_admin_actual");
    if (error) throw new Error(errorMessage$1(error, "No se pudo cargar el negocio"));
    return data;
  }
  async function listTeam(authenticatedClient) {
    const [teamResult, permissionResult] = await Promise.all([
      authenticatedClient.rpc("listar_equipo_v3"),
      authenticatedClient.rpc("listar_permisos_stock_equipo_v1")
    ]);
    if (teamResult.error) {
      throw new Error(errorMessage$1(teamResult.error, "No se pudo cargar el equipo"));
    }
    const permissions = stockPermissionMap(permissionResult.data);
    const members = toTeamMembers(teamResult.data).map((member) => ({
      ...member,
      puede_gestionar_stock: permissions.has(member.membership_id) ? permissions.get(member.membership_id) : STOCK_MANAGEMENT_DEFAULT_ROLES.has(member.rol)
    }));
    return {
      members,
      stockPermissionWarning: permissionResult.error
    };
  }
  async function updateStockPermission(authenticatedClient, membershipId, allow) {
    const { data, error } = await authenticatedClient.rpc(
      "actualizar_permiso_stock_miembro_v1",
      {
        p_membership_id: membershipId,
        p_permitir: allow
      }
    );
    const response = isRecord$1(data) ? data : null;
    if (error || (response == null ? void 0 : response.ok) === false) {
      const responseMessage = typeof (response == null ? void 0 : response.message) === "string" ? response.message : null;
      return {
        ok: false,
        errorMessage: (error == null ? void 0 : error.message) ?? responseMessage ?? "No se pudo actualizar el permiso de stock"
      };
    }
    return { ok: true, errorMessage: null, data };
  }
  async function updateMemberRole(authenticatedClient, membershipId, role) {
    const { data, error } = await authenticatedClient.rpc("actualizar_rol_miembro_v2", {
      p_membership_id: membershipId,
      p_rol: role
    });
    return error ? { ok: false, errorMessage: errorMessage$1(error, "No se pudo actualizar el rol") } : { ok: true, errorMessage: null, data };
  }
  async function setMemberActive(authenticatedClient, membershipId, active) {
    const { data, error } = await authenticatedClient.rpc("cambiar_estado_miembro_v3", {
      p_membership_id: membershipId,
      p_activo: active
    });
    return error ? { ok: false, errorMessage: errorMessage$1(error, "No se pudo actualizar el usuario") } : { ok: true, errorMessage: null, data };
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function dataErrorMessage(data) {
    if (!isRecord(data)) return null;
    for (const key of ["error", "message"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
    return null;
  }
  function isResponseContext(value) {
    return isRecord(value) && typeof value.clone === "function";
  }
  async function errorContextMessage(error) {
    if (!isResponseContext(error == null ? void 0 : error.context)) return null;
    try {
      return dataErrorMessage(await error.context.clone().json());
    } catch {
      return null;
    }
  }
  async function invokeTeamFunction(functions, name, body, fallback) {
    const { data, error } = await functions.invoke(name, { body });
    const backendMessage = dataErrorMessage(data);
    const contextMessage = await errorContextMessage(error);
    if (error || backendMessage) {
      return {
        ok: false,
        errorMessage: backendMessage ?? contextMessage ?? (error == null ? void 0 : error.message) ?? fallback,
        data
      };
    }
    return { ok: true, errorMessage: null, data };
  }
  async function createEmployee(functions, input2) {
    return invokeTeamFunction(
      functions,
      "crear-empleado",
      {
        nombre: input2.nombre,
        username: input2.username,
        rol: input2.rol,
        password: input2.password
      },
      "No se pudo crear el empleado"
    );
  }
  async function updateEmployee(functions, input2) {
    return invokeTeamFunction(
      functions,
      "gestionar-empleado",
      {
        action: "update",
        membership_id: input2.membershipId,
        nombre: input2.nombre,
        username: input2.username,
        rol: input2.rol
      },
      "No se pudo actualizar"
    );
  }
  async function deleteEmployee(functions, membershipId) {
    return invokeTeamFunction(
      functions,
      "gestionar-empleado",
      {
        action: "delete",
        membership_id: membershipId
      },
      "No se pudo eliminar el usuario"
    );
  }
  async function resetEmployeePassword(functions, membershipId, password) {
    return invokeTeamFunction(
      functions,
      "gestionar-empleado",
      {
        action: "reset_password",
        membership_id: membershipId,
        password
      },
      "No se pudo reiniciar la contraseña"
    );
  }
  function field(selector) {
    const element2 = queryOne(selector);
    return element2 instanceof HTMLInputElement || element2 instanceof HTMLSelectElement ? element2 : null;
  }
  function text(value, fallback = "") {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
  }
  function memberValue(member, key) {
    return member[key];
  }
  function errorMessage(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  function generateTemporaryPassword() {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
    const values = new Uint32Array(12);
    crypto.getRandomValues(values);
    return Array.from(values, (value) => characters[value % characters.length]).join("");
  }
  function renderTeamMembers(members, currentUserId, currentRole) {
    return members.map((member) => {
      const owner = member.rol === "owner";
      const currentUser = text(memberValue(member, "user_id")) === currentUserId;
      const usernameValue = text(memberValue(member, "username"));
      const name = text(memberValue(member, "nombre"));
      const email = text(memberValue(member, "email"));
      const active = memberValue(member, "activo") === true;
      const canManageStock = memberValue(member, "puede_gestionar_stock") === true;
      const username = usernameValue ? `<span class="employee-username-badge">@${escapeHtml(usernameValue)}</span>` : '<span class="employee-username-badge">Email</span>';
      const roleControl = owner ? '<span class="equipo-role-owner">Propietario</span>' : `
        <select class="select equipo-role-select" data-membership-id="${escapeHtml(member.membership_id)}" ${currentUser ? "disabled" : ""}>
          <option value="cashier" ${member.rol === "cashier" ? "selected" : ""}>Cajero</option>
          <option value="manager" ${member.rol === "manager" ? "selected" : ""}>Encargado</option>
          <option value="admin" ${member.rol === "admin" ? "selected" : ""}>Administrador</option>
        </select>`;
      const actions = !owner && !currentUser ? `
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
           </button>` : ""}` : "";
      return `
      <div class="equipo-item">
        <div class="equipo-persona">
          <div class="equipo-email">${escapeHtml(name || email || "Usuario")}${currentUser ? " · Vos" : ""}</div>
          <div class="equipo-meta">
            ${username}
            <span class="equipo-status ${active ? "active" : "inactive"}">${active ? "Activo" : "Inactivo"}</span>
            ${owner ? '<span class="equipo-permission-badge-v23014 enabled">Stock manual</span>' : `<span class="equipo-permission-badge-v23014 ${canManageStock ? "enabled" : "disabled"}">
                    Stock manual: ${canManageStock ? "Sí" : "No"}
                  </span>`}
          </div>
        </div>
        <div>${roleControl}</div>
        <div class="equipo-actions">${actions}</div>
      </div>`;
    }).join("");
  }
  function createTeamController(dependencies) {
    let setupComplete = false;
    function context() {
      return dependencies.getContext();
    }
    function ownerCanSetStock() {
      var _a;
      return ((_a = context().membership) == null ? void 0 : _a.role) === "owner";
    }
    async function members() {
      const result = await listTeam(dependencies.client);
      if (result.stockPermissionWarning) {
        console.warn("[Equipo] permisos stock no disponibles:", result.stockPermissionWarning);
      }
      return result.members;
    }
    async function setStockPermission(membershipId, allow) {
      const result = await updateStockPermission(dependencies.client, membershipId, allow);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? "No se pudo actualizar el permiso de stock");
      }
      return result.data;
    }
    async function open() {
      var _a, _b;
      if (!dependencies.requirePermission(
        "manageEmployees",
        "No tenés permiso para administrar el equipo"
      )) return;
      const allowStock = ownerCanSetStock();
      const permission = field("#equipo-permiso-stock");
      if (permission instanceof HTMLInputElement) permission.disabled = !allowStock;
      (_a = queryOne("#equipo-permiso-stock-hint")) == null ? void 0 : _a.classList.toggle("hidden", allowStock);
      (_b = queryOne("#modal-equipo")) == null ? void 0 : _b.classList.remove("hidden");
      try {
        const business = await getAdminBusiness(dependencies.client);
        const code = typeof business === "object" && business !== null ? text(business.codigo_acceso, "—") : "—";
        const codeElement = queryOne("#equipo-business-code");
        if (codeElement) codeElement.textContent = code || "—";
      } catch (error) {
        dependencies.showToast(errorMessage(error, "No se pudo cargar el negocio"), "error");
      }
      await render();
    }
    function close() {
      var _a;
      (_a = queryOne("#modal-equipo")) == null ? void 0 : _a.classList.add("hidden");
    }
    async function render() {
      var _a, _b;
      const list = queryOne("#equipo-lista");
      if (!list) return;
      list.innerHTML = '<p class="hint" style="text-align:center;padding:1rem;">Cargando equipo...</p>';
      try {
        const people = await members();
        list.innerHTML = renderTeamMembers(
          people,
          ((_a = context().user) == null ? void 0 : _a.id) ?? null,
          ((_b = context().membership) == null ? void 0 : _b.role) ?? "cashier"
        );
      } catch (error) {
        list.innerHTML = "";
        dependencies.showToast(errorMessage(error, "No se pudo cargar el equipo"), "error");
      }
    }
    async function createFromForm(event) {
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
      const button2 = queryOne("#btn-crear-empleado");
      if (!(nameField instanceof HTMLInputElement) || !(usernameField instanceof HTMLInputElement) || !(roleField instanceof HTMLSelectElement) || !(passwordField instanceof HTMLInputElement) || !errorElement || !(button2 instanceof HTMLButtonElement)) return;
      const name = nameField.value.trim();
      const username = normalizeInternalLogin(usernameField.value);
      const role = roleField.value;
      const password = passwordField.value;
      const permission = field("#equipo-permiso-stock");
      const requestedStock = ownerCanSetStock() && permission instanceof HTMLInputElement && permission.checked;
      errorElement.textContent = "";
      button2.disabled = true;
      button2.textContent = "Creando...";
      const result = await createEmployee(
        dependencies.functions,
        { nombre: name, username, rol: role, password }
      );
      button2.disabled = false;
      button2.textContent = "Crear empleado";
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
    async function changeRole(select) {
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
    async function changeActive(button2) {
      const active = button2.dataset.activo === "1";
      const result = await setMemberActive(dependencies.client, button2.dataset.id ?? "", active);
      if (!result.ok) {
        dependencies.showToast(result.errorMessage ?? "No se pudo actualizar el usuario", "error");
        return;
      }
      dependencies.showToast(active ? "Usuario activado" : "Usuario desactivado", "success");
      await render();
    }
    async function remove(button2) {
      var _a;
      if (!ownerCanSetStock()) {
        dependencies.showToast("Solo el propietario puede eliminar usuarios", "error");
        return;
      }
      const name = ((_a = button2.dataset.nombre) == null ? void 0 : _a.trim()) ? button2.dataset.nombre : "este empleado";
      if (!await dependencies.confirm(
        "Eliminar usuario",
        `¿Eliminar definitivamente a ${name}? Esta acción elimina su acceso a Vendify.`
      )) return;
      const result = await deleteEmployee(dependencies.functions, button2.dataset.id ?? "");
      if (!result.ok) {
        dependencies.showToast(result.errorMessage ?? "No se pudo eliminar el usuario", "error");
        return;
      }
      dependencies.showToast("Usuario eliminado definitivamente", "success");
      await render();
    }
    function openEditor(button2) {
      var _a, _b;
      const membershipId = field("#editar-membership-id");
      const name = field("#editar-empleado-nombre");
      const username = field("#editar-empleado-username");
      const role = field("#editar-empleado-rol");
      if (membershipId) membershipId.value = button2.dataset.id ?? "";
      if (name) name.value = button2.dataset.nombre ?? "";
      if (username) username.value = button2.dataset.username ?? "";
      if (role) role.value = button2.dataset.rol ?? "cashier";
      const permission = field("#editar-empleado-permiso-stock");
      const allowStock = ownerCanSetStock();
      if (permission instanceof HTMLInputElement) {
        permission.checked = button2.dataset.stock === "1";
        permission.disabled = !allowStock;
      }
      (_a = queryOne("#editar-stock-owner-hint")) == null ? void 0 : _a.classList.toggle("hidden", allowStock);
      const error = queryOne("#editar-empleado-error");
      if (error) error.textContent = "";
      (_b = queryOne("#modal-editar-empleado")) == null ? void 0 : _b.classList.remove("hidden");
    }
    function closeEditor() {
      var _a;
      (_a = queryOne("#modal-editar-empleado")) == null ? void 0 : _a.classList.add("hidden");
    }
    async function saveEditor(event) {
      var _a, _b, _c, _d;
      event.preventDefault();
      const membershipId = ((_a = field("#editar-membership-id")) == null ? void 0 : _a.value) ?? "";
      const name = ((_b = field("#editar-empleado-nombre")) == null ? void 0 : _b.value.trim()) ?? "";
      const username = normalizeInternalLogin(((_c = field("#editar-empleado-username")) == null ? void 0 : _c.value) ?? "");
      const role = ((_d = field("#editar-empleado-rol")) == null ? void 0 : _d.value) ?? "cashier";
      const permission = field("#editar-empleado-permiso-stock");
      const stock = permission instanceof HTMLInputElement && permission.checked;
      const errorElement = queryOne("#editar-empleado-error");
      const button2 = queryOne("#btn-guardar-editar-empleado");
      if (!errorElement || !(button2 instanceof HTMLButtonElement)) return;
      errorElement.textContent = "";
      button2.disabled = true;
      button2.textContent = "Guardando...";
      const result = await updateEmployee(
        dependencies.functions,
        { membershipId, nombre: name, username, rol: role }
      );
      button2.disabled = false;
      button2.textContent = "Guardar cambios";
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
    function openPasswordReset(button2) {
      var _a, _b;
      const membershipId = field("#reset-membership-id");
      const password = field("#reset-empleado-password");
      if (membershipId) membershipId.value = button2.dataset.id ?? "";
      if (password) password.value = generateTemporaryPassword();
      const info = queryOne("#reset-empleado-info");
      const name = ((_a = button2.dataset.nombre) == null ? void 0 : _a.trim()) ? button2.dataset.nombre : "el empleado";
      if (info) info.textContent = `Nueva contraseña para ${name}.`;
      const error = queryOne("#reset-empleado-error");
      if (error) error.textContent = "";
      (_b = queryOne("#modal-reset-empleado")) == null ? void 0 : _b.classList.remove("hidden");
    }
    function closePasswordReset() {
      var _a;
      (_a = queryOne("#modal-reset-empleado")) == null ? void 0 : _a.classList.add("hidden");
    }
    async function savePasswordReset(event) {
      var _a, _b;
      event.preventDefault();
      const errorElement = queryOne("#reset-empleado-error");
      if (!errorElement) return;
      errorElement.textContent = "";
      const result = await resetEmployeePassword(
        dependencies.functions,
        ((_a = field("#reset-membership-id")) == null ? void 0 : _a.value) ?? "",
        ((_b = field("#reset-empleado-password")) == null ? void 0 : _b.value) ?? ""
      );
      if (!result.ok) {
        errorElement.textContent = result.errorMessage ?? "No se pudo reiniciar la contraseña";
        return;
      }
      closePasswordReset();
      dependencies.showToast("Contraseña del empleado actualizada", "success");
      await render();
    }
    function setup() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s;
      if (setupComplete) return;
      setupComplete = true;
      (_a = queryOne("#btn-equipo")) == null ? void 0 : _a.addEventListener("click", () => {
        void open();
      });
      (_b = queryOne("#btn-cerrar-equipo")) == null ? void 0 : _b.addEventListener("click", close);
      (_c = queryOne("#modal-equipo .modal-backdrop")) == null ? void 0 : _c.addEventListener("click", close);
      (_d = queryOne("#form-crear-empleado")) == null ? void 0 : _d.addEventListener("submit", (event) => {
        void createFromForm(event);
      });
      const createPermission = field("#equipo-permiso-stock");
      const createRole = field("#equipo-rol");
      if (createPermission instanceof HTMLInputElement) {
        const allowStock = ownerCanSetStock();
        createPermission.disabled = !allowStock;
        (_e = queryOne("#equipo-permiso-stock-hint")) == null ? void 0 : _e.classList.toggle("hidden", allowStock);
      }
      createRole == null ? void 0 : createRole.addEventListener("change", () => {
        if (!(createPermission instanceof HTMLInputElement) || !ownerCanSetStock()) return;
        createPermission.checked = ["manager", "admin"].includes(createRole.value);
      });
      (_f = queryOne("#btn-refrescar-equipo")) == null ? void 0 : _f.addEventListener("click", () => {
        void render();
      });
      (_g = queryOne("#btn-generar-password")) == null ? void 0 : _g.addEventListener("click", () => {
        const password = field("#equipo-password");
        if (password) password.value = generateTemporaryPassword();
      });
      (_h = queryOne("#btn-copy-business-code")) == null ? void 0 : _h.addEventListener("click", () => {
        var _a2, _b2;
        const code = (_b2 = (_a2 = queryOne("#equipo-business-code")) == null ? void 0 : _a2.textContent) == null ? void 0 : _b2.trim();
        if (code && code !== "—") {
          void navigator.clipboard.writeText(code).then(() => {
            dependencies.showToast("Código copiado", "success");
          });
        }
      });
      (_i = queryOne("#form-editar-empleado")) == null ? void 0 : _i.addEventListener("submit", (event) => {
        void saveEditor(event);
      });
      (_j = queryOne("#btn-cerrar-editar-empleado")) == null ? void 0 : _j.addEventListener("click", closeEditor);
      (_k = queryOne("#btn-cancelar-editar-empleado")) == null ? void 0 : _k.addEventListener("click", closeEditor);
      (_l = queryOne("#modal-editar-empleado .modal-backdrop")) == null ? void 0 : _l.addEventListener("click", closeEditor);
      (_m = queryOne("#form-reset-empleado")) == null ? void 0 : _m.addEventListener("submit", (event) => {
        void savePasswordReset(event);
      });
      (_n = queryOne("#btn-cerrar-reset-empleado")) == null ? void 0 : _n.addEventListener("click", closePasswordReset);
      (_o = queryOne("#btn-cancelar-reset-empleado")) == null ? void 0 : _o.addEventListener("click", closePasswordReset);
      (_p = queryOne("#modal-reset-empleado .modal-backdrop")) == null ? void 0 : _p.addEventListener("click", closePasswordReset);
      (_q = queryOne("#btn-generar-reset-password")) == null ? void 0 : _q.addEventListener("click", () => {
        const password = field("#reset-empleado-password");
        if (password) password.value = generateTemporaryPassword();
      });
      (_r = queryOne("#equipo-lista")) == null ? void 0 : _r.addEventListener("change", (event) => {
        const target = event.target instanceof Element ? event.target.closest(".equipo-role-select") : null;
        if (target instanceof HTMLSelectElement) void changeRole(target);
      });
      (_s = queryOne("#equipo-lista")) == null ? void 0 : _s.addEventListener("click", (event) => {
        const button2 = event.target instanceof Element ? event.target.closest("[data-equipo-action]") : null;
        if (!(button2 instanceof HTMLElement)) return;
        const action = button2.dataset.equipoAction;
        if (action === "toggle-member") void changeActive(button2);
        else if (action === "edit-member") openEditor(button2);
        else if (action === "reset-password") openPasswordReset(button2);
        else if (action === "delete-member") void remove(button2);
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
  window.VendifyTeamV232 = Object.freeze({
    createController: createTeamController,
    getAdminBusiness,
    listTeam,
    updateStockPermission,
    updateMemberRole,
    setMemberActive,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    resetEmployeePassword
  });
  const TOAST_TYPES = ["success", "error", "info", "warning"];
  const DEFAULT_TOAST_TYPE = "info";
  function normalizeToastType(type) {
    return typeof type === "string" && TOAST_TYPES.includes(type) ? type : DEFAULT_TOAST_TYPE;
  }
  function showToast(message2, type = "success", environment = {
    document,
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs)
  }) {
    const container = environment.document.querySelector("#toast-container");
    if (!container) return false;
    const toast = environment.document.createElement("div");
    toast.className = `toast ${normalizeToastType(type)}`;
    toast.textContent = message2;
    container.appendChild(toast);
    environment.schedule(() => {
      toast.classList.add("leaving");
      environment.schedule(() => {
        toast.remove();
      }, 250);
    }, 2600);
    return true;
  }
  function normalizeTheme(value) {
    return value === "light" ? "light" : "dark";
  }
  function renderTheme(theme, documentRef) {
    documentRef.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "");
    const icon = documentRef.querySelector("#theme-icon");
    if (icon) icon.textContent = theme === "light" ? "🌙" : "☀️";
  }
  function loadTheme(key, environment = { document, storage: localStorage }) {
    const theme = normalizeTheme(environment.storage.getItem(key));
    renderTheme(theme, environment.document);
    return theme;
  }
  function toggleTheme(key, environment = { document, storage: localStorage }) {
    const current = environment.document.documentElement.getAttribute("data-theme");
    const theme = current === "light" ? "dark" : "light";
    environment.storage.setItem(key, theme);
    renderTheme(theme, environment.document);
    return theme;
  }
  const destructiveTerms = /eliminar|borrar|anular|desactivar|cerrar sesión|salir de vendify/i;
  let dismissActiveConfirmation = null;
  function requiredElement(documentRef, selector) {
    const element2 = documentRef.querySelector(selector);
    if (!element2) throw new Error(`Falta el elemento de confirmación ${selector}`);
    return element2;
  }
  function isDestructiveConfirmation(title, message2, danger) {
    return typeof danger === "boolean" ? danger : destructiveTerms.test(`${title} ${message2}`);
  }
  function showConfirmation(title, message2, { okText = null, cancelText = "Cancelar", danger = null } = {}, documentRef = document) {
    const destructive = isDestructiveConfirmation(title, message2, danger);
    const modal = requiredElement(documentRef, "#modal-confirm");
    const okButton = requiredElement(documentRef, "#btn-confirm-ok");
    const cancelButton = requiredElement(documentRef, "#btn-confirm-cancel");
    const closeButton = requiredElement(documentRef, "#btn-cerrar-confirm");
    requiredElement(documentRef, "#confirm-titulo").textContent = title;
    requiredElement(documentRef, "#confirm-mensaje").textContent = message2;
    okButton.textContent = okText ?? (destructive ? "Confirmar" : "Aceptar");
    okButton.className = `btn ${destructive ? "btn-danger" : "btn-primary"}`;
    cancelButton.textContent = cancelText;
    modal.classList.remove("hidden");
    return new Promise((resolve) => {
      const close = (accepted) => {
        modal.classList.add("hidden");
        okButton.onclick = null;
        cancelButton.onclick = null;
        closeButton.onclick = null;
        dismissActiveConfirmation = null;
        resolve(accepted);
      };
      dismissActiveConfirmation == null ? void 0 : dismissActiveConfirmation();
      dismissActiveConfirmation = () => {
        close(false);
      };
      okButton.onclick = () => {
        close(true);
      };
      cancelButton.onclick = () => {
        close(false);
      };
      closeButton.onclick = () => {
        close(false);
      };
    });
  }
  function dismissConfirmation() {
    dismissActiveConfirmation == null ? void 0 : dismissActiveConfirmation();
  }
  window.VendifyCoreV232 = Object.freeze({
    queryOne,
    queryAll,
    escapeHtml,
    formatArs,
    productDisplayName,
    showToast,
    loadTheme,
    toggleTheme,
    showConfirmation,
    dismissConfirmation
  });
})();
