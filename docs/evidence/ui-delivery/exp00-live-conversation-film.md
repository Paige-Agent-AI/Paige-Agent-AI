# Conversation Film for Live Conversation

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: ANT-158 flow review covers opening from Chat, skipping the intro, Live controls, transcript, pop-out and return to the same thread.
PAIGE_UI_DESIGN: PASS: the Paige UI Design and Impeccable skills informed a single visual focus, playback-led captions and stable controls.
MATERIAL_FLOW_CHANGE: YES: the regular Live entry now opens the approved intro and galaxy. A transcript button exposes the same thread history on demand.
FLOW_PROTOTYPE: PASS: the owner approved Conversation Film and explicitly requested it replace the current Live surface. Chrome exercised the actual component in an isolated fixture for the new entry and exits.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a workspace owner opens Talk live with Paige to speak in the current conversation.
VISUAL_DIRECTION: PASS: the original Command Logo introduces a dimensional galaxy. The audio stream has its own bottom row and captions track Paige's playback.
AUTOMATED_EVIDENCE: PASS: 194 tests across six files cover the official layout, same-thread start, no first-meeting greeting in ordinary Live, intro replay prevention after a workspace-context change, output playback, relay transport, provider boundaries and Chat context.
STATIC_EVIDENCE: PASS: targeted ESLint, diff whitespace check, local Vite fixture build and Impeccable detector.
RENDERED_EVIDENCE: PASS: Chrome fixture at 1536×770, 1366×768, 1024×768, 900×1000 and 390×844. Captures include the intro, desktop and mobile in the assignment outputs.
BEHAVIORAL_EVIDENCE: PASS: keyboard Skip intro opens Live for the current thread. The fixture exercises transcript scrolling with a docked waveform, caption display only during sample playback, hold and resume, interrupt, pop-out, minimize and restore, and End.
AUTHENTICATED_RUNTIME: UNVERIFIED: the local fixture uses a simulated relay. Ordinary hosted consent, provider speech and microphone input and the protected signup path require an authenticated Cloud run.
KEYBOARD_FOCUS: PASS: the keyboard reaches and activates Skip intro and keeps focus in the dialog. A closed transcript is excluded from the focus trap.
ZOOM_REFLOW: UNVERIFIED: the narrow 390 CSS pixel fixture has zero horizontal overflow. Desktop browser zoom and browser text resizing remain untested.
REDUCED_MOTION: PASS: the 390×844 fixture bypasses the flight and keeps Live controls and playback feedback.
STATE_COVERAGE: PASS: first opening, skip, listening, playback, hold, interrupt, minimize, pop-out, End and reduced motion have rendered evidence. Consent, retry, errors and context invalidation have targeted component coverage.
TRUTHFUL_STATE_LABELS: PASS: listening follows Live state. Captions and the bottom audio waveform follow output playback in the fixture.
SOLO_UI: YES: shared Live Conversation entry in PAIGE Chat and protected Meet PAIGE.
UNVERIFIED: actual two-way voice, authenticated behavior and geometry in two hosted Solo tenants, the $97 checkout and renewal, and hosted return sign-in.

INTERNAL_BUILD_IDENTITY: 0465fc4c56a46d6321c7d1d5f25f85d13c288e99; deployment=PROOF_OWED(PAIGE Cloud); environment=local; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp00-live-conversation-film.md
RELEASE_CHANNEL: development: isolated component and browser verification.
RELEASE_CLASSIFICATION: patch: a presentation update to the existing Live capability.
CUSTOMER_RELEASE_IDENTITY: none: no standalone customer version is assigned to this visual update.
RELEASE_NOTE_REQUIRED: YES: the Live entry screen now looks and behaves differently for workspace owners.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local rendering and interaction passed. Authenticated two-way voice and the protected Solo purchase and renewal path require hosted proof.
RELEASE_RECOVERY: position=restore the previously verified PAIGE Cloud web image if the shared Live experience regresses; reference=ANT-178 PAIGE Cloud web deployment and rollback history.
SOLO_1536X770_PAIGE_CLOSED: PASS: the local trigger is reachable before opening and after End.
SOLO_1536X770_PAIGE_OPEN: PASS: the local stage fits and the audio waveform stays above the controls.
SOLO_1366X768_PAIGE_CLOSED: PASS: the local trigger is reachable before opening and after End.
SOLO_1366X768_PAIGE_OPEN: PASS: local transcript scrolling keeps the waveform docked.
SOLO_1024X768_PAIGE_CLOSED: PASS: the local trigger is reachable before opening and after End.
SOLO_1024X768_PAIGE_OPEN: PASS: the local stage and controls fit without horizontal overflow.
SOLO_900X1000_PAIGE_CLOSED: PASS: the local trigger is reachable before opening and after End.
SOLO_900X1000_PAIGE_OPEN: PASS: the local stage and controls fit without horizontal overflow.

The independent Impeccable finish reviewer cleared the intro, desktop and mobile captures. The assignment outputs contain `paige-live-film-intro.png`, `paige-live-film-desktop.png` and `paige-live-film-mobile.png`. The Chrome fixture supplied sample audio. Authentic provider audio and hosted Solo tenants remain unverified.
