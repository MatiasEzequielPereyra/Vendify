export interface NavigationPositionOptions {
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly gap?: number;
  readonly margin?: number;
}

export interface NavigationConfirmOptions {
  readonly okText?: string | null;
  readonly cancelText?: string;
  readonly danger?: boolean | null;
}

export interface NavigationModalTarget {
  readonly isOpen: () => boolean;
  readonly close: () => void;
}

export interface NavigationEventsControllerDependencies {
  readonly toggleTheme: () => void;
  readonly exportProducts: () => void;
  readonly openSettings: (tab: string) => void;
  readonly activateSettingsTab: (tab?: string) => void;
  readonly closeSettings: () => void;
  readonly openCatalog: () => void;
  readonly openTeam: () => void | Promise<void>;
  readonly dismissConfirmation: () => void;
  readonly closeTopOpenModal: (
    targets: readonly NavigationModalTarget[]
  ) => boolean;
  readonly openSale: () => void;
  readonly focusProductSearch: () => void;
  readonly openProductEditor: () => void;
  readonly hasPermission: (permission: string) => boolean;
  readonly closeProductEditor: () => void;
  readonly closeSale: () => void;
  readonly closeSalesHistory: () => void;
  readonly closeTeam: () => void;
  readonly closeTeamEditor: () => void;
  readonly closeTeamPasswordReset: () => void;
  readonly closeScanner: () => void;
  readonly closeContextPickers: () => void;
  readonly getCartSize: () => number;
  readonly confirm: (
    title: string,
    message: string,
    options?: NavigationConfirmOptions
  ) => Promise<boolean>;
  readonly showToast: (message: string, type?: string) => void;
  readonly isModalVisible: (modal: HTMLElement) => boolean;
  readonly getAppReady: () => boolean;
  readonly document?: Document;
  readonly window?: Window;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  readonly schedule?: (callback: () => void, delay: number) => unknown;
}

export interface NavigationEventsController {
  readonly positionPopover: (
    menu: HTMLElement,
    trigger: HTMLElement,
    options?: NavigationPositionOptions
  ) => void;
  readonly toggleUserMenu: (force?: boolean) => void;
  readonly closeUserMenu: () => void;
  readonly toggleManagementMenu: (force?: boolean) => void;
  readonly closeManagementMenu: () => void;
  readonly setup: () => void;
}

function closestFromTarget(
  target: EventTarget | null,
  selector: string
): HTMLElement | null {
  if (
    !target ||
    typeof (target as { closest?: unknown }).closest !== "function"
  ) {
    return null;
  }

  return (
    target as unknown as {
      closest(selector: string): HTMLElement | null;
    }
  ).closest(selector);
}

