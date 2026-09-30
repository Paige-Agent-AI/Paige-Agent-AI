# Governance seam convergence — the plan

> **STATUS: PROPOSED. Nothing here is built.** This document is the scoping deliverable for the
> Platform Reach lane's fourth census item. It ends in three decisions that are not the lane's to
> make, and it should not become a branch until those are answered.
>
> Companion to `docs/delivery/chat-completion-matrix.md`, which is the chat lane's own delivery
> record and where this gap was first written down.


> **Line numbers are as of commit `bad21bed6` (2026-09-24).** `paige-ai-chat/index.ts` is an
> actively edited file — a single base merge on the night this was written moved every anchor below
> by up to thirteen lines. **The durable references are the SYMBOLS**, not the numbers:
> `executeToolCalls` (one definition, one call site), the `CRM_COMMAND_TOOL_NAMES.has` guard that
> opens the CRM short-circuit, and the `functions.invoke("crm-command")` beneath it. Re-derive a
> line before quoting it; and note that `CRM_COMMAND_TOOL_NAMES.has` appears **five** times in the
> file, so grepping for it and taking the first hit finds the wrong one — the dispatch short-circuit
> is the occurrence immediately followed by `JSON.parse(tc.function.arguments`.


---

## 1. The finding, and why it is a flagship rather than a ticket

The platform has **two parallel governance implementations**.

`decideGovernedExecution` (`supabase/functions/_shared/paige-spine/governedExecution.ts:464`) is the
shared, door-blind seam: pure, synchronous, no I/O, no clock, no randomness. It is reached by
**7 of 291 edge functions** — `crm-command` directly (`:342`), and `paige-write-back`,
`paige-social`, `skill-runner`, `paige-mcp`, `paige-native-event-dispatch` and `execute-approval`
through their adapters.

`supabase/functions/paige-ai-chat/index.ts` — 14,928 lines, the largest governed surface the
platform has — **never calls it**. `grep -c governedExecution` returns `0`. It runs its own inline
gate over roughly 155 model-visible tools, of which **about 47 are classified mutations governed
only by that inline path**.

The consequence is not primarily a security one; both paths are careful. It is that
**"route it through the shared seam" is advice a lane cannot follow for a chat tool.** The
Single-Spine rule is unenforceable on the largest surface we have, and every lane that adds a chat
write inherits the fork.

**This was already recorded, and then never scheduled.** `chat-completion-matrix.md:152` carries it
as a `PARTIAL` row with the remedy written out — *"converge chat + durable jobs + subagent/skill
onto the one seam"* — and cross-cutting finding `:168` restates it. That document's own six-slice
delivery plan sequences capability discovery, persistent tasks, research presentation, knowledge
citations, agent-control surfaces and authenticated proof. It does not sequence the convergence.
Written down, then left out of the schedule. This document is the missing slice.

**A correction to that document, owed in the same change (§13/§66).** It says the seam is
*"adopted only by the MCP adapter."* That was true once; there are now seven callers, listed above.

---

## 2. Why this is tractable — two facts that bound the work

Both were the open questions before scoping. Both came back favourably.

### 2a. There is ONE dispatch chokepoint

`executeToolCalls` is defined at `paige-ai-chat/index.ts:8286` and called from **exactly one
place**, `:13520`. Only two provider requests expose `tools:` (`:8208` round 0, `:13574` rounds
1–4); both feed that one call. The closing call at `:13588` sends no tools.

Every governed tool in chat passes through one function. Had the answer been "N independent paths",
this would be a different and much worse job.

Inside it, the gate occupies `:8286`–`:9015` — **730 lines, of which perhaps 250 are executable
statements**; the rest is doctrine prose. That is the surface being changed. The 3,944-line dispatch
chain below it (`:9025`–`:12968`) is **not** in scope: it runs after the decision and is untouched.

### 2b. Chat already delegates 33 tools to the shared seam

This is the most useful fact in the report, and it is inside the file being migrated.

At `:8327` the CRM tools short-circuit before the inline gate and are forwarded to the
`crm-command` edge function at `:8370` — auth header passed through, approved fingerprint passed
through — and `crm-command/index.ts:342` calls `decideGovernedExecution`.

So chat is not a surface that has never met the seam. It is a surface where **one branch of the
chokepoint already delegates governance to it, in production, across a process hop**, and the other
branch does not. The convergence is finishing a job that was started, using a pattern this file
already contains.

---

## 3. What already agrees — the reason the risk is bounded

The two implementations were built to the same doctrine, and much of the core is not merely
equivalent but **literally the same module**: both import `_shared/action-risk.ts`.

