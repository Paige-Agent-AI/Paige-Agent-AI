# Fulfillment source preparation — no activation

Supporting preparation while task-creation CI runs. This is not a delivered handoff or a new source of customer commitments.

1. Human outcome: turn an eligible accepted engagement into accountable canonical project work, then distinguish preparation, review and explicit client acceptance.
2. Owners: Operations owns fulfillment; Sales owns commercial/signing facts, Clients owns identity and receiving acceptance. Team owns people. No Finance or Chat executor change.
3. Harness: existing Planning/manual authenticated seams for project work; existing governed capability path for PAIGE. No new dispatcher or scheduler.
4. Spine: existing `planning.create`, `planning.assign_task`, `planning.add_milestone`, `planning.update_item` are reusable. Fulfillment handoff and client acceptance capability contracts are UNAVAILABLE until source-owned implementation and registration exist.
5. Providers: none in this preparation. No email, signing provider action, client notification, spend or INT-346 activation.
6. Authority: target-tenant membership/administration, literal standalone/no parent, preserved caller permissions; no signature inferred from terms status. Existing Trust is the sole governed approval mechanism.
7. Durable events: native event/durable work only if an actual eligible producer is extended. Repeated event identity must resolve to the same commitment/project; do not create duplicate plans.
8. Readback: source version/hash and engagement eligibility must be server-resolved; internal task completion cannot prove client outcome. Acknowledgement, attempt and independently verified result remain separate.
9. Surface: approved Delivery and Projects destinations; canonical shell. Current Delivery is read-only signing/terms context, not operational acceptance.
10. Proof: draft/unsigned/cross-tenant/stale-version/refused/duplicate handoff negatives, immutable provenance, task/project readback and Client-owned acceptance proof. Customer runtime and consequential activation remain separately gated.

## Sources actually inspected

- `plans` and `plan_items`: existing canonical containers, milestones/tasks, parent links, tenant/client references, metadata, audit and version fields. Preserve these instead of another project/task engine. `campaign_ref` is a soft reference and is not evidence of approved fulfillment.
- `paige_agreements`: same-tenant contact/offer/commercial-terms relationships; draft/sent/viewed/partially_signed/completed/declined/voided/expired; integer frozen version; content and sealed hashes/storage references; source template version; completion timestamp. Completed signature requires sealed evidence. This is signing completion, not delivered or client-accepted work.
- `tenant_client_agreements`: separately mutable commercial terms. Do not treat their active/completed status as signature execution or frozen fulfillment obligations.
- `useSoloAgreementSignings`: safe UI projection currently omits frozen integer version and exact hashes. `hasSealedCopy` is useful display context, not a complete server handoff contract. Never expose signer tokens or private storage keys to Operations consumers.
- Existing `read_sales_commercial_package` provides commercial package context. Invoice delivery-channel intents concern communications, not service fulfillment.
- `studio_deliverable` is the existing generated artifact/provenance home; it does not establish review or client acceptance. Catalog `client_delivery` skills are listings, not execution proof.

## Capacity source boundary

Production metadata-only inspection found Calendar `staff_calendar_settings.availability_json`, `calendar_hosts.availability_json`, calendar/internal-booking capacity and bookings. Staff settings default to Mon–Fri09:00–17:00: this default MUST NOT become confirmed working hours or40hours of capacity. Offered booking windows, inherited host windows and appointment capacity are distinct from employee working availability. Secret personal calendar connection columns are outside the Operations projection.

`profiles.coach_capacity` counts client capacity, not work hours. CRM task `metadata.estimated_minutes` already has a task schema contract and can be presented as a validated recorded estimate. Planning work has no typed effort/working-hours column established by current inspection. Missing effort/confirmed availability stays unknown; no utilization denominator is invented. Calendar and Team remain source owners.

## Contracts still absent or unproven

Structured source-version-linked fulfillment obligations, replay-safe accepted-engagement handoff, deliverable revisions/review and Client-owned explicit acceptance, recorded working-hours authority and full governed conversational completion need implementation/proof. No default calendar window, signed agreement, paid invoice, catalog entry or internal completed card satisfies them. This packet grants no customer-data or provider authority.

## Bounded signed-source fixture implementation
A pure readiness inspector consumes only server-resolved Sales evidence and preserves agreement/client/terms/offer/version/content hash/sealed hash. It distinguishes unavailable, source mismatch, incomplete signing, missing sealed evidence and ready for scope review. Every result explicitly retains handoffAuthorized=false and clientAccepted=false. This is preparation, not a registered or callable handoff: the existing browser signing projection lacks this exact provenance, and approved structured fulfillment obligations/server persistence/replay identity are still owed. No Sales records, shared Chat path or provider connection changed.
Failing-first module-import suite failed with zero tests before implementation; an initial dependency-junction command failed before tests and was corrected to an absolute target. Final isolated fixture suite22 assertions PASS and scoped ESLint PASS. No hosted SQL or authenticated acceptance claimed.


