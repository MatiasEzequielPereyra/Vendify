# Phase 7 — Typed Products Store y extracción completa del catálogo

**Estado:** completada el 17 de septiembre de 2026 en `refactor/modular-runtime`.

**Evidencia final:** store único con scope negocio/sucursal y protección contra cargas obsoletas;
cache versionado con migración legacy; catálogo, scanner, selector POS, CSV, Realtime y snapshots
offline delegados a TypeScript; arrays/setters legacy retirados; 221 tests unitarios, ESLint y
`npm run ci` completos. El preview modular cargó la autenticación y todos los bundles sin errores de
consola. El flujo autenticado concurrente de dos cajas y bloqueo de stock agotado ya había sido
validado manualmente por el usuario en esta rama.

## Resultado buscado

Completar Phase 7 haciendo que un store TypeScript sea la única fuente de verdad del catálogo activo en el frontend. `app.js` dejará de poseer o mutar los arrays `productos` y `categorias`; Products, Scanner, POS, Inventory, Purchases y Offline consumirán una API tipada y estable.

La extracción debe preservar comportamiento antes de introducir mejoras. No se modificarán los RPC autoritativos ni las reglas de stock del backend. El stock que llega del servidor se mantendrá separado conceptualmente de las reservas offline locales.

## Estado encontrado

Ya existen:

- `product-model.ts`, servicios RPC, controlador de productos y controlador de scanner en TypeScript;
- CRUD, catálogo base, filtros, grilla y gran parte del scanner delegados desde `app.js`;
- bridge público `VendifyProductsV232` y verificador de marcadores;
- captura de snapshots para IndexedDB y reservas offline por venta pendiente.

La migración no está completa porque:

- `app.js` todavía declara y reemplaza `let productos = []` y `let categorias = []`;
- el controlador recibe `getProducts/setProducts/getCategories/setCategories`, por lo que el monolito conserva la autoridad;
- Realtime y ajustes de stock mutan instancias de producto directamente;
- POS, Inventory, Purchases y Offline reciben callbacks que leen el array legacy;
- el selector de productos del POS, exportación CSV, restauración del carrito y persistencia offline del catálogo todavía viven en `app.js`;
- Scanner hace búsquedas lineales sobre un array externo;
- carga online/offline no tiene protección explícita contra respuestas obsoletas al cambiar de sucursal;
- `ProductRecord = Record<string, unknown>` atraviesa demasiado código y debilita los límites.

## Arquitectura objetivo

### Store único por scope

Crear `src/products/products-store.ts` con una API explícita:

- estado: `scope`, `status`, `revision`, `productsById`, orden estable, categorías, smart stock, timestamps y error normalizado;
- lecturas inmutables: `getSnapshot`, `list`, `getById`, `findByBarcode`, `search`, `listCategories`, `getSmartStock`;
- mutaciones controladas: `beginLoad`, `replaceCatalog`, `restoreCatalog`, `upsert`, `remove`, `clear`, `replaceCategories`, `replaceSmartStock`, `patchBranchStock`;
- suscripción: `subscribe(listener)` con unsubscribe;
- generación/request token para ignorar resultados de una sucursal anterior;
- índices por ID y código de barras normalizado;
- snapshots readonly para impedir mutaciones accidentales desde consumidores.

El store no hará RPC, DOM ni `localStorage`. Será dominio puro y testeable.

### Modelo estricto

Endurecer `src/products/product-model.ts`:

- separar DTO RPC no confiable de `Product` normalizado;
- validar ID, nombre, precios, stock, stock mínimo, barcode y campos opcionales;
- conservar aliases legacy únicamente en el adaptador de frontera;
- definir `ProductCatalogScope` con negocio y sucursal;
- modelar stock del servidor como el valor del catálogo; las reservas offline se calculan fuera del store.

### Orquestación y persistencia

- `products-service.ts` seguirá siendo el puerto RPC y devolverá DTOs validados.
- `products-controller.ts` pasará a depender del store, sin getters/setters de arrays.
- crear `products-offline-cache.ts` para serializar y validar snapshots de catálogo/categorías por negocio+sucursal; migrará el formato local anterior sin pérdida.
- el controlador hará commit al store solo si el scope/request token sigue vigente.
- la captura IndexedDB se disparará desde un snapshot confirmado del store, nunca desde un array mutable.

## Orden de implementación

### 1. Contratos y store puro

Archivos:

- modificar `src/products/product-model.ts`;
- crear `src/products/products-store.ts`;
- crear `tests/unit/products-store.test.mjs`;
- ampliar tests del modelo.

Casos obligatorios:

