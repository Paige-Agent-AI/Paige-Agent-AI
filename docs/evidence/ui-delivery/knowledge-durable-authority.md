# Knowledge-only native durable authority prerequisite

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: native server create -> exact Knowledge kind pair -> current actor and selected workspace -> immutable envelope; caller status read -> current authority and existing sharing limits.
PAIGE_UI_DESIGN: PASS: AGENTS routing assessment finds no visible interface change; UI design work and its checks are outside this backend slice.
MATERIAL_FLOW_CHANGE: NO: staged backend/client seam; current consumers and Chat unchanged.
FLOW_PROTOTYPE: NOT_REQUIRED: no interface implementation in this slice.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: align future Knowledge jobs with existing member, owner and company-operator authority without broadening other durable work.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change.
AUTOMATED_EVIDENCE: PASS: 47 SQL role/behavior assertions plus one database-observed two-connection workspace-switch race; migration replay twice; old document submit/replay/status/start exercised.
STATIC_EVIDENCE: PASS: unchanged non-Knowledge authorization branches copied from native migration; canonical actor-helper composition inspected; diff and evidence checks.
RENDERED_EVIDENCE: NOT_APPLICABLE: no UI adoption here.
BEHAVIORAL_EVIDENCE: PASS: PostgreSQL16 executes actual envelope and document-authoring migrations plus new migration. Roles, grants, row locks and immutable-intent behavior exercised; external dependency helpers are explicit local models.
AUTHENTICATED_RUNTIME: UNVERIFIED: real Supabase identity, full migration chain and API serialization not exercised.
KEYBOARD_FOCUS: NOT_APPLICABLE: no controls.
ZOOM_REFLOW: NOT_APPLICABLE: no layout.
REDUCED_MOTION: NOT_APPLICABLE: no motion.
STATE_COVERAGE: PASS: exact/mismatched kind pairs, wrong actor/tenant/company/selection, absent/deleted/banned actor, inactive tenant/member, independent operator authority, revocation, owner/admin/initiator status, helper ACLs, old document behavior, replay mismatch and concurrent scope change.
TRUTHFUL_STATE_LABELS: PASS: two reserved native work kinds are prerequisites only; no Knowledge submission, worker or lifecycle capability becomes LIVE.
SOLO_UI: NO: staged service only.
UNVERIFIED: real Supabase auth schema and identities, full migration chain, production grants, providers and Knowledge worker execution. No new worker exists in this slice.
RELEASE_CHANNEL: development: local fixture only.
RELEASE_CLASSIFICATION: internal-only: no customer release.
CUSTOMER_RELEASE_IDENTITY: none: no deployed human flow.
RELEASE_NOTE_REQUIRED: NO: staged capability.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: authenticated deployment and all privileged consumer adoption; lifecycle Spine capabilities remain UNAVAILABLE.
RELEASE_RECOVERY: position=retain Knowledge lifecycle freeze and disable any future Knowledge submission adapter while reviewing authority changes without altering existing native work records; reference=198b53c595c1353d9f86c6c80d95cd093287d34c
INTERNAL_BUILD_IDENTITY: base=198b53c595c1353d9f86c6c80d95cd093287d34c; branch=codex/knowledge-durable-authority; deployment=NOT_APPLICABLE; environment=local; migrations=PROOF_OWED(real Supabase application of 20270530600000_knowledge_durable_authority); edge=NOT_APPLICABLE; evidence=scripts/knowledge-service/durable-check.py


## Ten routing answers (pre-edit)

1. Outcome: make native envelope authority usable by future Knowledge adapters without another job system.
2. Domain/ownership: Knowledge owns the adopter. Shared create/get durable functions and actor authority are collision surfaces; parent explicitly authorized this narrow slice. UI, Chat and ingestion authors remain separate.
3. Harness: reuse paige_durable_work and canonical authority helpers, with no global permission or shared-layer status change.
4. Spine: knowledge.extract and knowledge.publish are reserved native correlation keys only; no capability registry entry or LIVE claim.
5. Provider: local PostgreSQL only; Supabase remains existing infrastructure. No network/provider action.
6. Lane: service-only prerequisite, not an approval path. Future submission must perform the existing governed approval and budget decision.
7. Job/event: existing create/get envelope; no worker, scheduler, event bus, new store or dispatch implementation.
8. Readback/Rail: existing safe status projection retained. No receipt changes; future execution still owes verified domain readback and native receipts.
9. Visible surface: none; no ledger change or owner-visible workflow.
10. Proof: actual local SQL with modelled dependencies, plus old document-authoring regression. Deployed Supabase identity and full native system proof remain UNVERIFIED.

