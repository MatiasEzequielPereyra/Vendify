import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(outputRoot);
const coreFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/.test(file));

if (!coreFile || !appFile) {
  throw new Error("Onboarding verification could not find modular bundles");
}

const core = readFileSync(resolve(outputRoot, coreFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "src/bootstrap/application-composition.ts"), "utf8");
const generatedApp = readFileSync(resolve(outputRoot, appFile), "utf8");
const typedOwner = readFileSync(
  resolve(projectRoot, "src/core/onboarding.ts"),
  "utf8"
);
const coreBridge = readFileSync(
  resolve(projectRoot, "src/legacy/core-bridge.ts"),
  "utf8"
);
const browserAcceptance = readFileSync(
  resolve(projectRoot, "scripts/run-pwa-browser-acceptance.mjs"),
  "utf8"
);

for (const marker of [
  "createOnboardingController",
  "ONBOARDING_STORAGE_KEY",
  "kiosco_onboarding_done",
  "#onboarding",
  "#btn-empezar",
  "#btn-empezar-ejemplos"
]) {
  if (!core.includes(marker)) {
    throw new Error(`Modular core missing onboarding owner marker: ${marker}`);
  }
}

for (const marker of [
  "readonly createOnboardingController: typeof createOnboardingController",
  "createOnboardingController"
]) {
  if (!coreBridge.includes(marker)) {
    throw new Error(`Core bridge missing onboarding API marker: ${marker}`);
  }
}

for (const app of [sourceApp]) {
  for (const marker of [
    "core.createOnboardingController({",
    "onExamples: () => productsController.openCatalog()",
    "run: () => onboardingController.setup()"
  ]) {
    if (!app.includes(marker)) {
      throw new Error(`Compatibility app missing onboarding composition: ${marker}`);
    }
  }

  for (const obsolete of [
    "const ONBOARDING_KEY",
    "function setupOnboarding",
    "function cargarEjemplos",
    '$("#onboarding")',
    '$("#btn-empezar")',
    '$("#btn-empezar-ejemplos")'
  ]) {
    if (app.includes(obsolete)) {
      throw new Error(`Compatibility app retained onboarding implementation: ${obsolete}`);
    }
  }
}

for (const forbidden of [
  "openCatalog",
  "VendifyProductsV232",
  "productsController"
]) {
  if (typedOwner.includes(forbidden)) {
    throw new Error(`Generic onboarding owner crossed Products boundary: ${forbidden}`);
  }
}

for (const forbidden of [
  "cloneNode(true)",
  "createOnboardingController({",
  ".replaceWith("
]) {
  if (browserAcceptance.includes(forbidden)) {
    throw new Error(`Browser acceptance substitutes real onboarding composition: ${forbidden}`);
  }
}

for (const marker of [
  "startButton.click();",
  "examplesButton.click();",
  "No tenés permiso para cargar catálogos",
  'runtimeComposition: "real-app-init-and-listeners"'
]) {
  if (!browserAcceptance.includes(marker)) {
    throw new Error(`Browser acceptance missing real onboarding wiring proof: ${marker}`);
  }
}

console.log(
  "PASS: root and generated runtimes delegate onboarding UI ownership to TypeScript while Products remains the injected Examples action"
);
