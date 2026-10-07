import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(outputRoot);

const coreFile = files.find(
  (file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file)
);
const appFile = files.find(
  (file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file)
);

if (!coreFile || !appFile) {
  throw new Error(
    "Navigation Events verification could not find modular bundles"
  );
}

const core = readFileSync(resolve(outputRoot, coreFile), "utf8");
const generatedApp = readFileSync(
  resolve(outputRoot, appFile),
  "utf8"
);
const sourceApp = readFileSync(
  resolve(projectRoot, "app.js"),
  "utf8"
);
const typedOwner = readFileSync(
  resolve(
    projectRoot,
    "src/core/navigation-events-controller.ts"
  ),
  "utf8"
);
const bridge = readFileSync(
  resolve(projectRoot, "src/legacy/core-bridge.ts"),
  "utf8"
);
const buildSource = readFileSync(
  resolve(projectRoot, "scripts/build-refactor-modular.mjs"),
  "utf8"
);

for (const marker of [
  "createNavigationEventsController",
  "vendifyGuardV2311",
  "gestion-menu-v230",
  "btn-user-menu"
]) {
  if (!core.includes(marker)) {
    throw new Error(
      `Modular core missing Navigation Events marker: ${marker}`
    );
  }
}

for (const marker of [
  'import { createNavigationEventsController } from "../core/navigation-events-controller.js"',
  "readonly createNavigationEventsController: typeof createNavigationEventsController",
  "createNavigationEventsController"
]) {
  if (!bridge.includes(marker)) {
    throw new Error(
      `Core bridge missing Navigation Events API marker: ${marker}`
    );
  }
}

const retiredOwners = [
  "posicionarPopoverAncladoV23012",
  "posicionarMenuUsuarioMobile",
  "limpiarPosicionMenuUsuario",
  "abrirCerrarMenuUsuarioV224",
  "posicionarGestionMenuV230",
  "abrirCerrarGestionV230",
  "setupGestionMenuV230",
  "backGuardInstalledV2311",
  "backGuardExitConfirmingV2311",
  "backGuardEnabledV2311",
  "appVisibleV2311",
  "armarBackGuardV2311",
  "rearmarBackGuardV2311",
  "popoverAbiertoV2311",
  "cerrarPopoverAbiertoV2311",
  "modalSuperiorVisibleV2311",
  "cerrarCapaSuperiorV2311",
  "intentarSalirVendifyV2311",
  "manejarBackVendifyV2311",
  "setupBackGuardV2311",
  "inicializarEventos"
];

for (const app of [sourceApp, generatedApp]) {
  for (const marker of [
    "window.VendifyCoreV232.createNavigationEventsController({",
    "navigationEventsControllerV232.setup();",
    "closeUserMenu: () => navigationEventsControllerV232.closeUserMenu()",
    "navigationEventsControllerV232.closeManagementMenu()",
    "positionPopover: navigationEventsControllerV232.positionPopover"
  ]) {
    if (!app.includes(marker)) {
      throw new Error(
        `Compatibility app missing Navigation Events composition: ${marker}`
      );
    }
  }

  for (const retired of retiredOwners) {
    if (app.includes(retired)) {
      throw new Error(
        `Compatibility app retained legacy Navigation/Back owner: ${retired}`
      );
    }
  }
}

for (const marker of [
  'getElementById("btn-user-menu")',
  'getElementById("btn-gestion-v230")',
  'addEventListener("popstate", handleBack)',
  'addEventListener(\n      "keydown",\n      handleGlobalKeydown'
]) {
  if (!typedOwner.includes(marker)) {
    throw new Error(
      `Typed Navigation Events owner missing listener marker: ${marker}`
    );
  }
}

if (/\bpopstate\b/u.test(sourceApp)) {
  throw new Error(
    "app.js retained direct Back Guard popstate ownership"
  );
}

for (const forbidden of [
  ".rpc(",
  "supabaseClient",
  "window.Vendify",
  "posControllerV232",
  "teamControllerV232",
  "productsControllerV232",
  "cashControllerV232",
  "inventoryControllerV232",
  "purchasesControllerV232",
  "commercialFoundationControllerV232",
  "platformAdminControllerV232",
  "contextPickerControllerV232"
]) {
  if (typedOwner.includes(forbidden)) {
    throw new Error(
      `Navigation Events owner crossed injected boundary: ${forbidden}`
    );
  }
}

for (const marker of [
  "window.VendifyCoreV232.createOverlayStabilityController({",
  "overlayStabilityControllerV232.setup();",
  "window.VendifyContextV232.createContextPickerController({",
  "contextPickerControllerV232.setup();",
  "window.VendifyProductsV232.createController({",
  "window.VendifySalesV232.createPosController({",
  "window.VendifyTeamV232.createController({",
  "window.VendifyCashV232.createController({"
]) {
  if (!sourceApp.includes(marker)) {
    throw new Error(
      `Existing owner was absorbed or lost during Navigation extraction: ${marker}`
    );
  }
}

for (const marker of [
  "async function mostrarApp()",
  "function init()"
]) {
  if (!sourceApp.includes(marker)) {
    throw new Error(
      `VEN-007M boundary crossed; missing compatibility bootstrap marker: ${marker}`
    );
  }
}

for (const marker of [
  "dist-staging-v2312",
  "app-staging-v2312-",
  "app-refactor-v232-"
]) {
  if (!buildSource.includes(marker)) {
    throw new Error(
      `Compatibility build changed before VEN-007M: ${marker}`
    );
  }
}

console.log(
  "PASS: Navigation + global events + Back Guard ownership is typed, legacy app is composition-only for this domain, existing owners remain separate, and VEN-007M boundaries are preserved"
);
