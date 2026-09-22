# Phase 13 — retire legacy composition

**Status:** agreed design; implementation in progress on `refactor/modular-runtime`.

The first PWA cut is connected and browser-verified on 2026-09-22. The inactivity guard is next.

## Goal and boundary

The modular runtime is complete when it boots and operates without loading `app.js`. Each remaining responsibility must have one TypeScript owner under `src/`, and verification must prevent an extracted implementation from returning to the legacy file. This is a sequence of small parity-preserving cuts, not a single replacement.

The stable production release and its classic public filenames remain protected while the modular runtime is validated. Removing `app.js` from the modular build does not by itself promote that build to production. The staging offline runtime and the production baseline retain their own gates.

Build verification needs one additional audit before promotion: `scripts/build-release.mjs` currently copies the working `app.js` into `dist/`, while `scripts/verify-release.mjs` checks file presence and references but does not execute the browser runtime. The baseline tag check does not prove that the emitted `dist/` application boots. A production browser smoke and an explicit artifact-to-baseline or modular-entry contract must close this gap before release promotion.

No new domain term is introduced by this plan; `CONTEXT.md` remains the glossary for Negocio, Sucursal, Caja, Venta and the other business concepts. ADR 0001 governs incremental TypeScript extraction, and ADR 0002 governs promotion beyond the protected production baseline.

## Decisions

1. Design the whole retirement path, then implement one bounded extraction at a time.
2. Retire `app.js` from the modular runtime first. Promote the modular runtime only after the separate production acceptance gate below.
3. Complete Phase 13 only when the modular output has no `app.js` dependency, TypeScript modules own the remaining behavior, and anti-regression checks enforce both properties.
4. First extract Service Worker registration and the installation prompt into a platform-owned TypeScript module. Keep onboarding as a separate cut because its example-data action crosses into the product flow.
5. Extract the inactivity session guard next. Its existing eight-hour rule, shared activity timestamp, throttled writes and sign-out behavior require parity tests and browser regression.
6. Defer global event composition and Back navigation until the current scanner/editor-return changes are integrated. Move Sucursal/Caja selectors after the lower-coupling work because switching context can affect cart and cash state.

These decisions preserve existing behavior. Any deliberate change to installation, session expiry, navigation or business rules needs its own decision and tests.

## Extraction sequence

| Order | Responsibility and owner | Required proof before removing its legacy implementation |
| --- | --- | --- |
| 1 | Service Worker registration and install prompt in `src/platform/` | Registration failure is contained; prompt availability, dismissal, standalone mode and accepted/rejected outcomes retain behavior; modular browser regression and an anti-regression check pass. The classic build keeps a minimal registration fallback until typed bootstrap replaces it. |
| 2 | Inactivity guard in `src/auth/` | Clock and storage tests cover the eight-hour boundary, activity write throttle, shared-tab timestamp and single sign-out; focus/visibility browser regression passes. |
| 3 | Onboarding UI, with its example-data action supplied by the owning product module | First-visit and completed states, both buttons and persistence retain behavior; no product-data rule moves into a generic UI module. |
| 4 | Remaining bounded UI and operational adapters, assigned to their existing owners | Inventory the remaining functions after each cut. Extract product media/editor, stock adjustment, connection/overlay stability, diagnostics, commercial and platform administration separately where their owners differ. Preserve RPC and permission boundaries. |
| 5 | Navigation and global event composition in `src/core/` or an explicit application coordinator | Integrate scanner/editor-return work first. Verify Escape, Back, modal priority, keyboard shortcuts, mobile menus and no duplicate listeners in a browser. Domain actions remain injected into the coordinator. |
| 6 | Sucursal/Caja selectors and branch administration in `src/branches/`, `src/context/` and `src/cash/` as appropriate | Verify context persistence, tenant and branch scope, open Caja, cart effects, permission failures and empty states; use backend authority and local integration where mutations apply. |
| 7 | Typed bootstrap and removal of the modular compatibility bundle | Replace the `init()` ordering with explicit typed composition. Build the modular preview directly from typed entry points. Update the modular HTML, Service Worker cache inventory, build scripts and verifiers together; prove no generated modular asset loads or copies `app.js`. |

Orders 4–6 are dependency groups, not permission to combine their changes. Reassess the next smallest cohesive cut after each merge. A bridge is removable only when all its callers use the typed owner and a verifier rejects the old implementation. Do not edit generated `dist-*` files directly.

## Verification at each cut

- Preserve the existing observable contract and record any intentional difference.
- Add focused tests for the success path and the failure most likely to affect session, data integrity or compatibility.
- Run `npm run typecheck`, `npm test`, `npm run lint`, the relevant modular/staging/PWA verifier and `npm run ci` before delivery.
- Run authenticated browser regression for every runtime-connected extraction, including failure, permission and reconnection states when applicable. POS, Caja, Inventario and offline changes require the full affected flow and backend authority checks.
- Keep a reviewable diff, avoid unrelated edits and preserve work already in progress in scanner/products.

## Phase 13 exit gate

The modular artifact must start from typed composition without `app.js` or a renamed copy of it. No runtime script or Service Worker cache entry may reference that compatibility bundle. Tests and verifiers must cover the new bootstrap, script order and every retired bridge. Critical flows must pass authenticated browser regression, and `npm run ci` must pass. The stable release is still a separate artifact at this point.

## Production promotion gate

Promote the modular runtime only after CI and release verification, an authenticated end-to-end regression of sales, Caja, Inventario, permissions and offline reconnection, and completion of the physical-device PWA matrix in `docs/qa/PWA-DEVICE-MATRIX.md`. The current PWA gate is `pending_manual`; the existing desktop browser acceptance does not replace Android, iPhone/iOS, camera or thermal-printer evidence. Offline activation remains behind its feature flag and the signed-authorization safety contract. Record the promotion as a separate release decision with rollback evidence.
