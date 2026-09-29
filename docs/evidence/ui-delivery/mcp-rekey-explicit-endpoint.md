# MCP re-key: require the complete endpoint, never reconstruct it from the host

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: affected-flow and collision packet below; failure reproduced before the product edit.
PAIGE_UI_DESIGN: PASS: repository UI skill, five modules, routed references, Flow-by-Flow 2.0.2, Flow Prototype 2.0.2 and Impeccable hardening/craft floor read; existing drawer retained.
MATERIAL_FLOW_CHANGE: NO: repairs an invalid default in the existing required full-address field; no new step, auth mode, action, route, permission or side effect.
FLOW_PROTOTYPE: NOT_REQUIRED: bounded correction to the existing full-address entry contract, not a new or redesigned connection journey.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: authorized Solo owners explicitly enter the complete replacement address when re-keying a connected tool.
VISUAL_DIRECTION: PASS: existing ig-field/ig-actions drawer and Mineral/Obsidian tokens unchanged; no new CSS, component or visual system.
AUTOMATED_EVIDENCE: PASS: 4 new refusal cases failed on unchanged main; repaired gateway form, tenant hook and neighboring Integrations suites pass 176/176.
STATIC_EVIDENCE: PASS: changed-file ESLint has zero errors and three inherited warnings; TypeScript ratchet baseline/current 12/12; production Vite build exits 0; scoped Impeccable detector exits 0.
RENDERED_EVIDENCE: PASS: local real SoloSettings/Integrations components, stubbed transport/context, shell markup/CSS; 16 frame/theme/dock-width cases in scripts/live-drive/artifacts/mcp-rekey/report.json. Not authenticated shell proof.
BEHAVIORAL_EVIDENCE: PASS: local browser blank-address refusal, exact entered path, Escape/Keep editing/Discard, focus restoration and geometry; zero unexpected external requests/page errors in all 16 cases. Successful saves are mocked RPC tests, not provider proof.
AUTHENTICATED_RUNTIME: UNVERIFIED: no real Solo account or provider was exercised for this repair; native browser-helper initialization remains a separately reported environment failure.
KEYBOARD_FOCUS: PASS: local focus on the primary action, Escape/abandonment recovery and restoration to the invoking connection tile; screen-reader operation and complete Tab traversal remain unverified.
ZOOM_REFLOW: UNVERIFIED: four viewport sizes measured at deviceScaleFactor 1; browser 200% zoom was not exercised.
REDUCED_MOTION: PASS: all local browser cases ran with prefers-reduced-motion reduce; no motion code changed.
STATE_COVERAGE: PASS: empty replacement, explicit full path, all four manual MCP auth kinds, REST sibling, missing credential, refusal/retry, abandonment, multiple connections, permission and account-switch/stale-response hook coverage. Provider outcomes unverified.
TRUTHFUL_STATE_LABELS: UNVERIFIED: this patch corrects the endpoint-storage helper but does not establish the inherited Save & re-check claim; its save-only behavior and required follow-up are recorded below. No health result or capability label is promoted.
SOLO_UI: YES: Settings -> Integrations -> connected tool -> Re-key; no other Settings destination changes.
UNVERIFIED: authenticated persistence/permissions, real provider requests, OAuth, preview, production, native assistive technology, 200% zoom, live PAIGE workspace and all-Solo end-to-end execution.

OWNER_INTENT: Finish the generic multi-server MCP capability in place, with the full provider-granted tool surface and one canonical execution path. This prerequisite repair prevents re-key from substituting a bare host for a private full endpoint; it is not completion of the broader objective.
MUST_NOT_HAPPEN: No synthesized endpoint write, secret projection, provider-specific allowlist, second secret store, speculative provider call, live-account mutation, or capability claim from mocked evidence.
MUST_PRESERVE: Full encrypted endpoint storage, host-only browser projection, canonical setter/authorization/audit, multiple connections, specialized n8n REST handling, existing approvals/reset behavior, one PAIGE workspace, shell and navigation.
ACCEPTANCE_CRITERIA: An untouched replacement address never calls a writer or verification; explicitly entered path/query reaches the existing setter unchanged; cancellation saves nothing, failed writes preserve input, another connection/account never inherits the entry.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: Affected: integration configuration input, credential privacy, account-switch form teardown, canonical endpoint writer handoff, accessibility and drawer geometry (tests/drive below). Not changed: authentication/account choice, entitlement/signup/billing/provisioning, approval/autonomy policy, Spine execution, Rail/Memory, chat transcript/popout/history, Live Conversation, Secure Browser/Vault, durable scheduling/retry authority, Connections/Calendar, shared shell CSS/routes.

