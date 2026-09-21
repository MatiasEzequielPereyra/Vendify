# Plan — contrato de lease para ventas offline

## Objetivo

Incorporar al motor offline v2.31.2 una autorización temporal con alcance de negocio, sucursal y caja. El cupo pertenece a la caja y cada venta conserva el usuario que la creó. El cliente debe rechazar leases vencidos, ajenos, mal formados o sin capacidad antes de encolar una venta. El backend seguirá siendo la autoridad que emite el lease y lo valida/consume al sincronizar.

Este trabajo sigue Strangler Fig: primero se construye y prueba el dominio TypeScript aislado; el bridge legacy se considera únicamente después de que esa capa pase todas sus validaciones.

## Restricciones

- No modificar `index.html`, `app.js`, `styles.css` ni `sw.js`.
- No agregar reglas comerciales a `src/legacy/` ni a bridges existentes.
- No habilitar el motor v2.31.2 por defecto en producción.
- No considerar seguro un token generado o validado solo por el navegador.
- No marcar `offline-signed-lease` como aprobado hasta que exista emisión y consumo autoritativo en Supabase y una prueba de integración local.
- Mantener request IDs, orden FIFO, reservas de stock e idempotencia actuales.

## Fase 1 — dominio TypeScript, sin bridge

1. Definir en `src/types/offline.ts` el contrato versionado del lease y su referencia durable desde una venta offline.
2. Crear `src/offline/offline-lease.ts` con validación de forma, alcance, ventana temporal y límites de ventas/importe.
3. Tratar timestamps y payloads externos como datos no confiables; no usar `any` ni assertions para omitir validación.
4. Añadir errores tipados que distingan lease ausente, vencido, fuera de alcance y agotado.
5. Incluir el identificador estable del lease en el fingerprint idempotente de cada venta.

## Fase 2 — persistencia IndexedDB, sin bridge

1. Versionar la base IndexedDB mediante upgrade compatible y agregar un store de leases por alcance.
2. Guardar el lease y la venta de forma que la cola nunca pueda referenciar silenciosamente una autorización inexistente.
3. Invalidar de forma local leases vencidos o de otro negocio/sucursal/caja.
4. Mantener migración compatible para ventas existentes; deben quedar en revisión explícita, no eliminarse.

## Fase 3 — transporte tipado

1. Definir puertos TypeScript para solicitar un lease autenticado y sincronizar una venta con su referencia de lease.
2. Validar toda respuesta RPC antes de persistirla.
3. Mantener los secretos exclusivamente en backend; el bundle solo recibe la capacidad pública necesaria para ese dispositivo/scope.
4. Clasificar rechazos de lease como revisión y fallas de red como reintentables.

## Fase 4 — tests antes de integración

Agregar tests unitarios que cubran:

- lease válido dentro de su scope y vigencia;
- vencimiento y fecha de emisión futura;
- negocio, sucursal o caja distintos, permitiendo otro usuario autorizado en la misma caja;
- payload incompleto o tipos inválidos;
- límite de cantidad e importe agotado;
- fingerprint distinto si cambia el lease;
- upgrade/persistencia IndexedDB y recuperación;
- venta histórica sin lease enviada a revisión;
- transporte que conserva request ID y lease sin exponer secretos.

Ejecutar, en este orden:

```bash
npm run typecheck
npm test
npm run qa:refactor:modular
```

Al tocar el bundle offline, ejecutar además:

```bash
npm run qa:staging:v2312
```

No crear ni modificar un bridge mientras cualquiera de estos comandos falle.

## Fase 5 — backend autoritativo (gate separado)

Después de aprobar el dominio TypeScript, diseñar una migración Supabase nueva que:

- emita leases impredecibles o firmados desde una sesión autenticada;
- compruebe membresía, permiso de venta, sucursal, caja y sesión de caja abierta;
- fije duración y límites máximos en servidor;
- almacene solo material seguro cuando corresponda;
- valide scope, vigencia, reutilización y capacidad dentro de la misma transacción de la venta;
- preserve la idempotencia de `registrar_venta_v4` y los locks de stock;
- revoque acceso a `public` y `anon` y conceda solo a `authenticated`/`service_role` según necesidad interna.

Esta fase requiere reset de Supabase local, integración Auth/RLS/RPC, concurrencia, `db lint` y actualización de contratos. No se implementará como validación exclusivamente cliente.

## Fase 6 — bridge mínimo, condicionado

Solo cuando las fases TypeScript y backend estén aprobadas:

1. Añadir una delegación mínima para que el POS legacy solicite/renueve el lease cuando está online.
2. Bloquear el cobro offline con un mensaje accionable cuando no haya lease válido.
3. No duplicar validaciones de dominio en el bridge.
4. Ejecutar regresión de navegador: venta online, corte de red, venta offline autorizada, lease vencido, reconexión, sincronización idempotente y rechazo por scope.

## Criterio de terminado

- Dominio, persistencia y transporte viven en `src/` y tienen tests unitarios.
- El bridge solo traduce y delega.
- Supabase emite y consume el lease con autoridad transaccional.
- Una venta no puede sincronizarse con lease vencido, ajeno, agotado o reutilizado fuera de contrato.
- Pasan `npm run typecheck`, `npm test`, `npm run qa:refactor:modular`, `npm run qa:staging:v2312` y `npm run ci`.
- Pasan integración local y `npx supabase db lint --local --level warning --fail-on error`.
- La regresión de navegador queda registrada.
- Solo entonces se actualiza `contracts/commercial-readiness.json` para retirar el bloqueo `offline-signed-lease`.

## Cierre de revisión 2026-09-21

El contrato incorpora reconciliación autoritativa al recuperar conexión. El navegador consulta el estado remoto, conserva el mayor consumo entre servidor e IndexedDB para no liberar reservas pendientes y elimina localmente leases revocados o vencidos. Un lease agotado solo se reemplaza cuando el dispositivo ya no tiene ventas sin sincronizar asociadas; la renovación revoca el anterior bajo lock y emite uno nuevo para la misma caja.
