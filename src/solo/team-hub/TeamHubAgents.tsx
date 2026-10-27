/**
 * EXP08 Team Hub agents, A1b: the pieces that show PAIGE and her six agents as Team Hub participants,
 * built to approved prototype v3 (behaviour) and the approved v5 colours and symbols (§28 frozen).
 *
 * Colour marks WHO, never state. Every agent element carries `data-ag="<key>"`, and team-hub.css maps
 * that to the agent's `--pg-agent-*` tokens (tint, ink, fill, ring) from the shared token layer. Colour
 * never stands alone: the agent's symbol and name sit beside it, and the word "Agent" says what it is.
 * PAIGE's gold is a tint and a ring only; the solid gold fill stays the Approve act's (none in A1).
 * Status marks keep the system colours.
 */
import type { ReactNode, RefObject } from "react";
import { Cog, ExternalLink, GraduationCap, HeartHandshake, Lock, Megaphone, MessageSquare, ShieldCheck, Target, TriangleAlert, X } from "lucide-react";
import type { TeamHubAgentKey } from "./team-hub-contract";
import { agentName, FIXED_PRIVATE_LINE, TEAM_HUB_AGENT_PROFILES } from "./team-hub-agents";

/** Each specialist keeps its glyph from the Paige team directory (`VP_ICON`); PAIGE carries her Command Mark. */
const GLYPHS: Record<Exclude<TeamHubAgentKey, "paige">, typeof ShieldCheck> = {
  vera: ShieldCheck, nexus: Megaphone, cura: HeartHandshake, mentor: GraduationCap, merit: Target, zion: Cog,
};

/** PAIGE's Command Mark (a slash and an orb), drawn in the agent's ink. */
function CommandMarkGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="th-ag-mark">
    <path d="M7 19L13 5h4l-6 14z" fill="currentColor" /><circle cx="18.5" cy="17" r="2.2" fill="currentColor" />
  </svg>;
}

export function AgentGlyph({ agent }: { agent: TeamHubAgentKey }) {
  if (agent === "paige") return <CommandMarkGlyph />;
  const Icon = GLYPHS[agent];
  return <Icon aria-hidden="true" />;
}

/** The plate: the agent's tint behind its symbol in its ink, inside a 1px ring. People keep the graphite initials plate. */
export function AgentPlate({ agent, size = "md" }: { agent: TeamHubAgentKey; size?: "xs" | "sm" | "md" | "lg" | "xl" }) {
  return <span className={`th-ag-plate th-ag-plate--${size}`} data-ag={agent} aria-hidden="true"><AgentGlyph agent={agent} /></span>;
}

export function AgentTag({ agent }: { agent: TeamHubAgentKey }) {
  return <span className="th-ag-tag" data-ag={agent}>Agent</span>;
}

/** "CURA is writing…": only the person who asked sees it, while their own tab waits for the reply. */
export function AgentTyping({ agent, label }: { agent: TeamHubAgentKey; label?: string }) {
  return <div className="th-ag-typing" role="status" data-ag={agent}>
    <AgentPlate agent={agent} size="lg" />
    <span><span className="th-ag-dots" aria-hidden="true"><i /><i /><i /></span><b className="th-ag-name">{agentName(agent)}</b> {label ?? "is writing…"}</span>
  </div>;
}

/** The asker's line when a turn ended without a reply, with Ask again or Check again where they help. */
export function AgentFailRow({ text, action, onAction, online }: { text: string; action: "ask_again" | "check_again" | null; onAction: () => void; online: boolean }) {
  return <div className="th-ag-fail"><TriangleAlert aria-hidden="true" /><span>{text}</span>
    {action && <button type="button" className="th-btn" disabled={!online} onClick={onAction}>{action === "check_again" ? "Check again" : "Ask again"}</button>}
  </div>;
}

/**
 * Flow 5, the asker's note under the channel reply: the DM turn writing, the answer in the DM, or the
 * DM turn failed with Ask again. It carries no link to the DM message, so no private text flows back.
 */
export function PrivateNote({ agent, status, onOpenDm, onAskAgain, online }: {
  agent: TeamHubAgentKey; status: "writing" | "posted" | "failed"; onOpenDm: () => void; onAskAgain: () => void; online: boolean;
}) {
  const name = agentName(agent);
  if (status === "failed") {
    return <div className="th-ag-priv" data-ag={agent}><TriangleAlert aria-hidden="true" /><span>{name} couldn't finish your private answer.</span>
      <button type="button" className="th-btn" disabled={!online} onClick={onAskAgain}>Ask again</button></div>;
  }
  return <div className="th-ag-priv" data-ag={agent}><Lock aria-hidden="true" />
    <span>{status === "writing" ? `${name} is writing your answer in your DM. Only you can see it.` : `Your answer is in your DM with ${name}. Only you can see it.`}</span>
    <button type="button" className="th-link th-ag-open" onClick={onOpenDm}>Open DM<ExternalLink aria-hidden="true" /></button>
  </div>;
}

