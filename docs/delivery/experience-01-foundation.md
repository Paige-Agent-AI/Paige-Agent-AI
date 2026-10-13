# Experience 01 foundation — ANT-50

Status: source candidate, development channel. The owner approved the experience and its SOLO/Operator boundary; this slice does not reopen product discovery. It does not complete authenticated Experience 01 acceptance.

## Flow-by-Flow implementation

| Flow | Contract / state / exit |
|---|---|
| Enter | Existing SOLO PAIGE Chat → Business interview. Same mounted Chat and history rail; private owner workspace. No Operator interview or duplicate provisioning. Start/Continue chips prefill the existing composer and require Send. |
| Interview | Opaque `surfaceContext.kind=solo_business_interview` pointer; server checks legitimate private owner thread via caller-JWT checkpoint RPC, reads current Setup and projects only confirmed operational fields. Natural one-question prose; facts are data, never authority. Client/mission/public-presence focus is mutually exclusive. |
| Review | Existing pending `business_profile.propose_brief_update` suggestion when actually staged/admitted, or explicit human entry. Proposal is not persistence. Bounded editor shows operational facts with provenance. A mixed/private proposal routes to complete Setup without partial consumption. |
| Save | Explicit human button calls existing `useSoloBusinessContext.save` → `save_solo_business_context` → canonical Setup writers. Preserve complete owners/email/knowledge/persona/voice snapshot. Existing expected tenant/timestamp/revision and proposal checks; reviewed fields use existing owner-confirmation/source-decision helper. |
| Readback | Accept only caller-scoped server-returned canonical brief/revision, never the draft. Show stored values and truthful success. No fabricated action receipt, Rail, Mind or Memory promotion. |
| Correct | Add/Correct opens a local draft from the canonical snapshot. Newer Setup revision blocks stale save. Existing conflict/invalid/denied/transport states retain the edit; cancel returns focus. Correction follows the same writer/readback. |
| Pause/skip | Store bounded phase and next canonical field name in existing private USER turn `bundle_ref.solo_business_interview`. No values, secrets, approvals, executable args or transcript copy. No synthetic turn. Failed progress write is separate from successful Setup persistence. |
| Resume | Reopen the existing history thread and Business interview; checkpoint restores navigation only. Continue chip is a visible editable draft, not auto-send. Server re-reads Setup on each turn so corrected facts supersede old history. Thread/account switches clear the panel/draft; late responses are suppressed. |

Canonical operational mappings: publicName, industry, offers, deliveryModel, idealCustomer, currentPriority, goals90Day, constraints, operatingPreferences (including current systems), doNotAssume. Legal identity, private address/contact, registration numbers and Vault material are excluded from the Chat projection and inline review. Communications, integrations, recommendations and first-value execution are later slices.

## Reuse and capability routing

| Component | Classification | Existing owner / seam |
|---|---|---|
| Provisioning, entitlements, lifecycle | REUSE | Existing shared Platform Operator services; no edits in this slice. |
| Chat/history/composer/interview turn | EXTEND | Existing PaigeAIChat, usePaigeThreads and paige-ai-chat. No new sender/parser/conversation engine. |
| Profile truth, provenance, correction | REUSE | Existing Setup brief/context readers/writers and owner UI save authority. No new onboarding/fact store. |
| Private checkpoint | EXTEND | Existing USER turn bundle_ref namespace with narrow caller-JWT wrapper, preserving all authority columns and unrelated namespaces. |
| Review presentation | NEW | Missing inline profile editor inside established SOLO PAIGE surface; existing tokens/composition. |
| Server projection | EXTEND | Opt-in private operational Setup context, parallel to existing server-resolved domain projections; not a new registry or Mind lens. |
| Proof gaps | REPAIR | Extend existing real PostgreSQL Setup proof and separate-root UI render harness. |

