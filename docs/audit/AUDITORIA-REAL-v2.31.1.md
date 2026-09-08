# Vendify v2.31.1 — Auditoría real previa a estabilización comercial

## Alcance auditado

Build actual inspeccionada:

- `index.html`
- `app.js`
- `styles.css`
- `sw.js`
- `00_preflight_v231.sql`
- `01_permisos_stock_empleados.sql`
- `02_v231_commercial_foundation.sql`
- `03_verify_v231.sql`

También se contrastaron migraciones históricas disponibles cuando una función actual depende de ellas.

Esta auditoría distingue **QA estático** de **QA real de entorno**. No se marca como PASS lo que no pudo ejecutarse contra Supabase real, dos tenants reales, dos dispositivos reales o una PWA instalada.

---

# A. Auditoría actual

## CRITICAL

### C-01 — La venta offline no se persiste como una operación atómica

**Archivos:** `app.js`  
**Zona:** aprox. líneas 4511–4526

La secuencia actual es:

1. guardar venta en la cola `localStorage`;
2. descontar stock en otro write;
3. actualizar caja en otro write.

Estos tres pasos no forman una transacción.

Ejemplo de fallo:

- stock cacheado = 5;
- se guarda una venta offline de 2 unidades;
- navegador/PWA se cierra justo después de guardar la cola;
- el descuento del snapshot de productos no llega a persistirse;
- al reabrir offline, la cola contiene la venta pero el catálogo puede volver a mostrar 5;
- el terminal puede vender unidades que ya estaban reservadas por una venta offline.

El backend puede detectar el conflicto al sincronizar, pero el comercio ya pudo haber entregado mercadería.

**Riesgo:** sobreventa offline / divergencia de inventario / operación comercial no determinística.

**Solución recomendada:**

Migrar la cola offline a **IndexedDB** y persistir en una única transacción:

- venta;
- líneas;
- reserva de stock local;
- estado de sincronización;
- caja offline relacionada.

Mejor todavía: no mutar una segunda copia del stock como autoridad. Calcular:

`stock_disponible_offline = snapshot_servidor - reservas_pendientes_locales`

Así una venta pendiente siempre reserva stock aunque la app se cierre entre pasos.

**Prioridad:** bloquear release comercial offline hasta corregir.

---

## HIGH

### H-01 — Release v2.31.1 no es autocontenida

`index.html` referencia:

- `supabase-config.js`
- `manifest.json`
- `icons/apple-touch-icon.png`
- `icons/icon-192.png`

pero esos archivos no están dentro del paquete incremental v2.31.1 auditado.

Esto funciona hoy únicamente si Vercel conserva archivos de releases anteriores.

**Riesgo:** un deployment limpio, rollback, entorno staging o nuevo cliente puede quedar roto.

Además, una copia histórica de `supabase-config.js` encontrada en el workspace apunta a un proyecto antiguo; por eso **no debe reutilizarse automáticamente**.

**Solución:**

Cada release final debe incluir y validar:

- `index.html`
- `app.js`
- `styles.css`
- `sw.js`
- `supabase-config.js` verificado
- `manifest.json`
- `vercel.json`
- todos los iconos/assets
- migraciones
- preflight
- verify
- rollback notes

Y un script debe fallar el build si falta cualquier referencia local.

---

### H-02 — El arranque offline queda mitigado, pero la dependencia de CDN persiste

**Archivo:** `sw.js`, líneas 3–8 y 41–43.

La versión inicial solo cacheaba:

- `/`
- `index.html`
- `app.js`
- `styles.css`

Pero el HTML depende de Supabase JS desde CDN:

`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/...`

y también carga ZXing desde CDN.

El shell ahora fija y cachea Supabase JS y ZXing durante la instalación. Esto permite reabrir la PWA sin red después de una instalación online exitosa. Aun así, la primera instalación requiere CDN y por eso no equivale a autohospedado.

**Riesgo residual:** una caída del CDN impide una primera instalación o actualización del shell; no afecta a una instalación cuyo cache se haya completado.

**Solución:**

Pendiente para la release comercial:

- self-host de la versión exacta de `supabase-js`;
- self-host de ZXing;
- incluirlas en el app-shell;
- las versiones ya están fijadas y cacheadas;
- eliminar completamente la dependencia de CDN para el arranque POS.

Google Fonts pueden tener fallback local/system.