/** Flow 3: Bring in buttons for the asker only; everyone else is told who can. */
export function BringInRow({ agents, askerName, isAsker, onBring }: {
  agents: TeamHubAgentKey[]; askerName: string; isAsker: boolean; onBring: (agent: TeamHubAgentKey) => void;
}) {
  if (!agents.length) return null;
  if (!isAsker) return <div className="th-ag-bring"><span className="th-note">Only {askerName} can bring them in.</span></div>;
  return <div className="th-ag-bring">
    {agents.map((agent) => <button key={agent} type="button" className="th-btn th-ag-bring-btn" data-ag={agent} onClick={() => onBring(agent)}>
      <AgentPlate agent={agent} size="sm" />Bring in {agentName(agent)}</button>)}
    <span className="th-note">Writes the mention in your message box. You send it.</span>
  </div>;
}

/** The note at the top of a person's DM with an agent. */
export function AgentDmNote({ agent }: { agent: TeamHubAgentKey }) {
  const name = agentName(agent);
  return <p className="th-ag-dmnote"><Lock aria-hidden="true" /><span>Only you and {name} can see this conversation. Not even owners can read it. {name} works with what you're allowed to see.</span></p>;
}

/** An agent DM before anything is said in it. */
export function AgentDmEmpty({ agent }: { agent: TeamHubAgentKey }) {
  const name = agentName(agent);
  return <div className="th-center th-ag-empty" data-ag={agent}>
    <AgentPlate agent={agent} size="xl" />
    <h2>Ask {name} anything</h2>
    <p>Only you and {name} can see this conversation. Not even owners can read it. {name} works with what you're allowed to see, and asks you before changing anything.</p>
    <p className="th-note">Your DM with {name} is separate from PAIGE chat, and the two don't share messages.</p>
  </div>;
}

/**
 * The agent profile (flow 8, the About part): a 300px side panel in the thread's slot. Read-only in A1;
 * editing a personality is A4, so no Edit view is shown. A personality changes how an agent sounds,
 * never what it can do, and the panel says so.
 */
export function AgentProfilePanel({ agent, headingRef, onClose, onMessage, messageBusy, children }: {
  agent: TeamHubAgentKey; headingRef: RefObject<HTMLHeadingElement>; onClose: () => void; onMessage: () => void; messageBusy: boolean; children?: ReactNode;
}) {
  const profile = TEAM_HUB_AGENT_PROFILES[agent];
  const name = profile.name;
  const glance = profile.glance;
  return <aside id="th-profile" className="th-thread th-profile" data-ag={agent} aria-labelledby="th-profile-title">
    <header className="th-thread-head">
      <h2 id="th-profile-title" ref={headingRef} tabIndex={-1}>Agent profile</h2>
      <button type="button" className="th-icon-btn" aria-label="Close profile" onClick={onClose}><X aria-hidden="true" /></button>
    </header>
    <div className="th-prof-id">
      <AgentPlate agent={agent} size="xl" />
      <div><h3><span className="th-ag-name">{name}</span> <AgentTag agent={agent} /></h3><p>{profile.role}</p></div>
    </div>
    <div className="th-thread-body th-prof-body">
      <p className="th-prof-intro">“{profile.intro}”</p>
      <p className="th-note">A personality changes how {name} sounds, never what {name} can do.</p>
      <section className="th-prof-sec"><h4>What {name} is for</h4><p>{profile.summary}</p>
        <dl className="th-facts">{profile.examples.map(([who, what]) => <div key={who} className="th-facts-row"><dt>{who}</dt><dd>{what}</dd></div>)}</dl></section>
      <section className="th-prof-sec"><h4>How {name} talks</h4>
        {profile.traits.map(([trait, quote]) => <div key={trait} className="th-prof-trait"><b>{trait}</b><span>“{quote}”</span></div>)}</section>
      <section className="th-prof-sec"><h4>In a channel, and in a DM</h4><dl className="th-facts">
        <div className="th-facts-row"><dt>Channel</dt><dd>{profile.channel}</dd></div>
        <div className="th-facts-row"><dt>DM</dt><dd>{profile.dm}</dd></div>
        <div className="th-facts-row"><dt>If it's private</dt><dd>Says only what's safe for the room, like “{profile.publicPart}” Then Team Hub adds the same line every time: “{FIXED_PRIVATE_LINE}”</dd></div>
        <div className="th-facts-row"><dt>PAIGE chat</dt><dd>{agent === "paige" ? "" : `You can still ask ${name} in PAIGE chat. `}Your DM with {name} is separate from PAIGE chat, and the two don't share messages.</dd></div>
      </dl></section>
      <section className="th-prof-sec"><h4>{name} never</h4><ul className="th-prof-list">{profile.never.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section className="th-prof-sec"><h4>Telling {name} apart</h4><dl className="th-facts">
        <div className="th-facts-row"><dt>Opens with</dt><dd>{glance[0]}</dd></div>
        <div className="th-facts-row"><dt>Signature</dt><dd>{glance[1]}</dd></div>
        <div className="th-facts-row"><dt>Closes with</dt><dd>{glance[2]}</dd></div>
      </dl></section>
      {children}
    </div>
    <div className="th-prof-foot">
      <button type="button" className="th-btn" disabled={messageBusy} onClick={onMessage}><MessageSquare aria-hidden="true" />Message {name}</button>
    </div>
  </aside>;
}