- reemplazo atómico del catálogo;
- orden estable y snapshots no mutables por consumidores;
- lookup por ID/barcode normalizado;
- barcode duplicado detectado sin corrupción de índice;
- upsert/delete/patch de stock incrementan revisión una sola vez;
- suscriptores reciben una notificación coherente y pueden desuscribirse;
- un resultado tardío de otra sucursal es descartado;
- clear de logout elimina scope y datos;
- búsqueda por nombre, marca, presentación, categoría y barcode.

Gate antes de seguir:

```bash
npm run typecheck
npm test
```

### 2. Cache offline del catálogo

Archivos:

- crear `src/products/products-offline-cache.ts`;
- crear `tests/unit/products-offline-cache.test.mjs`.

Responsabilidades:

- claves con usuario/negocio/sucursal cuando corresponda;
- envelope versionado con `savedAt`, scope y catálogo validado;
- restauración segura de snapshots legacy existentes;
- rechazo de JSON corrupto, scope ajeno y productos inválidos;
- categorías dentro del mismo snapshot coherente;
- ninguna escritura de credenciales o datos de otra empresa.

### 3. Controlador y carga/sincronización

Archivos:

- modificar `src/products/products-controller.ts`;
- modificar `src/products/products-service.ts` solo para endurecer DTOs y retornos;
- crear/ampliar tests del controlador sin depender del DOM cuando la regla sea de dominio.

Cambios:

- sustituir `getProducts/setProducts/getCategories/setCategories` por `store`;
- carga online con estado `loading/ready/error/offline` y protección contra carreras;
- fallback offline restaurado mediante el cache tipado;
- CRUD, importación, categorías, smart stock y Realtime actualizan el store mediante acciones;
- filtros y `renderGrid` leen selectores del store;
- evitar `render()` duplicado después de `loadProducts()` mediante una política única de suscripción/render;
- mover el ajuste manual residual de `app.js` al controlador de Inventory o Products según su dueño final.

### 4. Scanner totalmente conectado al store

Archivos:

- modificar `src/products/scanner-controller.ts`;
- ampliar `tests/unit/products-scanner.test.mjs` o crear el archivo si no existe.

Cambios:

- reemplazar `getProducts()` y búsquedas lineales por `getById/findByBarcode`;
- mantener perfiles adaptativos y flujo cámara intactos;
- actualizar stock confirmado mediante una acción del store o reload autoritativo;
- preservar registro de producto faltante, retorno al POS y permisos;
- probar scanner conocido, desconocido, barcode vacío/normalizado, confirmación física y fallo RPC.

### 5. Consumidores tipados y POS

Archivos previstos:

- `src/sales/pos-controller.ts`;
- `src/inventory/inventory-controller.ts`;
- `src/purchases/purchases-controller.ts`;
- `src/offline/compat-controller.ts`;
- `src/offline/stock-reservations.ts`;
- tests de cada consumidor afectado.

Cambios:

- inyectar un puerto readonly del store, no arrays ni setters;
- trasladar `renderVentaProductos` al dueño TypeScript del POS;
- restaurar carrito contra `store.getById` y stock actual;
- mover exportación CSV a una función TypeScript pura y testeada;
- Inventory/Purchases consumen snapshots readonly;
- Offline valida y descuenta stock local mediante IDs del store;
- añadir un adaptador puro que genere `StockSnapshot[]` desde el snapshot confirmado del catálogo;
- conservar la fórmula autoritativa: stock disponible offline = snapshot servidor − reservas locales no sincronizadas;
- no escribir el stock reservado dentro del store como si fuera stock de servidor.

### 6. Realtime y consistencia

Mover la reconciliación residual de `app.js` a una frontera TypeScript:

- eventos de `productos`: upsert/delete validados;
- eventos de `producto_stock_sucursal`: patch solo para el scope activo;
- ráfagas de Realtime coalescidas sin perder la última revisión;
- cambio de sucursal invalida cargas/eventos anteriores;
- logout ejecuta `store.clear()`;
- ventas, compras, transferencias y ajustes hacen reload/reconcile mediante una única operación del catálogo.

Probar eventos fuera de scope, delete, evento parcial, ráfaga y carrera load-vs-Realtime.

### 7. Bridge mínimo y eliminación legacy

Solo después de pasar typecheck y tests de las fases anteriores:

