import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const readBudget = (source: string): number | null => {
  const match = source.match(/const PAIGE_INTERACTIVE_TURN_BUDGET_MS = ([\d_]+);/);
  return match ? Number(match[1].replace(/_/g, "")) : null;
};

describe("PAIGE interactive turn budget", () => {
  it("keeps the client fence and server work budget symmetric at 360 seconds", () => {
    const client = read("src/components/dashboard/PaigeAIChat.tsx");
    const clientBudget = readBudget(client);
    const serverBudget = readBudget(read("supabase/functions/paige-ai-chat/index.ts"));

    expect(clientBudget).toBe(360_000);
    expect(serverBudget).toBe(360_000);
    expect(clientBudget).toBe(serverBudget);
    // C3a (declared change): the working signal is the answer's own living status line, which the
    // six-minute window settles honestly ("Stopped listening at six minutes"), never as Done.
    expect(client).toContain("<PaigeLiveTurnStatus");
    expect(client).toContain('settleLiveTurn("timeout", assistantId);');
    expect(client).not.toContain("<PaigeThinkingIndicator");
    expect(client).toContain("when the six-minute interactive window ended");
    expect(client).toContain("I can't confirm whether that work finished or was saved");
    expect(client).not.toContain("did not respond before the local timeout");
  });
});
