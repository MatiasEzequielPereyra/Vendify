import assert from "node:assert/strict";
import test from "node:test";
import {
  generateTemporaryPassword,
  renderTeamMembers
} from "../../dist-ts/team/team-controller.js";

test("team renderer escapes member data and preserves owner-only actions", () => {
  const html = renderTeamMembers([
    {
      membership_id: "member-1",
      rol: "cashier",
      user_id: "user-2",
      nombre: "<Empleado>",
      username: "caja<script>",
      activo: true,
      puede_gestionar_stock: false
    }
  ], "owner-user", "owner");

  assert.match(html, /&lt;Empleado&gt;/);
  assert.match(html, /@caja&lt;script&gt;/);
  assert.match(html, /data-equipo-action="edit-member"/);
  assert.match(html, /data-equipo-action="delete-member"/);
  assert.doesNotMatch(html, /<Empleado>/);
});

test("team renderer prevents actions against the current member", () => {
  const html = renderTeamMembers([
    {
      membership_id: "member-1",
      rol: "admin",
      user_id: "same-user",
      nombre: "Yo",
      activo: true
    }
  ], "same-user", "owner");

  assert.match(html, /· Vos/);
  assert.match(html, /data-membership-id="member-1" disabled/);
  assert.doesNotMatch(html, /data-equipo-action=/);
});

test("temporary employee passwords keep the validated 12-character alphabet", () => {
  const password = generateTemporaryPassword();
  assert.equal(password.length, 12);
  assert.match(password, /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$]+$/);
});
