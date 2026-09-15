# Vendify — Plan vigente de estabilización comercial

Actualizado: 2026-09-15

La fuente de verdad de estados es [`MATRIZ-QA-v2.31.1.md`](./MATRIZ-QA-v2.31.1.md). Cada etapa debe terminar con evidencia, CI verde y un commit reversible antes de avanzar.

## 1. Auditoría y matriz actuales — COMPLETADO

- separar la auditoría histórica del estado vigente;
- reclasificar hallazgos resueltos, pendientes y pendientes de prueba live;
- registrar el gate objetivo del piloto;
- no atribuir `PASS live` a verificaciones estáticas.

## 2. Gate técnico automatizado — SIGUIENTE

- convertir los requisitos vigentes en verificadores mantenibles;
- revisar el contrato de migraciones completo y su orden;
- asegurar que CI bloquee artefactos o contratos incompletos;
- preparar un informe de ejecución reproducible.

## 3. Staging limpio

- disponer de un proyecto Supabase no productivo;
- crear su esquema desde cero mediante migraciones versionadas;
- cargar fixtures mínimos, sin datos personales reales;
- ejecutar preflight, migraciones, verify y diagnósticos;
- ensayar rollback y reconstrucción.

## 4. Seguridad multiempresa live

- crear tenant A y tenant B;
- ejecutar aislamiento SELECT/UPDATE y UUID cruzados;
- cubrir anon, owner, admin, cashier y permisos personalizados;
- probar suspensión, revocación de permisos y expiración de sesión.

## 5. Concurrencia y consistencia live

- última unidad desde dos sesiones;
- doble submit y timeout posterior al commit;
- compra/venta, recepción y transferencia concurrentes;
- apertura/cierre de caja simultáneos;
- verificar ecuaciones finales de stock, ventas y caja.

## 6. Offline comercial

- implementar lease offline firmado y con vencimiento;
- definir si los descuentos offline seguirán bloqueados o tendrán autorización firmada;
- probar cierre abrupto, power loss, reintentos y conflictos;
- completar jornada real con conciliación de stock y caja.

## 7. PWA y dispositivos

- self-host de Supabase JS y ZXing;
- impedir activación de un shell incompleto;
- probar cold boot y actualización segura;
- validar Android, iOS, PC, scanner e impresión.

## 8. Recuperación, escala y observabilidad

- backup asíncrono y restauración probada;
- paginación de historiales y exportaciones;
- datasets de escala y `EXPLAIN ANALYZE`;
- métricas y alertas para ventas, sync y RPC fallidas;
- soak test multi-dispositivo.

## 9. Producto cobrable

- onboarding hasta la primera venta;
- trial, suscripciones, cobro y webhooks idempotentes;
- grace period, downgrade, suspensión y reactivación;
- centro de ayuda y soporte con diagnóstico seguro.

## 10. Expansión funcional

- clientes y cuenta corriente;
- pagos integrados;
- promociones y listas de precios;
- compras e inventario avanzados;
- reportes, auditoría visible y exportaciones programadas.

## 11. Piloto y lanzamiento

- operar entre dos y cinco comercios acompañados;
- medir activación, errores, sincronización y soporte;
- cerrar bloqueantes del piloto;
- ejecutar rollback y restauración finales;
- incorporar clientes gradualmente.

## Gate previo a pagos integrados

No se habilitan cobros integrados hasta obtener `PASS live` en:

- stock concurrente;
- idempotencia y timeout posterior al commit;
- caja concurrente;
- jornada offline y reconciliación;
- aislamiento multiempresa;
- staging reconstruido desde cero.
