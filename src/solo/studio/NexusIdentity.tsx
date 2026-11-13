import { AgentGlyph } from "../team-hub/TeamHubAgents";
import { nexusDisplayName } from "./nexus";

/** The existing specialist mark from the original team directory. */
export function NexusGlyph() {
  return <span className="vs-nexus-glyph" aria-hidden="true"><AgentGlyph agent="nexus" /></span>;
}

/** Persistent Studio identity, including when the original project is resumed. */
export function NexusIdentity({ compact = false }: { compact?: boolean }) {
  return (
    <span className="vs-nexus-identity" data-compact={compact || undefined}>
      <NexusGlyph />
      <span className="vs-nexus-title">Vibe Studio<span className="vs-nexus-name">{nexusDisplayName()}</span></span>
    </span>
  );
}
