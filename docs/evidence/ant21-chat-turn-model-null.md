# Truthful missing model metadata

Isolated successor to9034e910956a2745d1d8e736b2d8a0445fa7a993 in
work/chat-turn-model-metadata, branch fix/ant21-chat-turn-model-null. The complete runtime delta is
one expression: persistAssistantTurn passes meta.model ?? null to the existing p_model parameter.
There is no backfill or edit to prior rows, new metadata field, trace store or model attribution.
An explicit server-provided meta.model remains exact.

Owner intent is truthful future assistant-turn metadata without inferring a model from the
classifier, fold, requested class, last opened stream or a discarded pass. The same Conversations
storage, canonical settlement, actor/JWT/thread authority and existing trace rows remain in place.
No approval/budget/provider policy, Spine capability, native writer, record content, terminal state,
UI geometry/interaction, provisioner, tier or connection changes. The existing closed turn_trace
continues to contain only label/group/status; per-pass provider attribution stays in paige_llm_trace.
No real key/provider/customer record is read or changed. Existing configured Edge credentials are
reused by the source contract; local tests use synthetic recording transports only.

Native compatibility was inspected in existing, unchanged SQL:
20270601000008_int346_server_issued_interactive_receipts.sql accepts p_model text in
paige_chat_interactive_settle, inserts it directly and compares replay with IS DISTINCT FROM,
which handles NULL. The existing paige_chat_turn_append text argument and nullable turn model
storage likewise require no migration or privilege change. No native SQL was executed for this
slice; actual schema/provider/JWT/deployment acceptance remains UNVERIFIED.

## Focused evidence

scripts/chat-turn-model-metadata-check.mjs reuses the existing actual-handler summary fixture and
real Fabric/adapters. Its two added whole-handler cases select an ordinary operational OpenAI
answer and a proven primary-health failure followed by Anthropic; each checks one canonical
settlement, NULL p_model, unchanged exact answer, FINAL/one logical round/zero tools, and no added
turn_trace fields. The existing18 fold controls run unchanged on import. Fixture options and the
exported drive function are test-only; no production provider selection changes.

No whole-handler caller currently supplies explicit meta.model. Two additional controls therefore
execute the exact TypeScript-AST-extracted private persistAssistantTurn closure with recording
append/settlement ports: server-authored zero-model metadata stays NULL; an explicit server model
is preserved. Every appended field, content and canonical state is compared. This is exact-helper
proof, not a claim that a new production explicit-model caller exists or native RLS was exercised.

Failing-first work/metadata-red.log:the existing18 controls pass; the new suite has1PASS/3FAIL.
Both real-handler routes and the no-model private closure expose the literal Gemini default;
the explicit-model preservation control already passes. Corrected work/metadata-green.log:
18 inherited controls plus4 focused controls PASS. Node syntax and whitespace pass. No broad
suite rerun is credited or needed for this one-expression delta. The known9034 recalled-summary
race is OPEN and is being fixed separately; these tests do not close it or authorize9034 release.

Run with existing dependencies, no installation or network:

```text
node --import ./scripts/client-memory-authz/register.mjs scripts/chat-turn-model-metadata-check.mjs
```

Channel=development; base9034 is source only. No PR/push/deployment/provider activation, CI wiring,
source-pin/extractor/metadata-policy renewal or paid request. The integration lead owns distinct
review, resulting-head CI and eventual release. Source review/fingerprint renewal remains owed;
no existing metadata is treated as evidence of a provider route. Multi-pass answer attribution is
explicitly excluded, as directed. This is AUTHOR-REVIEW / LOWER ASSURANCE only.
