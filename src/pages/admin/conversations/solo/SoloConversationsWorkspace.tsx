import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Bot, ChevronDown, ChevronLeft, ChevronRight, CircleUserRound, ExternalLink,
  Hand, Mail, MessageSquareText, Phone, ShieldCheck, Sparkles, Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CHANNEL_ICON, type ClientContact, type Label, type MessageRow } from "../inbox-shared";
import type { SoloChannelTruth } from "./soloConversationModel";
import "./solo-conversations-workspace.css";

export type ConversationHandlingMode = "human" | "draft" | "governed";

interface SoloConversationsWorkspaceProps {
  threadList: ReactNode;
  activeThread: ReactNode;
  clientContext: ReactNode;
  hasSelection: boolean;
  showFirstRun: boolean;
  firstRun: ReactNode;
}

export function SoloConversationsWorkspace({
  threadList, activeThread, clientContext, hasSelection, showFirstRun, firstRun,
}: SoloConversationsWorkspaceProps) {
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [formFit, setFormFit] = useState<"full" | "narrow" | "tight">("full");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!hasSelection) setContextCollapsed(false);
  }, [hasSelection]);

  useEffect(() => {
    const node = workspaceRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = (width: number) => setFormFit(width < 620 ? "tight" : width < 748 ? "narrow" : "full");
    measure(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const effectiveCollapsed = contextCollapsed;

  return (
    <div
      ref={workspaceRef}
      className={cn("solo-conversations-workspace", showFirstRun && "solo-conversations-first-run")}
      data-solo-conversations-workspace
      data-context-collapsed={effectiveCollapsed ? "true" : "false"}
      data-form-fit={formFit}
    >
      <section className="solo-conversations-pane solo-conversations-queue" data-pane="queue" aria-label="Conversation queue">
        {threadList}
      </section>
      <section className="solo-conversations-pane solo-conversations-thread" data-pane="thread" aria-label="Selected conversation">
        {showFirstRun ? firstRun : activeThread}
      </section>
      <aside
        className="solo-conversations-pane solo-conversations-context"
        data-pane="client-context"
        aria-label="Selected client context"
      >
        <button
          ref={collapseRef}
          type="button"
          className="solo-context-collapse"
          aria-expanded={!effectiveCollapsed}
          aria-label={effectiveCollapsed ? "Expand client context" : "Collapse client context"}
          onClick={() => {
            setContextCollapsed((value) => !value);
            requestAnimationFrame(() => collapseRef.current?.focus());
          }}
        >
          {effectiveCollapsed ? <ChevronLeft aria-hidden /> : <ChevronRight aria-hidden />}
          <span>{effectiveCollapsed ? "Client" : "Collapse"}</span>
        </button>
        <div className="solo-context-content">{clientContext}</div>
      </aside>
    </div>
  );
}

interface SoloConversationOperatingBarProps {
  mode: ConversationHandlingMode;
  onModeChange: (mode: ConversationHandlingMode) => void;
  channels: SoloChannelTruth[];
  activeChannel: string;
  canDraftWithPaige: boolean;
  connectionsHref: string;
  selectedClientName: string;
  selectedThreadLabel: string;
  onOpenPaige: () => void;
}

const MODE_OPTIONS: Array<{ id: ConversationHandlingMode; label: string; status: string; icon: typeof Hand }> = [
  { id: "human", label: "Human reply", status: "LIVE", icon: Hand },
  { id: "draft", label: "PAIGE drafts", status: "PARTIAL", icon: Sparkles },
  { id: "governed", label: "Governed handling", status: "PROPOSED", icon: Bot },
];

const PortalChannelIcon = CHANNEL_ICON.portal;

export function SoloConversationOperatingBar({
  mode, onModeChange, channels, activeChannel, canDraftWithPaige, connectionsHref,
  selectedClientName, selectedThreadLabel, onOpenPaige,
}: SoloConversationOperatingBarProps) {
  const humanModeRef = useRef<HTMLButtonElement>(null);
  const representedChannel = channels.find((channel) => channel.id === activeChannel);
  const unmatchedChannelTruth: SoloChannelTruth = {
    id: activeChannel || "unmatched",
    label: activeChannel === "whatsapp"
      ? "WhatsApp"
      : activeChannel
        ? activeChannel.replace(/(^|-)([a-z])/g, (_match, separator: string, letter: string) => `${separator ? " " : ""}${letter.toUpperCase()}`)
        : "Unmatched channel",
    availability: "UNAVAILABLE",
    identity: "Not assigned",
    providerConnection: "Not reported",
    providerSource: "Not represented in this workspace",
    sendPermission: "Unavailable",
    inbound: "Not reported",
    webhookHealth: "Not reported",
    operationalHealth: "Unavailable",
    setupOwner: "Not available",
  };
  const activeChannelTruth = representedChannel ?? unmatchedChannelTruth;
  const channelMenuItems = representedChannel ? channels : [unmatchedChannelTruth, ...channels];
  const showChannelSetup = !!activeChannelTruth
    && activeChannelTruth.availability !== "LIVE"
    && activeChannelTruth.setupOwner !== "Not available";
  const handBack = () => {
    onModeChange("human");
    requestAnimationFrame(() => humanModeRef.current?.focus());
  };
  return (
    <div className="solo-conversation-operating-bar">
      <div className="solo-operating-toolbar">
        <div className="solo-handling-modes" role="group" aria-label="Conversation handling">
          {MODE_OPTIONS.map(({ id, label, status, icon: Icon }) => (
            <button
              ref={id === "human" ? humanModeRef : undefined}
              key={id}
              type="button"
              aria-pressed={mode === id}
              disabled={id === "draft" && !canDraftWithPaige}
              title={id === "draft" && !canDraftWithPaige ? "PAIGE drafting needs a ready email identity and recipient" : undefined}
              onClick={() => onModeChange(id)}
              data-mode={id}
              className={cn("solo-handling-mode", mode === id && "is-active")}
            >
              <Icon aria-hidden />
              <span>{label}</span>
              <small>{status}</small>
            </button>
          ))}
        </div>
        <div className="solo-operating-actions">
          <details
            className="solo-paige-coordination"
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !event.currentTarget.open) return;
              event.preventDefault();
              event.currentTarget.open = false;
              event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
            }}
          >
            <summary aria-label="Primary PAIGE coordination status: live">
              <Sparkles aria-hidden />
              <span>Primary PAIGE</span>
              <small>LIVE</small>
            </summary>
            <div className="solo-paige-coordination-truth">
              <header>
                <strong>PAIGE coordination</strong>
                <span>{selectedClientName} · {selectedThreadLabel}</span>
              </header>
              <dl>
                <div><dt>Account context</dt><dd>LIVE</dd></div>
                <div><dt>Client and thread handoff</dt><dd>PROPOSED</dd></div>
                <div><dt>Specialist delegation</dt><dd>PROPOSED</dd></div>
                <div><dt>Durable outcomes</dt><dd>PROPOSED</dd></div>
              </dl>
              <p>Internal PAIGE work remains separate from client messages. Nothing here sends externally.</p>
              <Button type="button" size="sm" variant="outline" data-open-primary-paige onClick={onOpenPaige}>
                Open primary PAIGE
              </Button>
            </div>
          </details>
          {activeChannelTruth ? (
            <details
              className="solo-channel-menu"
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !event.currentTarget.open) return;
                event.preventDefault();
                event.currentTarget.open = false;
                event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
              }}
            >
              <summary aria-label={`Current channel: ${activeChannelTruth.label}, ${activeChannelTruth.availability}`}>
                {activeChannelTruth.id === "email" ? <Mail aria-hidden />
                  : activeChannelTruth.id === "voice" ? <Phone aria-hidden />
                  // The portal reads with the same door the thread, the list and the composer use.
                  : activeChannelTruth.id === "portal" ? <PortalChannelIcon aria-hidden />
                  : <MessageSquareText aria-hidden />}
                <span>{activeChannelTruth.label}</span>
                <small>{activeChannelTruth.availability}</small>
                <ChevronDown aria-hidden />
              </summary>
              <div className="solo-channel-menu-popover">
                <header>
                  <strong>All channels</strong>
                  <span>Readiness and sending identity</span>
                </header>
                <div className="solo-channel-menu-list">
                  {channelMenuItems.map((channel) => (
                    <section key={channel.id} className={cn("solo-channel-menu-option", channel.id === activeChannel && "is-current")}>
                      <header><strong>{channel.label}</strong><small>{channel.availability}</small></header>
                      <dl>
                        <div><dt>Provider connection</dt><dd>{channel.providerConnection}</dd></div>
                        <div><dt>Provider / source</dt><dd>{channel.providerSource}</dd></div>
                        <div><dt>Identity / number</dt><dd>{channel.identity}</dd></div>
                        {channel.a2p && <div><dt>A2P readiness</dt><dd>{channel.a2p}</dd></div>}
                        <div><dt>Send permission</dt><dd>{channel.sendPermission}</dd></div>
                        <div><dt>Inbound capability</dt><dd>{channel.inbound}</dd></div>
                        <div><dt>Webhook health</dt><dd>{channel.webhookHealth}</dd></div>
                        <div><dt>Operational health</dt><dd>{channel.operationalHealth}</dd></div>
                        <div><dt>Setup owner</dt><dd>{channel.setupOwner}</dd></div>
                      </dl>
                    </section>
                  ))}
                </div>
                {showChannelSetup ? <Link className="solo-channel-setup" to={connectionsHref}>Channel setup <ExternalLink aria-hidden /></Link> : null}
              </div>
            </details>
          ) : null}
        </div>
      </div>
      <div className="solo-handling-authority">
        <div className="solo-handling-authority-copy" role="status">
          <ShieldCheck aria-hidden />
          {mode === "human" && <span>You write and send every reply.</span>}
          {mode === "draft" && <span>PAIGE can prepare an editable draft. You still send it.</span>}
          {mode === "governed" && <span>Ask First · every send requires approval · hand back anytime. Sending is not active.</span>}
          {mode !== "human" && (
            <Button variant="ghost" size="sm" onClick={handBack}>Hand back</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function valueOr(value: string | null | undefined, fallback = "Not reported") {
  return value?.trim() || fallback;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not reported" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

interface SoloClientContextPaneProps {
  contact: ClientContact | null;
  labels: Label[];
  recentMessages: MessageRow[];
  links: { people: string; portal: string; campaigns: string | null; connections: string };
}

export function SoloClientContextPane({ contact, labels, recentMessages, links }: SoloClientContextPaneProps) {
  if (!contact) {
    return (
      <div className="solo-context-empty">
        <CircleUserRound aria-hidden />
        <strong>No client selected</strong>
        <span>Select a conversation to load its People-owned relationship context.</span>
      </div>
    );
  }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim()
    || contact.entity_name?.trim() || "Client";
  const activity = [...recentMessages]
    .sort((a, b) => new Date(b.sent_at ?? b.created_at).getTime() - new Date(a.sent_at ?? a.created_at).getTime())
    .slice(0, 3);

  return (
    <div className="solo-client-context-pane">
      <header className="solo-client-context-identity">
        <span className="solo-context-avatar" aria-hidden>{name.slice(0, 2).toUpperCase()}</span>
        <div>
          <p>Selected client</p>
          <h2>{name}</h2>
          <span>{valueOr(contact.title, valueOr(contact.entity_name, "People record"))}</span>
        </div>
        <span className="solo-truth-pill">PROFILE · LIVE</span>
      </header>
      <span className="sr-only" aria-live="polite">Client context loaded for {name}</span>

      <div className="solo-context-links">
        <Link to={links.people}>Open People record <ArrowRight aria-hidden /></Link>
        <span>People owns this record</span>
      </div>

      <ContextSection eyebrow="Relationship" title="Profile and ownership">
        <ContextFact label="Email" value={valueOr(contact.email)} />
        <ContextFact label="Phone" value={valueOr(contact.phone)} />
        <ContextFact label="Owner" value={contact.assigned_coach_user_id ? "Assigned · name not loaded" : "Not assigned"} />
        <ContextFact label="Relationship" value={valueOr(contact.lifecycle_stage)} />
        <ContextFact label="Status" value={valueOr(contact.status)} />
        <ContextFact label="Source" value={valueOr(contact.source)} />
      </ContextSection>

      <ContextSection eyebrow="Sales context" title="Pipeline, deal, offers">
        <ContextFact label="Pipeline / deal" value="Not reported" />
        <ContextFact label="Stage" value="Not reported" />
        <ContextFact label="Offers / products" value="Not reported" />
        <p className="solo-context-note">No client-specific sales association is proven in this inbox.</p>
      </ContextSection>

      <ContextSection eyebrow="Relationship signals" title="Tags and campaigns">
        <div className="solo-context-tags">
          {(contact.tags ?? []).length ? (contact.tags ?? []).map((tag) => <span key={tag}><Tag aria-hidden />{tag}</span>) : <span>No People tags reported</span>}
        </div>
        <ContextFact label="Conversation labels" value={labels.length ? labels.map((label) => label.name).join(", ") : "None reported"} />
        {links.campaigns ? <Link className="solo-context-owner-link" to={links.campaigns}>Open Campaigns <ExternalLink aria-hidden /></Link> : null}
        <p className="solo-context-note">Campaigns owns configuration. This generic link does not carry client selection; membership is not reported here.</p>
      </ContextSection>

      <ContextSection eyebrow="Client access" title="Portal access">
        <ContextFact label="Invitation" value="Not reported" />
        <ContextFact label="Access / account link" value={contact.linked_user_id ? "Linked account reported" : "Not reported"} />
        <ContextFact label="Readiness" value="Not reported" />
        <Link className="solo-context-owner-link" to={links.portal}>Open Portal <ExternalLink aria-hidden /></Link>
      </ContextSection>

      <ContextSection eyebrow="Recent activity" title="Conversation touchpoints">
        {activity.length ? (
          <ol className="solo-context-activity">
            {activity.map((item) => (
              <li key={item.id}>
                <span>{item.direction === "inbound" ? "Inbound" : "Outbound"} · {item.channel_type}</span>
                <time dateTime={item.sent_at ?? item.created_at}>{dateLabel(item.sent_at ?? item.created_at)}</time>
              </li>
            ))}
          </ol>
        ) : <p className="solo-context-note">No loaded message activity.</p>}
        <ContextFact label="Last contact" value={dateLabel(contact.last_contacted_at)} />
      </ContextSection>
    </div>
  );
}

function ContextSection({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="solo-context-section">
      <header><span>{eyebrow}</span><h3>{title}</h3></header>
      <div className="solo-context-section-body">{children}</div>
    </section>
  );
}

function ContextFact({ label, value }: { label: string; value: string }) {
  return <div className="solo-context-fact"><span>{label}</span><strong>{value}</strong></div>;
}
