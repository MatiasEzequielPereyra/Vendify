# Vendify — Matriz QA vigente

Actualizada: 2026-09-15

Rama evaluada: `refactor/modular-runtime`

Baseline histórica de origen: v2.31.1

Este archivo conserva su nombre histórico para no romper referencias, pero refleja el estado actual. Una prueba automatizada demuestra el contrato del repositorio; una prueba live solo se marca `PASS` después de ejecutarla contra staging.

## Estados

- `PASS`: verificado en el alcance indicado.
- `PENDIENTE LIVE`: existe implementación o harness, pero falta evidencia contra staging.
- `PENDIENTE MANUAL`: requiere navegador, dispositivo o periférico real.
- `PENDIENTE`: falta implementación o una corrección comprobable.

## Resumen ejecutivo

| Gate | Estado | Evidencia / bloqueo |
|---|---|---|
| CI completa del repositorio | PASS | `npm.cmd run ci` pasó durante este relevamiento |
| Release autocontenida | PASS estático | el build copia y verifica todos los assets locales |
| Venta online atómica e idempotente | PASS estático / PENDIENTE LIVE | migraciones y harness disponibles; faltan credenciales de staging |
| Cola offline durable y FIFO | PASS automatizado / PENDIENTE MANUAL | IndexedDB, reservas, estados y pantalla implementados |
| Aislamiento multiempresa | PASS estático / PENDIENTE LIVE | diagnóstico y harness disponibles; falta entorno A/B |
| Concurrencia de stock y venta | PASS harness / PENDIENTE LIVE | el ejecutor requiere datos reales |
| PWA multiplataforma | PENDIENTE MANUAL | Android, iOS, instalación, actualización e impresión |
| Escala comercial | PENDIENTE | datasets grandes, paginación y backup asíncrono |

## Build y release

- [x] PASS — TypeScript, lint, unit tests y verificadores forman parte de `npm run ci`.
- [x] PASS — HTML y CSS modulares se validan en builds release, staging y refactor.
- [x] PASS — el release incluye HTML, JS, CSS, configuración, manifest, iconos y fragmentos.
- [x] PASS — referencias locales faltantes bloquean `verify:release`.
- [x] PASS — se comprueba el proyecto Supabase esperado y se rechaza el obsoleto.
- [ ] PENDIENTE LIVE — deployment limpio en staging.
- [ ] PENDIENTE LIVE — ensayo de rollback completo.
- [ ] PENDIENTE LIVE — migraciones contra una copia representativa de producción.

## Ventas y caja

- [x] PASS estático — `registrar_venta_v4` es la ruta cliente vigente.
- [x] PASS estático — contrato, grants, idempotencia por payload y orden de locks cubiertos.
- [x] PASS harness — rechazo de venta conserva stock y caja sin cambios.
- [x] PASS harness — concurrencia e idempotent retry tienen ejecutor de integración.
- [ ] PENDIENTE LIVE — venta simple y pagos mixtos.
- [ ] PENDIENTE LIVE — doble tap, timeout posterior al commit y reintento.
- [ ] PENDIENTE LIVE — dos cajeros compitiendo por la última unidad.
- [ ] PENDIENTE LIVE — apertura doble, cierre concurrente y diferencia exacta.
- [ ] PENDIENTE MANUAL — ticket e impresión en hardware objetivo.

## Offline

- [x] PASS automatizado — venta y snapshots se persisten mediante IndexedDB.
- [x] PASS automatizado — el alta valida stock y reserva dentro de una transacción local.
- [x] PASS automatizado — stock disponible deriva de snapshot menos reservas pendientes.
- [x] PASS automatizado — estados `pending`, `syncing`, `failed_retryable`, `review` y `synced`.
- [x] PASS automatizado — FIFO se detiene ante el primer error para preservar el orden.
- [x] PASS automatizado — panel de pendientes con detalle, error y reintento.
- [x] PASS automatizado — `request_id` se conserva hasta `registrar_venta_v4`.
- [ ] PENDIENTE — lease offline firmado y de corta duración emitido por backend.
- [ ] PENDIENTE — descuentos offline; la política actual los rechaza explícitamente.
- [ ] PENDIENTE MANUAL — cierre abrupto, power loss y recuperación de `syncing` interrumpido.
- [ ] PENDIENTE LIVE — reconexión repetida, conflicto real de stock y token expirado.
- [ ] PENDIENTE LIVE — empleado desactivado mientras el terminal continúa offline.

## Seguridad multiempresa

