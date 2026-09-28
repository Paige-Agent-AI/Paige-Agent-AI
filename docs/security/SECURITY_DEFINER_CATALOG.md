# SECURITY DEFINER Function Catalog — `public` Schema

Living registry of every `SECURITY DEFINER` function in `public` that retains `EXECUTE` for `anon` or `authenticated`. Format per Doctrine §124 v2.

**Categories:**
- **A** — Intentional user-facing public API
- **B** — Public-flow with internal auth check (called unauthenticated but verifies caller identity/state internally)
- **C** — Trigger/cron/internal only (should never have anon; authenticated allowed only when invoked from RLS policies)

Last reviewed: 2026-07-02 · Reviewer: Lovable Agent (Paige Agent AI) · §205 Metering Safety Net added

---

## Category B — §205 Metering Dead-Letter (Fire-and-Forget)

The following functions support the §205 metering safety net. All have `SET search_path = ''` in the function body and EXECUTE is restricted to `service_role` (or admin-gated for the observability RPC). See `docs/security/DOCTRINE_205_METERING_SAFETY_NET.md`.

- `public.pmedl_touch_updated_at()` — BEFORE UPDATE trigger on `platform_metered_events_dead_letter`. EXECUTE revoked from PUBLIC/anon/authenticated. Runs only as trigger.
- `public.pmedl_notify_admin()` — AFTER INSERT trigger that fans out `paige_admin_notifications` with dollars-at-risk metadata. EXECUTE revoked from PUBLIC/anon/authenticated.
- `public.pmedl_retry_scan()` — pg_cron worker (`pmedl_retry_scan_every_15m`) that marks pending rows for retry and auto-escalates rows past 10 attempts. EXECUTE granted to `service_role` only.
- `public.admin_metering_dead_letter_summary()` — admin observability RPC (grouped counts, dollars at risk, oldest/most-recent failure). EXECUTE granted to `authenticated` + `service_role`; body enforces `has_role(admin|super_admin)` and raises `not_authorized` otherwise.

**Justification (Category B):** These functions must bypass RLS on `platform_metered_events_dead_letter` and `paige_admin_notifications` to guarantee at-least-once metering delivery even when the caller has no direct table access (edge function / cron / user request path). Loss of a metering event = revenue leak = §120 case-study candidate.

---

## Anon + Authenticated (Category B — public flow with internal check)

### Function: public.peek_tenant_invite
Grants: anon + authenticated
Category: B — Public-flow with internal auth check
Justification: Unauthenticated invite landing page reads token metadata (tenant name, invited email) before signup. Function only accepts a signed invite token; no PII returned beyond the invited email.
Auth-check location: Body — validates `token` exists in `invitations`, unexpired, unaccepted.
Regression test: manual — POST with invalid token returns null; expired token returns null.
Re-review triggers: adds PII columns · token verification relaxed

### Function: public.record_communications_consent
Grants: anon + authenticated
Category: B — Public-flow with internal auth check
Justification: GLBA/TCPA consent capture from public marketing forms (PublicSignup, AffiliateApply). Row is append-only and stamped with request context.
Auth-check location: Body — writes to `communications_consents` with server-side `now()` and IP; no read/update surface.
Regression test: manual — repeated calls create separate rows; cannot mutate existing consent.
Re-review triggers: mutation path added · schema exposes prior consents

### Function: public.has_email_marketing_consent
Grants: anon + authenticated
Category: B — Public-flow with internal auth check
Justification: Boolean-only helper used by unsubscribe/preference landing pages before login. Returns TRUE/FALSE only; leaks no address or identifier the caller didn't already supply.
Auth-check location: Body — key by supplied `_email` param; no enumeration.
Regression test: manual — random emails return false, do not raise.
Re-review triggers: signature adds enumeration surface

### Function: public.has_sms_consent
Grants: anon + authenticated
Category: B — Public-flow with internal auth check
Justification: Mirror of email consent for SMS opt-in checks on public STOP/HELP handlers.
Auth-check location: Body — keyed by supplied `_phone`.
Regression test: manual — unknown phones return false.
Re-review triggers: signature broadens

