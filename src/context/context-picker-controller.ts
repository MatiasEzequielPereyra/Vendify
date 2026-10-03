export type ContextPickerKind = "branch" | "cash";

export interface ContextPickerContext {
  readonly branch: {
    readonly id: string | null;
    readonly name: string;
  };
  readonly cashRegister: {
    readonly id: string | null;
    readonly name: string;
  };
}

export interface ContextPickerBranch {
  readonly id: string;
  readonly name: string;
}

export interface ContextPickerPositionOptions {
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly gap?: number;
  readonly margin?: number;
}

export interface ContextPickerControllerDependencies {
  readonly getContext: () => ContextPickerContext;
  readonly getBranches: () => ContextPickerBranch[];
  readonly selectBranch: (id: string) => Promise<void>;
  readonly selectCash: (id: string) => Promise<void>;
  readonly renderCashOptions: () => void;
  readonly closeUserMenu: () => void;
  readonly closeManagementMenu: () => void;
  readonly positionPopover: (
    menu: HTMLElement,
    trigger: HTMLElement,
    options: ContextPickerPositionOptions
  ) => void;
  readonly icon: (name: string) => string;
  readonly document?: Document;
  readonly window?: Window;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
}

export interface ContextPickerController {
  readonly close: (except?: string | null) => void;
  readonly toggle: (kind: ContextPickerKind, force?: boolean) => void;
  readonly updateLabels: () => void;
  readonly renderBranchOptions: () => void;
  readonly renderCashOptions: () => void;
  readonly selectBranch: (id: string) => Promise<void>;
  readonly selectCash: (id: string) => Promise<void>;
  readonly setup: () => void;
}

const BRANCH_PICKER = {
  kind: "branch",
  menuId: "branch-menu-v23013",
  triggerId: "branch-trigger-v23013"
} as const;

const CASH_PICKER = {
  kind: "cash",
  menuId: "cash-menu-v23013",
  triggerId: "cash-trigger-v23013"
} as const;

const PICKERS = [BRANCH_PICKER, CASH_PICKER] as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
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

