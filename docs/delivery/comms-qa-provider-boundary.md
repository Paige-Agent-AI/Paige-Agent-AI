# Communications QA provider execution floor — #1832

Owner outcome: authorized synthetic Solo verification can use ordinary authenticated tenant ownership without acquiring or exercising Communications provider authority. This is a Communications executor safeguard, not another auth, Harness, approval, provider registry or scheduler.

## Identity and provisioning prerequisite

Before canonical provisioning, the authorized Auth administrator must create the synthetic principal with protected **app_metadata** `comms_provider_execution: "disabled"`. User metadata, tenant names, fixture labels and frontend flags are not authority. The tenant BEFORE INSERT trigger inherits a sticky server-owned restriction before managed-sender lifecycle events. Normal active standalone identity and owner/base-user membership remain required. The repair provisions no principals, tenants or credentials.

The tenant restriction cannot be lowered by ordinary writes, owner changes or removal of the Auth marker. Principal and recipient lookups also check protected metadata and restricted memberships. Existing canonical provisioners and approved secret management remain the setup path. Credentials keep existing LIVE_DRIVE_EMAIL/LIVE_DRIVE_PASSWORD names; no secret or JWT belongs in evidence.

## Affected flow and reuse

Actor: approved isolated Solo QA owner, or a trusted existing background executor acting on that workspace. Existing entrypoints resolve tenant/actor from authenticated or immutable server records. Before provider admission or deferred scheduling they query one service-only floor. Only literal true permits the existing downstream authorization, approval, budget, consent and provider contracts to proceed. Errors and malformed decisions refuse. This floor grants no authority.

Communications owns email/SMS/voice/connection executors. Existing Spine comms.email_send and setup keys retain their declarations and Trust lane; no new user-facing capability is registered. Existing queued message and booking/reminder substrates are reused. Refusals retain honest terminal/readback behavior. Harness/Spine/Trust/Rail are consumers, not replaced. No visible surface or binding-ledger availability is advanced; authenticated/browser proof remains with QA after provisioning. Provider registry entries remain declarations, not connections.

## Proof and release boundary

Controlled tests load actual handler source with isolated clients/provider spies and test the actual SQL in an empty PostgreSQL database. They prove restricted/error decisions cause zero provider effects and preserve ordinary payloads. They are not real signed-in QA or provider delivery acceptance. Failing-first reproduction uses reviewed pre-repair source; core managed lifecycle omission fails before any external effect. CI runs the same tests and migration twice in isolation.

Run `node --test supabase/functions/_shared/comms-provider-boundary.test.ts supabase/functions/_shared/comms-email-provider-boundary.test.mjs supabase/functions/_shared/comms-phone-provider-boundary.test.mjs supabase/functions/_shared/booking-provider-boundary.test.mjs`, then the isolated-only `psql -f supabase/tests/comms_provider_execution_boundary.sql`. Never run the isolated schema test against the linked production project.

PR #1880 remains the separate paused mailbox roadmap. Its new sync/organize entrypoints must consume this same floor before merging; the CI wiring alarm refuses those paths if introduced without it. No Gmail activation, provider calls, paid actions or INT-346 activation is authorized by this repair.

Internal-only release. Merge/deployment/persistence and authoritative deployed bundle readback must be recorded independently before handing the boundary to QA as verified. Recovery is forward-fix/redeploy; never remove or lower a restricted tenant's floor to restore provider effects. Local test schemas/fixtures roll back. No existing customer rows are rewritten by migration.

Coverage dispositions: current MCP mutations refuse at the existing governed door; billing `send_invoice` must apply this floor before any future activation. Platform invite/admin probe remain platform-owner-only, and fixed-target welcome backfill is an administrative artifact, outside normal synthetic tenant authority. The isolated SQL contract uses a simplified schema and is not full production RLS/schema proof. Internal reminder delivery is retained; only its optional external email leg is refused, with the existing deduplication claim preserved.
