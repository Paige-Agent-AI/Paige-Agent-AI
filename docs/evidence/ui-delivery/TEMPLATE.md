# UI delivery evidence: replace-with-change-name

Copy this file to `docs/evidence/ui-delivery/<change-name>.md`. Replace every placeholder. CI rejects missing fields and placeholder status values; reviewers must still inspect the evidence.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: REPLACE_ME with a link or concise flow packet reference
PAIGE_UI_DESIGN: PASS: REPLACE_ME with the project-skill reading evidence
MATERIAL_FLOW_CHANGE: YES: REPLACE_ME with the changed goal, state, transition, exit, or consequence
FLOW_PROTOTYPE: PASS: REPLACE_ME with the artifact and owner-intent approval reference
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: REPLACE_ME with a concise statement or design brief link
VISUAL_DIRECTION: PASS: REPLACE_ME with the approved pack/tokens and rationale
AUTOMATED_EVIDENCE: PASS: REPLACE_ME with exact checks and results
STATIC_EVIDENCE: PASS: REPLACE_ME with lint, types, build, and contract inspection
RENDERED_EVIDENCE: PASS: REPLACE_ME with screenshot/recording paths, viewport, and theme
BEHAVIORAL_EVIDENCE: PASS: REPLACE_ME with browser drive, states, exits, and outcomes
AUTHENTICATED_RUNTIME: UNVERIFIED: REPLACE_ME with the exact reason and affected claims
KEYBOARD_FOCUS: PASS: REPLACE_ME with the keyboard route and focus observations
ZOOM_REFLOW: PASS: REPLACE_ME with the zoom/reflow level and result
REDUCED_MOTION: PASS: REPLACE_ME with the preference and observed behavior
STATE_COVERAGE: PASS: REPLACE_ME with applicable states and exits
TRUTHFUL_STATE_LABELS: PASS: REPLACE_ME with checked capability labels and contracts
SOLO_UI: NO: REPLACE_ME with why this is not a Solo interface
UNVERIFIED: REPLACE_ME with remaining behavior and reason, or state none with the completed proof boundary

