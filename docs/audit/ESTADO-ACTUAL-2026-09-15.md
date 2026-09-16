# Vendify — Estado técnico actual

Fecha de corte: 2026-09-15

Rama: `refactor/modular-runtime`

Commit base: `c3b5114d25fb96c7578f8e40fb90d392383e1880`

## Objetivo

Este documento reconcilia la auditoría histórica de v2.31.1 con el repositorio actual. Describe evidencia disponible; no reemplaza las pruebas live pendientes.

## Hallazgos históricos resueltos

| Hallazgo original | Estado actual | Evidencia principal |
|---|---|---|
| C-01 persistencia offline no atómica | RESUELTO EN CÓDIGO | `src/offline/indexeddb-store.ts`, transacción conjunta de cola y snapshots |
| H-01 release no autocontenida | RESUELTO EN BUILD | `scripts/build-release.mjs` y `scripts/verify-release.mjs` |
| H-03 falta contrato de venta v4 | RESUELTO | migración `20260907000400_sales_runtime_contract.sql` y contrato RPC |
| H-04 transferencia legacy v1 activa | RESUELTO | controladores tipados usan `transferir_stock_v2`; el verificador rechaza v1 |
| H-05 helper de límite expuesto | RESUELTO | `20260904000100_tenant_plan_limit_hardening.sql` |
| H-06 barcode sin constraint | RESUELTO | `20260907000200_product_barcode_uniqueness.sql` |
| H-07 estados/pantalla offline incompletos | RESUELTO EN CÓDIGO | máquina de estados, sync FIFO y `pending-sales-ui.ts` |
| M-01 margen con costo actual | RESUELTO | `20260907000300_dashboard_historical_margin.sql` |
| M-02 log sin control backend | RESUELTO | `20260907000100_error_log_hardening.sql` |
| M-04 monolito JS | AVANCE SUSTANCIAL | `app.js` pasó de unas 12.168 a 4.660 líneas |
| M-05 CSS monolítico | AVANCE ESTRUCTURAL | loader de 15 líneas y 10 hojas modulares |

`RESUELTO EN CÓDIGO` significa que existe implementación y cobertura automatizada; el comportamiento completo sigue sujeto al gate live cuando interviene Supabase o un navegador real.

## Riesgos vigentes que bloquean el lanzamiento general

### 1. Evidencia live ausente

Los harness de tenant, atomicidad y concurrencia están versionados, pero el entorno local conserva placeholders para el endpoint y la clave de staging y no tiene configuradas las variables de ventas concurrentes. Falta ejecutar las pruebas contra un staging descartable con dos tenants y sesiones independientes.

La prueba manual de dos cajas distintas dentro del mismo negocio ya confirmó que Realtime actualiza el stock después de la primera venta y bloquea la venta posterior del producto agotado. Aún falta el harness de carrera simultánea para demostrar el lock transaccional del backend.

### 2. Baseline de base de datos incompleta

Las migraciones versionadas comienzan con un preflight que exige tablas y funciones pre-v2.31. Ya se capturaron columnas, constraints, índices, triggers, políticas y grants vigentes de las seis tablas cuya definición no estaba en Git. Antes de reconstruir staging falta ensamblar esas fuentes en una baseline SQL con orden de dependencias y validarla en un proyecto descartable.

### 3. Autorización offline

La cola local valida contexto, payload, stock e idempotencia, pero todavía no usa un lease criptográficamente firmado y emitido por backend. Un dispositivo bajo control hostil puede fabricar autorización local; el backend la rechazará al sincronizar después de que el comercio pudo entregar mercadería.

### 4. Primera carga dependiente de CDN

Supabase JS `2.116.0` y ZXing `0.2.1` están fijados y precacheados, pero aún se obtienen desde jsDelivr. Una primera instalación depende del tercero.

### 5. Backup y escala

El respaldo operativo agrega el negocio en un único `jsonb`. Falta exportación asíncrona/paginada, almacenamiento privado, checksum y una restauración ensayada. También faltan pruebas de 5.000 productos, 50.000 ventas y 250.000 items.

### 6. Deuda de interfaz

La modularización redujo el tamaño de los entrypoints, pero permanecen 1.318 usos de `!important` y 98 referencias a `.innerHTML` entre legacy y módulos. No prueban un defecto por sí mismas; aumentan el costo de regresión visual y la superficie a auditar.

## Alcance verificado automáticamente

- contratos RPC y cobertura de fuentes;
- secretos y grants críticos;
- TypeScript y lint;
- tests unitarios de auth, equipo, productos, inventario, compras, caja, ventas, dashboard, plataforma y offline;
- builds release, staging y runtime modular;
- composición HTML/CSS y detección de código legacy retirado.

La ejecución completa de este relevamiento pasó `npm.cmd run ci` con 200 tests unitarios y todos los verificadores de release, staging y runtime modular.

## Próxima acción

Completar el punto 2 de `PLAN-ESTABILIZACION.md` construyendo la baseline SQL previa a v2.31 y el informe de resultados live. El contrato automatizado ya impide ocultar esa dependencia.
