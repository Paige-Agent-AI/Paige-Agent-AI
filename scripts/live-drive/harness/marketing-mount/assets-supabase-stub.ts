// Replaces only the campaign ↔ asset links read and writer (`get_campaign_brief_assets`,
// `configure_campaign_brief_assets`, INT-298 MBC 3b), in the shape the database returns, chosen by `?mode=`.
// A fictional business's pieces (§63). Writes change this page's copy, so attach and remove can be driven.
import { mode } from "./mode";

type Answer = { data: unknown; error: { message: string } | null };
const row = (brief_id: string, kind: string, id: string, name: string | null, status: string | null, extra: Record<string, unknown> = {}) =>
  ({ brief_id, kind, id, name, status, slug: null, channel: null, created_through: "human", linked_at: new Date(Date.now() - 86_400_000).toISOString(), detachable: mode !== "readonly" && kind !== "social_post", ...extra });

const member = mode === "readonly";
let links = mode === "first" ? [] : [
  row("b1", "form", "f1", "Discovery call request", "active"),
  row("b1", "page", "p1", "Advisory scorecard landing page", "published"),
  row("b1", "email_campaign", "e1", member ? null : "Spring advisory announcement", member ? null : "completed"),
  row("b1", "social_post", "s1", "Spring intake teaser", "draft"),
];
const available = member || mode === "first" ? [] : [
  { kind: "page", id: "p1", name: "Advisory scorecard landing page", status: "published", channel: null },
  { kind: "form", id: "f1", name: "Discovery call request", status: "active", channel: null },
  { kind: "form", id: "f2", name: "Scorecard opt-in", status: "active", channel: null },
  { kind: "email_campaign", id: "e1", name: "Spring advisory announcement", status: "completed", channel: null },
  { kind: "email_series", id: "q1", name: "Welcome series", status: "active", channel: null },
  { kind: "content", id: "c1", name: "Spring advisory ad", status: "draft", channel: "ad_copy" },
];

function rpc(name: string, args: Record<string, unknown> = {}): Promise<Answer> {
  if (mode === "loading") return new Promise(() => {});
  if (mode === "error") return Promise.resolve({ data: null, error: { message: "harness_read_failed" } });
  if (name === "get_campaign_brief_assets") return Promise.resolve({ data: { can_manage: !member, links, available }, error: null });
  if (name === "configure_campaign_brief_assets") {
    const command = args._command as { type: string; briefId: string; assetKind: string; assetId: string };
    const asset = available.find((item) => item.kind === command.assetKind && item.id === command.assetId);
    if (command.type === "attach_asset" && asset) links = [...links, row(command.briefId, asset.kind, asset.id, asset.name, asset.status, { channel: asset.channel })];
    if (command.type === "detach_asset") links = links.filter((link) => !(link.brief_id === command.briefId && link.kind === command.assetKind && link.id === command.assetId));
    return Promise.resolve({ data: { ok: true, outcome: command.type === "attach_asset" ? "attached" : "detached",
      message: command.type === "attach_asset" ? "Attached to the campaign. Nothing is sent or published." : "Removed from the campaign. The piece itself is unchanged." }, error: null });
  }
  return Promise.resolve({ data: null, error: null });
}

export const supabase = { rpc };
