# UI delivery evidence: EXP10 — the GHL connect form asks only for what the owner supplies

Owner direction 2026-11-05 (verbatim asks): "If https://services.leadconnectorhq.com/mcp/ is
the same for everyone there is no need for us to ask anyone to add it" and "why would it say
'Credential Header (Authorization)' if what we need is: locationId?" — with the instruction
"Make those updates then we can connect a live account." This changeset delivers exactly that
on the curated connect forms (GoHighLevel and Slack — the two providers with a locked
contract): the universal MCP address is never asked for (the form states the endpoint it
already knows and carries it on save, which also silently repairs a re-keyed row saved
against a wrong host); the generic Credential-header / Add-header machinery is replaced by
fields in the provider's own words — "Private Integration Token" (note: starts with pit-,
create it under Settings → Private Integrations) and "Location ID" (note: Settings →
Business Info) — where the header NAME comes from the provider's contract and never from the
keyboard, and the pasted value is trimmed (an owner-observed failure mode from the live
connect attempts: a trailing space silently killed the save). The generic "Any MCP server"
door keeps its full manual form untouched — its address genuinely is the tenant's to supply.
Files: src/solo/settings-integrations-gateway.tsx + its test, the legacy-surface test that
drives the Slack drawer, and the GHL lane source pins — form structure and copy only.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the curated connect flow changes shape — create door (catalogue tile → add form) and re-key door (held row → Re-key) now show Name (create only), a stated-endpoint note, the locked mode button, Private Integration Token, Location ID, Save; the generic Any-MCP-server flow is byte-identical to before (its own address field, its own header machinery, all four modes).
PAIGE_UI_DESIGN: PASS: Impeccable context loaded this session (standing EXP10 discipline); the new elements reuse the incumbent ig-field/ig-note primitives, tokens and spacing — no new CSS, no component additions; labels use the owner's plain words per his direction.
MATERIAL_FLOW_CHANGE: YES: on curated forms the address question is removed and the credential questions are renamed to the provider's vocabulary; the save payload is unchanged in shape (same RPC/edge bodies — the address and header name were always known).
FLOW_PROTOTYPE: UNVERIFIED: no dedicated prototype was built for this field swap — the drawer, field and note structures are the incumbent ones the prior records (exp10-connect-finish-dont-duplicate) evidenced — but the flow IS material (curated forms lose the address question and gain named credential fields), so a rendered capture of the two-field GHL form on the deployed surface is owed and named here.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a non-technical owner connecting GoHighLevel sees exactly two credential questions in HighLevel's own vocabulary and a note telling him where each one comes from — no URL to hunt for, no "header" jargon, no Authorization question; the pasted Location ID is trimmed so a stray space can no longer fail him silently.
VISUAL_DIRECTION: PASS: incumbent visual language only — same field rows, same muted note style the drawer already uses.
AUTOMATED_EVIDENCE: PASS: renewed/added tests drive the catalogue create (no Server URL field; stated-endpoint note; token+Location ID typed in the provider's words; create body carries provider_key gohighlevel, the carried server_url, auth_kind bearer and custom_headers {locationId: trimmed value}), the recognized-row re-key (no Full address field; refusal "Enter the Location ID."; rekey carries the canonical services.leadconnectorhq.com/mcp/ URL and the header), the Slack curated create (address stated, never asked; payload unchanged), and the legacy-surface Slack drawer; the generic four-mode door and Add-header path stay pinned.
STATIC_EVIDENCE: PASS: typecheck-level review of the changed file (non-strict project); all 16 GHL-lane source pins verified present by grep before push.
RENDERED_EVIDENCE: UNVERIFIED: no local browser render this slice; the changed fields render in the incumbent drawer structures prior captures evidenced; owed and named.
BEHAVIORAL_EVIDENCE: PASS: the refusal message, the trim-on-save, the carried address and the payload shape are all driven by automated tests through real clicks and typing.
AUTHENTICATED_RUNTIME: UNVERIFIED: the owed proof is the owner's own live connect on the deployed surface — his dead row finished through the new two-field form (next step he named himself).
KEYBOARD_FOCUS: PASS: the incumbent focus-on-invalid effect now finds the friendly field's aria-invalid input; no focus behavior changed.
ZOOM_REFLOW: NOT_APPLICABLE: fewer/same incumbent field rows; no new layout structure.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: curated create, curated re-key (including the recognized wrong-host row being repaired), empty Location ID refusal, and the untouched generic door are each test-covered; unrecognized rows keep the full manual form.
TRUTHFUL_STATE_LABELS: PASS: the form never claims the user must supply an address or a header name that the provider's contract already fixes; the stated-endpoint note names the real host.
SOLO_UI: YES: src/solo/settings-integrations-gateway.tsx is the Solo settings Integrations surface.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: authenticated Integrations drawer surface; rendering structure is the incumbent one prior records evidenced at these viewports.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: same.
UNVERIFIED: a rendered capture of the two-field GHL form and the owner's authenticated live connect are owed and named above; the form behavior itself is automated-test-covered end to end through the save payloads.

MUST_PRESERVE: the generic "Any MCP server" door keeps all four modes, its address field and its Add-header machinery (pinned by tests); the save payloads keep their exact shape (carried address, bearer kind, custom_headers) so server contracts and the duplicate-guard are untouched; Slack's curated form keeps its single "Slack user token" mode.
ACCEPTANCE_CRITERIA: on the deployed surface the owner opens HighLevel, sees only Private Integration Token + Location ID questions (plus a stated-endpoint note — no address field, no Credential-header/Authorization question, no Add header), pastes his pit- token and Location ID, and Save lands the row in production (auth_kind bearer, locationId header on connection 16fe8057).
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: gateway writers, server guards, provider descriptors and catalogue routing are untouched; this delta is form structure, labels and client-side value handling only.

INTERNAL_BUILD_IDENTITY: f5ee9b04557faf3d2486706b48df9c62b8dd49c8 (exp10-ghl-token-form changeset off origin/main d74e59912); deployment=vercel-preview-per-push; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp10-ghl-token-form.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: authenticated Solo Integrations connect form; no customer release identity until the owner's own live connect exercises it
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only
RELEASE_TRUTH_BOUNDARY: PROOF OWED: ships on merge; the owner finishing his live GoHighLevel connect through the two-field form is the owed live proof
RELEASE_RECOVERY: position=revert-restores-address-and-generic-header-questions-on-curated-forms; reference=this record plus the revert commit
