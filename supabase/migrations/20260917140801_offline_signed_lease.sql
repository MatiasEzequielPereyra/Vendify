begin;

create table public.offline_sale_leases (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  caja_id uuid not null references public.cajas(id) on delete cascade,
  issued_by_user_id uuid not null references auth.users(id) on delete restrict,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default now(), expires_at timestamptz not null,
  max_sales integer not null check (max_sales > 0 and max_sales <= 100),
  max_amount numeric(14,2) not null check (max_amount > 0),
  used_sales integer not null default 0 check (used_sales between 0 and max_sales),
  used_amount numeric(14,2) not null default 0 check (used_amount between 0 and max_amount),
  revoked_at timestamptz, created_at timestamptz not null default now(),
  check (expires_at > issued_at)
);
create index offline_sale_leases_scope_idx on public.offline_sale_leases(negocio_id,sucursal_id,caja_id,expires_at desc);
alter table public.offline_sale_leases enable row level security;
revoke all on table public.offline_sale_leases from public, anon, authenticated;

create table public.offline_sale_lease_product_quotas (
  lease_id uuid not null references public.offline_sale_leases(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete restrict,
  max_quantity integer not null check (max_quantity > 0),
  used_quantity integer not null default 0 check (used_quantity between 0 and max_quantity),
  primary key (lease_id, producto_id)
);
create index offline_sale_lease_product_active_idx on public.offline_sale_lease_product_quotas(producto_id,lease_id);
alter table public.offline_sale_lease_product_quotas enable row level security;
revoke all on table public.offline_sale_lease_product_quotas from public, anon, authenticated;

create table public.offline_sale_lease_usage (
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  lease_id uuid not null references public.offline_sale_leases(id) on delete restrict,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  request_id text not null check (length(request_id) between 8 and 100),
  amount numeric(14,2) not null check (amount >= 0), offline_created_at timestamptz not null,
  created_at timestamptz not null default now(), primary key (negocio_id,request_id)
);
create index offline_sale_lease_usage_lease_idx on public.offline_sale_lease_usage(lease_id);
alter table public.offline_sale_lease_usage enable row level security;
revoke all on table public.offline_sale_lease_usage from public, anon, authenticated;

create or replace function public.emitir_lease_venta_offline_v1(p_sucursal_id uuid,p_caja_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid(); v_negocio_id uuid; v_token text;
  v_lease public.offline_sale_leases; v_stock record; v_reserved integer;
  v_quota integer; v_product_quotas jsonb;
begin
  if v_user_id is null then raise exception 'Sesión requerida'; end if;
  v_negocio_id := public.negocio_actual_id();
  if not public.tiene_rol_negocio(v_negocio_id,array['owner','admin','manager','cashier']) then
    raise exception 'No tenés permiso para registrar ventas';
  end if;
  if not exists (
    select 1 from public.cajas c join public.sucursales s on s.id=c.sucursal_id and s.negocio_id=c.negocio_id
    where c.id=p_caja_id and c.negocio_id=v_negocio_id and c.sucursal_id=p_sucursal_id
  ) then raise exception 'Caja o sucursal inválida para la autorización offline'; end if;
  if not exists (
    select 1 from public.cajas_sesiones cs where cs.caja_id=p_caja_id and cs.negocio_id=v_negocio_id
      and cs.sucursal_id=p_sucursal_id and cs.estado='abierta'
  ) then raise exception 'Necesitás una caja abierta para habilitar ventas offline'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_caja_id::text,0));
  if exists (
    select 1 from public.offline_sale_leases l where l.negocio_id=v_negocio_id
      and l.sucursal_id=p_sucursal_id and l.caja_id=p_caja_id
      and l.revoked_at is null and l.expires_at>now()
  ) then raise exception 'La caja ya tiene una autorización offline vigente'; end if;

  v_token := replace(pg_catalog.gen_random_uuid()::text,'-','')
    || replace(pg_catalog.gen_random_uuid()::text,'-','');
  insert into public.offline_sale_leases(negocio_id,sucursal_id,caja_id,issued_by_user_id,token_hash,expires_at,max_sales,max_amount)
  values(
    v_negocio_id,p_sucursal_id,p_caja_id,v_user_id,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_token,'UTF8')),'hex'),
    now()+interval '8 hours',50,1000000
  )
  returning * into v_lease;

  for v_stock in
    select ps.producto_id,greatest(ps.stock,0)::integer stock
    from public.producto_stock_sucursal ps join public.productos p on p.id=ps.producto_id and p.negocio_id=ps.negocio_id
    where ps.negocio_id=v_negocio_id and ps.sucursal_id=p_sucursal_id and ps.stock>0
    order by ps.producto_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_stock.producto_id::text,0));
    select coalesce(sum(q.max_quantity-q.used_quantity),0)::integer into v_reserved
    from public.offline_sale_lease_product_quotas q join public.offline_sale_leases l on l.id=q.lease_id
    where q.producto_id=v_stock.producto_id and l.negocio_id=v_negocio_id and l.sucursal_id=p_sucursal_id
      and l.revoked_at is null and l.expires_at>now();
    v_quota := least(20,greatest(1,floor(v_stock.stock*0.25)::integer),greatest(v_stock.stock-v_reserved,0));
    if v_quota>0 then
      insert into public.offline_sale_lease_product_quotas(lease_id,producto_id,max_quantity)
      values(v_lease.id,v_stock.producto_id,v_quota);
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('product_id',q.producto_id,'max_quantity',q.max_quantity,'used_quantity',q.used_quantity) order by q.producto_id),'[]'::jsonb)
  into v_product_quotas from public.offline_sale_lease_product_quotas q where q.lease_id=v_lease.id;
  if jsonb_array_length(v_product_quotas)=0 then raise exception 'No hay cupo de productos disponible para esta caja'; end if;
  return jsonb_build_object(
    'version',1,'lease_id',v_lease.id,'token',v_token,'business_id',v_lease.negocio_id,
    'branch_id',v_lease.sucursal_id,'cash_register_id',v_lease.caja_id,'issued_by_user_id',v_lease.issued_by_user_id,
    'issued_at',v_lease.issued_at,'expires_at',v_lease.expires_at,'max_sales',v_lease.max_sales,
    'max_amount',v_lease.max_amount,'used_sales',v_lease.used_sales,'used_amount',v_lease.used_amount,
    'product_quotas',v_product_quotas);
