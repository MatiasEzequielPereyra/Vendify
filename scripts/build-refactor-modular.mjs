import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";
import { patchTeamRefactor } from "./patch-refactor-team.mjs";

const root = resolve(import.meta.dirname, "..");
const stagingOut = resolve(root, "dist-staging-v2312");
const out = resolve(root, "dist-refactor-modular");
const coreBuildDir = resolve(root, ".vendify-build/modular-core");
const coreFile = resolve(coreBuildDir, "vendify-core-v232.js");

function fingerprint(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function replaceExactlyOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Refactor patch ${label} expected 1 match, found ${matches.length}`);
  }

  // Use a replacer callback so replacement text is inserted literally.
  // This is required for helpers such as `$$`: in a normal replacement string,
  // JavaScript interprets `$$` as a single literal `$`.
  return source.replace(pattern, () => replacement);
}

execFileSync(process.execPath, [resolve(root, "scripts/build-staging-v2312.mjs")], {
  cwd: root,
  stdio: "inherit"
});

await build({ configFile: resolve(root, "vite.modular-core.config.ts") });
if (!existsSync(coreFile)) throw new Error("Modular runtime bridge bundle was not generated");

rmSync(out, { recursive: true, force: true });
cpSync(stagingOut, out, { recursive: true });

const files = readdirSync(out);
const stagedApps = files.filter((file) => /^app-staging-v2312-[0-9a-f]{12}\.js$/.test(file));
if (stagedApps.length !== 1) {
  throw new Error(`Expected one v2.31.2 staged app, found ${stagedApps.length}`);
}

const oldAppName = stagedApps[0];
const oldAppPath = resolve(out, oldAppName);
let app = readFileSync(oldAppPath, "utf8");

app = replaceExactlyOnce(
  app,
  /function normalizarLoginInterno\(valor\) \{[\s\S]*?^\}/gm,
  `function normalizarLoginInterno(valor) {\n  return window.VendifyAuthV232.normalizeInternalLogin(valor);\n}`,
  "employee login normalization"
);

app = replaceExactlyOnce(
  app,
  /function emailInternoEmpleado\(codigoNegocio, username\) \{[\s\S]*?^\}/gm,
  `function emailInternoEmpleado(codigoNegocio, username) {\n  return window.VendifyAuthV232.buildEmployeeInternalEmail(codigoNegocio, username);\n}`,
  "employee internal email"
);

app = replaceExactlyOnce(
  app,
  /function mostrarPanelAuth\(panel\) \{[\s\S]*?^\}/gm,
  `function mostrarPanelAuth(panel) {\n  return window.VendifyAuthV232.showAuthPanel(panel);\n}`,
  "auth panel UI"
);

app = replaceExactlyOnce(
  app,
  /function mostrarMensajeAuth\(mensaje, tipo = "info"\) \{[\s\S]*?^\}/gm,
  `function mostrarMensajeAuth(mensaje, tipo = "info") {\n  return window.VendifyAuthV232.showAuthMessage(mensaje, tipo);\n}`,
  "auth message UI"
);

app = replaceExactlyOnce(
  app,
  /async function initAuth\(\) \{[\s\S]*?^\}/gm,
  `async function initAuth() {\n  return window.VendifyAuthV232.initializeAuthLifecycle(\n    supabaseClient.auth,\n    {\n      setSession(session) {\n        sesionActual = session;\n      },\n      isRecoveryActive() {\n        return flujoRecuperacionActivo;\n      },\n      setRecoveryActive(active) {\n        flujoRecuperacionActivo = active;\n      },\n      showLogin: mostrarLogin,\n      showNewPasswordPanel() {\n        mostrarPanelAuth("auth-new-password-panel");\n      },\n      showApp(session) {\n        return mostrarAppSeguroVQA(session);\n      },\n      async handleSignedOut() {\n        appBootUserIdVQA = null;\n        appBootPromiseVQA = null;\n        limpiarContextoApp();\n        productos = [];\n        carrito = [];\n        mostrarLogin();\n        if (realtimeChannel) {\n          supabaseClient.removeChannel(realtimeChannel);\n          realtimeChannel = null;\n        }\n      }\n    }\n  );\n}`,
  "auth session lifecycle"
);

app = replaceExactlyOnce(
  app,
  /async function iniciarSesionPassword\(e\) \{[\s\S]*?^\}/gm,
  `async function iniciarSesionPassword(e) {\n  e.preventDefault();\n  const email = $("#login-email")?.value.trim();\n  const password = $("#login-password")?.value || "";\n  const btn = $("#btn-login");\n  const err = $("#login-error");\n  if (!btn || !err) return;\n\n  err.textContent = "";\n  btn.disabled = true;\n  btn.textContent = "Ingresando...";\n\n  const result = await window.VendifyAuthV232.signInOwner(\n    supabaseClient.auth,\n    email,\n    password\n  );\n\n  btn.disabled = false;\n  btn.textContent = "Iniciar sesión";\n\n  if (!result.ok) err.textContent = result.errorMessage || "";\n}`,
  "owner auth handler"
);

app = replaceExactlyOnce(
  app,
  /async function loginEmpleado\(e\) \{[\s\S]*?^\}/gm,
  `async function loginEmpleado(e) {\n  e.preventDefault();\n\n  const code = $("#employee-business-code")?.value.trim() || "";\n  const username = $("#employee-username")?.value.trim() || "";\n  const password = $("#employee-password")?.value || "";\n  const errorEl = $("#employee-login-error");\n  const btn = $("#btn-employee-login");\n  if (!errorEl || !btn) return;\n\n  errorEl.textContent = "";\n  btn.disabled = true;\n  btn.textContent = "Ingresando...";\n\n  const result = await window.VendifyAuthV232.signInEmployee(\n    supabaseClient.auth,\n    code,\n    username,\n    password\n  );\n\n  btn.disabled = false;\n  btn.textContent = "Entrar a Vendify";\n\n  if (!result.ok) errorEl.textContent = result.errorMessage || "";\n}`,
  "employee auth handler"
);

app = replaceExactlyOnce(
  app,
  /async function registrarCuenta\(e\) \{[\s\S]*?^\}/gm,
  `async function registrarCuenta(e) {\n  e.preventDefault();\n  const businessName = $("#register-business")?.value.trim();\n  const email = $("#register-email")?.value.trim();\n  const password = $("#register-password")?.value || "";\n  const err = $("#register-error");\n  const btn = $("#btn-register");\n  if (!err || !btn) return;\n\n  err.textContent = "";\n  btn.disabled = true;\n  btn.textContent = "Creando cuenta...";\n\n  const result = await window.VendifyAuthV232.registerOwner(\n    supabaseClient.auth,\n    {\n      businessName,\n      email,\n      password,\n      redirectTo: window.location.origin + window.location.pathname\n    }\n  );\n\n  btn.disabled = false;\n  btn.textContent = "Crear cuenta";\n\n  if (!result.ok) {\n    err.textContent = result.errorMessage || "";\n    return;\n  }\n\n  if (result.requiresConfirmation) {\n    mostrarPanelAuth("owner");\n    mostrarMensajeAuth(\n      "Cuenta creada. Revisá tu email una sola vez para confirmarla y después ingresá con tu contraseña.",\n      "success"\n    );\n  }\n}`,
  "registration auth handler"
);

app = replaceExactlyOnce(
  app,
  /async function solicitarResetPassword\(e\) \{[\s\S]*?^\}/gm,
  `async function solicitarResetPassword(e) {\n  e.preventDefault();\n  const email = $("#forgot-email")?.value.trim();\n  const btn = $("#btn-forgot-send");\n  const err = $("#forgot-error");\n  if (!btn || !err) return;\n\n  err.textContent = "";\n  btn.disabled = true;\n  btn.textContent = "Enviando...";\n\n  const result = await window.VendifyAuthV232.requestPasswordReset(\n    supabaseClient.auth,\n    email,\n    window.location.origin + window.location.pathname\n  );\n\n  btn.disabled = false;\n  btn.textContent = "Enviar recuperación";\n\n  if (!result.ok) {\n    err.textContent = result.errorMessage || "";\n    return;\n  }\n\n  mostrarPanelAuth("owner");\n  mostrarMensajeAuth("Te enviamos un enlace para cambiar tu contraseña.", "success");\n}`,
  "password reset auth handler"
);

app = replaceExactlyOnce(
  app,
  /async function guardarNuevaPassword\(e\) \{[\s\S]*?^\}/gm,
  `async function guardarNuevaPassword(e) {\n  e.preventDefault();\n  const password = $("#new-password")?.value || "";\n  const confirm = $("#new-password-confirm")?.value || "";\n  const err = $("#new-password-error");\n  const btn = $("#btn-new-password");\n  if (!err || !btn) return;\n\n  err.textContent = "";\n  btn.disabled = true;\n  btn.textContent = "Guardando...";\n\n  const result = await window.VendifyAuthV232.updatePassword(\n    supabaseClient.auth,\n    password,\n    confirm\n  );\n\n  btn.disabled = false;\n  btn.textContent = "Guardar contraseña";\n\n  if (!result.ok) {\n    err.textContent = result.errorMessage || "";\n    return;\n  }\n\n  flujoRecuperacionActivo = false;\n  mostrarToast("Contraseña actualizada", "success");\n  await mostrarApp();\n}`,
  "password update auth handler"
);

app = replaceExactlyOnce(
  app,
  /async function cerrarSesion\(\) \{[\s\S]*?^\}/gm,
  `async function cerrarSesion() {\n  flujoRecuperacionActivo = false;\n  limpiarContextoApp();\n  await window.VendifyAuthV232.signOut(supabaseClient.auth);\n}`,
  "sign out auth handler"
);

app = patchTeamRefactor(app, replaceExactlyOnce);

const coreContent = readFileSync(coreFile, "utf8");
const coreName = `vendify-core-v232-${fingerprint(coreContent)}.js`;
const appName = `app-refactor-v232-${fingerprint(app)}.js`;

writeFileSync(resolve(out, coreName), coreContent, "utf8");
writeFileSync(resolve(out, appName), app, "utf8");
unlinkSync(oldAppPath);

const indexPath = resolve(out, "index.html");
let index = readFileSync(indexPath, "utf8");
const oldScript = `<script src="${oldAppName}"></script>`;
if (!index.includes(oldScript)) {
  throw new Error("Could not find staged app script in refactor index");
}
index = index.replace(
  oldScript,
  `<script src="${coreName}"></script>\n  <script src="${appName}"></script>`
);
writeFileSync(indexPath, index, "utf8");

console.log("Vendify modular refactor preview created in dist-refactor-modular/");
console.log("Core, Auth, and first Team services are loaded from TypeScript before the compatibility app runtime.");
console.log("The root app compatibility layer is compacted only after browser-validated migrations.");
