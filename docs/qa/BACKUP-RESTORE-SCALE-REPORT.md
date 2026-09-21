# Evidencia local — backup y restore v2 a escala

Fecha: 2026-09-21
Entorno: Supabase CLI local descartable, PostgreSQL 17, rama `refactor/modular-runtime`

## Dataset restaurado

| Sección | Filas |
|---|---:|
| Productos | 5.000 |
| Ventas | 50.005 |
| Ítems de venta | 250.008 |
| Sucursales | 2 |
| Cajas | 2 |
| Total del artefacto | 305.243 |

Las cinco ventas y ocho ítems por encima del mínimo pertenecen a los fixtures previos de atomicidad y concurrencia.

## Resultado

- 322 fragmentos paginados y comprimidos, sin páginas mayores a 1.000 filas.
- 17.833.890 bytes comprimidos (aproximadamente 17 MiB).
- Hash raíz SHA-256: `6f3d6dcf7c8085c813cfc1b4734a5a961282607f9e172e463e98717b9dee8ce0`.
- Generación local del artefacto: 92.241 ms; pico RSS observado del worker: 97.787.904 bytes.
- Corrupción deliberada de un fragmento: restore rechazado por checksum en test unitario.
- Restauración: transacción completada, IDs conservados, columna generada `venta_items.ganancia` recalculada por PostgreSQL, conteos exactos y referencias venta/ítems verificadas.
- Autorizaciones offline anteriores: invalidadas antes de restaurar; deben emitirse nuevamente.
- Bucket `vendify-operational-backups`: privado; el acceso anónimo fue rechazado y una URL firmada de cinco minutos descargó el manifiesto esperado.

Comando reproducible:

```powershell
$env:VENDIFY_TEST_CONFIRM_LOCAL_RESET="RESET_LOCAL_SUPABASE_FOR_INTEGRATION"
npm run test:integration:local
```

Los detalles de cada ejecución se escriben en `qa-output/backup-restore-v2/`, fuera del control de versiones.
