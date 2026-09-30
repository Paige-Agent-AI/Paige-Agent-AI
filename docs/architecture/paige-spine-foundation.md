# PAIGE Spine foundation

This foundation is a governed seam across the existing Solo product. It does not create a second Rail, event bus, memory store, approval store, or PAIGE workspace.

## Canonical contract

`supabase/functions/_shared/paige-spine/registry.ts` is the canonical capability registry. A domain-owned declaration must name:

- one stable capability key and domain owner;
- the existing human surface;
- exact server-side evidence, action, and outcome symbols;
- evidence audience, freshness, exact safe field/fact values, and projection visibility window;
- action classification, exact Chat tool, idempotency, canonical risk policy, and approval authority;
- Chat and Mind binding maturity;
- either `NONE` or an approved Spine Change Request identifier for shared primitives.

The registry fails closed at import and in CI. A mutable or external-effect capability must have a `LIVE` Chat binding, an exact Chat tool mapped to `ordinary` or `high` in Chat's canonical action-risk policy, `chat-canonical` approval authority, and idempotency. `prepare` is not an action class: consequence previews are preconditions to the separately gated action, never a second approval. A declaration alone does not make a capability live.

## First vertical slice

`pipeline.deal_stage_evidence` reads existing successful Pipeline deal-stage outcomes from `paige_client_events`. Direct authenticated Rail access stays revoked. A narrowly granted SECURITY DEFINER safe lens pins its search path, requires a live authenticated caller, resolves the active tenant on the server, checks the canonical staff role, addresses the client by its immutable public-safe `account_number`, and emits only the fixed Spine fields. Raw Rail title, summary, payload, user identifiers, internal deal identifiers, and stage content remain behind the boundary.

The `tenant_id`, signal UUID, and opaque `rail:` references in the contract are server-consumer scope/provenance evidence, not presentation copy. The 365-day value is a safe projection visibility window; source Rail retention remains independently domain-owned.

This slice is `PARTIAL`: evidence is registered and the read-only Chat adapter has structural and targeted runtime proof, so the Chat binding is `PARTIAL`; authenticated preview proof is still required before `LIVE`. The **Mind binding is `PARTIAL`** as of 2026-09-02: `_shared/paige-spine/mindEvidence.ts` projects the same resolver result into a bounded, attributable Mind record — citation, freshness, read-only boundary — and Chat renders that projection rather than the raw signals, so the two cannot describe one record differently. That projection is deliberately the Pipeline domain's, NOT a platform-wide Mind primitive; generalising it so a second domain depends on its shape changes Mind-wide retrieval semantics and needs its own Spine Change Request. `LIVE` still requires the authenticated drive. See `docs/delivery/paige-spine-mind-handoff.md`. It intentionally registers no Pipeline mutation. Pipeline currently has domain-held move-approval semantics; a Chat-owned reconciliation is required before any mutation can join the Spine.

## Domain self-service

A domain owner may add its own declaration and safe adapter in a later immutable migration without modifying another domain when all of these remain true:

1. the human surface and durable source already exist;
2. tenant context is server-resolved and any privileged safe lens recreates the source authorization boundary explicitly;
3. only reviewed fixed fields and exact declared scalar fact values cross the boundary;
4. no shared registry schema, resolver semantics, approval authority, or Chat routing rule changes;
5. the domain adds focused registry, SQL contract, real-role isolation, and regression tests;
6. maturity stays truthful until authenticated end-to-end proof exists.

## Approved Spine Change Requests

### SCR-2026-09-02 — the Chat-facing block may carry the safe citation

**Approved by the owner, 2026-09-02, at Gate 1.** The rendered Chat evidence block now names
the opaque `rail:<uuid>` source reference and states the read-only boundary. The previous
contract withheld the reference deliberately and a merged test asserted its absence, which is
why this needed a request rather than an edit: `renderSpineEvidenceForChat` is the Chat
adapter contract, a shared primitive.

