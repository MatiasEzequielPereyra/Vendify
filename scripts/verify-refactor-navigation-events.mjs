import {
  readFileSync,
  readdirSync
} from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(outputRoot);

const coreFile = files.find(
  (file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/u.test(file)
);
const appFile = files.find(
  (file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/u.test(file)
);

if (!coreFile || !appFile) {
  throw new Error(
    "Navigation Events verification could not find typed modular bundles"
  );
}

const core = readFileSync(resolve(outputRoot, coreFile), "utf8");
const generatedApp = readFileSync(
  resolve(outputRoot, appFile),
  "utf8"
);
const composition = readFileSync(
  resolve(
    projectRoot,
    "src/bootstrap/application-composition.ts"
  ),
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

for (const source of [composition, generatedApp]) {
  for (const retired of retiredOwners) {
    if (source.includes(retired)) {
      throw new Error(
        `Typed application retained legacy Navigation/Back owner: ${retired}`
      );
    }
  }
}

for (const marker of [
  "core.createNavigationEventsController({",
  "navigationEventsController.setup()",
  "closeUserMenu: () => navigationEventsController.closeUserMenu()",
  "navigationEventsController.closeManagementMenu()",
  "positionPopover: navigationEventsController.positionPopover"
]) {
  if (!composition.includes(marker)) {
    throw new Error(
      `Typed composition missing Navigation Events composition: ${marker}`
    );
  }
}

for (const marker of [
  'getElementById("btn-user-menu")',
  'getElementById("btn-gestion-v230")',
  'addEventListener("popstate", onPopState)',
  "function onPopState(): void",
  "void handleBack();",
  'addEventListener(\n      "keydown",\n      handleGlobalKeydown'
]) {
  if (!typedOwner.includes(marker)) {
    throw new Error(
      `Typed Navigation Events owner missing listener marker: ${marker}`
    );
  }
}

if (/\bpopstate\b/u.test(composition)) {
  throw new Error(
    "Application composition retained direct Back Guard popstate ownership"
  );
}

for (const forbidden of [
  ".rpc(",
  "supabaseClient",
  "window.Vendify",
  "posController",
  "teamController",
  "productsController",
  "cashController",
  "inventoryController",
  "purchasesController",
  "commercialFoundationController",
  "platformAdminController",
  "contextPickerController"
]) {
  if (typedOwner.includes(forbidden)) {
    throw new Error(
      `Navigation Events owner crossed injected boundary: ${forbidden}`
    );
  }
}

for (const marker of [
  "core.createOverlayStabilityController({",
  "contextApi.createContextPickerController({",
  "productsApi.createController({",
  "salesApi.createPosController({",
  "teamApi.createController({",
  "cashApi.createController({"
]) {
  if (!composition.includes(marker)) {
    throw new Error(
      `Existing typed owner was absorbed or lost: ${marker}`
    );
  }
}

for (const legacyBootstrap of [
  "async function mostrarApp()",
  "function mostrarApp()",
  "function init()"
]) {
  if (
    composition.includes(legacyBootstrap)
    || generatedApp.includes(legacyBootstrap)
  ) {
    throw new Error(
      `Legacy bootstrap marker restored in typed runtime: ${legacyBootstrap}`
    );
  }
}

for (const forbiddenBuild of [
  "app-refactor-v232-",
  "writeFileSync(resolve(out, appName), app",
  "const appName = \u0060app-refactor"
]) {
  if (buildSource.includes(forbiddenBuild)) {
    throw new Error(
      `Modular build restored compatibility app behavior: ${forbiddenBuild}`
    );
  }
}

console.log(
  "PASS: Navigation + global events + Back Guard remain typed, composition-only, and independent of legacy app.js bootstrap"
);
