# Vendify v2.31.1 — Checklist QA de estabilización

Leyenda:

- `PASS`: probado realmente en el alcance indicado.
- `FAIL`: auditoría encontró un problema concreto.
- `NOT TESTED`: no hubo un entorno suficiente para demostrarlo.

## QA estático

- [x] PASS — `node --check app.js`
- [x] PASS — IDs HTML duplicados = 0
- [x] PASS — funciones JS declaradas duplicadas = 0
- [x] PASS — CSS parse sin errores
- [x] PASS — referencias de botones close/cancel revisadas
- [x] PASS — sin `service_role` en frontend
- [x] PASS — sin Access Token Mercado Pago privado
- [ ] FAIL — release autocontenida
- [ ] FAIL — Service Worker garantiza cold boot offline
- [ ] FAIL — único flujo de transferencias
- [ ] FAIL — unique barcode DB

## Ventas

- [ ] NOT TESTED — venta simple live
- [ ] NOT TESTED — pagos mixtos live
- [ ] NOT TESTED — doble tap Cobrar
- [ ] NOT TESTED — timeout después de commit
- [ ] NOT TESTED — caja cerrada durante venta
- [ ] NOT TESTED — dos cajeros última unidad
- [ ] PASS estático — `registrar_venta_v4` es la ruta actual
- [ ] FAIL — preflight no exige `registrar_venta_v4`

## Offline

- [ ] FAIL — persistencia venta/stock/caja no atómica
- [ ] FAIL — `localStorage` como cola transaccional final
- [ ] FAIL — no existe pantalla completa de pendientes/review
- [ ] FAIL — estados retryable/syncing incompletos
- [ ] FAIL — cold boot depende de CDN/cache navegador
- [ ] NOT TESTED — cierre navegador después de venta
- [ ] NOT TESTED — power loss
- [ ] NOT TESTED — reconexión repetida
- [ ] NOT TESTED — conflicto stock real
- [ ] NOT TESTED — usuario desactivado offline
- [ ] NOT TESTED — token expirado
- [ ] PASS estático — request_id se conserva en la cola

## Multi-tenant / seguridad

- [ ] NOT TESTED — Negocio A no puede SELECT B
- [ ] NOT TESTED — Negocio A no puede UPDATE B
- [ ] NOT TESTED — UUID B pasado a RPC desde A
- [ ] NOT TESTED — Cashier sin permiso
- [ ] NOT TESTED — Cashier con stock manual
- [ ] PASS estático — SECURITY DEFINER v2.31 con search_path
- [ ] FAIL — `validar_limite_plan_v1` acepta negocio arbitrario
- [ ] FAIL — error log no valida branch tenant
- [ ] FAIL — error log sin rate limit backend

## Stock

- [ ] NOT TESTED — stock=2, PC vende1/teléfono vende1
- [ ] NOT TESTED — stock=1, dos ventas concurrentes
- [ ] NOT TESTED — compra + venta concurrente
- [ ] NOT TESTED — conteo físico doble submit
- [ ] NOT TESTED — transferencia simultánea
- [ ] FAIL — barcode duplicate race sin constraint

## Caja

- [ ] NOT TESTED — apertura doble
- [ ] NOT TESTED — una sesión por caja
- [ ] NOT TESTED — cierre concurrente
- [ ] NOT TESTED — diferencia exacta
- [ ] NOT TESTED — caja offline/reconexión

## Compras

- [ ] NOT TESTED — recibir una vez
- [ ] NOT TESTED — doble click recibir
- [ ] NOT TESTED — dos dispositivos reciben misma compra
- [ ] NOT TESTED — stock/costo correctos

## Dashboard

- [ ] PASS estático — RPC y UI presentes
- [ ] FAIL — margen usa costo actual en vez de costo histórico
- [ ] NOT TESTED — 50k ventas
- [ ] NOT TESTED — EXPLAIN ANALYZE

## UX

- [ ] PASS estático — jerarquía Back Guard detectada
- [ ] NOT TESTED — gesto Android
- [ ] NOT TESTED — PWA Android
- [ ] NOT TESTED — iOS
- [ ] NOT TESTED — 360x640
- [ ] NOT TESTED — 390x844
- [ ] NOT TESTED — 430x932
- [ ] NOT TESTED — 1366x768
- [ ] NOT TESTED — 1920x1080
- [ ] FAIL deuda — CSS 1.318 `!important`
- [ ] FAIL deuda — 86 selectores repetidos

## Escala

- [ ] NOT TESTED — 5.000 productos
- [ ] NOT TESTED — 50.000 ventas
- [ ] NOT TESTED — 250.000 items
- [ ] FAIL arquitectura — backup monolítico jsonb
- [ ] NOT TESTED — Realtime con varios dispositivos

## Release

- [ ] FAIL — ZIP completo desde cero
- [ ] NOT TESTED — deploy staging limpio
- [ ] NOT TESTED — rollback
- [ ] NOT TESTED — migración contra copia de producción