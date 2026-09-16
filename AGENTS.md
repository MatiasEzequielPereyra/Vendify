# AGENTS.md — reglas de trabajo para Vendify

Este archivo rige todo el repositorio. Codex y cualquier agente de coding deben leerlo antes de modificar código, SQL, contratos, documentación o artefactos de release. Si una instrucción específica de la tarea contradice este archivo, se debe señalar la diferencia y aplicar primero la instrucción explícita del usuario sin debilitar seguridad, aislamiento multiempresa ni integridad de datos.

## 1. Proyecto y estrategia de modernización

Vendify es un POS/SaaS multiempresa y multisucursal para comercios minoristas. Administra autenticación, roles, catálogo, inventario por sucursal, compras, caja, ventas, sincronización en tiempo real y operación offline. La base funcional y contractual proviene de la release de producción `v2.31.1`.

La modernización sigue **Strangler Fig**:

- rodear el runtime estable con módulos tipados;
- extraer una responsabilidad acotada por vez;
- demostrar paridad antes de retirar la implementación anterior;
- mantener bridges pequeños mientras existan consumidores legacy;
- conservar los nombres públicos clásicos del release cuando corresponda;
- retirar código legacy únicamente cuando la ruta nueva esté conectada y verificada.

No se permite una reescritura total. La prioridad es preservar comportamiento observable, contratos RPC y seguridad; las mejoras funcionales se realizan después de alcanzar paridad y deben tratarse como cambios separados cuando aumenten el riesgo de regresión.

## 2. Stack soportado

- Node.js `22` (`.nvmrc`; `package.json` exige `>=22 <23`).
- npm como gestor de paquetes y ejecutor de scripts.
- TypeScript `5.8.3`, con `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters` y `useUnknownInCatchVariables`.
- Vite `6.x` para bundles y previews de migración.
- ESLint `9.x` para `src/`.
- Tests unitarios con `node:test` y `node:assert/strict`.
- Supabase: PostgreSQL, Auth, PostgREST/RPC, Realtime y RLS.
- IndexedDB para la cola durable y snapshots del motor offline nuevo.
- Service Worker/PWA mediante `sw.js`.

No cambiar versiones, package manager, configuración del compilador o pipeline de build como efecto colateral de una tarea funcional.

## 3. Fronteras y estructura del repositorio

### Runtime de producción protegido

La frontera clásica está compuesta por:

- `index.html`
- `app.js`
- `styles.css`
- `sw.js`

Estos archivos están protegidos por el contrato SHA de la baseline `v2.31.1-production-baseline` y por verificadores de composición. No editarlos directamente salvo que la tarea sea una migración explícita de esa frontera y se actualicen de forma intencional todos los contratos, builds, tests y evidencias correspondientes. `npm run build` continúa generando el release estable desde la baseline verificada; no asumir que compila automáticamente el runtime TypeScript como producción.

### Código TypeScript

Todo código nuevo debe vivir en `src/` y respetar la propiedad del módulo:

- `src/core/`: DOM compartido, formato, confirmaciones, tema, toasts y versión.
- `src/api/`: contratos y adaptadores de acceso RPC.
- `src/auth/`: credenciales, sesión, UI, servicios y controlador de autenticación.
- `src/context/` y `src/branches/`: contexto activo y sucursales.
- `src/team/`: equipo, roles, permisos y Edge Functions asociadas.
- `src/dashboard/`: datos, navegación, presentación y controlador del tablero.
- `src/purchases/`: proveedores y compras.
- `src/inventory/`: ajustes, conteos, transferencias y stock por sucursal.
- `src/products/`: catálogo, modelo, edición, grilla y scanner.
- `src/cash/`: cajas, sesiones, movimientos, apertura y cierre.
- `src/sales/`: POS, descuentos, checkout e historial de ventas.
- `src/offline/`: IndexedDB, snapshots, reservas locales, cola, sincronización, recuperación, UI pendiente y compatibilidad temporal.
- `src/commercial/`: configuración y operaciones comerciales.
- `src/observability/`: registro seguro de errores.
- `src/platform/`: operaciones de plataforma.
- `src/legacy/`: bridges de compatibilidad; no es destino para lógica de negocio.
- `src/types/`: identificadores opacos, dinero y modelos de dominio compartidos.
- `src/main.ts`: composición del runtime modular.

