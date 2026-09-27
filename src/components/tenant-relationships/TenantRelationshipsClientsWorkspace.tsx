import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Tag,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { RoleGate } from "@/components/auth/RoleGate";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import type { RouteTierKey } from "@/lib/routing/tierBranches";
import {
  useTenantRelationshipsData,
  type RelationshipWorkspaceVariant,
} from "./useTenantRelationshipsData";
import {
  relationshipWorkspaceVariant,
  workspaceTabs,
  type WorkspaceTab,
} from "./workspaceModel";
import { TenantCanonicalCalendarWorkspace } from "@/components/tenant-calendar/TenantCanonicalCalendarWorkspace";
import { PeopleContactEditor } from "./PeopleContactEditor";
import "./tenant-relationships-clients-workspace.css";

const CanonicalConversations = lazy(() => import("@/pages/admin/ClientsConversations"));
const CanonicalCalendar = lazy(() => import("@/pages/admin/CalendarAdmin"));
const PortalStudio = lazy(() => import("@/pages/admin/PortalStudio"));
const ContactPortalAccess = lazy(() => import("@/components/admin/contacts/ContactPortalPanel").then((module) => ({ default: module.ContactPortalPanel })));

function ProofPill({ children, tone = "partial" }: { children: string; tone?: "live" | "partial" | "unavailable" }) {
  return <span className="trc-proof" data-tone={tone}>{children}</span>;
}

function BoundedState({
  eyebrow,
  title,
  detail,
  kind,
  onRetry,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  kind: "loading" | "empty" | "error" | "partial" | "unavailable";
  onRetry?: () => void;
}) {
  const role = kind === "error" ? "alert" : "status";
  return (
    <section className="trc-state" data-state={kind} role={role}>
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          <RefreshCw aria-hidden /> Retry
        </button>
      )}
    </section>
  );
}

