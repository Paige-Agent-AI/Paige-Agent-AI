/**
 * INT-178 — PAIGE can see a workspace's agreements, and cannot see their signing evidence.
 *
 * Two things are under test and they are different in kind:
 *
 *   1. REACH — the capabilities are registered, valid, read-classified, and bound to Chat. Before
 *      this slice `PAIGE_SPINE_CAPABILITIES` held ZERO agreement entries while `registry.ts`
 *      carried a comment saying three of them registered there. A test that only asserted "the
 *      registry validates" would have passed against that, which is why the assertions below are
 *      about the entries EXISTING, not merely about the array being well-formed.
 *
 *   2. CONTAINMENT — signer evidence never crosses into a tool result. That is asserted
 *      structurally (the projection is an allowlist) AND adversarially (a row carrying every
 *      forbidden field is fed in, and the output is searched for each one). The adversarial half
 *      matters because the RPC is due a widening — `docs/delivery/int162-attachment-map.md`
 *      documents it as accepted and owned by the backend lane — and a delete-list projection would
 *      pass today and leak the moment that landed.
 */
import { describe, expect, it } from "vitest";
import { PAIGE_SPINE_CAPABILITIES, validateSpineRegistry, getSpineCapability } from "@/../supabase/functions/_shared/paige-spine/registry.ts";
import { AGREEMENT_DRAFT_CAPABILITY, AGREEMENT_SEND_CAPABILITY, AGREEMENT_TOOLS } from "@/../supabase/functions/_shared/paige-spine/domains/agreement.ts";
import { readAgreements, AGREEMENT_STATUSES } from "@/../supabase/functions/_shared/agreements/chat-read.ts";

/** A caller-JWT rpc port double. Records every call so the arguments can be asserted. */
const port = (result: { data: unknown; error: { message?: string; code?: string } | null }) => {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  return {
    calls,
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push([name, args]);
      return result;
    },
  };
};

/**
 * One overview row, carrying BOTH what the RPC returns today AND every field that must never be
 * projected — including the signer-evidence columns that live on `paige_agreement_signers` and the
 * columns the accepted widening will add. A real row has no `signing_ip`; this one does, so the
 * containment test measures the projection rather than the RPC's current shape.
 */
const ROW = {
  id: "a1000000-0000-4000-8000-000000000001",
  title: "Coaching engagement — Q4",
  status: "partially_signed",
  contact_id: "c1000000-0000-4000-8000-000000000002",
  contact_name: "Dana Whitfield",
  signers_total: 2,
  signers_signed: 1,
  outstanding_names: ["Jordan Reyes"],
  sent_at: "2026-09-01T10:00:00.000Z",
  completed_at: null,
  expires_at: "2026-10-01T10:00:00.000Z",
  document_sha256: "a".repeat(64),
  sealed_sha256: "b".repeat(64),
  updated_at: "2026-09-10T08:30:00.000Z",
  // ── None of the following may ever appear in a tool result. ──
  signing_ip: "203.0.113.42",
  signing_user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  signature_image_png: "iVBORw0KGgoAAAANSUhEUg-FORBIDDEN-RASTER",
  token_hash: "c".repeat(64),
  esign_consent_sha256: "d".repeat(64),
  sealed_storage_key: "t1000000/a1000000/sealed.pdf",
  document_path: "t1000000/a1000000/presented.pdf",
};

const TENANT = "f1000000-0000-4000-8000-000000001111";

