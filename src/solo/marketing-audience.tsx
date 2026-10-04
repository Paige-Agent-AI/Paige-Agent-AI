// Marketing › Audience (owner reference 2026-10-04): who marketing can reach, read from this
// workspace's own contacts. Every figure comes from marketing-audience-model.ts; nothing is estimated.
//
// Reads (tenant-scoped, read-only, existing tables; RLS may narrow `clients` to assigned contacts):
//   clients                 stage, source, tags, dates and contact flags; merged contacts excluded
//   client_contact_methods  which contacts have an email or phone on record
// Saved audiences/segments do not exist yet; the tab says so and offers what can be done today.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Ic as SharedIcons } from "./_shared";

// The shared icon set is untyped; these views pass only a size.
const Ic = SharedIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
import { AUDIENCE_PERIODS, GROUP_LABEL, STALE_DAYS, deriveAudience, type AudienceContact, type AudienceModel, type GroupKey } from "./marketing-audience-model";
import { AskPaige, ChartBoundary, DeltaLine, OverviewStat } from "./marketing-ui";
import { AskPaigeButton, Frame, NotYet, TabActions, useTenantRead } from "./marketing-planned";

const Donut = React.lazy(() => import("./marketing-overview-charts").then((module) => ({ default: module.Donut })));
const StageBars = React.lazy(() => import("./marketing-overview-charts").then((module) => ({ default: module.StageBars })));
const GrowthArea = React.lazy(() => import("./marketing-overview-charts").then((module) => ({ default: module.GrowthArea })));

const PAGE = 1000;
export const CONTACT_READ_LIMIT = 5000;
const COLUMNS = "id,lifecycle_stage,source,tags,created_at,last_contacted_at,do_not_contact,dnd_active,disqualified,email,phone";

type AudienceRead = { contacts: AudienceContact[]; reachableIds: Set<string>; capped: boolean };
const METHOD_READ_LIMIT = CONTACT_READ_LIMIT * 2;
const NO_READ: AudienceRead = { contacts: [], reachableIds: new Set(), capped: false };

// The generated client types cannot follow this column list through the filters; the rows are typed below.
type Query = { select: (columns: string) => Query; eq: (column: string, value: unknown) => Query; is: (column: string, value: null) => Query; in: (column: string, values: string[]) => Query; order: (column: string, options: { ascending: boolean }) => Query; range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: unknown }> };
const db = supabase as unknown as { from: (table: string) => Query };

// Newest first, so a capped read still holds every recent contact the period figures count. `id` breaks
// ties: one import shares a created_at, and without a unique order a page could repeat or skip rows.
async function readAudience(tenantId: string): Promise<AudienceRead> {
  const contacts: AudienceContact[] = [];
  for (let from = 0; from < CONTACT_READ_LIMIT; from += PAGE) {
    const { data, error } = await db.from("clients").select(COLUMNS).eq("tenant_id", tenantId).is("merged_into_contact_id", null)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, from + PAGE - 1);
    if (error) throw error;
    contacts.push(...((data ?? []) as unknown as AudienceContact[]));
    if (!data || data.length < PAGE) break;
  }
  const reachableIds = new Set<string>();
  let methods = 0;
  for (let from = 0; from < METHOD_READ_LIMIT; from += PAGE) {
    const { data, error } = await db.from("client_contact_methods").select("client_id").eq("tenant_id", tenantId).in("kind", ["email", "phone"])
      .order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of (data ?? []) as { client_id: string }[]) reachableIds.add(row.client_id);
    methods += data?.length ?? 0;
    if (!data || data.length < PAGE) break;
  }
  return { contacts, reachableIds, capped: contacts.length >= CONTACT_READ_LIMIT || methods >= METHOD_READ_LIMIT };
}

// Stage words for owners. A stage named for one vertical's outcome reads as a neutral outcome (§2).
export const STAGE_LABEL: Record<string, string> = {
  new_lead: "New lead", lead: "Lead", prospect: "Prospect", qualified: "Qualified", nurturing: "Nurturing", hot_lead: "Hot lead",
  negotiating: "Negotiating", won: "Won", customer: "Customer", active: "Active", client_active: "Active client",
  inactive: "Inactive", client_paused: "Paused client", churned: "Former client", client_churned: "Former client",
  client_funded: "Outcome reached", client_alumni: "Alumni", __none: "No stage",
};
export const SOURCE_LABEL: Record<string, string> = {
  paige_form: "Your forms", manual: "Added by hand", import: "Imported", referral: "Referral",
  // `paige` is also the default when a tool creates a contact without naming a source.
  paige: "PAIGE or a connected tool", conversations: "From a conversation", __none: "Not recorded",
};
const words = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
const stageLabel = (key: string) => STAGE_LABEL[key] ?? words(key);
const sourceLabel = (key: string) => SOURCE_LABEL[key] ?? words(key);

