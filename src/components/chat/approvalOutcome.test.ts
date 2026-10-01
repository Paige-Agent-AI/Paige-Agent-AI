/**
 * The approval outcome as the chat holds it (approvalOutcome.ts): every rule the recovery card
 * depends on, tested where it lives. The chat wiring is driven on the real surface in
 * PaigeAIChat.approvalRecovery.test.tsx; the server's half is scripts/client-memory-authz 18.OUT*.
 */
import { describe, expect, it } from "vitest";
import {
  applyServerOutcome,
  approvalOutcomeTranscript,
  askAgainRequest,
  checkLinks,
  crmCheckDestination,
  outcomeCardView,
  pendingApprovalOutcome,
  soloCheckPath,
  type ApprovalOutcome,
  type CheckDestination,
} from "./approvalOutcome";
import { canonicalAppUrl } from "../../../supabase/functions/_shared/canonical-app-url";
import { CRM_ACTION_CAPABILITY } from "../../../supabase/functions/_shared/crm-command/catalog";

const FP_A = "aaaaaaaaaaaaaaaa";
const FP_B = "bbbbbbbbbbbbbbbb:3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const proposal = {
  role: "assistant",
  confirm: [
    { tool: "crm_create_contact", summary: "Add John Coleman to your clients", fingerprint: FP_A },
    { tool: "action_advance", summary: "Dismiss the draft", fingerprint: FP_B },
  ],
};

const pending = (): ApprovalOutcome => pendingApprovalOutcome([{ role: "user" }, proposal, { role: "user" }], [FP_A, FP_B]);

describe("the card on the moment Approve is pressed", () => {
  it("names each approved action from the card that asked, in the order they were sent", () => {
    expect(pendingApprovalOutcome([proposal], [FP_B, FP_A])).toEqual({
      reported: false,
      actions: [
        { fingerprint: FP_B, summary: "Dismiss the draft", tool: "action_advance" },
        { fingerprint: FP_A, summary: "Add John Coleman to your clients", tool: "crm_create_contact" },
      ],
    });
  });

  it("reads the most recent card that offered them, and never an older one", () => {
    const older = { role: "assistant", confirm: [{ tool: "old_tool", summary: "An older wording", fingerprint: FP_A }] };
    expect(pendingApprovalOutcome([older, { role: "user" }, proposal], [FP_A]).actions[0].summary)
      .toBe("Add John Coleman to your clients");
  });

  it("says Running… beside every action while the turn runs", () => {
    expect(outcomeCardView(pending(), true)).toEqual({
      actions: [
        { summary: "Add John Coleman to your clients", state: "working" },
        { summary: "Dismiss the draft", state: "working" },
      ],
    });
  });
});

describe("the server's report", () => {
  it("settles each action as the server says, with its sentences", () => {
    const outcome = applyServerOutcome(pending(), {
      actions: [
        { fingerprint: FP_A, outcome: "ran" },
        { fingerprint: FP_B, outcome: "not_run", note: "Nothing changed. Paige didn't run this." },
      ],
    });
    expect(outcome.reported).toBe(true);
    expect(outcomeCardView(outcome, false)).toEqual({
      note: undefined,
      actions: [
        { summary: "Add John Coleman to your clients", state: "done" },
        { summary: "Dismiss the draft", state: "failed", note: "Nothing changed. Paige didn't run this." },
      ],
    });
  });

  it("carries the one sentence for the whole card", () => {
    const outcome = applyServerOutcome(pending(), {
      note: "Nothing changed. More than one approval was waiting, so Paige stopped rather than guess.",
      actions: [{ fingerprint: FP_A, outcome: "not_run" }, { fingerprint: FP_B, outcome: "not_run" }],
    });
    expect(outcomeCardView(outcome, false).note).toBe("Nothing changed. More than one approval was waiting, so Paige stopped rather than guess.");
  });

  it("leaves anything the report does not account for unconfirmed, never done", () => {
    const outcome = applyServerOutcome(pending(), {
      actions: [
        { fingerprint: FP_A, outcome: "ran" },
        { fingerprint: FP_B, outcome: "finished" },
        { fingerprint: 42, outcome: "ran" },
        null,
      ],
    });
    expect(outcomeCardView(outcome, false).actions.map((a) => a.state)).toEqual(["done", "unconfirmed"]);
  });

  it("ignores a report that is not one, rather than guessing", () => {
    for (const frame of [null, "ran", { actions: "ran" }, {}]) {
      expect(applyServerOutcome(pending(), frame)).toEqual(pending());
    }
  });

  it("keeps a sentence to a sentence", () => {
    const outcome = applyServerOutcome(pending(), {
      note: "x".repeat(1000),
      actions: [{ fingerprint: FP_A, outcome: "not_run", note: "   " }, { fingerprint: FP_B, outcome: "not_run", note: 7 }],
    });
    expect(outcome.note).toHaveLength(280);
    expect(outcome.actions.every((a) => a.note === undefined)).toBe(true);
  });
});

describe("when no report comes", () => {
  it("can only say it couldn't confirm, and says why when the connection dropped", () => {
    const view = outcomeCardView({ ...pending(), dropped: true }, false);
    expect(view.actions.every((a) => a.state === "unconfirmed")).toBe(true);
    expect(view.note).toBe("The connection dropped before Paige could report back, so these may have gone through. Check before asking again.");
  });

  it("does not claim a dropped connection it never saw", () => {
    const one = pendingApprovalOutcome([proposal], [FP_A]);
    expect(outcomeCardView(one, false).note).toBe("Paige couldn't report back, so this may have gone through. Check before asking again.");
    expect(outcomeCardView(one, false).note).not.toMatch(/connection/);
  });

  it("never says Running… once the turn has stopped", () => {
    expect(outcomeCardView(pending(), false).actions.some((a) => a.state === "working")).toBe(false);
  });
});

