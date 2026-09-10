export const TOAST_TYPES = ["success", "error", "info", "warning"] as const;

export type ToastType = (typeof TOAST_TYPES)[number];

export interface ToastElement {
  className: string;
  textContent: string | null;
  classList: { add(name: string): void };
  remove(): void;
}

export interface ToastContainer {
  appendChild(node: ToastElement): unknown;
}

export interface ToastDocument {
  querySelector(selector: string): ToastContainer | null;
  createElement(name: "div"): ToastElement;
}

export type ToastScheduler = (callback: () => void, delayMs: number) => unknown;

export interface ToastEnvironment {
  readonly document: ToastDocument;
  readonly schedule: ToastScheduler;
}

const DEFAULT_TOAST_TYPE: ToastType = "info";

export function normalizeToastType(type: unknown): ToastType {
  return typeof type === "string" && (TOAST_TYPES as readonly string[]).includes(type)
    ? (type as ToastType)
    : DEFAULT_TOAST_TYPE;
}

export function showToast(
  message: string,
  type: unknown = "success",
  environment: ToastEnvironment = {
    document,
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs)
  }
): boolean {
  const container = environment.document.querySelector("#toast-container");
  if (!container) return false;

  const toast = environment.document.createElement("div");
  toast.className = `toast ${normalizeToastType(type)}`;
  toast.textContent = message;
  container.appendChild(toast);

  environment.schedule(() => {
    toast.classList.add("leaving");
    environment.schedule(() => {
      toast.remove();
    }, 250);
  }, 2600);

  return true;
}
