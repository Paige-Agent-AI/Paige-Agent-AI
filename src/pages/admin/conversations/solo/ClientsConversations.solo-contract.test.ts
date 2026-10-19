import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve("src/pages/admin/ClientsConversations.tsx"), "utf8");
const workspace = readFileSync(resolve("src/pages/admin/conversations/solo/SoloConversationsWorkspace.tsx"), "utf8");
const css = readFileSync(resolve("src/pages/admin/conversations/solo/solo-conversations-workspace.css"), "utf8");
const composer = readFileSync(resolve("src/pages/admin/conversations/shell/ConversationsRichComposer.tsx"), "utf8");
const composerAtom = readFileSync(resolve("src/pages/admin/conversations/MessageComposer.tsx"), "utf8");

describe("Solo Conversations page wiring", () => {
  it("routes a named reply through the existing exact composer and registry without a generic-send escape",()=>{
    expect(page).toContain("parseFollowupLocator(searchParams)");
    expect(page).toContain("if (leadReplyApprovalId)");
    expect(page).toContain("await leadReplyReview.prepare(); return;");
    expect(page).toContain("followupLocatorConflict");
    expect(page).toContain("Return to original reply");
    expect(page).toContain("canReplaceFollowupDraft({subject,body");
    expect(page).toContain("useBeforeUnloadGuard(!!leadReplyApprovalId");
    expect(page).toContain("accountEpochRef.current.accept(followupEpoch)");
  });
  it("clears account-owned state and rejects late account work", () => {
    expect(page).toContain("tenantIdRef.current = null");
    expect(page.match(/accountEpochRef\.current\.accept/g)?.length ?? 0).toBeGreaterThanOrEqual(12);
    expect(page).toContain("if (!accountEpochRef.current.accept(composeEpoch)) return");
    expect(page).toContain('setRows([]); setConnectors([]); setLoading(true)');
    expect(page).toContain('setBody("")');
    expect(page).toContain('setHandlingMode("human")');
    expect(page).toContain("setAppendSignature(true); setDragOver(false); setUndo(null)");
    expect(page).toContain("if (accountEpochRef.current.accept(epoch)) void cancelUndo(id)");
  });

  // The comms readiness read was the one piece of account-owned state on this page that did
  // NEITHER of the two things every other piece does. On an account switch the effect went
  // straight to its async arm, so the previous workspace's readiness kept feeding the channel
  // disclosure until the new RPC returned, and nothing checked that the answer that came back was
  // even about the account on screen. Settings -> Connections has always done both
  // (useCommsReadiness, src/solo/settings.tsx); this consumer of the SAME resolver did not.
  it("clears comms readiness before the next account paints, and never renders another account's answer", () => {
    const effect = page.slice(
      page.indexOf("const [commsReadiness, setCommsReadiness]"),
      page.indexOf("const soloChannelTruth ="),
    );
    expect(effect).not.toEqual("");
    // Clear FIRST and unconditionally — before the guard, not inside one branch of it.
    expect(effect.indexOf("setCommsReadiness(null);")).toBeLessThan(effect.indexOf("if (!isSolo || !activeTenantId) return;"));
    // And bind the answer to the workspace on screen before it is rendered — POSITIVELY. A
    // `row.tenant_id && row.tenant_id !== active` form lets a payload with no tenant fall through
    // and render, which is absence treated as a match.
    expect(effect).toContain("row.tenant_id === activeTenantId ? row : null");
    expect(effect).not.toContain("row.tenant_id !== activeTenantId");
  });

  it("keeps sends on proven email and SMS seams and fails governed handling closed", () => {
    expect(page).toContain('c.channel_type === "email" || c.channel_type === "sms"');
    expect(page).toContain("const composerConnectors = isSolo ? sendableConnectors : activeConnectors");
    expect(page).toContain("canSendInSolo(handlingMode, composeChannel)");
    expect(page).toContain("canSendInSolo(handlingMode, m.channel_type)");
    expect(page).toContain('sendDisabled={isSolo && handlingMode === "governed"}');
    expect(composer).toContain("disabled={disabled || uploading}");
    expect(composer).toContain("disabled={disabled || sending || drafting || uploading}");
    expect(composer).toContain("disabled={disabled || drafting || sending || uploading || !canDraft}");
    expect(composer).toContain("> Insert");
    expect(composer).toContain("onApplySnippet?.(snippet.id)");
    expect(composer).toContain("setInsertOpen(false)");
    expect(page).toContain("showCombinedInsert: isSolo");
    expect(composer).toContain('placeholder="Insert template…"');
  });

  it("opts Solo into Enter-to-send while keeping validation, IME, and duplicate-submit guards", () => {
    expect(page).toContain("onSend: send");
    expect(page).toContain("sendOnEnter: isSolo");
    expect(page).toContain("sendDisabled: isSolo");
    expect(page).toContain("!selected.contactId");
    expect(page).toContain("suppressions.some((suppression) => suppression.channel === composeChannel)");
    expect(page).toContain("sendInFlightRef.current = epoch");
    expect(composerAtom).toContain("!e.nativeEvent.isComposing");
    expect(composerAtom).toContain("sendOnEnter && plainEnter");
    expect(composerAtom).toContain("submitLockRef.current");
    expect(composerAtom).toContain("sending || disabled || sendDisabled");
  });

  it("keeps the composer height fixed and embeds Send without consuming a separate column", () => {
    expect(page).not.toContain("focus:min-h");
    expect(page).toContain('textareaClassName: "h-24 min-h-24 max-h-24"');
    expect(composerAtom).toContain('data-composer-writing-surface="true"');
    expect(composerAtom).toContain('"relative"');
    expect(composerAtom).toContain('"h-24 min-h-24 max-h-24 resize-none overflow-y-auto pb-12 pr-44"');
    expect(composerAtom).toContain('data-composer-header="true"');
    expect(composerAtom).toContain('"mb-2 max-h-36 overflow-y-auto overscroll-contain pr-1"');
    expect(composerAtom).toContain('className="absolute bottom-2 right-5 h-10 shrink-0"');
    expect(composerAtom).not.toContain('className="flex items-end gap-2"');
    expect(page).toContain('if (attachments.length > 10)');
    expect(page).toContain('|| attachments.length > 10');
    expect(page).toContain('if (attachments.length + Array.from(files).length > 10)');
    expect(page).toContain('onAttachFiles: uploadComposerFiles');
    expect(page).toContain('onDropFiles: uploadComposerFiles');
  });

  it("confines the visual redesign to the tab-bounded Solo descendant", () => {
    expect(css).toContain(".trc-workspace:has(.solo-conversations-workspace) > .trc-heading");
    expect(css).toContain(".trc-conversations:has(.solo-conversations-workspace) > header");
    expect(css).toContain('grid-template-columns: minmax(190px, 1fr) minmax(320px, 1.8fr) minmax(190px, 1fr)');
    expect(css).toContain('grid-template-columns: minmax(156px, 1fr) minmax(250px, 1.7fr) minmax(156px, 1fr)');
    expect(css).toContain('grid-template-columns: minmax(128px, 1fr) minmax(224px, 1.55fr) minmax(128px, 1fr)');
    expect(css).not.toContain('--solo-context-width: 230px');
    expect(css).not.toContain('--solo-context-width: 200px');
    expect(css).not.toContain('--solo-context-width: 176px');
    expect(css).toContain(".solo-conversations-queue { margin-right: 8px; }");
    expect(workspace).not.toMatch(/Sheet|Dialog|onClose|Close client/i);
    expect(workspace).toContain('data-pane="client-context"');
    expect(page).not.toMatch(/Your client book|Client conversations/);
  });

  it("keeps an expanded selected-client profile visible instead of giving the collapse control the pane height", () => {
    expect(css).toContain(".solo-conversations-queue > *,\n.solo-conversations-thread > *");
    expect(css).not.toContain(".solo-conversations-pane > *");
    expect(css).not.toMatch(/data-form-fit="(?:narrow|tight)"[^}]*solo-context-content[^}]*visibility:\s*hidden/s);
  });

  it("keeps conversation controls compact and moves secondary channel truth into one disclosure", () => {
    expect(workspace).toContain('className="solo-operating-toolbar"');
    expect(workspace).toContain('className="solo-channel-menu"');
    expect(workspace).not.toContain('className="solo-channel-strip"');
    expect(css).not.toContain(".solo-channel-strip { flex-wrap: wrap");
  });

  it("keeps provider readiness visible and Escape-restorable", () => {
    expect(workspace).toContain("Provider / source");
    expect(workspace).toContain("A2P readiness");
    expect(workspace).toContain("Webhook health");
    expect(workspace).toContain('event.key !== "Escape"');
    expect(workspace).toContain('querySelector<HTMLElement>("summary")?.focus()');
  });

  it("opens the existing primary PAIGE workspace without fabricating client or specialist continuity", () => {
    expect(page).toContain('import { useAgentPresence } from "@/components/ui/paige"');
    expect(page).toContain("const { expandRail } = useAgentPresence()");
    expect(page).toContain("onOpenPaige={expandRail}");
    expect(page).toContain("selectedClientName={selected.name}");
    expect(page).toContain("selectedThreadLabel={`${CHANNEL_LABEL[selected.channel]}");
    expect(workspace).toContain("Account context");
    expect(workspace).toContain("Client and thread handoff");
    expect(workspace).toContain("Specialist delegation");
    expect(workspace).toContain("Durable outcomes");
    expect(workspace.match(/<dd>PROPOSED<\/dd>/g)).toHaveLength(3);
    expect(workspace).toContain("Nothing here sends externally.");
  });
});
