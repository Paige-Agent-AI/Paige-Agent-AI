# Sales commercial package Chat read

Pre-edit Flow-by-Flow routing packet, 2026-10-06. Depends on package readback PR #1795; do not merge before that canonical RPC is on main.

1. Outcome: PAIGE reads an existing canonical invoice's package graph and explains actual missing facts. This does not assemble a new package or complete COMMERCIAL-ASSEMBLY-01.
2. Owner: Sales; Clients owns customer identity, Agreements owns signing state, Collections owns terms. Current Turn Route and C4 remain shared owners.
3. Harness/Gateway: reuse the existing Sales Chat domain dispatcher and caller-JWT RPC. No orchestration, context assembler or continuation runtime.
4. Spine: bind `sales_invoice.commercial_package_read` to `read_sales_commercial_package` through the existing domain tool array. No edit to paige-ai-chat or model routing.
5. Provider: no provider traffic or credential requirement; Stripe/PayPal registry availability unchanged.
6. Authority: read_only, no mutation verb/approval; tenant and owner/admin authorization remain in the canonical RPC. Missing facts and source versions cannot grant authority to any constituent act.
7. Durable work: none; no WAIT_WORK or C4 resume implementation. Normal read refusal/retry only.
8. Evidence: existing atomic read Rail receipt; closed projection refuses private/raw extensions and source mismatch. No publication, send, charge or settlement claimed.
9. Surface: existing PAIGE read-result experience, no new screen, container, control or interaction state; Sales surface remains PARTIAL/PROOF OWED. Binding means dispatch exists, not authenticated acceptance.
10. Acceptance: test actual existing Sales dispatcher with a caller RPC, including bad scope, extended arguments, source errors, missing facts and zero invocation of money/approval paths. Authenticated natural-language runtime and UI parity remain UNVERIFIED.

Flow: canonical invoice resolved → read tool → current caller scope → canonical graph/read receipt → safe missing/conflict projection → shared PAIGE response. Unknown invoice/workspace or failed RPC → bounded refusal; no recreation or side effect. Ask/resume remains C4-owned. Existing package-review prototype/design approval remains the separate integrated visual direction; this read binding adds no package-review UI.

Impeccable review applies to truthful answer contract: distinguish signing from commercial terms, show exact amount/currency, report missing facts, and never narrate approval/execution from a read. No new rendered geometry, motion, focus or scroll behavior. Flow Prototype is not used for this logic-only adapter; its SKILL.md explicitly excludes logic-only experiments. Human-facing package workflow still owes integrated review and authenticated acceptance.

Release: internal-only development candidate; no customer version or announcement. No migration in this slice. Production Edge identity and authenticated runtime proof remain owed. Forward fix only if a reproduced defect appears; no financial state is mutated.