---

## Authenticated only — Category A (intentional user-facing RPCs)

### Function: public.has_role
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Canonical role check used by every client hook. Signature `(_user_id, _role)` — caller passes their own uid; no privilege escalation possible.
Last reviewed: 2026-07-01

### Function: public.has_any_role / public.is_admin / public.is_staff / public.is_platform_owner / public.is_tenant_admin / public.is_tenant_owner / public.is_tenant_member / public.has_tenant_role
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Boolean role predicates used by RLS policies and UI gating. Return TRUE/FALSE against caller's own uid or supplied uid; no data leak.

### Function: public.current_user_roles / public.current_user_tenant_id / public.get_user_primary_tenant
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Returns roles/tenant for `auth.uid()` only. Used by AppShell for routing.

### Function: public.check_feature_access / public.tenant_has_feature / public.get_user_business_limit
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Entitlement lookups for the current tenant. Scoped by `has_tenant_role` internally.

### Function: public.client_view_ready / public.client_onboarding_status
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Readiness gate used by both the client's own dashboard and staff impersonation button. Internally checks `can_access_contact` when caller ≠ contact owner.

### Function: public.client_advance_onboarding_stage
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Client self-service stage progression (auth → agreement → intake). Internally enforces `linked_user_id = auth.uid()` and validates target stage transition.
Auth-check location: RAISE EXCEPTION if `linked_user_id <> auth.uid()`.
Regression test: manual — cross-client call refused with named error.

### Function: public.start_client_impersonation / public.end_client_impersonation
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Admin impersonation control. Internally requires `is_staff(auth.uid())` AND `client_view_ready(contact_id)`; writes audit row on every call.
Auth-check location: RAISE EXCEPTION on missing staff role or readiness gate failure.

### Function: public.accept_tenant_invite / public.accept_invitation / public.create_tenant_invite_token
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Invite acceptance flow after signup. Validates token → assigns tenant role. Token creation requires `is_tenant_admin`.

### Function: public.revoke_platform_access
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Admin soft-revoke of staff role. Requires `is_admin(auth.uid())` internally.
Auth-check location: RAISE EXCEPTION unless caller is admin.

### Function: public.admin_bulk_assign_coach
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Admin coach assignment. Requires `is_admin` or `is_tenant_admin`. (admin_remove_coach_role, formerly listed here, was dropped by 20270511000000.)

### Function: public.claim_client
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Sales rep claims an unassigned lead. Enforces `has_any_role({sales_rep, admin})` and unassigned status.

### Function: public.update_profile_ssn
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Owner-only SSN write; stores encrypted ciphertext + `ssn_last_4`. Enforces `id = auth.uid()`.
Auth-check location: RAISE unless target row owner.

### Function: public.get_my_ssn_last_4
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Returns caller's own `ssn_last_4`. Keyed on `auth.uid()`; no parameter.

### Function: public.get_profile_with_pii_log
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: PII read with audit log. Requires `can_access_contact` and inserts `paige_audit_log` row.

### Function: public.get_outstanding_consents
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Lists unsigned legal agreements for `auth.uid()`. Keyed on caller.

### Function: public.get_tenant_sender / public.tenant_sender_identity / public.get_workspace_brand
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Returns tenant brand/from-address for compose UI. Requires `has_tenant_role`.

### Function: public.match_paige_memory / public.match_tenant_knowledge
Grants: authenticated (+ service_role on match_paige_memory)
Category: A — Intentional user-facing public API
Justification: Vector search RPCs. Internally scope by tenant. `match_paige_memory` (2026-09-13,
migration `20270304000000`, §53/§59) derives authority PER TARGET — cross-USER: self /
`is_platform_operator`; staff cross-CONTACT via `can_access_contact` (per-contact tenant-correct) — with
each data-branch gated on its own flag and search params bounded; `service_role` is trusted to pass
server-resolved ids. anon/PUBLIC revoked.

### Function: public.get_approval_queue_counts / public.unassigned_queue_for_caller
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Dashboard queue counts scoped to caller's role and tenant.

