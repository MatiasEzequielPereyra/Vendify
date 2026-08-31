# Vendify

Vendify es un POS/SaaS multiempresa y multisucursal orientado a comercios minoristas.

## Estado del repositorio

Este repositorio nace desde la versión de producción **v2.31.1**.

La estrategia de modernización es **incremental**:

- producción actual permanece en `index.html`, `app.js`, `styles.css`, `sw.js`;
- el código nuevo nace en TypeScript dentro de `src/`;
- no se reescribe el POS de golpe;
- cada módulo migrado debe pasar regresión antes de reemplazar código legacy;
- la primera migración funcional será el motor offline.

## Baseline

Tag inicial:

```bash
v2.31.1-production-baseline
```

Ese tag debe permanecer inmutable y representa el punto de rollback previo a la modernización.

## Requisitos

- Node.js 22 LTS
- npm
- Supabase CLI para tareas de base de datos (opcional en esta fase)

## Primer inicio

```bash
npm install
npm run qa
npm run typecheck
npm run build
```

`npm run build` **no recompila aún el POS legacy**: genera un release desde la baseline estable y valida que sea autocontenido. Esto es deliberado para evitar una regresión durante la Fase 0.

El build TypeScript experimental se ejecuta por separado:

```bash
npm run build:ts
```

Cuando cada módulo migrado alcance paridad funcional y QA, pasará a formar parte del build de producción.

## Estructura

```text
src/
  core/
  api/
  types/
  offline/
  pos/
  cash/
  inventory/
  products/
  purchases/
  team/
  dashboard/

supabase/
  migrations/
  tests/

tests/
  unit/
  integration/
  e2e/

scripts/
contracts/
docs/
.github/workflows/
```

## Branching

- `main`: producción estable.
- `develop`: integración de cambios ya revisados.
- `feature/*`: funciones nuevas.
- `fix/*`: correcciones.
- `security/*`: hardening.

Ver `docs/BRANCHING.md`.

## Seguridad

Nunca subir:

- `service_role`
- tokens OAuth privados
- Access Token de Mercado Pago
- secretos de webhooks
- passwords de usuarios

El anon key de Supabase es público; la seguridad real debe residir en RLS, RPC y validaciones del backend.
