# VEN-ADMIN-001B1 — Business read model

Base: `7503ba24399967a93fab1711632adaf91fbbe662` on `refactor/modular-runtime`.
Original scope: additive read contracts. The local 2026-10-22 MVP increment now
connects the validated list to the existing modular platform administration UI.
SQL, the detail contract, read RPC v1 and the subscription mutation RPC are unchanged.

## Authorization and purity

Both RPCs check `auth.uid()` and the current `es_admin_plataforma_v1()` grant
before input validation or business lookup. A business owner/admin/manager/cashier
is not a platform administrator without that separate grant. Revocation is observed
on subsequent statements; an already running statement uses its transaction snapshot.

`SECURITY DEFINER` is necessary to read across business RLS without exposing tables
directly. Functions are `STABLE`, have an empty `search_path`, qualified references,
no dynamic SQL and no table writes. EXECUTE is revoked from PUBLIC/anon and granted
to authenticated; internal authorization remains mandatory. No table grants or
policies change. The minimal projection excludes personal contacts, employees,
sales, payments, internal notes, credentials and raw logs.

## Wire contract v1

`listar_negocios_plataforma_v2(p_search text = null, p_plan_codigo text = null,
p_estado text = null, p_limit integer = 50, p_cursor jsonb = null)` returns:

```json
{"contract_version":1,"items":[],"next_cursor":null}
```

`obtener_negocio_plataforma_v1(p_negocio_id uuid)` returns:

```json
{"contract_version":1,"business":null}
```

`business: null` means that the requested business does not exist, after successful
authorization. A returned business contains only `id`, `nombre`, `creado`, `activo`,
`suscripcion`, and `uso`. A subscription contains `plan_codigo`, `plan_nombre`,
`estado`, `trial_hasta` and `limites` (sucursales/usuarios/productos). `uso` contains
the same resource counts. An absent subscription is explicitly `null`; no legacy
subscription is created. Existing states/dates are reported without interpreting,
expiring or repairing them. Counts use active memberships (including the owner),
active branches and all business products. Null limits mean unlimited.

The TypeScript owner is `src/platform/business-read-model.ts`; the RPC adapter is
`src/platform/business-read-service.ts`. The adapter validates unknown responses,
required/extraneous fields, UUIDs, dates, nullability, counts, state, returned detail
identity, page ordering and cursor boundaries. Malformed data raises a protocol
error. Services expose `listPlatformBusinesses` and `getPlatformBusiness`.
The modular controller uses the list projection directly, including usage/limits;
detail remains available but is not required for these complete list rows.
Input filters are normalized before the RPC call.

## Search and pagination

Default limit: 50; allowed range: 1–100, integer only. Search is a literal,
case-insensitive name substring or exact UUID, with a maximum of 120 Unicode
codepoints. `%` and `_` are literal characters, not SQL wildcard patterns. Plan
filters must identify a catalogue entry; state filters use the five existing
subscription states. Queries never change the operator's active business.

Order is fixed: `creado DESC, id DESC`. A cursor has exactly these fields:

```json
{
  "version": 1,
  "order": "creado_desc_id_desc",
  "query": {"search": null, "plan_codigo": null, "estado": null},
  "anchor": {"creado": "2026-01-01T00:00:00.123456Z", "id": "20000000-0000-4000-8000-000000000002"},
  "after": {"creado": "2026-01-01T00:00:00.123455Z", "id": "20000000-0000-4000-8000-000000000001"}
}
```

The anchor is the first emitted key on the first page and remains fixed. `after`
is the last emitted key. Cursors bind to normalized query filters and fixed order;
incompatible filters, malformed dates/UUIDs, extra fields and after > anchor are
rejected. UTC timestamps retain six fractional digits: JS millisecond rounding
must not merge distinct PostgreSQL keys. The next cursor is emitted only when an
additional row exists beyond the page limit.

This is an untrusted positional token, not a signed capability or a secret.
Changing valid positions can skip authorized results but cannot grant access;
every RPC independently authorizes the caller. Cryptographic cursor integrity is
not claimed. Do not reuse this design as a security boundary for tenant-scoped data.

Each call observes a stable database snapshot, not a snapshot across all pages.
New rows above the anchor are excluded. Backdated insertions, deletion or changes
to creation dates/filter membership can alter later pages. Refresh from the first
page to obtain current data; a consistent historical export is outside this ticket.

## Local verification

Run `npm ci` and `npm run ci` for repository checks. Run
`npm run test:integration:platform-read:local` for the SQL suite. It requires Docker
and an already cached `postgres:17-alpine` image. It creates a random, labelled,
network-isolated container with tmpfs data, publishes no ports and destroys only
its own container after checking the ownership label. It accepts no target DB URL,
does not reset a Supabase project and never uses `.env` credentials.

The runner applies the generated source baseline and every historical migration
plus the additive migration, then executes SQL roles/claims fixtures. Both RPCs
run inside `BEGIN READ ONLY`, proving they do not repair missing subscriptions or
write application tables. Actual PostgreSQL responses also cross the strict
TypeScript parser. Coverage includes anon, ordinary user, owner/admin/manager/
cashier, revoked/global administrator, cross-business denial, missing business,
empty results, timestamp ties, microseconds, multiple pages and invalid inputs.

Evidence tier: real PostgreSQL SQL/grants/RLS with minimal local Auth/Storage
primitives. It does not test real Auth sessions, PostgREST, hosted staging or E2E.
Those remain NOT_RUN; no remote migration, release or SECURITY_PASS is implied.

## VEN-008 and review boundary

The migration/contract inventory is shared integration surface and must be
coordinated before merging. No VEN-008 fixture, worktree, Preview, live test,
quota, subscription state or commercial permission is changed. The source
historical migrations remain byte-for-byte unchanged. This ticket neither fixes
nor closes VEN-008 security findings. External review and explicit remote migration
authorization are required before remote adoption. The historical B1 delivery
included no UI; the separately authorized local MVP increment connects its read
contract without applying the migration remotely.

## Local modular administration increment (2026-10-22)

In the modular runtime, open Administración Vendify from the user menu.
The list shows active/inactive businesses, subscription plan/state, trial date,
and users/branches/products as usage against limits. Null limits read “sin límite”;
absent subscriptions read “Sin suscripción” and “sin límite informado”, with no
preselected mutation values. Zero is displayed as a real zero limit.

Buscar accepts a literal name/identifier, exact plan code and subscription state.
Anterior/Siguiente navigate cursor pages of 50. Changing or refreshing a query,
reopening the modal, and successful saves start at the first page. Pagination is
the positional contract above, not an export snapshot or a total result count.

Guardar uses only the existing privileged mutation RPC, validates the selected
visible business and values, and reloads the typed list and summary. Existing
catalogue plan codes outside the historical options remain selected and can be
preserved when editing state. This is not a plan catalogue editor or billing UI.
All authorization remains with the backend; UI access checks grant no authority.

List, access or mutation failures clear privileged rows/summary; late responses
are ignored after close, access refresh or session changes. Composition clears
the modal before authenticated boot/signout. There is no v1 list fallback or data
repair. Loading, empty, offline and failure states use the existing modal.

Local tests and isolated Chrome fixtures are evidence for the client increment.
Remote read-RPC availability and real Auth/PostgREST remain NOT_RUN in this task.
See the successor MVP handoff for exact source identity, executed results and
remaining pilot gates. This connection does not change the stable release build.