describe("INT-178 · agreements are reachable from the Spine", () => {
  it("registers both reads, and the whole registry still validates", () => {
    expect(validateSpineRegistry(PAIGE_SPINE_CAPABILITIES)).toEqual([]);
    // The regression this guards: a comment claiming registration while the array holds nothing.
    const keys = PAIGE_SPINE_CAPABILITIES.map((c) => c.key);
    expect(keys).toContain("agreement.list");
    expect(keys).toContain("agreement.status");
  });

  it("classifies both as reads over the one governed executor — never as acts", () => {
    for (const key of ["agreement.list", "agreement.status"]) {
      const capability = getSpineCapability(key);
      expect(capability, `${key} must be registered`).toBeDefined();
      expect(capability).toMatchObject({
        domain: "agreement",
        chatBinding: "LIVE",
        action: {
          classification: "read",
          riskPolicyKey: "read_only",
          // A read that claimed approval authority would be a mutation wearing a read's clothes.
          approvalAuthority: "none",
          executor: "public.paige_agreement_overview",
        },
      });
    }
  });

  /**
   * THIS ASSERTION CHANGED ON 2026-09-24, DELIBERATELY AND WITH ITS INTENT KEPT (§58).
   *
   * It used to read "exactly two chat tools, both named for reading and neither for sending" and
   * it fired the moment `agreement_draft` landed — correctly, because it was guarding a real
   * boundary. What it was actually protecting is NOT "every tool is a read". It is "nothing here
   * reaches the client", and that is unchanged and still asserted below for every tool including
   * the write. A draft is invisible outside the workspace and mints no signing link.
   *
   * The list stays EXACT rather than becoming a `toContain`, because the whole value of this test
   * is that a fourth tool — a send, a resend, a void — cannot appear here without a human reading
   * this comment first.
   */
  it("exposes four chat tools, and exactly ONE of them reaches outside the workspace", () => {
    const names = AGREEMENT_TOOLS.map((t) => t.function.name);
    expect(names).toEqual(["agreement_list", "agreement_status", "agreement_draft", "agreement_send"]);
    // The registered chatTool and the model-facing schema must be the same string, or the model
    // calls a name the dispatcher does not answer to and the capability is registered-but-dead.
    // All four Spine-registered chatTools must agree with their schemas. `agreement_send` IS
    // registered — and registered STRONGER than the original design, which left it undeclared
    // because its orchestrator is an edge function and the validator demands a public symbol.
    // This PR ships that symbol: the durable server-side act of the send is
    // public.issue_agreement_signing_link (redefined here with the provenance test), and the
    // capability declares the send as an external_effect under high risk, which is the class the
    // declaration guard requires for a mutating tool that emails real people.
    expect(names).toEqual(
      ["agreement.list", "agreement.status", "agreement.draft", "agreement.send"].map(
        (k) => getSpineCapability(k)?.action?.chatTool,
      ),
    );
    const sendCapability = getSpineCapability("agreement.send");
    expect(sendCapability?.action?.classification).toBe("external_effect");
    expect(sendCapability?.action?.executor).toBe("public.issue_agreement_signing_link");
    expect(sendCapability?.action?.riskPolicyKey).toBe("high");

    const reads = AGREEMENT_TOOLS.filter(
      (t) => t.function.name === "agreement_list" || t.function.name === "agreement_status",
    );
    expect(reads).toHaveLength(2);
    for (const tool of reads) {
      expect(tool.function.description).toMatch(/READ-ONLY/);
      expect(tool.function.description).toMatch(/never sends/i);
    }

    // THE WRITE CARRIES ITS OWN BOUNDARY, in the words a model actually reads. It must say it
    // writes — a write that reads as a read is how a model reports work it never did — and it must
    // say plainly that it does not send.
    const draft = AGREEMENT_TOOLS.find((t) => t.function.name === "agreement_draft")!;
    expect(draft.function.description).toMatch(/It WRITES/);
    expect(draft.function.description).toMatch(/does NOT send/);
    expect(draft.function.description).not.toMatch(/READ-ONLY/);

    // EXACTLY ONE MUTATION among the agreement capabilities, and it is this one. A send or a void
    // arriving later trips this line rather than slipping in beside the draft.
    const mutations = ["agreement.list", "agreement.status", "agreement.draft"]
      .map((k) => getSpineCapability(k))
      .filter((c) => c?.action?.classification === "mutate");
    expect(mutations.map((c) => c?.key)).toEqual(["agreement.draft"]);
    expect(mutations[0]?.action?.approvalAuthority).toBe("chat-canonical");

    // THE OUTWARD-FACING ONE, AND IT IS ONE. This is the assertion that must keep firing: a second
    // tool that reaches a real person — a resend, a reminder — trips this rather than joining it.
    const send = AGREEMENT_TOOLS.find((t) => t.function.name === "agreement_send")!;
    expect(send.function.description).toMatch(/THIS REACHES A REAL PERSON/);
    expect(send.function.description).toMatch(/cannot be recalled/);
    // It must tell the model a typed yes will not do, because for a `high` action that is true:
    // the server refuses the model-asserted channel outright and only an echoed fingerprint runs.
    expect(send.function.description).toMatch(/typed yes is not enough/);
    const outward = AGREEMENT_TOOLS.filter((t) => /REACHES A REAL PERSON/i.test(t.function.description));
    expect(outward.map((t) => t.function.name)).toEqual(["agreement_send"]);
  });

  /**
   * The send's governed declaration, executed at import for the same reason the draft's is. This
   * one additionally pins the effect: `external_effect` is what forces `high` inside the kit, so a
   * later edit that softened the effect would also soften the class, and the two must move together.
   */
  it("declares the send as an external effect, which is what forces its high class", () => {
    expect(AGREEMENT_SEND_CAPABILITY.identity.id).toBe("agreement.send");
    expect(AGREEMENT_SEND_CAPABILITY.effect).toBe("external_effect");
    expect(AGREEMENT_SEND_CAPABILITY.governance.risk).toBe("high");
    expect(AGREEMENT_SEND_CAPABILITY.governance.actionRiskKey).toBe("agreement_send");
  });

  /**
   * THE DECLARATION IS ONLY A GUARD IF IT RUNS. `capability-kit-lint` reads `governance.actionRiskKey`
   * and never `governance.risk`, so a declaration whose class contradicts the canonical policy passes
   * CI and throws at the first cold start — measured: with `risk` flipped to "high", the lint exits 0
   * while importing the module throws "Capability risk must match the canonical action-risk policy."
   *
   * The thing that closes that gap is this file IMPORTING the module at all, which executes the
   * declaration under vitest. Asserting on the constructed object keeps that import load-bearing, so
   * nobody later "tidies" it into a type-only import and silently reopens the hole.
   */
  it("constructs its governed declaration at import, which is what catches a risk that contradicts the policy", () => {
    expect(AGREEMENT_DRAFT_CAPABILITY.identity.id).toBe("agreement.draft");
    expect(AGREEMENT_DRAFT_CAPABILITY.governance.actionRiskKey).toBe("agreement_draft");
    expect(AGREEMENT_DRAFT_CAPABILITY.governance.risk).toBe("ordinary");
    // The kit derives approval from the canonical class rather than taking the declaration's word.
    expect(AGREEMENT_DRAFT_CAPABILITY.governance.approval).toBe("confirm");
  });
});

