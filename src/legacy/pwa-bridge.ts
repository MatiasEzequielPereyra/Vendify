import { showToast } from "../core/toast.js";
import { createPwaController } from "../platform/pwa-controller.js";

// Consumed by app.js until typed bootstrap replaces its init() composition.
const controller = createPwaController({
  registerServiceWorker: () =>
    "serviceWorker" in navigator ? navigator.serviceWorker.register("./sw.js") : null,
  onBeforeInstallPrompt: (handler) => {
    window.addEventListener("beforeinstallprompt", handler);
  },
  onInstallClick: (handler) => {
    document.querySelector("#btn-install")?.addEventListener("click", handler);
  },
  onDismissClick: (handler) => {
    document.querySelector("#btn-install-dismiss")?.addEventListener("click", handler);
  },
  getStoredValue: (key) => localStorage.getItem(key),
  setStoredValue: (key, value) => {
    localStorage.setItem(key, value);
  },
  isStandalone: () => window.matchMedia("(display-mode: standalone)").matches,
  showBanner: () => document.querySelector("#install-banner")?.classList.remove("hidden"),
  hideBanner: () => document.querySelector("#install-banner")?.classList.add("hidden"),
  showInstalledToast: () => showToast("¡App instalada!", "success"),
  warnRegistrationFailure: (error) => {
    console.warn("[PWA] No se pudo registrar el service worker:", error);
  }
});

declare global {
  interface Window {
    VendifyPwaV232?: typeof controller;
  }
}

window.VendifyPwaV232 = controller;
