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
    "Observability verification could not find modular bundles"
  );
}

const core = readFileSync(
  resolve(outputRoot, coreFile),
  "utf8"
);

const sourceApp = readFileSync(
  resolve(projectRoot, "app.js"),
  "utf8"
);

const typedOverlayOwner = readFileSync(
  resolve(projectRoot, "src/core/overlay-stability.ts"),
  "utf8"
);

const generatedApp = readFileSync(
  resolve(outputRoot, appFile),
  "utf8"
);

const typedOwner = readFileSync(
  resolve(
    projectRoot,
    "src/observability/diagnostics-controller.ts"
  ),
  "utf8"
);

const observabilityBridge = readFileSync(
  resolve(projectRoot, "src/legacy/observability-bridge.ts"),
  "utf8"
);

const contextOwner = readFileSync(
  resolve(projectRoot, "src/context/context-service.ts"),
  "utf8"
);

const browserAcceptance = readFileSync(
  resolve(projectRoot, "scripts/run-pwa-browser-acceptance.mjs"),
  "utf8"
);

for (const marker of [
  "createDiagnosticsController",
  "Solo Propietario o Administrador pueden ejecutar diagnósticos",
  "#btn-diagnostico-v23011",
  "#btn-close-diagnostic-v23011",
  "#btn-run-diagnostic-v23011",
  "#diagnostic-summary-v23011",
  "#diagnostic-issues-v23011"
]) {
  if (!core.includes(marker)) {
    throw new Error(
      `Modular core missing Diagnostics owner marker: ${marker}`
    );
  }
}

for (const marker of [
  "readonly createDiagnosticsController: typeof createDiagnosticsController",
  "createDiagnosticsController"
]) {
  if (!observabilityBridge.includes(marker)) {
    throw new Error(
      `Observability bridge missing Diagnostics API marker: ${marker}`
    );
  }
}

for (const app of [sourceApp, generatedApp]) {
  for (const marker of [
    "window.VendifyObservabilityV232.createDiagnosticsController({",
    "window.VendifyContextV232.runDiagnostic(supabaseClient)",
    "diagnosticsControllerV232.setup();"
  ]) {
    if (!app.includes(marker)) {
      throw new Error(
        `Compatibility app missing Diagnostics composition: ${marker}`
      );
    }
  }

  for (const obsolete of [
    "abrirDiagnosticoV23011",
    "cerrarDiagnosticoV23011",
    "renderDiagnosticoV23011",
    "ejecutarDiagnosticoV23011"
  ]) {
    if (app.includes(obsolete)) {
      throw new Error(
        `Compatibility app retained legacy Diagnostics owner: ${obsolete}`
      );
    }
  }
}

const stabilityStart = sourceApp.indexOf(
  "function setupStabilityV23011()"
);

const stabilityEnd = sourceApp.indexOf(
  "overlayStabilityControllerV232.setup();",
  stabilityStart
);

if (stabilityStart < 0 || stabilityEnd < 0) {
  throw new Error(
    "Could not inspect setupStabilityV23011 ownership boundary"
  );
}

const stabilitySetup = sourceApp.slice(
  stabilityStart,
  stabilityEnd
);

for (const forbiddenSelector of [
  "#btn-diagnostico-v23011",
  "#btn-close-diagnostic-v23011",
  "#modal-diagnostico-v23011 .modal-backdrop",
  "#btn-run-diagnostic-v23011"
]) {
  if (stabilitySetup.includes(forbiddenSelector)) {
    throw new Error(
      `setupStabilityV23011 still owns Diagnostics listener: ${forbiddenSelector}`
    );
  }
}

for (const forbidden of [
  "diagnostico_integridad_v1",
  "supabaseClient",
  "VendifyContextV232"
]) {
  if (typedOwner.includes(forbidden)) {
    throw new Error(
      `Diagnostics UI crossed Context/backend boundary: ${forbidden}`
    );
  }
}

if (!contextOwner.includes("diagnostico_integridad_v1")) {
  throw new Error(
    "Context no longer owns diagnostico_integridad_v1"
  );
}

if (
  !typedOverlayOwner.includes(
    '["modal-diagnostico-v23011", "btn-close-diagnostic-v23011"]'
  )
) {
  throw new Error(
    "Typed Overlay Escape no longer preserves Diagnostics close routing"
  );
}

for (const forbidden of [
  "createDiagnosticsController({",
  "cloneNode(true)",
  ".replaceWith("
]) {
  if (browserAcceptance.includes(forbidden)) {
    throw new Error(
      `Browser acceptance substitutes Diagnostics runtime composition: ${forbidden}`
    );
  }
}

for (const marker of [
  "diagnosticsButton.click();",
  "diagnosticsCloseButton.click();",
  'window.appContext.membership = { role: "owner" };',
  "Solo Propietario o Administrador pueden ejecutar diagnósticos",
  'runtimeComposition: "real-app-init-and-listeners"'
]) {
  if (!browserAcceptance.includes(marker)) {
    throw new Error(
      `Browser acceptance missing real Diagnostics proof: ${marker}`
    );
  }
}

console.log(
  "PASS: Diagnostics UI ownership lives in typed Observability, Context retains RPC ownership, app source/generated composition is real, and browser acceptance uses real app listeners"
);