describe("INT-178 · the read projects only what PAIGE may see", () => {
  it("returns the agreement's state, parties and dates from the one RPC", async () => {
    const rpc = port({ data: [ROW], error: null });
    const result = await readAgreements({ caller: rpc, expectedTenantId: TENANT });

    expect(rpc.calls).toEqual([
      ["paige_agreement_overview", { _expected_tenant_id: TENANT, _contact_id: null, _status: null }],
    ]);
    expect(result).toMatchObject({ success: true, count: 1 });
    expect(result.success && result.agreements[0]).toEqual({
      id: ROW.id,
      title: "Coaching engagement — Q4",
      status: "partially_signed",
      contactId: ROW.contact_id,
      contactName: "Dana Whitfield",
      signersTotal: 2,
      signersSigned: 1,
      outstandingNames: ["Jordan Reyes"],
      sentAt: ROW.sent_at,
      completedAt: null,
      expiresAt: ROW.expires_at,
      updatedAt: ROW.updated_at,
      sealed: true,
    });
  });

  it("NEVER lets signer evidence, hashes, tokens or storage keys reach the result", async () => {
    const rpc = port({ data: [ROW], error: null });
    const result = await readAgreements({ caller: rpc, expectedTenantId: TENANT });
    const wire = JSON.stringify(result);

    for (const forbidden of [
      ROW.signing_ip,
      ROW.signing_user_agent,
      ROW.signature_image_png,
      ROW.token_hash,
      ROW.esign_consent_sha256,
      ROW.sealed_storage_key,
      ROW.document_path,
      // The document hashes are real columns of the RPC and are still withheld: integrity
      // material, meaningless to a model, and `sealed` answers the only question asked of them.
      ROW.document_sha256,
      ROW.sealed_sha256,
    ]) {
      expect(wire, `leaked: ${forbidden.slice(0, 24)}`).not.toContain(forbidden);
    }
    for (const key of ["signing_ip", "signing_user_agent", "signature_image_png", "token_hash", "sealed_storage_key", "document_path"]) {
      expect(wire).not.toContain(key);
    }
    // Sealedness survives as a boolean, so withholding the hash costs the surface nothing.
    expect(result.success && result.agreements[0].sealed).toBe(true);
  });

  it("drops an unknown column instead of forwarding it, so a later RPC widening cannot leak", async () => {
    const rpc = port({ data: [{ ...ROW, some_future_signer_secret: "NOT-ALLOWED-THROUGH" }], error: null });
    const result = await readAgreements({ caller: rpc, expectedTenantId: TENANT });
    expect(JSON.stringify(result)).not.toContain("NOT-ALLOWED-THROUGH");
    expect(JSON.stringify(result)).not.toContain("some_future_signer_secret");
  });
});

