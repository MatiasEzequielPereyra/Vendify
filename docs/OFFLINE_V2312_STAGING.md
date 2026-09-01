# Vendify v2.31.2 — Offline staging

La integración IndexedDB se prueba primero en una release aislada. Los archivos raíz de producción continúan representando la baseline v2.31.1.

## Build

```bash
npm run qa:staging:v2312
```

La salida queda en:

```text
dist-staging-v2312/
```

El build agrega `vendify-offline-v2312.js` antes de `app.js` sin modificar los archivos raíz.

## Feature flag

Por defecto el runtime informa modo `legacy` y no reemplaza ningún flujo del POS.

Para habilitar el motor v2.31.2 solamente en el navegador de staging:

```text
?offlineEngine=v2312
```

Ejemplo local:

```text
http://localhost:4173/?offlineEngine=v2312
```

La query tiene prioridad sobre el valor persistido. `?offlineEngine=legacy` fuerza el fallback legacy.

Desde DevTools también se puede preparar el navegador para el siguiente reload:

```js
window.VendifyOfflineV2312.enableForThisBrowser();
location.reload();
```

Para volver al modo legacy:

```js
window.VendifyOfflineV2312.disableForThisBrowser();
location.reload();
```

## Diagnóstico

```js
await window.VendifyOfflineV2312.diagnostics();
```

Devuelve versión, modo activo, estado de IndexedDB, error de inicialización y conteo de ventas por estado.

## Alcance actual

En este incremento el bundle y el feature flag están integrados al build de staging, pero el botón **Cobrar** todavía utiliza el motor v2.31.1. El siguiente incremento conectará el flujo de venta a IndexedDB después de validar snapshots de stock y compatibilidad de caja.

No desplegar `dist-staging-v2312/` sobre producción todavía.
