export type ConnectionStatusElementPort = Pick<
  Element,
  "classList" | "textContent" | "querySelector" | "addEventListener"
>;

export interface ConnectionStatusControllerDependencies {
  readonly isOnline: () => boolean;
  readonly getPendingOfflineSalesCount: () => number;
  readonly syncPendingOfflineSales: () => unknown;
  readonly syncAll: (showToast: boolean) => unknown;
  readonly getElement?: (
    selector: string
  ) => ConnectionStatusElementPort | null;
  readonly addWindowListener?: (
    type: "online" | "offline",
    listener: () => void | Promise<void>
  ) => void;
}

export interface ConnectionStatusController {
  readonly setup: () => void;
  readonly setState: (
    state?: string,
    label?: string | null
  ) => void;
  readonly refresh: () => void;
}

const DEFAULT_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    online: "Online",
    offline: "Sin conexión",
    syncing: "Sincronizando",
    error: "Error de sync"
  });

function connectionLabel(
  state: string,
  label: string | null
): string {
  if (label) return label;
  return DEFAULT_LABELS[state] ?? state;
}

export function createConnectionStatusController(
  dependencies: ConnectionStatusControllerDependencies
): ConnectionStatusController {
  const getElement =
    dependencies.getElement
    ?? ((selector: string) =>
      document.querySelector(selector));

  const addWindowListener =
    dependencies.addWindowListener
    ?? ((
      type: "online" | "offline",
      listener: () => void | Promise<void>
    ) => {
      window.addEventListener(type, () => {
        void listener();
      });
    });

  let listenersBound = false;

  function setState(
    state = "online",
    label: string | null = null
  ): void {
    const status = getElement("#connection-status-v23011");
    const text = getElement("#connection-label-v23011");

    if (!status || !text) return;

    status.classList.remove(
      "online",
      "offline",
      "syncing",
      "error"
    );
    status.classList.add(state);

    text.textContent = connectionLabel(state, label);

    const icon = status.querySelector("use");

    if (icon) {
      icon.setAttribute(
        "href",
        state === "offline" || state === "error"
          ? "#vi-wifi-off"
          : "#vi-wifi"
      );
    }
  }

  function refresh(): void {
    setState(
      dependencies.isOnline()
        ? "online"
        : "offline"
    );
  }

  async function runManualSync(): Promise<void> {
    if (
      dependencies.isOnline()
      && dependencies.getPendingOfflineSalesCount() > 0
    ) {
      await dependencies.syncPendingOfflineSales();
    }

    await dependencies.syncAll(true);
  }

  function setup(): void {
    refresh();

    if (listenersBound) return;
    listenersBound = true;

    addWindowListener("online", () => {
      setState("syncing");
      void dependencies.syncAll(false);
    });

    addWindowListener("offline", refresh);

    getElement("#connection-status-v23011")
      ?.addEventListener("click", () => {
        void runManualSync();
      });

    getElement("#btn-sync-now-v23011")
      ?.addEventListener("click", () => {
        void dependencies.syncAll(true);
      });
  }

  return Object.freeze({
    setup,
    setState,
    refresh
  });
}