describe("INT-178 · the read fails honestly", () => {
  it("passes the contact and status filters through without widening them", async () => {
    const rpc = port({ data: [], error: null });
    const contact = "c1000000-0000-4000-8000-000000000002";
    await readAgreements({ caller: rpc, expectedTenantId: TENANT, contactId: `  ${contact}  `, status: "sent" });
    expect(rpc.calls[0][1]).toEqual({ _expected_tenant_id: TENANT, _contact_id: contact, _status: "sent" });
  });

  it("refuses an unknown status rather than returning an empty list that reads as 'none'", async () => {
    const rpc = port({ data: [], error: null });
    const result = await readAgreements({ caller: rpc, expectedTenantId: TENANT, status: "signed" });
    expect(result).toMatchObject({ success: false, reason: "unknown_status" });
    expect(result.success === false && result.error).toContain("partially_signed");
    // The false negative this prevents: never reaching the RPC at all.
    expect(rpc.calls).toEqual([]);
  });

  it("maps a 42501 refusal to a caller-safe reason and echoes no database text", async () => {
    const rpc = port({
      data: null,
      error: { code: "42501", message: 'you are not a member of this workspace: tenant f1000000 relation "paige_agreements"' },
    });
    const result = await readAgreements({ caller: rpc, expectedTenantId: TENANT });
    expect(result).toMatchObject({ success: false, reason: "refused" });
    const wire = JSON.stringify(result);
    expect(wire).not.toContain("paige_agreements");
    expect(wire).not.toContain("42501");
    expect(wire).not.toContain("f1000000");
  });

  it("maps any other database error to unavailable, and a throw to the same", async () => {
    const broken = port({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    expect(await readAgreements({ caller: broken, expectedTenantId: TENANT })).toMatchObject({
      success: false,
      reason: "unavailable",
    });
    const thrower = { rpc: async () => { throw new Error("fetch failed: ECONNREFUSED 10.0.0.5:5432"); } };
    const thrown = await readAgreements({ caller: thrower, expectedTenantId: TENANT });
    expect(thrown).toMatchObject({ success: false, reason: "unavailable" });
    expect(JSON.stringify(thrown)).not.toContain("10.0.0.5");
  });

  it("refuses with no workspace rather than reading across one", async () => {
    const rpc = port({ data: [ROW], error: null });
    expect(await readAgreements({ caller: rpc, expectedTenantId: null })).toMatchObject({
      success: false,
      reason: "no_workspace",
    });
    expect(rpc.calls).toEqual([]);
  });

  it("reports an empty workspace as empty, not as a failure", async () => {
    const result = await readAgreements({ caller: port({ data: [], error: null }), expectedTenantId: TENANT });
    expect(result).toEqual({ success: true, agreements: [], count: 0 });
  });

  it("says so when the answer is a page rather than the whole book", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...ROW, id: `a${i}` }));
    const result = await readAgreements({ caller: port({ data: many, error: null }), expectedTenantId: TENANT });
    expect(result.success && result.note).toMatch(/200 most recently updated/);
  });

  it("names an unrecognised status instead of coercing it into a known one", async () => {
    const result = await readAgreements({
      caller: port({ data: [{ ...ROW, status: "countersigned" }], error: null }),
      expectedTenantId: TENANT,
    });
    expect(result.success && result.agreements[0].status).toBe("countersigned");
    expect(AGREEMENT_STATUSES).not.toContain("countersigned");
  });
});