INTERNAL_BUILD_IDENTITY: base=16753e7230626c5165ce52478db5de8b7447c620; original failing-first base=4034180e98fbca6c017a2ab6f68d2ead9466ab7a; current exact head/tree recorded in the PR; deployment=UNVERIFIED; environment=local; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=commands and artifacts below.
RELEASE_CHANNEL: development: local implementation and structural browser proof, no production mutation.
RELEASE_CLASSIFICATION: patch: required endpoint input safety correction.
CUSTOMER_RELEASE_IDENTITY: none: internal repair candidate, no customer release claim.
RELEASE_NOTE_REQUIRED: no: no customer announcement authorized.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local repair proven; provider and authenticated production outcome PROOF OWED.
RELEASE_RECOVERY: position=revert this frontend-only patch if required; reference=no schema, credential or provider state is changed by deployment of these files.
SOLO_1536X770_PAIGE_CLOSED: PASS: artifacts/mcp-rekey/1536-770-light-closed.png and dark counterpart; no document overflow, drawer reachable.
SOLO_1536X770_PAIGE_OPEN: PASS: same 1536-770 open captures; reserved shell column only, not live PAIGE runtime.
SOLO_1366X768_PAIGE_CLOSED: PASS: artifacts/mcp-rekey/1366-768-light-closed.png and dark counterpart; no document overflow.
SOLO_1366X768_PAIGE_OPEN: PASS: same 1366-768 open captures; structural dock width only.
SOLO_1024X768_PAIGE_CLOSED: PASS: artifacts/mcp-rekey/1024-768-light-closed.png and dark counterpart; no document overflow.
SOLO_1024X768_PAIGE_OPEN: PASS: same 1024-768 open captures; structural dock width only.
SOLO_900X1000_PAIGE_CLOSED: PASS: artifacts/mcp-rekey/900-1000-light-closed.png and dark counterpart; no document overflow.
SOLO_900X1000_PAIGE_OPEN: PASS: same 900-1000 open captures; structural dock width only.

## Affected flow and source diagnosis

Actor: an authorized Solo owner/admin managing their own connected tool. Entry: the existing Integrations tile. Trigger: Re-key. Exit: save result or back to the connection/catalogue. Retry keeps entered values; abandonment discards them; account scope changes tear down the drawer and reject stale hook results.

The database does **not** discard endpoint paths on save. `create_mcp_connection` and `set_mcp_connection_endpoint` encrypt the whole address; `get_mcp_connection_secret` decrypts it service-side and `_shared/mcp-client.ts` sends to that full URL. `get_mcp_connections_v2` intentionally projects only the host. Paths and queries can carry secrets, so this patch never reads the stored full address back into the browser.

The first incorrect state was `RekeyForm` initializing from `https://${tool.serverUrlHost}/`. That guess passed client validation and reached the setter without owner entry. Four failing-first tests reproduced the emitted bare-origin write in url/none/bearer/header modes. The repair initializes the existing required field empty and replaces the false host-storage helper with accurate private-address guidance.

The manual modes still have the existing limits: bearer OR one custom header OR URL-carried authentication OR no key. Bearer plus additional account-scoping headers and changing an existing connection's auth method are subsequent canonical configuration work, not claimed by this patch. No provider-specific branch or new store is added.

## Capability and collision gate

