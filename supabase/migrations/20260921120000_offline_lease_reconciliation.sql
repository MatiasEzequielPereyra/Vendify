begin;

create or replace function public.obtener_estado_lease_venta_offline_v1(
  p_lease_id uuid,
  p_lease_token text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_negocio_id uuid;
  v_lease public.offline_sale_leases;
  v_product_quotas jsonb;
  v_status text;
begin
  if v_user_id is null then raise exception 'Sesión requerida'; end if;
  if nullif(trim(coalesce(p_lease_token,'')),'') is null then
    raise exception 'Token de autorización offline requerido';
  end if;

  v_negocio_id := public.negocio_actual_id();
  if not public.tiene_rol_negocio(v_negocio_id,array['owner','admin','manager','cashier']) then
    raise exception 'No tenés permiso para consultar autorizaciones offline';
  end if;

  select * into v_lease
  from public.offline_sale_leases l
  where l.id=p_lease_id and l.negocio_id=v_negocio_id;

  if not found then raise exception 'Autorización offline fuera de alcance'; end if;
  if pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_lease_token,'UTF8')),
    'hex'
  )<>v_lease.token_hash then raise exception 'Token de autorización offline inválido'; end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id',q.producto_id,
        'max_quantity',q.max_quantity,
        'used_quantity',q.used_quantity
      ) order by q.producto_id
    ),
    '[]'::jsonb
  )
  into v_product_quotas
  from public.offline_sale_lease_product_quotas q
  where q.lease_id=v_lease.id;

  v_status := case
    when v_lease.revoked_at is not null then 'revoked'
    when v_lease.expires_at<=now() then 'expired'
    when v_lease.used_sales>=v_lease.max_sales
      or v_lease.used_amount>=v_lease.max_amount
      or not exists (
        select 1
        from public.offline_sale_lease_product_quotas q
        where q.lease_id=v_lease.id and q.used_quantity<q.max_quantity
      ) then 'exhausted'
    else 'active'
  end;

  return jsonb_build_object(
    'status',v_status,
    'version',1,
    'lease_id',v_lease.id,
    'business_id',v_lease.negocio_id,
    'branch_id',v_lease.sucursal_id,
    'cash_register_id',v_lease.caja_id,
    'issued_by_user_id',v_lease.issued_by_user_id,
    'issued_at',v_lease.issued_at,
    'expires_at',v_lease.expires_at,
    'max_sales',v_lease.max_sales,
    'max_amount',v_lease.max_amount,
    'used_sales',v_lease.used_sales,
    'used_amount',v_lease.used_amount,
    'product_quotas',v_product_quotas
  );
end;
$$;

create or replace function public.renovar_lease_venta_offline_v1(
  p_lease_id uuid,
  p_lease_token text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_negocio_id uuid;
  v_lease public.offline_sale_leases;
  v_has_capacity boolean;
begin
  if v_user_id is null then raise exception 'Sesión requerida'; end if;
  if nullif(trim(coalesce(p_lease_token,'')),'') is null then
    raise exception 'Token de autorización offline requerido';
  end if;

  v_negocio_id := public.negocio_actual_id();
  if not public.tiene_rol_negocio(v_negocio_id,array['owner','admin','manager','cashier']) then
    raise exception 'No tenés permiso para renovar autorizaciones offline';
  end if;

  select * into v_lease
  from public.offline_sale_leases l
  where l.id=p_lease_id and l.negocio_id=v_negocio_id
  for update;

  if not found then raise exception 'Autorización offline fuera de alcance'; end if;
  if pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_lease_token,'UTF8')),
    'hex'
  )<>v_lease.token_hash then raise exception 'Token de autorización offline inválido'; end if;
  if v_lease.revoked_at is not null or v_lease.expires_at<=now() then
    raise exception 'La autorización offline ya no puede renovarse';
  end if;

  select exists (
    select 1
    from public.offline_sale_lease_product_quotas q
    where q.lease_id=v_lease.id and q.used_quantity<q.max_quantity
  ) into v_has_capacity;

  if v_lease.used_sales<v_lease.max_sales
    and v_lease.used_amount<v_lease.max_amount
    and v_has_capacity then
    raise exception 'La autorización offline todavía tiene capacidad';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_lease.caja_id::text,0));
  update public.offline_sale_leases
  set revoked_at=now()
  where id=v_lease.id;

  return public.emitir_lease_venta_offline_v1(v_lease.sucursal_id,v_lease.caja_id);
end;
$$;

revoke execute on function public.obtener_estado_lease_venta_offline_v1(uuid,text) from public,anon;
grant execute on function public.obtener_estado_lease_venta_offline_v1(uuid,text) to authenticated,service_role;
revoke execute on function public.renovar_lease_venta_offline_v1(uuid,text) from public,anon;
grant execute on function public.renovar_lease_venta_offline_v1(uuid,text) to authenticated,service_role;

do $$
begin
  if has_function_privilege('anon','public.obtener_estado_lease_venta_offline_v1(uuid,text)','execute')
    or has_function_privilege('anon','public.renovar_lease_venta_offline_v1(uuid,text)','execute')
    or not has_function_privilege('authenticated','public.obtener_estado_lease_venta_offline_v1(uuid,text)','execute')
    or not has_function_privilege('authenticated','public.renovar_lease_venta_offline_v1(uuid,text)','execute')
  then
    raise exception 'Permisos inesperados en reconciliación de lease offline';
  end if;
end;
$$;

commit;
