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

## Supabase staging aislado

El artefacto staging ya no copia `supabase-config.js` ni el CSP de Supabase productivo. Si no se definen credenciales staging, el build genera una configuración `static-validation-only` que usa un dominio `.invalid` y sirve únicamente para validaciones estáticas/CI. Esa salida no puede conectarse a producción y `npm run preview:staging:v2312` se niega a servirla como staging real.

Para un staging real se deben definir juntas las variables públicas del proyecto no productivo:

```powershell
$env:VENDIFY_STAGING_SUPABASE_URL="https://<staging-project-ref>.supabase.co"
$env:VENDIFY_STAGING_SUPABASE_ANON_KEY="<public-anon-jwt>"
npm run qa:staging:v2312
npm run preview:staging:v2312
```

La anon key debe ser un JWT con rol `anon` y su `ref` debe coincidir con el project ref de la URL. El project ref productivo `puhkmblnptntorwptvld` y cualquier clave `service_role` son rechazados.

Para exigir explícitamente un backend real desde el build:

```bash
node scripts/build-staging-v2312.mjs --require-backend
```

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
