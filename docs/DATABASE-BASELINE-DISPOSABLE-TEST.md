# Prueba descartable del baseline de base de datos

Este procedimiento valida el bootstrap recuperado sin tocar producción.

## Entorno local con Supabase CLI

1. Instalar e iniciar Docker Desktop o Podman.
2. Ejecutar `npm run prepare:database-local` para crear la migración local ignorada por Git.
3. Ejecutar `npx supabase start`.
4. Ejecutar `npx supabase db reset`. El baseline local usa fecha `20260830`, por lo que se aplica antes del preflight y de toda la cadena v2.31.
5. Ejecutar `supabase/baseline/validate_pre_v231_baseline.sql` contra la base local y conservar el JSON.

La migración `20260830_000_pre_v231_baseline.local.sql` es generada y no debe confirmarse en Git.

## Proyecto remoto descartable

1. Crear un proyecto Supabase vacío y descartable.
2. Ejecutar `npm run build:database-baseline` en el repositorio.
3. Abrir `supabase/baseline/vendify_pre_v231_baseline.sql` en el SQL Editor del proyecto descartable y ejecutarlo completo.
4. Ejecutar `supabase/baseline/validate_pre_v231_baseline.sql`. El resultado debe tener `ok: true` y las cuatro listas `missing_*` vacías.
5. Ejecutar las migraciones de `contracts/commercial-readiness.json` en el orden declarado.
6. Ejecutar otra vez `supabase/migrations/20260831_003_verify_v231.sql` y guardar la salida como evidencia.

Si una etapa falla, conservar el mensaje completo y no continuar con la siguiente. El baseline permanece en estado `ready_for_disposable_test` hasta que todas las etapas terminen correctamente en el proyecto descartable.
