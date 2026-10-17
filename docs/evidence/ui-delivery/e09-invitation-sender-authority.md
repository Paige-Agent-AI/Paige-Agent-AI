# Portal invitation sender authorization

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Restore the approved existing contact-to-invitation flow. The server verifies the actual owner and current saved recipient before the existing provider send.
PAIGE_UI_DESIGN: PASS: Preserve the approved Clients Portal dashboard, invitation dialog, confirmation, history and recovery. No component or layout changes.
MATERIAL_FLOW_CHANGE: NO: Backend authorization restoration of the existing explicit owner send; no new goal, step, navigation or interaction container.
FLOW_PROTOTYPE: NOT_REQUIRED: No UI or material interaction change; owner-approved invitation flow remains.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: An authorized business owner sends one recipient-bound invitation to the selected existing CRM client.
VISUAL_DIRECTION: PASS: Existing approved Portal presentation, tokens and dialog remain unchanged.
AUTOMATED_EVIDENCE: PASS: Final actual sender/caller37/37 plus seven incumbent team contract cases pass44/44, including native Team owner-flag, consumer separation and final authority withdrawal. Focused strict test-file TypeScript passes. The frozen-prior-main sender control fails26 and passes5; the frozen legacy team caller separately fails both new create/resend controls before header forwarding. No network or real email. Exact-head hosted CI remains controlling.
STATIC_EVIDENCE: PASS: Caller Auth.getUser and the exact native create_tenant_invite_token permission predicates, evaluated through that caller's JWT. Preserve provider, brand, sender identity, email_sends correlation, transport recovery and JWT configuration. No service-role permission inference.
RENDERED_EVIDENCE: NOT_APPLICABLE: No rendered source changes; existing approved dashboard geometry is untouched.
BEHAVIORAL_EVIDENCE: PASS: Admin, agency and platform-owner positives; missing/unverified/foreign caller, unavailable permission read, consumed/expired/revoked token, missing/foreign/inactive/merged/suppressed/joined contact, changed/ambiguous/foreign primary email, final authority/recipient/token/provider withdrawal, provider floor, existing team invite and unknown transport without retry.
AUTHENTICATED_RUNTIME: UNVERIFIED: Actual owner send and provider delivery following deployment remain separate from these synthetic source tests.
KEYBOARD_FOCUS: NOT_APPLICABLE: No control changes.
ZOOM_REFLOW: NOT_APPLICABLE: No geometry changes.
REDUCED_MOTION: NOT_APPLICABLE: No motion changes.
STATE_COVERAGE: PASS: Refusal produces no provider send or send receipt; authorized fixture uses the incumbent delivery path and actual email_sends.message_id correlation, with verified actor attribution.
TRUTHFUL_STATE_LABELS: PASS: Delivered, opened, clicked and accepted are not inferred from source or provider request success. Unknown transport is not retried automatically.
SOLO_UI: NO: Backend wrapper serves every eligible native business and client; no account allowlist or Solo component edit.
UNVERIFIED: New-head hosted CI, production source/configuration readback, actual owner send and delivery, customer acceptance and Chat/Live invitation execution.
OWNER_INTENT: Complete the same invitation mechanism for dashboard, typed PAIGE Chat and PAIGE Live while preserving owner authorization, exact recipient, approval and truthful delivery history.
MUST_NOT_HAPPEN: No send authority from token possession, email equality, frontend role or body-selected actor; no alternate sender, provider cutover, outbox, duplicate CRM or auto-retry on unknown delivery.
MUST_PRESERVE: Native invitation mint/accept authority, ordinary Auth, recipient binding, branding, E03 transport/provider floor, current sender identity, email_sends and existing team invitations.
ACCEPTANCE_CRITERIA: Actual authorized owner explicitly sends to the current saved recipient, receives truthful provider evidence, and the same invitation can be accepted through normal customer authentication. This bounded repair supplies the server authorization and recipient rechecks; hosted acceptance is separately owed.
MOTION_PURPOSE: NONE: No motion change.
PROTECTED_SEAMS: Tested: verified caller, native owner/admin/agency/platform authority, exact token/contact/business/recipient, consent/contact state, final pre-provider readback, provider floor and existing receipt attribution. Preserved: Auth/mint/accept, external-effect confirmation, existing provider and delivery webhooks, Trust/Spine/INT-346. No activation, real send, charge, role change, customer impersonation or provider configuration change.
INTERNAL_BUILD_IDENTITY: 0e2f8a55f6e9c51babac6bb2e37bd7d27e7d997b is the reviewed Chat parent before this separate sender repair; deployment=NOT_APPLICABLE; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(send-portal-invite normal deployment and exact source/configuration readback); evidence=src/__tests__/portal-invitation-sender.test.ts
RELEASE_CHANNEL: development: ordinary prelaunch backend restoration for all equivalently eligible businesses; exact-head review/CI and normal production deployment still required.
RELEASE_CLASSIFICATION: patch: restore server authority on the existing invitation path.
CUSTOMER_RELEASE_IDENTITY: none: No complete Portal release or customer announcement.
RELEASE_NOTE_REQUIRED: no: Internal prelaunch repair; owner product testing follows release.
RELEASE_TRUTH_BOUNDARY: PARTIAL: Local actual-handler source proofs only. Production, actual delivery/acceptance and governed Chat/Live invitation adapters remain proof owed.
RELEASE_RECOVERY: position=reviewed forward correction preserving canonical tokens, history and provider guard; reference=AGENTS.md and docs/doctrine/release-governance-and-customer-update-policy.md

