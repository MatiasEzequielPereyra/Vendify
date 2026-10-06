import crypto from "node:crypto";
import process from "node:process";

const base = process.env.VEN015_SUPABASE_URL;
const apiKey = process.env.VEN015_SUPABASE_PUBLISHABLE_KEY;
if (!base || !apiKey) throw new Error("VEN-015 staging public connection config missing");

const tag = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
const email = `ven015.manager.${tag}@gmail.com`;
const password = `V15!${crypto.randomBytes(24).toString("base64url")}`;
const managerUsername = `ven015_mgr_${tag.slice(0, 10)}`;
const cashierUsername = `ven015_cash_${tag.slice(0, 10)}`;
const cashierPassword = `V15!${crypto.randomBytes(24).toString("base64url")}`;
const resetPassword = `V15!${crypto.randomBytes(24).toString("base64url")}`;

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  let body = null;
  try { body = await response.json(); } catch {}
  return { response, body };
}

const publicHeaders = {
  apikey: apiKey,
  "Content-Type": "application/json"
};

const signup = await jsonFetch(`${base}/auth/v1/signup`, {
  method: "POST",
  headers: publicHeaders,
  body: JSON.stringify({ email, password })
});
if (!signup.response.ok || !signup.body?.user?.id) {
  throw new Error(`manager fixture signup failed (${signup.response.status})`);
}

const managerUserId = signup.body.user.id;
process.stdout.write(`VEN015_FIXTURE_USER_ID=${managerUserId}\n`);
process.stdout.write(`VEN015_FIXTURE_USERNAME=${managerUsername}\n`);
process.stdout.write("VEN015_FIXTURE_WAITING_FOR_MEMBERSHIP=1\n");

let accessToken = null;
for (let attempt = 0; attempt < 72; attempt += 1) {
  const login = await jsonFetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: publicHeaders,
    body: JSON.stringify({ email, password })
  });
  if (login.response.ok && login.body?.access_token) {
    accessToken = login.body.access_token;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
if (!accessToken) throw new Error("manager authenticated login did not become available");

const authHeaders = {
  apikey: apiKey,
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json"
};

const userCheck = await jsonFetch(`${base}/auth/v1/user`, { headers: authHeaders });
if (!userCheck.response.ok || userCheck.body?.id !== managerUserId) {
  throw new Error("authenticated manager identity check failed");
}
process.stdout.write("MANAGER_AUTH_LOGIN=PASS\n");

async function rpc(name, args = {}) {
  const result = await jsonFetch(`${base}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(args)
  });
  if (!result.response.ok) {
    throw new Error(`${name} failed (${result.response.status})`);
  }
  return result.body;
}

async function edge(name, body, expectedOk = true) {
  const result = await jsonFetch(`${base}/functions/v1/${name}`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(body)
  });
  if (expectedOk && !result.response.ok) {
    throw new Error(`${name} failed (${result.response.status})`);
  }
  if (!expectedOk && result.response.ok) {
    throw new Error(`${name} unexpectedly succeeded`);
  }
  return result;
}

const context = await rpc("obtener_contexto_app");
if (context?.permissions?.manageEmployees !== true || context?.membership?.role !== "manager") {
  throw new Error("manager context does not expose manageEmployees");
}
process.stdout.write("TEAM_VISIBLE=PASS\n");

const business = await rpc("obtener_negocio_admin_actual");
if (!business?.codigo_acceso) throw new Error("business access code not available to manager");
process.stdout.write("BUSINESS_ACCESS_CODE_VISIBLE=PASS\n");

let team = await rpc("listar_equipo_v3");
if (!Array.isArray(team)) throw new Error("Team listing is not an array");
const self = team.find((member) => member.user_id === managerUserId);
const owner = team.find((member) => member.rol === "owner");
const admin = team.find((member) => member.rol === "admin");
if (!self || !owner || !admin) throw new Error("manager/owner/admin acceptance fixtures not visible");
process.stdout.write("LIST_TEAM=PASS\n");

const blockedAdminCreate = await edge("crear-empleado", {
  nombre: "VEN015 Admin Block",
  username: `ven015_admin_block_${managerUserId.replaceAll("-", "").slice(0, 8)}`,
  rol: "admin",
  password: cashierPassword
}, false);
if (!String(blockedAdminCreate.body?.error ?? "").includes("encargado")) {
  throw new Error("manager admin creation block returned unexpected contract");
}
process.stdout.write("MANAGER_CREATE_ADMIN_BLOCK=PASS\n");

const create = await edge("crear-empleado", {
  nombre: "VEN015 Cashier",
  username: cashierUsername,
  rol: "cashier",
  password: cashierPassword
});
if (create.body?.ok !== true) throw new Error("cashier create response missing ok=true");
process.stdout.write("CREATE_EMPLOYEE_LIVE=PASS\n");

team = await rpc("listar_equipo_v3");
let target = team.find((member) => member.username === cashierUsername);
if (!target?.membership_id || !target?.user_id) throw new Error("created cashier missing from Team");
process.stdout.write(`VEN015_TARGET_USER_ID=${target.user_id}\n`);
process.stdout.write(`VEN015_TARGET_MEMBERSHIP_ID=${target.membership_id}\n`);

const update = await edge("gestionar-empleado", {
  action: "update",
  membership_id: target.membership_id,
  nombre: "VEN015 Cashier Updated",
  username: cashierUsername,
  rol: "cashier"
});
if (update.body?.ok !== true) throw new Error("cashier update response missing ok=true");
process.stdout.write("UPDATE_EMPLOYEE_LIVE=PASS\n");

const reset = await edge("gestionar-empleado", {
  action: "reset_password",
  membership_id: target.membership_id,
  password: resetPassword
});
if (reset.body?.ok !== true) throw new Error("password reset response missing ok=true");
process.stdout.write("PASSWORD_RESET_LIVE=PASS\n");

const deactivate = await rpc("cambiar_estado_miembro_v3", {
  p_membership_id: target.membership_id,
  p_activo: false
});
if (deactivate?.ok !== true || deactivate?.activo !== false) {
  throw new Error("deactivate response invalid");
}
const reactivate = await rpc("cambiar_estado_miembro_v3", {
  p_membership_id: target.membership_id,
  p_activo: true
});
if (reactivate?.ok !== true || reactivate?.activo !== true) {
  throw new Error("reactivate response invalid");
}
process.stdout.write("ACTIVE_STATE_LIVE=PASS\n");

async function expectManageBlocked(member, label) {
  if (!member?.membership_id) throw new Error(`${label} fixture missing`);
  const result = await edge("gestionar-empleado", {
    action: "update",
    membership_id: member.membership_id,
    nombre: member.nombre || label,
    username: member.username || `ven015_${label.toLowerCase()}`,
    rol: member.rol
  }, false);
  if (!result.body?.error) throw new Error(`${label} block returned no error contract`);
}

await expectManageBlocked(admin, "ADMIN");
process.stdout.write("MANAGER_TO_ADMIN_BLOCK=PASS\n");
await expectManageBlocked(owner, "OWNER");
process.stdout.write("MANAGER_TO_OWNER_BLOCK=PASS\n");
await expectManageBlocked(self, "SELF");
process.stdout.write("SELF_BLOCK=PASS\n");

const remove = await edge("gestionar-empleado", {
  action: "delete",
  membership_id: target.membership_id
});
if (remove.body?.ok !== true) throw new Error("cashier delete response missing ok=true");
process.stdout.write("DELETE_EMPLOYEE_LIVE=PASS\n");

process.stdout.write("VEN015_MANAGER_LIVE_ACCEPTANCE=PASS\n");