**Bound.** The `rail:` reference is the approved citation for this first Mind/Pipeline slice.
It stays tenant-scoped, is non-dereferenceable outside authorized context, and reveals none
of the forbidden raw fields. Nothing else widened: no registry schema, resolver semantics,
safe-field set, lifecycle vocabulary, approval authority, projection-window meaning, shared
store or event bus changed. Approval authority stays `none`; no Chat tool was registered.

**Honest note.** The citation is `'rail:' || <Rail event id>`, so that record's UUID is inside
it by construction. It is the one identifier permitted to cross; it names a record, not a
person or a deal, and it is asserted to appear only inside the citation and never loose.

### SCR-2026-09-05 — a workspace-level outcome projection

**Raised and approved by the owner, 2026-09-05, in this exchange.** His words, which are the
request: *"All of that stuff is supposed to be put on the spine and then obviously tracked on
the rails and recorded in the mind."*

This is the change `docs/architecture/paige-spine-tool-migration-map.md` carries as **SCR-1**,
recorded there as *"not requested, not started"* and named as the blocker on **47 of 60 actions
and every wave from 3 onward**. That map's own note says the `SCR-n` labels are shorthand and
whoever raises them gets a real dated name; this is that name.

**The constraint being lifted (map §2, C1).** `paige_client_events.contact_id` is
`uuid NOT NULL REFERENCES clients(id)`, `record_rail_event` refuses a contact outside the tenant,
and the Chat emitter returns early without one. A workspace-level outcome — a phone number bought,
a role granted, an automation run, a marketplace item installed — had **nowhere to be recorded**.

**Measured on production 2026-09-05 (ref `xygzykjyynhzqytbqnzu`), before the change:**

