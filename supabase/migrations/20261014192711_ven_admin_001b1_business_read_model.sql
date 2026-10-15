begin;

-- Global reads need to cross tenant RLS, hence SECURITY DEFINER. Authority is
-- checked against the live platform grant on every call, never a tenant role.
create function public.obtener_negocio_plataforma_v1(p_negocio_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_business jsonb;
begin
  if auth.uid() is null or public.es_admin_plataforma_v1() is not true then
    raise exception using errcode = '42501', message = 'Acceso denegado';
  end if;
  if p_negocio_id is null then
    raise exception using errcode = '22023', message = 'Negocio invalido';
  end if;
  if exists (select 1 from public.vendify_suscripciones s
    left join public.vendify_planes p on p.codigo = s.plan_codigo
    where s.negocio_id = p_negocio_id and p.codigo is null) then
    raise exception using errcode = '22023', message = 'Catalogo inconsistente';
  end if;
  select pg_catalog.jsonb_build_object(
    'id', n.id, 'nombre', n.nombre, 'creado',
    pg_catalog.to_char(n.creado at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'activo', n.activo,
    'suscripcion', case when s.negocio_id is null then null else
      pg_catalog.jsonb_build_object('plan_codigo', s.plan_codigo, 'plan_nombre', p.nombre,
        'estado', s.estado, 'trial_hasta', case when s.trial_hasta is null then null else
          pg_catalog.to_char(s.trial_hasta at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'limites', pg_catalog.jsonb_build_object('sucursales', p.max_sucursales,
          'usuarios', p.max_usuarios, 'productos', p.max_productos)) end,
    'uso', pg_catalog.jsonb_build_object(
      'usuarios', (select count(*) from public.negocio_miembros m where m.negocio_id = n.id and m.activo),
      'sucursales', (select count(*) from public.sucursales b where b.negocio_id = n.id and b.activa),
      'productos', (select count(*) from public.productos x where x.negocio_id = n.id)))
  into v_business from public.negocios n
  left join public.vendify_suscripciones s on s.negocio_id = n.id
  left join public.vendify_planes p on p.codigo = s.plan_codigo
  where n.id = p_negocio_id;
  return pg_catalog.jsonb_build_object('contract_version', 1, 'business', v_business);
end;
$$;

create function public.listar_negocios_plataforma_v2(
  p_search text default null, p_plan_codigo text default null,
  p_estado text default null, p_limit integer default 50, p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_search text; v_plan text; v_estado text; v_query jsonb;
  v_anchor_time timestamptz; v_anchor_id uuid;
  v_after_time timestamptz; v_after_id uuid;
  v_last_time timestamptz; v_last_id uuid;
  v_items jsonb := '[]'::jsonb; v_next jsonb := null;
  v_row record; v_count integer := 0; v_more boolean := false;
begin
  if auth.uid() is null or public.es_admin_plataforma_v1() is not true then
    raise exception using errcode = '42501', message = 'Acceso denegado';
  end if;
  v_search := nullif(pg_catalog.btrim(p_search), '');
  v_plan := pg_catalog.lower(pg_catalog.btrim(p_plan_codigo));
  v_estado := pg_catalog.lower(pg_catalog.btrim(p_estado));
  if p_limit is null or p_limit < 1 or p_limit > 100
    or pg_catalog.length(v_search) > 120
    or (v_plan is not null and (v_plan !~ '^[a-z][a-z0-9_-]{0,49}$'
      or not exists (select 1 from public.vendify_planes p where p.codigo = v_plan)))
    or (v_estado is not null and v_estado not in ('activo','trial','vencido','suspendido','legacy')) then
    raise exception using errcode = '22023', message = 'Filtros invalidos';
  end if;
  v_query := pg_catalog.jsonb_build_object('search', v_search, 'plan_codigo', v_plan, 'estado', v_estado);
  -- Positional token only, not a secret or signed authorization capability.
  if p_cursor is not null then
    begin
      if pg_catalog.jsonb_typeof(p_cursor) is distinct from 'object'
        or (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(p_cursor) k)
          is distinct from array['after','anchor','order','query','version']::text[]
        or p_cursor->'version' is distinct from '1'::jsonb
        or p_cursor->>'order' is distinct from 'creado_desc_id_desc'
        or p_cursor->'query' is distinct from v_query then
        raise exception 'invalid';
      end if;
      for v_row in select value from pg_catalog.jsonb_each(p_cursor)
        where key in ('anchor','after') loop
        if pg_catalog.jsonb_typeof(v_row.value) is distinct from 'object'
          or (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(v_row.value) k)
            is distinct from array['creado','id']::text[]
          or pg_catalog.jsonb_typeof(v_row.value->'creado') is distinct from 'string'
          or pg_catalog.jsonb_typeof(v_row.value->'id') is distinct from 'string'
          or (v_row.value->>'creado') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
          or (v_row.value->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'invalid';
        end if;
      end loop;
      v_anchor_time := (p_cursor#>>'{anchor,creado}')::timestamptz;
      v_anchor_id := (p_cursor#>>'{anchor,id}')::uuid;
      v_after_time := (p_cursor#>>'{after,creado}')::timestamptz;
      v_after_id := (p_cursor#>>'{after,id}')::uuid;
      if (v_after_time, v_after_id) > (v_anchor_time, v_anchor_id)
        or not pg_catalog.isfinite(v_anchor_time) or not pg_catalog.isfinite(v_after_time)
        or pg_catalog.to_char(v_anchor_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          is distinct from p_cursor#>>'{anchor,creado}'
        or pg_catalog.to_char(v_after_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          is distinct from p_cursor#>>'{after,creado}' then
        raise exception 'invalid';
      end if;
    exception when others then
      raise exception using errcode = '22023', message = 'Cursor invalido';
    end;
  end if;
  for v_row in
    select n.id, n.creado from public.negocios n
    left join public.vendify_suscripciones s on s.negocio_id = n.id
    where (v_search is null or pg_catalog.strpos(pg_catalog.lower(n.nombre), pg_catalog.lower(v_search)) > 0
      or n.id::text = pg_catalog.lower(v_search))
      and (v_plan is null or s.plan_codigo = v_plan)
      and (v_estado is null or s.estado = v_estado)
      and (v_anchor_time is null or (n.creado,n.id) <= (v_anchor_time,v_anchor_id))
      and (v_after_time is null or (n.creado,n.id) < (v_after_time,v_after_id))
    order by n.creado desc,n.id desc limit p_limit + 1
  loop
    if v_count = p_limit then v_more := true; exit; end if;
    if v_anchor_time is null then v_anchor_time := v_row.creado; v_anchor_id := v_row.id; end if;
    v_items := v_items || pg_catalog.jsonb_build_array(public.obtener_negocio_plataforma_v1(v_row.id)->'business');
    v_last_time := v_row.creado; v_last_id := v_row.id; v_count := v_count + 1;
  end loop;
  if v_more then
    v_next := pg_catalog.jsonb_build_object('version',1,'order','creado_desc_id_desc','query',v_query,
      'anchor',pg_catalog.jsonb_build_object('creado',pg_catalog.to_char(v_anchor_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',v_anchor_id),
      'after',pg_catalog.jsonb_build_object('creado',pg_catalog.to_char(v_last_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',v_last_id));
  end if;
  return pg_catalog.jsonb_build_object('contract_version',1,'items',v_items,'next_cursor',v_next);
end;
$$;

revoke all on function public.obtener_negocio_plataforma_v1(uuid) from public, anon, authenticated;
revoke all on function public.listar_negocios_plataforma_v2(text,text,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.obtener_negocio_plataforma_v1(uuid) to authenticated;
grant execute on function public.listar_negocios_plataforma_v2(text,text,text,integer,jsonb) to authenticated;

comment on function public.listar_negocios_plataforma_v2(text,text,text,integer,jsonb) is
  'VEN-ADMIN-001B1: authorized global read, keyset cursor is positional and untrusted; no business writes.';
comment on function public.obtener_negocio_plataforma_v1(uuid) is
  'VEN-ADMIN-001B1: explicit minimal global projection; absent subscription remains null.';
commit;