---

### H-03 — Dependencia crítica `registrar_venta_v4` no forma parte del preflight v2.31

La venta online y la cola offline dependen de `registrar_venta_v4`.

Sin embargo:

- `00_preflight_v231.sql` no comprueba su existencia;
- `03_verify_v231.sql` tampoco comprueba la idempotencia de venta;
- la definición de v4 no está en el release incremental actual.

**Riesgo:** frontend aparentemente correcto + base incompleta = todas las ventas fallan en runtime.

**Solución:**

Agregar al preflight:

- `registrar_venta_v4(...)`;
- tabla/constraint de idempotencia;
- `registrar_venta_v3(...)`;
- caja profesional;
- restricciones de stock;
- RPCs realmente llamadas por el frontend.

Generar un **RPC contract manifest** automáticamente desde `app.js`.

---

### H-04 — Sigue existiendo un flujo de transferencia legacy activo

**Archivo:** `app.js`, aprox. líneas 11961–12072.

El sistema profesional ya usa:

- `transferir_stock_v2`

pero el módulo antiguo de Sucursales todavía conecta botones reales a:

- `listar_productos_sucursal_v1`
- `transferir_stock_v1`

La auditoría del workspace no encontró las definiciones SQL de esos RPC legacy.

**Riesgo:**

- botón que puede fallar en producción;
- dos comportamientos distintos para la misma operación;
- auditoría/permisos distintos;
- posibilidad de corregir v2 mientras el usuario sigue entrando por v1.

**Solución:**

No mantener dos transferencias.

El botón antiguo debe redirigir al flujo profesional de Inventario/Transferencias, y después retirar el código v1 una vez verificada la regresión.

---

### H-05 — `validar_limite_plan_v1` es SECURITY DEFINER y acepta cualquier negocio

**Archivo:** `02_v231_commercial_foundation.sql`, aprox. líneas 361–440.

La función:

- es `SECURITY DEFINER`;
- recibe `p_negocio_id`;
- está concedida a `authenticated`;
- no valida que `auth.uid()` pertenezca a ese negocio.

Un usuario autenticado puede usar UUIDs ajenos para convertirla en un pequeño oracle de plan/uso mediante resultados/excepciones.

**Riesgo:** IDOR informativo cross-tenant y contrato de seguridad innecesariamente expuesto.

**Solución:**

- quitar `GRANT EXECUTE` directo a authenticated si solo la usan triggers;
- o validar `es_miembro_negocio(p_negocio_id)`;
- separar helper interno de función pública.

---

### H-06 — No hay constraint único de código de barras por negocio

Las RPC realizan una comprobación `exists` antes de insertar, pero no se encontró un índice/constraint DB que garantice atomicidad.

Dos dispositivos pueden:

1. comprobar simultáneamente que el EAN no existe;
2. ambos insertar.

**Riesgo:** códigos duplicados y scanner ambiguo.

**Solución propuesta:**

Índice único parcial:

`unique (negocio_id, codigo_barras) where codigo_barras is not null and trim(codigo_barras) <> ''`

Antes debe ejecutarse un preflight que detecte duplicados históricos.

---

### H-07 — Cola offline incompleta para operación comercial

La implementación actual usa principalmente:

- `pending`
- `revision`

pero no materializa correctamente toda la máquina de estados deseada:

- `pending`
- `syncing`
- `synced`
- `review`
- `failed_retryable`

Todos los errores que no parecen “red” pasan directamente a `revision`.

Además, al marcar una venta `revision` el loop continúa procesando ventas posteriores.

**Riesgos:**

- clasificación incorrecta de 401/429/5xx;
- reordenamiento de una cola que debería ser FIFO;
- revisión manual sin pantalla dedicada;
- stock local reservado indefinidamente sin herramientas de conciliación.

**Solución:**

Crear módulo de **Ventas pendientes** con:

- request_id;
- fecha;
- líneas;
- total;
- estado;
- intentos;
- último error;
- botón reintentar;
- marcar/resolver con autorización;
- no borrar manualmente sin auditoría.

---

### H-08 — La autorización offline es manipulable localmente

La habilitación offline confía en información guardada en `localStorage`:

- contexto;
- permisos;
- prueba de caja abierta.

El backend vuelve a validar al sincronizar, lo cual es correcto, pero un usuario con acceso al dispositivo/DevTools puede alterar localStorage y obtener un ticket local que luego será rechazado.

