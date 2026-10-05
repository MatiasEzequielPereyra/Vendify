import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedAssignableRoles,
  canDeleteTeamMember,
  canManageTeamMember,
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


test("team role policy preserves hierarchy across owner, admin, manager and cashier", () => {
  const roles = ["owner", "admin", "manager", "cashier"];
  const expectedManage = {
    owner:   { owner: false, admin: true,  manager: true,  cashier: true },
    admin:   { owner: false, admin: true,  manager: true,  cashier: true },
    manager: { owner: false, admin: false, manager: true,  cashier: true },
    cashier: { owner: false, admin: false, manager: false, cashier: false }
  };
  const expectedDelete = {
    owner:   { owner: false, admin: true,  manager: true,  cashier: true },
    admin:   { owner: false, admin: false, manager: true,  cashier: true },
    manager: { owner: false, admin: false, manager: true,  cashier: true },
    cashier: { owner: false, admin: false, manager: false, cashier: false }
  };

  for (const actor of roles) {
    for (const target of roles) {
      assert.equal(
        canManageTeamMember(actor, target, false),
        expectedManage[actor][target],
        `${actor} manage ${target}`
      );
      assert.equal(
        canDeleteTeamMember(actor, target, false),
        expectedDelete[actor][target],
        `${actor} delete ${target}`
      );
      assert.equal(canManageTeamMember(actor, target, true), false, `${actor} self manage`);
      assert.equal(canDeleteTeamMember(actor, target, true), false, `${actor} self delete`);
    }
  }
});

test("assignable roles prevent manager escalation while preserving owner/admin options", () => {
  assert.deepEqual(allowedAssignableRoles("owner"), ["cashier", "manager", "admin"]);
  assert.deepEqual(allowedAssignableRoles("admin"), ["cashier", "manager", "admin"]);
  assert.deepEqual(allowedAssignableRoles("manager"), ["cashier", "manager"]);
  assert.deepEqual(allowedAssignableRoles("cashier"), []);
});

test("manager renderer shows owner and admin read-only but manages manager and cashier", () => {
  const html = renderTeamMembers([
    { membership_id: "owner-1", rol: "owner", user_id: "owner-user", nombre: "Owner", activo: true },
    { membership_id: "admin-1", rol: "admin", user_id: "admin-user", nombre: "Admin", activo: true },
    { membership_id: "manager-2", rol: "manager", user_id: "manager-other", nombre: "Manager", activo: true },
    { membership_id: "cashier-1", rol: "cashier", user_id: "cashier-user", nombre: "Cashier", activo: true }
  ], "manager-self", "manager");

  const ownerBlock = html.slice(html.indexOf("Owner"), html.indexOf("Admin"));
  const adminBlock = html.slice(html.indexOf("Admin"), html.indexOf("Manager"));
  assert.doesNotMatch(ownerBlock, /data-equipo-action=/);
  assert.doesNotMatch(adminBlock, /data-equipo-action=/);

  assert.match(html, /data-id="manager-2"/);
  assert.match(html, /data-id="cashier-1"/);
  assert.match(html, /data-equipo-action="delete-member"/);

  const managedSelects = [...html.matchAll(/class="select equipo-role-select"[\s\S]*?<\/select>/g)]
    .map((match) => match[0]);
  assert.equal(managedSelects.length, 2);
  for (const select of managedSelects) {
    assert.match(select, /value="cashier"/);
    assert.match(select, /value="manager"/);
    assert.doesNotMatch(select, /value="admin"/);
    assert.doesNotMatch(select, /value="owner"/);
  }
});

test("manager renderer prevents all Team actions against self", () => {
  const html = renderTeamMembers([
    {
      membership_id: "manager-self-membership",
      rol: "manager",
      user_id: "manager-self",
      nombre: "Yo",
      activo: true
    }
  ], "manager-self", "manager");

  assert.match(html, /· Vos/);
  assert.doesNotMatch(html, /equipo-role-select/);
  assert.doesNotMatch(html, /data-equipo-action=/);
});
