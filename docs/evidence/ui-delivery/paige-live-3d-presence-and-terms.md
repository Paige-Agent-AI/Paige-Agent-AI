# The 3D Paige, and a control a Solo user can actually press

Existing Project / R3 Deep, Flow-by-Flow 2.0.2, then Impeccable 4.1.0 for the craft floor (§00:
Flow-by-Flow first, then Impeccable). Two things the previous slice left undone: the presence in the
corner of the Live stage was a 2D spline while the sculpted Paige sat unused in the repo, and there
was no way in the product to give the acceptance the database requires — so an open rollout still
left a person with nothing to press.

## The 3D presence

`public/paige/paige-woman.glb` is Paige. Approximating her with primitives while the sculpted asset
sits in `public/paige/` is the §31 failure this avoids, and the landing hero has loaded that asset
through `useGLTF` since before this surface existed, so the technique is proven here rather than
invented. What is deliberately NOT borrowed is the landing's composition (§30 — reference the how,
design the what): that hero is a marketing stage with an orbiting bot and grab-to-rotate; this is a
presence in the corner of a conversation, framed close, still, and reacting only to sound that is
actually moving.

Every animated value comes from `presenceFrame`, the same function the flat presence has always
used. Its `energy` term is zero unless the state is speaking or listening AND a real sample arrives
from the output or microphone analyser. A scene that pulsed on a timer would look identical and
would be a lie about whether anything was heard, so the smoke test asserts silence stays silent in
all nine states.

§58 — the owner-approved flat presence is NOT removed. It is what renders when WebGL is absent, while
the 3.7 MB model streams, and whenever the scene throws. §32 — every degrade path logs its cause;
a boundary that renders null with no console line is how a compiles-but-crashes bug hides.

## The acceptance control

`paige_live_accept_terms()` has existed since migration `20270422000000` and had no caller, so the
capability was correct and unusable. The Live stage now offers it on the one refusal a person can
act on, states plainly what happens to their audio before they agree, and reports the refusal
honestly when the rollout does not cover them — writing nothing, claiming nothing.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Flow-by-Flow 2.0.2, Existing Project / R3 Deep; affected flow is "a Solo operator opens Live, agrees to what happens to their voice, and speaks"; states mapped for first use, streaming, WebGL absent, scene throw, reduced motion, refusal, acceptance, and retry
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design/SKILL.md and its routed references read; Impeccable 4.1.0 detector run over every changed UI file, clean
MATERIAL_FLOW_CHANGE: YES: a person gains an action they did not have — accepting Live's terms for themselves — and the presence gains a state-reactive 3D representation with a documented fallback chain
FLOW_PROTOTYPE: WAIVED: owner-decision=2026-09-24 in-session ruling, "you have my full authorization to see this thing all the way through, to the finish" and "merge it live on main, so when I wake up, I can just go test it"; reason=the owner is asleep and explicitly asked for the work merged to production for him to judge on the live site rather than through an approval surface, which is CLAUDE.md §4's pre-launch stance ("a Vercel preview link is NOT a deliverable") applied to this change. The design is his to accept or reject on main, and the §69 Gate 1 approval he would give a prototype he has instead given to the merge
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo operator, in their own workspace, turns on Live and talks to Paige about their own book; the primary action is the gold "I understand — turn on Live" control, which is the only gold in the frame
VISUAL_DIRECTION: PASS: indigo/violet ground with one warm accent, spent on the act and on the halo that brightens only with real audio; token-only CSS, no hardcoded hex in the stylesheet; depth from elevation, a hairline edge and a soft floor rather than from darkening (§22/§23)
AUTOMATED_EVIDENCE: PASS: 37 Live surface tests pass including four new ones driving the acceptance flow end to end, and a mutation check confirms they discriminate — removing the terms panel turns three of them red. The headless 3D smoke parses the real 3.69 MB GLB, computes the normals the export omits, swaps materials, frames the model to 2.400 units and builds the halo. The matching honesty assertions — silence produces zero energy in all nine states, a real sample drives it, and a sample arriving outside speaking/listening is still silence — are in presence.test.ts rather than the smoke, because the CI job that runs the smoke is on Node 20 and importing the module there would have SKIPPED them silently; mutation-checked, and forcing non-zero energy turns 6 of that file's 7 tests red
STATIC_EVIDENCE: PASS: tsc clean; Impeccable detector exit 0 on PaigeLiveConversation.tsx, PaigePresence3D.tsx, PaigePresenceScene.tsx, paige-live-conversation.css and paige-presence-3d.css
RENDERED_EVIDENCE: UNVERIFIED: this session has no browser, so no frame of the 3D presence has been seen. The headless smoke proves the model parses, materialises and frames; it does not prove what it looks like
BEHAVIORAL_EVIDENCE: PASS: the acceptance flow is driven in a real DOM — refusal renders the terms, the control calls the RPC with NO arguments, acceptance is followed by a genuine second start attempt and a relay connection, and a refusal starts no session, requests no microphone and claims no success
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated drive of the deployed surface and no provider conversation. Owed to a session with a browser (§32)
KEYBOARD_FOCUS: PASS: the new control is a standard Button inside the existing dialog focus trap, which the suite's Shift+Tab and forward/backward traversal tests still cover
ZOOM_REFLOW: UNVERIFIED: no fresh viewport capture; the 3D frame uses the same width clamps and breakpoints the flat presence already used, so geometry is unchanged by construction
REDUCED_MOTION: PASS: under prefers-reduced-motion the scene renders one still frame and stops (frameloop "demand", no useFrame work). Losing Paige entirely is a worse answer to "please do not animate" than a still portrait
STATE_COVERAGE: PASS: WebGL absent, the moment before WebGL support is known, model streaming, scene throw, reduced motion, and all nine presence states; plus refusal, acceptance, acceptance-refused, and a refusal the person cannot act on, where the terms are deliberately NOT offered
TRUTHFUL_STATE_LABELS: PASS: no LIVE claim; the copy states default provider retention and single-speaker as facts rather than reassurances, and the refusal says nothing was recorded, sent or saved because nothing was
SOLO_UI: YES: the Solo Paige Live Conversation stage
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser in this session
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser in this session
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser in this session
UNVERIFIED: every rendered and authenticated-runtime claim. Nobody has SEEN the 3D presence — not the author, not a reviewer, not the owner. The headless smoke proves it will not throw and that it frames correctly; what it looks like on screen is the owner's judgement on the live site, which is what he asked for. Also unverified: any real conversation, because the rollout scope ships off and opening it is his decision about provider retention, not an engineering step

