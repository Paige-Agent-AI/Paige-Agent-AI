import { describe, it, expect } from "vitest";
import {
  DEPARTMENT_NAMES,
  departmentLabel,
  departmentSlugOf,
  elapsedLabel,
  toActivityItem,
} from "./useSoloActivityFeed";

/**
 * These test the pure half of the feed — the half that decides what a recorded event is
 * ALLOWED to claim. The surfaces this replaces claimed a great deal and read nothing, so
 * every assertion below is written to go red on the specific way that could come back:
 * a department guessed rather than read, work credited to Paige that a person did, an
 * elapsed label invented from an unparseable instant, a half-blank row rendered anyway.
 */
describe("departmentSlugOf — the desk is read, never guessed", () => {
  it("prefers where the event was routed TO over where it came from", () => {
    // A handoff names both. The destination is the desk that acted, and picking `from`
    // would attribute the work to whoever passed it along.
    expect(departmentSlugOf({ from_department: "owner_ops", to_department: "finance" })).toBe("finance");
  });

  it("falls back to from_department when there is no destination", () => {
    expect(departmentSlugOf({ from_department: "marketing", to_department: null })).toBe("marketing");
  });

  it("returns null for a slug that is not a seeded department", () => {
    // The failure this prevents: bucketing an unrecognised desk into a plausible one, which
    // reads as attribution and is a guess.
    expect(departmentSlugOf({ to_department: "growth_hacking" })).toBeNull();
  });

  it("returns null when the event names no department at all", () => {
    expect(departmentSlugOf({})).toBeNull();
    expect(departmentSlugOf({ from_department: "  ", to_department: null })).toBeNull();
  });
});

describe("departmentLabel — an unnamed desk says so", () => {
  it("names a seeded slug", () => {
    expect(departmentLabel("client_experience")).toBe("Client Success");
  });

  it("says Unattributed rather than rendering blank", () => {
    // A blank label reads as a design gap; "Unattributed" is a fact the reader can act on.
    expect(departmentLabel(null)).toBe("Unattributed");
    expect(departmentLabel("not_a_department")).toBe("Unattributed");
  });
});

describe("DEPARTMENT_NAMES — the map is the seeded set, not a longer one", () => {
  it("carries exactly the eleven slugs verified live on 2026-09-01", () => {
    // Pinned so that inventing a twelfth department to make a feed look busier fails here
    // rather than shipping. If the seed genuinely changes, this test is the thing that
    // makes someone go and check.
    expect(Object.keys(DEPARTMENT_NAMES).sort()).toEqual([
      "client_experience",
      "executive_office",
      "finance",
      "legal_compliance",
      "marketing",
      "operations_pmo",
      "owner_ops",
      "people_talent",
      "product_curriculum",
      "sales",
      "technology_automation",
    ]);
  });
});

describe("elapsedLabel — derived from a real instant, or nothing", () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");

  it("buckets seconds, minutes, hours and days", () => {
    expect(elapsedLabel("2026-09-01T11:59:56.000Z", now)).toBe("4s ago");
    expect(elapsedLabel("2026-09-01T11:38:00.000Z", now)).toBe("22m ago");
    expect(elapsedLabel("2026-09-01T09:00:00.000Z", now)).toBe("3h ago");
    expect(elapsedLabel("2026-08-29T12:00:00.000Z", now)).toBe("3d ago");
  });

  it("clamps a future instant to just-now instead of counting backwards", () => {
    // Clock skew between the database and the browser is normal; "in 3 seconds" is not.
    expect(elapsedLabel("2026-09-01T12:00:03.000Z", now)).toBe("0s ago");
  });

  it("returns nothing for an unparseable instant rather than a plausible age", () => {
    expect(elapsedLabel("not a date", now)).toBe("");
  });
});

describe("toActivityItem — a row must earn its line", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Filed the kickoff notes",
    summary: "On the client's record.",
    actor_type: "paige_agent",
    from_department: "operations_pmo",
    to_department: null,
    occurred_at: "2026-09-01T11:59:00.000Z",
  };

  it("keeps the recorded title and summary verbatim", () => {
    const item = toActivityItem(base);
    expect(item?.title).toBe("Filed the kickoff notes");
    expect(item?.summary).toBe("On the client's record.");
    expect(item?.departmentSlug).toBe("operations_pmo");
  });

  it("credits Paige only for actor_type 'paige_agent'", () => {
    expect(toActivityItem({ ...base, actor_type: "paige_agent" })?.byPaige).toBe(true);
    expect(toActivityItem({ ...base, actor_type: "owner_staff" })?.byPaige).toBe(false);
  });

  it("E4-S3: names a recorded person (owner_staff) explicitly, and nothing else", () => {
    expect(toActivityItem({ ...base, actor_type: "owner_staff" })?.byPerson).toBe(true);
    expect(toActivityItem({ ...base, actor_type: "paige_agent" })?.byPerson).toBe(false);
    // An unknown actor is not Paige — and not a NAMED person either: it stays unattributed.
    expect(toActivityItem({ ...base, actor_type: "something_new" })?.byPerson).toBe(false);
    expect(toActivityItem({ ...base, actor_type: undefined })?.byPerson).toBe(false);
  });

  it("reports an UNKNOWN actor as a person, not as Paige", () => {
    // The safe direction. Crediting Paige with a person's work is the misattribution that
    // matters on a surface whose whole claim is "here is what Paige did".
    expect(toActivityItem({ ...base, actor_type: "something_new" })?.byPaige).toBe(false);
    expect(toActivityItem({ ...base, actor_type: undefined })?.byPaige).toBe(false);
  });

  it("turns an empty summary into a stated absence, not an empty string", () => {
    expect(toActivityItem({ ...base, summary: "   " })?.summary).toBeNull();
    expect(toActivityItem({ ...base, summary: null })?.summary).toBeNull();
  });

  it("drops a row with no id or no title instead of rendering a half-blank line", () => {
    expect(toActivityItem({ ...base, id: undefined })).toBeNull();
    expect(toActivityItem({ ...base, title: undefined })).toBeNull();
    expect(toActivityItem(null)).toBeNull();
    expect(toActivityItem("nope")).toBeNull();
  });
});
