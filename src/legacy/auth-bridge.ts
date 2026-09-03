import {
  buildEmployeeInternalEmail,
  normalizeInternalLogin,
  resolveAuthPanel,
  validateNewPasswordInput,
  validateRegistrationInput
} from "../auth/credentials.js";
import {
  registerOwner,
  requestPasswordReset,
  signInEmployee,
  signInOwner,
  signOut,
  updatePassword
} from "../auth/auth-service.js";
import { initializeAuthLifecycle } from "../auth/session-lifecycle.js";
import {
  getAuthPanelState,
  showAuthMessage,
  showAuthPanel
} from "../auth/ui.js";
import { createAuthController } from "../auth/auth-controller.js";

export interface VendifyAuthV232Api {
  readonly createController: typeof createAuthController;
  readonly normalizeInternalLogin: typeof normalizeInternalLogin;
  readonly buildEmployeeInternalEmail: typeof buildEmployeeInternalEmail;
  readonly resolveAuthPanel: typeof resolveAuthPanel;
  readonly validateRegistrationInput: typeof validateRegistrationInput;
  readonly validateNewPasswordInput: typeof validateNewPasswordInput;
  readonly getAuthPanelState: typeof getAuthPanelState;
  readonly showAuthPanel: typeof showAuthPanel;
  readonly showAuthMessage: typeof showAuthMessage;
  readonly signInOwner: typeof signInOwner;
  readonly signInEmployee: typeof signInEmployee;
  readonly registerOwner: typeof registerOwner;
  readonly requestPasswordReset: typeof requestPasswordReset;
  readonly updatePassword: typeof updatePassword;
  readonly signOut: typeof signOut;
  readonly initializeAuthLifecycle: typeof initializeAuthLifecycle;
}

declare global {
  interface Window {
    VendifyAuthV232?: VendifyAuthV232Api;
  }
}

window.VendifyAuthV232 = Object.freeze({
  createController: createAuthController,
  normalizeInternalLogin,
  buildEmployeeInternalEmail,
  resolveAuthPanel,
  validateRegistrationInput,
  validateNewPasswordInput,
  getAuthPanelState,
  showAuthPanel,
  showAuthMessage,
  signInOwner,
  signInEmployee,
  registerOwner,
  requestPasswordReset,
  updatePassword,
  signOut,
  initializeAuthLifecycle
});