The existing endpoint retains its configured verify_jwt=false posture and now validates the actual Auth user explicitly through the caller JWT before privileged token/contact reads. Permission is exactly the incumbent native mint predicate: is_platform_owner() OR is_tenant_admin(_tenant) OR agency_can_manage_child(_child). A second caller-bound check immediately before provider egress catches revoked authority or a changed actor. It does not create a role map or manufacture a customer session.

Consumer invitations additionally require the same token, business, contact, kind and bound email, unexpired/unrevoked/unconsumed status, an active unmerged unsuppressed unlinked native CRM client, and exactly one current primary email method in that same client and business matching the bound recipient. Those records and provider admission are re-read before egress. Existing other invitation kinds retain their native owner authorization and delivery path. This is a pre-send readback, not a claim of an atomic transaction across the database and email provider.

No new Chat capability key is invented here. The customer invitation action is still unavailable through Spine until its separate governed adapter is registered against this canonical mechanism; team invitations are a different contract. No INT-346 execution admission, model/provider configuration, credentials, sender infrastructure, automatic retry or permanent test identity is changed.

Sequential review found an existing service-client call from solo-team-invitations to this shared sender. That caller already verifies the human JWT and invokes the native actor-bound team writer. Preserve its authority and response contracts, forwarding that same verified Authorization header on its existing function invocation. The sender re-verifies the human rather than treating the service client's key as a user. The two actual handlers are driven together for create/resend, including one send, verified actor attribution and existing native invitation IDs. No team permission, token writer, transport, approval, action-risk or sender infrastructure changes. The active E01 #2277 source inventory contains no overlapping file; no peer messages were sent.

Native readback also proves Team's incumbent authority recognizes is_owner in addition to owner/admin roles. For kind=team only, the sender can call that same existing service-only solo_team_invite_authority with its verified actor and token-derived expected tenant, requiring the returned tenant to match. Generic mint predicates remain caller-JWT-bound. No role predicate is copied; no request-supplied actor or customer invitation can use Team authority. The same checks repeat before provider egress, including withdrawal of the native Team grant.

Reproduce with node node_modules/vitest/vitest.mjs run src/__tests__/portal-invitation-sender.test.ts src/solo/team-invite-edge-contract.test.ts --pool=threads --maxWorkers=1. The installed Vitest4 does not accept --minWorkers; that initial command error executed no assertions and the corrected command passes. The harness executes the actual endpoints after replacing only their inspected imports, supplies the actual shared provider boundary and deterministic synthetic SDK/provider responses, and forbids other network destinations. Exact-head hosted CI remains controlling.
