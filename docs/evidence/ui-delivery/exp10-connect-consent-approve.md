# UI delivery evidence: EXP10 — connect-consent (a made connection approves its tools)

Owner decision 2026-11-05 (verbatim: "I want to have all the tools approved once the
connection is made inside of Integrations. I still want PAIGE or her AGENTS to request
approval for actions and automations they request."), recorded on ANT-164 comment 3c731bae
with the full standard (per-ACTION approval cards in chat; standing automations approved
once; PAIGE and her agents actually helping run the business for every Solo account — and
the same standard recorded for the Platform Operator account). This changeset implements
the tool-level half exactly: when a verify persists a healthy catalog, every effect-gated
tool the check discovered is approved through the SAME runApprove authority path the
per-tool drawer button used — permanent (no expiry; the drawer could only create windowed
ones), tool-level (any call shape; the chat approval card gates the ACTION) — so consent
rides the human connect/check action itself and the per-tool ceremony disappears. Declared
reads stay approval-free (effect-policy, unchanged). The owner's execute gate
(MCP_GATEWAY_EXECUTE_ENABLED) is untouched and still owner-held; per-action chat cards,
endpoint-bound durable approvals, receipts and re-key revocation are all preserved.
Files: NEW _shared/mcp-gateway/auto-approve.ts (+ its Deno test, wired into ci.yml),
verify.ts composition (readToolPin + spy seams), approve.ts gains the one-home
makeReadToolPin builder (the wrapper's two branches now share it), the gateway wrapper,
and ONE truthful copy line in the Solo drawer (the re-key warning no longer tells the
owner to re-approve manually — checking does it).

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: affected flows — (a) connect/check flow (original owner: EXP10; steps unchanged: enter credentials → save → check), whose OUTCOME now includes consent (the check approves every gated tool it discovered); (b) the post-connect tool-approval flow (review each tool → click Approve per tool) which this decision RETIRES for connections made or checked from now on; (c) chat tool use flow, UNCHANGED (approval card per consequential action; execute gate untouched); (d) re-key flow, steps unchanged, copy corrected to tell the truth that checking re-approves. Dependencies: mcp-gateway verify/approve paths, effect-policy, the writer set_mcp_connection_approval — all reused, none re-implemented. Protected behaviors pinned below.
PAIGE_UI_DESIGN: PASS: Impeccable context carried from this session's standing load; the only UI delta is one sentence inside the incumbent ig-gw-warn element — no layout, component or token change.
MATERIAL_FLOW_CHANGE: YES: the tool-approval flow's ceremony is removed — a connect/check now consents to every gated tool automatically, and the drawer's re-key instruction changes accordingly.
FLOW_PROTOTYPE: UNVERIFIED: no dedicated prototype for a consent outcome (no new screen exists to prototype — the change is an outcome, not a surface); the flow IS material, so the owed render is the deployed drawer after the owner's next Check showing every gated tool "You approved this" and the count line at full — named here.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a non-technical owner who connects HighLevel and checks it once has DONE his consent — no second pass of 16 Approve clicks; when PAIGE later asks to run a consequential action the chat card is where he decides, which is the moment he said he wants.
VISUAL_DIRECTION: PASS: incumbent visual language only; one sentence rewritten in place.
AUTOMATED_EVIDENCE: PASS: new Deno suite (5 tests) drives the REAL runApprove authority stack through fake clients whose un-scripted rpcs reject loudly rather than pass vacuously — selection applies the server-authoritative policy (declared read never consented; mutation-verb name floor beats a provider mislabel; camelCase verb caught; provider-declared effect gated; undeclared fails closed), the recorded approvals are permanent + tool-level + endpoint-bound + tenant-bound, a refused tool is collected with its closed code without aborting the rest, a read-only catalog writes nothing, and the verify composition itself drives the REAL runVerify with a refusing endpoint proving a FAILED intake never reaches consent (the spy stays uncalled and any consent write rejects the test); deno check clean on the gateway entry.
STATIC_EVIDENCE: PASS: typecheck via deno check on mcp-gateway/index.ts (the import closure pulls every changed module); the composition in verify.ts is compile-checked through required VerifyDeps (a wrapper cannot ship verify without its consent seam).
RENDERED_EVIDENCE: UNVERIFIED: no local browser render this slice; the only visible frontend delta is the rewritten warning sentence in the incumbent structure; owed and named.
BEHAVIORAL_EVIDENCE: PASS: consent behavior is automated-test-covered at the authority-stack depth (the composition loop + the writer payloads); the copy line's incumbent fragment pin ("clears this tool's approvals") still passes unchanged.
AUTHENTICATED_RUNTIME: UNVERIFIED: the owed proof is the owner's own next Check on the deployed gateway — verify returns auto_approved counts and the drawer/chat show every gated tool approved; named here.
KEYBOARD_FOCUS: PASS: no focus behavior touched.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: happy catalog (all gated approved, reads untouched), refused-writer degrade (collected, loop continues), read-only catalog (zero writes), and the failed-intake path (REAL runVerify with a refusing endpoint: consent never reached, honest error body) are test-covered; the re-key-race placement (applied===false returns before consent) is review-verified at the composition site and by the writer's own endpoint guard — its live proof rides the deployed readback.
TRUTHFUL_STATE_LABELS: PASS: the re-key warning no longer instructs a manual re-approval the system now performs; the verify body reports auto_approved/auto_approve_failed counts honestly rather than implying all-or-nothing.
SOLO_UI: YES: src/solo/settings-integrations-gateway.tsx (one warning sentence) and the Solo connect/check outcome the gateway serves.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: one sentence in the incumbent drawer structure; no rendering structure change.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: same.
UNVERIFIED: the owner's authenticated Check on the deployed surface (auto_approved counts + every gated tool showing approved in drawer and chat) and a rendered capture of the corrected re-key warning are owed and named above; consent behavior itself is automated-test-covered through the real authority stack.

MUST_PRESERVE: the owner execute gate MCP_GATEWAY_EXECUTE_ENABLED stays owner-held and default-off (no code path here reads or changes it; execute action untouched); ACTION-level consent in chat is unchanged (approval card → mode execute); declared reads remain approval-free per the server-authoritative effect policy (single home, not re-implemented); runApprove's authority stack (tenant read, race guard, admin gate, v2 ownership, live-pin, endpoint binding, writer in-body guards) is composed, never bypassed; re-key still clears every approval (the next check re-consents); the per-tool drawer Approve button keeps working for any tool left unapproved (service-key checks, refused writes).
ACCEPTANCE_CRITERIA: on the deployed gateway, the owner opens Integrations → HighLevel and clicks the connection check once — verify persists the healthy catalog AND returns auto_approved counts; the drawer's tool list then shows every effect-gated tool as approved (count line at full) and PAIGE in chat (ghl_list_actions) reports zero unapproved names for the connection.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: AFFECTED-BY-DESIGN: the verify→approval seam (verify now consents through approve) — the ONLY new write path to mcp_connection_approvals, and it rides the existing writer's full guard stack; execute/consent-verifier seams deliberately untouched.

INTERNAL_BUILD_IDENTITY: c740546bb7be7b7e6c2370bbe60fe04ef83b1647 (exp10-connect-consent-approve changeset off origin/main 61b0c10e4); deployment=github-actions-edge-on-merge; environment=preview; migrations=NOT_APPLICABLE; edge=PROOF_OWED(mcp-gateway verify+approve paths changed, ships on merge via deploy-edge-functions, deployed-source readback plus the owner's one Check are the owed proof); evidence=docs/evidence/ui-delivery/exp10-connect-consent-approve.md
RELEASE_CHANNEL: preview: unmerged branch; edge functions deploy via deploy-edge-functions on merge to main; the one frontend sentence rides the next Vercel main deploy
RELEASE_CLASSIFICATION: internal-only: authenticated Solo connect/check consent outcome; no customer release identity until the owner's own Check exercises it
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only
RELEASE_TRUTH_BOUNDARY: PROOF OWED: ships on merge + edge deploy; the owner's one Check on the deployed gateway showing every gated tool approved (drawer + ghl_list_actions in chat) is the owed live proof
RELEASE_RECOVERY: position=revert-restores-manual-per-tool-approval-ceremony; reference=this record plus the revert commit (existing approvals already written by consent remain valid rows — reverting stops future auto-consent, it does not revoke what a connection already consented to; re-key remains the owner's bulk revocation)

────────────────────────────────────────────────────────────────────────
AMENDMENT 2026-11-05 (owner, same day, verbatim): "EVERYTHING SHOULD BE
APPROVED. TOP BEING SO CONSERVATIVE LOL."
────────────────────────────────────────────────────────────────────────
Recorded at the non-author reviewer's direction (the fields above describe
the FIRST cut and are superseded where they conflict):

- SELECTION (supersedes the AUTOMATED_EVIDENCE/STATE_COVERAGE read clauses
  above): connect-consent now consents to EVERY discovered tool — declared
  reads included — so the approval ledger the chat counts matches the
  owner's all-of-them grant. The old suite's "declared read never
  consented / a read-only catalog writes nothing" assertions are INVERTED
  and now pin the amendment (selection includes contacts.search; the
  read-only-catalog test expects 2 writes; the smoke's TOOLS fixture
  asserts 5-of-5 approved with reads included, list_records consented).
- EXECUTION UNCHANGED: the effect policy still governs dispatch (a declared
  read never consults the consent verifier; a provider re-classifying a
  consented read later fails closed on pin mismatch).
- HONEST RESIDUAL: a tool whose name cannot be safely recorded (the smoke's
  hostile injection name) is refused by the writer's tool-name contract and
  lands in auto_approve_failed on every check — reported as a count, never
  fatal, never named (§13: it is literally an injection string), and it can
  never converge by retry. Same class: names of 65–200 chars are cataloged
  (probe truncates at 200) but permanently unconsentable (approvals cap at
  64). A unit test pins the refusal code bad_tool_name.
- LIVE STATE: the owner's GHL connection carries all 36 approval rows
  (written through this same writer 23:31Z); PAIGE's chat reported
  "14 of 36" at 23:23Z before the owner's amendment, 36/36 after.
- MUST_PRESERVE supersession: "declared reads remain approval-free" at
  EXECUTION stays true; at the LEDGER, reads now carry consent rows.
- AMENDED BUILD: exp10-consent-all-tools (2c49206bf + review fixes), off
  origin/main 521cbf34c; edge redeploys on merge via deploy-edge-functions.
