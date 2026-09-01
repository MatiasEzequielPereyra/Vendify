import {
  buildEmployeeInternalEmail,
  normalizeInternalLogin,
  resolveAuthPanel,
  validateNewPasswordInput,
  validateRegistrationInput
} from "../auth/credentials.js";
import {
  getAuthPanelState,
  showAuthMessage,
  showAuthPanel
} from "../auth/ui.js";

export interface VendifyAuthV232Api {
  readonly normalizeInternalLogin: typeof normalizeInternalLogin;
  readonly buildEmployeeInternalEmail: typeof buildEmployeeInternalEmail;
  readonly resolveAuthPanel: typeof resolveAuthPanel;
  readonly validateRegistrationInput: typeof validateRegistrationInput;
  readonly validateNewPasswordInput: typeof validateNewPasswordInput;
  readonly getAuthPanelState: typeof getAuthPanelState;
  readonly showAuthPanel: typeof showAuthPanel;
  readonly showAuthMessage: typeof showAuthMessage;
}

declare global {
  interface Window {
    VendifyAuthV232?: VendifyAuthV232Api;
  }
}

window.VendifyAuthV232 = Object.freeze({
  normalizeInternalLogin,
  buildEmployeeInternalEmail,
  resolveAuthPanel,
  validateRegistrationInput,
  validateNewPasswordInput,
  getAuthPanelState,
  showAuthPanel,
  showAuthMessage
});
