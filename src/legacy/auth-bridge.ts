import {
  buildEmployeeInternalEmail,
  normalizeInternalLogin,
  resolveAuthPanel,
  validateNewPasswordInput,
  validateRegistrationInput
} from "../auth/credentials.js";

export interface VendifyAuthV232Api {
  readonly normalizeInternalLogin: typeof normalizeInternalLogin;
  readonly buildEmployeeInternalEmail: typeof buildEmployeeInternalEmail;
  readonly resolveAuthPanel: typeof resolveAuthPanel;
  readonly validateRegistrationInput: typeof validateRegistrationInput;
  readonly validateNewPasswordInput: typeof validateNewPasswordInput;
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
  validateNewPasswordInput
});
