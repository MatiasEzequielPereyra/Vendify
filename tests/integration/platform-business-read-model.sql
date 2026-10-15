-- Run ONLY after the source baseline/migration chain in a fresh disposable DB.
-- Fixtures commit only inside that disposable DB. RPC checks run READ ONLY.
begin;
insert into auth.users(id,email) select ('10000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
  'platform-fixture-' || i || '@example.invalid' from generate_series(1,8) i;
insert into public.negocios(id,nombre,creado) values
 ('20000000-0000-4000-8000-000000000001','A literal %_','2026-01-01T00:00:00.123456Z'),
 ('20000000-0000-4000-8000-000000000002','B fixture','2026-01-01T00:00:00.123456Z'),
 ('20000000-0000-4000-8000-000000000003','C fixture','2026-01-01T00:00:00.123455Z');
update public.vendify_suscripciones set plan_codigo='business',estado='suspendido'
 where negocio_id='20000000-0000-4000-8000-000000000001';
delete from public.vendify_suscripciones where negocio_id='20000000-0000-4000-8000-000000000003';
insert into public.negocio_miembros(negocio_id,user_id,rol,activo)
select '20000000-0000-4000-8000-000000000001',
 ('10000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
 (array['owner','admin','manager','cashier'])[i],true from generate_series(1,4) i;
insert into public.negocio_miembros(negocio_id,user_id,rol,activo) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','cashier',false);
insert into public.sucursales(negocio_id,nombre,activa) values
 ('20000000-0000-4000-8000-000000000001','active',true),
 ('20000000-0000-4000-8000-000000000001','inactive',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
insert into public.productos(negocio_id,user_id,nombre) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','fixture product');
insert into public.vendify_platform_admins(user_id) values
 ('10000000-0000-4000-8000-000000000007'),('10000000-0000-4000-8000-000000000008');
delete from public.vendify_platform_admins where user_id='10000000-0000-4000-8000-000000000008';

-- SET TRANSACTION READ ONLY must be first statement, so commit the fixtures in
-- this dedicated disposable database; the runner destroys the entire database.
commit;
begin read only;
set local role anon;
do $$ begin
 begin perform public.obtener_negocio_plataforma_v1('20000000-0000-4000-8000-000000000001');
   raise exception 'anon unexpectedly allowed'; exception when insufficient_privilege then null; end;
 begin perform public.listar_negocios_plataforma_v2();
   raise exception 'anon list unexpectedly allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin perform public.obtener_negocio_plataforma_v1(null);
   raise exception 'null identity unexpectedly allowed'; exception when insufficient_privilege then null; end;
end $$;
do $$ declare i integer; begin
 -- Owner/admin/manager/cashier, inactive member, ordinary user, revoked admin.
 foreach i in array array[1,2,3,4,5,6,8] loop
   perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-' || lpad(i::text,12,'0'),true);
   begin perform public.obtener_negocio_plataforma_v1('20000000-0000-4000-8000-000000000002');
     raise exception 'cross tenant access unexpectedly allowed'; exception when insufficient_privilege then null; end;
   -- Denial must precede invalid input checks and not reveal existence.
   begin perform public.listar_negocios_plataforma_v2(p_limit => 0);
     raise exception 'list unexpectedly allowed'; exception when insufficient_privilege then null; end;
 end loop;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000007',true);
do $$
declare a jsonb; b jsonb; c jsonb; bad jsonb; key text;
begin
 a := public.obtener_negocio_plataforma_v1('20000000-0000-4000-8000-000000000001');
 if a#>'{business,uso}' <> '{"usuarios":4,"sucursales":1,"productos":1}'::jsonb
   or a#>>'{business,suscripcion,estado}' <> 'suspendido'
   or a#>'{business,suscripcion,limites}' <> '{"usuarios":null,"sucursales":null,"productos":null}'::jsonb then
   raise exception 'projection/count mismatch: %',a;
 end if;
 if public.obtener_negocio_plataforma_v1('20000000-0000-4000-8000-000000000099')->'business' <> 'null'::jsonb then
   raise exception 'not found mismatch'; end if;
 if public.obtener_negocio_plataforma_v1('20000000-0000-4000-8000-000000000003')#>'{business,suscripcion}' <> 'null'::jsonb then
   raise exception 'absent subscription fabricated'; end if;
 a := public.listar_negocios_plataforma_v2(p_limit=>1);
 b := public.listar_negocios_plataforma_v2(p_limit=>1,p_cursor=>a->'next_cursor');
 c := public.listar_negocios_plataforma_v2(p_limit=>1,p_cursor=>b->'next_cursor');
 if a#>>'{items,0,id}' <> '20000000-0000-4000-8000-000000000002'
   or b#>>'{items,0,id}' <> '20000000-0000-4000-8000-000000000001'
   or c#>>'{items,0,id}' <> '20000000-0000-4000-8000-000000000003'
   or c->'next_cursor' <> 'null'::jsonb
   or a#>>'{next_cursor,anchor,creado}' <> '2026-01-01T00:00:00.123456Z' then
   raise exception 'keyset precision/order mismatch'; end if;
 if jsonb_array_length(public.listar_negocios_plataforma_v2(p_search=>'%_')->'items') <> 1 then
   raise exception 'wildcards treated as patterns'; end if;
 if public.listar_negocios_plataforma_v2(p_search=>'does-not-exist-fixture')->'items' <> '[]'::jsonb
   or public.listar_negocios_plataforma_v2(p_search=>'does-not-exist-fixture')->'next_cursor' <> 'null'::jsonb then
   raise exception 'empty listing mismatch'; end if;
 if jsonb_array_length(public.listar_negocios_plataforma_v2(p_search=>'20000000-0000-4000-8000-000000000003')->'items') <> 1 then
   raise exception 'exact id search failed'; end if;
 if jsonb_array_length(public.listar_negocios_plataforma_v2(p_plan_codigo=>' BUSINESS ',p_estado=>' SUSPENDIDO ')->'items') <> 1 then
   raise exception 'filters failed'; end if;
 foreach bad in array array['{}'::jsonb,'[]'::jsonb,'null'::jsonb,
   (a->'next_cursor') || '{"extra":true}'::jsonb,
   jsonb_set(a->'next_cursor','{after,id}','null'::jsonb),
   jsonb_set(a->'next_cursor','{after,creado}','"2026-01-02T24:00:00.123456Z"'::jsonb),
   jsonb_set(a->'next_cursor','{after,creado}','"2026-01-02T00:00:00.123456Z"'::jsonb),
   jsonb_set(a->'next_cursor','{after,creado}','"bad"'::jsonb)] loop
   begin perform public.listar_negocios_plataforma_v2(p_cursor=>bad);
     raise exception 'invalid cursor accepted'; exception when invalid_parameter_value then null; end;
 end loop;
 begin perform public.listar_negocios_plataforma_v2(p_search=>'different',p_cursor=>a->'next_cursor');
   raise exception 'unbound cursor'; exception when invalid_parameter_value then null; end;
 foreach key in array array['', 'unknown', 'bad%'] loop
   begin perform public.listar_negocios_plataforma_v2(p_plan_codigo=>key);
     raise exception 'invalid plan'; exception when invalid_parameter_value then null; end;
 end loop;
 begin perform public.listar_negocios_plataforma_v2(p_limit=>101);
   raise exception 'invalid limit'; exception when invalid_parameter_value then null; end;
 begin perform public.listar_negocios_plataforma_v2(p_limit=>null);
   raise exception 'null limit'; exception when invalid_parameter_value then null; end;
 begin perform public.listar_negocios_plataforma_v2(p_estado=>'unknown');
   raise exception 'invalid state'; exception when invalid_parameter_value then null; end;
 begin perform public.listar_negocios_plataforma_v2(p_search=>repeat('a',121));
   raise exception 'long search'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.vendify_suscripciones where negocio_id='20000000-0000-4000-8000-000000000003') then
   raise exception 'read created subscription'; end if;
 if has_function_privilege('anon','public.listar_negocios_plataforma_v2(text,text,text,integer,jsonb)','EXECUTE')
   or has_function_privilege('anon','public.obtener_negocio_plataforma_v1(uuid)','EXECUTE') then
   raise exception 'anon execute grant'; end if;
end $$;
rollback;
select 'platform-business-read-model SQL integration PASS' as result;