### Function: public.compute_contact_readiness / public.set_journey_stage
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Contact readiness score + journey stage transition. Enforces `can_access_contact`.

### Function: public.delete_credit_report_upload
Grants: authenticated
Category: A — Intentional user-facing public API
Justification: Owner-scoped credit report deletion. Requires `linked_user_id = auth.uid()` or `is_staff`.

### Function: public.tenant_feature_enabled
Grants: authenticated + service_role
Category: B — Public-flow with internal auth check
Justification: Boolean-only per-vertical feature gate (§189). Returns FALSE if row missing or feature name unknown; never raises, never reveals other tenants' flags.
Auth-check location: N/A (read-only, tenant_id parameter supplied by caller). Called from UI gates + policies.
Regression test: manual — unknown tenant returns false; unknown feature returns false.
Re-review triggers: signature changes · adds data-returning branches

### Function: public.admin_get_automation_webhook_url
Grants: authenticated + service_role
Category: B — Public-flow with internal auth check
Justification: Returns pgcrypto-decrypted webhook URL to tenant admins only. Every read writes a `pii_access_log` row.
Auth-check location: `RAISE EXCEPTION 'not authorized'` unless `is_platform_owner()` OR `is_tenant_admin(_tenant_id)`.
Regression test: manual — non-admin call raises; admin call returns plaintext + creates pii_access_log row.
Re-review triggers: audit log skipped · authorization branch relaxed

### Function: public.admin_set_automation_webhook_url
Grants: authenticated + service_role
Category: B — Public-flow with internal auth check
Justification: Encrypts and stores tenant webhook URL. HTTPS-only enforcement in body. Audit-logged.
Auth-check location: `RAISE EXCEPTION 'not authorized'` unless `is_platform_owner()` OR `is_tenant_admin(_tenant_id)`. HTTPS scheme enforced.
Regression test: manual — non-https URL rejected; non-admin call raises.
Re-review triggers: scheme validation removed · audit log skipped

---

## Trigger-only (Category C — no EXECUTE grant)

### Function: public.on_deal_stage_change
Grants: none (revoked from PUBLIC, anon, authenticated)
Category: C — Trigger/cron/internal only
Justification: AFTER UPDATE OF stage_id trigger on `public.deals`. Resolves active rule, records event row, POSTs to dispatcher edge function. Every path (no rule / inactive / no webhook / dispatched) writes an audit row.
Regression test: manual — non-existent rule → skipped_no_rule row; inactive rule → skipped_inactive; missing webhook → skipped_no_webhook.
Re-review triggers: EXECUTE granted to any role · additional table writes added

### Function: public.ensure_tenant_features_row
Grants: none (revoked from anon, authenticated)
Category: C — Trigger/cron/internal only
Justification: AFTER INSERT trigger on `public.tenants` that inserts the corresponding `tenant_features` row with all vertical flags = false. Guarantees `tenant_feature_enabled()` always finds a row for real tenants (§189).
Re-review triggers: writes beyond `tenant_features` added · logic reads other tables

### Function: public._automation_webhook_key
Grants: none (revoked from anon, authenticated)
Category: C — Trigger/cron/internal only
Justification: Internal fetch of `_internal_secrets.automation_webhook_key` for pgcrypto encrypt/decrypt of tenant webhook URLs. Never returned to any client-facing path.
Re-review triggers: called from a non-crypto path · EXECUTE granted

---


## Authenticated only — Category C (RLS-helper; internal use)

These are called from RLS policy expressions and therefore must remain executable by the authenticated role (policies run as the calling user). They never return data by themselves; they return booleans/ids consumed by policy `USING` clauses.

- `public.can_access_contact(uuid)`
- `public.coach_can_access_user(uuid)`
- `public.client_has_role_assigned(uuid, app_role)`
- `public.is_assigned_to_client(uuid, uuid)`
- `public.is_btf_assigned_coach(uuid, uuid)`
- `public.is_btf_client_owner(uuid, uuid)`
- `public.is_broker_team_member_of(uuid, uuid)`
- `public.get_broker_team_member(uuid)`
- `public.get_business_hierarchy(uuid)`