**Riesgo comercial:** un empleado puede cobrar físicamente y entregar un ticket “pendiente” aun cuando el backend después lo rechace.

**Solución robusta:**

Emitir desde backend un **offline lease firmado y de corta duración** que incluya:

- user_id;
- negocio_id;
- sucursal_id;
- caja_id;
- rol/permisos offline;
- issued_at;
- expires_at;
- nonce.

La app puede verificarlo offline sin poder fabricarlo.

---

### H-09 — Backup completo en un solo `jsonb` no escala

**Archivo:** `02_v231_commercial_foundation.sql`, aprox. líneas 1868–2087.

Una única RPC agrega dentro de un JSON:

- todas las ventas;
- todos los items;
- todos los pagos;
- compras;
- productos;
- etc.

Con 50.000 ventas y 250.000 items este diseño puede superar tiempos, memoria o tamaño de respuesta.

**Solución:**

Para escala comercial:

- export job asíncrono;
- streaming/paginación;
- archivos por entidad;
- compresión;
- manifest con versión de esquema y checksums;
- Storage privado con URL firmada temporal.

---

### H-10 — Supabase JS no está fijado a una versión exacta

El HTML usa `@supabase/supabase-js@2`.

Eso permite cambios dentro de la rama mayor sin que Vendify cambie.

**Solución:** versión exacta y preferentemente vendorizada/self-hosted.

---

## MEDIUM

### M-01 — Dashboard calcula margen contra costo ACTUAL, no contra costo histórico

`venta_items` ya guarda `costo_unitario` al momento de vender.

Sin embargo `dashboard_propietario_v1` resta `productos.precio_compra` actual.

Si el costo cambia hoy, cambia retroactivamente la “ganancia” de ventas pasadas.

Está etiquetado como estimado, pero existe una fuente histórica mejor.

**Solución:**

Usar `venta_items.costo_unitario`.

Para ventas antiguas donde el costo histórico no fue registrado, mostrar cobertura/calidad del dato en lugar de inventarla.

---

### M-02 — Logging de errores sin rate limit backend

`registrar_error_cliente_v1` puede ser invocado repetidamente por cualquier miembro autenticado.

El frontend tiene throttle, pero un cliente malicioso puede ignorarlo.

Agregar límite por usuario/negocio/ventana.

También validar que `branch_id` del contexto pertenezca al mismo negocio antes de persistirlo.

---

### M-03 — `negocio_actual_id()` no modela un usuario con varios negocios

El helper histórico selecciona la primera membresía activa según rol/fecha.

Esto sirve mientras cada usuario tenga un solo negocio, pero dificulta:

- dueños de dos comercios;
- consultores;
- contadores;
- usuarios multiempresa reales.

**Solución futura:**

hacer que los RPC de negocio acepten contexto explícito o mantener una selección activa server-side validada.

No cambiarlo masivamente en un hotfix: requiere migración por fases.

---

### M-04 — Deuda técnica de `app.js`

Medición actual:

- ~12.168 líneas
- ~404 KB
- ~303 `addEventListener`
- ~71 RPC únicos

No es un problema por sí mismo, pero aumenta el blast radius.

Hay funciones legacy sin referencias, por ejemplo:

- `registrarVentaV2`
- `ajustarStockV2`

**Plan:** modularización progresiva, manteniendo `app.js` como entrypoint estable.

---

### M-05 — Deuda técnica CSS elevada

Medición actual:

- ~10.945 líneas
- ~239 KB
- ~1.318 `!important`
- 86 selectores top-level repetidos
- varias generaciones de layout de productos coexistiendo

El CSS parsea correctamente, pero la especificidad acumulada hace más probable una regresión al agregar UI nueva.

**Solución:**

crear capas:

1. tokens
2. reset/base
3. components
4. modules
5. utilities
6. compatibility/legacy temporal

y retirar overrides antiguos solo con screenshots/regression tests.

---

### M-06 — Superficie XSS todavía grande

Se detectaron ~101 asignaciones `.innerHTML`.

Muchas usan `escapeHtml`, lo cual es positivo.

Aun así la cantidad obliga a una auditoría de sinks y a migrar gradualmente datos de usuario a:

- `textContent`;
- `createElement`;
- atributos con validación.

