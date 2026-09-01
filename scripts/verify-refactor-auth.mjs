import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "dist-refactor-modular");
const files = readdirSync(root);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));

if (!runtimeFile || !appFile) throw new Error("Refactor Auth verification could not find generated bundles");

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");

for (const marker of [
  "VendifyAuthV232",
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
  "signOut"
]) {
  if (!runtime.includes(marker)) throw new Error(`Modular runtime missing Auth marker: ${marker}`);
}

for (const marker of [
  "window.VendifyAuthV232.normalizeInternalLogin(valor)",
  "window.VendifyAuthV232.buildEmployeeInternalEmail(codigoNegocio, username)",
  "window.VendifyAuthV232.showAuthPanel(panel)",
  "window.VendifyAuthV232.showAuthMessage(mensaje, tipo)",
  "window.VendifyAuthV232.signInOwner(",
  "window.VendifyAuthV232.signInEmployee(",
  "window.VendifyAuthV232.registerOwner(",
  "window.VendifyAuthV232.requestPasswordReset(",
  "window.VendifyAuthV232.updatePassword(",
  "window.VendifyAuthV232.signOut(supabaseClient.auth)"
]) {
  if (!app.includes(marker)) throw new Error(`Compatibility app missing Auth delegation: ${marker}`);
}

for (const obsoleteMarker of [
  "const map = {\n    \"auth-login-panel\"",
  "supabaseClient.auth.signInWithPassword(",
  "supabaseClient.auth.signUp(",
  "supabaseClient.auth.resetPasswordForEmail(",
  "supabaseClient.auth.updateUser(",
  "supabaseClient.auth.signOut("
]) {
  if (app.includes(obsoleteMarker)) {
    throw new Error(`Compatibility app still contains migrated Auth logic: ${obsoleteMarker}`);
  }
}

console.log("PASS: generated refactor runtime delegates Auth UI and Supabase Auth service calls");
