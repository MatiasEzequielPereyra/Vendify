export type OverlayObserver = Pick<MutationObserver, "observe">;

export type OverlayObserverFactory = (
  callback: MutationCallback
) => OverlayObserver;

export interface OverlayStabilityControllerDependencies {
  readonly closeUserMenu: () => void;
  readonly closeManagementMenu: () => void;
  readonly closeContextPickers: () => void;
  readonly document?: Document;
  readonly createObserver?: OverlayObserverFactory;
}

export interface OverlayStabilityController {
  readonly isModalVisible: typeof isModalVisible;
  readonly sync: () => void;
  readonly setup: () => void;
}

const ESCAPE_CLOSABLES = [
  ["modal-confirm", "btn-confirm-cancel"],
  ["modal-discount-auth", "btn-cancel-discount-auth"],
  ["modal-scanner-v29", "btn-close-scanner-v29"],
  ["modal-ticket-v228", "btn-close-ticket-v228"],
  ["modal-dashboard-v231", "btn-close-dashboard-v231"],
  ["modal-platform-admin-v231", "btn-close-platform-v231"],
  ["modal-diagnostico-v23011", "btn-close-diagnostic-v23011"],
  ["modal-inventario", "btn-close-inventory"],
  ["modal-compras", "btn-close-compras"],
  ["modal-historial", "btn-cerrar-historial"],
  ["modal-caja-operativa-v227", "btn-cerrar-caja-panel-v227"],
  ["modal-config", "btn-cerrar-config"],
  ["modal-equipo", "btn-cerrar-equipo"]
] as const;

export function isModalVisible(
  modal: HTMLElement | null | undefined
): boolean {
  return Boolean(
    modal &&
      !modal.classList.contains("hidden") &&
      !modal.hidden
  );
}

export function createOverlayStabilityController(
  dependencies: OverlayStabilityControllerDependencies
): OverlayStabilityController {
  const documentRef = dependencies.document ?? document;
  const createObserver =
    dependencies.createObserver ??
    ((callback: MutationCallback): OverlayObserver =>
      new MutationObserver(callback));

  let installed = false;

  function closeFloatingMenus(): void {
    dependencies.closeUserMenu();
    dependencies.closeManagementMenu();
    dependencies.closeContextPickers();
  }

  function sync(): void {
    const modals = Array.from(
      documentRef.querySelectorAll<HTMLElement>(".modal")
    );
    const visibleModals = modals.filter(isModalVisible);

    const body = documentRef.body as HTMLElement | null;
    body?.classList.toggle(
      "vendify-modal-open-v23011",
      visibleModals.length > 0
    );

    for (const modal of modals) {
      modal.setAttribute(
        "aria-hidden",
        isModalVisible(modal) ? "false" : "true"
      );
    }

    if (visibleModals.length > 0) {
      closeFloatingMenus();
    }
  }

  function handleEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;

    if (
      !documentRef
        .getElementById("gestion-menu-v230")
        ?.classList.contains("hidden")
    ) {
      dependencies.closeManagementMenu();
      return;
    }

    if (
      !documentRef
        .getElementById("user-menu")
        ?.classList.contains("hidden")
    ) {
      dependencies.closeUserMenu();
      return;
    }

    for (const [modalId, closeId] of ESCAPE_CLOSABLES) {
      const modal = documentRef.getElementById(modalId);
      if (!isModalVisible(modal)) continue;

      event.preventDefault();
      documentRef.getElementById(closeId)?.click();
      break;
    }
  }

  function setup(): void {
    if (installed) return;

    const observer = createObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "attributes")) {
        sync();
      }
    });

    documentRef.querySelectorAll<HTMLElement>(".modal").forEach((modal) => {
      observer.observe(modal, {
        attributes: true,
        attributeFilter: ["class", "hidden"]
      });
    });

    documentRef.addEventListener("keydown", handleEscape);
    sync();
    installed = true;
  }

  return Object.freeze({
    isModalVisible,
    sync,
    setup
  });
}