## Exact bounded contract

New service-only public.knowledge_actor_authorized(actor, tenant) returns a boolean. It requires non-null actor/tenant, an existing auth.users row with no deleted_at and no current banned_until, active tenant, and the exact raw profiles.active_tenant_id. Authority then composes existing public.is_platform_owner(uuid), a literal active tenant_members row, or public.is_tenant_admin_as(uuid,uuid). That actor-aware canonical helper already owns the company-workspace/operator clause; no new role-name taxonomy is introduced. Authenticated and anonymous execute are revoked. No request.jwt.claim or auth.uid impersonation occurs.

The canonical is_tenant_member predicate permits company operators independently of a literal membership row. An inactive membership therefore does not negate a separately valid operator role. The actor-aware admin helper uses active membership for ordinary owners/admins and its existing company/platform-admin clause for operators. The new helper includes all ordinary active members separately, preserving Knowledge's broader member access.

create_paige_durable_work keeps all existing validation, active-tenant guard, thread ownership, immutable identity, replay and service-only ACLs. Only exact pairs knowledge_extract/knowledge.extract and knowledge_publish/knowledge.publish enter the new branch. A reserved kind with the wrong capability, or reserved capability with a different kind, is refused. Before checking new authority it locks the actor profile with FOR SHARE and requires that selected tenant. Every other kind retains the original literal-active-membership check.

get_paige_durable_work keeps the same safe return columns. Knowledge pairs additionally require current raw selection and the new active actor predicate. Visibility remains initiating actor, platform owner, canonical tenant admin (including company operator), or an active exact-tenant membership with is_owner=true. An ordinary member cannot see another member's work. Every other kind retains its original platform-owner or active member/initiator/owner/admin predicate, including its original selection behavior.

These changes do not make authority_context reusable permission or scope_epoch a monotonic selection version. Later Knowledge start/complete/recover adapters must recheck authority, freeze source/content/revision identity and fence each attempt. Generic heartbeat/transition functions are unchanged. The existing document worker rejects Knowledge kinds; no accidental document execution occurs.

## Isolation and compatibility

The migration changes only three function definitions: the new helper, create_paige_durable_work and get_paige_durable_work. No table, policy, role grant, native transition, document-authoring function or lifecycle trigger is changed. The new helper alone gains service_role EXECUTE; existing function ACLs are restated unchanged. The unconditional knowledge_lifecycle_frozen guard remains active and is tested.

Tests execute the actual 20270417000000 native envelope and 20270418000000 document migrations. Auth users, tenant authority helpers, ancillary table shapes and net.http_post are explicit local fixtures. The HTTP stub performs no network action; absent pg_cron schedules nothing. Document submission, replay, owner-safe status and start dispatch are exercised; provider generation/completion is not claimed tested.

The regression deliberately confirms that the new auth.users ban check does not alter non-Knowledge generic creation. Tightening every work kind would be a separate shared-authority change. Existing document start still enforces its literal membership and owner/admin/coach checks; company-operator reach is not added to it.

## Executed checks

- Failing first: durable-check.py --baseline failed because knowledge_actor_authorized was missing.
- durable-check.py --psql <PostgreSQL16 psql path>: 47 SQL assertions and one concurrent selected-profile race; migration replay twice. pg_stat_activity confirms the competing profile update reached its locked wait before creation starts.
- Test databases are unique disposable names on localhost:55439 and are dropped afterward. Existing cluster is not reset.
- Migration generated using Supabase CLI then ordered after foundation as 20270530600000.
- No TypeScript or UI files changed; no full build/compile. Independent review is parent-owned and pending.
- No push, PR, merge, deployment, source binding, draft submission or Knowledge lifecycle activation.

## Independent review repair

The parent identified that the Knowledge status branch omitted the existing membership is_owner=true alternative when role remains member/coach. The actual SQL test first failed for an active member owner flag reading another member's Knowledge work. Added that exact-tenant active-owner alternative under the unchanged current Knowledge actor/selection guard. Tests also refuse the inactive owner flag and ordinary membership without the flag. All 47 SQL assertions plus the concurrent switch race and old document regression pass after the repair.
