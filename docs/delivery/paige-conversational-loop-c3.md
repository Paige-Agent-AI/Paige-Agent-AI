# PAIGE conversational loop — C3a: living turn states in the Solo PAIGE chat

> **APPROVED-FROZEN (§28).** The C3 prototype was approved by the owner on 2026-10-05. It is committed,
> byte-for-byte as approved, at `docs/design-references/prototypes/paige-turn-states-c3.html` so any
> later session can check fidelity against it. Its design
> intent and interaction shape are frozen: the per-answer status line, the inline "What PAIGE did",
> the outcome footer, the approval presented without a synthetic bubble. Accessibility, truthful-state,
> responsive/reflow, reduced-motion and compliance corrections that keep that intent need no new owner
> decision (owner ruling, below). Anything else that changes this design needs the owner.

Sequence: R0 → C0a → C1 → C1b → C2a → C2b → **C3a (this)** → C3b → C4 → C5.
Pre-edit packet: the orchestrator's C3a packet. Its grounding notes were session scratch; everything
they decided is recorded in this document.

## The owner ruling (2026-10-05, final wording — recorded verbatim in substance)

The C3 prototype is approved; under §28 its design intent and interaction shape are frozen.
Accessibility, truthful-state, responsive/reflow, reduced-motion and compliance corrections that
preserve that intent do not need a new owner decision.

- **What PAIGE did:** inline within the relevant PAIGE answer. Render it only when there is actual
  work/trace to show; never an empty trace on fast answers.
- **After Approve:** no extra visible "Approved — run it." user bubble. C3 may present the approval
  outcome cleanly inside the existing conversation, but must NOT claim or fake server-carried
  same-turn continuation while the canonical runtime still creates a separate approval request/turn
  underneath. True server-carried approval resume is C4. Wire, persisted history and reload stay
  truthful: canonical history is not rewritten; the synthetic bubble is hidden only in presentation.
- **Background work completes:** a new answer linked to the original objective; never mutate an
  already-completed answer. Durable resume is C4 (out of this slice).
- **Fast answer:** no status line and no empty What PAIGE did.
- **Warning tone:** theme-aware neutral/ink text with a warning triangle; no decorative warning
  colour; AA in both themes.
- **Focus ring: indigo — the shared `--ring` token, NOT gold.** Gold stays for the act / approve /
  on moment (§11). No C3 exception to the shared focus-ring rule. (The prototype's OD6 default of
  gold is overruled.)
- **Owner, same day: "I don't mind light touches of indigo."** Light indigo accents — the focus ring,
  the running/live indicator, a quiet active state — are welcome where they serve the state; gold
  stays reserved for the act.
- Earlier rulings kept: preserve all existing content, approval cards, research cards, CRM results,
  greeting behaviour and saved-thread semantics; turn state (`paige_turn`, `bundle_ref.turn_state` /
  `turn_trace`) is THE control signal — never infer from final prose; low-level lifecycle stays in the
  expandable What PAIGE did; no prose per tool start.

## Scope: what C3a ships, and what waits

### In C3a (true on today's contract — C1 turn frame, C2a/C2b step lifecycle)