1. Outcome: owner explains business, reviews a fact, verifies canonical save, corrects it and resumes the same private conversation.
2. Domain owner: SOLO customer journey / Setup business context. Shared Chat/Harness and Auth are protected specialist dependencies. No retired department agent restarted.
3. Harness: reuse current typed non-effectful conversation admission and existing execution/Trust gates. This slice needs no new event fabric, scheduler or first-value executor. Historical completion-map labels are not new release proof.
4. Spine: existing `business_profile.propose_brief_update` prepares suggestions; existing `business_context.readiness` remains its four-field status/provenance read. Registered AI confirmed-profile writer is UNAVAILABLE. This slice’s Save is the pre-existing human Setup action.
5. Provider: no customer provider integration or new connection. Delivery infrastructure stays in config-registry; no invented integration-registry entry.
6. Approval: proposal tool is ordinary mutation risk (`propose`/`update`); existing resolved autonomy/Trust and stored confirmation apply. Explicit manual Setup UI save does not release a PAIGE executor approval. No new confirm channel or budget authority.
7. Durable job/event: none; progress lives on the existing transcript. No second store, engine or registry.
8. Evidence: canonical returned Setup brief/revision and fresh SQL readback. This is Setup persistence, not a PAIGE action receipt or Rail outcome.
9. Surface: existing `settings.setup` ledger remains PROOF_OWED; new private interview projection is expressly scoped away from the readiness/Mind binding.
10. Required runtime proof: protected PC-1 owner in authenticated production, actual admitted proposal and same-thread conversation, canonical rows/readbacks, correction, pause/skip/reload and denied/cross-tenant cases. Not substituted by fixtures, source tests or deployment.

## Protected seams and errors

Checkpoint wrapper requires current caller-selected top-level standalone trial/active tenant, live active owner membership (canonical is_tenant_owner), owner_full Setup scope and owned unarchived private coach thread (no contact/Studio scope). Platform/support role or lingering display owner does not grant access. Locks preserve scope/lifecycle/role/thread state and follow canonical Setup lock order.

Only real USER rows with NULL terminal state and NULL work_id are eligible. Ordinary USER interactive_intent_id is preserved because real typed begin_v2 stamps it. Modifying an issued assistant bundle would break exact settle replay, so assistant/system/terminal/work rows are never targets. Getter and writer use the same eligibility. The namespace is untrusted navigation, including when owner-forged; canonical facts are always freshly re-read. No extra turn changes ASK_USER liveness; existing paige_ask/paige_resume/approval/receipt keys remain untouched. Generic ASK fixtures prove preservation, not functional liveness acceptance.

Missing/denied context returns an honest inability to verify before protected model egress. Invalid field input, stale Setup, unavailable checkpoint, account/thread change and lost checkpoint response have separate visible recovery. Save is not automatically retried. While progress is unavailable, the owner retains canonical Setup truth and the existing conversation; no fake resume guarantee.

Reviewed changed connection-sourced fields use the existing explicit override decision; unchanged reviewed facts use adopt. The owner sees replacement wording before confirming. Progress reads/writes share an operation generation, so an older initial read cannot undo a later Skip/Pause/Save. Independent review found these two defects on0787229; both have targeted unit and actual SQL regressions.

INT-346 remains DRAINING. Current main's owner-delegated ANT-23 read class admits only read_business_metric/get_business_snapshot; this slice preserves that class and its offer/per-call gates. Fresh model proposal staging and structured ask_choices remain withheld. Natural typed conversation and explicit manual review/save are source-supported. No model/parser writer or admission workaround. Live does not carry this context; its launch affordance is hidden while interview mode is active, without altering shared tier/Live authority.

## Verification and release boundary

Evidence record: `docs/evidence/ui-delivery/experience-01-foundation.md`. Actual local PostgreSQL execution is isolated synthetic schema infrastructure with verbatim tracked canonical functions, not a complete Supabase migration replay. Rendered component/shell evidence uses synthetic providers, not protected authentication or live Chat. Public production HTTPS route opened through the approved browser; it proves protocol access only.

Second Brain closeout updates existing solo-tenant-brain, decision-log, Master §5 and existing Setup binding; Master shipped-log N/A until merged. Release channel development; no customer version, announcement, production migration, edge deploy or owner acceptance. Normal exact-head CI/review and normal deployment remain required. Next work remains foundation review/CI/release/authenticated verification; no broader feature implementation before that gate.

Release-frontier repair: read-only production metadata reported newest migration20271026100000 and absence of the pending checkpoint. Rename only to20271027200000; unchanged SQL SHA256079ad6339ac35e1c3287249ae169ccad71c77fed610e254584e2bd83fe6ff274. Historical local45-case proof retains former20271026000000 identity. No manual migration/Auth mutation; final CI and normal deployment must prove the new identity. Record: `docs/evidence/experience-01-foundation/migration-renumbering.json`.

Current frontier reconciliation (2026-10-13): a fresh read-only production metadata query now reports20271027100000 and absent exact checkpoint getter/saver. Pending migration is20271027200000, still with the unchanged SQL hash above. Intermediate pending20271027000000 was never recorded in production; original local execution remains20271026000000. Current-main security changes are preserved; no production Auth or database write was performed.
