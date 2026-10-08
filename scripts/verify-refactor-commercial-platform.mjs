import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(root);

const runtimeFile = files.find(
  (file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file)
);
const appFile = files.find(
  (file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/.test(file)
);

if (!runtimeFile || !appFile) {
  throw new Error(
    "Refactor Commercial/Platform verification could not find generated bundles"
  );
}

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "src/bootstrap/application-composition.ts"), "utf8");
const commercialController = readFileSync(
  resolve(projectRoot, "src/commercial/commercial-foundation-controller.ts"),
  "utf8"
);
const platformController = readFileSync(
  resolve(projectRoot, "src/platform/platform-admin-controller.ts"),
  "utf8"
);
const commercialBridge = readFileSync(
  resolve(projectRoot, "src/legacy/commercial-bridge.ts"),
  "utf8"
);
const platformBridge = readFileSync(
  resolve(projectRoot, "src/legacy/platform-bridge.ts"),
  "utf8"
);
const commercialService = readFileSync(
  resolve(projectRoot, "src/commercial/commercial-service.ts"),
  "utf8"
);
const platformService = readFileSync(
  resolve(projectRoot, "src/platform/platform-service.ts"),
  "utf8"
);

for (const marker of [
  "createCommercialFoundationController",
  "createPlatformAdminController"
]) {
  if (!runtime.includes(marker)) {
    throw new Error(`Modular runtime missing Commercial/Platform marker: ${marker}`);
  }
}

for (const [bridge, marker, label] of [
  [commercialBridge, "createCommercialFoundationController", "Commercial"],
  [platformBridge, "createPlatformAdminController", "Platform"]
]) {
  if (!bridge.includes(marker)) {
    throw new Error(`${label} bridge does not expose ${marker}`);
  }
}

for (const marker of [
  "commercialApi.createCommercialFoundationController({",
  "platformApi.createPlatformAdminController({",
  "await commercialFoundationController.load();",
  "reloadCommercialFoundation: () => commercialFoundationController.load(),",
  "run: () => commercialFoundationController.setup()",
  "run: () => platformAdminController.setup()",
  "run: setupObservability",
  "run: () => dashboardController.setup()",
  "setupCsvImport"
]) {
  if (!sourceApp.includes(marker)) {
    throw new Error(`Root app.js missing Commercial/Platform composition: ${marker}`);
  }
}

for (const [name, type, factory] of [
  ["commercialFoundationController", "CommercialFoundationController", "commercialApi.createCommercialFoundationController"],
  ["platformAdminController", "PlatformAdminController", "platformApi.createPlatformAdminController"]
]) {
  const escapedFactory = factory.replaceAll(".", "\\.");
  const pattern = new RegExp(`let ${name}:\\s*${type};[\\s\\S]*?${name}\\s*=\\s*${escapedFactory}\\(\\{`, "u");
  if (!pattern.test(sourceApp)) throw new Error(`Typed ${name} declaration/composition was lost`);
}

for (const [name, lifecycle] of [["commercialFoundationController", "commercial"], ["platformAdminController", "platform"]]) {
  if (!new RegExp(`name: "${lifecycle}",[\\s\\S]{0,100}run: \\(\\) => ${name}\\.setup\\(\\)`, "u").test(sourceApp)) {
    throw new Error(`Typed ${name} setup lifecycle was lost`);
  }
}

for (const legacyMarker of [
  "onboardingHideKeyV231",
  "renderOnboardingComercialV231",
  "refrescarOnboardingComercialV231",
  "cargarPlanV231",
  "cargarConfigOperativaV231",
  "guardarConfigOperativaV231",
  "descargarBackupOperativoV231",
  "verificarPlatformAdminV231",
  "abrirPlatformAdminV231",
  "guardarPlanPlataformaV231",
  "cerrarPlatformAdminV231",
  "cargarCommercialFoundationV231",
  "setupCommercialFoundationV231",
  "commercialConfigV231",
  "commercialRefreshTimerV231"
]) {
  if (sourceApp.includes(legacyMarker)) {
    throw new Error(`Legacy Commercial/Platform marker still present: ${legacyMarker}`);
  }
}

for (const [source, label] of [
  [commercialController, "Commercial"],
  [platformController, "Platform"]
]) {
  for (const forbidden of [
    ".rpc(",
    "window.Vendify",
    "dashboardController",
    "teamController",
    "cashController",
    "posController",
    "appContext",
    "supabaseClient"
  ]) {
    if (source.includes(forbidden)) {
      throw new Error(`${label} typed owner leaked forbidden ownership: ${forbidden}`);
    }
  }
}

for (const marker of [
  'from "./commercial-service.js"',
  "getCommercialOnboarding",
  "getCurrentPlan",
  "getOperationalConfig",
  "saveOperationalConfig",
  "exportOperationalBackup"
]) {
  if (!commercialController.includes(marker)) {
    throw new Error(`Commercial owner missing typed service usage: ${marker}`);
  }
}

for (const marker of [
  'from "./platform-service.js"',
  "isPlatformAdmin",
  "loadPlatformBackoffice",
  "updateBusinessPlan"
]) {
  if (!platformController.includes(marker)) {
    throw new Error(`Platform owner missing typed service usage: ${marker}`);
  }
}

for (const marker of [
  "estado_onboarding_comercial_v1",
  "obtener_plan_actual_v1",
  "obtener_config_operativa_v1",
  "guardar_config_operativa_v1",
  "exportar_respaldo_operativo_v1"
]) {
  if (!commercialService.includes(marker)) {
    throw new Error(`Commercial service contract disappeared: ${marker}`);
  }
}

for (const marker of [
  "es_admin_plataforma_v1",
  "platform_overview_v1",
  "listar_negocios_plataforma_v1",
  "listar_errores_plataforma_v1",
  "actualizar_plan_negocio_plataforma_v1"
]) {
  if (!platformService.includes(marker)) {
    throw new Error(`Platform service contract disappeared: ${marker}`);
  }
}

if (
  sourceApp.includes("error || data !== true")
  || platformController.includes("error || data !== true")
) {
  throw new Error("Legacy undefined Platform Admin error bug reappeared");
}

for (const separationMarker of [
  "productsApi.createController({",
  "dashboardApi.createController({",
  "offlineApi.createController({",
  "teamApi.createController({"
]) {
  if (!sourceApp.includes(separationMarker)) {
    throw new Error(
      `Commercial/Platform extraction lost separate owner composition: ${separationMarker}`
    );
  }
}

console.log(
  "PASS: root and generated runtimes delegate Commercial and Platform UI/lifecycle ownership to typed controllers without direct RPCs, legacy state, or cross-owner absorption"
);
