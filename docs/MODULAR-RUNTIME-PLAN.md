# Vendify modular runtime migration plan

## Baseline measured on 2026-09-01

The automated architecture map reports:

- `app.js`: 12,168 lines / 413,514 bytes
- `styles.css`: 10,945 lines / 244,194 bytes / ~1,899 blocks
- `index.html`: 2,505 lines / 569 ids
- 410 top-level functions
- 128 top-level state/global bindings
- 71 RPC names referenced by the legacy runtime
- 606 DOM selectors referenced by top-level functions
- 23 event names

The monolith is not only large; it has highly shared global dependencies. Examples from the map:

- `$`: referenced by 239 top-level functions
- `productos`: 42 functions
- `carrito`: 18 functions
- `cajaEstadoV227`: 13 functions
- `sesionActual`: 12 functions
- `categorias`: 11 functions

High-coupling functions include `mostrarToast`, `inicializarEventos`, `renderGrid`, `confirmarVenta`, `cargarProductos`, `renderCarrito` and scanner/product flows. These should not be the first migration targets.

## Migration rules

1. No big-bang rewrite.
2. Preserve behavior before improving behavior.
3. Every extracted module must have unit tests where practical.
4. CI must stay green after every extraction.
5. Browser regression is mandatory for runtime-wired extractions.
6. POS/offline/cash paths move late because they are business critical and highly coupled.
7. New code is TypeScript; no new business logic should be added to the legacy monolith unless required for a compatibility bridge.
8. Production output may continue to expose the classic filenames `index.html`, `app.js`, `styles.css`, `sw.js`; source organization is independent from bundle names.

## Target source layout

```text
src/
  app/
    bootstrap.ts
    app-context.ts
    navigation.ts
  core/
    dom.ts
    format.ts
    errors.ts
    events.ts
    validation.ts
  api/
    supabase-client.ts
    rpc.ts
    realtime.ts
  auth/
  products/
  inventory/
  cash/
  sales/
  purchases/
  dashboard/
  team/
  pos/
  offline/
  types/
```

CSS target:

```text
src/styles/
  tokens.css
  reset.css
  base.css
  layout.css
  components/
  features/
```

## Extraction order

### Phase 0 — architecture map and guardrails

Status: in progress.

- automatic AST map for functions, globals, RPCs, DOM selectors and events
- CSS section inventory
- refactor branches included in CI
- keep `develop` stable while extraction happens on `refactor/modular-runtime`

### Phase 1 — core dependency roots

Extract pure or near-pure helpers first:

- ARS formatting
- product display-name normalization
- HTML escaping
- DOM query helpers
- generic validation/error helpers

Do not extract `mostrarToast` or the global event bootstrap until their dependency surface is reduced.

### Phase 2 — authentication

The heuristic map shows Auth as the lowest-coupling meaningful functional group (25 functions, coupling/function ~3.2). Move login, employee login and auth helpers after core utilities are wired.

### Phase 3 — team

Small bounded area (7 functions) with few globals. Move team/member role and permission UI/service logic.

### Phase 4 — dashboard

Small function count; move dashboard fetch/view-model/rendering after shared UI helpers are available.

### Phase 5 — purchases

Move suppliers and purchases as a bounded feature, separating RPC/service logic from DOM rendering.

### Phase 6 — inventory

Move stock adjustments, counts and transfers. Treat `transferir_stock_v1` and `transferir_stock_v2` as an explicit legacy cleanup item rather than silently choosing one.

### Phase 7 — products and scanner

Large shared state surface. Introduce a typed products store before moving `renderGrid`, scanner and product editing.

### Phase 8 — cash

Move cash state/session/movements with typed state and explicit API boundaries.

### Phase 9 — sales / POS

Only after products, cash and shared UI dependencies are modular. Move cart, checkout, payments, discounts, tickets and sales history.

### Phase 10 — offline integration consolidation

The v2.31.2 IndexedDB engine is already modular. Once POS and cash are modular, replace the temporary legacy bridge with direct typed imports and complete the signed offline-lease contract.

### Phase 11 — CSS split

CSS is currently layered chronologically by release. Split by tokens/base/components/features while preserving cascade order first. Remove obsolete layers only after visual regression checks.

### Phase 12 — HTML decomposition

Decompose large static modal/page fragments only after JS module ownership is clear. Avoid changing JS, CSS and HTML architecture simultaneously.

## Definition of done

The migration is complete when:

- no business feature needs to be edited inside the legacy monolith
- legacy globals are reduced to intentional compatibility boundaries only
- production output is reproducible through the build pipeline
- classic public filenames remain available
- critical features have automated tests plus browser regression coverage
- the remaining legacy file can be deleted rather than maintained
