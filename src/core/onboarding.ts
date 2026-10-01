export const ONBOARDING_STORAGE_KEY = "kiosco_onboarding_done";

export interface OnboardingStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type OnboardingElementPort = Pick<Element, "classList" | "addEventListener">;

export interface OnboardingControllerDependencies {
  readonly onExamples: () => void;
  readonly storage?: OnboardingStoragePort;
  readonly getElement?: (selector: string) => OnboardingElementPort | null;
}

export interface OnboardingController {
  readonly setup: () => void;
}

export function createOnboardingController(
  dependencies: OnboardingControllerDependencies
): OnboardingController {
  const storage = dependencies.storage ?? window.localStorage;
  const getElement =
    dependencies.getElement ??
    ((selector: string) => document.querySelector(selector));

  let listenersBound = false;

  function setup(): void {
    const done = storage.getItem(ONBOARDING_STORAGE_KEY);
    if (done) return;

    const onboarding = getElement("#onboarding");
    if (!onboarding) return;
    if (listenersBound) return;
    listenersBound = true;

    onboarding.classList.remove("hidden");

    const close = (): void => {
      storage.setItem(ONBOARDING_STORAGE_KEY, "1");
      onboarding.classList.add("hidden");
    };

    getElement("#btn-empezar")?.addEventListener("click", close);
    getElement("#btn-empezar-ejemplos")?.addEventListener("click", () => {
      close();
      dependencies.onExamples();
    });
  }

  return Object.freeze({ setup });
}
