-- ============================================================
-- Vendify — superficie explícita para funciones SECURITY DEFINER
-- ============================================================
-- Las funciones SECURITY DEFINER no deben heredar EXECUTE desde PUBLIC.
-- El frontend sólo recibe ejecución sobre el contrato actual de RPC.

begin;

do $$
declare
  v_frontend_rpc constant text[] := array[
    'abrir_caja_v1',
    'actualizar_permiso_stock_miembro_v1',
    'actualizar_plan_negocio_plataforma_v1',
    'actualizar_rol_miembro_v2',
    'actualizar_sucursal_v1',
    'ajustar_stock_inicial_rapido_v2',
    'ajustar_stock_inventario_v2',
    'alertas_operativas_v1',
    'anular_compra_borrador_v1',
    'anular_venta_v1',
    'aplicar_conteo_fisico_v2',
    'autorizar_descuento_v1',
    'cambiar_estado_caja_v1',
    'cambiar_estado_miembro_v3',
    'cerrar_caja_v1',
    'configurar_pin_descuento_v1',
    'confirmar_stock_por_scanner_v2',
    'crear_caja_v1',
    'crear_sucursal_v1',
    'dashboard_propietario_v1',
    'devolver_venta_v1',
    'diagnostico_integridad_v1',
    'eliminar_categoria_segura_v1',
    'eliminar_producto_seguro_v1',
    'eliminar_todos_productos_seguro_v1',
    'es_admin_plataforma_v1',
    'estado_onboarding_comercial_v1',
    'estado_pin_descuento_v1',
    'exportar_respaldo_operativo_v1',
    'guardar_categoria_segura_v1',
    'guardar_compra_borrador_v1',
    'guardar_config_operativa_v1',
    'guardar_producto_seguro_v2',
    'guardar_proveedor_v1',
    'importar_productos_masivo_v1',
    'importar_productos_seguro_v1',
    'inicializar_categorias_seguras_v1',
    'listar_cajas_sucursal_v1',
    'listar_categorias_seguras_v1',
    'listar_compras_v1',
    'listar_equipo_v3',
    'listar_errores_plataforma_v1',
    'listar_historial_cajas_v1',
    'listar_movimientos_caja_abierta_v1',
    'listar_movimientos_inventario_v1',
    'listar_negocios_plataforma_v1',
    'listar_permisos_stock_equipo_v1',
    'listar_productos_sucursal_seguro_v1',
    'listar_proveedores_v1',
    'listar_sucursales_admin_v1',
    'listar_sucursales_app',
    'obtener_compra_v1',
    'obtener_config_operativa_v1',
    'obtener_contexto_app',
    'obtener_contexto_sucursal',
    'obtener_estado_caja_v1',
    'obtener_negocio_admin_actual',
    'obtener_perfil_empleado_actual',
    'obtener_permisos_personalizados_v1',
    'obtener_plan_actual_v1',
    'obtener_stock_inteligente_sucursal',
    'platform_overview_v1',
    'recibir_compra_v1',
    'registrar_error_cliente_v1',
    'registrar_movimiento_caja_v1',
    'registrar_venta_v2',
    'registrar_venta_v4',
    'transferir_stock_v2'
  ];
  v_missing text[];
  v_remaining_anon integer;
  v_missing_authenticated text[];
  r record;
begin
  -- No cerrar permisos si el contrato versionado no coincide con la base activa.
  select array_agg(requested.rpc order by requested.rpc)
    into v_missing
    from unnest(v_frontend_rpc) as requested(rpc)
   where not exists (
     select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = requested.rpc
   );

  if v_missing is not null then
    raise exception 'Faltan RPC del contrato frontend: %', array_to_string(v_missing, ', ');
  end if;

  -- Eliminar grants heredados o explícitos de las superficies cliente.
  for r in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      r.signature
    );
    -- Mantiene la operación de Edge Functions y tareas administrativas server-side.
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;

  -- Reabrir exclusivamente los RPC que el cliente autenticado puede invocar.
  for r in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.proname = any(v_frontend_rpc)
  loop
    execute format('grant execute on function %s to authenticated', r.signature);
  end loop;

  select count(*)
    into v_remaining_anon
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute');

  if v_remaining_anon <> 0 then
    raise exception '% funciones SECURITY DEFINER permanecen accesibles por anon.', v_remaining_anon;
  end if;

  select array_agg(requested.rpc order by requested.rpc)
    into v_missing_authenticated
    from unnest(v_frontend_rpc) as requested(rpc)
   where not exists (
     select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and p.proname = requested.rpc
        and has_function_privilege('authenticated', p.oid, 'execute')
   );

  if v_missing_authenticated is not null then
    raise exception 'RPC sin permiso authenticated: %', array_to_string(v_missing_authenticated, ', ');
  end if;

  if has_function_privilege(
    'authenticated',
    'public.registrar_venta_v3(jsonb,jsonb,text,numeric,text,uuid,uuid)'::regprocedure,
    'execute'
  ) then
    raise exception 'registrar_venta_v3 debe permanecer sólo para llamadas internas.';
  end if;
end;
$$;

commit;