const GROUP_TOKEN: Record<GroupKey, "--chart-1" | "--chart-2" | "--chart-3" | "--chart-4" | "--chart-other" | "--chart-untagged"> = {
  leads: "--chart-1", qualified: "--chart-3", clients: "--chart-2", former: "--chart-4", other: "--chart-other", none: "--chart-untagged",
};
const STAGE_TOKEN = (key: string) => {
  const group = key === "__none" ? "none" : ({ new_lead: "leads", lead: "leads", prospect: "leads", nurturing: "leads", qualified: "qualified", hot_lead: "qualified", negotiating: "qualified", won: "clients", customer: "clients", active: "clients", client_active: "clients", client_paused: "clients", client_funded: "clients", client_alumni: "former", inactive: "former", churned: "former", client_churned: "former" } as Record<string, GroupKey>)[key] ?? "other";
  return GROUP_TOKEN[group];
};

const floor = (n: number, capped: boolean) => (capped ? `${n.toLocaleString()}+` : n.toLocaleString());

/** One ranked row: label, bar, share and count. */
function Shares({ rows, label, empty }: { rows: { key: string; count: number; share: number }[]; label: (key: string) => string; empty: string }) {
  if (!rows.length) return <p className="mo-note">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.count));
  return <ol className="mo-rank ma-shares">{rows.map((row) => <li key={row.key}>
    <span className="ma-share-row"><span className="mo-rank-name">{label(row.key)}</span><span className="mo-rank-bar" aria-hidden="true"><i style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}/></span><em>{row.share}%</em><b>{row.count.toLocaleString()}</b></span>
  </li>)}</ol>;
}

type Insight = { key: string; icon: React.ReactNode; title: string; detail: string };

export function audienceInsights(model: AudienceModel): { items: Insight[]; next: { text: string; prompt: string } | null } {
  const items: Insight[] = [];
  const period = `the last ${model.periodDays} days`;
  if (model.added.count > 0) {
    const d = model.added.delta;
    const trend = d && d.change !== 0 ? (d.percent !== null ? `${d.change > 0 ? "Up" : "Down"} ${Math.abs(d.percent)}% on the ${model.periodDays} days before.` : `${d.change > 0 ? "Up" : "Down"} ${Math.abs(d.change)} on the ${model.periodDays} days before.`) : "From forms, conversations, imports and contacts added by hand.";
    items.push({ key: "added", icon: <Ic.chart size={16}/>, title: `${model.added.count} new contact${model.added.count === 1 ? "" : "s"} in ${period}`, detail: trend });
  }
  const topSource = model.sources.find((row) => row.key !== "__none");
  if (topSource) items.push({ key: "source", icon: <Ic.users size={16}/>, title: `Largest source: ${sourceLabel(topSource.key)}`, detail: `${topSource.share}% of your contacts (${topSource.count.toLocaleString()}).` });
  const topTag = model.tags[0];
  if (topTag) items.push({ key: "tag", icon: <Ic.filter size={16}/>, title: `“${topTag.key}” is your largest tagged group`, detail: `${topTag.count.toLocaleString()} contacts, ${topTag.share}% of your audience.` });
  if (model.stale > 0) items.push({ key: "stale", icon: <Ic.bolt size={16}/>, title: `${model.stale.toLocaleString()} contact${model.stale === 1 ? " hasn’t" : "s haven’t"} heard from you in ${STALE_DAYS} days`, detail: `Or were never contacted, and joined over ${STALE_DAYS} days ago. Contacts who opted out or were disqualified are not counted.` });
  const next = model.stale > 0
    ? { text: `Draft a re-engagement message for the ${model.stale.toLocaleString()} contact${model.stale === 1 ? "" : "s"} you haven’t reached in ${STALE_DAYS} days.`, prompt: `I have ${model.stale} contacts I haven't contacted in ${STALE_DAYS} days or more (contacts who opted out are excluded). Draft a short, warm re-engagement message I could send them. Ask me what I want them to do next before you write it. Save it as a draft; do not send anything.` }
    : model.added.count > 0
      ? { text: `Draft a welcome message for the ${model.added.count} contact${model.added.count === 1 ? "" : "s"} who arrived in ${period}.`, prompt: `${model.added.count} new contacts joined in ${period}. Draft a short welcome message I could send them. Ask me what I want them to do next before you write it. Save it as a draft; do not send anything.` }
      : null;
  return { items, next };
}