OWNER_INTENT: "add some animation and motion as well as 3D view of Paige in the left hand corner talking", and Live that works for Solo users including brand-new accounts rather than one that reports itself unavailable
MUST_NOT_HAPPEN: An empty corner when WebGL is missing or the model fails; a silent 3D crash; motion that implies audio nobody can hear; a control that claims Live turned on when it did not; the flat presence being removed; a microphone request before acceptance; any account identifier supplied to the acceptance call
MUST_PRESERVE: The approved flat presence in full, as the fallback; the existing stage layout, focus trap, controls and honest unavailable state; the presence signal contract; every width clamp and breakpoint
ACCEPTANCE_CRITERIA: A Solo operator opens Live, reads what happens to their voice, presses one control, and either starts talking or is told plainly that it is not open for them — with nothing recorded either way; the corner always shows Paige, in 3D where the device allows it and flat where it does not; and reduced motion yields a still portrait rather than an empty frame
MOTION_PURPOSE: The float and turn say she is present and attending; the lean says she is listening; the halo brightens ONLY with real audio energy, so motion distinguishes "hearing you" from "idle" rather than decorating the wait. Under reduced motion every one of these resolves to a single still frame
PROTECTED_SEAMS: Affected and tested: the Live stage's refusal states, the acceptance seam, the presence signal contract, the focus trap. Unchanged: Live admission and rollout authority (untouched by this change), relay transport, ticket issuance, thread and transcript behaviour, the composer, account/workspace isolation, autonomy and approvals, Secure Browser and Vault
INTERNAL_BUILD_IDENTITY: pr=PENDING; base=2043b6b88e9f93fe7ceb42d136befff8fa81998b; deployment=vercel-preview(paige-live-3d-presence); environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/paige-presence-3d-smoke.mjs
RELEASE_CHANNEL: preview: the PR preview build only. This change adds no migration and no edge function; it is frontend plus one CI smoke step
RELEASE_CLASSIFICATION: internal-only: a presentation and acceptance-control change on a capability whose rollout scope remains closed
CUSTOMER_RELEASE_IDENTITY: none: the rollout is still shut, so there is no customer-visible outcome to name as a release
RELEASE_NOTE_REQUIRED: no: no customer announcement
RELEASE_TRUTH_BOUNDARY: PARTIAL: the acceptance flow and the 3D presence are built and proven headless; what the presence LOOKS like, and any real conversation, remain PROOF OWED
RELEASE_RECOVERY: position=revert this commit, which restores the flat presence as the only presence and removes the acceptance control, leaving the database and the rollout exactly as they are because neither is touched here; reference=the PaigePresence3D fallback chain, which already degrades to the flat presence at runtime without a deploy

## Scope and collisions

- Classification: Existing Project / R3 Deep. Major UI change, so delivery controls apply.
- Affected flows: opening Live; agreeing to Live's terms; watching Paige while she listens and speaks.
- Neighboring regressions: the Live suite's 33 pre-existing tests still pass unmodified; the 3D presence falls back to flat under jsdom, so they exercise the real fallback rather than a stub of it.
- Active-owner/file collisions: none.
- Explicit exclusions: no rollout is opened; no provider contact; no migration.

## Evidence index

- `npm run smoke:paige-presence-3d` — real GLB (3.69 MB), 1 mesh, normals computed on 1, framed to 2.400 units, halo 873 vertices. Runs on plain `node`, so it executes on CI's Node 20.
- `npx vitest run src/lib/paigeLiveConversation/presence.test.ts` — 7 tests, including the two that hold the 3D scene to real audio; a mutation forcing non-zero energy turns 6 of the 7 red.
- `npx vitest run src/components/paige/live` — 37 tests, all passing; mutation check turns 3 of the 4 new ones red.
- `npx --yes impeccable@4.1.0 detect` over all five changed UI files — exit 0.

## Review and limitations

The single largest limitation is stated above and is not hedged: nobody has seen this render. The
headless smoke was written precisely because that is true — it proves the scene will not throw and
will not blank, so the owner's live look is a judgement about design rather than a hunt for a crash.
