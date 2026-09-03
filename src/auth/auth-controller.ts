import { queryAll, queryOne } from "../core/dom.js";
import {
  registerOwner,
  requestPasswordReset,
  signInEmployee,
  signInOwner,
  signOut,
  updatePassword,
  type AuthClientPort
} from "./auth-service.js";
import {
  initializeAuthLifecycle,
  type AuthLifecycleClientPort,
  type AuthSessionLike
} from "./session-lifecycle.js";
import { showAuthMessage, showAuthPanel } from "./ui.js";

export interface AuthControllerDependencies {
  readonly auth: AuthClientPort & AuthLifecycleClientPort;
  readonly showApp: (session: AuthSessionLike) => void | Promise<void>;
  readonly beforeSignOut: () => void;
  readonly handleSignedOut: () => void | Promise<void>;
  readonly showToast: (message: string, type?: "error" | "info" | "success") => void;
  readonly icon: (name: string) => string;
}

export interface AuthController {
  readonly setup: () => void;
  readonly initialize: () => Promise<void>;
  readonly getSession: () => AuthSessionLike | null;
  readonly signOut: () => Promise<void>;
}

function input(selector: string): HTMLInputElement | null {
  const element = queryOne(selector);
  return element instanceof HTMLInputElement ? element : null;
}

function button(selector: string): HTMLButtonElement | null {
  const element = queryOne(selector);
  return element instanceof HTMLButtonElement ? element : null;
}

function setButtonState(
  element: HTMLButtonElement,
  disabled: boolean,
  text: string
): void {
  element.disabled = disabled;
  element.textContent = text;
}

export function createAuthController(
  dependencies: AuthControllerDependencies
): AuthController {
  let session: AuthSessionLike | null = null;
  let recoveryActive = false;
  let setupComplete = false;

  function getSession(): AuthSessionLike | null {
    return session;
  }

  function showLogin(): void {
    queryOne("#auth-screen")?.classList.remove("hidden");
    queryOne(".app")?.classList.add("hidden");
    if (!recoveryActive) showAuthPanel("owner");
  }

  async function initialize(): Promise<void> {
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

  async function ownerSignIn(event: Event): Promise<void> {
    event.preventDefault();
    const submit = button("#btn-login");
    const error = queryOne("#login-error");
    if (!submit || !error) return;
    error.textContent = "";
    setButtonState(submit, true, "Ingresando...");
    const result = await signInOwner(
      dependencies.auth,
      input("#login-email")?.value.trim(),
      input("#login-password")?.value ?? ""
    );
    setButtonState(submit, false, "Iniciar sesión");
    if (!result.ok) error.textContent = result.errorMessage ?? "";
  }

  async function employeeSignIn(event: Event): Promise<void> {
    event.preventDefault();
    const submit = button("#btn-employee-login");
    const error = queryOne("#employee-login-error");
    if (!submit || !error) return;
    error.textContent = "";
    setButtonState(submit, true, "Ingresando...");
    const result = await signInEmployee(
      dependencies.auth,
      input("#employee-business-code")?.value.trim() ?? "",
      input("#employee-username")?.value.trim() ?? "",
      input("#employee-password")?.value ?? ""
    );
    setButtonState(submit, false, "Entrar a Vendify");
    if (!result.ok) error.textContent = result.errorMessage ?? "";
  }

  async function register(event: Event): Promise<void> {
    event.preventDefault();
    const submit = button("#btn-register");
    const error = queryOne("#register-error");
    if (!submit || !error) return;
    error.textContent = "";
    setButtonState(submit, true, "Creando cuenta...");
    const result = await registerOwner(dependencies.auth, {
      businessName: input("#register-business")?.value.trim(),
      email: input("#register-email")?.value.trim(),
      password: input("#register-password")?.value ?? "",
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

  async function requestReset(event: Event): Promise<void> {
    event.preventDefault();
    const submit = button("#btn-forgot-send");
    const error = queryOne("#forgot-error");
    if (!submit || !error) return;
    error.textContent = "";
    setButtonState(submit, true, "Enviando...");
    const result = await requestPasswordReset(
      dependencies.auth,
      input("#forgot-email")?.value.trim(),
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

  async function saveNewPassword(event: Event): Promise<void> {
    event.preventDefault();
    const submit = button("#btn-new-password");
    const error = queryOne("#new-password-error");
    if (!submit || !error) return;
    error.textContent = "";
    setButtonState(submit, true, "Guardando...");
    const result = await updatePassword(
      dependencies.auth,
      input("#new-password")?.value ?? "",
      input("#new-password-confirm")?.value ?? ""
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

  function togglePassword(element: Element): void {
    if (!(element instanceof HTMLButtonElement)) return;
    const target = element.dataset.togglePassword;
    const password = target ? input(`#${target}`) : null;
    if (!password) return;
    const reveal = password.type === "password";
    password.type = reveal ? "text" : "password";
    element.innerHTML = dependencies.icon(reveal ? "eye-off" : "eye");
    const label = reveal ? "Ocultar contraseña" : "Mostrar contraseña";
    element.setAttribute("aria-label", label);
    element.title = label;
  }

  async function performSignOut(): Promise<void> {
    recoveryActive = false;
    dependencies.beforeSignOut();
    await signOut(dependencies.auth);
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#login-form")?.addEventListener("submit", (event) => { void ownerSignIn(event); });
    queryOne("#employee-login-form")?.addEventListener("submit", (event) => {
      void employeeSignIn(event);
    });
    queryOne("#register-form")?.addEventListener("submit", (event) => { void register(event); });
    queryOne("#forgot-form")?.addEventListener("submit", (event) => { void requestReset(event); });
    queryOne("#new-password-form")?.addEventListener("submit", (event) => {
      void saveNewPassword(event);
    });

    queryOne("#tab-owner")?.addEventListener("click", () => {
      showAuthPanel("owner");
    });
    queryOne("#tab-employee")?.addEventListener("click", () => {
      showAuthPanel("employee");
    });
    queryOne("#btn-show-register")?.addEventListener("click", () => {
      showAuthPanel("register");
    });
    queryOne("#btn-back-login")?.addEventListener("click", () => {
      showAuthPanel("owner");
    });
    queryOne("#btn-forgot")?.addEventListener("click", () => {
      const email = input("#login-email")?.value.trim();
      const resetEmail = input("#forgot-email");
      if (resetEmail && email) resetEmail.value = email;
      showAuthPanel("forgot");
    });
    queryOne("#btn-forgot-back")?.addEventListener("click", () => {
      showAuthPanel("owner");
    });
    queryAll("[data-toggle-password]").forEach((element) => {
      element.addEventListener("click", () => {
        togglePassword(element);
      });
    });
    queryOne("#btn-cerrar-sesion")?.addEventListener("click", () => { void performSignOut(); });
  }

  return Object.freeze({
    setup,
    initialize,
    getSession,
    signOut: performSignOut
  });
}