export function createNavigationEventsController(
  dependencies: NavigationEventsControllerDependencies
): NavigationEventsController {
  const documentRef = dependencies.document ?? document;
  const windowRef = dependencies.window ?? window;
  const requestFrame =
    dependencies.requestAnimationFrame ??
    windowRef.requestAnimationFrame.bind(windowRef);
  const schedule =
    dependencies.schedule ??
    ((callback: () => void, delay: number): number =>
      windowRef.setTimeout(callback, delay));

  let installed = false;
  let backGuardExitConfirming = false;
  let backGuardEnabled = true;

  function positionPopover(
    menu: HTMLElement,
    trigger: HTMLElement,
    {
      minWidth = 230,
      maxWidth = 290,
      gap = 8,
      margin = 10
    }: NavigationPositionOptions = {}
  ): void {
    if (menu.classList.contains("hidden")) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = windowRef.innerWidth;
    const viewportHeight = windowRef.innerHeight;
    const maxAvailableWidth = Math.max(180, viewportWidth - margin * 2);
    const width = Math.min(maxWidth, maxAvailableWidth);

    let left = rect.right - width;
    left = Math.max(
      margin,
      Math.min(left, viewportWidth - width - margin)
    );

    menu.style.position = "fixed";
    menu.style.left = `${String(left)}px`;
    menu.style.right = "auto";
    menu.style.width = `${String(
      Math.max(
        Math.min(minWidth, maxAvailableWidth),
        width
      )
    )}px`;
    menu.style.maxWidth = `calc(100vw - ${String(margin * 2)}px)`;

    const measuredHeight = Math.min(
      menu.scrollHeight || 240,
      viewportHeight - margin * 2
    );
    const below = viewportHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const openAbove =
      below < Math.min(measuredHeight, 250) && above > below;

    if (openAbove) {
      menu.style.top =
        `${String(Math.max(margin, rect.top - measuredHeight - gap))}px`;
      menu.dataset.placement = "top";
      return;
    }

    menu.style.top =
      `${String(
        Math.min(
          rect.bottom + gap,
          Math.max(
            margin,
            viewportHeight - measuredHeight - margin
          )
        )
      )}px`;
    menu.dataset.placement = "bottom";
  }

  function clearPosition(menu: HTMLElement | null): void {
    if (!menu) return;
    menu.style.position = "";
    menu.style.left = "";
    menu.style.right = "";
    menu.style.top = "";
    menu.style.width = "";
    menu.style.maxWidth = "";
    delete menu.dataset.placement;
  }

  function positionUserMenu(): void {
    const menu = documentRef.getElementById("user-menu");
    const trigger = documentRef.getElementById("btn-user-menu");
    if (!menu || !trigger) return;
    positionPopover(menu, trigger, {
      minWidth: 230,
      maxWidth: 270
    });
  }

  function positionManagementMenu(): void {
    const menu = documentRef.getElementById("gestion-menu-v230");
    const trigger = documentRef.getElementById("btn-gestion-v230");
    if (!menu || !trigger) return;
    positionPopover(menu, trigger, {
      minWidth: 252,
      maxWidth: 292
    });
  }

  function toggleUserMenu(force?: boolean): void {
    const menu = documentRef.getElementById("user-menu");
    const trigger = documentRef.getElementById("btn-user-menu");
    if (!menu || !trigger) return;

    const open =
      typeof force === "boolean"
        ? force
        : menu.classList.contains("hidden");

    menu.classList.toggle("hidden", !open);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");

    if (open) {
      toggleManagementMenu(false);
      requestFrame(() => { positionUserMenu(); });
      return;
    }

    clearPosition(menu);
  }

  function closeUserMenu(): void {
    toggleUserMenu(false);
  }

  function toggleManagementMenu(force?: boolean): void {
    const menu = documentRef.getElementById("gestion-menu-v230");
    const trigger = documentRef.getElementById("btn-gestion-v230");
    if (!menu || !trigger) return;

    const open =
      typeof force === "boolean"
        ? force
        : menu.classList.contains("hidden");

    menu.classList.toggle("hidden", !open);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");

    if (open) {
      toggleUserMenu(false);
      requestFrame(() => { positionManagementMenu(); });
      return;
    }

    clearPosition(menu);
  }

  function closeManagementMenu(): void {
    toggleManagementMenu(false);
  }

  function isOpen(id: string): boolean {
    const modal = documentRef.getElementById(id);
    return Boolean(modal && !modal.classList.contains("hidden"));
  }

  function clickById(id: string): void {
    documentRef.getElementById(id)?.click();
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    const tag = documentRef.activeElement?.tagName;
    const typing =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT";

    if (event.key === "Escape") {
      const escapeTargets: NavigationModalTarget[] = [
        {
          isOpen: () => isOpen("modal-confirm"),
          close: dependencies.dismissConfirmation
        },
        {
          isOpen: () => isOpen("modal-ticket-v228"),
          close: () => { clickById("btn-close-ticket-v228"); }
        },
        {
          isOpen: () => isOpen("modal-return-v228"),
          close: () => { clickById("btn-close-return-v228"); }
        },
        {
          isOpen: () => isOpen("modal-caja-movimiento-v227"),
          close: () => { clickById("btn-close-cash-movement-v227"); }
        },
        {
          isOpen: () => isOpen("modal-cash-close-v227"),
          close: () => { clickById("btn-close-cash-close-v227"); }
        },
        {
          isOpen: () => isOpen("modal-editar-empleado"),
          close: dependencies.closeTeamEditor
        },
        {
          isOpen: () => isOpen("modal-reset-empleado"),
          close: dependencies.closeTeamPasswordReset
        },
        {
          isOpen: () => isOpen("modal-proveedor-editor"),
          close: () => { clickById("btn-close-proveedor-editor"); }
        },
        {
          isOpen: () => isOpen("modal-compra-editor"),
          close: () => { clickById("btn-close-compra-editor"); }
        },
        {
          isOpen: () => isOpen("modal-scanner-v29"),
          close: dependencies.closeScanner
        },
        {
          isOpen: () => isOpen("modal"),
          close: dependencies.closeProductEditor
        },
        {
          isOpen: () => isOpen("modal-catalogo-v29"),
          close: () => { clickById("btn-close-catalogo-v29"); }
        },
        {
          isOpen: () => isOpen("modal-historial"),
          close: dependencies.closeSalesHistory
        },
        {
          isOpen: () => isOpen("modal-compras"),
          close: () => { clickById("btn-close-compras"); }
        },
        {
          isOpen: () => isOpen("modal-inventario"),
          close: () => { clickById("btn-close-inventory"); }
        },
        {
          isOpen: () => isOpen("modal-caja-operativa-v227"),
          close: () => { clickById("btn-cerrar-caja-panel-v227"); }
        },
        {
          isOpen: () => isOpen("modal-dashboard-v231"),
          close: () => { clickById("btn-close-dashboard-v231"); }
        },
        {
          isOpen: () => isOpen("modal-equipo"),
          close: dependencies.closeTeam
        },
        {
          isOpen: () => isOpen("modal-venta"),
          close: dependencies.closeSale
        },
        {
          isOpen: () => isOpen("modal-config"),
          close: dependencies.closeSettings
        }
      ];

      if (dependencies.closeTopOpenModal(escapeTargets)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (isOpen("modal")) dependencies.closeProductEditor();
      else if (isOpen("modal-venta")) dependencies.closeSale();
      else if (isOpen("modal-historial")) dependencies.closeSalesHistory();
      else if (isOpen("modal-equipo")) dependencies.closeTeam();
      else if (isOpen("modal-editar-empleado")) dependencies.closeTeamEditor();
      else if (isOpen("modal-reset-empleado")) {
        dependencies.closeTeamPasswordReset();
      } else if (isOpen("modal-config")) dependencies.closeSettings();
      else if (isOpen("modal-confirm")) dependencies.dismissConfirmation();
      return;
    }

    if (typing) return;

    if (event.key === "v" || event.key === "V") {
      event.preventDefault();
      dependencies.openSale();
    } else if (event.key === "t" || event.key === "T") {
      event.preventDefault();
      dependencies.toggleTheme();
    } else if (event.key === "/") {
      event.preventDefault();
      dependencies.focusProductSearch();
    } else if (
      (event.key === "n" || event.key === "N") &&
      dependencies.hasPermission("manageProducts")
    ) {
      event.preventDefault();
      dependencies.openProductEditor();
    }
  }

  function appVisible(): boolean {
    return (
      dependencies.getAppReady() &&
      !documentRef
        .querySelector<HTMLElement>(".app")
        ?.classList.contains("hidden")
    );
  }

  function armBackGuard(): void {
    if (!backGuardEnabled) return;

    const current =
      (windowRef.history.state ?? {}) as Record<string, unknown>;

    windowRef.history.replaceState(
      {
        ...current,
        vendifyBaseV2311: true
      },
      "",
      windowRef.location.href
    );

    windowRef.history.pushState(
      {
        vendifyGuardV2311: true
      },
      "",
      windowRef.location.href
    );
  }

  function rearmBackGuard(): void {
    if (!backGuardEnabled) return;

    const state =
      (windowRef.history.state ?? {}) as Record<string, unknown>;
    if (state.vendifyGuardV2311) return;

    windowRef.history.pushState(
      {
        vendifyGuardV2311: true
      },
      "",
      windowRef.location.href
    );
  }

  function hasOpenPopover(): boolean {
    return [
      "gestion-menu-v230",
      "user-menu",
      "branch-menu-v23013",
      "cash-menu-v23013"
    ].some((id) => {
      const menu = documentRef.getElementById(id);
      return Boolean(menu && !menu.classList.contains("hidden"));
    });
  }

  function closeOpenPopover(): boolean {
    if (!hasOpenPopover()) return false;

    closeManagementMenu();
    closeUserMenu();
    dependencies.closeContextPickers();
    return true;
  }

  function topVisibleModal(): HTMLElement | null {
    const visible = Array.from(
      documentRef.querySelectorAll<HTMLElement>(".modal")
    ).filter((modal) => dependencies.isModalVisible(modal));

    if (!visible.length) return null;

    return (
      visible
        .map((modal, index) => ({
          modal,
          index,
          z:
            Number.parseInt(
              windowRef.getComputedStyle(modal).zIndex || "0",
              10
            ) || 0
        }))
        .sort((a, b) => {
          if (b.z !== a.z) return b.z - a.z;
          return b.index - a.index;
        })[0]?.modal ?? null
    );
  }

  async function closeTopLayer(): Promise<boolean> {
    if (closeOpenPopover()) return true;

    const modal = topVisibleModal();
    if (!modal) return false;

    if (modal.id === "modal-venta") {
      if (dependencies.getCartSize() > 0) {
        const close = await dependencies.confirm(
          "¿Cerrar esta venta?",
          "El carrito actual se descartará.",
          {
            okText: "Cerrar venta",
            cancelText: "Seguir vendiendo",
            danger: false
          }
        );

        if (close) dependencies.closeSale();
      } else {
        dependencies.closeSale();
      }

      return true;
    }

    if (modal.id === "modal-confirm") {
      documentRef.getElementById("btn-confirm-cancel")?.click();
      return true;
    }

    const closeButton =
      modal.querySelector<HTMLButtonElement>(
        'button[id*="close"], button[id*="cerrar"]'
      ) ??
      modal.querySelector<HTMLButtonElement>(
        'button[id*="cancel"], button[id*="cancelar"]'
      );

    if (closeButton) {
      closeButton.click();
      return true;
    }

    modal.classList.add("hidden");
    return true;
  }

  function onPopState(): void {
    void handleBack();
  }

  function attemptExit(): void {
    backGuardEnabled = false;
    windowRef.removeEventListener("popstate", onPopState);

    const currentUrl = windowRef.location.href;
    let moved = false;

    const markMoved = (): void => {
      moved = windowRef.location.href !== currentUrl;
    };

    windowRef.addEventListener(
      "pagehide",
      () => {
        moved = true;
      },
      { once: true }
    );

    windowRef.history.back();

    schedule(() => {
      markMoved();
      if (
        moved ||
        documentRef.visibilityState === "hidden"
      ) {
        return;
      }

      try {
        windowRef.close();
      } catch {
        // Browsers may reject scripted close for normal tabs.
      }
    }, 180);

    schedule(() => {
      markMoved();

      if (
        !moved &&
        documentRef.visibilityState !== "hidden"
      ) {
        dependencies.showToast(
          "El sistema no permite cerrar esta PWA por código. El próximo gesto Atrás saldrá normalmente.",
          "info"
        );
      }
    }, 550);
  }

  async function handleBack(): Promise<void> {
    if (!backGuardEnabled || !appVisible()) return;

    const handled = await closeTopLayer();

    if (handled) {
      rearmBackGuard();
      return;
    }

    if (backGuardExitConfirming) {
      rearmBackGuard();
      return;
    }

    backGuardExitConfirming = true;

    const exit = await dependencies.confirm(
      "¿Salir de Vendify?",
      "No hay ninguna pantalla abierta. ¿Querés salir de la aplicación?",
      {
        okText: "Salir",
        cancelText: "Seguir en Vendify",
        danger: true
      }
    );

    backGuardExitConfirming = false;

    if (!exit) {
      rearmBackGuard();
      return;
    }

    attemptExit();
  }

  function setup(): void {
    if (installed) return;
    installed = true;
    backGuardEnabled = true;

    documentRef
      .getElementById("btn-theme")
      ?.addEventListener("click", dependencies.toggleTheme);
    documentRef
      .getElementById("btn-export")
      ?.addEventListener("click", dependencies.exportProducts);

    documentRef
      .getElementById("btn-user-menu")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleUserMenu();
      });

    documentRef
      .getElementById("user-menu")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();
      });

    documentRef
      .getElementById("btn-gestion-v230")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleManagementMenu();
      });

    documentRef
      .getElementById("gestion-menu-v230")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (closestFromTarget(event.target, "button")) {
          closeManagementMenu();
        }
      });

    documentRef.addEventListener("click", () => {
      closeUserMenu();
      closeManagementMenu();
    });

    windowRef.addEventListener("resize", () => {
      if (
        !documentRef
          .getElementById("user-menu")
          ?.classList.contains("hidden")
      ) {
        positionUserMenu();
      }

      if (
        !documentRef
          .getElementById("gestion-menu-v230")
          ?.classList.contains("hidden")
      ) {
        positionManagementMenu();
      }
    });

    windowRef.addEventListener(
      "scroll",
      () => {
        closeUserMenu();
        closeManagementMenu();
      },
      { passive: true }
    );

    documentRef
      .querySelector<HTMLElement>(".header-actions-vpro")
      ?.addEventListener(
        "scroll",
        () => { closeManagementMenu(); },
        { passive: true }
      );

    documentRef
      .getElementById("btn-user-settings")
      ?.addEventListener("click", () => {
        closeUserMenu();
        dependencies.openSettings("general");
      });

    documentRef
      .querySelectorAll<HTMLElement>(".config-tab-v224")
      .forEach((button) => {
        button.addEventListener("click", () => {
          dependencies.activateSettingsTab(
            button.dataset.configTab
          );
        });
      });

    documentRef
      .querySelectorAll<HTMLElement>("[data-config-go]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          dependencies.activateSettingsTab(
            button.dataset.configGo
          );
        });
      });

    documentRef
      .getElementById("btn-config-catalogo")
      ?.addEventListener("click", () => {
        dependencies.closeSettings();
        dependencies.openCatalog();
      });

    documentRef
      .getElementById("btn-config-equipo")
      ?.addEventListener("click", () => {
        dependencies.closeSettings();
        void dependencies.openTeam();
      });

    documentRef
      .getElementById("btn-cerrar-config")
      ?.addEventListener("click", dependencies.closeSettings);
    documentRef
      .getElementById("btn-cerrar-config-ok")
      ?.addEventListener("click", dependencies.closeSettings);
    documentRef
      .querySelector<HTMLElement>("#modal-config .modal-backdrop")
      ?.addEventListener("click", dependencies.closeSettings);

    documentRef
      .querySelector<HTMLElement>("#modal-confirm .modal-backdrop")
      ?.addEventListener(
        "click",
        dependencies.dismissConfirmation
      );

    documentRef.addEventListener(
      "keydown",
      handleGlobalKeydown
    );

    armBackGuard();
    windowRef.addEventListener("popstate", onPopState);
  }

  return Object.freeze({
    positionPopover,
    toggleUserMenu,
    closeUserMenu,
    toggleManagementMenu,
    closeManagementMenu,
    setup
  });
}