| Rule | Chat | Seam | Shared code? |
|---|---|---|---|
| Risk derives from the action name alone | `:8807` `classifyAction` | `governedExecution.ts:493` | **Yes**, `action-risk.ts:623` |
| An unclassified write refuses at runtime | `:8451` (pre-gate) and `:8813` | `:598`, `:611` | **Yes**, `unclassifiedWriteReason` |
| `owner_only` admits no approval at all | `:8827` | `:617` | Same doctrine, both via `riskReason` |
| `auto` + `high` → `confirm`; `off` always survives | `:8735` `clampLaneByRisk` | `:668` (inlined) | Same rule, two homes |
| The gated set is derived, never hand-listed | `:7424` `mutatingTools()` | classification is the gate | **Yes** |
| Autonomy `off` refuses before approval is considered | `:8741` | `:677` | Same wording, written twice |
| Stored arguments are authoritative | `:9013` | `:709`–`:717` | Same rule, both narrate the same past defect |
| One approval, one execution (single-use claim) | `:7357`/`:7382` compare-and-set | consumes the result at `:709` | Complementary by design |
| An approval is for one capability | `.eq("tool_name", tool)` `:7338`/`:7385` | `:712` refusal | Same invariant, SQL vs field compare |
| Tenancy is server-derived | `:1879` via RPC, re-proved `:7195` | `:511` assertion | Same invariant |

**The decision logic is not the problem.** What diverges is (a) inputs the seam requires that chat
does not currently produce, and (b) behaviours chat has that the seam does not model. That is a much
better shape than two implementations that disagree about what is dangerous.

---

## 4. What diverges — ranked by migration risk

### The two that break everything on day one

**R1 — `outcome_channel_undeclared` breaks 100% of chat mutations.**
The seam refuses any mutation with no declared outcome channel (`:642`). In chat,
`outcomeChannel` has **zero occurrences**. Every other adopter solved this with one hard-coded
constant per door (`crm-command:355` → `"record_capability_run"`; the orchestration adapters →
`"paige_act_executions"`; `paige-mcp` → `"paige_audit_log"`). Chat *does* have a durable trail —
`auditWriteForTool` writes `paige_audit_log` for every executed tool (`:13246`) — it simply is not
*declared*. **Small fix, total outage if forgotten.** Reads are unaffected; the seam returns at
`:602` before reaching step 7.

**R2 — `access_denied` on an absent verdict, the largest blast radius and the hardest to do
honestly.** The seam treats a missing `access` as a refusal (`:540`). Chat has **no per-tool access
verdict at all** — only a client-seat allowlist (`:8327`), an owner-ops role gate buried in the
dispatch chain (`:9950`), and three per-branch role checks (`:12359`, `:12466`, `:11959`). Tool
descriptions saying "Admin/coach only" are prose to the model, not enforcement. `resolveOwnerOpsEligible`
(`:4513`) resolves exactly the right role set and feeds **only the prompt block**.

The adapter has two options and both are wrong. Omit `access` → every routed tool refuses. Pass
`{allowed: true}` unconditionally → that is precisely the adapter failure the seam documents at
`:210`–`:213`. **The honest fix is to give chat a real per-tool access verdict**, which is real
work and is the single largest line item in this plan.

### The one that is a product decision, not a defect

**R3 — the model-asserted approval channel disappears.**
Chat accepts `gateArgs.confirm === true` from the model for `ordinary` tools (`:8913`), refusing it
for `high` (`:8916`). The seam has **no boolean to inspect** and says so deliberately (`:79`–`:96`).

Measured: exactly **one** chat surface echoes approval fingerprints back —
`src/components/dashboard/PaigeAIChat.tsx:1051`. `StudioChat`, `PaigeChat`, `useOperatorChat`,
`useSoloChat`, `usePaigeMemory` and five `functions.invoke("paige-ai-chat")` call sites send no such
field. So a naive switch makes **33 `ordinary` mutations un-executable on every surface except
one**. Solo is safe (it mounts `PaigeAIChat`); the others are not.

This is the seam being deliberately stricter. It is an owner-level product call, not something to
decide inside a refactor.

### The rest, in order

