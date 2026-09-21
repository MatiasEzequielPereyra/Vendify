# Plan — backup y restauración a escala

## Objetivo

Reemplazar el respaldo monolítico `exportar_respaldo_operativo_v1()` por un flujo versionado, paginado y verificable que pueda exportar y restaurar un Negocio grande sin cargar todo el dataset en memoria ni ampliar permisos del navegador.

Este bloque cierra el gate `backup-restore-at-scale`. El RPC v1 permanece disponible durante la transición; se retira únicamente después de probar paridad y restauración sobre un proyecto Supabase descartable.

## Decisiones de diseño

- PostgreSQL sigue siendo la autoridad del alcance multiempresa y de los permisos.
- Solo el rol `owner` puede iniciar, consultar o descargar un respaldo completo.
- El navegador nunca recibe `service_role` ni escribe directamente en tablas críticas.
- La exportación usa un snapshot lógico identificado por `backup_id`, un corte temporal y cursores estables por sección.
- Cada página se ordena por una clave inmutable y usa keyset pagination; no se usa `offset` en tablas grandes.
- El artefacto final contiene un manifiesto versionado, conteos por sección, hashes SHA-256 por fragmento y un hash raíz.
- Los artefactos se guardan en un bucket privado con expiración y URL firmada corta.
- La restauración se ejecuta únicamente en un entorno descartable o mediante una operación administrativa separada con confirmación explícita. Nunca se restaura desde el browser POS.
- La restauración conserva IDs, relaciones y orden de dependencias, valida el Negocio destino y se detiene ante cualquier checksum, conteo o referencia inválida.

## Formato v2

El manifiesto `vendify-operational-backup-v2` incluye:

- `backup_id`, `business_id`, `created_at`, `cutoff_at` y versión de esquema;
- secciones y versión de contrato de cada sección;
- cantidad de filas, cantidad de páginas, bytes y SHA-256 por sección;
- hash raíz calculado sobre los hashes ordenados;
- estado `preparing | ready | failed | expired`;
- metadatos mínimos de aplicación, sin tokens, contraseñas ni secretos.

Secciones iniciales, en orden de restauración:

1. negocio y configuración;
2. sucursales y cajas;
3. categorías, productos y stock por sucursal;
4. proveedores, compras e ítems;
5. miembros sin credenciales de Auth;
6. ventas, ítems, pagos y devoluciones;
7. sesiones y movimientos de caja;
8. movimientos de inventario y auditoría operativa.

## Fase 1 — contratos y paginación autoritativa

Crear una migración nueva con:

- tabla privada `operational_backups` para estado, corte, manifiesto y expiración;
- tabla privada `operational_backup_parts` para partes, hashes y conteos;
- RPC `iniciar_respaldo_operativo_v2()`;
- RPC `exportar_pagina_respaldo_operativo_v2(backup_id, section, cursor, limit)`;
- RPC `estado_respaldo_operativo_v2(backup_id)`;
- validación de `auth.uid()`, negocio actual y rol owner en cada entrada;
- `SECURITY DEFINER SET search_path = ''`, grants mínimos y RLS sin acceso directo;
- límites de página entre 100 y 2.000 filas;
- cursores opacos validados por el backend;
- corte estable: cada consulta incluye `created_at <= cutoff_at` cuando exista esa columna y el manifiesto registra las excepciones.

Tests: anon, otro tenant, rol no owner, cursor alterado, límite inválido, orden estable, página final y dos respaldos concurrentes.

## Fase 2 — orquestador TypeScript

Crear en `src/commercial/backup/`:

- tipos y parsers de respuestas `unknown`;
- state machine del job;
- iterador paginado con reanudación;
- serialización NDJSON determinista;
- checksum incremental por parte y manifiesto;
- compresión mediante `CompressionStream` cuando esté disponible, con fallback explícito;
- adaptador de almacenamiento privado y URLs firmadas;
- progreso observable para UI.

El orquestador no contiene decisiones de permisos ni restauración de tablas.

## Fase 3 — worker y almacenamiento privado

La generación completa debe salir de la vida corta del request del navegador. Implementar una Edge Function o worker idempotente que:

- reclame un job pendiente con lock;
- procese páginas y reanude desde el último cursor persistido;
- suba partes al bucket privado;
- confirme hashes y conteos antes de marcar `ready`;
- registre error seguro y permita reintento;
- expire y elimine partes antiguas según retención configurada.

No se marca esta fase terminada con un loop largo ejecutado únicamente en el browser.

## Fase 4 — restaurador aislado

Crear una herramienta administrativa en `scripts/` que solo acepte Supabase local o un proyecto descartable confirmado:

1. descarga y verifica el manifiesto y todos los hashes;
2. crea un reporte previo de compatibilidad;
3. restaura en transacción por grupo de dependencias;
4. conserva IDs y repara secuencias si correspondiera;
5. ejecuta validaciones de FK, RLS, conteos y sumas de control;
6. corre los gates de ventas, stock, caja y tenant isolation;
7. genera un informe firmado por hashes de origen y destino.

La herramienta debe rechazar el project ref de producción y exigir una frase de confirmación específica.

Las autorizaciones offline firmadas son credenciales efímeras y no forman parte del artefacto. El restaurador invalida primero su uso y sus cuotas en el destino local; después de una recuperación deben emitirse leases nuevos desde el backend.

## Fase 5 — escala y recuperación

Dataset mínimo automatizado:

- 5.000 productos;
- 50.000 ventas;
- 250.000 ítems de venta;
- al menos 2 sucursales y 2 cajas;
- compras, caja e inventario relacionados.

Criterios:

- ninguna página supera el límite configurado;
- el proceso puede interrumpirse y continuar sin duplicar partes;
- hashes y conteos coinciden;
- una corrupción deliberada bloquea restore;
- el negocio restaurado pasa consultas críticas y reconciliación de totales;
- se registra tiempo, memoria máxima y tamaño comprimido.

## Integración de UI

La UI comercial muestra estado, progreso, fecha de expiración, tamaño, descarga y fallo accionable. No ofrece restauración dentro del POS. El bridge legacy, si resulta necesario, solo delega en el controlador TypeScript.

## Done

- Migraciones aplican desde cero y pasan `db lint`.
- Tests unitarios, integración local y dataset de escala pasan.
- El artefacto está cifrado en tránsito, privado en reposo y usa URL firmada corta.
- Un backup v2 se restaura en Supabase descartable y el informe queda en `qa-output/`.
- `npm run ci` pasa.
- `contracts/commercial-readiness.json` cambia a `pass_local` solo con evidencia reproducible.
- El RPC v1 queda marcado como compatibilidad hasta que todos sus consumidores migren.

## Estado verificado localmente

El 21 de septiembre de 2026 se completó el ciclo sobre Supabase local descartable con 5.000 productos, más de 50.000 ventas y más de 250.000 ítems. El worker exportó páginas comprimidas con SHA-256, el verificador rechazó corrupción deliberada y el restaurador reconstruyó el comercio en lotes, validó conteos y referencias críticas. La evidencia de cada ejecución queda en `qa-output/backup-restore-v2/`.