| Prototype frame | As built |
|---|---|
| f1–f4 Fast | Nothing for the first 400 ms; "Thinking" after that; the line steps aside for good when `FINAL fast_answer` arrives; no line and no trace when settled. |
| n1–n6 Normal work turn | "Thinking" → the running step's label → "Writing the answer" (only after the server's terminal or its writing phase) → "What PAIGE did · N steps" with the measured time. One DOM node throughout. Error rows show the server's label and detail. A withdrawn row is removed. |
| r1–r3 Deep Research | "Researching the live web" (the server's START label) → after 10 s of that START, "Still researching — this kind can take a couple of minutes." → the research card plus "What PAIGE did · 1 step". Dark-mode pill fix in the research card (frame r3). |
| a1, a2, a5, a7 Approval | Running label while drafting; "Waiting for your OK" (hand icon) as soon as `WAIT_APPROVAL` arrives, card unchanged (gold Approve, "Not now"); a quiet composer hint "PAIGE is waiting on your OK above" only while the card is scrolled out of view; Not now → "Skipped · nothing changed"; the report card's existing outcomes. |
| a3/a4 as presentation only | The "Approved — run it." / "Hold off — skip that one." bubble is not drawn; the next answer sits closer under the decided card (`data-paige-continues="approval"`, 8px), with its OWN line and its OWN steps. Nothing says resumed, picking up, same answer or keep going. Hiding the bubble never hides whether the action ran: when the client ran a stored proposal through the door it appends its own verified result to that sentence (" [Card result — Add John Coleman: didn't run]"); Solo's report card already answers for it, and on the drawer — which has no report card — the decided record now carries "Result: Add John Coleman: didn't run" (`decisionCardResult`). After "Not now" (and after Approve on the drawer) the pressed button is gone, so focus moves to the decided record that replaced the card ("Skipped · nothing changed", with the indigo ring) instead of falling to the page; the composer is disabled while the follow-up runs, so it cannot take focus. |
| l1, l2 Limit | Over 8 rows → "Show all N steps"; `LIMIT_REACHED` → "Reached the limit for one answer" with a triangle, ink, never a check. |
| l4/l5 Interrupted | `INTERRUPTED` → "Stopped before finishing"; footer "What arrived is above." only when answer text arrived; "Ask again". |
| s1, s2 Stop | Send becomes Stop (existing). Stop → "Stopped by you" (pause), the started step kept as "Stopped — it may still finish on its own", footer "Stopped showing this answer. PAIGE may still finish work that had already started." When the existing rollback has put the question back in the composer (an ordinary turn) the footer adds "Your question is back in the message box." and offers only "See what finished"; when it has not (a decision turn is never rolled back), a quiet "Ask again" puts it back. Focus moves to the footer — except when Stop came from a Live voice interruption, which never moves keyboard focus. |
| h2 Refused | `REFUSED` → lock, "Stopped — couldn't confirm that client"; the existing notice is the body. |
| o1 Reload | `bundle_ref.turn_state` + `turn_trace` rebuild the same line and rows (labels, status, department). A saved `WORKING` record → "Didn't finish" + "Ask again". The decision sentence is hidden on reload too when anchored, and the settled card line gains "· You approved · 2:14 PM" — what the person said, nothing about whether it ran. If that saved sentence carries the client's own card result, it is drawn under the line ("Result: … didn't run"), so a reload shows exactly what the hidden bubble used to. |
| e1 First use | Greeting kept word for word; no line (it is not a turn). |
| k1–k3 | Unchanged banners and toast. k4: the six-minute window settles the line to "Stopped listening at six minutes" (clock), never Done; the existing banner is unchanged. |

### Deferred — must not be simulated

| Frames | Waits on |
|---|---|
| a3/a4 resuming in the same answer (`resumed`, merged trace, "same answer") | **C4** server-carried approval resume |
| a6 approval expired | **Server**: `paige_confirm` carries no `expires_at`. Today: on Solo the report card says "Didn't run"; on the drawer a door-executed card shows "Result: …: didn't run" on its record; any other card on the drawer has only PAIGE's reply to say so (the drawer has no report card — C3b) |
| Member seat "Waiting for an owner's OK" | **C3b** (needs a seat signal in `PaigeAIChat`) |
| c1–c6 questions with choices in the main chat | **Server** (`ask_choices` is Studio-only) + **C4** |
| w1–w5 background progress; d1–d3 completion pickup | **C4** |
| m1–m3 specialist grouping / consult without approval | **C5 + INT-310** |
| l2/l3 "Keep going" on the same objective; model-written counts | **C4**; counts are model prose, not state |
| r2 real source counts; r4 "Ask a narrower question" | **Server** (Deep Research lane); **C3b** |
| h1 portal held-back answer; Studio / Operator / Portal parity | **C3b** (different chrome and consumers) |
| Executed beat (gold Command Mark, once) | **C3b** — `PaigeCommandMark` has no executed state, and the packet ruled not to build a new mark in C3a |
| a7 warning tone on the shared card seal | **C3b** (touches the shared `PaigeConfirmCard`) |

### Truth corrections that keep the design's intent (allowed by the ruling)

| Frame | Approved copy | C3a copy | Why |
|---|---|---|---|
| l2 / r4 | "Hit the step limit for one answer" / "Hit the time limit" | "Reached the limit for one answer" | The frame and record carry no cause. |
| l2 footer | "Five clients are left." + Keep going | no footer | Counts are model prose; Keep going is C4. |
| l4 / l5 | "Stopped — your active workspace changed" / "the connection dropped" | "Stopped before finishing" | The cause is not on the wire. |
| Ask again (l4/l5, s2, o1) | "Ask again" | prefills the composer with the original request; never sends | A request that already did things would repeat them if re-sent by itself. |
| WAIT_WORK | "Working in the background" + stages | "Started in the background · N steps" (clock, settled) | Present tense goes stale on reload; stages are C4. |
| o1 meta | "Yesterday · 14s" + step detail | labels, status, department only | `turn_trace` holds `{label, group, status}` only. |
| Line wording | "What PAIGE did" | `What ${persona.name || "PAIGE"} did` | The persona is tenant-authored (§7). |
| s2 placement | The stopped answer under the question | a stopped row where the answer was; the question is back in the composer, and the footer says so | Stop has always rolled the turn back (protected by `PaigeAIChat.composerScope.test.tsx` "cancel-safe prompt": the prompt returns to the composer and a resend carries exactly one user message). Keeping the half-answer on screen would change what the next request sends. **Visible difference from the frame — for the owner to see:** the question is not drawn above "Stopped by you", and the stopped row (with its "See what finished") is gone once the next request is sent, because the rolled-back turn has no message to keep it on. Keeping it would mean changing the shipped rollback (a §58 decision). |
| s2 footer | "Anything already finished is saved. A step that had started may still finish on its own." | "Stopped showing this answer. PAIGE may still finish work that had already started." (+ "Your question is back in the message box." when it is) | §13: Stop ends the READ, not the work. In `paige-ai-chat`, `req.signal` reaches only the spine resolver and step emits swallow a hung-up client; nothing stops the tool loop, so it can start further steps and save the answer afterwards. Neither "anything finished is saved" nor "only the step that had started" is guaranteed. |
| s2 "Ask again" | Always offered | Offered only when the question is not already back in the composer | After the rollback the button would only re-focus the composer; it did nothing new. |
| Q1 order | Opening sentence above the line | the line leads the bubble, live and on reload | The saved answer is one string; a live-only split would rearrange the answer on reload. |
| Q2 shell | PAIGE full-width, surface user bubble | the shipped Solo bubbles | The full-width chrome is the dead `operator` branch; restyling every message was not approved. |

## As built

- `src/lib/paige-stream/turn-view.ts` — the pure view model: `deriveLiveTurnView`,
  `deriveSnapshotView`, `upsertTurnRow`, `settleTurnRows`, `readTurnTrace`, `formatElapsed`
  ("<1s" under a second, never "0s"), `DECISION_REPLY` + `isDecisionReplyText` + `decisionCardResult`.
  Reads turn state, step frames, the client clock and one boolean (did answer text arrive) — never
  the answer text. The only string readers read the USER turn the card sent (the client's own two
  sentences and the result suffix the client itself appends); a test reads the module's source to
  keep every other function text-free. The 400 ms gate is checked before every working label, so a
  server writing marker inside the gate (held answers, Live and document turns send it before their
  terminal) can never flash a line on a fast answer. A test pins that `refusedTurn.refused()` (the
  client-scope refusal) is the only REFUSED emitter, because the REFUSED copy names that cause.
- `src/components/paige/chat/PaigeTurnStatus.tsx` + `paige-turn-status.css` — the line (glyph,
  sentence, tabular meta, whole-row disclosure), the inline trace (folds to 8 rows plus "Show all N
  steps" only when that hides at least two; a bottom Sheet below 640px that carries the shell's own
  `data-pg` theme scope because it is portaled outside the shell), the footer, and one polite
  announcer per change of state. A new label fades in over 120 ms. A live line runs one clock (the
  live wrapper's, passed down). Token-only; no gold; indigo sweep while working, solid rule when it is
  your move; every effect has a reduced-motion fallback; the sweep pauses offscreen and when the tab
  is hidden. Step detail text is full `--muted-foreground` (the earlier .9 tint measured 4.34:1 in
  light, under AA).
- `src/components/dashboard/PaigeAIChat.tsx` — reads `paige_turn` (was dropped), mirrors step frames
  into the live turn, settles it on every exit (done / Stop / six-minute window), stamps the settled
  answer, rebuilds it from `turn_state`/`turn_trace` on reload, hides the decision bubble in
  presentation, settles the decided card in the drawer mount too (with its verified result when one
  was recorded), the approval-offscreen hint (plain text, no live region — the state was already
  announced). One voice per state: the line does not announce while the approval card or the report
  card is speaking for that answer. An answer that carries a line or a live card takes the column
  (`w-full`, still capped at 80%), so the line and the card are not squeezed into a bubble shrunk to
  its first sentence.
- `src/components/chat/anchoredTranscriptScroll.ts` — one additive method, `holdMessageAt(node)`.
  Opening "What PAIGE did" is the person's own move: the transcript records the same anchor an owner
  scroll would, so the trace grows below the line instead of bottom-follow pushing the line out of
  view (measured in the drawer: without it the pressed line moved from 174px to −26px; with it, it
  stays at 174px). "Jump to latest" restores bottom-follow.
- `src/index.css`, `tenant-command-center-shell.css`, `tenant-command-center-core.css` — the shared
  focus ring is `hsl(var(--ring))`, and `--ring` in the `[data-pg]` bridge is the indigo
  (`251 25% 47%` light / `250 57% 72%` dark).
- `paige-research-card.css` — token rules for the saved/confidence pills and the citation links,
  scoped to `[data-pg]` in BOTH themes (not dark-only): they glared in dark, and in light the
  "medium" pill was spending a gold-brown on a resting label. Citation links are indigo there.
- `src/index.css` — besides the ring, six inline `impeccable-disable-next-line` waivers on findings
  that are identical at the base commit (the `Inter` body face, two gradient-text utilities, three
  bounce easings). The CI Impeccable step scans every changed stylesheet whole, and the focus-ring
  rule cannot leave `index.css` without changing the cascade: it sits in Tailwind's base layer, where
  `focus-visible:outline-none` utilities beat it; any rule in a later stylesheet that still beats the
  gold base rule would also beat those utilities and draw a second ring on every shadcn control.
  Waived, not fixed — fixing them restyles unrelated surfaces. Tracked as its own follow-up.
- Harness: `scripts/live-drive/harness/paige-chat-mount/solo.html` (+ `solo-main.tsx`,
  `solo-stubs.ts`, `solo.vite.config.ts`, `solo-drive.mjs`).
- Not touched: `supabase/**` (no edge deploy, no migration), `PaigeStepTrace`,
  `PaigeThinkingIndicator`, `PaigeConfirmCard`, `PaigeResearchCard`, `PaigeCrmResultCard`,
  `PaigeArtifactCard`, the portal `PaigeChat`, Studio, Operator, `usePaigeThreads`,
  `SoloPaigeWorkspace`, `TenantCommandCenterShell.tsx`.

## §58 declarations (shipped behaviour removed or changed on purpose)

1. The pinned "on watch / at work" strip (`PaigeReasoningStrip`) is no longer mounted by
   `PaigeAIChat` (both live mounts); each answer carries its own inline line and trace (owner, OD1).
   The component stays shipped for its other importers.
2. `PaigeThinkingIndicator` is no longer mounted by `PaigeAIChat`. Its "Thought process" disclosure
   (visible on the drawer mount) is gone — owner proof 9: no chain-of-thought. It stays shipped for
   the portal, broker and Studio.
3. The synthetic approve/decline bubbles are hidden in presentation only. The data sent and the stored
   history are unchanged (tested: the POST still carries the sentence).
4. The Solo cancel notice ("Response stream cancelled locally…") is replaced by the Stop footer; its
   truth (server-side cancellation is not confirmed) is kept in plain words.
5. Focus rings across `[data-pg]` / `[data-tenant-shell]` change from gold to indigo (owner-ruled).
   This reaches every Solo, agency and business surface and the operator shell; the 48
   `hsl(var(--ring))` consumers inside `[data-pg]` now draw indigo (defect 1 in the truth map — gold
   leaking into watch surfaces — fixed). Surface stylesheets that set their OWN gold focus outline are
   not changed here: `solo-calendar.css`, `tenant-relationships-clients-workspace.css`,
   `solo-conversations-workspace.css`, `analytics2.css`, `settings*.css`, `IntegrationsSurface.tsx`
   (follow-up, so the owner's ring rule reaches them without a C3 exception).
6. Added on the drawer mount: a decided card settles into its record ("Approved" / "Skipped ·
   nothing changed") instead of vanishing — otherwise hiding the bubble would erase the only sign of
   the decision — and, when the client recorded a result for a door-executed card, the record shows
   it. What the decision RUNS there is unchanged (no report card, no outcome stamp).
7. Opening "What PAIGE did" stops the transcript following the bottom, exactly as an owner scroll
   does ("Jump to latest" brings it back). Before, opening it while pinned pushed the line out of view.
8. Focus after a decision: "Not now" (both mounts) and Approve on the drawer move keyboard focus to
   the decided record (focusable, never in the Tab order) when the pressed button disappears; before,
   it fell to the page. Solo's Approve is unchanged (its report card takes focus).
9. PAIGE answers that carry a status line or a live card are as wide as the column allows (still
   80% max); before, they shrank to their content.

## Residual risk (recorded, not fixed here)

- The wire terminal on an ordinary turn is provisional (`contract.ts` "THE WIRE TERMINAL IS
  PROVISIONAL"). If an answer breaks after its first word, the live line can keep FINAL while the
  stored record says INTERRUPTED; reload shows the record. A post-persist reconciliation read is out
  of scope.
- Reload detects a decision sentence only when it is exactly one of the client's two sentences AND
  directly follows an answer with `paige_confirm`. A person who TYPES that exact sentence right after
  a card sees it hidden on reload with "You approved" — literally what they said; it still claims no
  execution. A structured marker on the user turn needs server work (noted for C4).
- Live versus reload for a TYPED decision sentence: typing "Approved — run it." under a live card sends
  no fingerprints, so nothing runs and the bubble stays visible live; on reload that same turn is
  hidden and the card reads "You approved". Literally what they said, still no claim of execution;
  the structured marker that would tell the two apart is server work (C4).
- Between two steps the line reads "Thinking" for a moment — truthful (no step is running), so it is
  left; holding the last label would claim a step that has finished is still running.
- Pre-existing, not in this slice (follow-ups): the composer's Stop key is gold (Stop is not the act;
  the prototype's s1 draws it ink); `[data-pg] a` still paints links inside answer text gold; about
  nine surface stylesheets (calendar, clients workspace, conversations, analytics2, settings, mind,
  systems check, presence, setup, vault, `IntegrationsSurface`) still set their own gold focus ring —
  the owner's ring rule needs to reach them with no C3 exception; the six waived `src/index.css`
  findings; `useStudioChat` and `useOperatorChat` still spell the two decision sentences themselves
  (C3b moves them onto `DECISION_REPLY`).
- Approved-frozen surfaces inside `[data-pg]` that inherit the shell ring and now draw indigo focus:
  `marketing-audience.tsx`, `solo-campaigns.css`, `sales-ops.css`, `social-command.css`. This follows
  the owner's shared-ring ruling; it is listed so the owner sees it.