Antes de crear un módulo nuevo, buscar una frontera existente que sea su propietaria. Evitar archivos genéricos de utilidades cuando la lógica pertenece a un dominio concreto.

## 4. Reglas obligatorias de migración

1. No realizar big-bang rewrites.
2. Preservar el comportamiento antes de mejorarlo. Registrar cualquier cambio observable deliberado.
3. Escribir todo módulo, servicio, controlador y tipo nuevo en TypeScript estricto.
4. No agregar lógica de negocio nueva a `app.js` ni a otro monolito legacy. Solo se permiten bridges temporales mínimos que deleguen en módulos tipados.
5. Mantener servicios/RPC separados de controladores, DOM y presentación.
6. Evitar duplicar una regla en TypeScript y legacy. Durante una transición debe existir una implementación propietaria y una delegación explícita.
7. Cada extracción debe incluir tests útiles de paridad o del contrato modificado, pasar CI y conservar el build reproducible.
8. Toda extracción conectada al runtime requiere regresión en navegador del flujo afectado. Probar también errores, permisos, estados vacíos y reconexión cuando apliquen.
9. POS, caja, inventario y offline son rutas críticas. Sus cambios requieren verificación del flujo completo y de la autoridad del backend.
10. No mezclar en una misma extracción reorganizaciones amplias de JavaScript/TypeScript, CSS y HTML. Mantener el cambio revisable.
11. No retirar un símbolo legacy hasta que el módulo tipado esté conectado, sus consumidores hayan migrado y los verificadores impidan su reaparición.
12. Preservar los contratos públicos y los nombres clásicos del release hasta que exista una decisión arquitectónica documentada para cambiarlos.

El orden y estado de las extracciones se mantienen en `docs/MODULAR-RUNTIME-PLAN.md`; los principios de autoridad y fronteras están en `docs/ARCHITECTURE.md`. Consultar ambos antes de cambiar arquitectura.

## 5. Comandos de desarrollo y validación

Ejecutar los comandos desde la raíz con Node 22. Usar los scripts de `package.json`; no reproducir manualmente pasos ya codificados en ellos.

### Ciclo rápido durante la implementación

```bash
npm run typecheck
npm test
npm run lint
```

- `npm run typecheck`: valida TypeScript sin emitir archivos.
- `npm run build:ts`: compila `src/` a `dist-ts/`; los tests lo ejecutan antes de importar los módulos compilados.
- `npm test`: ejecuta `build:ts` y toda la suite unitaria.
- `npm run lint`: analiza `src/` con ESLint.

### Guardas generales

```bash
npm run qa
npm run qa:commercial
npm run qa:database-baseline
```

- `npm run qa` incluye baseline estática, contrato RPC, secretos, código legacy retirado, typecheck y tests.
- `npm run qa:commercial` valida los gates de preparación comercial y el inventario de migraciones.
- `npm run qa:database-baseline` reconstruye y verifica determinísticamente el baseline SQL.

### Runtime modular y releases

```bash
npm run qa:refactor:modular
npm run qa:staging:v2312
npm run build
npm run verify:release
```

- Ejecutar `npm run qa:refactor:modular` al tocar `src/`, bridges, composición HTML/CSS o scripts del runtime modular.
- Ejecutar `npm run qa:staging:v2312` al tocar offline, POS, bundles de staging o sus bridges.
- `npm run build` y `npm run verify:release` deben confirmar que el release autocontenido sigue siendo válido.

### Validación completa antes de entregar

```bash
npm run ci
```

`npm run ci` es la autoridad local para una entrega terminada. Incluye QA, baseline de base de datos, preparación comercial, lint, verificadores HTML/CSS, release, staging offline y preview modular. Si falla, corregir la causa; no omitir ni neutralizar el control.

### Integración local con Supabase

Cuando un cambio afecte RLS, Auth, RPC, ventas, stock, concurrencia o migraciones, usar un Supabase local descartable y ejecutar, según alcance:

```powershell
$env:VENDIFY_TEST_CONFIRM_LOCAL_RESET="RESET_LOCAL_SUPABASE_FOR_INTEGRATION"
npm run test:integration:local
npx supabase db lint --local --level warning --fail-on error
```

