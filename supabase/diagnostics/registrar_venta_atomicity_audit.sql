-- ============================================================
-- Vendify — diagnóstico de atomicidad de registrar_venta
-- ============================================================
-- Sólo lectura. Verifica las definiciones desplegadas de v2, v3 y v4.
-- En PostgreSQL, una excepción no capturada aborta la transacción RPC;
-- por eso no deben existir handlers EXCEPTION que oculten un fallo parcial.

with functions as (
  select
    p.oid::regprocedure::text as signature,
    p.prosecdef as security_definer,
    has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
    has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
    pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid in (
      to_regprocedure('public.registrar_venta_v2(jsonb,text,uuid,uuid)'),
      to_regprocedure('public.registrar_venta_v3(jsonb,jsonb,text,numeric,text,uuid,uuid)'),
      to_regprocedure('public.registrar_venta_v4(jsonb,jsonb,text,numeric,text,uuid,uuid,text)')
    )
), checks as (
  select
    count(*) filter (where signature like 'registrar_venta_v3(%' or signature like 'registrar_venta_v4(%') = 2
      as functions_present,
    coalesce(bool_and(security_definer) filter (
      where signature like 'registrar_venta_v3(%' or signature like 'registrar_venta_v4(%'
    ), false) as all_security_definer,
    coalesce(bool_or(anon_can_execute), false) as anon_can_execute_any,
    coalesce(bool_or(
      signature like 'registrar_venta_v2(%' and authenticated_can_execute
    ), false) as authenticated_can_execute_v2,
    coalesce(bool_or(
      signature like 'registrar_venta_v3(%' and authenticated_can_execute
    ), false) as authenticated_can_execute_v3,
    coalesce(bool_or(
      signature like 'registrar_venta_v4(%' and authenticated_can_execute
    ), false) as authenticated_can_execute_v4,
    coalesce(bool_or(
      signature like 'registrar_venta_v3(%'
      and definition ~* E'\\n[[:space:]]*exception[[:space:]]*\\n[[:space:]]*when\\M'
    ), false) as v3_has_exception_handler,
    coalesce(bool_or(
      signature like 'registrar_venta_v4(%'
      and definition ~* E'\\n[[:space:]]*exception[[:space:]]*\\n[[:space:]]*when\\M'
    ), false) as v4_has_exception_handler,
    coalesce(bool_or(
      signature like 'registrar_venta_v3(%'
      and definition ~* 'insert[[:space:]]+into[[:space:]]+public[.]ventas'
      and definition ~* 'update[[:space:]]+public[.]producto_stock_sucursal'
      and definition ~* 'insert[[:space:]]+into[[:space:]]+public[.]venta_items'
      and definition ~* 'insert[[:space:]]+into[[:space:]]+public[.]venta_pagos'
      and definition ~* 'insert[[:space:]]+into[[:space:]]+public[.]movimientos'
    ), false) as v3_contains_sale_write_set,
    coalesce(bool_or(
      signature like 'registrar_venta_v4(%'
      and definition ~* 'public[.]registrar_venta_v3'
      and definition ~* 'venta_idempotencia_v23011'
    ), false) as v4_delegates_and_persists_idempotency
  from functions
)
select jsonb_build_object(
  'functions_present', functions_present,
  'all_security_definer', all_security_definer,
  'anon_can_execute_any', anon_can_execute_any,
  'authenticated_can_execute_v2', authenticated_can_execute_v2,
  'authenticated_can_execute_v3', authenticated_can_execute_v3,
  'authenticated_can_execute_v4', authenticated_can_execute_v4,
  'v3_has_exception_handler', v3_has_exception_handler,
  'v4_has_exception_handler', v4_has_exception_handler,
  'v3_contains_sale_write_set', v3_contains_sale_write_set,
  'v4_delegates_and_persists_idempotency', v4_delegates_and_persists_idempotency,
  'atomicity_contract_ok',
    functions_present
    and all_security_definer
    and not anon_can_execute_any
    and not authenticated_can_execute_v2
    and not authenticated_can_execute_v3
    and authenticated_can_execute_v4
    and not v3_has_exception_handler
    and not v4_has_exception_handler
    and v3_contains_sale_write_set
    and v4_delegates_and_persists_idempotency
) as registrar_venta_atomicity_audit
from checks;
