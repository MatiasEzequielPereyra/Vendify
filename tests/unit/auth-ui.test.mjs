import assert from "node:assert/strict";
import test from "node:test";
import { getAuthPanelState } from "../../dist-ts/auth/ui.js";

test("auth panel state preserves owner and employee tab behavior", () => {
  const owner = getAuthPanelState("auth-login-panel");
  assert.equal(owner.target, "owner");
  assert.equal(owner.owner, true);
  assert.equal(owner.employee, false);
  assert.equal(owner.tabsVisible, true);

  const employee = getAuthPanelState("employee");
  assert.equal(employee.target, "employee");
  assert.equal(employee.owner, false);
  assert.equal(employee.employee, true);
  assert.equal(employee.tabsVisible, true);
});

test("auth panel state hides tabs for secondary auth forms", () => {
  const register = getAuthPanelState("auth-register-panel");
  assert.equal(register.register, true);
  assert.equal(register.tabsVisible, false);

  const recovery = getAuthPanelState("auth-new-password-panel");
  assert.equal(recovery.newPassword, true);
  assert.equal(recovery.tabsVisible, false);
});
