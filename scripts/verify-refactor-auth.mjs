import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(root);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/.test(file));

if (!runtimeFile || !appFile) throw new Error("Refactor Auth verification could not find generated bundles");

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "src/bootstrap/application-composition.ts"), "utf8");
const buildSource = readFileSync(
  resolve(projectRoot, "scripts/build-refactor-modular.mjs"),
  "utf8"
);

for (const marker of [
  "VendifyAuthV232",
  "createAuthController",
  "createInactivityGuard",
  "SECURITY_IDLE_TIMEOUT_MS_V2301",
  "SECURITY_ACTIVITY_KEY_V2301",
  "SECURITY_ACTIVITY_WRITE_THROTTLE_MS_V2301",
  "SECURITY_IDLE_CHECK_INTERVAL_MS_V2301",
  "SECURITY_IDLE_LOGOUT_MESSAGE_V2301",
  "normalizeInternalLogin",
  "buildEmployeeInternalEmail",
  "resolveAuthPanel",
  "validateRegistrationInput",
  "validateNewPasswordInput",
  "getAuthPanelState",
  "showAuthPanel",
  "showAuthMessage",
  "signInOwner",
  "signInEmployee",
  "registerOwner",
  "requestPasswordReset",
  "updatePassword",
  "signOut",
  "initializeAuthLifecycle"
]) {
  if (!runtime.includes(marker)) throw new Error(`Modular runtime missing Auth marker: ${marker}`);
}

for (const marker of [
  "authApi.createController({",
  "authApi.createInactivityGuard({",
  "inactivityGuard.start();",
  "authController.setup();",
  "authController.initialize()",
  "authController.getSession()",
  "authController.signOut()"
]) {
  if (!sourceApp.includes(marker)) {
    throw new Error(`Typed application composition missing Auth delegation: ${marker}`);
  }
}

for (const obsoleteMarker of [
  "let sesionActual",
  "SECURITY_IDLE_TIMEOUT_MS_V2301",
  "SECURITY_ACTIVITY_KEY_V2301",
  "securityLastPersistV2301",
  "securityIdleTimerV2301",
  "securityLogoutRunningV2301",
  "function registrarActividadSeguraV2301",
  "function verificarSesionInactivaV2301",
  "function setupSecuritySessionGuardV2301",
  "let flujoRecuperacionActivo",
  "function mostrarPanelAuth",
  "function mostrarMensajeAuth",
  "function initAuth",
  "function mostrarLogin",
  "async function iniciarSesionPassword",
  "async function loginEmpleado",
  "async function registrarCuenta",
  "async function solicitarResetPassword",
  "async function guardarNuevaPassword",
  "function togglePassword",
  "async function cerrarSesion",
  "const map = {\n    \"auth-login-panel\"",
  "supabaseClient.auth.getSession(",
  "supabaseClient.auth.onAuthStateChange(",
  "supabaseClient.auth.signInWithPassword(",
  "supabaseClient.auth.signUp(",
  "supabaseClient.auth.resetPasswordForEmail(",
  "supabaseClient.auth.updateUser(",
  "supabaseClient.auth.signOut("
]) {
  if (app.includes(obsoleteMarker) || sourceApp.includes(obsoleteMarker)) {
    throw new Error(`Legacy app still contains migrated Auth logic: ${obsoleteMarker}`);
  }
}

for (const obsoleteBuildPatch of [
  '"employee login normalization"',
  '"employee internal email"',
  '"auth panel UI"',
  '"auth message UI"',
  '"auth session lifecycle"',
  '"owner auth handler"',
  '"employee auth handler"',
  '"registration auth handler"',
  '"password reset auth handler"',
  '"password update auth handler"',
  '"sign out auth handler"'
]) {
  if (buildSource.includes(obsoleteBuildPatch)) {
    throw new Error(`Build still regex-patches compacted Auth block: ${obsoleteBuildPatch}`);
  }
}

console.log("PASS: typed application composes Auth and inactivity guard ownership once without legacy duplicate logic");