/**
 * The defects an independent adversarial read of the pushed diff found, each kept as a test so the
 * repair cannot be silently undone. Three of the four were confident-wrong-answer bugs rather than
 * crashes, which is the class that survives a green build.
 */
describe("INT-178 · the defects the peer-gate caught", () => {
  it("refuses a malformed contact id instead of handing it to Postgres to fail on", async () => {
    const rpc = port({ data: [], error: null });
    const result = await readAgreements({
      caller: rpc,
      expectedTenantId: TENANT,
      contactId: "the-client-called-dana",
      requireContact: true,
    });
    expect(result).toMatchObject({ success: false, reason: "bad_contact_id" });
    // The wrong answer this prevents: a 22P02 cast failure reported to the owner as "the agreements
    // engine may need attention", and a platform failure written to the Rail that never happened.
    expect(rpc.calls).toEqual([]);
  });

  it("NEVER lets a one-client read silently widen to the whole workspace book", async () => {
    const rpc = port({ data: [ROW], error: null });
    // `agreement_status` promises ONE client's agreements. A missing id must refuse, never coerce
    // to NULL — which would make the RPC's `(_contact_id IS NULL OR …)` filter a no-op.
    const missing = await readAgreements({ caller: rpc, expectedTenantId: TENANT, requireContact: true });
    expect(missing).toMatchObject({ success: false, reason: "bad_contact_id" });
    expect(rpc.calls).toEqual([]);
    // A non-string the model invented coerces to null in `text()`, and must refuse identically.
    const wrongType = await readAgreements({
      caller: rpc,
      expectedTenantId: TENANT,
      contactId: 42 as unknown as string,
      requireContact: true,
    });
    expect(wrongType).toMatchObject({ success: false, reason: "bad_contact_id" });
    expect(rpc.calls).toEqual([]);
  });

  it("still allows the unfiltered list, which is what agreement_list is for", async () => {
    const rpc = port({ data: [ROW], error: null });
    const result = await readAgreements({ caller: rpc, expectedTenantId: TENANT });
    expect(result).toMatchObject({ success: true, count: 1 });
    expect(rpc.calls[0][1]).toMatchObject({ _contact_id: null });
  });

  it("tells an agency its book CANNOT hold agreements, rather than that it has none", async () => {
    const result = await readAgreements({
      caller: port({ data: [], error: null }),
      expectedTenantId: TENANT,
      diagnostics: { isAgencyWithoutClientBook: async () => true },
    });
    expect(result).toMatchObject({ success: true, count: 0, emptyReason: "agency_has_no_client_book" });
    expect(result.success && result.note).toMatch(/manages sub-accounts/);
    // The confident falsehood this prevents.
    expect(result.success && result.note).toMatch(/Do NOT report this as 'no agreements'/);
  });

  it("degrades to the plain empty answer when a diagnostic cannot answer — never a guess", async () => {
    const thrown = await readAgreements({
      caller: port({ data: [], error: null }),
      expectedTenantId: TENANT,
      diagnostics: { isAgencyWithoutClientBook: async () => { throw new Error("tenants read failed"); } },
    });
    expect(thrown).toEqual({ success: true, agreements: [], count: 0 });
    const solo = await readAgreements({
      caller: port({ data: [], error: null }),
      expectedTenantId: TENANT,
      diagnostics: { isAgencyWithoutClientBook: async () => null },
    });
    expect(solo).toEqual({ success: true, agreements: [], count: 0 });
  });

  it("states the 200 cap without claiming to know whether more exist", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...ROW, id: `a${i}` }));
    const result = await readAgreements({ caller: port({ data: many, error: null }), expectedTenantId: TENANT });
    // At exactly 200 the RPC cannot distinguish a capped page from a book of exactly 200, so the
    // note must assert neither. "not the complete list" would have been a guess at the boundary.
    expect(result.success && result.note).toMatch(/Only the 200 most recently updated/);
    expect(result.success && result.note).not.toMatch(/not the complete list/);
  });
});