| # | Divergence | Effect of a naive switch |
|---|---|---|
| R4 | **Availability** (`:556`–`:583`) has no chat counterpart at the gate | Zero impact if the adapter passes `"unknown"`, as `crm-command:357` does. Large and unpredictable if it passes a real status: there is no family↔tool map (21 families vs ~155 tools), and `proof_owed` hits the fail-closed default arm |
| R5 | **`tenant_unresolved`** — chat permits a null tenant (`:1858`–`:1873`) and binds `.is("tenant_id", null)`; the seam refuses (`:529`) | Unknown blast radius. **Must be measured on production before the switch** — the client-portal seat's only write hangs on it |
| R6 | **Studio auto-escalation** (`:8692`) raises five `ordinary` tools `confirm`→`auto` in a Studio session | Regresses the named, fixed bug the comment at `:8674` cites |
| R7 | **Pre-gate preconditions** — a verified whole-cent quote (`:8423`), a nameable subject for a high-risk card (`:8531`), a bound single-use archive preview (`:8571`) | Eight tools lose real safety properties no seam input carries |
| R8 | **The FIX B ambiguous-approval terminal** (`:8929`–`:8968`) records nothing and forbids a re-ask | The seam returns `propose{revalidate:true}` — the re-ask loop FIX B exists to stop |
| R9 | **Declines are durable** (`cancelConfirmations` `:7270`); a failure to record one blocks every mutation that turn | The seam has no decline concept; it stays adapter-side |
| R10 | **Lane-unrecognized policy**: chat coerces unknown → `confirm` (`:4487`); `crm-command` deliberately sets `"unresolved"` so the seam refuses | A deliberate choice to make, not a defect. Chat fails to *ask*; crm-command fails to *refuse* |

**Not a risk, worth recording:** the seam's `service_principal_may_not_mutate` (`:635`) is dormant
for chat — every chat request carries a person's JWT (`:739`, 401 otherwise). The adapter declares
`principal: "person"`, matching `crm-command:347`.

**Also found, and cheap to bank:** **14 dispatch branches are dead code** — nine tombstoned legacy
CRM writers intercepted at `:8327`, and five (`pipeline_create`, `pipeline_add_stage`,
`social_post`, `social_analytics`, `social_accounts`) whose tool definitions exist nowhere in the
tree. Deleting them shrinks the surface before anything moves.

---

## 4a. A finding that unifies this with the Capability Kit's missing runtime

Scoping this turned up something neither item was looking for.

**All seven seam call sites build the same object literal.** Every one of them constructs
`{caller, capability, approval, requestArgs}` by hand, and the variation between them is a handful
of per-door constants:

| Call site | `door` | `outcomeChannel` | `access` |
|---|---|---|---|
| `crm-command/index.ts:342` | `other` | `record_capability_run` | a real role verdict |
| `_shared/social-provider/governance.ts:97` | `other` | `record_capability_run` | passed in |
| `_shared/paige-orchestration/engine.ts:293` | `automation` | `paige_act_executions` | `{allowed:true}`, justified upstream |
| `_shared/paige-orchestration/approve-executor.ts:212` | `automation` | `paige_act_executions` | as above |
| `_shared/paige-mcp/governed-adapter.ts:242` | `mcp` | `paige_audit_log` | passed in |
| `_shared/paige-skill/governed-adapter.ts:150` | `skill` | its own constant | passed in |
| `_shared/paige-write-back/governed-adapter.ts:318` | `other` | its own constant | resolved |

Everything else is identical, down to the verbatim conditional spread
`...(effect === "mutate" ? { outcomeChannel } : {})`, which appears twice character-for-character.

**One door already extracted it.** `buildGovernedInputs` (`engine.ts:89`) is exactly this mapping as
a pure, documented helper — but door-specific: it hard-codes `door: "automation"`,
`principal: "person"`, `access: { allowed: true }` and the `paige_act_executions` default. Six
doors re-derive by hand what one door extracted.

**Why this matters beyond tidiness.** The Capability Kit's `defineCapability()` produces a frozen
declaration that *nothing reads* — the census's finding that it has zero adopters and, worse,
nothing for an adopter to gain. A declaration already carries `governance.actionRiskKey` (the
capability id), `effect`, `receipt.recorder` (the outcome channel) and `availability.states`.
Those are precisely the fields this mapping fills in seven times by hand.

So the Kit's missing runtime and this duplicated mapping are **the same gap seen from two sides**,
and one primitive closes both: a pure `governedInputsFor(capability, ctx)` that generalises
`buildGovernedInputs` — parameterising `door`, `principal` and `access`, taking the capability
fields from a declaration where one exists and a plain object where one does not, and bridging the
Kit's three-value effect vocabulary (`read | mutation | external_effect`) onto the seam's two
(`read | mutate`).

**It is Phase 0's natural first primitive**, because Phase 1's parity call needs exactly this
mapping for chat, and building it for chat alone would make an eighth copy.

**Stated honestly: this is not small.** Generalising a helper that seven production governance call
sites would adopt is a §37 producer inventory across seven edge functions, each with its own
justified constants and its own reasons — `paige-mcp` derives `principal` from the actor kind;
`engine.ts` asserts `access: {allowed:true}` on the strength of an upstream membership check. None
of that survives a careless merge into one signature. The primitive is right; the migration to it
is a piece of work in its own right, and it belongs in a phase, not in a cleanup.