El primer comando resetea únicamente la base local. No ejecutarlo contra producción ni sustituir la confirmación explícita. Una migración debe aplicar desde cero y respetar el orden declarado en `contracts/commercial-readiness.json`.

## 6. Convenciones TypeScript

- Mantener ESM y los imports relativos con extensión `.js`, como exige la salida ESM actual.
- No usar `any`. Modelar datos externos como `unknown` y validarlos antes de utilizarlos.
- Preferir tipos de dominio e identificadores de `src/types/` frente a strings/numbers ambiguos.
- Usar `readonly` en entradas, contratos y estructuras que no deben mutarse.
- Representar estados finitos con uniones discriminadas o literales; evitar booleanos que escondan estados incompatibles.
- Mantener funciones pequeñas, dependencias explícitas y efectos inyectables cuando facilite pruebas.
- No acceder al DOM desde servicios de dominio ni clientes RPC.
- No importar globals legacy desde módulos nuevos. Declararlos solo en un bridge dedicado y reducir esa superficie en cada extracción.
- Preservar mensajes de negocio provenientes del backend cuando sean seguros para el usuario.
- Tratar errores capturados como `unknown`; normalizarlos sin filtrar tokens, respuestas completas ni datos privados.
- Evitar assertions `as` para ocultar inconsistencias. Validar límites de red, storage, RPC y DOM.
- Mantener importes monetarios y cantidades con las reglas ya establecidas; no introducir aritmética monetaria alternativa sin un contrato y tests explícitos.
- Agregar comentarios solo cuando expliquen una restricción, invariancia o decisión que el código no expresa por sí mismo.

Los tests deben verificar comportamiento y contratos, no copiar la implementación. Cubrir al menos el camino exitoso y la falla que podría comprometer datos, permisos, idempotencia o compatibilidad.

## 7. Seguridad y autoridad del backend

PostgreSQL/Supabase es la fuente de verdad para:

- aislamiento entre negocios;
- membresías, roles y permisos;
- stock y movimientos;
- ventas e idempotencia;
- sesiones y movimientos de caja;
- recepción de compras;
- límites comerciales.

Reglas estrictas:

- Nunca incluir, exponer, registrar ni enviar `service_role`, claves privadas, tokens de administración o secretos en browser, bundles, fixtures, logs, commits o documentación.
- El frontend solo puede usar la clave pública `anon` y la sesión autenticada del usuario.
- La UI puede ocultar o deshabilitar acciones por experiencia de uso, pero no constituye autorización.
- Toda operación sensible debe validarse en RLS o en un RPC/función backend apropiado.
- Las funciones `SECURITY DEFINER` deben fijar `search_path`, validar `auth.uid()`, resolver el negocio actual y comprobar membresía/rol antes de leer o mutar datos.
- Revocar `EXECUTE` a `public` y `anon` en RPC privilegiados; conceder únicamente los roles necesarios y probar los grants.
- No desactivar RLS para resolver errores. No agregar políticas permisivas globales ni confiar en IDs enviados por el cliente sin comprobar su pertenencia.
- Preservar transacciones, locks deterministas e idempotencia en ventas, stock y caja.
- No editar migraciones ya desplegadas sin una razón explícita y evidencia de que la cadena admite esa corrección; normalmente crear una migración nueva, ordenada y reversible operativamente.
- No ejecutar SQL destructivo ni pruebas mutantes en el proyecto de producción. Usar local o un proyecto descartable claramente identificado.
- Ejecutar `npm run qa:secrets` antes de entregar cambios que toquen configuración, Supabase, scripts o documentación.

## 8. Offline y bridges legacy

El motor offline nuevo vive en `src/offline/` y usa IndexedDB. El stock disponible offline se deriva de snapshots del servidor menos las reservas de ventas locales no sincronizadas.

