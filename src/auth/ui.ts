import { queryOne } from "../core/dom.js";
import { resolveAuthPanel } from "./credentials.js";

const AUTH_ERROR_SELECTORS = Object.freeze([
  "#login-error",
  "#employee-login-error",
  "#register-error",
  "#forgot-error",
  "#new-password-error"
]);

export interface AuthPanelState {
  readonly target: string;
  readonly owner: boolean;
  readonly employee: boolean;
  readonly register: boolean;
  readonly forgot: boolean;
  readonly newPassword: boolean;
  readonly tabsVisible: boolean;
}

export function getAuthPanelState(panel: string): AuthPanelState {
  const target = resolveAuthPanel(panel);

  return Object.freeze({
    target,
    owner: target === "owner",
    employee: target === "employee",
    register: target === "register",
    forgot: target === "forgot",
    newPassword: target === "new-password",
    tabsVisible: target === "owner" || target === "employee"
  });
}

export function showAuthPanel(panel: string, root: ParentNode = document): void {
  const state = getAuthPanelState(panel);

  queryOne("#auth-owner-panel", root)?.classList.toggle("hidden", !state.owner);
  queryOne("#auth-employee-panel", root)?.classList.toggle("hidden", !state.employee);
  queryOne("#register-form", root)?.classList.toggle("hidden", !state.register);
  queryOne("#forgot-form", root)?.classList.toggle("hidden", !state.forgot);
  queryOne("#new-password-form", root)?.classList.toggle("hidden", !state.newPassword);

  queryOne("#tab-owner", root)?.classList.toggle("active", state.owner);
  queryOne("#tab-employee", root)?.classList.toggle("active", state.employee);
  queryOne("#auth-tabs-wrap", root)?.classList.toggle("hidden", !state.tabsVisible);
  queryOne("#auth-message", root)?.classList.add("hidden");

  for (const selector of AUTH_ERROR_SELECTORS) {
    const element = queryOne(selector, root);
    if (element) element.textContent = "";
  }
}

export function showAuthMessage(
  message: string,
  type = "info",
  root: ParentNode = document
): void {
  const element = queryOne("#auth-message", root);
  if (!element) return;

  element.setAttribute("class", `auth-message ${type}`);
  element.textContent = message;
  element.classList.remove("hidden");
}
