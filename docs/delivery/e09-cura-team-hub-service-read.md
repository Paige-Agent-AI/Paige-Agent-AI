# CURA business-team service read

## Outcome and boundary

The business asks its SAME CURA specialist where a customer stands and receives the
original authorized agreement, money and delivery facts in its private CURA Team Hub
conversation. A shared channel receives none of those private facts. This is separate
from the external customer's private Portal assistant and history.

Current channel: development. The adapter is implemented; the existing Team Hub turn
has NOT yet mounted it. No deployed/customer-verified or complete-Experience claim.
EXP04 owns the overlapping original turn integration under ANT161/96059214;
EXP09 owns only this adapter and tests under ANT161/6fbdb9eb. Current main3f80 and
the actual open EXP08 #3041/f786 offer/dispatch/publication changes were inspected.
Preserve E05's automation reservation and all unmerged A2b work.

## Pre-edit capability and orchestration contract

1. Request: business owner/admin asks where one CRM customer stands.
2. Entry: existing private business-team CURA DM; ordinary Portal customer and shared
   channel reads are refused. Existing PAIGE owner Chat remains unchanged.
3. Capability/specialist: original `client.engagement_status`, tool
   `read_client_engagement_status`, SAME CURA/personality. Reuse the exact original
   `CLIENT_ENGAGEMENT_TOOLS` definition, never a copied schema or new registry.
4. Actor: original verified asker/current SOLO tenant/exact CRM client. Stored
   capability scope and current original owner/admin authority must both permit it.
   Arguments cannot supply actor, tenant, role, audience or permission.
5. Authority: existing turn revalidation plus ORIGINAL actual-caller-JWT
   `find_clients_for_status`/`read_client_engagement_status` definers. Locator IDs
   grant nothing. No service impersonation, grant or claim rewriting.
6. Execution: existing `dispatchClientStandingChat` and unchanged domain composer;
   ordinary read, Layer C ActionAdapter NOT_APPLICABLE. No copied financial query,
   money math, scheduler, approval, ledger, customer history or model runtime.
7. Durability: original Team Hub accepted turn/post/result/readback and original
   governed read recorder. `recordReads` must acknowledge the original reads BEFORE
   the result is given to the model. Record links remain original references outside
   model context; their destination reauthorizes access. No new receipt store.
8. Recovery: one bounded read, no automatic retry or external effect. Timeout does
   not mean native cancellation. A timed-out lookup cannot start a later status
   request. Missing/refused/unknown data never becomes zero or financial success.
9. Publication: existing shared turn must call `revalidate()` before posting. It
   rechecks original scope/authority, rereads the same original query, and requires
   all source facts to match, excluding ONLY observation time and receipt identity.
   Actual business date, zone, versions, truncation, money and client remain bound.
   A changed/refused source withholds the new answer, preserving prior history.
10. Actual evidence: source tests/strict type/lint are bounded engineering proof.
    Exact final-head CI/review/merge/deployment, native Team Hub integration,
    authenticated owner/member/revoke/two-cohort/reload and founder acceptance are
    still UNVERIFIED. No provider call, activation, send, charge or signature.

## Single shared-owner integration exports

- `curaServiceReadTools(scope)` returns zero or one ORIGINAL definition. Scope must
  be server-resolved SAME CURA, `agent_dm`, `business_team`, current owner/admin and
  include the original tool in its stored allowlist.
- `readCuraServiceStanding(scope, deps, args)` returns `model`, `recordLinks` and
  `revalidate`. `deps.caller` is the asker's own original client;
  `deps.isCurrent(scope)` is the existing turn's authoritative identity/tenant/DM/
  authority/cancellation check; `deps.recordReads(evidence)` is its existing recorder.
- Offer and dispatch enforce that scope independently. Pass only `model` into the
  same model loop; keep references in the original result presentation, never invent
  addresses. The originating message's record-link wording requires that presentation
  or an explicit truthful unavailable state; do not claim a visible link from an
  unmounted adapter.
- Register returned source checks with the existing pre-post publication gate. A
  `false` check discards the prepared new reply through original recovery; it cannot
  post the stale reply. Do not copy this helper into the customer Portal audience.

## Verification and four dimensions

35 focused Node transport/adapter controls PASS after correcting new
refusal/revalidation and resolved-client binding defects and one fixture receipt
expectation. The first run26/29, second remaining fixture failure and genuine
34/35 name-resolution negative are retained locally. These exercise
real original projection code with the original neutral source fixture, not Auth,
RLS, live execution or an actual customer/provider result. Original source's money,
manual/provider/test, missing-zone and unknown-outcome meanings remain unchanged.
All116 existing assertions in four original client-standing/effective-terms/reviewed-
delivery suites PASS; first sandbox attempt started zero tests because Windows denied
its temporary cache rename, then the SAME suites passed under the ordinary native
runner. Final strict targeted TypeScript, scoped ESLint and whitespace checks PASS.
One additive original CI Node-list entry runs all35 controls; no existing test removed.

Functional: adapter BUILT; shared integration/release/customer proof OWED.
Visual: no new screen/component/style/personality change, no rendered proof claimed.
Experiential: current-scope/source revalidation and truthful recovery implemented;
real conversation/result/reopen/revocation proof OWED after the shared integration.
Founder Acceptance: NOT_READY, original full42/seven/amendments remain STILL CODING.
