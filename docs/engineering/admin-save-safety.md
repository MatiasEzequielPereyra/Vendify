# Administrative save safety and read smoke

Project: VendifyV3
Revision: 1
Updated: 2026-10-27
Task: VEN_ADMIN_001B1_ACCIDENTAL_SAVE_GUARD

The controller compares selected plan/status with the loaded typed business
model. Save is disabled until a real change exists; direct or stale invocations
with unchanged values also return before any mutation or confirmation. Missing
subscriptions remain explicit and are not converted to a fictional old plan.

Effective changes require an explicit confirmation naming the business and UUID,
previous plan/status and proposed plan/status. Only boolean true is acceptance.
The pending lock starts before confirmation and covers fresh administrator
verification and the request; every Save button is disabled. Session identity
must be nonblank. After each asynchronous boundary the controller checks session,
connection, generation, business snapshot, selected values and attached row.
The server remains the final authorization authority; these UI guards do not
replace RPC permissions or claim protection against direct hostile clients.

Cancel, invalid confirmation, missing session, changed session, stale selection,
revoked permissions and disconnected rows make no commercial RPC. A failed
request is not retried automatically. No historical subscription is restored.

## Browser action rule

Resolve each action from current semantic names or stable data attributes, after
every render. Never use an accessibility snapshot number, list position, nth()
or coordinate as the sole selector for a business operation. A duplicate target
is a failure, not a reason to select the first match. Rows expose an accessible
group name containing business name and UUID; Save has the same identity in its
accessible name. Test clicks use the exact business group and exact control.

## Transport guard before any read smoke

`scripts/admin-read-smoke-guard.mjs` is a test adapter, not production code. Install
it before navigation in a fresh context with serviceWorkers:block; the reusable
recipe `tests/browser/admin-read-smoke.mjs` owns that context. Do not execute the
recipe against a live project without the separately authorized authentication
and read-only test scope. Owner credentials remain owner-entered or held only in
an authorized test process, never evidence files or command arguments.

The adapter allows exact known administrative read RPCs (including POST reads),
the exact necessary Auth endpoints/methods and pinned Supabase CDN script. It
rejects unknown/write RPCs before transport, alternate schemas/method overrides,
ambiguous encoded URLs and redirects. Violations contain no URL/query/body/token.
`assertNoWrites()` must run even when the UI catches an error; a blocked attempt
fails the smoke. It is not enough to observe a harmless toast or empty result.
The recipe waits for completed reads and confirmed logout/removed business DOM.

Vercel SSO is not bypassed. A fresh context without legitimate access will fail
on its redirect. That failure is AUTH_REQUIRED/blocked, never application denial
PASS; a legitimate operator/session path must be arranged under the later test
authorization. This change does not claim hosted Auth/PostgREST acceptance.

## Reproduce the local checks

```text
npm run ci
node --test tests/unit/platform-admin-controller.test.mjs tests/unit/admin-read-smoke-guard.test.mjs
node scripts/serve-admin-save-guard-fixture.mjs
```

The fixture server prints a loopback URL and records it under
outputs/VEN_ADMIN_001B1_ACCIDENTAL_SAVE_GUARD/browser-fixture-location.json. Open
that URL with the browser tooling and inspect the PASS/FAIL JSON rendered in the
page. It serves compiled real controller modules, but all businesses and RPCs
are synthetic in-memory mocks. CSP connect-src:none blocks real network calls.
Legitimate save and error cases exercise mock mutations only. The read-smoke
case proves an attempted write never reaches its mock upstream and still fails
the smoke's assertion. No real account, database or deployment is involved.

The 26 October incident and A's confirmed persisted state remain historical
facts. A prior subscription state is not established, and no revert is included.
Publication of this guard and remaining genuine read/Auth/logout tests require
A's next explicit authorization. Do not deploy or activate a hostname here.
