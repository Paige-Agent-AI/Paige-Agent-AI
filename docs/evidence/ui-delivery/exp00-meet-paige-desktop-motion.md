# Meet PAIGE desktop motion

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: follows the existing Talk live with Paige entry through intro, listening, playback, hold, resume, interrupt and End.
PAIGE_UI_DESIGN: PASS: uses the approved Conversation Film focal sequence and Impeccable Animate guidance for frame pacing, accessible fallbacks and motion that follows the conversation.
MATERIAL_FLOW_CHANGE: NO: the command intro and galaxy have the same role and duration. Session transitions and controls use their existing paths.
FLOW_PROTOTYPE: NOT_REQUIRED: this presentation tuning preserves the approved design and the choices, exits and effects of the existing Live flow.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: workspace owners can talk with Paige using the existing thread and Live controls.
VISUAL_DIRECTION: PASS: the original Command Logo and bottom waveform remain. Stars and gold orbits now rotate as two depth-projected layers. The galaxy retains its seeded artwork and placement.
AUTOMATED_EVIDENCE: PASS: 79 targeted Live component, output playback, relay and provider boundary tests.
STATIC_EVIDENCE: PASS: targeted ESLint, Git whitespace validation, Impeccable detector and production-mode Vite component fixture build.
RENDERED_EVIDENCE: PASS: Chrome desktop and phone captures, Edge desktop and phone renders, and Windows Playwright WebKit desktop and narrow renders. Independent Impeccable finish review cleared the local presentation.
BEHAVIORAL_EVIDENCE: PASS: the final retry passed nine browser fixtures covering natural or skippable intro, painted rotating layers, speaking-only captions, the lower waveform, Hold, Resume, Interrupt, End and reduced motion. Narrow WebKit and the 900-pixel Chrome viewport had zero horizontal overflow.
AUTHENTICATED_RUNTIME: UNVERIFIED: source is verified using isolated mock relay input. Production authentication, real speech and commercial signup are outside these performance measurements.
KEYBOARD_FOCUS: PASS: the user can focus and activate Skip intro with Enter at the tested Chrome and Edge sizes.
ZOOM_REFLOW: UNVERIFIED: responsive CSS geometry and multiple pixel densities were exercised. Actual browser zoom, text resize and a physical display switch remain unverified.
REDUCED_MOTION: PASS: large motion is bypassed and voice feedback stays visible with the configured lower redraw cadence. Both layer animations respect the browser preference.
STATE_COVERAGE: PASS: intro, listening, active audio, hold, resume, interrupt, reduced motion and End exercised using synthetic playback. Source review inspected visibility, renderer resize and cleanup.
TRUTHFUL_STATE_LABELS: PASS: the waveform takes its amplitude from the existing playback input and captions follow playback.
SOLO_UI: YES: the shared signed-in Live Conversation and Meet PAIGE stage.
UNVERIFIED: physical Mac Retina and iPhone performance, browser zoom and authenticated provider audio.

INTERNAL_BUILD_IDENTITY: 8eeb632c69c79b35c391cc59679eab26a6f43e0d; deployment=PROOF_OWED(PAIGE Cloud); environment=local; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp00-meet-paige-desktop-motion.md
RELEASE_CHANNEL: development: isolated renderer verification in local browsers and hosted native Safari.
RELEASE_CLASSIFICATION: patch: presentation and performance tuning for the existing voice stage.
CUSTOMER_RELEASE_IDENTITY: none: this motion update has no separate customer version.
RELEASE_NOTE_REQUIRED: NO: the existing Live experience keeps its flow and controls.
RELEASE_TRUTH_BOUNDARY: PARTIAL: Chrome, Edge and native desktop Safari passed the scoped fixtures. The product merge and PAIGE Cloud release checkpoint are linked below. Physical Retina and iPhone performance and authenticated production audio remain unverified.
RELEASE_RECOVERY: position=restore the previously verified PAIGE Cloud web image if the Live stage regresses; reference=ANT-178 deployment and rollback readback.
SOLO_1536X770_PAIGE_CLOSED: PASS: local Chrome fixture opens and returns to the existing trigger after End.
SOLO_1536X770_PAIGE_OPEN: PASS: local Chrome scene and lower waveform are visible within the stage.
SOLO_1366X768_PAIGE_CLOSED: PASS: local Chrome fixture opens and returns to the existing trigger after End.
SOLO_1366X768_PAIGE_OPEN: PASS: local Chrome scene and lower waveform are visible within the stage.
SOLO_1024X768_PAIGE_CLOSED: PASS: local Chrome fixture opens and returns to the existing trigger after End.
SOLO_1024X768_PAIGE_OPEN: PASS: local Chrome scene and lower waveform fit without horizontal overflow.
SOLO_900X1000_PAIGE_CLOSED: PASS: local Chrome fixture opens and returns to the existing trigger after End.
SOLO_900X1000_PAIGE_OPEN: PASS: local Chrome scene and lower waveform fit without horizontal overflow.

