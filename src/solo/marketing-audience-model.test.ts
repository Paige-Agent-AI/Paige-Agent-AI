import { describe, expect, it } from "vitest";
import { deriveAudience, type AudienceContact } from "./marketing-audience-model";

const NOW = new Date("2026-10-04T15:00:00").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
let seq = 0;
const contact = (extra: Partial<AudienceContact> = {}): AudienceContact => ({
  id: `c${++seq}`, lifecycle_stage: "new_lead", source: "manual", tags: [], created_at: daysAgo(100), last_contacted_at: null,
  do_not_contact: false, dnd_active: false, disqualified: false, ...extra,
});

describe("deriveAudience", () => {
  it("counts the period, the period before it, and compares only what it read", () => {
    const contacts = [
      contact({ created_at: daysAgo(2) }), contact({ created_at: daysAgo(10) }), contact({ created_at: daysAgo(29) }),
      contact({ created_at: daysAgo(35) }), contact({ created_at: daysAgo(200) }),
    ];
    const model = deriveAudience({ contacts, reachableIds: new Set(), periodDays: 30, now: NOW });
    expect(model.total).toBe(5);
    expect(model.added.count).toBe(3);
    expect(model.added.delta).toEqual({ change: 2, percent: 200 });
    expect(model.totalDelta).toEqual({ change: 3, percent: 150 });
    const capped = deriveAudience({ contacts, reachableIds: new Set(), periodDays: 30, now: NOW, capped: true });
    expect(capped.added.delta).toBeNull();
    expect(capped.totalDelta).toBeNull();
  });

  it("a contact is reachable only with an email or phone and when it accepts contact", () => {
    // An address on record is a row in client_contact_methods; the ids passed in are those contacts.
    const contacts = [contact(), contact(), contact(), contact({ do_not_contact: true }), contact({ dnd_active: true }), contact()];
    const withAddress = new Set(contacts.slice(0, 5).map((c) => c.id));
    const model = deriveAudience({ contacts, reachableIds: withAddress, periodDays: 30, now: NOW });
    expect(model.reachable).toEqual({ count: 3, share: 50 });
  });

  it("groups stages, orders them first contact to last, and keeps unknown and missing stages visible", () => {
    const contacts = [contact({ lifecycle_stage: "client_active" }), contact({ lifecycle_stage: "qualified" }), contact({ lifecycle_stage: "new_lead" }), contact({ lifecycle_stage: "vip" }), contact({ lifecycle_stage: null }), contact({ lifecycle_stage: "client_funded" })];
    const model = deriveAudience({ contacts, reachableIds: new Set(), periodDays: 30, now: NOW });
    expect(model.stages.map((s) => s.key)).toEqual(["new_lead", "qualified", "client_active", "client_funded", "vip", "__none"]);
    expect(Object.fromEntries(model.groups.map((g) => [g.key, g.count]))).toEqual({ leads: 1, qualified: 1, clients: 2, former: 0, other: 1, none: 1 });
    expect(model.qualified.count).toBe(1);
  });

  it("the growth line runs from the total before the period to the total now", () => {
    const contacts = [contact({ created_at: daysAgo(50) }), contact({ created_at: daysAgo(5) }), contact({ created_at: daysAgo(0) }), contact({ created_at: null })];
    const model = deriveAudience({ contacts, reachableIds: new Set(), periodDays: 7, now: NOW });
    expect(model.growth).toHaveLength(7);
    expect(model.growth[0].total).toBe(2); // the dated one before the period, and the undated one
    expect(model.growth[6].total).toBe(4);
    expect(model.growth.reduce((sum, point) => sum + point.added, 0)).toBe(2);
    // An undated contact means the earlier total is unknown: no comparison is made.
    expect(model.totalDelta).toBeNull();
  });

  it("counts tags, contacted and not-reached contacts, excluding anyone who opted out from the latter", () => {
    const contacts = [
      contact({ tags: ["webinar", "vip"], last_contacted_at: daysAgo(3) }), contact({ tags: ["webinar"], last_contacted_at: daysAgo(120) }),
      contact({ tags: [" "] }), contact({ do_not_contact: true }),
    ];
    const model = deriveAudience({ contacts, reachableIds: new Set(), periodDays: 30, now: NOW });
    expect(model.tagged.count).toBe(2);
    expect(model.tags.map((t) => [t.key, t.count])).toEqual([["webinar", 2], ["vip", 1]]);
    expect(model.contacted.count).toBe(1);
    expect(model.stale).toBe(2);
  });

  it("a contact added recently and not yet contacted is new, not neglected", () => {
    const contacts = [contact({ created_at: daysAgo(5) }), contact({ created_at: daysAgo(200) }), contact({ created_at: daysAgo(5), last_contacted_at: daysAgo(100) })];
    const model = deriveAudience({ contacts, reachableIds: new Set(), periodDays: 30, now: NOW });
    expect(model.stale).toBe(2); // the 200-day-old contact never reached, and the one last reached 100 days ago
  });
});