function formatDate(value: string | null, fallback = "Not recorded") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recorded" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function TenantRelationshipsClientsWorkspace({
  routeTier,
  openPaige,
}: {
  routeTier: Extract<RouteTierKey, "agency" | "enterprise" | "solo" | "sub_account">;
  openPaige: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const soloClientRoute = /^\/solo\/([^/]+)\/clients(?:\/|$)/.exec(location.pathname);
  const { activeTenantId, activeTenant, accountContextLoading, refresh } = useTenantContext();
  const variant = relationshipWorkspaceVariant(activeTenant?.account_type, activeTenant?.parent_tenant_id);
  const tabs = workspaceTabs(variant);
  const [routeTab, setRouteTab] = useSubtabRoute(routeTier, "clients", "people");
  const activeTab = tabs.some(({ id }) => id === routeTab) ? routeTab as WorkspaceTab : null;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const previousTenantId = useRef(activeTenantId);
  const accountIsChanging = previousTenantId.current !== activeTenantId;
  const deepLinkedContactId = routeTier === "solo" && !accountIsChanging ? searchParams.get("person") : null;
  const data = useTenantRelationshipsData({
    activeTenantId,
    variant,
    soloPeople: routeTier === "solo" && variant === "clients",
    deepLinkedContactId,
  });
  const calendarReturnAddress = location.pathname;

  useEffect(() => {
    if (previousTenantId.current === activeTenantId) return;
    const clearSalesOrigin = routeTier === "solo" && !!previousTenantId.current && searchParams.get("origin") === "sales";
    previousTenantId.current = activeTenantId;
    setSelectedContactId(null);
    if (!searchParams.has("person") && !clearSalesOrigin) return;
    const next = new URLSearchParams(searchParams);
    next.delete("person");
    if (clearSalesOrigin) next.delete("origin");
    setSearchParams(next, { replace: true });
  }, [activeTenantId, searchParams, setSearchParams, routeTier]);

  const selectSoloContact = (id: string) => {
    setSelectedContactId(id);
    const next = new URLSearchParams(searchParams);
    next.set("person", id);
    setSearchParams(next, { replace: true });
  };

  const clearSoloContact = () => {
    setSelectedContactId(null);
    const next = new URLSearchParams(searchParams);
    next.delete("person");
    setSearchParams(next, { replace: true });
  };

  const onTabKeyDown = (index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setRouteTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  };

  if (accountContextLoading) {
    return <BoundedState eyebrow="Resolving account context" title="Loading this workspace" detail="No relationship data appears until the authenticated account is accepted." kind="loading" />;
  }

  if (!activeTenantId || !activeTenant) {
    return <BoundedState eyebrow="Account context required" title="We couldn't resolve this workspace" detail="Relationship data stays blocked until the authenticated account context is available." kind="error" onRetry={() => void refresh()} />;
  }

  const workspaceName = variant === "relationships" ? "Relationships" : "Clients";
  const soloPeople = routeTier === "solo" && variant === "clients" && activeTab === "people";
  const soloConversations = routeTier === "solo" && variant === "clients" && activeTab === "conversations";
  const soloCalendar = routeTier === "solo" && activeTab === "calendar";
  const proof = activeTab === null
    ? { label: "View · UNAVAILABLE", tone: "unavailable" as const }
    : activeTab === "segments"
    ? { label: "Segments · UNAVAILABLE", tone: "unavailable" as const }
    : activeTab === "people" && variant === "relationships"
      ? { label: "People · UNAVAILABLE", tone: "unavailable" as const }
      : activeTab === "people" && routeTier === "solo"
        ? { label: "People · LIVE", tone: "live" as const }
      : { label: `${tabs.find(({ id }) => id === activeTab)?.label ?? workspaceName} · PARTIAL`, tone: "partial" as const };

  return (
    <section className={`trc-workspace${soloPeople ? " trc-workspace--people" : ""}${soloConversations ? " trc-workspace--conversations" : ""}${soloCalendar ? " trc-workspace--calendar" : ""}`} data-relationship-workspace data-variant={variant}>
      {routeTier === "solo" && soloClientRoute && !(previousTenantId.current && accountIsChanging) && searchParams.get("origin") === "sales" && (
        <div className="trc-sales-return" style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:8,padding:"8px 18px",flexShrink:0,borderBottom:"1px solid var(--pg-line)"}}>
          <button type="button" className="btn btn-s btn-p" onClick={() => navigate(`/solo/${soloClientRoute[1]}/growth/sales?resume=terms`)}>Return to commercial terms</button>
          <span>Create or choose a client here, then return to select them in Sales.</span>
        </div>
      )}
      {!soloCalendar && !soloPeople && !soloConversations && (
        <header className="trc-heading">
          <div>
            <span>{workspaceName} · {activeTenant.name}</span>
            <h1>{variant === "relationships" ? "The relationship book" : "Your client book"}</h1>
            <p>{variant === "relationships"
              ? "People and activity across the server-authorized book, with ownership intact."
              : "One trustworthy record for every client relationship this account serves."}</p>
          </div>
          <ProofPill tone={proof.tone}>{proof.label}</ProofPill>
        </header>
      )}

      <div className={`trc-tabs${soloPeople ? " trc-tabs--people" : ""}${soloConversations ? " trc-tabs--conversations" : ""}`} role="tablist" aria-label={`${workspaceName} views`}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => { tabRefs.current[index] = node; }}
            id={`trc-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls="trc-panel"
            tabIndex={activeTab === tab.id || (activeTab === null && index === 0) ? 0 : -1}
            onClick={() => setRouteTab(tab.id)}
            onKeyDown={(event) => onTabKeyDown(index, event)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id="trc-panel"
        className={`trc-panel${soloPeople ? " trc-panel--people" : ""}${soloConversations ? " trc-panel--conversations" : ""}${soloCalendar ? " trc-panel--calendar" : ""}`}
        role="tabpanel"
        aria-labelledby={activeTab ? `trc-tab-${activeTab}` : undefined}
        aria-label={activeTab ? undefined : "Unavailable relationship view"}
        tabIndex={0}
      >
        {activeTab === null && <BoundedState eyebrow="View · UNAVAILABLE" title="This view is not available in the active account context" detail="The address is preserved, but no different account capability is substituted in its place." kind="unavailable" />}
        {activeTab === "people" && (
          routeTier === "solo" && variant === "clients"
            ? <SoloPeopleView
                key={activeTenantId}
                activeTenantId={activeTenantId}
                data={data}
                openPaige={openPaige}
                selectedContactId={selectedContactId}
                deepLinkedContactId={deepLinkedContactId}
                onSelectContact={selectSoloContact}
                onClearContact={clearSoloContact}
              />
            : <PeopleView key={activeTenantId} variant={variant} data={data} openPaige={openPaige} selectedContactId={selectedContactId} onSelectContact={setSelectedContactId} />
        )}
        {activeTab === "conversations" && (
          <ConversationsView variant={variant} data={data} openPaige={openPaige} activeTenantId={activeTenantId} />
        )}
        {activeTab === "calendar" && <CalendarLens key={activeTenantId} routeTier={routeTier} activeTenantId={activeTenantId} returnAddress={calendarReturnAddress} openPaige={openPaige} />}
        {activeTab === "segments" && <SegmentsView />}
        {activeTab === "portal" && <PortalView key={activeTenantId} activeTenantId={activeTenantId} data={data} selectedContactId={selectedContactId} />}
      </div>
    </section>
  );
}

function PeopleView({ variant, data, openPaige, selectedContactId, onSelectContact }: { variant: RelationshipWorkspaceVariant; data: ReturnType<typeof useTenantRelationshipsData>; openPaige: () => void; selectedContactId: string | null; onSelectContact: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const people = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.people;
    return data.people.filter((person) => [person.name, person.company, person.email, person.relationship, person.owner]
      .some((value) => value?.toLowerCase().includes(query)));
  }, [data.people, search]);
  const selected = people.find(({ id }) => id === selectedContactId) ?? null;
  if (!data.peopleAvailable) return <BoundedState eyebrow="People · UNAVAILABLE" title="Book-wide People are not connected" detail="The existing parent roster contains Sub-accounts, not people. A server-authorized parent People contract is required before this view can show records across the book." kind="unavailable" />;
  if (data.peopleLoading) return <BoundedState eyebrow="People · LIVE" title="Loading the authorized book" detail="The previous account is cleared while this account resolves." kind="loading" />;
  if (data.peopleError) return <BoundedState eyebrow="People · UNAVAILABLE" title="We couldn't load People" detail="No count or relationship state is inferred from a failed read." kind="error" onRetry={() => void data.retryPeople()} />;
  if (!data.people.length) return <BoundedState eyebrow="People · LIVE" title="No people here yet" detail="The active account returned no records. No sample contacts replace that result." kind="empty" />;
  return (
    <div className="trc-people-surface">
      <div className="trc-toolbar">
        <label><span className="sr-only">Search people</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people, company, email…" /></label>
        <button type="button" disabled>Filters</button>
        <button type="button" disabled>Add person</button>
      </div>
      <div className="trc-people-grid">
      <section className="trc-card trc-table-card">
        <table>
          <thead><tr><th>Person</th><th>Relationship</th><th>Owner</th><th>Last touch</th></tr></thead>
          <tbody>{people.map((person) => (
            <tr key={person.id} data-selected={selected?.id === person.id ? "true" : "false"}>
              <td><button type="button" className="trc-person-select" aria-pressed={selected?.id === person.id} onClick={() => onSelectContact(person.id)}><strong>{person.name}</strong><small>{person.company || person.email || "Authorized contact"}</small></button></td>
              <td>{person.relationship}</td>
              <td>{person.owner}</td>
              <td>{formatDate(person.lastTouch)}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      <aside className="trc-card trc-detail-card">
        <UserRound aria-hidden />
        <h2>{selected?.name ?? "Select a person"}</h2>
        <p>{selected ? `${selected.relationship} · ${selected.owner}` : "Choose an authorized record to inspect its relationship context."}</p>
        {selected?.email && <span>{selected.email}</span>}
        {selected?.company && <span>{selected.company}</span>}
        <button type="button" onClick={openPaige}>Ask PAIGE about this view</button>
      </aside>
      </div>
    </div>
  );
}

function SoloPeopleView({
  activeTenantId,
  data,
  openPaige,
  selectedContactId,
  deepLinkedContactId,
  onSelectContact,
  onClearContact,
}: {
  activeTenantId: string;
  data: ReturnType<typeof useTenantRelationshipsData>;
  openPaige: () => void;
  selectedContactId: string | null;
  deepLinkedContactId: string | null;
  onSelectContact: (id: string) => void;
  onClearContact: () => void;
}) {
  const [search, setSearch] = useState("");
  const [editorContact, setEditorContact] = useState<ReturnType<typeof useTenantRelationshipsData>["people"][number] | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [recordLayout, setRecordLayout] = useState<"docked" | "overlay">("docked");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastSelectedId = useRef<string | null>(null);
  const restoreFocusId = useRef<string | null>(null);
  const dismissedDeepLinkId = useRef<string | null>(null);
  const focusedSelectedId = useRef<string | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const editorOriginRef = useRef<string | null>(null);
  const restoreEditorOriginRef = useRef<string | null>(null);
  const deepLinked = deepLinkedContactId
    ? data.people.find(({ id }) => id === deepLinkedContactId) ?? data.deepLinkedPerson ?? null
    : null;
  const deepLinkDismissed = Boolean(deepLinkedContactId && dismissedDeepLinkId.current === deepLinkedContactId);
  const selected = deepLinkedContactId
    ? (deepLinkDismissed ? null : deepLinked)
    : data.people.find(({ id }) => id === selectedContactId) ?? null;

  useEffect(() => {
    setEditorOpen(false);
    setEditorContact(null);
    editorOriginRef.current = null;
    restoreEditorOriginRef.current = null;
  }, [activeTenantId]);

  const query = search.trim().toLowerCase();
  const people = useMemo(() => {
    if (!query) return data.people;
    return data.people.filter((person) => [person.name, person.company, person.email, person.phone, person.relationship, person.owner, person.source, ...person.tags]
      .some((value) => value?.toLowerCase().includes(query)));
  }, [data.people, query]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const updateLayout = (width: number) => setRecordLayout(window.innerWidth < 1190 || width < 720 ? "overlay" : "docked");
    const measure = () => updateLayout(workspace.getBoundingClientRect().width || workspace.clientWidth);
    measure();
    // The shell animates its grid tracks after this view mounts. Keep one
    // bounded post-transition measurement so form-fit remains correct in
    // browsers or controllers that do not expose observer APIs.
    const settleTimer = window.setTimeout(measure, 260);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(([entry]) => updateLayout(entry?.contentRect.width ?? workspace.clientWidth));
    const shell = workspace.closest<HTMLElement>("[data-tenant-shell]");
    const shellObserver = typeof MutationObserver === "undefined" || !shell
      ? null
      : new MutationObserver(measure);
    const handleShellTransition = (event: TransitionEvent) => {
      if (event.target === shell && event.propertyName === "grid-template-columns") measure();
    };
    observer?.observe(workspace);
    shellObserver?.observe(shell, { attributes: true, attributeFilter: ["data-nav", "data-paige"] });
    shell?.addEventListener("transitionend", handleShellTransition);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      shellObserver?.disconnect();
      shell?.removeEventListener("transitionend", handleShellTransition);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const covered = Boolean(selected && recordLayout === "overlay");
    if (covered && list.contains(document.activeElement)) backRef.current?.focus();
    list.inert = covered;
  }, [recordLayout, selected]);

  useEffect(() => {
    if (!deepLinkedContactId) dismissedDeepLinkId.current = null;
  }, [deepLinkedContactId]);

  useEffect(() => {
    if (deepLinkDismissed || !deepLinked || selectedContactId === deepLinked.id) return;
    onSelectContact(deepLinked.id);
  }, [deepLinkDismissed, deepLinked, onSelectContact, selectedContactId]);

  const setBackButton = (node: HTMLButtonElement | null) => {
    backRef.current = node;
    if (!node) return;
    const selectedId = selected?.id ?? null;
    if (selectedId && focusedSelectedId.current !== selectedId) node.focus();
    focusedSelectedId.current = selectedId;
  };

  useEffect(() => {
    if (selected || !restoreFocusId.current) return;
    const id = restoreFocusId.current;
    restoreFocusId.current = null;
    queueMicrotask(() => (rowRefs.current.get(id) ?? searchRef.current)?.focus());
  }, [selected]);

  useEffect(() => {
    if (editorOpen || !restoreEditorOriginRef.current) return;
    const origin = restoreEditorOriginRef.current;
    restoreEditorOriginRef.current = null;
    queueMicrotask(() => workspaceRef.current?.querySelector<HTMLButtonElement>(`[data-contact-editor-origin="${origin}"]`)?.focus());
  }, [editorOpen]);

  const selectPerson = (id: string) => {
    dismissedDeepLinkId.current = null;
    lastSelectedId.current = id;
    onSelectContact(id);
  };

  const returnToList = () => {
    dismissedDeepLinkId.current = deepLinkedContactId;
    restoreFocusId.current = lastSelectedId.current ?? selected?.id ?? null;
    focusedSelectedId.current = null;
    onClearContact();
  };

  if (!data.peopleAvailable) return <BoundedState eyebrow="People · UNAVAILABLE" title="People are not connected" detail="A server-authorized People contract is required before records can appear." kind="unavailable" />;
  if (data.peopleLoading) return <BoundedState eyebrow="People · LIVE" title="Loading the authorized book" detail="The previous account and selected record are cleared while this account resolves." kind="loading" />;
  if (data.peopleError) return <BoundedState eyebrow="People · UNAVAILABLE" title="We couldn't load People" detail="No count, record, or relationship state is inferred from a failed read." kind="error" onRetry={() => void data.retryPeople()} />;
  const staleDeepLink = Boolean(deepLinkedContactId && !selected && !data.deepLinkLoading);
  const openNewContact = (event: React.MouseEvent<HTMLButtonElement>) => {
    editorOriginRef.current = event.currentTarget.dataset.contactEditorOrigin ?? null;
    setEditorContact(null);
    setEditorOpen(true);
  };
  const openEditContact = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!selected) return;
    editorOriginRef.current = event.currentTarget.dataset.contactEditorOrigin ?? null;
    setEditorContact(selected);
    setEditorOpen(true);
  };
  const changeEditorOpen = (next: boolean) => {
    if (!next) restoreEditorOriginRef.current = editorOriginRef.current;
    setEditorOpen(next);
  };
  const handleSaved = async (contactId: string) => {
    await data.retryPeople();
    selectPerson(contactId);
  };

  if (editorOpen) {
    return (
      <section
        ref={workspaceRef}
        className="trc-solo-people"
        data-solo-client-record
        data-contact-editor-active="true"
        data-record-selected="false"
        data-record-layout={recordLayout}
        data-active-tenant={activeTenantId}
        aria-label="People contact editor workspace"
      >
        <PeopleContactEditor
          open
          onOpenChange={changeEditorOpen}
          tenantId={activeTenantId}
          contact={editorContact}
          onSaved={handleSaved}
        />
      </section>
    );
  }

  return (
    <section
      ref={workspaceRef}
      className="trc-solo-people"
      data-solo-client-record
      data-record-selected={selected ? "true" : "false"}
      data-record-layout={recordLayout}
      data-active-tenant={activeTenantId}
      aria-label="People client relationship workspace"
    >
      <header className="trc-people-toolbar">
        <div>
          <h1>People</h1>
          <small>{data.people.length} {data.people.length === 1 ? "client" : "clients"} · Tenant read · LIVE</small>
        </div>
        <label>
          <span className="sr-only">Search people</span>
          <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, company, email, phone, tag…" />
        </label>
        <span className="trc-people-actions">
          {search && <button type="button" onClick={() => setSearch("")}>Clear search</button>}
          <RoleGate allow={["admin"]} fallback={<ProofPill>Read only</ProofPill>}>
            <button type="button" data-contact-editor-origin="toolbar-new" onClick={openNewContact}><Plus aria-hidden /> New contact</button>
          </RoleGate>
        </span>
      </header>

      {staleDeepLink && (
        <div className="trc-record-notice" role="status">
          <div><strong>Client record unavailable</strong><span>This record is missing, unavailable to this account, or could not be resolved.</span></div>
          <button type="button" onClick={onClearContact}>Return to the People list</button>
        </div>
      )}

      <div className="trc-client-workspace">
        <section
          ref={listRef}
          className="trc-client-list"
          aria-labelledby="trc-client-list-title"
        >
          <header>
            <div><h2 id="trc-client-list-title">Loaded clients</h2><span>{people.length} of {data.people.length}</span></div>
            <p aria-live="polite">{query ? `${people.length} search result${people.length === 1 ? "" : "s"}` : `${people.length} loaded authorized record${people.length === 1 ? "" : "s"}`}</p>
          </header>
          {people.length ? (
            <div className="trc-client-rows" role="list">
              {people.map((person) => (
                <div key={person.id} role="listitem">
                  <button
                    ref={(node) => {
                      if (node) rowRefs.current.set(person.id, node);
                      else rowRefs.current.delete(person.id);
                    }}
                    type="button"
                    className="trc-person-select"
                    data-selected={selected?.id === person.id ? "true" : "false"}
                    aria-current={selected?.id === person.id ? "true" : undefined}
                    aria-label={`Open record for ${person.name}`}
                    onClick={() => selectPerson(person.id)}
                  >
                    <span className="trc-client-avatar" aria-hidden>{person.recordType === "business" ? <Building2 /> : <UserRound />}</span>
                    <span><strong>{person.name}</strong><small>{person.company || person.email || (person.recordType === "business" ? "Business client" : "Person client")}</small></span>
                    <span><small>{person.relationship}</small><small>{person.owner} · {formatDate(person.lastTouch, "No recorded touch")}</small></span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="trc-search-empty" role="status">
              <strong>{query ? "No matching people" : "No people here yet"}</strong>
              <span>{query ? "The loaded list is unchanged. Clear search to see every loaded record." : "Create the first tenant-scoped Person or Business record."}</span>
              {query ? <button type="button" onClick={() => setSearch("")}>Clear search</button> : (
                <RoleGate allow={["admin"]} fallback={<ProofPill>Read only</ProofPill>}>
                  <button type="button" data-contact-editor-origin="empty-new" onClick={openNewContact}><Plus aria-hidden /> New contact</button>
                </RoleGate>
              )}
            </div>
          )}
        </section>

        <section className="trc-client-record" aria-labelledby="trc-record-title">
          {selected ? (
            <ClientRecord
              person={selected}
              backRef={setBackButton}
              onBack={returnToList}
              openPaige={openPaige}
              onEdit={openEditContact}
            />
          ) : (
            <div className="trc-record-empty">
              <UserRound aria-hidden />
              <span>Client record</span>
              <h2 id="trc-record-title">Choose a client</h2>
              <p>{data.people.length ? "Select an authorized Person or Business record while keeping the People list in place." : "Create the first authorized contact without leaving People."}</p>
              <div><ProofPill tone="live">Read and selection · LIVE</ProofPill><ProofPill>Record depth · PARTIAL</ProofPill></div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function ClientRecord({
  person,
  backRef,
  onBack,
  openPaige,
  onEdit,
}: {
  person: ReturnType<typeof useTenantRelationshipsData>["people"][number];
  backRef: (node: HTMLButtonElement | null) => void;
  onBack: () => void;
  openPaige: () => void;
  onEdit: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const isBusiness = person.recordType === "business";
  return (
    <div className="trc-record-scroll">
      <header className="trc-record-header">
        <button ref={backRef} type="button" className="trc-record-back" aria-label="Back to People list" onClick={onBack}><ArrowLeft aria-hidden /> People</button>
        <div className="trc-record-identity">
          <span className="trc-record-avatar" aria-hidden>{isBusiness ? <Building2 /> : <UserRound />}</span>
          <div>
            <h2 id="trc-record-title">{person.name}</h2>
            <p>{[isBusiness ? "Business profile" : "Person profile", person.title, !isBusiness ? person.company : null, "PARTIAL", "derived"].filter(Boolean).join(" · ")}</p>
          </div>
          <ProofPill tone="live">Record · LIVE</ProofPill>
        </div>
        <div className="trc-record-actions">
          <RoleGate allow={["admin"]} fallback={null}>
            <button type="button" data-contact-editor-origin="record-edit" onClick={onEdit}><Pencil aria-hidden /> Edit contact</button>
          </RoleGate>
          <button type="button" onClick={openPaige}><Sparkles aria-hidden /> Open PAIGE workspace</button>
          <span>Enrichment · UNAVAILABLE</span>
        </div>
      </header>

      <div className="trc-record-body">
        <section className="trc-record-section">
          <header><div><span>Overview</span><h3>Relationship overview</h3></div><ProofPill>Standard fields · PARTIAL</ProofPill></header>
          <dl className="trc-facts">
            <div><dt>Relationship</dt><dd>{person.relationship}</dd></div>
            <div><dt>Owner</dt><dd>{person.owner}</dd></div>
            <div><dt>Status</dt><dd>{person.status}</dd></div>
            <div><dt>Source</dt><dd>{person.source || "Not recorded"}</dd></div>
            <div><dt>Last touch</dt><dd>{formatDate(person.lastTouch, "No recorded touch")}</dd></div>
            <div><dt>Updated</dt><dd>{formatDate(person.updatedAt)}</dd></div>
          </dl>
          {person.tags.length > 0 && <div className="trc-tags" aria-label="Client tags"><Tag aria-hidden />{person.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        </section>

        <section className="trc-record-section">
          <header><div><span>Identity</span><h3>{isBusiness ? "Organization details" : "Contact details"}</h3></div><ProofPill tone="live">Owner-editable · LIVE</ProofPill></header>
          <div className="trc-contact-lines">
            <div><Mail aria-hidden /><span><small>Email</small>{person.email || "Not recorded"}</span></div>
            <div><Phone aria-hidden /><span><small>Phone</small>{person.phone || "Not recorded"}</span></div>
            <div><MapPin aria-hidden /><span><small>Location</small>{person.location || "Not recorded"}</span></div>
            <div><Building2 aria-hidden /><span><small>Company</small>{person.company || "Not recorded"}</span></div>
            <div><ExternalLink aria-hidden /><span><small>Website</small>{person.website || "Not recorded"}</span></div>
            <div><ExternalLink aria-hidden /><span><small>LinkedIn</small>{person.linkedinUrl || "Not recorded"}</span></div>
            <div><MapPin aria-hidden /><span><small>Street address</small>{person.streetAddress || "Not recorded"}</span></div>
            <div><Tag aria-hidden /><span><small>Primary offer</small>{person.primaryOffer || "Not recorded"}</span></div>
          </div>
          {person.notes && <div className="trc-inline-state"><strong>Internal relationship notes</strong><span>{person.notes}</span></div>}
          {isBusiness && <div className="trc-inline-state"><strong>Related people · PARTIAL</strong><span>A relationship seam exists, but this workspace does not infer or join records.</span></div>}
        </section>

        {!isBusiness && (
          <section className="trc-record-section">
            <header><div><span>Customer experience</span><h3>Relationship intelligence</h3></div><ProofPill tone="unavailable">Governed details · UNAVAILABLE</ProofPill></header>
            <div className="trc-governed-grid">
              <article><strong>Birthday reminders</strong><span>Month/day or full-date collection needs a purpose, source, timezone, consent, reminder choice, and deletion contract.</span></article>
              <article><strong>Family context</strong><span>Optional, minimized context needs purpose labeling, access controls, correction, and removal.</span></article>
              <article><strong>Preferences and interests</strong><span>Useful service context needs provenance, visibility, retention, and analytics boundaries.</span></article>
              <article><strong>Relationship notes</strong><span>Notes must stay purposeful, bounded by visibility, and excluded from indiscriminate analytics.</span></article>
            </div>
          </section>
        )}

        <section className="trc-record-section">
          <header><div><span>Owned capabilities</span><h3>Relationship connections</h3></div><ProofPill>Canonical handoffs</ProofPill></header>
          <div className="trc-capability-list">
            <article><div><strong>Conversations · PARTIAL</strong><span>The canonical Conversations owner remains the only inbox. Selected-client context handoff is not yet proven.</span></div></article>
            <article><div><strong>Campaigns owns pipeline · PARTIAL</strong><span>No stage, campaign membership, product association, or assignment is inferred here.</span></div></article>
            <article><div><strong>Portal access · PARTIAL</strong><span>Configuration and invitations remain in existing Portal owners; this record does not prove their role gates.</span></div></article>
            <article><div><strong>Client files · PARTIAL</strong><span>The existing client-files seam remains separate from the business Vault; upload is not exposed here.</span></div></article>
          </div>
        </section>

        <section className="trc-record-section">
          <header><div><span>Governance</span><h3>Data boundaries</h3></div><ProofPill tone="unavailable">Contract incomplete</ProofPill></header>
          <div className="trc-governance-list">
            <div><strong>Tenant custom fields · PARTIAL</strong><span>Definitions and values exist, but purpose, applicability, role visibility, PAIGE use, analytics use, and retention controls are incomplete.</span></div>
            <div><strong>Unified activity · UNAVAILABLE</strong><span>Conversations, Calendar, tasks, campaigns, Portal activity, and notes are not joined into a factual timeline.</span></div>
            <div><strong>Export, correction, deletion, retention, and history · UNAVAILABLE</strong><span>No governed client-record lifecycle contract is proven on this surface.</span></div>
            <div><strong>PAIGE enrichment · UNAVAILABLE</strong><span>No automatic write occurs. Source review, confidence, purpose, visibility, retention, and separate Ask First decisions require an authorized contract.</span></div>
          </div>
        </section>

        <footer className="trc-record-footer"><FileText aria-hidden /><span>Created {formatDate(person.createdAt)} · Contact preference {person.doNotContact ? "do-not-contact flag recorded" : "no do-not-contact flag recorded"} · Shared PAIGE context {person.sharedContextConsent ? "consent flag recorded" : "no consent flag recorded"}</span></footer>
      </div>
    </div>
  );
}

function ConversationsView({ variant, openPaige, activeTenantId }: { variant: RelationshipWorkspaceVariant; data: ReturnType<typeof useTenantRelationshipsData>; openPaige: () => void; activeTenantId: string }) {
  if (variant === "relationships") {
    return <BoundedState eyebrow="Conversations · UNAVAILABLE" title="Book-wide threads are not connected" detail="A parent-authorized aggregate is required before PAIGE can show conversations across Sub-accounts. No child inboxes are joined in the browser." kind="unavailable" />;
  }
  return (
    <div className="trc-conversations" data-canonical-conversations>
      <header><div><span>Clients · Conversations</span><h2>Client conversations</h2><p>The existing tenant inbox remains the one canonical thread, composer, and relationship surface.</p></div><button type="button" onClick={openPaige}>Draft with PAIGE</button></header>
      <Suspense fallback={<BoundedState eyebrow="Conversations · PARTIAL" title="Loading canonical Conversations" detail="Only the active account's RLS-authorized inbox is mounted." kind="loading" />}>
        <CanonicalConversations key={activeTenantId} />
      </Suspense>
    </div>
  );
}

function CalendarLens({ routeTier, activeTenantId, returnAddress, openPaige }: {
  routeTier: Extract<RouteTierKey, "agency" | "enterprise" | "solo" | "sub_account">;
  activeTenantId: string;
  returnAddress: string;
  openPaige: () => void;
}) {
  const [fullCalendarOpen, setFullCalendarOpen] = useState(false);
  if (routeTier === "solo") {
    return (
      <div className="trc-canonical-mount trc-canonical-mount--direct" data-calendar-owner="clients" data-return-address={returnAddress}>
        <TenantCanonicalCalendarWorkspace tier="solo" owner="clients" openPaige={openPaige} />
      </div>
    );
  }
  return (
    <div className="trc-calendar-lens">
      <div className="trc-two-column">
      <BoundedState eyebrow="Calendar · PARTIAL" title="Relationship association is not yet provable" detail="The canonical Calendar is live, but its current booking contract does not carry a trusted relationship identifier. No events are matched by name or email." kind="partial" />
      <aside className="trc-card trc-detail-card">
        <CalendarDays aria-hidden />
        <h2>One Calendar, one source of truth</h2>
        <p>Create and edit work remains in the canonical Calendar. The active account tree is preserved when you open it.</p>
        <button type="button" onClick={() => setFullCalendarOpen((open) => !open)}>{fullCalendarOpen ? "Close full Calendar" : "Open full Calendar"} <ArrowRight aria-hidden /></button>
      </aside>
      </div>
      {fullCalendarOpen && (
        <div className="trc-canonical-mount" data-canonical-calendar data-return-address={returnAddress}>
          <Suspense fallback={<BoundedState eyebrow="Calendar · LIVE OWNER" title="Loading canonical Calendar" detail="The authenticated active account remains unchanged while the Calendar owner mounts." kind="loading" />}>
            <CanonicalCalendar key={activeTenantId} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

function SegmentsView() {
  return (
    <div className="trc-two-column">
      <BoundedState eyebrow="Segments · UNAVAILABLE" title="Saved segment evaluation is not connected" detail="Definitions, allowlisted rules, membership evaluation, coverage, and counts require a server-authorized book-scoped contract." kind="unavailable" />
      <aside className="trc-card trc-detail-card">
        <UsersRound aria-hidden />
        <h2>Explicit parent scope</h2>
        <p>Segments will group People in the authorized book. They will not expose sales stages, campaign execution, or a browser-built cross-account rollup.</p>
      </aside>
    </div>
  );
}

function PortalView({ activeTenantId, data, selectedContactId }: { activeTenantId: string; data: ReturnType<typeof useTenantRelationshipsData>; selectedContactId: string | null }) {
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const selectedContact = data.people.find(({ id }) => id === selectedContactId) ?? null;
  if (data.portalLoading) return <BoundedState eyebrow="Portal · PARTIAL" title="Loading Portal configuration" detail="The previous account's configuration is not reused while this account resolves." kind="loading" />;
  if (data.portalError) return <BoundedState eyebrow="Portal · UNAVAILABLE" title="We couldn't load Portal configuration" detail="Client access and configuration remain blocked until the scoped read succeeds." kind="error" onRetry={() => void data.retryPortal()} />;
  return (
    <section className="trc-portal">
      <header>
        <div><span>Clients · Portal</span><h2>One relationship. Two authorized views.</h2><p>Staff supervise the same client-visible objects without receiving a client session or exposing internal material.</p></div>
        <ProofPill>Configuration substrate · LIVE</ProofPill>
      </header>
      <div className="trc-audience">
        <section><small>Shared with client</small><strong>Approved messages, requests, decisions, progress, and deliverables</strong></section>
        <section><small>Internal team</small><strong>Private notes, supervision, and escalation controls</strong></section>
        <section><small>Restricted system evidence</small><strong>PAIGE reasoning, source evidence, and Trust configuration</strong></section>
      </div>
      <div className="trc-portal-actions">
        <article><ShieldCheck aria-hidden /><div><strong>Client-visible home</strong><span>{Object.keys(data.portalConfig).length ? "PARTIAL · scoped configuration loaded" : "PARTIAL · authorized default configuration"}</span></div></article>
        <article><MessageSquare aria-hidden /><div><strong>Portal conversation</strong><span>PARTIAL · canonical thread convergence is not complete.</span></div></article>
        <article><UserRound aria-hidden /><div><strong>Requests and action items</strong><span>UNAVAILABLE · no aggregate workflow contract is connected.</span></div></article>
        <article><ShieldCheck aria-hidden /><div><strong>Portal access</strong><span>PARTIAL · invite and access state remains on the selected client record.</span></div></article>
        <article><UserRound aria-hidden /><div><strong>Engagement progress</strong><span>UNAVAILABLE · the relationship progress contract is incomplete.</span></div></article>
        <article><ShieldCheck aria-hidden /><div><strong>Files and agreements</strong><span>PARTIAL · existing seams vary by authorized account.</span></div></article>
      </div>
      <div className="trc-integrity"><ShieldCheck aria-hidden /><p><strong>Preview is not impersonation.</strong> Client-facing projection never grants staff a client session.</p></div>
      <div className="trc-portal-links">
        <button type="button" onClick={() => setConfigurationOpen((open) => !open)}>{configurationOpen ? "Close Portal configuration" : "Open gated Portal configuration"}</button>
        {selectedContact ? (
          <button type="button" onClick={() => setAccessOpen((open) => !open)}>{accessOpen ? "Close selected client access" : "Open selected client access"}</button>
        ) : (
          <button type="button" disabled>Choose a client to manage access</button>
        )}
        <ProofPill tone="unavailable">Configuration remains owner/admin gated</ProofPill>
      </div>
      {configurationOpen && (
        <div className="trc-canonical-mount" data-portal-configuration>
          <RoleGate allow={["admin"]} fallback={<BoundedState eyebrow="Portal · PERMISSION LIMITED" title="Owner or admin access required" detail="Portal configuration remains behind its existing administrative gate." kind="unavailable" />}>
            <Suspense fallback={<BoundedState eyebrow="Portal · PARTIAL" title="Loading Portal configuration" detail="The existing PortalStudio owner is mounting for the active account." kind="loading" />}><PortalStudio key={activeTenantId} /></Suspense>
          </RoleGate>
        </div>
      )}
      {accessOpen && selectedContact && (
        <div className="trc-canonical-mount" data-contact-portal-access>
          <Suspense fallback={<BoundedState eyebrow="Portal access · PARTIAL" title="Loading selected client access" detail="No other contact is substituted while the selected record loads." kind="loading" />}>
            <ContactPortalAccess key={`${activeTenantId}:${selectedContact.id}`} contactId={selectedContact.id} email={selectedContact.email} linkedUserId={selectedContact.linkedUserId} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
