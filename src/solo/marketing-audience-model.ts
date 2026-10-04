// Marketing › Audience: every figure the tab shows, derived from the workspace's own contacts.
//
// The inputs are the rows `clients` returns for this workspace (merged contacts excluded) and the
// ids of contacts with an email or phone on record (`client_contact_methods`). Nothing is estimated:
// a comparison appears only where the read covers both periods, and a capped read is a floor.

export type AudienceContact = {
  id: string;
  lifecycle_stage: string | null;
  source: string | null;
  tags: string[] | null;
  created_at: string | null;
  last_contacted_at: string | null;
  do_not_contact: boolean | null;
  dnd_active: boolean | null;
  disqualified: boolean | null;
  email: string | null;
  phone: string | null;
};

export const AUDIENCE_PERIODS = [7, 30, 90] as const;
export const STALE_DAYS = 90;

/** Where each lifecycle stage sits in the relationship. Unknown stages stay visible as "Other". */
export const STAGE_GROUP: Record<string, "leads" | "qualified" | "clients" | "former"> = {
  new_lead: "leads", lead: "leads", prospect: "leads", nurturing: "leads",
  qualified: "qualified", hot_lead: "qualified", negotiating: "qualified",
  won: "clients", customer: "clients", active: "clients", client_active: "clients", client_paused: "clients", client_funded: "clients",
  client_alumni: "former", inactive: "former", churned: "former", client_churned: "former",
};
export const GROUP_LABEL = { leads: "Leads", qualified: "Qualified", clients: "Clients", former: "Former clients", other: "Other stages", none: "No stage" } as const;
export type GroupKey = keyof typeof GROUP_LABEL;

// The order stages read in, first contact to last. Anything else follows, then "No stage".
export const STAGE_ORDER = ["new_lead", "lead", "prospect", "nurturing", "qualified", "hot_lead", "negotiating", "won", "customer", "active", "client_active", "client_paused", "client_funded", "client_alumni", "inactive", "churned", "client_churned"];

const DAY = 86_400_000;
const midnight = (time: number) => { const d = new Date(time); d.setHours(0, 0, 0, 0); return d.getTime(); };
const at = (iso: string | null) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

export type Delta = { change: number; percent: number | null } | null;
const deltaOf = (now: number, before: number): Delta => ({ change: now - before, percent: before > 0 ? Math.round(((now - before) / before) * 100) : null });

export type Ranked = { key: string; count: number; share: number };
function rank(values: (string | null | undefined)[], total: number): Ranked[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value?.trim() || "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key: key || "__none", count, share: pct(count, total) }));
}

export type GrowthPoint = { day: number; label: string; total: number; added: number };

export type AudienceModel = {
  total: number;
  capped: boolean;
  periodDays: number;
  totalDelta: Delta;
  added: { count: number; delta: Delta };
  qualified: { count: number; share: number };
  tagged: { count: number; share: number };
  reachable: { count: number; share: number };
  contacted: { count: number; share: number };
  stale: number;
  groups: { key: GroupKey; count: number; share: number }[];
  stages: { key: string; count: number }[];
  growth: GrowthPoint[];
  sources: Ranked[];
  tags: Ranked[];
  tagCount: number;
};

export function deriveAudience({ contacts, reachableIds, periodDays, now = Date.now(), capped = false }: {
  contacts: AudienceContact[];
  reachableIds: Set<string>;
  periodDays: number;
  now?: number;
  capped?: boolean;
}): AudienceModel {
  const total = contacts.length;
  const today = midnight(now);
  const start = today - (periodDays - 1) * DAY; // the period includes today
  const prevStart = start - periodDays * DAY;
  const staleBefore = now - STALE_DAYS * DAY;
  const created = contacts.map((c) => at(c.created_at));

  const addedNow = created.filter((t) => t !== null && t >= start && t <= now).length;
  const addedPrev = created.filter((t) => t !== null && t >= prevStart && t < start).length;
  const beforeStart = created.filter((t) => t !== null && t < start).length;
  const undated = created.filter((t) => t === null).length;

  const qualified = contacts.filter((c) => STAGE_GROUP[c.lifecycle_stage ?? ""] === "qualified").length;
  const tagged = contacts.filter((c) => (c.tags ?? []).some((tag) => tag?.trim())).length;
  const blocked = (c: AudienceContact) => Boolean(c.do_not_contact || c.dnd_active || c.disqualified);
  const reachable = contacts.filter((c) => !blocked(c) && (Boolean(c.email?.trim() || c.phone?.trim()) || reachableIds.has(c.id))).length;
  const contacted = contacts.filter((c) => { const t = at(c.last_contacted_at); return t !== null && t >= start && t <= now; }).length;
  const stale = contacts.filter((c) => { if (blocked(c)) return false; const t = at(c.last_contacted_at); return t === null || t < staleBefore; }).length;

  const groupCounts = new Map<GroupKey, number>();
  for (const c of contacts) {
    const stage = c.lifecycle_stage?.trim();
    const key: GroupKey = !stage ? "none" : STAGE_GROUP[stage] ?? "other";
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  const groups = (["leads", "qualified", "clients", "former", "other", "none"] as GroupKey[])
    .map((key) => ({ key, count: groupCounts.get(key) ?? 0, share: pct(groupCounts.get(key) ?? 0, total) }));

  const stageCounts = rank(contacts.map((c) => c.lifecycle_stage), total);
  const order = (key: string) => (key === "__none" ? 999 : STAGE_ORDER.indexOf(key) === -1 ? 500 : STAGE_ORDER.indexOf(key));
  const stages = stageCounts.map(({ key, count }) => ({ key, count })).sort((a, b) => order(a.key) - order(b.key) || b.count - a.count);

  // Running total at the end of each day of the period. Undated contacts are counted from the start,
  // because they exist but cannot be placed on a day.
  const growth: GrowthPoint[] = [];
  let running = beforeStart + undated;
  for (let i = 0; i < periodDays; i++) {
    const day = start + i * DAY;
    const end = day + DAY;
    const added = created.filter((t) => t !== null && t >= day && t < end && t <= now).length;
    running += added;
    growth.push({ day, label: new Date(day).toLocaleDateString(undefined, { month: "short", day: "numeric" }), total: running, added });
  }

  const allTags = rank(contacts.flatMap((c) => (c.tags ?? []).filter((tag) => tag?.trim())), total).filter((row) => row.key !== "__none");

  // A comparison needs the whole read: a capped read cannot say what the earlier total was.
  const comparable = !capped && undated === 0;
  return {
    total,
    capped,
    periodDays,
    totalDelta: comparable && beforeStart > 0 ? deltaOf(total, beforeStart) : null,
    added: { count: addedNow, delta: comparable ? deltaOf(addedNow, addedPrev) : null },
    qualified: { count: qualified, share: pct(qualified, total) },
    tagged: { count: tagged, share: pct(tagged, total) },
    reachable: { count: reachable, share: pct(reachable, total) },
    contacted: { count: contacted, share: pct(contacted, total) },
    stale,
    groups,
    stages,
    growth,
    sources: rank(contacts.map((c) => c.source), total),
    tags: allTags,
    tagCount: allTags.length,
  };
}