describe("Ask Paige again", () => {
  const settled = (a: string, b: string) => applyServerOutcome(pending(), {
    actions: [{ fingerprint: FP_A, outcome: a }, { fingerprint: FP_B, outcome: b }],
  });

  it("asks only for what did not run", () => {
    expect(askAgainRequest(settled("ran", "not_run"))).toBe("Try again: Dismiss the draft");
    expect(askAgainRequest(settled("not_run", "not_run"))).toBe("Try again: Add John Coleman to your clients; Dismiss the draft");
  });

  it("is not offered when everything ran, before the report, or when anything may have gone through", () => {
    expect(askAgainRequest(settled("ran", "ran"))).toBeNull();
    expect(askAgainRequest(pending())).toBeNull();
    expect(askAgainRequest(settled("not_run", "unconfirmed"))).toBeNull();
  });
});

describe("where to check", () => {
  const unconfirmed = applyServerOutcome(pending(), {
    actions: [{ fingerprint: FP_A, outcome: "unconfirmed" }, { fingerprint: FP_B, outcome: "unconfirmed" }],
  });

  it("points a CRM action at its surface, and nothing else at anything", () => {
    expect(checkLinks(unconfirmed, outcomeCardView(unconfirmed, false), 42)).toEqual([
      { label: "Open your clients", to: "/solo/42/clients/people" },
    ]);
  });

  it("offers no link without an account address, or for an action that ran or did not run", () => {
    expect(checkLinks(unconfirmed, outcomeCardView(unconfirmed, false), null)).toEqual([]);
    expect(checkLinks(unconfirmed, outcomeCardView(unconfirmed, false), "")).toEqual([]);
    const known = applyServerOutcome(pending(), {
      actions: [{ fingerprint: FP_A, outcome: "ran" }, { fingerprint: FP_B, outcome: "unconfirmed" }],
    });
    expect(checkLinks(known, outcomeCardView(known, false), 42)).toEqual([]);
  });

  it("names each surface once", () => {
    const twoContacts = pendingApprovalOutcome([{
      role: "assistant",
      confirm: [
        { tool: "crm_create_contact", summary: "Add one", fingerprint: FP_A },
        { tool: "crm_update_contact", summary: "Change another", fingerprint: FP_B },
      ],
    }], [FP_A, FP_B]);
    expect(checkLinks(twoContacts, outcomeCardView(twoContacts, false), 7)).toHaveLength(1);
  });

  it("is the same address the platform's canonical routes give, for every surface", () => {
    for (const destination of ["contacts", "pipeline", "tasks"] as CheckDestination[]) {
      const canonical = canonicalAppUrl({ actor: "account", tier: "solo", account: 3855, destination });
      expect(canonical).not.toBeNull();
      expect(soloCheckPath(3855, destination)).toBe(new URL(canonical as string).pathname);
    }
  });

  it("sends every CRM action where crm-command sends its own record link", () => {
    // crm-command: deal.* to the pipeline, task.* to tasks, everything else to contacts.
    for (const [action, tool] of Object.entries(CRM_ACTION_CAPABILITY)) {
      const expected = action.startsWith("deal.") ? "pipeline" : action.startsWith("task.") ? "tasks" : "contacts";
      expect({ tool, destination: crmCheckDestination(tool) }).toEqual({ tool, destination: expected });
    }
    expect(crmCheckDestination("action_advance")).toBeUndefined();
    expect(crmCheckDestination("update_client_data")).toBeUndefined();
  });
});

describe("an approval turn with no words of Paige's own", () => {
  it("carries what the card showed into the next request, never an empty message", () => {
    expect(approvalOutcomeTranscript({ ...pending(), dropped: true })).toBe([
      "Couldn't confirm: Add John Coleman to your clients",
      "Couldn't confirm: Dismiss the draft",
      "The connection dropped before Paige could report back, so these may have gone through. Check before asking again.",
    ].join("\n"));
    const settled = applyServerOutcome(pending(), {
      actions: [{ fingerprint: FP_A, outcome: "ran" }, { fingerprint: FP_B, outcome: "not_run", note: "It didn't go through." }],
    });
    expect(approvalOutcomeTranscript(settled)).toBe("Done: Add John Coleman to your clients\nDidn't run: Dismiss the draft (It didn't go through.)");
  });
});

describe("the chat's own sentences follow the server's rules", () => {
  const notes = [true, false].flatMap((dropped) => [[FP_A], [FP_A, FP_B]].map((fps) =>
    outcomeCardView({ ...pendingApprovalOutcome([proposal], fps), dropped }, false).note as string));

  it("are plain, whole sentences that name no control and claim nothing changed", () => {
    for (const note of notes) {
      expect(note).toMatch(/^[A-Z].*\.$/);
      expect(note).not.toMatch(/fingerprint|tool|rpc|confirmation|token|null|undefined|\bid\b/i);
      expect(note).not.toMatch(/\b(press|click|tap|button)\b|approve (it|them|one)/i);
      expect(note).not.toMatch(/nothing changed/i);
    }
  });
});
