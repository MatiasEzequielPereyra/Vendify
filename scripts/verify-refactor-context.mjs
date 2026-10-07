import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(outputRoot);

const coreFile = files.find(
  (file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file)
);
const appFile = files.find(
  (file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/.test(file)
);

if (!coreFile || !appFile) {
  throw new Error(
    "Context Picker verification could not find modular bundles"
  );
}

const core = readFileSync(resolve(outputRoot, coreFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "src/bootstrap/application-composition.ts"), "utf8");
const generatedApp = readFileSync(resolve(outputRoot, appFile), "utf8");
const typedOwner = readFileSync(
  resolve(
    projectRoot,
    "src/context/context-picker-controller.ts"
  ),
  "utf8"
);
const contextBridge = readFileSync(
  resolve(projectRoot, "src/legacy/context-bridge.ts"),
  "utf8"
);
const cashOwner = readFileSync(
  resolve(projectRoot, "src/cash/cash-controller.ts"),
  "utf8"
);

for (const marker of [
  "createContextPickerController",
  "branch-menu-v23013",
  "cash-menu-v23013",
  "branch-current-label-v23013",
  "cash-current-label-v23013",
  "No hay sucursales disponibles."
]) {
  if (!core.includes(marker)) {
    throw new Error(
      `Modular core missing Context Picker owner marker: ${marker}`
    );
  }
}

for (const marker of [
  'import { createContextPickerController } from "../context/context-picker-controller.js"',
  "readonly createContextPickerController: typeof createContextPickerController",
  "createContextPickerController"
]) {
  if (!contextBridge.includes(marker)) {
    throw new Error(
      `Context bridge missing Context Picker API marker: ${marker}`
    );
  }
}

if (contextBridge.includes("VendifyContextPickerV232")) {
  throw new Error(
    "Context Picker created a forbidden extra window global"
  );
}

const retiredOwners = [
  "cerrarContextPickersV23013",
  "abrirCerrarContextPickerV23013",
  "actualizarContextSelectorLabelsV23013",
  "renderBranchOptionsV23013",
  "renderCashOptionsV23013",
  "seleccionarSucursalV23013",
  "seleccionarCajaV23013",
  "setupContextPickersV23013"
];

for (const app of [sourceApp]) {
  for (const marker of [
    "contextApi.createContextPickerController({",
    "contextPickerController.setup();",
    "closeContextPickers: () => contextPickerController.close()",
    "updateContextLabels: () => contextPickerController.updateLabels()"
  ]) {
    if (!app.includes(marker)) {
      throw new Error(
        `Compatibility app missing Context Picker composition: ${marker}`
      );
    }
  }

  for (const retired of retiredOwners) {
    if (app.includes(retired)) {
      throw new Error(
        `Compatibility app retained legacy Context Picker owner: ${retired}`
      );
    }
  }
}

for (const directListenerPattern of [
  /branch-trigger-v23013[^\n]{0,200}addEventListener/su,
  /cash-trigger-v23013[^\n]{0,200}addEventListener/su,
  /branch-options-v23013[^\n]{0,200}addEventListener/su,
  /cash-options-v23013[^\n]{0,200}addEventListener/su
]) {
  if (directListenerPattern.test(sourceApp)) {
    throw new Error(
      `application composition retained direct Context Picker DOM listener: ${directListenerPattern}`
    );
  }
}

for (const forbidden of [
  "supabase",
  "rpc",
  "cambiarSucursalV2",
  "cambiarSucursalDesdeSelectorV226",
  "cambiarCajaDesdeSelectorV227",
  "cashController",
  "posController",
  "listarSucursalesAdminV226",
  "renderSucursalesConfigV226",
  "abrirModalSucursalV226",
  "guardarSucursalV226",
  "crearCajaV226",
  "cargarCajasSucursalV227",
  "cargarEstadoCajaV227"
]) {
  if (typedOwner.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(
      `Context Picker owner crossed business/backend boundary: ${forbidden}`
    );
  }
}

for (const marker of [
  "#cash-options-v23013",
  "renderOptions",
  "Esta sucursal no tiene cajas disponibles."
]) {
  if (!cashOwner.includes(marker)) {
    throw new Error(
      `CashController no longer owns Cash option rendering: ${marker}`
    );
  }
}

for (const forbiddenCashMarkup of [
  "Esta sucursal no tiene cajas disponibles.",
  'data-context-cash="${'
]) {
  if (typedOwner.includes(forbiddenCashMarkup)) {
    throw new Error(
      `Context Picker duplicated Cash renderer markup: ${forbiddenCashMarkup}`
    );
  }
}

const overlayStart = sourceApp.indexOf(
  "core.createOverlayStabilityController({"
);
const overlayEnd = sourceApp.indexOf("});", overlayStart);
if (overlayStart < 0 || overlayEnd < 0) {
  throw new Error("Could not inspect Overlay composition");
}
const overlayComposition = sourceApp.slice(
  overlayStart,
  overlayEnd + 3
);
if (
  !overlayComposition.includes(
    "closeContextPickers: () => contextPickerController.close()"
  )
) {
  throw new Error(
    "Overlay does not delegate Context Picker close to typed owner"
  );
}

const navigationOwner = readFileSync(
  resolve(projectRoot, "src/core/navigation-events-controller.ts"),
  "utf8"
);
if (
  !sourceApp.includes(
    "closeContextPickers: () => contextPickerController.close()"
  )
) {
  throw new Error(
    "Navigation Events composition no longer delegates Context Picker close to typed owner"
  );
}
if (!navigationOwner.includes("dependencies.closeContextPickers();")) {
  throw new Error(
    "Navigation Events owner no longer delegates Back Guard picker close through dependency"
  );
}

const offlineBootStart = sourceApp.indexOf(
  "const bootOfflineAuthenticated ="
);
const onlineBootStart = sourceApp.indexOf(
  "const bootOnlineAuthenticated =",
  offlineBootStart
);
if (offlineBootStart < 0 || onlineBootStart < 0) {
  throw new Error("Could not inspect typed offline authenticated startup");
}
const offlineBoot = sourceApp.slice(
  offlineBootStart,
  onlineBootStart
);
if (
  !offlineBoot.includes(
    "contextPickerController.updateLabels();"
  )
) {
  throw new Error(
    "Offline authenticated startup no longer delegates Context Picker labels to typed owner"
  );
}

console.log(
  "PASS: Context Picker UI ownership lives in typed Context, Cash keeps Cash rendering, typed application delegates Overlay/Back Guard/offline composition, and business/backend ownership remains outside"
);
