# Matriz PWA de aceptación

Esta matriz separa controles reproducibles del artefacto y comprobaciones que dependen de un dispositivo físico. El reporte automatizado se genera con `npm run qa:pwa:matrix` en `qa-output/pwa-matrix/automated.json`.

## Controles automatizados

| Área | Evidencia | Criterio |
|---|---|---|
| Manifest | `manifest.json`, íconos y colores | Instalable en modo `standalone`, íconos 192/512 accesibles |
| Service Worker | instalación, activación y limpieza | El shell se activa completo y elimina caches anteriores |
| Arranque offline | fallback de navegación y shell cacheado | `index.html` puede responder sin red después de una instalación exitosa |
| Dependencias críticas | versiones fijadas en el shell | Supabase y ZXing no cambian sin una release |
| Seguridad | análisis del artefacto | No contiene `service_role` ni credenciales administrativas |
| Builds | release estable y runtime modular | La misma matriz debe pasar sobre raíz, `dist/` y `dist-refactor-modular/` |

## Dispositivos físicos

Cada celda requiere fecha, versión del sistema, navegador, dispositivo, resultado y enlace o ruta de evidencia. Una emulación de viewport no reemplaza esta prueba.

| Flujo | Android Chrome | iPhone Safari/PWA | Tablet Android | Desktop Chrome/Edge |
|---|---|---|---|---|
| Instalar y abrir desde el ícono | PENDIENTE | PENDIENTE | PENDIENTE | AUTOMATIZADO + PENDIENTE INSTALACIÓN |
| Cerrar y reabrir sin red | PENDIENTE | PENDIENTE | PENDIENTE | AUTOMATIZADO |
| Login online y recuperación de sesión | PENDIENTE | PENDIENTE | PENDIENTE | AUTOMATIZADO |
| Venta online | PENDIENTE | PENDIENTE | PENDIENTE | AUTOMATIZADO |
| Venta offline y sincronización | PENDIENTE | PENDIENTE | PENDIENTE | AUTOMATIZADO |
| Atrás / adelante sin salir de la app | PENDIENTE | PENDIENTE | PENDIENTE | AUTOMATIZADO |
| Scanner con cámara | PENDIENTE | PENDIENTE | PENDIENTE | N/A |
| Impresión térmica 58 mm | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |
| Impresión térmica 80 mm | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |
| Actualización de versión con cola pendiente | PENDIENTE | PENDIENTE | PENDIENTE | AUTOMATIZADO |

## Protocolo físico

1. Instalar la PWA online y confirmar que abre en modo standalone.
2. Iniciar sesión, cargar catálogo y abrir caja.
3. Cortar toda conectividad, cerrar la aplicación y volver a abrirla desde el ícono.
4. Registrar una venta offline autorizada, forzar cierre y volver a abrir.
5. Recuperar conectividad y comprobar una sola venta remota, stock reconciliado y cola vacía.
6. Escanear un código válido, uno desconocido y cancelar el permiso de cámara.
7. Imprimir un ticket con nombre largo, descuento, varios pagos y devolución en 58 y 80 mm.
8. Con una venta pendiente, publicar una versión nueva; verificar que la actualización no pierda la cola y que el cambio de cache ocurra de forma atómica.

El gate `pwa-device-matrix` solo puede pasar a `pass` cuando las celdas físicas tienen evidencia. Los controles automatizados verdes permiten ejecutar esta última ronda sin ambigüedad, pero no prueban cámara, instalación del sistema operativo ni impresoras reales.
