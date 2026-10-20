import { describe, expect, it } from "vitest";
import { cleanSoloSetupBrief } from "./settings-setup-contract";
import {
  FIRST_VALUE_LOGIC_VERSION,
  confirmedOperationalFields,
  firstValueState,
  hasConfirmedPriority,
  nextBestActions,
  type FirstValueStatusSnapshot,
} from "./first-value-recommendation";

const SNAP_FULL: FirstValueStatusSnapshot = {
  managedEmailConfigured: true,
  businessEmailConfirmed: true,
  webIdentity: "published",
};
const SNAP_EMPTY: FirstValueStatusSnapshot = {
  managedEmailConfigured: false,
  businessEmailConfirmed: false,
  webIdentity: "none",
};

const briefWith = (fields: Record<string, string>) =>
  cleanSoloSetupBrief({
    ...fields,
    provenance: Object.fromEntries(
      Object.keys(fields).map((key) => [key, { source: "owner_confirmed", confidence: "confirmed" }]),
    ),
  });

const CONFIRMED = briefWith({ currentPriority: "Turn more quotes into booked work", industry: "Design consultancy" });

describe("E01 first-value logic (ALG-02 / ALG-13)", () => {
  it("is versioned so evidence can pin the exact logic", () => {
    expect(FIRST_VALUE_LOGIC_VERSION).toBe(1);
  });

  it("asks for the priority and recommends nothing else without one (ALG-13: no goal, no recommendation)", () => {
    const actions = nextBestActions({ brief: cleanSoloSetupBrief({}), snapshot: SNAP_FULL });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ key: "confirm-priority", availability: "NEEDS_SETUP" });
    const state = firstValueState({ brief: cleanSoloSetupBrief({}), snapshot: SNAP_FULL });
    expect(state.friction.some((f) => f.key === "priority")).toBe(true);
    // Grounding is per-input: an empty brief still credits the snapshot-proven
    // comms/web achievements — but never the profile, and never first-action.
    expect(state.achieved.map((x) => x.key)).toEqual(["comms-sender", "comms-email", "web-identity"]);
    const empty = firstValueState({ brief: cleanSoloSetupBrief({}), snapshot: SNAP_EMPTY });
    expect(empty.achieved).toHaveLength(0);
    expect(empty.friction.some((f) => f.key === "priority")).toBe(true);
  });

  it("ranks deterministically and explains every action with the owner-declared input it derives from", () => {
    const a = nextBestActions({ brief: CONFIRMED, snapshot: SNAP_EMPTY });
    const b = nextBestActions({ brief: CONFIRMED, snapshot: SNAP_EMPTY });
    expect(a).toEqual(b);
    expect(a.map((x) => x.key)).toEqual(["first-action", "comms-setup", "web-reserve", "capabilities"]);
    expect(a[0].reason).toContain("Turn more quotes into booked work");
    expect(a[3].reason).toContain("Design consultancy");
    expect(a.every((x) => x.reason.length > 0 && x.prerequisite !== undefined)).toBe(true);
  });

  it("caps at the owner-approved three-to-four actions", () => {
    const actions = nextBestActions({ brief: CONFIRMED, snapshot: SNAP_EMPTY });
    expect(actions.length).toBeLessThanOrEqual(4);
  });

  it("honors snooze for non-foundational actions but never for the priority action", () => {
    const snoozed = nextBestActions({ brief: CONFIRMED, snapshot: SNAP_EMPTY, snoozed: ["comms-setup", "web-reserve", "capabilities"] });
    expect(snoozed.map((x) => x.key)).toEqual(["first-action"]);
    const stillFoundational = nextBestActions({
      brief: cleanSoloSetupBrief({ currentPriority: "P", provenance: { currentPriority: { source: "owner_confirmed", confidence: "confirmed" } } }),
      snapshot: SNAP_EMPTY,
      snoozed: ["confirm-priority"],
    });
    expect(stillFoundational[0].key).toBe("first-action");
  });

  it("reports managed-sender and email states truthfully rather than inferring readiness", () => {
    const halfReady = nextBestActions({
      brief: CONFIRMED,
      snapshot: { managedEmailConfigured: true, businessEmailConfirmed: false, webIdentity: "reserved" },
    });
    expect(halfReady.map((x) => x.key)).toEqual(["first-action", "comms-confirm", "web-publish", "capabilities"]);
    expect(halfReady.find((x) => x.key === "web-publish")?.availability).toBe("NOT_YET_AVAILABLE");
  });

  it("ALG-02 achieved items carry their grounding evidence; nothing is fabricated", () => {
    const state = firstValueState({ brief: CONFIRMED, snapshot: SNAP_FULL });
    expect(state.achieved.map((x) => x.key)).toEqual(["profile", "comms-sender", "comms-email", "web-identity"]);
    expect(state.achieved.every((x) => x.evidence.length > 0)).toBe(true);
    expect(state.achieved.some((x) => x.key === "first-action")).toBe(false);
    expect(state.friction.map((f) => f.key)).toEqual(["first-action"]);
    expect(state.friction[0].note).toContain("receipt");
  });

  it("treats unknown web identity as unread, never as none/published", () => {
    const state = firstValueState({
      brief: CONFIRMED,
      snapshot: { managedEmailConfigured: true, businessEmailConfirmed: true, webIdentity: "unknown" },
    });
    expect(state.achieved.some((x) => x.key === "web-identity")).toBe(false);
    expect(state.friction.find((f) => f.key === "web-identity")?.note).toContain("could not be read");
  });

  it("counts only owner-confirmed operational fields, ignoring observed or blank ones", () => {
    expect(confirmedOperationalFields(CONFIRMED).sort()).toEqual(["currentPriority", "industry"].sort());
    expect(hasConfirmedPriority(CONFIRMED)).toBe(true);
    const observed = cleanSoloSetupBrief({
      currentPriority: "Observed",
      provenance: { currentPriority: { source: "connection_sourced", confidence: "observed" } },
    });
    expect(hasConfirmedPriority(observed)).toBe(false);
    expect(confirmedOperationalFields(observed)).toHaveLength(0);
  });
});