No afirmar vulnerabilidad en las 101; sí mantenerlo como superficie a revisar.

---

### M-07 — Importación CSV no ofrece diagnóstico por fila suficiente

Actualmente puede omitir filas duplicadas/vacías, pero el resultado principal es conteo de importados/omitidos.

Para clientes reales se necesita:

- preview;
- número de fila;
- motivo;
- validación antes de ejecutar;
- importación por lotes;
- reporte descargable.

---

### M-08 — Enforcement de planes incompleto

Los límites están protegidos principalmente por triggers `BEFORE INSERT`.

Revisar:

- reactivar usuario;
- reactivar sucursal;
- downgrade de plan con uso superior;
- trial expirado;
- qué funciones continúan disponibles al vencer.

Antes de billing real hay que definir una política comercial clara de grace period.

---

### M-09 — `sw.js` silencia un fallo durante `cache.addAll`

El `install` hace `.catch(() => null)` y después `skipWaiting()`.

Un asset faltante puede hacer fallar el precache, pero el nuevo SW igual se activa.

**Solución:** cachear de manera controlada, registrar resultado, y no promover una versión cuyo shell crítico no esté completo.

---

## LOW

### L-01 — Iconografía todavía mezclada

Quedan símbolos/emoji en varias áreas:

- eliminar;
- movimientos;
- acciones de caja;
- algunos títulos.

No rompe la app, pero para una imagen comercial consistente conviene terminar la migración al sprite SVG.

### L-02 — Claves legacy `kiosco_*`

Persisten nombres históricos de localStorage.

No es necesario cambiarlas de inmediato porque rompería preferencias existentes. Documentarlas y migrarlas solo si aporta valor.

### L-03 — SELECT directos desde frontend

La auditoría detectó solo dos `.from(...)` activos:

- `producto_stock_sucursal`
- `ventas`

Son SELECT y dependen de RLS, no DML directo.

No es una vulnerabilidad demostrada, pero para reducir superficie contractual puede evaluarse moverlos a RPC específicas.

---

# Hallazgos positivos

## QA estático ejecutado

- `node --check app.js`: **PASS**
- IDs HTML duplicados: **0**
- funciones JS declaradas duplicadas: **0**
- errores de parseo CSS: **0**
- botones con IDs `close/cerrar/cancel/salir` sin referencia JS: **0 detectados**
- DML directo de productos/categorías desde frontend: **0**
- `.from()` directos detectados: **2**, ambos SELECT
- `service_role` en frontend: **no detectado**
- Access Token de Mercado Pago hardcodeado: **no detectado**
- todas las funciones `SECURITY DEFINER` auditadas en las migraciones v2.30.1.4/v2.31 contienen `SET search_path`
- `registrar_venta_v4` es utilizado por venta online y sync offline
- el stock online usa backend como autoridad
- idempotencia está integrada en el flujo del frontend
- el Back Guard actual prioriza overlays antes de preguntar salida
- RLS de ventas históricas disponible en la migración Security Hardening

---

# B. Plan de corrección por fases

## Fase 0 — Freeze de features

No agregar Mercado Pago ni nuevas funciones hasta cerrar Critical/High.

Objetivo: convertir v2.31.1 en una baseline estable.

## Fase 1 — v2.31.2 Data Integrity / Offline Core

1. IndexedDB para cola offline.
2. reservas de stock derivadas de la cola.
3. máquina de estados completa.
4. pantalla Ventas pendientes.
5. offline lease firmado.
6. FIFO real y clasificación retryable/review.
7. reconciliación stock/caja al sincronizar.
8. preflight de `registrar_venta_v4`.

## Fase 2 — v2.31.3 Security / Contracts

1. cerrar `validar_limite_plan_v1`.
2. validar branch del error log.
3. rate limit logs.
4. unique barcode por tenant.
5. RPC contract manifest.
6. test tenant A/B.
7. test matrix ANON/member/roles.
8. revisar Edge Functions de empleados.

## Fase 3 — v2.31.4 Frontend Consolidation

1. eliminar/redirect transferencia v1.
2. retirar dead code.
3. inventario de listeners.
4. modularización progresiva.
5. empezar consolidación CSS.
6. terminar SVG.

## Fase 4 — v2.31.5 PWA / Packaging

