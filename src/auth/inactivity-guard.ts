import type { AuthSessionLike } from "./session-lifecycle.js";

export const SECURITY_IDLE_TIMEOUT_MS_V2301 = 8 * 60 * 60 * 1000;
export const SECURITY_ACTIVITY_KEY_V2301 = "vendify_last_activity_v2301";
export const SECURITY_ACTIVITY_WRITE_THROTTLE_MS_V2301 = 30000;
export const SECURITY_IDLE_CHECK_INTERVAL_MS_V2301 = 60000;
export const SECURITY_IDLE_LOGOUT_MESSAGE_V2301 =
  "La sesión se cerró por inactividad. Volvé a ingresar para continuar.";

export interface InactivityStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface InactivityGuardDependencies {
  readonly getSession: () => AuthSessionLike | null;
  readonly signOut: () => Promise<void>;
  readonly showToast: (
    message: string,
    type?: "error" | "info" | "success"
  ) => void;
  readonly now?: () => number;
  readonly storage?: InactivityStoragePort;
  readonly addWindowListener?: (
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions
  ) => void;
  readonly addDocumentListener?: (
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions
  ) => void;
  readonly getVisibilityState?: () => DocumentVisibilityState;
  readonly setInterval?: (handler: () => void, timeoutMs: number) => number;
}

export interface InactivitySessionGuard {
  readonly recordActivity: () => void;
  readonly check: () => Promise<void>;
  readonly start: () => void;
}

export function createInactivityGuard(
  dependencies: InactivityGuardDependencies
): InactivitySessionGuard {
  const now = dependencies.now ?? (() => Date.now());
  const storage = dependencies.storage ?? window.localStorage;
  const addWindowListener =
    dependencies.addWindowListener ??
    ((type, listener, options) => {
      window.addEventListener(type, listener, options);
    });
  const addDocumentListener =
    dependencies.addDocumentListener ??
    ((type, listener, options) => {
      document.addEventListener(type, listener, options);
    });
  const getVisibilityState =
    dependencies.getVisibilityState ?? (() => document.visibilityState);
  const scheduleInterval =
    dependencies.setInterval ??
    ((handler, timeoutMs) => window.setInterval(handler, timeoutMs));

  let lastPersistedAt = 0;
  let intervalHandle: number | null = null;
  let logoutRunning = false;
  let started = false;

  function recordActivity(): void {
    const current = now();
    if (current - lastPersistedAt < SECURITY_ACTIVITY_WRITE_THROTTLE_MS_V2301) {
      return;
    }

    lastPersistedAt = current;
    storage.setItem(SECURITY_ACTIVITY_KEY_V2301, String(current));
  }

  async function check(): Promise<void> {
    if (logoutRunning || !dependencies.getSession()?.user) return;

    const last = Number(
      storage.getItem(SECURITY_ACTIVITY_KEY_V2301) || now()
    );

    if (now() - last < SECURITY_IDLE_TIMEOUT_MS_V2301) return;

    logoutRunning = true;
    try {
      dependencies.showToast(SECURITY_IDLE_LOGOUT_MESSAGE_V2301, "info");
      await dependencies.signOut();
    } finally {
      logoutRunning = false;
    }
  }

  function start(): void {
    if (started) return;
    started = true;

    recordActivity();

    for (const eventName of ["pointerdown", "keydown", "touchstart"]) {
      addWindowListener(
        eventName,
        recordActivity,
        { passive: true, capture: true }
      );
    }

    addWindowListener("focus", () => {
      void check();
    });

    addDocumentListener("visibilitychange", () => {
      if (getVisibilityState() === "visible") {
        void check();
      }
    });

    if (intervalHandle === null) {
      intervalHandle = scheduleInterval(() => {
        void check();
      }, SECURITY_IDLE_CHECK_INTERVAL_MS_V2301);
    }
  }

  return Object.freeze({
    recordActivity,
    check,
    start
  });
}
