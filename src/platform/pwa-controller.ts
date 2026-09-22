const INSTALL_DISMISS_KEY = "kiosco_install_dismiss";

interface InstallPrompt {
  readonly preventDefault: () => void;
  readonly prompt: () => unknown;
  readonly userChoice: PromiseLike<unknown>;
}

export interface PwaControllerDependencies {
  readonly registerServiceWorker: () => Promise<unknown> | null;
  readonly onBeforeInstallPrompt: (handler: (event: unknown) => void) => void;
  readonly onInstallClick: (handler: () => void) => void;
  readonly onDismissClick: (handler: () => void) => void;
  readonly getStoredValue: (key: string) => string | null;
  readonly setStoredValue: (key: string, value: string) => void;
  readonly isStandalone: () => boolean;
  readonly showBanner: () => void;
  readonly hideBanner: () => void;
  readonly showInstalledToast: () => void;
  readonly warnRegistrationFailure: (error: unknown) => void;
}

export interface PwaController {
  readonly registerServiceWorker: () => void;
  readonly setupInstallPrompt: () => void;
}

function isInstallPrompt(value: unknown): value is InstallPrompt {
  if (typeof value !== "object" || value === null) return false;
  return "preventDefault" in value && typeof value.preventDefault === "function"
    && "prompt" in value && typeof value.prompt === "function"
    && "userChoice" in value && typeof value.userChoice === "object"
    && value.userChoice !== null && "then" in value.userChoice
    && typeof value.userChoice.then === "function";
}

function wasAccepted(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && "outcome" in value && value.outcome === "accepted";
}

export function createPwaController(dependencies: PwaControllerDependencies): PwaController {
  let deferredInstallPrompt: InstallPrompt | null = null;
  let promptListenersBound = false;

  function registerServiceWorker(): void {
    dependencies.registerServiceWorker()?.catch(dependencies.warnRegistrationFailure);
  }

  function setupInstallPrompt(): void {
    if (promptListenersBound) return;
    promptListenersBound = true;

    dependencies.onBeforeInstallPrompt((event) => {
      if (!isInstallPrompt(event)) return;
      event.preventDefault();
      deferredInstallPrompt = event;
      if (dependencies.getStoredValue(INSTALL_DISMISS_KEY)) return;
      if (dependencies.isStandalone()) return;
      dependencies.showBanner();
    });

    dependencies.onInstallClick(() => {
      const prompt = deferredInstallPrompt;
      if (!prompt) return;
      prompt.prompt();
      void Promise.resolve(prompt.userChoice).then((choice) => {
        deferredInstallPrompt = null;
        dependencies.hideBanner();
        if (wasAccepted(choice)) dependencies.showInstalledToast();
      });
    });

    dependencies.onDismissClick(() => {
      dependencies.setStoredValue(INSTALL_DISMISS_KEY, "1");
      dependencies.hideBanner();
    });
  }

  return Object.freeze({ registerServiceWorker, setupInstallPrompt });
}
