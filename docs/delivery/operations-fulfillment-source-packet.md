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