- ampliar `src/legacy/products-bridge.ts` para exponer una única instancia/factory del store y las operaciones estrictamente necesarias;
- cablear el store desde `src/main.ts`/composición modular;
- adaptar `app.js` para delegar sin reglas comerciales;
- eliminar `let productos`, `let categorias` y sus asignaciones/mutaciones;
- eliminar persistencia de productos/categorías, render del selector POS, export CSV y reconciliación de stock que ya tengan dueño TypeScript;
- reemplazar accesos residuales por métodos de bridge pequeños (`getById`, snapshot readonly o acción concreta), evitando recrear un service locator global;
- reforzar `scripts/verify-refactor-products.mjs` para fallar si reaparecen arrays globales, setters legacy, renderers o mutaciones directas.

La meta es retirar código, no dejar implementaciones comentadas ni duplicadas.

### 8. Verificación de integración

Ejecutar en cada corte significativo:

```bash
npm run typecheck
npm test
npm run lint
npm run qa:refactor:modular
npm run qa:staging:v2312
```

Antes del commit final:

```bash
npm run ci
```

Regresión de navegador obligatoria en `dist-refactor-modular`:

1. Login y selección/cambio de sucursal.
2. Carga del catálogo, búsqueda, filtros y orden.
3. Alta, edición y eliminación de producto.
4. Barcode duplicado y error backend visible.
5. Scanner manual y cámara para producto conocido/desconocido.
6. Apertura del POS, búsqueda, agregado, cambio de cantidad y venta online.
7. Realtime desde segunda caja y bloqueo de stock agotado.
8. Corte de red, restauración de catálogo, venta offline, reserva exacta y reconexión.
9. Sincronización offline e idempotencia sin doble descuento.
10. Ajuste/transferencia/compra que modifica stock y refresca todas las vistas.
11. Logout/login en otro negocio sin fuga de catálogo o cache.

## Riesgos principales y mitigación

### Carreras al cambiar de sucursal

Una respuesta vieja puede reemplazar el catálogo nuevo. El store exigirá scope y generation token en cada commit asíncrono.

### Mutación por consumidores legacy

Los arrays actuales comparten referencias. El store devolverá snapshots readonly y concentrará cambios en acciones explícitas.

### Doble descuento offline

El store conservará stock del servidor. `stock-reservations.ts` seguirá derivando disponibilidad con la cola; nunca se persistirá stock ya reservado como snapshot servidor.

### Carrito con producto actualizado/eliminado

El POS resolverá cada línea por ID y reconciliará nombre/precio/stock según las reglas actuales. Un producto eliminado o sin stock debe generar un estado explícito, no una excepción silenciosa.

### Realtime parcial o fuera de orden

Los payloads se validarán, se filtrarán por scope y podrán forzar reload cuando no contengan datos suficientes.

### Regresión del scanner

La cámara y sus heurísticas no se reescribirán a la vez que el estado. Primero se sustituye el puerto de catálogo y se mantienen los motores de detección existentes.

### Cache heredado

El parser aceptará una sola migración controlada del formato v2.31.1, la normalizará y reescribirá versionada. Datos corruptos o de scope incierto se rechazan.

### Tamaño del cambio

Aunque el objetivo es agresivo, se implementará en commits/cortes coherentes: store, cache/carga, consumidores, bridge/retiro. Cada corte debe quedar verde y no introducir una segunda autoridad temporal más allá del bridge mínimo.

## Criterios de Done de Phase 7

- Existe una única instancia tipada del Products Store para el scope activo.
- `app.js` no declara, asigna ni muta `productos` o `categorias`.
- Ningún controlador recibe setters de arrays de catálogo.
- Products, Scanner, POS, Inventory, Purchases y Offline consumen puertos tipados del store.
- Carga online, fallback offline, CRUD, importación y Realtime actualizan el mismo store.
- Grid/listado, selector POS, barcode y exportación leen selectores TypeScript.
- Offline genera snapshots desde stock confirmado y resta reservas sin doble descuento.
- Cambio de sucursal y logout invalidan correctamente estado y cache.
- Los verificadores impiden reintroducir la autoridad legacy.
- Hay tests de store, cache, scanner, Realtime, POS y reservas offline para caminos exitosos y fallas críticas.
- Pasan typecheck, tests, lint, QA modular, QA staging y CI completa.
- La regresión en navegador cubre POS y offline y queda documentada.
- `docs/MODULAR-RUNTIME-PLAN.md` marca Phase 7 como completada solo después de cumplir todos estos puntos.

## Fuera de alcance

- Rediseño visual del catálogo o scanner.
- Cambios de RPC, RLS o reglas de negocio del backend sin una falla comprobada.
- Reescritura de cámara/detección de barcode.
- Activación por defecto del motor offline experimental.
- Signed offline lease, salvo los puertos mínimos necesarios para no bloquear su implementación posterior.
