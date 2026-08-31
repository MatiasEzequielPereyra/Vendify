# Vendify — Plan de estabilización recomendado

## Release v2.31.2 — Offline Integrity

Objetivo: que ninguna venta offline pueda quedar en un estado ambiguo.

- IndexedDB
- reservas de stock derivadas
- transacción local
- estados pending/syncing/retryable/review/synced
- pantalla Ventas pendientes
- reconciliation
- signed offline lease
- preflight idempotencia

## Release v2.31.3 — Security Contracts

- tenant tests
- cerrar `validar_limite_plan_v1`
- rate-limit logs
- validar branch de log
- unique barcode
- contrato de RPC
- auditoría Edge Functions

## Release v2.31.4 — Legacy Cleanup

- transferencias solo v2
- dead code
- inventario de event listeners
- modularización progresiva
- CSS consolidation

## Release v2.31.5 — PWA Production

- package autocontenido
- Supabase JS self-host/pinned
- ZXing self-host
- cache shell verificable
- storage persist
- staging desde cero
- Android/iOS QA

## Release v2.31.6 — Scale QA

- datasets grandes
- EXPLAIN
- backup async
- paginación
- soak test
- jornada real

## Gate para Mercado Pago

Mercado Pago se integra después de que:

- stock concurrente = PASS
- idempotencia live = PASS
- caja concurrente = PASS
- offline queue = PASS
- tenant isolation = PASS
- staging limpio = PASS