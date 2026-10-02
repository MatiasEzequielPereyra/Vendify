export interface ConnectionStatusElementPort {
  readonly classList: {
    add(...tokens: string[]): void;
    remove(...tokens: string[]): void;
  };
  textContent: string | null;
  querySelector(selector: string): {
    setAttribute(name: string, value: string): void;
  } | null;
  addEventListener(
    type: string,
    listener: () => void | Promise<void>
  ): void;
}

export interface ConnectionStatusControllerDependencies {
  readonly isOnline: () => boolean;
  readonly getPendingOfflineSalesCount: () => number;
  readonly syncPendingOfflineSales: () => Promise<unknown> | unknown;
  readonly syncAll: (showToast: boolean) => Promise<unknown> | unknown;
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

export function createConnectionStatusController(
  dependencies: ConnectionStatusControllerDependencies
): ConnectionStatusController {
  const getElement =
    dependencies.getElement
    ?? ((selector: string) =>
      document.querySelector(selector) as unknown as
        ConnectionStatusElementPort | null);

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

    text.textContent =
      label || DEFAULT_LABELS[state] || state;

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
      ?.addEventListener("click", async () => {
        await runManualSync();
      });

    getElement("#btn-sync-now-v23011")
      ?.addEventListener("click", async () => {
        await dependencies.syncAll(true);
      });
  }

  return Object.freeze({
    setup,
    setState,
    refresh
  });
}