export function createContextPickerController(
  dependencies: ContextPickerControllerDependencies
): ContextPickerController {
  const documentRef = dependencies.document ?? document;
  const windowRef = dependencies.window ?? window;
  const requestFrame =
    dependencies.requestAnimationFrame ??
    windowRef.requestAnimationFrame.bind(windowRef);

  let installed = false;

  function picker(kind: ContextPickerKind) {
    return kind === "branch" ? BRANCH_PICKER : CASH_PICKER;
  }

  function close(except: string | null = null): void {
    for (const entry of PICKERS) {
      if (except === entry.menuId) continue;

      const menu = documentRef.getElementById(entry.menuId);
      const trigger = documentRef.getElementById(entry.triggerId);
      menu?.classList.add("hidden");
      trigger?.setAttribute("aria-expanded", "false");
    }
  }

  function toggle(kind: ContextPickerKind, force?: boolean): void {
    const entry = picker(kind);
    const menu = documentRef.getElementById(entry.menuId);
    const trigger = documentRef.getElementById(entry.triggerId);

    if (!menu || !trigger) return;

    const open =
      typeof force === "boolean"
        ? force
        : menu.classList.contains("hidden");

    if (!open) {
      menu.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
      return;
    }

    close(menu.id);
    dependencies.closeUserMenu();
    dependencies.closeManagementMenu();

    menu.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");

    requestFrame(() => {
      dependencies.positionPopover(menu, trigger, {
        minWidth: 248,
        maxWidth: 300,
        gap: 8,
        margin: 10
      });
    });
  }

  function updateLabels(): void {
    const context = dependencies.getContext();
    const branchLabel = documentRef.getElementById(
      "branch-current-label-v23013"
    );
    const cashLabel = documentRef.getElementById(
      "cash-current-label-v23013"
    );

    if (branchLabel) {
      branchLabel.textContent = context.branch.name || "Sin sucursal";
      branchLabel.title = context.branch.name || "";
    }

    if (cashLabel) {
      cashLabel.textContent = context.cashRegister.name || "Sin caja";
      cashLabel.title = context.cashRegister.name || "";
    }
  }

  function renderBranchOptions(): void {
    const container = documentRef.getElementById(
      "branch-options-v23013"
    );
    if (!container) return;

    const branches = dependencies.getBranches();
    if (!branches.length) {
      container.innerHTML = `
      <div class="context-picker-empty-v23013">
        No hay sucursales disponibles.
      </div>`;
      updateLabels();
      return;
    }

    const currentBranchId = dependencies.getContext().branch.id;
    container.innerHTML = branches
      .map((branch) => {
        const active = branch.id === currentBranchId;
        return `
        <button type="button"
                class="context-picker-option-v23013 ${active ? "active" : ""}"
                role="option"
                aria-selected="${active ? "true" : "false"}"
                data-context-branch="${escapeHtml(branch.id)}">
          <span class="context-option-icon-v23013">
            ${dependencies.icon("store")}
          </span>
          <span class="context-option-copy-v23013">
            <strong>${escapeHtml(branch.name)}</strong>
            <small>${active ? "Sucursal actual" : "Cambiar a esta sucursal"}</small>
          </span>
          <span class="context-option-check-v23013">
            ${active ? dependencies.icon("check") : ""}
          </span>
        </button>`;
      })
      .join("");

    updateLabels();
  }

  function renderCashOptions(): void {
    dependencies.renderCashOptions();
  }

  async function selectBranch(id: string): Promise<void> {
    const currentId = dependencies.getContext().branch.id;
    if (!id || id === currentId) {
      toggle("branch", false);
      return;
    }

    await dependencies.selectBranch(id);
    renderBranchOptions();
    renderCashOptions();
    updateLabels();
    toggle("branch", false);
  }

  async function selectCash(id: string): Promise<void> {
    const currentId = dependencies.getContext().cashRegister.id;
    if (!id || id === currentId) {
      toggle("cash", false);
      return;
    }

    await dependencies.selectCash(id);
    renderCashOptions();
    updateLabels();
    toggle("cash", false);
  }

  function positionOpenPicker(kind: ContextPickerKind): void {
    const entry = picker(kind);
    const menu = documentRef.getElementById(entry.menuId);
    const trigger = documentRef.getElementById(entry.triggerId);

    if (
      !menu ||
      !trigger ||
      menu.classList.contains("hidden")
    ) {
      return;
    }

    dependencies.positionPopover(menu, trigger, {
      minWidth: 248,
      maxWidth: 300
    });
  }

  function setup(): void {
    if (installed) return;
    installed = true;

    documentRef
      .getElementById("branch-trigger-v23013")
      ?.addEventListener("click", () => {
        toggle("branch");
      });

    documentRef
      .getElementById("cash-trigger-v23013")
      ?.addEventListener("click", () => {
        toggle("cash");
      });

    documentRef
      .getElementById("branch-options-v23013")
      ?.addEventListener("click", (event) => {
        const button = closestFromTarget(
          event.target,
          "[data-context-branch]"
        );
        const id = button?.dataset.contextBranch;
        if (id) void selectBranch(id);
      });

    documentRef
      .getElementById("cash-options-v23013")
      ?.addEventListener("click", (event) => {
        const button = closestFromTarget(
          event.target,
          "[data-context-cash]"
        );
        const id = button?.dataset.contextCash;
        if (id) void selectCash(id);
      });

    documentRef.addEventListener("pointerdown", (event) => {
      if (
        !closestFromTarget(
          event.target,
          ".context-picker-v23013"
        )
      ) {
        close();
      }
    });

    documentRef.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });

    const closeOnScroll = (): void => {
      close();
    };

    windowRef.addEventListener("scroll", closeOnScroll, {
      passive: true
    });

    documentRef
      .querySelector<HTMLElement>(".header-actions-vpro")
      ?.addEventListener("scroll", closeOnScroll, {
        passive: true
      });

    windowRef.addEventListener("resize", () => {
      positionOpenPicker("branch");
      positionOpenPicker("cash");
    });

    renderBranchOptions();
    renderCashOptions();
    updateLabels();
  }

  return Object.freeze({
    close,
    toggle,
    updateLabels,
    renderBranchOptions,
    renderCashOptions,
    selectBranch,
    selectCash,
    setup
  });
}