end; $$;

create or replace function public.registrar_venta_offline_v1(
  p_lease_id uuid,p_lease_token text,p_offline_created_at timestamptz,p_created_by_user_id uuid,p_items jsonb,p_pagos jsonb,
  p_descuento_tipo text default null,p_descuento_valor numeric default 0,p_observacion text default null,
  p_sucursal_id uuid default null,p_caja_id uuid default null,p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid(); v_negocio_id uuid; v_lease public.offline_sale_leases;
  v_amount numeric(14,2); v_inserted_request text; v_item record;
  v_quota public.offline_sale_lease_product_quotas;
  v_cash_session_user_id uuid; v_authenticated_user_id uuid := auth.uid();
  v_response jsonb; v_sale_id uuid;
begin
  if v_user_id is null then raise exception 'Sesión requerida'; end if;
  if nullif(trim(coalesce(p_lease_token,'')),'') is null then raise exception 'Token de autorización offline requerido'; end if;
  v_negocio_id := public.negocio_actual_id();
  if not public.tiene_rol_negocio(v_negocio_id,array['owner','admin','manager','cashier']) then raise exception 'No tenés permiso para registrar ventas'; end if;
  if nullif(trim(coalesce(p_request_id,'')),'') is null or length(trim(p_request_id)) not between 8 and 100 then raise exception 'Identificador de operación inválido'; end if;
  if not exists(
    select 1 from public.negocio_miembros nm where nm.negocio_id=v_negocio_id
      and nm.user_id=p_created_by_user_id and nm.activo=true
      and nm.rol=any(array['owner','admin','manager','cashier'])
  ) then raise exception 'El usuario creador no puede registrar ventas en este negocio'; end if;
  select * into v_lease from public.offline_sale_leases osl where osl.id=p_lease_id for update;
  if not found or v_lease.negocio_id<>v_negocio_id or v_lease.sucursal_id<>p_sucursal_id or v_lease.caja_id<>p_caja_id then raise exception 'Autorización offline fuera de alcance'; end if;
  if pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_lease_token,'UTF8')),
    'hex'
  )<>v_lease.token_hash then raise exception 'Token de autorización offline inválido'; end if;
  if p_offline_created_at<v_lease.issued_at or p_offline_created_at>v_lease.expires_at
    or (v_lease.revoked_at is not null and p_offline_created_at>v_lease.revoked_at) then raise exception 'La venta fue creada fuera de la vigencia offline'; end if;
  v_amount := coalesce((select sum((payment->>'monto')::numeric) from jsonb_array_elements(p_pagos) payment),0);
  if v_amount<0 then raise exception 'Importe offline inválido'; end if;
  insert into public.offline_sale_lease_usage(negocio_id,lease_id,created_by_user_id,request_id,amount,offline_created_at)
  values(v_negocio_id,p_lease_id,p_created_by_user_id,trim(p_request_id),v_amount,p_offline_created_at)
  on conflict(negocio_id,request_id) do nothing
  returning request_id into v_inserted_request;
  if v_inserted_request is not null then
    if v_lease.used_sales+1>v_lease.max_sales or v_lease.used_amount+v_amount>v_lease.max_amount then raise exception 'Capacidad de autorización offline agotada'; end if;
    for v_item in select (item->>'producto_id')::uuid producto_id,sum((item->>'cantidad')::integer)::integer cantidad
      from jsonb_array_elements(p_items) item group by (item->>'producto_id')::uuid
    loop
      select * into v_quota from public.offline_sale_lease_product_quotas q
      where q.lease_id=p_lease_id and q.producto_id=v_item.producto_id for update;
      if not found or v_item.cantidad<=0 or v_quota.used_quantity+v_item.cantidad>v_quota.max_quantity then raise exception 'Cupo offline agotado para el producto %',v_item.producto_id; end if;
      update public.offline_sale_lease_product_quotas set used_quantity=used_quantity+v_item.cantidad
      where lease_id=p_lease_id and producto_id=v_item.producto_id;
    end loop;
    update public.offline_sale_leases set used_sales=used_sales+1,used_amount=used_amount+v_amount where id=p_lease_id;
  elsif not exists(
    select 1 from public.offline_sale_lease_usage u
    where u.negocio_id=v_negocio_id and u.lease_id=p_lease_id
      and u.created_by_user_id=p_created_by_user_id
      and u.request_id=trim(p_request_id) and u.amount=v_amount
      and u.offline_created_at=p_offline_created_at
  ) then
    raise exception 'El identificador offline ya fue usado con otra autorización';
  end if;
  select cs.user_id into v_cash_session_user_id from public.cajas_sesiones cs
   where cs.negocio_id=v_negocio_id and cs.sucursal_id=p_sucursal_id
     and cs.caja_id=p_caja_id and cs.estado='abierta' for update;
  if v_cash_session_user_id is null then raise exception 'La caja ya no tiene una sesión abierta'; end if;

  perform pg_catalog.set_config('request.jwt.claim.sub',v_cash_session_user_id::text,true);
  v_response := public.registrar_venta_v4(p_items,p_pagos,p_descuento_tipo,p_descuento_valor,p_observacion,p_sucursal_id,p_caja_id,p_request_id);
  perform pg_catalog.set_config('request.jwt.claim.sub',v_authenticated_user_id::text,true);

  v_sale_id := (v_response->'venta'->>'id')::uuid;
  update public.ventas set user_id=p_created_by_user_id where id=v_sale_id and negocio_id=v_negocio_id;
  update public.venta_items set user_id=p_created_by_user_id where venta_id=v_sale_id and negocio_id=v_negocio_id;
  update public.venta_pagos set user_id=p_created_by_user_id where venta_id=v_sale_id and negocio_id=v_negocio_id;
  v_response := jsonb_set(v_response,'{venta,user_id}',to_jsonb(p_created_by_user_id::text),true);
  return v_response;