---

## 5. The plan

The shape is set by one principle: **prove the two implementations agree before letting either one's
answer change.** That is the same pattern the Capability Kit work just used — one corpus, two
readers, a failure the moment their verdicts diverge — and the house already has structural parity
guards (`solo-parity-guard.mjs` plus a snapshot) to model it on.

### Phase 0 — subtract, and make the inputs exist. No behaviour change.

0. Build `governedInputsFor` (§4a) — the one home for a mapping seven call sites hand-roll
   today, and the primitive Phase 1's parity call needs. This also closes the Capability Kit's
   missing runtime, so items 3 and 4 share one decision rather than two.
1. Delete the 14 dead dispatch branches. Smaller surface, zero risk.
2. Declare the outcome channel per tool (R1). Chat already writes `paige_audit_log` for every
   executed tool; this names what already happens.
3. Build the per-tool access verdict (R2) — the real line item. `resolveOwnerOpsEligible` already
   computes the right answer for the owner-ops group and currently feeds only the prompt; the work
   is extending that to a verdict every governed tool carries, and reconciling it with the
   client-seat seal and the three per-branch role checks.
4. Measure R5 on production: how many seats resolve a null tenant, and does any of them write?

Phase 0 ships on its own and is independently valuable: it is honest inputs and dead-code removal
whether or not the convergence ever happens.

### Phase 1 — parity. Compute both, act on neither change.

Call `decideGovernedExecution` alongside the inline gate at the chokepoint, **act on the inline
gate's answer**, and record where the two disagree. The seam is pure and synchronous, so this costs
a function call and cannot fail independently.

This is the whole point of the plan. Every number in section 4 is a static reading; Phase 1
replaces them with measured production divergence, per tool, before anything moves. A divergence
nobody predicted is exactly what this phase exists to find.

**Exit criterion:** divergence is zero, or every remaining disagreement is explained and
deliberate.

### Phase 2 — reconcile what parity actually found.

Fix the real divergences, decide the deliberate ones (R10), and carry the behaviours the seam does
not model (R6–R9) into the adapter rather than losing them. None of this is guesswork by then.

### Phase 3 — switch, per group, behind a flag.

CRM already runs on the seam, so the first switched group has a live reference. Reads before
mutations; `ordinary` before `high`; one group at a time, reversible.

**Phase 3 does not start until the three decisions below are answered.**

---

## 6. The three decisions that are not this lane's to make

1. **The model-asserted channel (R3).** Do we accept that 33 `ordinary` mutations become
   un-executable on five chat surfaces until those surfaces render approval cards — or does the
   seam gain a scoped tolerance it currently refuses on principle? This is the user-visible one.
2. **`proof_owed` (R4).** The capability-status resolver states the intent as *"Paige may attempt
   it but must not promise the result"* (`resolver.ts:59`–`:62`). The seam fail-closes it to
   `capability_unavailable` through its default arm. Two shipped modules assert opposite things;
   one has to give. (Recorded separately as
   [#1406](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/issues/1406).)
3. **Lane-unrecognized (R10).** Chat coerces an unreadable lane to `confirm`; `crm-command`
   deliberately lets the seam refuse. Both fail closed, differently. Pick one and make it the rule.

## 7. Ownership

`paige-ai-chat/index.ts` and `chat-completion-matrix.md` belong to the chat lane. This plan is the
Platform Reach lane's scoping of a seam, not a claim on that file. Phase 0's access-verdict work in
particular is substantial and sits inside chat's surface — **who lands each phase is a coordination
question, not a technical one**, and it should be settled before Phase 0 opens rather than
discovered at the first merge conflict.

---

## 8. Honest limits of this scoping

- **Everything above is static reading.** Nothing was driven. The tool counts, the chokepoint, the
  divergences and the dead branches were read from source and cross-checked between two independent
  passes; none of it was observed at runtime. Phase 1 exists because that is not good enough to
  switch on.
- **R5's blast radius is genuinely unknown** and cannot be settled from source. It needs a
  production query.
- **Tool counts vary by how you count.** ~155 offered to the model at ceiling, ~149 at floor
  (funding off, no marketplace tenant, non-studio); 123 distinct names in dispatch comparisons; the
  code's own comment at `:7440` says "fifty-one tools the gate governs"; ~47 classified mutations
  sit on the inline path after the CRM door and the tombstones are excluded. The figure that matters
  for this plan is **~47**.
- **No estimate of effort is offered**, because the access-verdict work (R2) is the dominant cost
  and its size depends on a decision nobody has made yet: whether every governed tool gets a real
  verdict, or whether the seam accepts a coarser one.
