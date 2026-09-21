import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../supabase/migrations/20260917140801_offline_signed_lease.sql", import.meta.url),
  "utf8"
).toLowerCase();
const reconciliationSql = readFileSync(
  new URL("../../supabase/migrations/20260921120000_offline_lease_reconciliation.sql", import.meta.url),
  "utf8"
).toLowerCase();

test("offline lease migration stores only token hashes and locks consumption", () => {
  assert.match(sql, /token_hash text not null/);
  assert.doesNotMatch(sql, /\btoken text\b/);
  assert.match(sql, /from public\.offline_sale_leases osl[\s\S]*for update/);
  assert.match(sql, /negocio_id uuid not null/);
  assert.match(sql, /primary key \(negocio_id,\s*request_id\)/);
  assert.match(sql, /sha256\(pg_catalog\.convert_to\(p_lease_token/);
  assert.match(sql, /offline_sale_lease_product_quotas/);
  assert.match(sql, /primary key \(lease_id,\s*producto_id\)/);
});

test("lease reconciliation is authoritative, token-bound and tenant-scoped", () => {
  for (const name of [
    "obtener_estado_lease_venta_offline_v1",
    "renovar_lease_venta_offline_v1"
  ]) {
    const start = reconciliationSql.indexOf(`function public.${name}`);
    assert.notEqual(start, -1);
    assert.match(reconciliationSql.slice(start, start + 1300), /security definer[\s\S]*set search_path\s*=\s*''/);
  }
  assert.match(reconciliationSql, /where l\.id=p_lease_id and l\.negocio_id=v_negocio_id/);
  assert.match(reconciliationSql, /sha256\(pg_catalog\.convert_to\(p_lease_token/);
  assert.match(reconciliationSql, /when v_lease\.revoked_at is not null then 'revoked'/);
  assert.match(reconciliationSql, /when v_lease\.expires_at<=now\(\) then 'expired'/);
  assert.match(reconciliationSql, /then 'exhausted'/);
  assert.doesNotMatch(reconciliationSql, /'token',\s*v_/);
});

test("lease renewal revokes under lock before issuing a replacement", () => {
  assert.match(reconciliationSql, /from public\.offline_sale_leases l[\s\S]*for update/);
  assert.match(reconciliationSql, /pg_advisory_xact_lock/);
  assert.match(reconciliationSql, /set revoked_at=now\(\)/);
  assert.match(reconciliationSql, /return public\.emitir_lease_venta_offline_v1/);
  assert.match(reconciliationSql, /revoke execute on function public\.obtener_estado_lease_venta_offline_v1\(uuid,text\) from public,anon/);
  assert.match(reconciliationSql, /revoke execute on function public\.renovar_lease_venta_offline_v1\(uuid,text\) from public,anon/);
});

test("offline lease RPCs pin search path and restrict execution", () => {
  for (const name of [
    "emitir_lease_venta_offline_v1",
    "registrar_venta_offline_v1",
    "revocar_lease_venta_offline_v1"
  ]) {
    const start = sql.indexOf(`function public.${name}`);
    assert.notEqual(start, -1);
    assert.match(sql.slice(start, start + 900), /security definer[\s\S]*set search_path\s*=\s*''/);
  }
  assert.match(sql, /revoke execute on function public\.emitir_lease_venta_offline_v1[\s\S]*from public,\s*anon/);
  assert.match(sql, /revoke execute on function public\.registrar_venta_offline_v1[\s\S]*from public,\s*anon/);
  assert.match(sql, /revoke execute on function public\.revocar_lease_venta_offline_v1[\s\S]*from public,\s*anon/);
  assert.match(sql, /grant execute on function public\.registrar_venta_offline_v1[\s\S]*to authenticated,\s*service_role/);
});

test("only privileged members can revoke an in-scope lease", () => {
  assert.match(sql, /function public\.revocar_lease_venta_offline_v1/);
  assert.match(sql, /tiene_rol_negocio\(v_negocio_id,array\['owner','admin'\]\)/);
  assert.match(sql, /update public\.offline_sale_leases[\s\S]*revoked_at=now\(\)/);
  assert.match(sql, /where id=p_lease_id and negocio_id=v_negocio_id/);
});

test("offline lease validates authenticated tenant, open cash, scope and product quotas", () => {
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /public\.negocio_actual_id\(\)/);
  assert.match(sql, /public\.tiene_rol_negocio/);
  assert.match(sql, /cs\.caja_id=p_caja_id[\s\S]*cs\.estado='abierta'/);
  assert.match(sql, /v_lease\.sucursal_id<>p_sucursal_id/);
  assert.match(sql, /v_lease\.caja_id<>p_caja_id/);
  assert.match(sql, /v_lease\.used_sales\+1>v_lease\.max_sales/);
  assert.match(sql, /v_lease\.used_amount\+v_amount>v_lease\.max_amount/);
  assert.match(sql, /v_quota\.used_quantity\+v_item\.cantidad>v_quota\.max_quantity/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /la caja ya tiene una autorización offline vigente/);
  assert.match(sql, /v_response := public\.registrar_venta_v4/);
  assert.match(sql, /set_config\('request\.jwt\.claim\.sub',v_cash_session_user_id/);
  assert.match(sql, /update public\.ventas set user_id=p_created_by_user_id/);
  assert.doesNotMatch(sql, /p\.activo/);
});

test("authorization belongs to the cash register while the issuer remains audit data", () => {
  assert.match(sql, /issued_by_user_id uuid not null/);
  assert.match(sql, /created_by_user_id uuid not null/);
  assert.doesNotMatch(sql, /v_lease\.issued_by_user_id<>v_user_id/);
  assert.doesNotMatch(sql, /cs\.user_id=v_user_id/);
  assert.match(sql, /v_lease\.revoked_at is not null and p_offline_created_at>v_lease\.revoked_at/);
});
