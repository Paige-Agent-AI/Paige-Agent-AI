/**
 * S6 — the workspace does not advertise what it cannot do.
 *
 * §70.1: "UI that DESCRIBES a capability without allowing its supported human flow" is not
 * delivered. Three claims on this surface failed that test, and each was a statement of fact that
 * happened to be false — not a design opinion:
 *
 *   · the composer offered "@ hand it to someone · / call a skill · # remember". Solo passes no
 *     chips, so the slash menu can never open, and there is no `@` or `#` handling anywhere in the
 *     file. All three did nothing, silently.
 *   · the command field printed ⌘K. The shell binds ⌘/Ctrl+backslash; the global ⌘K owner is
 *     registered only when `launcherEnabled`, which Solo sets false.
 *   · the Capabilities panel said voice input was "Partial / Not activated" while the
 *     hold-to-dictate mic sits live in the composer one tab away.
 *
 * These are source assertions rather than rendered ones on purpose: the claim is that the STRINGS
 * are gone, and a rendered test would pass just as well if the element were merely hidden.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("PAIGE chat — no claim without a capability behind it", () => {
  it("does not advertise composer shortcuts that do nothing here", () => {
    const chat = src("src/components/dashboard/PaigeAIChat.tsx");
    // The strip itself.
    expect(chat).not.toContain("@ hand it to someone");
    expect(chat).not.toContain("/ call a skill");
    expect(chat).not.toContain("# remember");
    // And the reason it could never have worked, still true: Solo supplies no chips, so the slash
    // menu's open condition is unsatisfiable. If a future change gives Solo chips, this assertion
    // is what says the advertisement may come back.
    expect(chat).toContain("filteredCommands.length");
  });

  it("names the keyboard shortcut that is actually bound", () => {
    const shell = src("src/components/tenant-shell/TenantCommandCenterShell.tsx");
    // The real binding.
    expect(shell).toContain('event.key !== "\\\\"');
    // The hint must name it, and must not name the one that opens nothing here.
    expect(shell).not.toContain("<kbd>⌘K</kbd>");
    expect(shell).not.toContain("or press ⌘K");
  });

  it("does not tell the owner voice input is off while the mic is live", () => {
    const workspace = src("src/solo/SoloPaigeWorkspace.tsx");
    const chat = src("src/components/dashboard/PaigeAIChat.tsx");
    // The mic really is in the composer — this is the fact the panel contradicted.
    expect(chat).toContain("<DictationMicButton");
    // So the panel must not claim otherwise.
    const voiceRow = workspace.slice(workspace.indexOf("<strong>Voice input</strong>"));
    const rowEnd = voiceRow.indexOf("</div>", voiceRow.indexOf("spw-cap-row") + 1);
    const row = voiceRow.slice(0, rowEnd > 0 ? rowEnd : 400);
    expect(row).not.toContain("Not activated");
    expect(row).not.toContain("Partial");
  });

  it("offers a way back from a transient server failure, and not from a refusal", () => {
    const chat = src("src/components/dashboard/PaigeAIChat.tsx");
    // 5xx is retryable and gets the affordance.
    expect(chat).toContain('if (response.status >= 500) setConnectionIssue("server");');
    // A 4xx must NOT — the same request will be refused identically, and a Retry that cannot
    // succeed is the §70 failure this whole file is about.
    expect(chat).not.toContain('setConnectionIssue("server");\n        return;\n      }\n      if (response.status');
    expect(chat).toContain('connectionIssue === "server"');
  });

  it("sends a real token when writing a session summary", () => {
    const memory = src("src/hooks/usePaigeMemory.ts");
    // It read `access_token` off a locally-built `{ user: { id } }`, which has none — so every call
    // sent the literal string "Bearer undefined", was rejected 401, and the catch swallowed it.
    expect(memory).not.toContain("Bearer ${session.access_token}");
    // Session resolution is now bounded by the captured view's cancellation fence.
    expect(memory).toContain("await within(supabase.auth.getSession())");
    expect(memory).toContain("Bearer ${accessToken}");
    // And it stops rather than sending a request that cannot be attributed to anyone.
    expect(memory).toContain("if (!current() || controller.signal.aborted || !accessToken || session.user.id !== scope.actorId) return null;");
  });
});
