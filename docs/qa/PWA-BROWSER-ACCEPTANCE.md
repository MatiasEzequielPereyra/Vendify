# Evidencia PWA en navegador real

Fecha: 2026-09-22

Comando:

```powershell
npm run qa:pwa:browser
```

La prueba usa Google Chrome con un perfil temporal limpio y el runtime modular con `offlineEngine=v2312`.

## Resultado

| Caso | Resultado | Evidencia |
|---|---|---|
| Instalación del Service Worker | PASS | estado `activated`, manifest accesible y cache `vendify-shell-v235-pinned-runtime` creado |
| Aviso de instalación | PASS | el evento muestra el banner, solicita instalación una vez, oculta el banner al resolver y recuerda el descarte |
| Actualización atómica | PASS | una versión de ensayo reemplazó el cache anterior después de `activate` |
| Estado durante actualización | PASS | `localStorage` e IndexedDB conservaron sus valores |
| Cierre completo del navegador | PASS | Chrome terminó y se inició un proceso nuevo con el mismo perfil temporal |
| Cold boot sin servidor | PASS | Vendify abrió desde Service Worker con el servidor HTTP apagado |
| Persistencia después del cold boot | PASS | IndexedDB, `localStorage`, controlador y cache siguieron disponibles |
| Viewport móvil 390×844 | PASS | shell renderizado y captura en `qa-output/pwa-matrix/cold-boot-offline-390x844.png` |

El perfil limpio no contiene sesión ni snapshot comercial. Por eso, tras cargar el shell sin servidor, Vendify muestra correctamente su pantalla recuperable “No pudimos iniciar Vendify”. Esta prueba demuestra instalación, actualización, persistencia y arranque del shell; una jornada de venta offline requiere una sesión y catálogo previamente cargados en un dispositivo de aceptación.

## Hardware detectado

- Android/ADB: no disponible.
- iPhone/iOS: no accesible desde este host Windows.
- Cámara: no detectada por Windows.
- Impresoras térmicas: ninguna instalada.

Los casos de cámara, instalación desde el sistema operativo, gesto Atrás y tickets de 58/80 mm continúan requiriendo los dispositivos físicos indicados en [PWA-DEVICE-MATRIX.md](./PWA-DEVICE-MATRIX.md).
