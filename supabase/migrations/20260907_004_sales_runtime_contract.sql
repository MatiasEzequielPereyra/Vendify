-- ============================================================
-- Vendify — contrato mínimo de ventas críticas en runtime
-- ============================================================
-- La implementación de registrar_venta_v4 es anterior a este repositorio
-- incremental. No se la recrea sin su fuente canónica: se verifica que la
-- base activa conserve el RPC y el permiso que usan el POS y la cola offline.

begin;

do $$
declare
    v_registrar_venta regprocedure := to_regprocedure(
      'public.registrar_venta_v4(jsonb,jsonb,text,numeric,text,uuid,uuid,text)'
    );
begin
    if v_registrar_venta is null then
        raise exception
          'Falta registrar_venta_v4(jsonb,jsonb,text,numeric,text,uuid,uuid,text). No publicar el POS ni habilitar sincronización offline.';
    end if;

    if not has_function_privilege(
        'authenticated',
        v_registrar_venta,
        'execute'
    ) then
        raise exception
          'authenticated no puede ejecutar registrar_venta_v4. No publicar el POS ni habilitar sincronización offline.';
    end if;

    if to_regclass('public.venta_pagos') is null
       or to_regclass('public.venta_items') is null
       or to_regclass('public.producto_stock_sucursal') is null
       or to_regclass('public.cajas_sesiones') is null then
        raise exception
          'Faltan dependencias de venta crítica (pagos, items, stock o sesión de caja).';
    end if;
end;
$$;

commit;