<!-- Five-skill Experience-Quality module fields (docs/doctrine/paige-ui-delivery-standard.md).
     RECOGNIZED but OPTIONAL: CI validates each only when present (it must not be a placeholder)
     and never requires it — a record that omits them still passes, so no in-flight PR breaks.
     A dated, announced cutover (never silent) is what would later make any of them required.
     Include the ones your change touches; delete the rest.
     Backend/edge/migration change that alters a visible flow with NO UI file? Add a
     `Visible-Flow-Impact: yes` commit trailer — that is what routes your change under
     supabase/functions/** or supabase/migrations/** to this evidence gate (see the standard's
     "Backend-to-visible routing"). -->
OWNER_INTENT: REPLACE_ME with the exact owner objective, target actor + user job, and required outcome (module 1)
MUST_NOT_HAPPEN: REPLACE_ME with what this change must not break, remove, hide, or regress — or `NONE: reason` (module 1)
MUST_PRESERVE: REPLACE_ME with the existing behavior/visuals/seams that must stay unchanged — or `NONE: reason` (module 1)
ACCEPTANCE_CRITERIA: REPLACE_ME with the testable conditions a human completes on the real platform (module 1)
MOTION_PURPOSE: REPLACE_ME with what any added/changed motion communicates + reduced-motion behavior — or `NONE: no motion change` (module 2)
PROTECTED_SEAMS: REPLACE_ME with each impacted protected seam (tested) and each unaffected one named — or `NONE_AFFECTED: reason` (module 4)

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: REPLACE_ME_SHA; deployment=REPLACE_ME; environment=REPLACE_ME; migrations=REPLACE_ME (`NOT_APPLICABLE` or `APPLIED(<exact IDs>)`); edge=REPLACE_ME (`NOT_APPLICABLE` or `APPLIED(<function@version>)`); evidence=REPLACE_ME
RELEASE_CHANNEL: REPLACE_ME: channel evidence or reason; staged requires owner-approval=...; eligibility=...; amount=...; start=...; stop=...; monitoring-owner=...; recovery=...
RELEASE_CLASSIFICATION: REPLACE_ME: classification reason
CUSTOMER_RELEASE_IDENTITY: REPLACE_ME as `none: reason` or `<version> — <release name>; owner-decision=<reference-or-PENDING>`
RELEASE_NOTE_REQUIRED: REPLACE_ME: yes/no reason
RELEASE_TRUTH_BOUNDARY: REPLACE_ME exact LIVE / PARTIAL / UNAVAILABLE / PROOF OWED claims
RELEASE_RECOVERY: position=REPLACE_ME rollback/forward-fix position; reference=REPLACE_ME evidence or runbook

For a non-material flow change, use `MATERIAL_FLOW_CHANGE: NO: reason` and `FLOW_PROTOTYPE: NOT_REQUIRED: reason`. Do not use `NOT_REQUIRED` merely because a prototype was inconvenient.

Owner waivers (governance rule): the owner may waive exactly two gates, and only in this grammar — `FLOW_BY_FLOW: WAIVED: owner-decision=<substantive reference>; reason=<substantive reason>` (when the Flow-by-Flow skill is genuinely unavailable and the owner accepts the grounded flow trace in its place), and, only when `MATERIAL_FLOW_CHANGE: YES:`, `FLOW_PROTOTYPE: WAIVED: owner-decision=<substantive reference>; reason=<substantive reason>` (when the owner has ruled the changed flow itself and waived the prototype gate). The reference must be recognizable and reviewable (a PR/issue number, a URL, or a dated ruling), and the reason must be meaningful prose — an interjection pair like `owner-decision=no; reason=ok` is a bypass, not a waiver. The `FLOW_BY_FLOW` waiver is eligible ONLY when the skill is genuinely unavailable in the delivery environment; its reason must say so unambiguously — "not installed"/"not present"/"not available"/"no longer available" or a plain "unavailable"/"absent" in otherwise negation-free prose; any other negation anywhere in the reason ("not unavailable", "not currently unavailable", "neither unavailable nor absent", "anything but unavailable") or a convenience objection ("available but inconvenient") is rejected, and the unavailability claim must be ASSERTED OF FLOW-BY-FLOW — the predicate bound directly to the mention ("the Flow-by-Flow skill is not installed", "Flow by Flow is absent from this environment", hyphenated or spaced); the bare word "skill" is not identifying ("the screenshot skill is unavailable" is another skill's claim), and neither is a mere mention whose predicate describes someone else ("Flow-by-Flow documents that the screenshot skill is unavailable" does not qualify). A clause mentioning Flow-by-Flow that affirms availability alongside it is a veto, as is ANY clause affirming availability of anything — by name or by pronoun referring back to the gate ("unavailable here; it is installed and available" rejects). The affirmation is a predicate about a subject, not a bare word: "unavailable at present" and "absent from the present delivery environment" are temporal/adjectival uses that pass (the hyphen exemption is the "present-day" compound only — "is present-here today" is predicative and rejects), while a predicative "present" rejects — with any ordinary adverbs or verb phrases in between ("is present", "is currently present", "continues to be present"). A waiver with an empty, placeholder, or unresolved owner-decision or reason is rejected, exactly like any other non-substantive value. `WAIVED` is invalid for every other field, including `PAIGE_UI_DESIGN`, and for `FLOW_PROTOTYPE` when the change is not material. A waiver is a recorded owner decision — never a convenience default.

For Solo work, set `SOLO_UI: YES: affected canonical surface` and include all eight records:

SOLO_1536X770_PAIGE_CLOSED: PASS: artifact and observations
SOLO_1536X770_PAIGE_OPEN: PASS: artifact and observations
SOLO_1366X768_PAIGE_CLOSED: PASS: artifact and observations
SOLO_1366X768_PAIGE_OPEN: PASS: artifact and observations
SOLO_1024X768_PAIGE_CLOSED: PASS: artifact and observations
SOLO_1024X768_PAIGE_OPEN: PASS: artifact and observations
SOLO_900X1000_PAIGE_CLOSED: PASS: artifact and observations
SOLO_900X1000_PAIGE_OPEN: PASS: artifact and observations

## Scope and collisions

- Classification:
- Affected flows:
- Neighboring regressions:
- Active-owner/file collisions:
- Explicit exclusions:

## User job and state map

Record purpose, audience, primary action, visual direction, complete states, exits, side effects, and the intended scroll owner.

## Evidence index

List exact artifacts, commands, routes, tenant contexts, roles, themes, timestamps, and results. Redact secrets and customer-sensitive data.

## Browser / device / high-resolution coverage (owner 2026-10-15)

Complete for changed customer-visible flows using the [browser/display support standard](../../doctrine/paige-browser-display-compatibility.md). **This is human-readable evidence in the existing file; the current UI evidence CI script does not yet require separate machine-parsed browser fields.** Do not claim complete compatibility from a single engine or screenshot.

- Supported browser/version targets affected: identify Chrome / Edge / Firefox / Safari, iPhone/iPad Safari and Android Chrome as applicable; note exactly which were *tested* versus `UNVERIFIED`.
- Automated engine tests (Chromium / Firefox / WebKit): record exact head, route, auth/tenant class, test command, artifacts, states and `PASS`/`FAIL`/`BLOCKED`/`UNVERIFIED` per engine. WebKit emulation is not actual Safari.
- Actual device/branded browser acceptance: record OS, real browser/device, version, permission states, login/voice/OAuth/upload/touch/keyboard outcomes and untested limitations. A source fixture is not a real device.
- Responsive CSS viewports: preserve the eight mandatory SOLO sizes and add risk-based 320/390 mobile, 768 tablet, 1920 Full HD, 2560 QHD and 3840 4K-width, both themes and PAIGE open/closed where affected.
- 4K/high-DPI evidence: distinguish physical monitor pixels, CSS viewport, device pixel ratio, OS scaling 125/150/200%, browser zoom 200/400%/320px reflow, chart/SVG/image sharpness, scrolling and reachable controls. Do not claim actual 4K hardware tested from synthetic 3840x2160 captures.
- Risks, exceptions and follow-up: list every unsupported browser/feature and exact owner-approved documented limitation, or `UNVERIFIED` if not tested. Do not use browser selection to change domain capability, user role, tenant scope or approval authority.

## Review and limitations

Record independent review findings, fixes, remaining limitations, and every `UNVERIFIED` item.
