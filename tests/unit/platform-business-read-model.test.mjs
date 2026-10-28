import assert from "node:assert/strict";
import test from "node:test";
import { getPlatformBusiness, listPlatformBusinesses } from "../../dist-ts/platform/business-read-service.js";
import { parseBusinessTimestamp } from "../../dist-ts/platform/business-read-model.js";

const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const id2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
function business(overrides = {}) { return { id, nombre: "Comercio", creado: "2026-10-14T12:00:00.123456Z", activo: true, suscripcion: null, uso: { usuarios: 0, sucursales: 1, productos: 2 }, ...overrides }; }
function client(data, calls = []) { return { rpc: async (name, args) => { calls.push({ name, args }); return { data, error: null }; } }; }
function page(items = [], next_cursor = null) { return { contract_version: 1, items, next_cursor }; }
function cursor(anchor, after, query = { search: null, plan_codigo: null, estado: null }) { return { version: 1, order: "creado_desc_id_desc", query, anchor: { creado: parseBusinessTimestamp(anchor.creado), id: anchor.id }, after: { creado: parseBusinessTimestamp(after.creado), id: after.id } }; }

test("read calls use dedicated RPCs and normalize inputs without touching v1", async () => {
  const calls = [];
  assert.deepEqual(await listPlatformBusinesses(client(page(), calls), { search: "  tienda  ", planCode: " PRO ", state: "activo", limit: 10 }), page());
  assert.deepEqual(calls, [{ name: "listar_negocios_plataforma_v2", args: { p_search: "tienda", p_plan_codigo: "pro", p_estado: "activo", p_limit: 10, p_cursor: null } }]);
  const absent = business();
  assert.equal((await getPlatformBusiness(client({ contract_version: 1, business: absent }, calls), id.toUpperCase())).suscripcion, null);
  assert.equal(calls[1].args.p_negocio_id, id);
  assert.equal(await getPlatformBusiness(client({ contract_version: 1, business: null }), id), null);
});

test("invalid inputs never invoke RPC", async () => {
  let calls = 0;
  const rpc = { rpc: async () => { calls++; throw new Error("unexpected call"); } };
  for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: null }, { search: "a".repeat(121) }, { search: 1 }, { planCode: "bad plan" }, { state: "unknown" }, { actorId: id }, { cursor: {} }, null]) {
    await assert.rejects(() => listPlatformBusinesses(rpc, input), /contract/);
  }
  await assert.rejects(() => getPlatformBusiness(rpc, "bad-id"), /contract/);
  assert.equal(calls, 0);
});

test("detail validates every required field and rejects wrong business identity", async () => {
  const malformed = [{}, [], { ...business(), id: id2 }, { ...business(), nombre: " " }, { ...business(), creado: "2026-02-30T00:00:00Z" }, { ...business(), activo: 1 }, { ...business(), uso: { usuarios: -1, sucursales: 0, productos: 0 } }, { ...business(), uso: { usuarios: Number.MAX_SAFE_INTEGER + 1, sucursales: 0, productos: 0 } }, { ...business(), secret: "not allowed" }, { ...business(), suscripcion: {} }];
  for (const value of malformed) await assert.rejects(() => getPlatformBusiness(client({ contract_version: 1, business: value }), id), /contract/);
  for (const value of [null, {}, { contract_version: 2, business: business() }, { contract_version: 1, business: business(), extra: true }]) await assert.rejects(() => getPlatformBusiness(client(value), id), /contract/);
});