export function MarketingAudience({ tenantId, onOpenClients }: { tenantId: string | null; onOpenClients: () => void }) {
  const read = useTenantRead(tenantId, NO_READ, readAudience);
  const [periodDays, setPeriodDays] = React.useState<number>(30);
  const [groupActive, setGroupActive] = React.useState<string | null>(null);
  const today = new Date().toDateString(); // re-derive when the day turns
  const model = React.useMemo(() => deriveAudience({ contacts: read.rows.contacts, reachableIds: read.rows.reachableIds, periodDays, capped: read.rows.capped }), [read.rows, periodDays, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const { items: insights, next } = audienceInsights(model);
  const c = model.capped;
  const slices = model.groups.map((group) => ({ key: group.key, label: GROUP_LABEL[group.key], count: group.count, colorToken: GROUP_TOKEN[group.key] }));
  const bars = model.stages.map((stage) => ({ key: stage.key, label: stageLabel(stage.key), count: stage.count, colorToken: STAGE_TOKEN(stage.key) }));
  const first = model.growth[0]?.total ?? 0;
  const last = model.growth[model.growth.length - 1]?.total ?? 0;
  const groups = model.tags.slice(0, 4);
  const askComposition = `Using only these figures from my Audience tab, tell me what stands out and one thing to do this week. Contacts: ${model.total}${c ? "+" : ""}. By stage group: ${model.groups.filter((g) => g.count).map((g) => `${GROUP_LABEL[g.key]} ${g.count}`).join(", ")}. Do not invent figures this tab does not show.`;

  return <div className="mk-view mo mp ma">
    <TabActions>
      <div className="campaigns-segmented" role="group" aria-label="Period">{AUDIENCE_PERIODS.map((days) => <button type="button" key={days} aria-pressed={periodDays === days} onClick={() => setPeriodDays(days)}>Last {days} days</button>)}</div>
      <button className="btn btn-s" onClick={onOpenClients}>Open Clients</button>
    </TabActions>
    <Frame phase={read.phase} retry={read.retry} noun="contacts">
      {model.total === 0 ? <section className="campaigns-surface"><div className="campaigns-state"><h2>No contacts yet</h2><p>Contacts arrive from your published forms, conversations and Clients. Once you have some, this tab shows who your marketing can reach.</p></div></section> : <>
        <div className="mo-stats ma-stats">
          <OverviewStat icon={<Ic.users size={18}/>} tone="is-violet" label="Total contacts" value={floor(model.total, c)} foot={<DeltaLine delta={model.totalDelta} periodDays={periodDays} against={`${periodDays} days ago`} fallback={c ? `Counted from your newest ${model.total.toLocaleString()}` : "All the contacts you can see"}/>}/>
          <OverviewStat icon={<Ic.plus size={18}/>} tone="is-aqua" label={`New, last ${periodDays} days`} value={floor(model.added.count, c)} foot={<DeltaLine delta={model.added.delta} periodDays={periodDays} fallback="No earlier period to compare"/>}/>
          <OverviewStat icon={<Ic.filter size={18}/>} tone="is-orange" label="Qualified" value={floor(model.qualified.count, c)} foot={<span className="mo-delta">{model.qualified.share}% of contacts</span>}/>
          <OverviewStat icon={<Ic.grid size={18}/>} tone="is-blue" label="Tagged" value={floor(model.tagged.count, c)} foot={<span className="mo-delta">{model.tagged.share}% carry a tag</span>}/>
          <OverviewStat icon={<Ic.mail size={18}/>} tone="is-violet" label="Reachable" value={floor(model.reachable.count, c)} foot={<span className="mo-delta">{model.reachable.share}% have an email or phone and can be contacted</span>}/>
          <OverviewStat icon={<Ic.send size={18}/>} tone="is-aqua" label={`Contacted, last ${periodDays} days`} value={floor(model.contacted.count, c)} foot={<span className="mo-delta">{model.contacted.share}% of contacts</span>}/>
        </div>

        <div className="mo-grid ma-grid-3">
          <section className="campaigns-surface mo-panel">
            <div className="mo-panel-head"><div><h2>Audience composition</h2><p>Contacts by where they stand with you.</p></div><div className="mo-panel-tools"><AskPaige prompt={askComposition}/></div></div>
            <div className="mo-split">
              <ChartBoundary className="mo-donut"><Donut slices={slices} total={floor(model.total, c)} caption="Contacts" label="Audience composition" activeKey={groupActive} onActiveKey={setGroupActive} onSelect={onOpenClients}/></ChartBoundary>
              <ul className="mo-keys">{slices.filter((slice) => slice.count > 0).map((slice) => <li key={slice.key}><button type="button" className={groupActive === slice.key ? "is-active" : ""} onMouseEnter={() => setGroupActive(slice.key)} onMouseLeave={() => setGroupActive(null)} onFocus={() => setGroupActive(slice.key)} onBlur={() => setGroupActive(null)} onClick={onOpenClients} aria-label={`${slice.label}: ${slice.count}. Open Clients`}><i style={{ background: `var(${slice.colorToken})` }} aria-hidden="true"/><span>{slice.label}</span><b>{floor(slice.count, c)}</b><em>{model.groups.find((g) => g.key === slice.key)?.share}%</em></button></li>)}</ul>
            </div>
          </section>
          <section className="campaigns-surface mo-panel">
            <div className="mo-panel-head"><div><h2>Lifecycle stages</h2><p>Where your contacts are in the journey.</p></div></div>
            <ChartBoundary className="mo-chart ma-chart-stages"><StageBars bars={bars} label="Contacts by lifecycle stage"/></ChartBoundary>
          </section>
          <section className="campaigns-surface mo-panel">
            <div className="mo-panel-head"><div><h2>Audience growth</h2><p>{c ? `Your newest ${model.total.toLocaleString()} contacts` : "The contacts you have today"}, by the day each was added.</p></div>{last > first && <span className="mo-delta is-up ma-growth-badge"><Ic.arrow size={12}/>+{(last - first).toLocaleString()}</span>}</div>
            <ChartBoundary className="mo-chart ma-chart-growth"><GrowthArea points={model.growth} label={`Contacts over the last ${periodDays} days`}/></ChartBoundary>
          </section>
        </div>

        <div className="mo-grid ma-grid-3">
          <section className="campaigns-surface mo-panel">
            <div className="mo-panel-head"><div><h2>Source attribution</h2><p>Where your contacts came from.</p></div></div>
            <Shares rows={model.sources} label={sourceLabel} empty="No sources recorded."/>
          </section>
          <section className="campaigns-surface mo-panel">
            <div className="mo-panel-head"><div><h2>Tags &amp; topics</h2><p>{model.tagCount > 8 ? `The 8 most used of ${model.tagCount} tags.` : "The tags on your contacts."}</p></div></div>
            <Shares rows={model.tags.slice(0, 8)} label={(key) => key} empty="No contact carries a tag yet. Add tags in Clients to group people."/>
          </section>
          <section className="campaigns-surface mo-panel ma-insights">
            <div className="mo-panel-head"><div><h2>What PAIGE sees</h2><p>Read from the figures on this page.</p></div></div>
            {insights.length ? <ul className="ma-insight-list">{insights.map((item) => <li key={item.key}><span className="ma-insight-plate" aria-hidden="true">{item.icon}</span><span className="mp-list-main"><strong>{item.title}</strong><small>{item.detail}</small></span></li>)}</ul>
              : <p className="mo-note">Nothing stands out yet. As contacts arrive, PAIGE notes what changes here.</p>}
            {next && <div className="mo-next ma-next"><span className="mo-next-plate" aria-hidden="true"><Ic.spark size={16}/></span><div><h2>Next best action</h2><p>{next.text}</p></div><AskPaigeButton label="Ask PAIGE" prompt={next.prompt}/></div>}
          </section>
        </div>

        <div className="mo-grid mp-grid mp-grid-2">
          <section className="campaigns-surface mo-panel">
            <div className="mo-panel-head"><div><h2>Your largest tagged groups</h2><p>Your most used tags. Ask PAIGE to draft a message for one; nothing is sent.</p></div></div>
            {groups.length ? <ul className="mp-list">{groups.map((tag) => <li key={tag.key} className="ma-group"><span className="mp-list-main"><strong>{tag.key}</strong><small>{tag.count.toLocaleString()} contact{tag.count === 1 ? "" : "s"}</small></span><AskPaigeButton label="Draft a message" prompt={`Draft a short message for my ${tag.count} contacts tagged "${tag.key}". Ask me what I want them to do before you write it. Save it as a draft; do not send anything.`}/></li>)}</ul>
              : <p className="mo-note">Tag contacts in Clients to see groups here.</p>}
          </section>
          <NotYet items={[
            { title: "Saved audiences and segments", detail: "There is nowhere to save a group of contacts by rule yet, so campaigns cannot target one." },
            { title: "A contact's tracking tag", detail: "A lead's source tag stays on its form submission (see Analytics); it is not copied onto the contact yet." },
          ]}/>
        </div>
      </>}
    </Frame>
  </div>;
}