- Una venta offline debe conservar alcance de usuario, negocio, sucursal y caja.
- Mantener request IDs estables e idempotentes durante todos los reintentos.
- Encolar y reservar stock dentro de una transacción durable; nunca confirmar al usuario una venta que no pudo persistirse.
- Solo permitir medios de pago y operaciones autorizados explícitamente para offline.
- Clasificar fallas de sync entre reintentables y de revisión; no descartar ventas silenciosamente.
- Recuperar sincronizaciones interrumpidas sin duplicar ventas ni liberar reservas antes de tiempo.
- La sincronización debe pasar por RPC autoritativos; no escribir directamente en tablas de ventas, stock o caja.
- Un snapshot o comprobante local no reemplaza una autorización del servidor. El contrato final de lease offline debe estar emitido y validado por backend, tener alcance y vencimiento explícitos, y resistir manipulación/reutilización.
- No habilitar experimentalmente el motor offline nuevo por defecto en producción. Respetar feature flags, staging aislado y las barreras de seguridad de sincronización existentes.

Los archivos de `src/legacy/` y los adaptadores dentro de `src/offline/` son fronteras temporales. Deben traducir formas de datos, delegar y mantener compatibilidad; no deben decidir reglas comerciales. Cada bridge nuevo debe indicar quién lo consume y qué condición permitirá retirarlo.

## 9. Criterio de terminado para cualquier tarea

Una tarea está terminada cuando se cumplen todos los puntos aplicables:

1. La implementación satisface el alcance solicitado sin cambios laterales innecesarios.
2. El comportamiento previo se conserva o el cambio deliberado queda documentado.
3. La lógica nueva está en el módulo TypeScript propietario y no duplica lógica legacy.
4. Los límites de tipos, red, storage, DOM y RPC validan entradas externas.
5. El aislamiento multiempresa, permisos, idempotencia y atomicidad siguen protegidos en backend.
6. Existen tests relevantes para el cambio y para sus fallas críticas.
7. Pasan `npm run typecheck`, `npm test` y los verificadores específicos del área.
8. Pasa `npm run ci` antes de commit o entrega, salvo que exista un bloqueo externo documentado con salida reproducible.
9. Los cambios de Supabase aplican desde una base local limpia, pasan integración local y `db lint` cuando corresponde.
10. Los cambios conectados al runtime tienen regresión de navegador del flujo afectado y la evidencia requerida.
11. No hay secretos, artefactos generados accidentales, credenciales ni archivos temporales en el diff.
12. La documentación, contratos de readiness e inventarios se actualizan cuando cambió la realidad que describen.
13. El diff es revisable, el estado de Git es conocido y no se modificaron archivos fuera del alcance.

## 10. Acciones prohibidas

- Reescribir toda la aplicación o reemplazar el runtime de una sola vez.
- Saltar tests, borrar verificadores o suavizar contratos para obtener una CI verde.
- Agregar lógica comercial nueva a `app.js`, `index.html`, `styles.css`, `sw.js` o bridges legacy.
- Copiar código legacy a TypeScript y mantener ambas implementaciones activas indefinidamente.
- Cambiar simultáneamente arquitectura JS/TS, HTML y CSS sin una necesidad explícita y pruebas de regresión suficientes.
- Exponer `service_role`, secretos, credenciales, JWT privados o datos de clientes.
- Confiar en controles visuales como mecanismo de permisos.
- Desactivar RLS, abrir grants amplios, usar `SECURITY DEFINER` sin controles de identidad/tenant o aceptar IDs de negocio sin validación.
- Hacer escrituras directas desde el cliente en tablas críticas cuando existe o corresponde un RPC transaccional.
- Romper idempotencia, degradar locks o sincronizar ventas offline fuera del orden y alcance definidos.
- Ejecutar resets, seeds destructivos, tests mutantes o diagnósticos de escritura sobre producción.
- Editar manualmente salidas generadas (`dist/`, `dist-ts/`, `dist-staging-v2312/`, `dist-refactor-modular/` o `.vendify-build/`). Modificar las fuentes y regenerar.
- Confirmar la migración local generada `supabase/migrations/20260830000000_pre_v231_baseline.local.sql`.
- Hacer force-push, reescribir historia, borrar trabajo ajeno o mezclar cambios no relacionados.
- Declarar una tarea terminada con pruebas fallidas, gates pendientes ocultos o evidencia manual presentada como automatizada.

Ante una duda entre rapidez e integridad de datos, preservar la integridad, mantener el alcance pequeño y dejar evidencia reproducible.