- [x] PASS estático — `validar_limite_plan_v1` dejó de estar expuesta al cliente.
- [x] PASS estático — log de errores valida membresía/sucursal y limita frecuencia en backend.
- [x] PASS estático — índice único parcial de código de barras por negocio.
- [x] PASS estático — grants de tablas críticas y funciones `SECURITY DEFINER` auditados.
- [x] PASS estático — RPC legacy de ventas v2/v3 cerradas al cliente.
- [x] PASS harness — matriz tenant A/B disponible.
- [ ] PENDIENTE LIVE — A no puede SELECT/UPDATE datos de B.
- [ ] PENDIENTE LIVE — UUID de B enviado por A a todas las RPC críticas.
- [ ] PENDIENTE LIVE — matriz anon/owner/admin/cashier y permisos personalizados.
- [ ] PENDIENTE LIVE — usuario suspendido y sesión vencida.

## Productos, inventario y compras

- [x] PASS estático — códigos de barras protegidos contra carrera por constraint de DB.
- [x] PASS estático — ajustes, conteos y transferencias usan servicios TypeScript.
- [x] PASS estático — transferencias activas usan exclusivamente `transferir_stock_v2`.
- [x] PASS automatizado — servicios de productos, inventario y compras cubiertos por tests.
- [ ] PENDIENTE LIVE — compra y venta simultáneas.
- [ ] PENDIENTE LIVE — doble recepción de compra.
- [ ] PENDIENTE LIVE — conteo físico y transferencia con doble submit/concurrencia.
- [ ] PENDIENTE — importación CSV con preview y diagnóstico descargable por fila.

## Dashboard y experiencia

- [x] PASS estático — margen usa costo histórico de `venta_items` cuando está disponible.
- [x] PASS automatizado — dashboard y navegación contextual tipada.
- [x] PASS manual local — navegación operativa validada por el usuario en desktop.
- [ ] PENDIENTE LIVE — dashboard con 50.000 ventas y `EXPLAIN ANALYZE`.
- [ ] PENDIENTE MANUAL — 360x640, 390x844, 430x932, 1366x768 y 1920x1080.
- [ ] PENDIENTE MANUAL — gesto Atrás en Android y navegación PWA en iOS.
- [ ] PENDIENTE — auditoría de accesibilidad completa con teclado y lector de pantalla.

## PWA y dependencias

- [x] PASS estático — Supabase JS y ZXing están fijados a versiones exactas.
- [x] PASS estático — Service Worker intenta precachear ambas dependencias.
- [x] PASS automatizado — una falla de `cache.addAll(SHELL)` impide ejecutar `skipWaiting()`.
- [ ] PENDIENTE — self-host de Supabase JS y ZXing para eliminar dependencia CDN inicial.
- [ ] PENDIENTE MANUAL — cold boot sin red después de instalación.
- [ ] PENDIENTE MANUAL — actualización de versión con caja/venta en curso.
- [ ] PENDIENTE MANUAL — cámara, scanner e impresora en dispositivos objetivo.

## Escala, recuperación y deuda técnica

- [ ] PENDIENTE — backup asíncrono, paginado, comprimido y con checksum.
- [ ] PENDIENTE — prueba documentada de restauración.
- [ ] PENDIENTE — historial y exportaciones paginados para datasets grandes.
- [ ] PENDIENTE — pruebas con 5.000 productos, 50.000 ventas y 250.000 items.
- [ ] PENDIENTE — soak test Realtime con varios dispositivos.
- [x] AVANCE — `app.js` bajó de unas 12.168 a 4.660 líneas mediante extracción modular.
- [x] AVANCE — `styles.css` es un cargador de 15 líneas y el CSS está separado en 10 archivos.
- [ ] PENDIENTE — reducir los 1.318 usos de `!important` sin regresión visual.
- [ ] PENDIENTE — revisar las 98 referencias a `.innerHTML` y reemplazar sinks de datos variables.

## Condiciones del gate de piloto

El gate se aprueba cuando:

1. staging se reconstruye desde cero y pasa preflight/verify;
2. tenant A/B, roles y RPC manipuladas pasan en vivo;
3. atomicidad y concurrencia de ventas pasan en vivo;
4. una jornada offline completa reconcilia venta, stock y caja;
5. Android, iOS, scanner e impresión tienen evidencia manual;
6. backup y rollback se restauran en un entorno descartable;
7. no quedan defectos Critical o High abiertos.

## Entorno requerido para continuar

Los harness live existen, pero `.env.tenant-tests` conserva placeholders para la URL y la clave del tenant test, y no contiene la configuración de concurrencia de ventas. La configuración y ejecución del staging corresponden al siguiente punto del plan; ningún resultado live se infiere desde tests estáticos.
