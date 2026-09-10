-- Read-only source recovery for RPCs that are deployed but not versioned.
-- Run in the Supabase SQL Editor and export the result as JSON/CSV.
-- Do not execute the returned definitions directly; they must be reviewed and
-- stored in a numbered migration before becoming part of the repository chain.

with expected_rpc(proname) as (
  values
    ('actualizar_rol_miembro_v2'), ('actualizar_sucursal_v1'),
    ('autorizar_descuento_v1'), ('cambiar_estado_caja_v1'),
    ('cambiar_estado_miembro_v3'), ('configurar_pin_descuento_v1'),
    ('crear_caja_v1'), ('crear_sucursal_v1'), ('diagnostico_integridad_v1'),
    ('estado_pin_descuento_v1'), ('listar_equipo_v3'),
    ('listar_sucursales_admin_v1'), ('obtener_negocio_admin_actual'),
    ('obtener_perfil_empleado_actual')
)
select expected_rpc.proname as rpc,
  pg_get_function_identity_arguments(proc.oid) as identity_arguments,
  proc.prosecdef as security_definer,
  coalesce(array_to_string(proc.proconfig, ', '), '') as function_settings,
  pg_get_functiondef(proc.oid) as definition
from expected_rpc
left join pg_proc proc on proc.proname = expected_rpc.proname
 and proc.pronamespace = 'public'::regnamespace
order by expected_rpc.proname, identity_arguments;