test("subscription supports every defined state, nullable dates/limits and finite counts", async () => {
  for (const estado of ["trial", "activo", "vencido", "suspendido", "legacy"]) {
    const sub = { plan_codigo: "pro", plan_nombre: "Pro", estado, trial_hasta: null, limites: { usuarios: null, sucursales: 3, productos: 0 } };
    const result = await getPlatformBusiness(client({ contract_version: 1, business: business({ suscripcion: sub }) }), id);
    assert.equal(result.suscripcion.estado, estado);
    assert.equal(result.suscripcion.limites.usuarios, null);
    for (const invalid of [{ ...sub, estado: "invalid" }, { ...sub, trial_hasta: "yesterday" }, { ...sub, limites: { usuarios: null, sucursales: 0.5, productos: 0 } }]) await assert.rejects(() => getPlatformBusiness(client({ contract_version: 1, business: business({ suscripcion: invalid }) }), id), /contract/);
  }
});

test("timestamp validation preserves exact microseconds across timezone offsets", () => {
  assert.equal(parseBusinessTimestamp("2026-10-14T09:00:00.123456-03:00"), "2026-10-14T12:00:00.123456Z");
  assert.equal(parseBusinessTimestamp("2026-10-14T12:00:00Z"), "2026-10-14T12:00:00.000000Z");
  for (const value of ["2026-02-29T00:00:00Z", "2026-10-14T24:00:00Z", "2026-10-14T12:00:00+99:00", "2026-10-14T12:00:00.1234567Z", "2026-10-14"]) assert.throws(() => parseBusinessTimestamp(value), /contract/);
});

test("pages order timestamps at microsecond precision then UUID descending", async () => {
  const newest = business({ id: id2, creado: "2026-10-14T12:00:00.123456Z" });
  const tied = business();
  const older = business({ id: "cccccccc-cccc-cccc-cccc-cccccccccccc", creado: "2026-10-14T09:00:00.123455-03:00" });
  const next = cursor(newest, older);
  const result = await listPlatformBusinesses(client(page([newest, tied, older], next)));
  assert.equal(result.items[2].creado, "2026-10-14T12:00:00.123455Z");
  assert.deepEqual(result.next_cursor, next);
  for (const rows of [[tied, newest], [older, newest], [newest, newest]]) await assert.rejects(() => listPlatformBusinesses(client(page(rows))), /order/);
});

test("cursor rejects tampering, filter changes, page overlap and wrong boundaries", async () => {
  const first = business({ id: id2 });
  const last = business({ creado: "2026-10-14T12:00:00.123455Z" });
  const token = cursor(first, last);
  for (const bad of [{ ...token, secret: 1 }, { ...token, version: 2 }, { ...token, order: "id" }, { ...token, query: { ...token.query, search: "other" } }, { ...token, anchor: { ...token.anchor, extra: 1 } }, { ...token, after: { ...token.after, creado: "2026-10-14T12:00:01.000000Z" } }, { ...token, after: { ...token.after, creado: "2026-10-14T12:00:00.123455+00:00" } }]) await assert.rejects(() => listPlatformBusinesses(client(page()), { cursor: bad }), /contract/);
  await assert.rejects(() => listPlatformBusinesses(client(page([last])), { cursor: token }), /order/);
  await assert.rejects(() => listPlatformBusinesses(client(page([], token))), /boundary/);
  await assert.rejects(() => listPlatformBusinesses(client(page([first, last], cursor(first, first)))), /boundary/);
  await assert.rejects(() => listPlatformBusinesses(client(page([first, last])), { limit: 1 }), /size/);
  const older = business({ creado: "2026-10-14T12:00:00.123454Z" });
  assert.equal((await listPlatformBusinesses(client(page([older], cursor(first, older))), { cursor: token })).items.length, 1);
});

test("denied backend responses never become empty success or expose backend details", async () => {
  const rpc = { rpc: async () => ({ data: page(), error: { message: "ACCESS_DENIED secret diagnostic" } }) };
  await assert.rejects(() => listPlatformBusinesses(rpc), (error) => !error.message.includes("secret") && /consultar/.test(error.message));
  await assert.rejects(() => getPlatformBusiness(rpc, id), /consultar/);
  for (const value of [null, {}, [], { contract_version: 1, items: null, next_cursor: null }]) await assert.rejects(() => listPlatformBusinesses(client(value)), /contract/);
});
