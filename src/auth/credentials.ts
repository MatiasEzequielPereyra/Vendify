export const EMPLOYEE_DOMAIN = "employees.vendify.internal";

export type AuthPanelTarget =
  | "owner"
  | "employee"
  | "register"
  | "forgot"
  | "new-password"
  | string;

const AUTH_PANEL_ALIASES: Readonly<Record<string, AuthPanelTarget>> = Object.freeze({
  "auth-login-panel": "owner",
  "auth-register-panel": "register",
  "auth-reset-panel": "forgot",
  "auth-new-password-panel": "new-password"
});

export function normalizeInternalLogin(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

export function buildEmployeeInternalEmail(
  businessCode: string | null | undefined,
  username: string | null | undefined
): string {
  const code = normalizeInternalLogin(businessCode);
  const user = normalizeInternalLogin(username);
  return `${code}.${user}@${EMPLOYEE_DOMAIN}`;
}

export function resolveAuthPanel(panel: string): AuthPanelTarget {
  return AUTH_PANEL_ALIASES[panel] ?? panel;
}

export function validateRegistrationInput(
  businessName: string | null | undefined,
  password: string | null | undefined
): string | null {
  if (!(businessName ?? "").trim()) return "Ingresá el nombre del negocio.";
  if ((password ?? "").length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  return null;
}

export function validateNewPasswordInput(
  password: string | null | undefined,
  confirmation: string | null | undefined
): string | null {
  if ((password ?? "").length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if ((password ?? "") !== (confirmation ?? "")) return "Las contraseñas no coinciden.";
  return null;
}
