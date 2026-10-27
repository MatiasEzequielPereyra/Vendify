import { createPlatformAdminController } from "/dist-ts/platform/platform-admin-controller.js";
import { createAdminReadSmokeGuard } from "/read-guard.mjs";

const id = "20000000-0000-4000-8000-000000000001";
const otherId = "20000000-0000-4000-8000-000000000002";
const business = value => ({ id: value, nombre: value === id ? "Comercio fixture" : "Segundo fixture", creado: value === id ? "2026-10-20T00:00:00.000000Z" : "2026-10-19T00:00:00.000000Z", activo: true, suscripcion: { plan_codigo: "pro", plan_nombre: "Pro", estado: "activo", trial_hasta: null, limites: { usuarios: 10, sucursales: 3, productos: 100 } }, uso: { usuarios: 2, sucursales: 1, productos: 5 } });
const data = [business(id), business(otherId)];
const state = { admin: true, online: true, session: "fixture-admin", calls: [], confirmations: [], failWrite: false, confirmation: "cancel", release: null, guarded: false, upstream: [], toasts: [] };
const results = [];
const check = (label, condition) => { if (!condition) throw Error(label); results.push(label); };
const wait = async (predicate, label) => { for (let attempt = 0; attempt < 200; attempt++) { if (predicate()) return; await new Promise(done => setTimeout(done, 5)); } throw Error("Timeout: " + label); };
const clone = value => structuredClone(value);
const writes = () => state.calls.filter(call => call.name === "actualizar_plan_negocio_plataforma_v1").length;
const row = () => document.querySelector(`[data-platform-business="${id}"]`);
const save = () => row()?.querySelector("[data-platform-save-plan]");
const list = () => document.querySelector("#platform-business-list-v231");
let guard = createAdminReadSmokeGuard({ appOrigin: location.origin, supabaseOrigin: location.origin });
async function response(name, args = {}) {
  state.calls.push({ name, args: clone(args) });
  if (name === "es_admin_plataforma_v1") return { data: state.admin, error: null };
  if (!state.admin) return { data: null, error: { message: "access denied fixture" } };
  if (name === "platform_overview_v1") return { data: { negocios: 2, trials: 0, ventas_hoy: 0, errores_24h: 0 }, error: null };
  if (name === "listar_errores_plataforma_v1") return { data: [], error: null };
  if (name === "listar_negocios_plataforma_v2") return { data: { contract_version: 1, items: clone(data.filter(item => !args.p_search || item.nombre.toLowerCase().includes(args.p_search.toLowerCase()))), next_cursor: null }, error: null };
  if (name === "actualizar_plan_negocio_plataforma_v1") {
    if (state.failWrite) return { data: null, error: { message: "fixture write denied" } };
    const item = data.find(candidate => candidate.id === args.p_negocio_id);
    item.suscripcion = { ...item.suscripcion, plan_codigo: args.p_plan_codigo, plan_nombre: args.p_plan_codigo, estado: args.p_estado };
    return { data: { ok: true }, error: null };
  }
  throw Error("Unknown mock RPC " + name);
}
const upstream = async (url, init) => {
  const name = new URL(url).pathname.split("/").at(-1);
  state.upstream.push(name);
  return new Response(JSON.stringify(await response(name, JSON.parse(init.body ?? "{}"))), { headers: { "Content-Type": "application/json" } });
};
const client = { async rpc(name, args = {}) {
  if (!state.guarded) return response(name, args);
  try { return await (await guard.fetch(upstream)(`${location.origin}/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args), headers: { "Content-Type": "application/json" } })).json(); }
  catch { return { data: null, error: { message: "blocked by read-only smoke guard" } }; }
} };
const controller = createPlatformAdminController({
  client, document, isOnline: () => state.online, getSessionKey: () => state.session,
  closeUserMenu() {}, icon: () => "", formatPrice: value => String(value),
  showToast: message => state.toasts.push(message),
  async confirm(title, message) {
    state.confirmations.push({ title, message });
    document.querySelector('[data-testid="confirmation-text"]').textContent = `${title}\n${message}`;
    if (state.confirmation === "error") throw Error("confirmation failed fixture");
    if (state.confirmation === "pending") return new Promise(done => { state.release = done; });
    return state.confirmation === "accept";
  }
});
const select = (selector, value) => { const element = row().querySelector(selector); element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); };
const choose = (plan, status = data[0].suscripcion.estado) => { select(".platform-plan-select-v231", plan); select(".platform-state-select-v231", status); };
try {
  controller.setup(); await controller.open();
  check("Loaded real DOM with two synthetic businesses", document.querySelectorAll("[data-platform-business]").length === 2);
  check("Save disabled for the loaded model", save().disabled);
  const firstWrites = writes(); const firstConfirmations = state.confirmations.length;
  save().click(); await controller.savePlan(save());
  check("Accidental unchanged click and direct handler invoke zero write RPC", writes() === firstWrites);
  check("Unchanged save does not request confirmation", state.confirmations.length === firstConfirmations);

  state.guarded = true;
  list().querySelector('[data-platform-search]').value = "Comercio";
  list().querySelector('[data-platform-search-form]').requestSubmit();
  await wait(() => Boolean(row()) && !list().textContent.includes("Cargando negocios"), "semantic search");
  guard.assertNoWrites();
  check("Semantic search uses read-only guard without any write reaching mock transport", writes() === firstWrites && !state.upstream.includes("actualizar_plan_negocio_plataforma_v1"));
  state.guarded = false;

  state.confirmation = "cancel"; choose("business", "suspendido");
  check("Effective selection enables only a dirty save", !save().disabled);
  save().click();
  await wait(() => state.confirmations.length === firstConfirmations + 1 && Boolean(row()) && save().disabled && save().textContent === "Guardar", "cancel confirmation");
  check("Cancellation invokes zero write RPC", writes() === firstWrites);

  state.confirmation = "pending"; state.release = null; choose("business", "suspendido");
  save().click(); save().click();
  await wait(() => typeof state.release === "function", "pending confirmation");
  check("All save buttons disabled while confirmation is pending", [...document.querySelectorAll("[data-platform-save-plan]")].every(button => button.disabled));
  const details = state.confirmations.at(-1).message;
  check("Confirmation shows business UUID, previous and new plan/state", details.includes(id) && details.includes("Comercio fixture") && details.includes("pro") && details.includes("business") && details.includes("activo") && details.includes("suspendido"));
  const acceptedStart = writes(); state.release(true);
  await wait(() => writes() === acceptedStart + 1 && Boolean(row()) && save().disabled && save().textContent === "Guardar", "confirmed mock save");
  check("Explicit acceptance plus double click results in exactly one in-memory write", writes() === acceptedStart + 1);
  check("Model reload makes repeated same selection a no-op", save().disabled);
  await controller.savePlan(save());
  check("Repeated confirmed values do not resend", writes() === acceptedStart + 1);

  state.confirmation = "accept"; state.failWrite = true; choose("starter", "activo");
  save().click(); await wait(() => !row(), "write error cleanup");
  check("Mock write error clears private rows", /No se pudo actualizar/.test(list().textContent));
  state.failWrite = false; await controller.open();

  state.confirmation = "pending"; state.release = null; choose("starter", "activo"); save().click();
  await wait(() => state.release, "session confirmation"); const expiredStart = writes(); state.session = null; state.release(true);
  await wait(() => !row(), "expired session cleanup");
  check("Session expiration during confirmation sends zero write RPC", writes() === expiredStart);
  state.session = "fixture-admin"; await controller.open();

  state.confirmation = "pending"; state.release = null; choose("starter", "activo"); save().click();
  await wait(() => state.release, "revocation confirmation"); const deniedStart = writes(); state.admin = false; state.release(true);
  await wait(() => !row(), "role revocation cleanup");
  check("Fresh role denial after confirmation sends zero write RPC", writes() === deniedStart);
  state.admin = true; await controller.open();

  state.confirmation = "error"; choose("starter", "activo"); const confirmErrorStart = writes(); save().click();
  await wait(() => !row(), "confirmation error cleanup");
  check("Confirmation error sends zero write RPC", writes() === confirmErrorStart);
  await controller.open();

  guard = createAdminReadSmokeGuard({ appOrigin: location.origin, supabaseOrigin: location.origin });
  state.guarded = true; state.confirmation = "accept"; choose("starter", "activo"); const guardStart = writes(); const upstreamStart = state.upstream.length;
  save().click(); await wait(() => guard.violations.length > 0 && !row(), "read smoke write denial");
  check("Read smoke blocks even a confirmed write before the mock upstream", writes() === guardStart && state.upstream.slice(upstreamStart).every(name => name !== "actualizar_plan_negocio_plataforma_v1"));
  let raised = false; try { guard.assertNoWrites(); } catch { raised = true; }
  check("Read smoke fails explicitly even when application catches the transport error", raised);
  controller.close();
  check("Final controller close removes business data", !row());
  document.querySelector('[data-testid="guard-results"]').textContent = JSON.stringify({ status: "PASS", checks: results, inMemoryWrites: writes(), realCommercialWrites: 0, scope: "Actual DOM + compiled controller; all RPC mocks in memory; CSP connect-src none; no Auth/PostgREST/production acceptance" }, null, 2);
} catch (error) {
  controller.close();
  document.querySelector('[data-testid="guard-results"]').textContent = JSON.stringify({ status: "FAIL", checks: results, error: String(error), realCommercialWrites: 0 }, null, 2);
}