- Family: Marketplace + Integrations, owned by this lane; Connections communications/calendar and Marketplace lifecycle untouched.
- Binding: `settings.integrations` stays PARTIAL; no binding status or authority changes.
- Shared layers: existing connection management and audit, not a new Harness or execution engine. Outbound durable execution remains owed.
- Spine: adjacent `integrations.list` and `integrations.health` reads are not modified or promoted into execution proof.
- Registry: n8n/Zapier existing entries read. A dedicated generic-remote governance entry is missing and remains a reconciliation requirement of the full objective; this patch changes no provider capability, auth contract, authority lane or provider registry.
- Approval: human-initiated existing setter checks `mcp.connections.manage`; no new MUTATION_VERB or confirmation channel. Existing reset/approval invalidation unchanged.
- Job/Rail: no new job/event producer; existing atomic audited setter remains authoritative. Save acknowledgement is not provider readback.
- Collision check: 52 open PR heads/files enumerated on 2026-09-29 UTC. No overlap in this form, test or drive. #917/#754/#574 remain parked under owner ruling; #1536 is a live tenant-context dependency, with its unchanged head `932bedf1af7f5b97774dcd9e5a6f0f8aef879774`. Reverify switching if it lands. #1573 now owns the config-registry former-repository reference correction; not duplicated here.
- Main subsequently advanced through #1564 (Contacts) to `16753e7230626c5165ce52478db5de8b7447c620`. Its files do not overlap this repair; the branch rebased cleanly and its new PRODUCT.md was read. No Contacts code was changed.

## Executed proof

- Failing-first: `npx --no-install vitest run src/solo/settings-integrations-gateway.test.tsx -t 'never submits a reconstructed host' --reporter=dot`: four failures on original form, exit 1; each demonstrated a bare-origin write.
- Passing: `npx --no-install vitest run src/solo/settings-integrations-gateway.test.tsx src/solo/data/useMcpGateway.tenant.test.tsx --reporter=dot`: 118 tests, exit 0. Includes real hook with mocked Supabase transport, not live persistence.
- Neighbor regression: the same command also including `src/solo/settings-integrations.test.tsx`: 176 tests in three files, exit 0.
- `npx --no-install eslint src/solo/settings-integrations-gateway.tsx src/solo/settings-integrations-gateway.test.tsx`: zero errors, three inherited warnings.
- `node scripts/ci/tsc-ratchet.mjs`: exit 0, baseline 12/current 12. Not a zero-diagnostic TypeScript claim.
- `npm run build`: Vite 5.4.21, exit 0, 5173 modules; inherited chunk-size/Tailwind/annotation warnings.
- Installed Impeccable `detect src/solo/settings-integrations-gateway.tsx`: exit 0. Source: https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md. Hardening checks applied: explicit input, refusal/retry, cancellation, no silent side effects; craft check retained existing tokenized hierarchy and control geometry.
- `node scripts/live-drive/integrations-oauth-return-render.mjs --rekey`: 16 PASS, exit 0; local port 5213 closes in finally. The first attempt failed because the exact accessible label selector omitted the helper text; corrected to the actual textbox accessible name and rerun. External traffic blocked; no successful save/probe clicked. Existing script extended instead of creating another browser harness.
- Local screenshot inspection: 900x1000 Mineral/open and 1366x768 Obsidian/closed. Drawer reaches viewport edge; field/helper/actions visible. Existing validation feedback clears on the next submit, not while typing; no polish expansion made.
- Existing OAuth-return browser mode without `--rekey`: 16 PASS, exit 0. The shared harness's original flow remains intact. The installed Impeccable polish checklist was read and applied without expanding the visual scope.

## Independent review and limits

`/root/mcp_rekey_review` is a separately spawned independent adversarial reviewer who did not write this patch. It inspected actual diff, caller/RPC/account transitions and independently ran 118 tests. No BLOCKER/MAJOR in the scoped product repair. MINOR test-isolation finding fixed: missing-key case now supplies a valid URL so address refusal cannot mask a credential regression. MINOR evidence wording fixed: RPC tests prove saving, not a provider probe.

Automatic Codex review is not a gate under the owner's superseding ruling; no automatic Codex pass is claimed.

Inherited limitation: button `Save & re-check` and warning that Paige checks again overstate the hook's save-only RPC path. This patch does not establish automatic provider verification; existing `Check now` is separate. Resolve as part of canonical configuration/verification work, not by pretending local tests exercised a provider.

Repository infrastructure finding separately filed as #1574: merged #1566 database-contract job failed starting disposable Supabase because port 54322 was occupied. No workflow repair/rerun absorbed here.

Deleted: saveable host-to-URL reconstruction, false host-only-storage helper, and the comment endorsing that reconstruction. No second gateway, credential store or provider path added. The old Zapier execution path is not removed prematurely; canonical execution/parity and its deliberate cutover remain within the full assignment.
