import { lazy, Suspense, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Mail,
  Search,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useBrandKit } from "@/hooks/useBrandKit";
import { useRailEvents } from "@/hooks/useRailEvents";
import { usePlaybook } from "@/lib/playbook";
import {
  applyPortalOverlay,
  catalogRoutableItems,
} from "@/lib/portal/moduleNav";
import { readableTextOn } from "@/lib/brand/resolveBrand";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { PortalConfigurationGate } from "./PortalConfigurationGate";
import type {
  RelationshipPerson,
  useTenantRelationshipsData,
} from "./useTenantRelationshipsData";
import {
  accessLabels,
  portalAccessState,
  portalNextStep,
} from "./portalDashboardModel";
import { usePortalInvitations } from "./usePortalInvitations";
import { PortalInvitationManager } from "./PortalInvitationManager";
import "./owner-portal-dashboard.css";

const PortalStudio = lazy(() => import("@/pages/admin/PortalStudio"));
const tabs = ["Overview", "Experience", "Client access", "Activity"] as const;
type Tab = (typeof tabs)[number];
type WorkspaceData = ReturnType<typeof useTenantRelationshipsData>;

function Status({
  title,
  detail,
  retry,
}: {
  title: string;
  detail?: string;
  retry?: () => void;
}) {
  return (
    <div className="opd-status" role={retry ? "alert" : "status"}>
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {retry && (
        <button className="opd-button" type="button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

function SharedActivity({
  tenantId,
  compact = false,
}: {
  tenantId: string;
  compact?: boolean;
}) {
  const rail = useRailEvents({ scope: "tenant", tenantId });
  const events = rail.events.filter(
    (event) =>
      event.visibility === "client_visible" &&
      ["client", "both"].includes(event.audience),
  );
  return (
    <>
      {rail.historyStatus === "loading" && (
        <Status title="Loading shared activity…" />
      )}
      {rail.historyStatus === "forbidden" && (
        <Status
          title="Shared activity requires access"
          detail="This account cannot read this workspace’s activity."
        />
      )}
      {rail.historyStatus === "unavailable" && (
        <Status
          title="Shared activity couldn’t be loaded"
          detail="Try reopening Activity in a moment. No activity total is available."
        />
      )}
      {rail.historyStatus === "ready" && !events.length && (
        <Status
          title="No recent shared activity"
          detail="Client-visible outcomes will appear here as they’re recorded."
        />
      )}
      {!!events.length && (
        <ol className="opd-activity-list">
          {events.slice(0, compact ? 3 : 50).map((event) => (
            <li key={event.id}>
              <span className="opd-activity-dot" aria-hidden>
                <Check />
              </span>
              <div>
                <strong>{event.title || "Shared activity recorded"}</strong>
                {!compact && event.summary && <p>{event.summary}</p>}
                <time dateTime={event.occurred_at}>
                  {Number.isFinite(Date.parse(event.occurred_at))
                    ? new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(event.occurred_at))
                    : "Time not recorded"}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function OwnerPortalDashboard({
  tenantId,
  tenantName,
  data,
  openClient,
  openPaige,
}: {
  tenantId: string;
  tenantName: string;
  data: WorkspaceData;
  openClient: (id?: string) => void;
  openPaige: () => void;
}) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [preview, setPreview] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorMounted, setEditorMounted] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const brand = useBrandKit(tenantId);
  const invitations = usePortalInvitations(tenantId);
  const playbook = usePlaybook();
  const modules = useMemo(
    () =>
      applyPortalOverlay(
        catalogRoutableItems(playbook.portal.modules),
        data.portalConfig.modules,
      ),
    [playbook, data.portalConfig],
  );
  const now = Date.now();
  const invitationRows =
    !invitations.isError && !invitations.isLoading
      ? invitations.data
      : undefined;
  const rows = data.people.map((person) => ({
    person,
    access: portalAccessState(person, invitationRows, now),
  }));
  const attention = rows.filter(
    ({ person, access }) =>
      person.doNotContact ||
      !person.email ||
      ["not-invited", "expired", "canceled"].includes(access),
  );
  const filtered = rows.filter(
    ({ person, access }) =>
      (filter === "all" || access === filter) &&
      [
        person.name,
        person.company,
        ...person.contactMethods.map((m) => m.value),
      ].some((value) =>
        value?.toLowerCase().includes(search.trim().toLowerCase()),
      ),
  );
  const effective = brand.state?.effective;
  const brandName = effective?.product_name || tenantName;
  const canPreview =
    !brand.isLoading &&
    !brand.isError &&
    !data.portalLoading &&
    !data.portalError;
  const customize = () => {
    setTab("Experience");
    setEditorMounted(true);
    setEditing(true);
  };
  const chooseClient = () => {
    setTab("Client access");
    requestAnimationFrame(() => searchRef.current?.focus());
  };
  const manageInvitation = (person: RelationshipPerson) => {
    if (person.status !== "active") { openClient(person.id); return; }
    setSelectedId(person.id);
    setInviting(true);
  };
  const selected = data.people.find((person) => person.id === selectedId);
  const brandPreview = (
    <div className="opd-brand-preview">
      <div
        className="opd-brand-masthead"
        style={
          effective
            ? {
                background: effective.primary_color,
                color: readableTextOn(effective.primary_color),
              }
            : undefined
        }
      >
        {effective?.logo_url ? (
          <img src={effective.logo_url} alt="" />
        ) : (
          <span className="opd-brand-monogram">
            {brandName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <strong>{brandName}</strong>
      </div>
      <div>
        <strong>{data.portalConfig.welcome?.headline || "Welcome back"}</strong>
        <p>
          {data.portalConfig.welcome?.subhead ||
            effective?.tagline ||
            "Your next steps, shared work and conversations."}
        </p>
      </div>
    </div>
  );

  const clientTable = (accessView: boolean) => (
    <section className="opd-clients" aria-labelledby={`${id}-clients`}>
      <header className="opd-section-heading">
        <div>
          <h2 id={`${id}-clients`}>
            {accessView ? "Client access" : "Your clients"}
          </h2>
          <p>
            {data.peopleLoading
              ? "Loading your clients…"
              : data.peopleError
                ? "Client records couldn’t be loaded."
                : `${data.people.length} loaded client${data.people.length === 1 ? "" : "s"} · From People`}
          </p>
        </div>
        {!accessView && (
          <button
            type="button"
            className="opd-text-button"
            onClick={chooseClient}
          >
            Manage access <ArrowRight />
          </button>
        )}
      </header>
      {accessView && (
        <div className="opd-filters">
          <label>
            <Search aria-hidden />
            <span className="sr-only">Search clients</span>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, company or email"
            />
          </label>
          <label>
            <span className="sr-only">Filter invitation state</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All clients</option>
              {Object.entries(accessLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {data.peopleLoading ? (
        <Status title="Loading client records…" />
      ) : data.peopleError ? (
        <Status
          title="We couldn’t load your clients"
          detail="Try again to retrieve this workspace’s client list."
          retry={() => void data.retryPeople()}
        />
      ) : !data.people.length ? (
        <Status
          title="Your first client starts here"
          detail="Add a contact in People, then manage their portal relationship here."
        />
      ) : !(accessView ? filtered : rows).length ? (
        <Status
          title="No clients match"
          detail="Try another search or access filter."
        />
      ) : (
        <div
          className="opd-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Client records"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">{accessView ? "Email" : "Journey"}</th>
                <th scope="col">Next step</th>
                <th scope="col">Access</th>
              </tr>
            </thead>
            <tbody>
              {(accessView ? filtered : rows.slice(0, 8)).map(
                ({ person, access }) => (
                  <tr key={person.id}>
                    <td>
                      <button
                        type="button"
                        className="opd-client-name"
                        onClick={() => openClient(person.id)}
                      >
                        <span className="opd-avatar" aria-hidden>
                          {person.name.slice(0, 1)}
                        </span>
                        <span>
                          <strong>{person.name}</strong>
                          <small>
                            {person.company ||
                              person.email ||
                              "Contact in People"}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>{accessView ? person.email || "No email address" : <button type="button" className="opd-text-button opd-next-step" onClick={() => openClient(person.id)}>{person.primaryOffer ? `${person.primaryOffer} · Recorded offer` : "View client standing"}<ArrowRight /></button>}</td>
                    <td>
                      <button
                        type="button"
                        className="opd-text-button opd-next-step"
                        onClick={() =>
                          [
                            "not-invited",
                            "expired",
                            "canceled",
                            "invited",
                          ].includes(access) &&
                          person.email &&
                          !person.doNotContact
                            ? manageInvitation(person)
                            : openClient(person.id)
                        }
                      >
                        {portalNextStep(person, access)} <ArrowRight />
                      </button>
                    </td>
                    <td>
                      <span className="opd-access-state" data-state={access}>
                        {accessLabels[access]}
                      </span>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {accessView && (
        <p className="opd-footnote">
          Invitation and account links are shown separately from actual portal
          visits. Open a client’s record to manage their relationship and
          contact preferences.
        </p>
      )}
      {accessView && !data.peopleLoading && !data.peopleError && (
        <button
          type="button"
          className="opd-text-button"
          onClick={() => openClient()}
        >
          Open People <ArrowRight />
        </button>
      )}
    </section>
  );

  return (
    <section className="opd-dashboard" aria-label="Portal dashboard">
      <header className="opd-toolbar">
        <p>A clear next step for every client.</p>
        <div>
          <button
            type="button"
            className="opd-button"
            disabled={!canPreview}
            onClick={() => setPreview(true)}
          >
            <Eye /> Preview portal
          </button>
          <button
            type="button"
            className="opd-button opd-primary"
            onClick={() => setInviting(true)}
          >
            <UserPlus /> Invite client
          </button>
        </div>
      </header>
      <div className="opd-tabs" role="tablist" aria-label="Portal management">
        {tabs.map((label, index) => (
          <button
            key={label}
            type="button"
            id={`${id}-tab-${index}`}
            role="tab"
            aria-controls={`${id}-panel`}
            aria-selected={tab === label}
            tabIndex={tab === label ? 0 : -1}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            onClick={() => setTab(label)}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? tabs.length - 1
                    : (index +
                        (e.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              setTab(tabs[next]);
              tabRefs.current[next]?.focus();
            }}
          >
            {label}
            {label === "Experience" && editorDirty && (
              <span className="opd-draft-dot" aria-label="Unsaved changes" />
            )}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tabs.indexOf(tab)}`}
        tabIndex={0}
        className="opd-tabpanel"
      >
        {tab === "Overview" && (
          <div className="opd-overview">
            <div className="opd-main">
              <section className="opd-attention">
                <header className="opd-section-heading">
                  <h2>Needs your attention</h2>
                  {!data.peopleLoading &&
                    !data.peopleError &&
                    invitationRows && (
                      <span>{attention.length} in the loaded client list</span>
                    )}
                </header>
                {data.peopleLoading ? (
                  <Status title="Checking your client list…" />
                ) : data.peopleError ? (
                  <Status
                    title="Client attention couldn’t be checked"
                    retry={() => void data.retryPeople()}
                  />
                ) : attention.length ? (
                  <ul>
                    {attention.slice(0, 4).map(({ person, access }) => (
                      <li key={person.id}>
                        <span className="opd-attention-icon" aria-hidden>
                          <Mail />
                        </span>
                        <div>
                          <strong>{person.name}</strong>
                          <p>{portalNextStep(person, access)}</p>
                        </div>
                        <button
                          type="button"
                          className="opd-button"
                          onClick={() =>
                            ["not-invited", "expired", "canceled"].includes(
                              access,
                            ) &&
                            person.email &&
                            !person.doNotContact
                              ? manageInvitation(person)
                              : openClient(person.id)
                          }
                        >
                          Review <ArrowRight />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : !invitationRows ? (
                  <Status
                    title={
                      invitations.isError
                        ? "Invitation follow-up couldn’t be checked"
                        : "Checking invitation follow-up…"
                    }
                    detail={
                      invitations.isError
                        ? "Retry the invitation check to see which clients need an invitation."
                        : undefined
                    }
                    retry={
                      invitations.isError
                        ? () => void invitations.refetch()
                        : undefined
                    }
                  />
                ) : (
                  <Status
                    title="No contact or invitation follow-up found"
                    detail="Check client standing for service, payment and delivery follow-up."
                  />
                )}
              </section>
              <div className="opd-paige">
                <Sparkles aria-hidden />
                <div>
                  <strong>Make the next step a little easier.</strong>
                  <p>
                    Open PAIGE alongside the client record to plan your
                    follow-up.
                  </p>
                </div>
                <button
                  type="button"
                  className="opd-text-button"
                  onClick={openPaige}
                >
                  Open PAIGE <ArrowRight />
                </button>
              </div>
              {clientTable(false)}
            </div>
            <aside className="opd-aside">
              <section className="opd-experience-card">
                <h2>Portal experience</h2>
                {brand.isLoading ? (
                  <Status title="Loading your brand…" />
                ) : brand.isError || data.portalError ? (
                  <Status
                    title="Portal presentation couldn’t be loaded"
                    retry={() => {
                      void brand.refetch();
                      void data.retryPortal();
                    }}
                  />
                ) : (
                  <>
                    {brandPreview}
                    <dl>
                      <div>
                        <dt>Presentation</dt>
                        <dd>{brandName}</dd>
                      </div>
                      <div>
                        <dt>Customer modules</dt>
                        <dd>
                          {data.portalLoading
                            ? "Loading…"
                            : `${modules.length} configured`}
                        </dd>
                      </div>
                      <div>
                        <dt>PAIGE actions</dt>
                        <dd>Subject to client permissions</dd>
                      </div>
                    </dl>
                  </>
                )}
                <button
                  type="button"
                  className="opd-button"
                  onClick={customize}
                >
                  Customize experience <ArrowRight />
                </button>
              </section>
              <section className="opd-recent">
                <h2>Recent activity</h2>
                <SharedActivity tenantId={tenantId} compact />
                <button
                  type="button"
                  className="opd-text-button"
                  onClick={() => setTab("Activity")}
                >
                  See shared activity <ArrowRight />
                </button>
              </section>
            </aside>
          </div>
        )}
        {tab === "Client access" && (
          <>
            <div className="opd-page-heading">
              <h2>The right access, for each client.</h2>
              <p>
                Choose an existing contact to review their portal relationship.
              </p>
            </div>
            {invitations.isError && (
              <Status
                title="Invitations couldn’t be checked"
                detail="Client records remain available. Invitation states are not inferred from a failed check."
                retry={() => void invitations.refetch()}
              />
            )}
            {clientTable(true)}
            {!data.peopleError &&
              !data.peopleLoading &&
              data.people.length > 0 && (
                <section className="opd-invite-selection">
                  <label htmlFor={`${id}-invite-client`}>
                    Invite an existing client
                  </label>
                  <select
                    id={`${id}-invite-client`}
                    value={selectedId || ""}
                    onChange={(e) => setSelectedId(e.target.value || null)}
                  >
                    <option value="">Choose a client</option>
                    {data.people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name} · {person.email || "No email"}
                      </option>
                    ))}
                  </select>
                  {selected && invitationRows && (
                    <PortalConfigurationGate tenantId={tenantId}>
                      <PortalInvitationManager
                        key={selected.id}
                        tenantId={tenantId}
                        person={selected}
                        latest={invitationRows.find(
                          (row) => row.contact_id === selected.id,
                        )}
                        onReadback={() => invitations.invalidate()}
                      />
                    </PortalConfigurationGate>
                  )}
                  {selected && !invitationRows && (
                    <Status
                      title="Check invitation status before sending"
                      detail="Invitation controls will appear after the current invitation check succeeds."
                    />
                  )}
                </section>
              )}
          </>
        )}
        {tab === "Activity" && (
          <>
            <div className="opd-page-heading">
              <h2>Every shared step, in one place.</h2>
              <p>
                Recent client-visible events from your business activity.
                Private client AI conversations stay private.
              </p>
            </div>
            <section className="opd-activity-page">
              <SharedActivity tenantId={tenantId} />
              <p className="opd-footnote">
                Showing shared events from the latest available activity, rather
                than a complete client history.
              </p>
            </section>
          </>
        )}
        {tab === "Experience" && (
          <div hidden={editing}>
            <div className="opd-page-heading">
              <h2>Your brand. Their space.</h2>
              <p>
                Shape the welcome, appearance and available customer modules.
              </p>
            </div>
            <div className="opd-experience-layout">
              <section>
                <div className="opd-experience-card">
                  <h2>Presentation & welcome</h2>
                  {canPreview ? (
                    brandPreview
                  ) : (
                    <Status
                      title={
                        brand.isError || data.portalError
                          ? "Presentation couldn’t be loaded"
                          : "Loading presentation…"
                      }
                    />
                  )}
                  <button
                    type="button"
                    className="opd-button"
                    onClick={customize}
                  >
                    Customize experience <ArrowRight />
                  </button>
                  {editorDirty && (
                    <p className="opd-footnote">
                      Your unsaved changes are still in the editor.
                    </p>
                  )}
                </div>
                <section className="opd-experience-row">
                  <div>
                    <h2>Client journey</h2>
                    <p>
                      Review programs, commitments and delivery on the existing
                      client record.
                    </p>
                  </div>
                  <button
                    className="opd-text-button"
                    type="button"
                    onClick={() => openClient()}
                  >
                    Open clients <ArrowRight />
                  </button>
                </section>
                <section className="opd-experience-row">
                  <div>
                    <h2>PAIGE for your clients</h2>
                    <p>
                      Client actions use the permissions and approval policies
                      of your business.
                    </p>
                  </div>
                  <button
                    className="opd-text-button"
                    type="button"
                    onClick={openPaige}
                  >
                    Open PAIGE <ArrowRight />
                  </button>
                </section>
              </section>
              <aside className="opd-experience-card">
                <h2>Customer modules</h2>
                <p className="opd-footnote">
                  Configured navigation follows the existing portal catalogue.
                  Visibility does not grant access to records.
                </p>
                {data.portalError ? (
                  <Status
                    title="Modules couldn’t be loaded"
                    retry={() => void data.retryPortal()}
                  />
                ) : (
                  <ul className="opd-module-list">
                    {modules.map((item) => (
                      <li key={item.key}>
                        <item.icon aria-hidden />
                        {item.label}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  className="opd-text-button"
                  type="button"
                  onClick={customize}
                >
                  Edit modules <ArrowRight />
                </button>
              </aside>
            </div>
          </div>
        )}
        {/* Keep a draft mounted while changing inner tabs; only a workspace/actor retirement discards it. */}
        {editorMounted && (
          <div hidden={tab !== "Experience" || !editing} className="opd-editor">
            <button
              className="opd-text-button"
              type="button"
              onClick={() => setEditing(false)}
            >
              <ArrowLeft /> Back to experience
              {editorDirty ? " · Draft kept" : ""}
            </button>
            <PortalConfigurationGate tenantId={tenantId}>
              <Suspense
                fallback={<Status title="Loading the experience editor…" />}
              >
                <PortalStudio embedded onDirtyChange={setEditorDirty} />
              </Suspense>
            </PortalConfigurationGate>
          </div>
        )}
      </div>
      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent className="opd-preview-dialog opd-invite-dialog">
          <DialogTitle>Invite a client</DialogTitle>
          <DialogDescription>
            Choose an existing contact. The invitation is bound to their saved
            email address.
          </DialogDescription>
          {data.peopleError ? (
            <Status
              title="Client records couldn’t be loaded"
              retry={() => void data.retryPeople()}
            />
          ) : (
            <>
              <label htmlFor={`${id}-dialog-client`}>Existing client</label>
              <select
                id={`${id}-dialog-client`}
                value={selectedId || ""}
                onChange={(event) => setSelectedId(event.target.value || null)}
              >
                <option value="">Choose a client</option>
                {data.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.email || "No email"}
                  </option>
                ))}
              </select>
              {selected && (
                <div>
                  <label htmlFor={`${id}-recipient`}>
                    Invitation recipient
                  </label>
                  <input
                    id={`${id}-recipient`}
                    readOnly
                    value={selected.email || "No email address saved"}
                  />
                </div>
              )}
              {selected && invitationRows ? (
                <PortalConfigurationGate tenantId={tenantId}>
                  <PortalInvitationManager
                    key={`${tenantId}:${selected.id}`}
                    tenantId={tenantId}
                    person={selected}
                    latest={invitationRows.find(
                      (row) => row.contact_id === selected.id,
                    )}
                    onReadback={() => invitations.invalidate()}
                  />
                </PortalConfigurationGate>
              ) : selected ? (
                <Status
                  title={
                    invitations.isError
                      ? "Invitations couldn’t be checked"
                      : "Checking invitation status…"
                  }
                  retry={
                    invitations.isError
                      ? () => void invitations.refetch()
                      : undefined
                  }
                />
              ) : (
                <p className="opd-footnote">
                  Add new contacts in People before inviting them.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="opd-preview-dialog">
          <DialogTitle>Portal presentation preview</DialogTitle>
          <DialogDescription>
            Saved branding and configured modules. Customer records and actions
            require the customer’s own authorized sign-in.
          </DialogDescription>
          {brandPreview}
          <ul className="opd-module-list">
            {modules.map((item) => (
              <li key={item.key}>
                <item.icon aria-hidden />
                {item.label}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}
