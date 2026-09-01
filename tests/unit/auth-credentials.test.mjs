import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmployeeInternalEmail,
  normalizeInternalLogin,
  resolveAuthPanel,
  validateNewPasswordInput,
  validateRegistrationInput
} from "../../dist-ts/auth/credentials.js";

test("normalizeInternalLogin preserves legacy normalization", () => {
  assert.equal(normalizeInternalLogin("  Mi Negocio!  "), "minegocio");
  assert.equal(normalizeInternalLogin("Caja_01.Admin"), "caja_01.admin");
  assert.equal(normalizeInternalLogin(null), "");
});

test("buildEmployeeInternalEmail preserves internal employee identity format", () => {
  assert.equal(
    buildEmployeeInternalEmail(" Mi Negocio ", " Caja 01 "),
    "minegocio.caja01@employees.vendify.internal"
  );
});

test("resolveAuthPanel keeps legacy aliases and passthrough targets", () => {
  assert.equal(resolveAuthPanel("auth-login-panel"), "owner");
  assert.equal(resolveAuthPanel("auth-register-panel"), "register");
  assert.equal(resolveAuthPanel("employee"), "employee");
});

test("registration validation preserves current user-facing messages", () => {
  assert.equal(validateRegistrationInput("", "12345678"), "Ingresá el nombre del negocio.");
  assert.equal(validateRegistrationInput("Kiosco", "123"), "La contraseña debe tener al menos 8 caracteres.");
  assert.equal(validateRegistrationInput("Kiosco", "12345678"), null);
});

test("new password validation preserves current user-facing messages", () => {
  assert.equal(validateNewPasswordInput("123", "123"), "La contraseña debe tener al menos 8 caracteres.");
  assert.equal(validateNewPasswordInput("12345678", "87654321"), "Las contraseñas no coinciden.");
  assert.equal(validateNewPasswordInput("12345678", "12345678"), null);
});