Justification: All return booleans/ids scoped to caller. Removing `authenticated` EXECUTE would break every RLS policy that references them. Anon EXECUTE already revoked.
Re-review triggers: any of these gains a data-returning overload · function begins reading unrelated tables

---

## Revoked functions (for audit trail)

Anon + authenticated EXECUTE was previously revoked from the following internal trigger/cron functions and must remain revoked:
`auto_stub_business_from_contact`, `ensure_client_role_self_heal`, `notify_approval_event`, `email_queue_dispatch`, `enforce_doctrine_120`, `enforce_doctrine_120_full`, `enforce_subagent_doctrine_116`, `enforce_subagent_doctrine_124`, and the paired weekly-sweep functions.

### Business Vault Phase 2 security-definer registry

Authenticated, tenant-resolving API (Category A): `business_vault_access_status`, `business_vault_inspection_capability`, `business_vault_snapshot`, `business_vault_get_context`, `business_vault_reserve_quarantine_upload`, `business_vault_save_contract`, `business_vault_save_obligation`, `business_vault_archive_record`, `business_vault_propose_fact`, `business_vault_review_fact`, and `business_vault_download_version`.

Justification: every entry resolves the caller's active tenant and active owner/admin membership server-side. Record-scoped functions re-check tenant, role, visibility, lifecycle, and current-version state; owner-only dependent rows use the same visibility boundary. Regression proof: `supabase/tests/business_vault_phase2_security.sql` (71 executable actor/database assertions).

Service-only quarantine maintenance (Category B): `business_vault_mark_quarantine_stored`, `business_vault_claim_quarantine_inspections`, `business_vault_record_inspection_result`, `business_vault_claim_quarantine_cleanup`, `business_vault_complete_quarantine_cleanup`, `business_vault_defer_quarantine_cleanup`, `business_vault_claim_stale_uploads`, and `business_vault_cancel_stale_upload`.

Justification: browser roles have no execute authority. These functions accept only opaque identifiers and bounded scalar evidence; safe events never store extracted document text or secret values. Cleanup is leased, retryable, and cannot record deletion while the quarantine object still exists.

Disabled/internal-only (Category C): `business_vault_claim_quarantine_promotions`, `business_vault_promote_quarantine_upload`, `business_vault_fail_quarantine_promotion`, legacy `business_vault_reserve_upload`, and legacy `business_vault_finalize_upload`. No browser or service-role EXECUTE grant exists. Promotion remains disabled until an approved inspector and exact-byte worker are separately reviewed and proven.

Re-review triggers: any new Vault role grant; inspection configuration activation; storage bucket/policy changes; promotion worker/provider addition; relaxing lifecycle/current-version checks; recording raw extraction or scanner payloads; client sharing; Paige/Mind/Rail/Systems Check writes.

---

## Re-review cadence

- Weekly `pg_cron` job `doctrine_124_weekly_sweep` diffs live grants against this catalog and raises `paige_admin_notifications` on drift.
- Any migration that alters a function body or expands its grant list MUST update this file in the same PR.

---

## §190 pgcrypto column-encryption pattern (registry)

All getter/setter RPC pairs implementing the §190 Column Encryption Standard land here as Category B with the standard justification block. See `docs/security/DOCTRINE_190_191_192.md` for the full pattern.