end; $$;

create or replace function public.revocar_lease_venta_offline_v1(p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_negocio_id uuid;
  v_revoked_at timestamptz;
begin
  if v_user_id is null then raise exception 'Sesión requerida'; end if;
  v_negocio_id := public.negocio_actual_id();
  if not public.tiene_rol_negocio(v_negocio_id,array['owner','admin']) then
    raise exception 'No tenés permiso para revocar autorizaciones offline';
  end if;

  update public.offline_sale_leases
  set revoked_at=now()
  where id=p_lease_id and negocio_id=v_negocio_id and revoked_at is null
  returning revoked_at into v_revoked_at;

  if v_revoked_at is null then
    raise exception 'Autorización offline inexistente, fuera de alcance o ya revocada';
  end if;
  return jsonb_build_object('ok',true,'lease_id',p_lease_id,'revoked_at',v_revoked_at);
end; $$;

revoke execute on function public.emitir_lease_venta_offline_v1(uuid,uuid) from public,anon;
grant execute on function public.emitir_lease_venta_offline_v1(uuid,uuid) to authenticated,service_role;
revoke execute on function public.registrar_venta_offline_v1(uuid,text,timestamptz,uuid,jsonb,jsonb,text,numeric,text,uuid,uuid,text) from public,anon;
grant execute on function public.registrar_venta_offline_v1(uuid,text,timestamptz,uuid,jsonb,jsonb,text,numeric,text,uuid,uuid,text) to authenticated,service_role;
revoke execute on function public.revocar_lease_venta_offline_v1(uuid) from public,anon;
grant execute on function public.revocar_lease_venta_offline_v1(uuid) to authenticated,service_role;

do $$ begin
  if to_regprocedure('public.registrar_venta_v4(jsonb,jsonb,text,numeric,text,uuid,uuid,text)') is null then raise exception 'Falta registrar_venta_v4 para instalar ventas offline autorizadas'; end if;
  if has_function_privilege('anon','public.emitir_lease_venta_offline_v1(uuid,uuid)','execute')
    or has_function_privilege('anon','public.registrar_venta_offline_v1(uuid,text,timestamp with time zone,uuid,jsonb,jsonb,text,numeric,text,uuid,uuid,text)','execute')
    or has_function_privilege('anon','public.revocar_lease_venta_offline_v1(uuid)','execute')
    or not has_function_privilege('authenticated','public.emitir_lease_venta_offline_v1(uuid,uuid)','execute')
    or not has_function_privilege('authenticated','public.registrar_venta_offline_v1(uuid,text,timestamp with time zone,uuid,jsonb,jsonb,text,numeric,text,uuid,uuid,text)','execute')
    or not has_function_privilege('authenticated','public.revocar_lease_venta_offline_v1(uuid)','execute')
  then raise exception 'Permisos inesperados en el contrato de lease offline'; end if;
end; $$;
commit;
