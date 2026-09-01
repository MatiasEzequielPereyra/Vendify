import {
  buildEmployeeInternalEmail,
  validateNewPasswordInput,
  validateRegistrationInput
} from "./credentials.js";

export interface AuthErrorLike {
  message?: string;
}

export interface AuthResult<TData = unknown> {
  data: TData;
  error: AuthErrorLike | null;
}

export interface AuthClientPort {
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<AuthResult>;

  signUp(credentials: {
    email: string;
    password: string;
    options: {
      emailRedirectTo: string;
      data: { business_name: string };
    };
  }): Promise<AuthResult<{ session?: object | null }>>;

  resetPasswordForEmail(
    email: string,
    options: { redirectTo: string }
  ): Promise<AuthResult>;

  updateUser(attributes: { password: string }): Promise<AuthResult>;
  signOut(): Promise<AuthResult>;
}

export interface AuthActionResult {
  ok: boolean;
  errorMessage: string | null;
}

export interface RegistrationActionResult extends AuthActionResult {
  requiresConfirmation: boolean;
}

function errorMessage(error: AuthErrorLike | null | undefined): string {
  if (error?.message) return error.message;
  return "Error de autenticación";
}

export async function signInOwner(
  auth: AuthClientPort,
  email: string | null | undefined,
  password: string | null | undefined
): Promise<AuthActionResult> {
  const { error } = await auth.signInWithPassword({
    email: (email ?? "").trim(),
    password: password ?? ""
  });

  if (!error) return { ok: true, errorMessage: null };

  return {
    ok: false,
    errorMessage:
      error.message === "Invalid login credentials"
        ? "Email o contraseña incorrectos."
        : errorMessage(error)
  };
}

export async function signInEmployee(
  auth: AuthClientPort,
  businessCode: string | null | undefined,
  username: string | null | undefined,
  password: string | null | undefined
): Promise<AuthActionResult> {
  const { error } = await auth.signInWithPassword({
    email: buildEmployeeInternalEmail(businessCode, username),
    password: password ?? ""
  });

  return error
    ? { ok: false, errorMessage: "Código, usuario o contraseña incorrectos." }
    : { ok: true, errorMessage: null };
}

export async function registerOwner(
  auth: AuthClientPort,
  input: {
    businessName: string | null | undefined;
    email: string | null | undefined;
    password: string | null | undefined;
    redirectTo: string;
  }
): Promise<RegistrationActionResult> {
  const validationError = validateRegistrationInput(input.businessName, input.password);
  if (validationError) {
    return { ok: false, errorMessage: validationError, requiresConfirmation: false };
  }

  const businessName = (input.businessName ?? "").trim();
  const { data, error } = await auth.signUp({
    email: (input.email ?? "").trim(),
    password: input.password ?? "",
    options: {
      emailRedirectTo: input.redirectTo,
      data: { business_name: businessName }
    }
  });

  if (error) {
    return {
      ok: false,
      errorMessage: errorMessage(error),
      requiresConfirmation: false
    };
  }

  return {
    ok: true,
    errorMessage: null,
    requiresConfirmation: !data.session
  };
}

export async function requestPasswordReset(
  auth: AuthClientPort,
  email: string | null | undefined,
  redirectTo: string
): Promise<AuthActionResult> {
  const { error } = await auth.resetPasswordForEmail((email ?? "").trim(), {
    redirectTo
  });

  return error
    ? { ok: false, errorMessage: errorMessage(error) }
    : { ok: true, errorMessage: null };
}

export async function updatePassword(
  auth: AuthClientPort,
  password: string | null | undefined,
  confirmation: string | null | undefined
): Promise<AuthActionResult> {
  const validationError = validateNewPasswordInput(password, confirmation);
  if (validationError) return { ok: false, errorMessage: validationError };

  const { error } = await auth.updateUser({ password: password ?? "" });
  return error
    ? { ok: false, errorMessage: errorMessage(error) }
    : { ok: true, errorMessage: null };
}

export async function signOut(auth: AuthClientPort): Promise<AuthActionResult> {
  const { error } = await auth.signOut();
  return error
    ? { ok: false, errorMessage: errorMessage(error) }
    : { ok: true, errorMessage: null };
}
