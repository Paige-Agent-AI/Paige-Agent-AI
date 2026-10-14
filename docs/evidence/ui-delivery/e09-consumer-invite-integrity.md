# E09 consumer invitation acceptance integrity

UI_DELIVERY_EVIDENCE_VERSION: 1
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: legitimate external client accepts exact authorized CRM invitation once; tenant inspects persisted access result
VISUAL_DIRECTION: PASS: existing JoinWorkspace and tenant Clients presentation preserved; no markup/style/geometry change
AUTOMATED_EVIDENCE: PASS: project-owned native PostgreSQL candidate26/26; baseline8/23PASS15/23FAIL; exact source branches, double migration replay, concurrent once-only acceptance and audit rollback verified; full-schema hosted test separately owed
STATIC_EVIDENCE: PASS: node syntax, migration lint1file0warnings, definer guards, whitespace and UI evidence grammar checked; hosted exact-head build/CI and full schema replay separately owed
RENDERED_EVIDENCE: UNVERIFIED: no UI source changes; no rendered-runtime proof collected for repaired acceptance
BEHAVIORAL_EVIDENCE: UNVERIFIED: legitimate authenticated browser acceptance not yet executed
AUTHENTICATED_RUNTIME: UNVERIFIED: CentralQA18casepacket NOT_RUN; designated Antonio SOLO actual role must be verified; designation does not prove external relationship
KEYBOARD_FOCUS: UNVERIFIED: existing UI unchanged; no new browser keyboard proof
ZOOM_REFLOW: UNVERIFIED: existing UI unchanged; no new browser zoom proof
REDUCED_MOTION: UNVERIFIED: existing UI unchanged; no new browser preference proof
STATE_COVERAGE: PASS:26native checks cover valid, invalid, wrong-recipient, anonymous, stale-contact, expired/revoked/replayed, staff preservation, double application, concurrent acceptance and audit rollback; browser interaction remains separately UNVERIFIED
TRUTHFUL_STATE_LABELS: PASS: full Portal PARTIAL; no deployment, authenticated acceptance or complete seven-pillar LIVE claim
UNVERIFIED: exact reviewed/CI/released candidate, full Supabase replay, actual external identity, customer acceptance, complete portal journey, multi-business switching and scoped revoke remain separately owed
FLOW_BY_FLOW: PASS: complete routed skill reading; affected external-client join and tenant invitation readback grounded before edits
PAIGE_UI_DESIGN: PASS: routed skill/reference reading; existing JoinWorkspace error/success presentation preserved; no UI source edited
MATERIAL_FLOW_CHANGE: NO: restores the already-required recipient-bound acceptance contract through existing success/refusal states; no new interface, user choice, confirmation, navigation or presentation
FLOW_PROTOTYPE: NOT_REQUIRED: backend authorization repair preserves the existing JoinWorkspace interaction and error handling; complete portal UI will use its own prototype and evidence
SOLO_UI: NO: no Solo or customer UI geometry, control, CSS or rendering source changes in this bounded migration
OWNER_INTENT: a legitimate invited customer joins only the exact authorized CRM contact, with durable acceptance attribution; owner complete E09 mandate and AI integration addendum dated2026-10-14 remain broader required scope
MUST_NOT_HAPPEN: recipient spoofing, replay, wrong or occupied contact binding, fallback CRM duplication, partial linkage/token/role/audit changes, staff authority expansion, email sending, credential/global account operations, payment or other provider effects
MUST_PRESERVE: existing team/subaccount-owner/agency-team branches and guards; real CRM and contact-method authority; business active-workspace guard; other owner work and applied migration history; existing portal visual language
ACCEPTANCE_CRITERIA: authoritative confirmed recipient can accept the exact active unmerged contact once; invalid recipient/token/contact refuses atomically; pure external client receives no staff membership or staff workspace pointer; owner can inspect persisted invite/link/audit; authenticated runtime remains independently owed
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: affected identity/relationship isolation, token replay, canonical link/readback, private identity handling and acceptance audit are tested in project-owned native proof. Not affected: Solo entitlement/signup/paywall/billing/provisioning; existing approval/autonomy/Spine execution rules; Rail and Memory engines; Chat transcript/stream/popout/history; Live; Secure Browser/Vault; provider state/effects; job scheduling; shell geometry/accessibility presentation. Existing business resolver and active-workspace guard remain unchanged and are explicitly regression tested.
INTERNAL_BUILD_IDENTITY: source-base=5c90859ac1d4fe560200069c5a783e90fb21be19; deployment=NOT_DEPLOYED; environment=development; migrations=PROOF_OWED(20271102100000 exact candidate deployment and full schema replay); edge=NOT_APPLICABLE; evidence=scripts/proof/e09-consumer-invite.mjs
RELEASE_CHANNEL: development: isolated local synthetic verification only
RELEASE_CLASSIFICATION: internal-only: bounded invitation integrity repair, no full customer release
CUSTOMER_RELEASE_IDENTITY: none: complete customer portal acceptance is not established
RELEASE_NOTE_REQUIRED: no: bounded internal security/correctness repair, no complete customer release
RELEASE_TRUTH_BOUNDARY: PROOF OWED: native synthetic proof is not full Supabase replay, legitimate customer authentication, deployment or complete portal acceptance
RELEASE_RECOVERY: position=forward-fix preserving recipient/replay/contact guards; reference=consumer invitation flow and local proof; never restore the vulnerable consumer branch