1. release autocontenida.
2. pin/self-host Supabase JS.
3. self-host ZXing.
4. app-shell completo.
5. storage persistence.
6. staging deploy desde cero.
7. tests Android/PWA/iOS.

## Fase 5 — v2.31.6 Scale / Commercial QA

1. dataset 5k productos.
2. 50k ventas / 250k items.
3. EXPLAIN dashboard.
4. backup async.
5. historial paginado.
6. jornada comercial completa.
7. soak test multi-dispositivo.

Solo después: Mercado Pago.

---

# C. Archivos que tocaría

Primera fase correctiva:

- `index.html`
- `app.js`
- `styles.css`
- `sw.js`
- `supabase-config.js`
- `manifest.json`
- `vercel.json`
- `icons/*`

Nuevos módulos internos, manteniendo `app.js` como entrypoint:

- `modules/offline-db.js`
- `modules/offline-sales.js`
- `modules/navigation.js`

Si se decide mantener un solo JS por ahora, estas piezas pueden encapsularse dentro de `app.js` primero y extraerse después.

SQL propuesto:

- `00_preflight_v2312.sql`
- `01_v2312_integrity_security.sql`
- `02_verify_v2312.sql`
- `03_rollback_notes.txt`

No ejecutar SQL de corrección sin preflight.

---

# D. Riesgos de regresión

## Muy altos

- cola offline;
- venta/caja;
- cambio de Service Worker;
- stock local;
- navegación Atrás;
- migración de barcode unique.

## Altos

- transferencia;
- permisos;
- RLS/RPC;
- modularización de app.js.

## Medios

- dashboard;
- import CSV;
- packaging;
- CSS.

Regla: cada fase debe ser pequeña y desplegable por separado.

---

# E. Matriz de pruebas

| Área | Estado actual |
|---|---|
| Sintaxis JS | PASS |
| IDs HTML | PASS |
| Parse CSS | PASS |
| Funciones JS duplicadas | PASS |
| Assets autocontenidos | FAIL |
| Runtime navegador real | NOT TESTED |
| Android Chrome | NOT TESTED |
| Android PWA | NOT TESTED |
| iOS Safari/PWA | NOT TESTED |
| Tenant A/B real | NOT TESTED |
| IDOR UUID real | NOT TESTED |
| RLS live | NOT TESTED |
| Concurrencia stock live | NOT TESTED |
| Doble submit live | NOT TESTED |
| Caja concurrente live | NOT TESTED |
| Venta offline persistencia atómica | FAIL por diseño actual |
| Sync offline idempotente | PASS estático / NOT TESTED live |
| Offline cold boot garantizado | FAIL |
| Back navigation | PASS estático / NOT TESTED móvil |
| Transferencia profesional única | FAIL |
| Barcode unique DB | FAIL |
| SECURITY DEFINER search_path v2.31 | PASS |
| `validar_limite_plan_v1` tenant check | FAIL |
| Backup a escala | FAIL arquitectura |
| Dashboard margen histórico | FAIL precisión |
| Secrets privados en frontend | PASS estático |
| Mercado Pago real | NOT IMPLEMENTED / NOT TESTED |

---

# Checklist de jornada real pendiente

Preparar dos tenants reales y dos dispositivos.

1. abrir caja $50.000;
2. compra +24;
3. venta 3 efectivo;
4. venta 2 transferencia;
5. segundo cajero venta 4;
6. merma -1;
7. transferencia 5;
8. devolución 1;
9. desconectar terminal;
10. dos ventas offline;
11. modificar stock desde otro dispositivo;
12. reconectar;
13. resolver conflicto;
14. cerrar caja;
15. comprobar ecuación de stock;
16. comprobar ecuación de caja;
17. revisar audit_log;
18. confirmar 0 registros del otro tenant.

---

# Conclusión

Vendify ya tiene una base funcional considerable, pero **v2.31.1 todavía no debería etiquetarse como release comercial final**.

La prioridad técnica inmediata no es agregar otra feature. Es eliminar los riesgos que pueden hacer que un comercio pierda confianza:

1. atomicidad offline;
2. release autocontenida;
3. seguridad cross-tenant contractual;
4. un solo flujo profesional por operación;
5. constraints DB;
6. pruebas reales de concurrencia/dispositivos;
7. PWA offline determinista.

Una vez que esas capas estén cerradas, la integración de Mercado Pago tendrá una base mucho más segura.