/**
 * The Codex review's four findings on the pushed diff, each kept as a test. Three of the four are
 * the same failure mode in different clothes: an answer that is technically derived from a real
 * query and is nonetheless false, because nobody established what the empty result MEANT.
 */
describe("INT-178 · the four findings from the exact-head review", () => {
  it("P1 — a delegated-access caller is told the real boundary, not that they are not a member", async () => {
    const refusal = port({ data: null, error: { code: "42501", message: "you are not a member of this workspace" } });
    const result = await readAgreements({
      caller: refusal,
      expectedTenantId: TENANT,
      // An agency owner switched into a managed sub-account: `current_user_tenant_id()` accepts
      // them via `agency_can_manage_child`, `is_tenant_member` does not.
      diagnostics: { isDirectMember: async () => false },
    });
    expect(result).toMatchObject({ success: false, reason: "refused" });
    expect(result.success === false && result.error).toMatch(/own membership in this workspace/);
    expect(result.success === false && result.error).toMatch(/parent agency, or as a platform operator/);
    // The wrong answer this replaces — it sent the caller to fix an access problem they do not have.
    expect(result.success === false && result.error).not.toMatch(/may have changed/);
  });

  it("P1 — a direct member who hit the same 42501 still gets the workspace-changed reading", async () => {
    const refusal = port({ data: null, error: { code: "42501", message: "your active workspace changed" } });
    const result = await readAgreements({
      caller: refusal,
      expectedTenantId: TENANT,
      diagnostics: { isDirectMember: async () => true },
    });
    expect(result.success === false && result.error).toMatch(/may have changed/);
    // And an unanswerable diagnostic must not upgrade to the more specific claim.
    const unknown = await readAgreements({
      caller: port({ data: null, error: { code: "42501", message: "refused" } }),
      expectedTenantId: TENANT,
      diagnostics: { isDirectMember: async () => null },
    });
    expect(unknown.success === false && unknown.error).toMatch(/may have changed/);
  });

  it("P2 — a contact that does not exist is never reported as a client with no agreements", async () => {
    const contact = "c1000000-0000-4000-8000-00000000dead";
    const result = await readAgreements({
      caller: port({ data: [], error: null }),
      expectedTenantId: TENANT,
      contactId: contact,
      requireContact: true,
      diagnostics: { contactExists: async () => false },
    });
    expect(result).toMatchObject({ success: true, count: 0, emptyReason: "contact_not_found" });
    expect(result.success && result.note).toMatch(/could not be found at all/);
  });

  it("P2 — a contact that DOES exist with no agreements stays a plain empty answer", async () => {
    const contact = "c1000000-0000-4000-8000-000000000002";
    const result = await readAgreements({
      caller: port({ data: [], error: null }),
      expectedTenantId: TENANT,
      contactId: contact,
      requireContact: true,
      diagnostics: { contactExists: async () => true, isAgencyWithoutClientBook: async () => false },
    });
    expect(result).toEqual({ success: true, agreements: [], count: 0 });
  });

  it("the contact check outranks the agency check, because it is the more specific claim", async () => {
    const result = await readAgreements({
      caller: port({ data: [], error: null }),
      expectedTenantId: TENANT,
      contactId: "c1000000-0000-4000-8000-00000000dead",
      requireContact: true,
      diagnostics: { contactExists: async () => false, isAgencyWithoutClientBook: async () => true },
    });
    // On an agency a bad contact id is still a bad contact id; saying "agency" first would hide it.
    expect(result).toMatchObject({ emptyReason: "contact_not_found" });
  });

  it("every explained-empty result carries a machine-readable reason the chip can branch on", async () => {
    // The P2 action-chip finding: the renderer must not flatten these to "none matched", and it
    // can only avoid that if the reason travels as data rather than only inside the prose note.
    const agency = await readAgreements({
      caller: port({ data: [], error: null }),
      expectedTenantId: TENANT,
      diagnostics: { isAgencyWithoutClientBook: async () => true },
    });
    const missing = await readAgreements({
      caller: port({ data: [], error: null }),
      expectedTenantId: TENANT,
      contactId: "c1000000-0000-4000-8000-00000000dead",
      requireContact: true,
      diagnostics: { contactExists: async () => false },
    });
    expect(agency.success && agency.emptyReason).toBe("agency_has_no_client_book");
    expect(missing.success && missing.emptyReason).toBe("contact_not_found");
  });
});

