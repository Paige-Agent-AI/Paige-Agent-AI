import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OWNER_REFUSAL_HINTS,
  ownerRefusal,
} from "../../supabase/functions/solo-team-invitations/owner-refusals";

// EXP08 owner invitations, review S5: the owner refusals (42501 + HINT) used to come back from
// solo-team-invitations as HTTP 500 "tell us". They are recognised by HINT and shown as written.

const MIGRATION = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20271119020008_exp08_owner_invitations.sql"),
  "utf8",
);
const HANDLER = readFileSync(
  resolve(process.cwd(), "supabase/functions/solo-team-invitations/index.ts"),
  "utf8",
);

/** A PostgREST error as supabase-js hands it over: message, code, details, hint. */
const pgError = (message: string, hint: string | null, code = "42501") =>
  Object.assign(new Error(message), { code, details: null, hint });

describe("solo-team-invitations shows the owner refusals as written, with the right status", () => {
  it("knows every HINT code the owner-invitation migration raises", () => {
    const raised = new Set([...MIGRATION.matchAll(/HINT = '([A-Z_]+)'/g)].map((m) => m[1]));
    expect(raised.size, "the migration's HINT codes were found").toBeGreaterThanOrEqual(15);
    for (const hint of raised) {
      expect(Object.keys(OWNER_REFUSAL_HINTS), `${hint} is raised by the migration`).toContain(hint);
    }
  });

  it("answers who-may-act refusals 403 and shows the sentence, names included", () => {
    const cases: Array<[string, string]> = [
      ["OWNER_HOLDER_ONLY", "Only the account holder can add owners to this business."],
      ["OWNER_INVITATION_HOLDER_ONLY", "Only the account holder can change an owner invitation."],
      ["OWNER_NO_ACCOUNT_HOLDER", "Northstar Studio has no account holder right now, so no one can add owners or change another owner's access. Contact the Paige team."],
      ["OWNER_HOLDER_PAUSED", "Morgan Hale's access is paused for billing, so no one can add owners or change another owner's access until it's back. Nothing changed."],
      ["OWNER_HOLDER_PAUSED_SELF", "Your access to Northstar Studio is paused for billing, so you can't add or change owners until it's back. Nothing changed."],
      ["OWNER_INVITE_EXISTS_FOR_ADDRESS", "There's already an owner invitation for this address. Only the account holder can change it."],
      ["OWNER_INVITE_UNAVAILABLE", "Owner invitations aren't available for this account."],
    ];
    for (const [hint, sentence] of cases) {
      expect(ownerRefusal(pgError(sentence, hint)), hint).toEqual({ status: 403, message: sentence });
    }
  });

  it("answers a not-valid-as-asked owner invitation 400 and a taken seat 409", () => {
    expect(ownerRefusal(pgError("Owners always take part in team conversations.", "OWNER_TEAM_CONVERSATIONS", "P0001")))
      .toEqual({ status: 400, message: "Owners always take part in team conversations." });
    expect(ownerRefusal(pgError("Enter the legal name.", "OWNER_RECORD_NAME", "P0001"))?.status).toBe(400);
    expect(ownerRefusal(pgError("There's already an owner invitation pending for Cedar Row Trust.", "OWNER_RECORD_INVITED", "P0001"))?.status).toBe(409);
    expect(ownerRefusal(pgError("Harbor Lane Holdings LLC already has a representative on the team.", "OWNER_RECORD_SEATED", "P0001"))?.status).toBe(409);
    // Round 3 (S-B): resending an owner invitation whose legal owner was deleted.
    const removed = "This owner invitation was for a legal owner that has since been removed, so it can't be sent again. Send a new owner invitation instead.";
    expect(ownerRefusal(pgError(removed, "OWNER_INVITE_RECORD_REMOVED", "P0001"))).toEqual({ status: 409, message: removed });
    // Round 4 (B1): a person whose owner invitation is waiting takes no other seat in that business.
    const waiting = "You have an owner invitation to Northstar Studio waiting. Open that invitation to join as an owner. Nothing changed.";
    expect(ownerRefusal(pgError(waiting, "OWNER_INVITE_WAITING"))).toEqual({ status: 409, message: waiting });
  });

  it("passes nothing else: no hint, a foreign hint, a non-string hint or an empty message", () => {
    expect(ownerRefusal(pgError("permission denied for table tenants", null))).toBeNull();
    expect(ownerRefusal(pgError('invalid input syntax for type uuid: "OWNER_HOLDER_ONLY"', null, "22P02"))).toBeNull();
    expect(ownerRefusal(pgError("Could not find the function public.create_solo_team_invite in the schema cache",
      "Perhaps you meant to call the function public.create_solo_team_invite", "PGRST202"))).toBeNull();
    expect(ownerRefusal(Object.assign(new Error("x"), { hint: ["OWNER_HOLDER_ONLY"] }))).toBeNull();
    expect(ownerRefusal(pgError("  ", "OWNER_HOLDER_ONLY"))).toBeNull();
    expect(ownerRefusal(null)).toBeNull();
    expect(ownerRefusal("OWNER_HOLDER_ONLY")).toBeNull();
    // A prototype key is not a code.
    expect(ownerRefusal(pgError("x", "toString"))).toBeNull();
  });

  it("is consulted first in the handler's catch, before the generic 500", () => {
    const at = HANDLER.indexOf("} catch (error) {");
    expect(at, "the handler's catch was found").toBeGreaterThan(-1);
    const call = HANDLER.indexOf("const owner = ownerRefusal(error);", at);
    const reply = HANDLER.indexOf("if (owner) return json({ ok: false, error: owner.message }, owner.status);", at);
    const generic = HANDLER.indexOf("The invitation could not be completed just now.", at);
    expect(call, "ownerRefusal is called in the catch").toBeGreaterThan(at);
    expect(reply, "its sentence and status are returned").toBeGreaterThan(call);
    expect(reply, "before the generic fallback").toBeLessThan(generic);
    expect(HANDLER).toContain('import { ownerRefusal } from "./owner-refusals.ts";');
  });
});