| | |
|---|---|
| `paige_audit_log` rows | **142** |
| `paige_workspace_events` rows | **10** |
| distinct `source_kind` among them | `mcp_connection`, `oauth_attempt`, `zapier_mcp_connection` — connections only |
| `has_table_privilege('authenticated','paige_client_events','SELECT')` | **false** (#746, still open) |

**Bound.** The change is additive and its blast radius is stated rather than assumed:

- ONE new `source_kind`, `capability_run`, with five outcomes of its own. No existing family's
  vocabulary, copy, envelope or trigger is altered. `agent_run` was rejected as a host because its
  copy describes handing work to a specialist, which a Zapier action is not; a `zapier_*` family
  was rejected because `get_zapier_rail_activity` calls a projection that RAISES on an unknown
  outcome, so one such row would take the whole Zapier panel dark.
- ONE new column, `capability_key`, constrained present for exactly this family and absent for
  every other, in both directions.
- The one writer and the one display projection are widened **by delegation**, not by copying:
  each gains a wider overload that carries the body, and the existing narrower signature becomes a
  thin delegate. Nothing that exists today was retyped, so the "rebuilt from the wrong ancestor"
  regression cannot occur.
- `record_capability_run` is service-role only on its 6-argument signature. Its in-body check
  requires the actor to be an ACTIVE member of the tenant the row is written for — that
  constrains the SUBJECT named in the arguments, NOT the caller, so it is not a §59 caller-scope
  guard and never carried the boundary alone. **The grant IS the boundary here**, which is why
  the 10-argument overload at `20270107000000:94` shipping with no ACL (default `EXECUTE TO
  PUBLIC`, body never calls `auth.uid()`) was a real hole IN THE REPO'S OWN HISTORY. MEASURED ON PROD 2026-09-24 (pg_proc.proacl): both signatures already read `{postgres=X/postgres,service_role=X/postgres}`, so the hole is NOT live. The migration is not applied and 20270107000000 carries no GRANT/REVOKE, so an out-of-band action set that ACL -- the migration's real job is making the lock REPRODUCIBLE from the repo. `20270416000000` re-asserts both
  signatures; prod apply is owed. An earlier version of this line claimed §59 caller-scope
  compliance, and a reader auditing §59 coverage would have ticked it off and moved on. It deliberately does not
  re-check role — that is the tool gate's decision, and duplicating it would silently drop the
  record of a legitimately approved run.

**Not widened.** No registry schema, resolver semantics, safe-field set, lifecycle vocabulary,
approval authority, projection window, shared store or event bus changed. No capability was
promoted; no `maturity` or `chatBinding` label moved. Approval authority stays where it is.

**Honest limits (§13).**
- Reads are deliberately not recorded, so this Rail carries what PAIGE **did**, never what she
  looked at. Six of the twelve n8n tools are reads.
- Nothing is recorded before the tenant/session fence passes, so a refusal the model earns
  (unknown tool, approval missing, bad arguments) leaves no row. That preserves the existing
  "no outbound call at all" property, which is worth more than the row.
- Two capabilities are wired as its first consumers. **The other ~47 are not** — each migration
  wave adds its own `capability_key` copy. Until a wave does, an unmapped capability renders an
  honest generic line rather than nothing.
- `capability_outcome_unknown` exists because `runN8nManagement` can dispatch a write and never
  learn the result. Recording that as a failure would be a lie in the owner's favour.

**Exercised on the domain the map names.** Wave 3's rationale says SCR-1 *"should not start until
it has been exercised once on a domain that has a fallback."* The MCP integrations are that
domain: Zapier keeps its action-bus row and n8n keeps its audit row, so nothing shipped regresses
if the new primitive misbehaves.

## Spine Change Request

A Spine Change Request is required before changing a shared primitive: registry schema, resolver result semantics, safe signal fields, lifecycle vocabulary, approval authority, Chat adapter contract, or projection-window interpretation.

The request must include: requested change; affected domains and flows; collision packet with current exact heads; tenant and sensitivity analysis; compatibility and migration plan; tests and rollback; Chat-owner review for any action/approval change; and owner Gate 1 approval. Implementation and release remain separate authority gates.

## Contribution model for future agents

### Domain self-service lane

Ordinary additive capabilities do not require returning to one specific coordinator. A domain-owning agent may extend the Spine when it keeps the shared contract unchanged and completes this sequence:

1. **Fresh collision check** — fetch current main and every active owner branch that touches the domain, Chat handler, registry, resolver, Rail source, migrations, or CI. Record exact heads and preserve newer work.
2. Add one declaration under supabase/functions/_shared/paige-spine/domains/ and export it from the canonical registry.
3. Reuse an existing durable Rail/outcome source or add one immutable, tenant-safe migration for a fixed-field adapter. Never expose raw payloads or accept a caller-supplied tenant id.
4. Add registry, safe-field, malformed-result, real-role, cross-tenant, account-switch, and direct-source-denial tests.
5. Add the smallest owning consumer. A shared file with no deployable consumer is intentionally red in CI; do not weaken edge-affected.py or convert zero consumers into a pass.
6. Keep chatBinding, mindBinding, and maturity truthful. Code and structural tests may justify PARTIAL; LIVE requires the corresponding correctly authenticated end-to-end proof.
7. Publish a green draft with exact automated, static, rendered/runtime, authenticated, and UNVERIFIED evidence separated. Merge and deployment remain separate authority gates.

This lane covers additive domain declarations, domain-owned safe adapters, tests, and consumers that use the existing resolver contract. It does not authorize editing another domain's behavior or a shared approval primitive.

### Shared-contract lane

A Spine Change Request and coordinated owner review are required for registry shape, resolver semantics, safe signal fields, lifecycle vocabulary, approval authority, Chat adapter contract, projection-window meaning, new shared stores/buses, or cross-domain behavior. Mutations and external effects also require the Chat owner's canonical risk classification, one-approval treatment, idempotency, recovery, and authenticated proof.

### Required handoff packet

Every agent leaves: exact base/head; active-owner heads inspected; affected-flow and collision map; changed files; registry key and domain owner; human surface; Rail/source and safe adapter; roles and denial cases; consumer/deployment identity; test commands and results; runtime/authenticated evidence; remaining BLOCKED, FAIL, and UNVERIFIED items; and explicit merge/deployment authority. That packet lets the next agent continue without relying on a particular person's memory.