/** Round two of the exact-head review. Three real findings; the fourth is declined on the thread. */
describe("INT-178 · the second review round", () => {
  it("refuses a non-string status instead of silently dropping the filter", async () => {
    // `text()` answers null for a number or an object, so without this guard `status: 42` became
    // "no filter" and handed back the ENTIRE workspace book to a caller who asked for one slice.
    for (const bad of [42, {}, [], true]) {
      const rpc = port({ data: [ROW], error: null });
      const result = await readAgreements({
        caller: rpc,
        expectedTenantId: TENANT,
        status: bad as unknown as string,
      });
      expect(result, `status=${JSON.stringify(bad)}`).toMatchObject({ success: false, reason: "unknown_status" });
      expect(rpc.calls).toEqual([]);
    }
  });

  it("does not call anyone outstanding on a declined, voided or expired agreement", async () => {
    // The RPC computes outstanding_names as "every signer not signed", which is right for a live
    // agreement and wrong for a dead one: a declined signer stays `declined` forever, and nothing
    // further can arrive. Reporting them would have PAIGE tell the owner to chase someone.
    for (const status of ["declined", "voided", "expired"]) {
      const result = await readAgreements({
        caller: port({ data: [{ ...ROW, status, outstanding_names: ["Jordan Reyes", "Dana Whitfield"] }], error: null }),
        expectedTenantId: TENANT,
      });
      expect(result.success && result.agreements[0].outstandingNames, status).toEqual([]);
      // The state itself still travels — this suppresses a wrong inference, not the fact.
      expect(result.success && result.agreements[0].status).toBe(status);
    }
  });

  it("still reports outstanding signers on a live agreement", async () => {
    for (const status of ["sent", "viewed", "partially_signed", "draft"]) {
      const result = await readAgreements({
        caller: port({ data: [{ ...ROW, status }], error: null }),
        expectedTenantId: TENANT,
      });
      expect(result.success && result.agreements[0].outstandingNames, status).toEqual(["Jordan Reyes"]);
    }
  });

  it("never tells a FILTERED empty read that the agency holds no agreements", async () => {
    // A tenant converted to a top-level agency KEEPS its drafted agreements (20270405000000:71-74).
    // On a filtered read, zero rows means "none matched" — claiming the account holds none of its
    // own would be false for an agency that is holding some outside the filter.
    const agencyYes = { isAgencyWithoutClientBook: async () => true, contactExists: async () => true };
    const byStatus = await readAgreements({
      caller: port({ data: [], error: null }),
      expectedTenantId: TENANT,
      status: "completed",
      diagnostics: agencyYes,
    });
    expect(byStatus).toEqual({ success: true, agreements: [], count: 0 });

    const byContact = await readAgreements({
      caller: port({ data: [], error: null }),
      expectedTenantId: TENANT,
      contactId: "c1000000-0000-4000-8000-000000000002",
      requireContact: true,
      diagnostics: agencyYes,
    });
    expect(byContact).toEqual({ success: true, agreements: [], count: 0 });

    // Unfiltered, the structural explanation is true of the whole book and is still given.
    const whole = await readAgreements({
      caller: port({ data: [], error: null }),
      expectedTenantId: TENANT,
      diagnostics: agencyYes,
    });
    expect(whole).toMatchObject({ emptyReason: "agency_has_no_client_book" });
  });
});