## Measured rendering

The isolated fixture counted browser frame callbacks and actual canvas clears during 1.5 seconds of steady, simulated speaking. The original Chrome and Edge builds painted the galaxy and waveform about 45 times in each desktop run while the browser offered about 90 callbacks. The final build drew the waveform 89–90 times while the galaxy advanced without a canvas repaint. Chrome and Edge had comparable counts at 1440×900 at DPR 1 and 2 and 390×844 at DPR 3. Their desktop waveform p95 intervals were 17.1–18.6 ms. These measurements cover local browser work and emulated viewports. Display refresh and physical-phone performance remain unverified.

Windows Playwright WebKit passed the interaction matrix at its default pixel density. Performance varied across runs. The final desktop test measured 13 and 5 browser callbacks in individual 1.5-second runs at DPR 1 and 2. The nearby baseline rerun measured 20 and 3. A DPR 3 narrow run observed a stationary transform over one 240 ms interval. These results establish neither a consistent WebKit improvement nor Safari parity. This Windows result is separate from the native Safari measurements below.

The procedural galaxy paints tightly bounded textures on first size and device-pixel-density changes. CSS transforms move the star field and orbit layers independently. The projected silhouette rotates with the layers. The scene clips the transformed square bounds to prevent horizontal stage scrolling. The waveform samples the existing playback amplitude on a time basis and interpolates between samples for foreground repaint cadence. Galaxy motion pauses on Hold or hidden documents and honors reduced motion. A Chromium emulated density change with a delivered resolution event exercised the refresh at a fixed CSS width. No physical display switch was exercised. No voice, authority, authentication, provider or billing paths change. See the [Second Brain lesson](../../brain/lessons-learned.md).

## Native Safari and PAIGE Cloud

Native Safari 27.2 on a macOS 15.8.2 standard GitHub runner at a foreground 1450×928 viewport and device pixel ratio 1 doubled the median bottom-waveform draws from 45 to 90 per 1.5 seconds. The median p95 interval fell from 36 to 18 ms. The Command Logo intro, galaxy motion, lower waveform, Hold, Resume, Interrupt, End and native Reduce Motion passed with simulated voice. Physical Retina and iPhone performance remain unverified.

The two source revisions were baseline `fbea61da6b27334e47896e8d262f987656a1c520` and reviewed product head `8eeb632c69c79b35c391cc59679eab26a6f43e0d`. Each received the same simulated relay and three 1.5-second foreground samples. Baseline waveform paint counts were 44, 45 and 45, with p95 intervals of 41, 36 and 36 ms. The candidate drew 90 times in each sample at 18 ms p95. Native OS Reduce Motion kept the waveform feedback and lowered painting to 15 times per sample. The [native Safari run](https://github.com/Paige-Agent-AI/Paige-Agent-AI/actions/runs/45107118450) contains the fixture logs and evidence artifact.

The reviewed product head merged to main as `d7fa65afa27969f171b61fa692b6004f0518c7d6`. The [EXP00 release checkpoint](https://linear.app/paigeagentai/issue/ANT-158#comment-10d3ebb8-a673-4f80-9f9d-5e9f85c81c51) tracks PAIGE Cloud promotion, public build readback and the rollback reference.