### Read seam pre-edit scope
The next bounded source preparation is a single agreement evidence projection under caller RLS. Outcome: inspect exact frozen Sales provenance before any fulfillment proposal. Operations consumes, Sales retains records and commercial authority. Existing authenticated gateway/caller scope only; agreement.list/status are current Spine reads, this Operations function remains UNAVAILABLE in Spine until implemented/reviewed/registered. No provider connection, mutation approval, durable event, notification, new store or scheduler. It returns only allowlisted signing references/hash/version and sealed-copy presence, explicitly false handoff/client-acceptance claims; no tokens/storage keys/body/signers. Existing Delivery surface is unchanged and binding remains partial. Caller/tenant/role/Solo/ACL and payload-negative rollback SQL are owed. DEV00417 is unallocated/unapplied; no release or authenticated evidence.


Read preparation now includes12 rollback-owned SQL assertions for effective ACL, caller-RLS frozen provenance, withheld private payload, explicit non-authority/non-acceptance, actor/workspace/missing-source and Agency refusals. All12 UNEXECUTED and not CI-registered yet. Migration collision lint1246 and definer lint PASS locally; neither is database execution. No production claim.


Added rollback-only parented-standalone and revoked-membership source refusals, bringing signing-source SQL assertions to14, all UNEXECUTED. Uses database-owner setup only for owned hierarchy fixture and restores caller claims before invoking unchanged evidence reader. No handoff authority or client acceptance inferred; migration remains development-only/unallocated.

Added bounded signing RPC response normalization: exact actor/tenant/agreement envelope, typed source-only projection, rejects misleading execution/client-acceptance flags, preserves incomplete signing facts without fabricating seals. Pure source preparation only; no hook, UI activation or write. Local36tests/2files PASS and scoped ESLint PASS. Failing-first missing-module suite executed0tests; an earlier sandbox test process was interrupted without a result and is not counted. SQL14 remains UNEXECUTED and development migration unallocated.

Pure normalization a1c0b8c6a independently COMPLETE. Added selected-agreement read hook using the existing request gate and actor-before/after fence; selection/workspace switches hide old evidence and late responses are discarded, 42501 refusal remains distinct from unavailable recovery. No UI mount, writes or handoff activation. Fresh44tests/3files and scopedlint PASS, including actual hook tenant switch; failing-first hook module missing executed0tests. New final-source review remains owed; SQL14 stillUNEXECUTED/unallocated.

Unmounted read-hook source299871203 independently COMPLETE, no material findings. Integrated latest native parent/forward250 and priority327 fixture-order repair mechanically. Full local Operations regression189tests/26files PASS. Direct installed tsc finished with10 signatures exactly matching committed baseline10; no newtypeerrors (plain tsc exits1). Earlier npx ratchet wrapper interrupted without result, not a passing command. No SQL execution, deployment or authenticated acceptance inferred.

Forward preparation based on inspected production230/currentmaina138/all26openPRfilelists and local queued240/250: no260 reserved. Renamed DEV417→proposed20271020000260 byte-identically and registered existing14 rollback signing-source assertions in database-contract. Unapplied and UNEXECUTED; no source release PR or production activation. Recheck registry and reconcile actually released predecessors before promotion.

### Frozen signing inspection — pre-edit affected flow
Owner outcome: inspect whether a selected Sales signing has complete immutable evidence before preparing fulfillment. Sales owns the source; Operations only reads. Reuse the reviewed actor/tenant/selection-fenced evidence hook and current Delivery inspection drawer. No new gateway, Spine key, provider, approval channel, durable job, receipt or executor; handoff capability remains UNAVAILABLE. Frozen evidence is a prerequisite for scope review, never execution authority or client acceptance. Mount only inside the selected, readable engagement inspection, with current workspace/actor and exact signing/client/terms/offer. Loading, refusal, missing evidence and source mismatch must remain distinct; retries reuse the same selected source. Existing V3 drawer, tokens, focus and responsive layout remain. Binding stays partial; synthetic rendered/unit proof and independent final review are owed, authenticated customer acceptance remains UNVERIFIED. No source hashes/private signing payload in consumer copy.

Frozen signing inspection now mounts only in the current readable engagement drawer; caller actor joins the existing workspace epoch so actor changes mask prior selection and signed-copy state. It uses the reviewed exact-source reader, shows signed version/sealed presence, and distinguishes incomplete/mismatched/unavailable evidence. No handoff button, execution permission, private hashes or client-acceptance claim. Initial restricted-worker EPERM and missing-component/dependency collection failures executed zero tests; the test now uses installed React/createRoot without installing dependencies. Focused48 tests/4files PASS, full193tests/27files PASS, scopedESLint PASS. Fresh type check and independent source/rendered review remain pending. SQL14 remains UNEXECUTED and migration260 proposed; no production or authenticated acceptance.
