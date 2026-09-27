// The retired title role grants nothing in the comms and sending-identity edge functions. A person
// holding the platform-wide `coach` role, or a `coach` seat in a business, cannot buy or search
// numbers, register A2P copy, connect or disconnect a sending mailbox, send, execute an approval,
// trigger a workflow, mint a calling token, or be rung for an inbound call.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasTenantVoiceAuthority } from "../../../supabase/functions/voice-access-token/authorization";

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

const FUNCTIONS = [
  "comms-search-numbers",
  "comms-purchase-number",
  "comms-a2p-draft",
  "comms-a2p-submit",
  "smtp-connect",
  "smtp-disconnect",
  "gmail-oauth-start",
  "gmail-oauth-callback",
  "gmail-disconnect",
  "send-message",
  "execute-approval",
  "trigger-workflow",
  "zoom-oauth-callback",
  "voice-twiml",
  "voice-access-token",
];

// Any code that reads the role: an RPC asking for it, a comparison against it, or a list containing it.
const ROLE_READ = /_role:\s*["']coach["']|===?\s*["']coach["']|\[[^\]]*["']coach["'][^\]]*\]|\bisCoach\b/;

describe("the retired coach role grants nothing in comms and sending identity", () => {
  it("does not give a calling token to a coach seat", () => {
    expect(hasTenantVoiceAuthority({
      isPlatformOwner: false,
      membershipTenantId: "tenant-a",
      activeTenantId: "tenant-a",
      membershipStatus: "active",
      membershipRole: "coach",
    })).toBe(false);
  });

  it("is read by none of the gates", () => {
    const offenders = FUNCTIONS.flatMap((fn) => {
      const files = fn === "voice-access-token" ? ["index.ts", "authorization.ts"] : ["index.ts"];
      return files
        .map((file) => `supabase/functions/${fn}/${file}`)
        .filter((path) => read(path).split("\n").some((line) => !line.trim().startsWith("//") && ROLE_READ.test(line)));
    });
    expect(offenders).toEqual([]);
  });
});
