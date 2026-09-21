begin;

create table public.operational_backups (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'preparing'
    check (status in ('preparing','ready','failed','expired')),
  schema_version integer not null default 2 check (schema_version = 2),
  cutoff_at timestamptz not null,
  cursor_secret text not null check (length(cursor_secret) = 64),
  manifest jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index operational_backups_business_created_idx
  on public.operational_backups(negocio_id,created_at desc);
create index operational_backups_requested_by_idx
  on public.operational_backups(requested_by);

alter table public.operational_backups enable row level security;
revoke all on table public.operational_backups from public,anon,authenticated;

create table public.operational_backup_parts (
  id uuid primary key default gen_random_uuid(),
  backup_id uuid not null references public.operational_backups(id) on delete cascade,
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  section text not null,
  part_number integer not null check (part_number >= 0),
  row_count integer not null check (row_count >= 0),
  byte_count bigint not null default 0 check (byte_count >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text,
  first_row_id uuid,
  last_row_id uuid,
  created_at timestamptz not null default now(),
  unique (backup_id,section,part_number)
);
create index operational_backup_parts_business_backup_idx
  on public.operational_backup_parts(negocio_id,backup_id,section,part_number);
create index operational_backup_parts_backup_idx
  on public.operational_backup_parts(backup_id);

-- High-volume page scans use negocio_id equality followed by the UUID keyset range.
create index productos_backup_keyset_idx on public.productos(negocio_id,id);
create index producto_stock_backup_keyset_idx on public.producto_stock_sucursal(negocio_id,id);
create index compras_backup_keyset_idx on public.compras(negocio_id,id);
create index compra_items_backup_keyset_idx on public.compra_items(negocio_id,id);
create index ventas_backup_keyset_idx on public.ventas(negocio_id,id);
create index venta_items_backup_keyset_idx on public.venta_items(negocio_id,id);
create index venta_pagos_backup_keyset_idx on public.venta_pagos(negocio_id,id);
create index caja_movimientos_backup_keyset_idx on public.caja_movimientos(negocio_id,id);
create index movimientos_backup_keyset_idx on public.movimientos(negocio_id,id);

alter table public.operational_backup_parts enable row level security;
revoke all on table public.operational_backup_parts from public,anon,authenticated;

create or replace function public.iniciar_respaldo_operativo_v2()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_negocio_id uuid;
  v_backup public.operational_backups;
  v_secret text;
begin
  if v_user_id is null then raise exception 'Sesión requerida'; end if;
  v_negocio_id := public.negocio_actual_id();
  if not public.tiene_rol_negocio(v_negocio_id,array['owner']) then
    raise exception 'Solo el propietario puede iniciar un respaldo completo';
  end if;

  v_secret := replace(pg_catalog.gen_random_uuid()::text,'-','')
    || replace(pg_catalog.gen_random_uuid()::text,'-','');

  insert into public.operational_backups(
    negocio_id,requested_by,cutoff_at,cursor_secret,expires_at,manifest
  ) values (
    v_negocio_id,v_user_id,now(),v_secret,now()+interval '24 hours',
    jsonb_build_object(
      'format','vendify-operational-backup-v2',
      'schema_version',2,
      'sections',jsonb_build_array(
        'business','config','branches','cash_registers','categories','products',
        'branch_stock','suppliers','purchases','purchase_items','members',
        'sales','sale_items','sale_payments','sale_returns','cash_sessions',
        'cash_movements','inventory_movements'
      )
    )
  ) returning * into v_backup;

  return jsonb_build_object(
    'format','vendify-operational-backup-v2',
    'schema_version',v_backup.schema_version,
    'backup_id',v_backup.id,
    'business_id',v_backup.negocio_id,
    'status',v_backup.status,
    'cutoff_at',v_backup.cutoff_at,
    'created_at',v_backup.created_at,
    'expires_at',v_backup.expires_at,
    'manifest',v_backup.manifest
  );
end;
$$;

create or replace function public.exportar_pagina_respaldo_operativo_v2(
  p_backup_id uuid,
  p_section text,
  p_cursor text default null,
  p_limit integer default 500
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_negocio_id uuid;
  v_backup public.operational_backups;
  v_section text := lower(trim(coalesce(p_section,'')));
  v_payload text;
  v_signature text;
  v_expected_signature text;
  v_cursor_backup uuid;
  v_cursor_section text;
  v_last_id uuid;
  v_source text;
  v_rows jsonb;
  v_page_last_id uuid;
  v_has_more boolean;
  v_next_payload text;
  v_next_signature text;
  v_next_cursor text;
begin
  if v_user_id is null then raise exception 'Sesión requerida'; end if;
  if p_limit is null or p_limit < 100 or p_limit > 2000 then
    raise exception 'El límite de página debe estar entre 100 y 2000';
  end if;

  v_negocio_id := public.negocio_actual_id();
  if not public.tiene_rol_negocio(v_negocio_id,array['owner']) then
    raise exception 'Solo el propietario puede exportar un respaldo completo';
  end if;

  select * into v_backup
  from public.operational_backups b
  where b.id=p_backup_id and b.negocio_id=v_negocio_id
  for update;

  if not found then raise exception 'Respaldo inexistente o fuera de alcance'; end if;
  if v_backup.status in ('failed','expired') or v_backup.expires_at<=now() then
    update public.operational_backups
      set status='expired',updated_at=now()
      where id=v_backup.id and status<>'failed';
    raise exception 'El respaldo ya no está disponible para exportación';
  end if;

  if p_cursor is not null then
    begin
      v_payload := pg_catalog.convert_from(
        pg_catalog.decode(replace(split_part(p_cursor,'.',1),E'\n',''),'base64'),
        'UTF8'
      );
      v_signature := split_part(p_cursor,'.',2);
      v_expected_signature := pg_catalog.encode(
        extensions.hmac(v_payload,v_backup.cursor_secret,'sha256'),
        'hex'
      );
      if length(v_signature)<>64 or v_signature<>v_expected_signature then
        raise exception 'Cursor de respaldo inválido';
      end if;
      v_cursor_backup := split_part(v_payload,'|',1)::uuid;
      v_cursor_section := split_part(v_payload,'|',2);
      v_last_id := split_part(v_payload,'|',3)::uuid;
      if v_cursor_backup<>p_backup_id or v_cursor_section<>v_section then
        raise exception 'Cursor de respaldo fuera de alcance';
      end if;
    exception when invalid_text_representation or data_exception then
      raise exception 'Cursor de respaldo inválido';
    end;
  end if;

  v_source := case v_section
    when 'business' then
      'select t.id row_id,to_jsonb(t)-''codigo_acceso'' row_data from public.negocios t where t.id=$1 and t.id>$2 and t.creado<=$3'
    when 'config' then
      'select t.negocio_id row_id,to_jsonb(t) row_data from public.vendify_config_operativa t where t.negocio_id=$1 and t.negocio_id>$2 and t.creado<=$3'
    when 'branches' then
      'select t.id row_id,to_jsonb(t) row_data from public.sucursales t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'cash_registers' then
      'select t.id row_id,to_jsonb(t) row_data from public.cajas t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'categories' then
      'select t.id row_id,to_jsonb(t)-''user_id'' row_data from public.categorias t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'products' then
      'select t.id row_id,to_jsonb(t)-''foto''-''user_id'' row_data from public.productos t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'branch_stock' then
      'select t.id row_id,to_jsonb(t) row_data from public.producto_stock_sucursal t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'suppliers' then
      'select t.id row_id,to_jsonb(t) row_data from public.proveedores t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'purchases' then
      'select t.id row_id,to_jsonb(t) row_data from public.compras t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'purchase_items' then
      'select t.id row_id,to_jsonb(t) row_data from public.compra_items t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'members' then
      'select t.id row_id,to_jsonb(t)-''pin_descuento_hash'' row_data from public.negocio_miembros t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'sales' then
      'select t.id row_id,to_jsonb(t) row_data from public.ventas t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'sale_items' then
      'select t.id row_id,to_jsonb(t) row_data from public.venta_items t join public.ventas v on v.id=t.venta_id and v.negocio_id=t.negocio_id where t.negocio_id=$1 and t.id>$2 and v.creado<=$3'
    when 'sale_payments' then
      'select t.id row_id,to_jsonb(t) row_data from public.venta_pagos t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'sale_returns' then
      'select t.id row_id,to_jsonb(t) row_data from public.venta_devoluciones t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'cash_sessions' then
      'select t.id row_id,to_jsonb(t) row_data from public.cajas_sesiones t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'cash_movements' then
      'select t.id row_id,to_jsonb(t) row_data from public.caja_movimientos t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    when 'inventory_movements' then
      'select t.id row_id,to_jsonb(t) row_data from public.movimientos t where t.negocio_id=$1 and t.id>$2 and t.creado<=$3'
    else null
  end;

  if v_source is null then raise exception 'Sección de respaldo inválida'; end if;

  execute
    'with candidates as (' || v_source || ' order by row_id limit $4 + 1), numbered as (' ||
    'select row_id,row_data,row_number() over(order by row_id) rn from candidates) ' ||
    'select coalesce(jsonb_agg(row_data order by row_id) filter(where rn<=$4),''[]''::jsonb),' ||
    '(array_agg(row_id order by row_id desc) filter(where rn<=$4))[1],' ||
    'coalesce(bool_or(rn>$4),false) from numbered'
  into v_rows,v_page_last_id,v_has_more
  using v_negocio_id,coalesce(v_last_id,'00000000-0000-0000-0000-000000000000'::uuid),
    v_backup.cutoff_at,p_limit;

  if v_has_more and v_page_last_id is not null then
    v_next_payload := p_backup_id::text || '|' || v_section || '|' || v_page_last_id::text;
    v_next_signature := pg_catalog.encode(
      extensions.hmac(v_next_payload,v_backup.cursor_secret,'sha256'),
      'hex'
    );
    v_next_cursor := replace(
      pg_catalog.encode(pg_catalog.convert_to(v_next_payload,'UTF8'),'base64'),
      E'\n',''
    ) || '.' || v_next_signature;
  end if;

  update public.operational_backups set updated_at=now() where id=v_backup.id;

  return jsonb_build_object(
    'format','vendify-operational-backup-page-v2',
    'schema_version',2,
    'backup_id',v_backup.id,
    'business_id',v_backup.negocio_id,
    'section',v_section,
    'cutoff_at',v_backup.cutoff_at,
    'rows',v_rows,
    'row_count',jsonb_array_length(v_rows),
    'has_more',v_has_more,
    'next_cursor',v_next_cursor
  );
end;
$$;

create or replace function public.estado_respaldo_operativo_v2(p_backup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_negocio_id uuid;
  v_backup public.operational_backups;
  v_parts jsonb;
begin
  if v_user_id is null then raise exception 'Sesión requerida'; end if;
  v_negocio_id := public.negocio_actual_id();
  if not public.tiene_rol_negocio(v_negocio_id,array['owner']) then
    raise exception 'Solo el propietario puede consultar un respaldo completo';
  end if;

  select * into v_backup
  from public.operational_backups b
  where b.id=p_backup_id and b.negocio_id=v_negocio_id;

  if not found then raise exception 'Respaldo inexistente o fuera de alcance'; end if;
  if v_backup.expires_at<=now() and v_backup.status not in ('failed','expired') then
    update public.operational_backups set status='expired',updated_at=now()
    where id=v_backup.id;
    v_backup.status := 'expired';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'section',p.section,'part_number',p.part_number,'row_count',p.row_count,
    'byte_count',p.byte_count,'sha256',p.sha256
  ) order by p.section,p.part_number),'[]'::jsonb)
  into v_parts
  from public.operational_backup_parts p
  where p.backup_id=v_backup.id and p.negocio_id=v_negocio_id;

  return jsonb_build_object(
    'format','vendify-operational-backup-v2',
    'schema_version',v_backup.schema_version,
    'backup_id',v_backup.id,
    'business_id',v_backup.negocio_id,
    'status',v_backup.status,
    'cutoff_at',v_backup.cutoff_at,
    'created_at',v_backup.created_at,
    'updated_at',v_backup.updated_at,
    'expires_at',v_backup.expires_at,
    'manifest',v_backup.manifest,
    'parts',v_parts,
    'error_code',v_backup.error_code
  );
end;
$$;

revoke execute on function public.iniciar_respaldo_operativo_v2() from public,anon;
grant execute on function public.iniciar_respaldo_operativo_v2() to authenticated,service_role;
revoke execute on function public.exportar_pagina_respaldo_operativo_v2(uuid,text,text,integer) from public,anon;
grant execute on function public.exportar_pagina_respaldo_operativo_v2(uuid,text,text,integer) to authenticated,service_role;
revoke execute on function public.estado_respaldo_operativo_v2(uuid) from public,anon;
grant execute on function public.estado_respaldo_operativo_v2(uuid) to authenticated,service_role;

do $$
begin
  if has_function_privilege('anon','public.iniciar_respaldo_operativo_v2()','execute')
    or has_function_privilege('anon','public.exportar_pagina_respaldo_operativo_v2(uuid,text,text,integer)','execute')
    or has_function_privilege('anon','public.estado_respaldo_operativo_v2(uuid)','execute')
    or not has_function_privilege('authenticated','public.iniciar_respaldo_operativo_v2()','execute')
    or not has_function_privilege('authenticated','public.exportar_pagina_respaldo_operativo_v2(uuid,text,text,integer)','execute')
    or not has_function_privilege('authenticated','public.estado_respaldo_operativo_v2(uuid)','execute')
  then
    raise exception 'Permisos inesperados en backup operativo v2';
  end if;
end;
$$;

commit;