## Capability routing before editing

1. Intended outcome: exact verified invited client accepts legitimate portal access once.
2. Domain: Clients/Customer Portal E09; Identity owns shared auth/staff contracts, preserved here. Current open PR collection found no consumer acceptance writer; E04#2156 and E03/E05 sources remain excluded.
3. Shared layers: existing identity and callable RPC/auth scope; Harness context/authority and verification are PARTIAL per completion map. This repair does not claim complete portal Harness convergence.
4. Spine: portal-specific invitation capability UNAVAILABLE in current registry. Existing public.accept_tenant_invite is the manual identity entrypoint; no new AI admission or falsely LIVE capability is added.
5. Providers: NOT_APPLICABLE to acceptance. Existing invite-email provider/cutover contracts are E03-owned and remain unverified; no sender or fallback change.
6. Authority: ordinary authenticated recipient binding to existing authorized invite/contact; no new action-risk/MUTATION_VERB or Trust approval mechanism. AI access administration remains unavailable until canonically registered/governed.
7. Job/event: no new durable job, scheduler or external effect.
8. Readback: existing clients.linked_user_id and tenant_invite_tokens.uses/last_used_at; acceptance audit uses existing audit_logs and authenticated actor. No parallel receipt store. Complete Rail and AI receipt convergence remains owed.
9. Surface: binding ledger clients.portal remains PARTIAL; no new availability claim.
10. Proof: native PostgreSQL caller-role positive/negative/regression/concurrent/rollback tests, exact-head independent review/CI and deployed SQL readback; legitimate external-client acceptance remains CentralQA/ANT52-owned and UNVERIFIED until executed.

## Flow and limits

Invitation/link/authentication -> accept_tenant_invite -> server recipient and exact contact guards -> atomic CRM link, single-use token and existing audit -> /onboard or existing refusal. Contact methods own address matching. No email match alone creates a relationship. No business tenant_members row or profiles.active_tenant_id switch is granted to a consumer.

The currently enforced single-tenant linked-user restriction is preserved in this first repair. Multi-business membership/switch, relationship-scoped revoke/suspend and safe customer projections remain mandatory subsequent E09 work. This slice is not a complete portal release.

## Evidence

Project command: `node scripts/proof/e09-consumer-invite.mjs`; negative baseline uses `--baseline`. The fixture loads the real committed acceptance definition/contact-method patch and staff active-workspace guard, then applies the candidate migration twice. Auth rows and surrounding minimal schema are synthetic stand-ins. Evidence is written outside product source under the task work folder. Full schema replay, hosted required CI, production deployment and actual user acceptance remain UNVERIFIED until separately captured.

Fresh candidate:26PASS/0FAIL, migration SHA256 `f4fd394bfd647fe2d11f36b61c0248b89097b22bf8aa11990230a5f718b1e9bc`.
Baseline:8PASS/15FAIL across23checks. First bootstrap attempts had socket/fixture errors and are INVALID product evidence, not PASS. A discarded candidate run had25PASS/1FAIL because the synthetic audit-failure trigger used a temporary function whose session ended before the call; corrected fixture uses its isolated public proof function and verifies complete rollback. No production function was changed by these executions.
The full-schema test `supabase/tests/consumer_invite_acceptance.sql` rides the existing database-contract job immediately after the team recipient suite; no second CI database or authorization engine.

Impeccable source: https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md . Context, existing product and state-contract review applied; no visual implementation or detector target in this SQL-only slice. Rendered finish review is not claimed.