Current entries:
- `public.admin_get_automation_webhook_url` / `public.admin_set_automation_webhook_url` (Ship #1 reference implementation — already cataloged above under Category B).

Queued entries (land with their respective ships):
- `admin_get_google_calendar_refresh_token` / `admin_set_google_calendar_refresh_token`
- `admin_get_twilio_auth_token` / `admin_set_twilio_auth_token` (root-tier migration under §192)
- `admin_get_stripe_webhook_secret` / `admin_set_stripe_webhook_secret`
- `admin_get_n8n_webhook_url` / `admin_set_n8n_webhook_url` (retrofit)


---

## Category D — Trigger Function Hygiene

**Scope:** `SECURITY INVOKER` trigger functions that pin `search_path = ''` for §180 hygiene even though they don't run with elevated privileges. Different risk profile than Categories A/B/C: no privilege escalation surface (writes only to `NEW`), but still deserves catalog visibility so search_path drift is caught by the §124 weekly sweep.

**Rule:** Trigger functions in the `public` schema that touch only `NEW`/`OLD` should be `SECURITY INVOKER` (default) with `SET search_path = ''`. Never `SECURITY DEFINER` unless the trigger legitimately needs to bypass the invoker's RLS — and if it does, promote it to Category A/B with the standard justification block.

### Current entries

- `public.pme_set_subject_id()` — BEFORE INSERT/UPDATE trigger on `public.platform_metered_events`. Auto-populates `subject_id` from `tenant_id` or `consumer_user_id` based on `layer`. `SECURITY INVOKER`, `search_path = ''`. Landed in Migration A (Sprint P.0.1 Gate 1, §206).

---

## Calendar booking-preset + booking server seam (E6 registration, 2026-09-13)

Registered by the E6 Calendar security/proof/reviews pass. Reviewer: Claude Code (E6, 2026-09-13) — calendar seam only; the global "Last reviewed" date above is NOT bumped (no full-catalog re-review was performed — §13). Every function below was §59-classified against its live body; the class here is the **§124 catalog** taxonomy (A/B/C above), and each entry notes the §59 in-body caller-scope proof. **Boundary proof:** `supabase/tests/calendar_booking_preset_seam.sql` (112 pgTAP assertions, incl. G1–G12 grant + `SET ROLE anon` refusal, and every cross-tenant/non-member 42501), CI-gated by `.github/workflows/calendar-preset-seam.yml`.

Migrations: `20270301000000_calendar_booking_preset_lifecycle.sql`, `20270302000000_calendar_preset_duplicate_archive_restore.sql`; RLS + helpers `20260708210000_calendars_first_class.sql`; guest-booking write RPCs `20260712130000_booking_rpc_isolation_hardening.sql` + `20260709181825_create_class_booking_contact_id.sql` (+ E6 LOW-1 tenant-consistency guard `20270312000000_create_class_booking_tenant_scope_guard.sql`); booking edit `20270125000000_calendar_update_internal_booking.sql`.

### Preset lifecycle RPCs — Category A (authenticated + service_role; anon REVOKED)
All eight are `SECURITY DEFINER … SET search_path` and route authority through `_assert_can_manage_preset` (or an explicit membership RAISE), so the EXECUTE grant is never the guard.

- `public.create_calendar_preset(uuid,text,jsonb,uuid)` — creates a PRIVATE DRAFT (`enabled=false, published_at=NULL`), registers the creator as host 0. Auth-check: Body — authenticated caller must be `is_platform_admin() OR is_tenant_admin(_tenant) OR is_tenant_member(_tenant)` (RAISE 42501); `_created_by` honored only when `auth.uid()` is NULL (service-role). `_patch` column allowlist forbids setting `enabled`/`published_at`/`slug`/`tenant_id`/`created_by`. Re-review triggers: allowlist relaxed · draft-by-default changed · grant widened to anon.
- `public.update_calendar_preset(uuid,jsonb,uuid)` — config edit; CASE-per-key allowlist; auto-pauses a Live preset an edit pushes below the publish bar; refuses an archived preset with `PRESET_ARCHIVED`. Auth-check: Body — `_assert_can_manage_preset` (RAISE 42501). Re-review: allowlist relaxed · archived-frozen guard removed.
- `public.publish_calendar_preset(uuid,uuid)` — sets `enabled=true` only after `_calendar_preset_block_reason` passes (hosts / open window / usable method); refuses archived with `PRESET_ARCHIVED`. Auth-check: Body — `_assert_can_manage_preset` (RAISE 42501); service-role `_tenant` must equal the row tenant. Re-review: block-reason relaxed.
- `public.pause_calendar_preset(uuid,uuid)` — `enabled=false`, KEEPS `published_at` (Paused ≠ Draft). Auth-check: Body — `_assert_can_manage_preset`.
- `public.duplicate_calendar_preset(uuid,text,text,uuid,uuid)` — copies config + host pool into a NEW private draft. Auth-check: Body — `_assert_can_manage_preset` on the SOURCE (RAISE 42501); `23505` on slug collision; service-role requires `_created_by`.
- `public.archive_calendar_preset(uuid,uuid)` — sets `archived_at`, `enabled=false`, keeps `published_at`; idempotent. Auth-check: Body — `_assert_can_manage_preset`.
- `public.restore_calendar_preset(uuid,uuid)` — clears `archived_at`, keeps `enabled=false` (returns to Draft/Paused, never straight to Live). Auth-check: Body — `_assert_can_manage_preset`.
- `public.get_calendar_presets(uuid)` — tenant-scoped coarse projection + derived lifecycle. Auth-check: Body — authenticated caller membership on `_tenant` (RAISE 42501); service-role scoped by `WHERE tenant_id = _tenant`. Re-review: adds a column that leaks another tenant's data.

### Preset helpers
- `public._assert_can_manage_preset(uuid,uuid)` — Category A (authenticated + service_role). The shared in-body guard: authenticated → `can_manage_calendar(_cal)` RAISE 42501; service-role → `_tenant` must equal row tenant, RAISE 42501; RAISE `PRESET_NOT_FOUND` (P0002) if absent.
- `public._calendar_preset_block_reason(uuid)` — **Category C (internal-only)**. `SECURITY DEFINER STABLE`, EXECUTE `REVOKE`d from PUBLIC + anon + authenticated + service_role (proven G10); reachable ONLY by its DEFINER callers, so it cannot be used to probe another tenant's config. Re-review: any GRANT added.

### RLS helper predicates — Category A (authenticated)
- `public.can_manage_calendar(uuid)` / `public.is_calendar_host(uuid)` — `SECURITY DEFINER STABLE` boolean predicates keyed on `auth.uid()`; RLS-cycle breakers for the `calendars`/`calendar_hosts` policies. Return TRUE/FALSE against the caller's own uid; no data leak.

### Guest-booking write RPCs
- `public.create_internal_booking(...)` — Category A (authenticated + service_role). `SECURITY DEFINER`; in-body: `_host := COALESCE(_host_user_id, auth.uid())`, caller must be creator / `is_tenant_admin(_tenant)` / scoped `is_tenant_member`; contact-isolation hardened (`20260712130000`).
- `public.create_class_booking(...)` — **Category B (service_role only; anon + authenticated REVOKED)**. `SECURITY DEFINER`; sole caller is the `public-booking` edge resolver, which passes SERVER-derived `_tenant_id`/`_host_user_id`/`_calendar_id` (never client input). **§59 in-body guard (E6 LOW-1, migration `20270312000000`):** now asserts `_tenant_id = calendars.tenant_id` (RAISE 42501), closing the latent cross-tenant mis-write hazard; proven by `supabase/tests/create_class_booking_tenant_scope.sql` (5/5). The host-membership assert (`_host_user_id ∈ calendar_hosts`) is deliberately NOT added (could break a legitimate class booking; deferred — see the E6 package). Re-review: any new caller; grant widened.
- `public.update_internal_booking(uuid,text,text,text,uuid,uuid)` — Category A (authenticated + service_role; anon REVOKED). `SECURITY DEFINER`, `_caller := auth.uid()`, in-body scope on the booking's tenant/host. **Not yet persisted on prod** (PR #1176 pending — tier-matrix keeps it "pending persisted-apply", §32.a). Re-review: on persisted-apply, confirm the grant + body match this entry.

### Adjacent seam — NAMED FOLLOW-UP, not classified here (§13)
`public.cancel_internal_booking(...)` / `public.reschedule_internal_booking(...)` (`20260711340000_paige_planning.sql`, a pre-E3 seam) are `SECURITY DEFINER` and use `has_any_role(auth.uid(), ARRAY['admin','super_admin','coach'])` — a **tenant-agnostic global-role check (§53 trap surface)** — alongside `owner/created_by = auth.uid()`. Whether that admits a cross-tenant path needs its own §53/§59 body review before a catalog classification is asserted; E6 does NOT rubber-stamp it. Tracked as an E6 named follow-up (see the E6 package).
