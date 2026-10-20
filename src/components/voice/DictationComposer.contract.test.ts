import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const read = (path: string) => readFileSync(path, "utf8");

describe("dictation composer scope and send contract", () => {
  it("enumerates every DictationMicButton mount and requires an explicit context epoch", () => {
    const files = [
      "src/components/dashboard/PaigeAIChat.tsx",
      "src/components/app/PaigeChat.tsx",
      "src/pages/admin/conversations/shell/ConversationsRichComposer.tsx",
    ];
    const sources = files.map(read);
    const mountCount = sources.reduce(
      (count, source) => count + (source.match(/<DictationMicButton\b/g)?.length ?? 0),
      0,
    );
    expect(mountCount).toBe(3);
    expect(sources[0]).toContain("scopeEpoch={dictationDeliveryEpoch}");
    expect(sources[0]).toContain("const dictationDeliveryEpoch = `${dictationEpoch}:${dictationGeneration}`;");
    expect(sources[1]).toContain("scopeEpoch={dictationScopeEpoch}");
    expect(sources[2]).toContain("scopeEpoch={dictationScopeEpoch}");
    expect(sources[0]).toContain("focusedClientId: clientId");
    expect(sources[0]).toContain("focusedBusinessMissionId: businessMissionId");
    expect(sources[0]).toContain("const dictationEpoch = requestScopeEpoch;");
    expect(sources[1]).toContain("user.id,");
    expect(sources[1]).toContain("location.pathname,");
    expect(sources[1]).toContain('location.search ?? ""');
  });

  it("pins the load-bearing epoch teardown and stale callback fence", () => {
    const hook = read("src/lib/voice/useDictation.ts");
    const scopeEffect = hook.slice(
      hook.indexOf("if (!run || run.scopeEpoch === scopeEpoch)"),
      hook.indexOf("}, [scopeEpoch, teardownRun]"),
    );
    expect(scopeEffect).toMatch(/generationRef\.current \+= 1;[\s\S]*currentRunRef\.current = null;[\s\S]*teardownRun\(run\);/);
    expect(hook).toContain("run.scopeEpoch === scopeEpochRef.current");
  });

  it("keeps all three mic mounts alive so render-time epoch fencing precedes passive cleanup", () => {
    const mounts = [
      read("src/components/dashboard/PaigeAIChat.tsx"),
      read("src/components/app/PaigeChat.tsx"),
      read("src/pages/admin/conversations/shell/ConversationsRichComposer.tsx"),
    ].map((source) => {
      const start = source.indexOf("<DictationMicButton");
      return source.slice(start, source.indexOf("/>", start) + 2);
    });

    for (const mount of mounts) expect(mount).not.toMatch(/\bkey=/);

    const hook = read("src/lib/voice/useDictation.ts");
    const renderFence = hook.indexOf("scopeEpochRef.current = scopeEpoch;");
    const passiveCleanup = hook.indexOf("if (!run || run.scopeEpoch === scopeEpoch) return;");
    const providerCallbacks = hook.slice(
      hook.indexOf("ws.onmessage ="),
      hook.indexOf("} catch (err)"),
    );

    expect(renderFence).toBeGreaterThan(-1);
    expect(passiveCleanup).toBeGreaterThan(renderFence);
    expect(providerCallbacks).toContain("ws.onmessage = (ev) => {\n        if (!isCurrent(run)) return;");
    expect(providerCallbacks).toContain("ws.onerror = () => {\n        if (!isCurrent(run)) return;\n        failRun(run");
    expect(providerCallbacks).toContain("ws.onclose = (ev) => {\n        if (!isCurrent(run)) return;");
    expect(hook).toContain("const failRun = useCallback((run: DictationRun");
    expect(hook).toContain("if (!isCurrent(run)) return;");
  });

  it("holds each composer send path until dictation finalization completes", () => {
    const paigeAiChat = read("src/components/dashboard/PaigeAIChat.tsx");
    const paigeChat = read("src/components/app/PaigeChat.tsx");
    const conversations = read("src/pages/admin/conversations/shell/ConversationsRichComposer.tsx");
    expect(paigeAiChat).toContain("const composerSendBlocked = composerBlocked || dictationActive");
    expect(paigeAiChat).toContain("if (dictationActive || !originDraft) { voiceSink?.failed(); return; }");
    expect(paigeChat).toContain("if (dictationActive) return;");
    // Drive the actual Send predicate. Customer history/availability adds a
    // stricter guard; it must not remove dictation finalization or disable the
    // ordinary ready composer. An exact old string cannot express both facts.
    const source = ts.createSourceFile("PaigeChat.tsx", paigeChat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const predicates: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
        const send = attributes.some(a => a.name.getText(source) === "aria-label"
          && a.initializer && ts.isStringLiteral(a.initializer) && a.initializer.text === "Send message");
        const disabled = attributes.find(a => a.name.getText(source) === "disabled");
        if (send && disabled?.initializer && ts.isJsxExpression(disabled.initializer) && disabled.initializer.expression)
          predicates.push(disabled.initializer.expression.getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(predicates).toHaveLength(1);
    const disabled = new Function("state", `const {isLoading,dictationActive,customerFrame,customerAvailable,historyState,input,attachedDoc}=state;return (${predicates[0]});`);
    const ready = {isLoading:false,dictationActive:false,customerFrame:null,customerAvailable:true,historyState:"ready",input:"Ready to send",attachedDoc:null};
    expect(disabled(ready)).toBe(false);
    expect(disabled({...ready,dictationActive:true})).toBe(true);
    expect(disabled({...ready,isLoading:true})).toBe(true);
    expect(disabled({...ready,input:""})).toBe(true);
    expect(disabled({...ready,input:"",attachedDoc:{}})).toBe(false);
    expect(disabled({...ready,customerFrame:{}})).toBe(false);
    expect(disabled({...ready,customerFrame:{},dictationActive:true})).toBe(true);
    expect(disabled({...ready,customerFrame:{},customerAvailable:false})).toBe(true);
    for (const historyState of ["loading","error"])
      expect(disabled({...ready,customerFrame:{},historyState})).toBe(true);
    expect(conversations).toContain("sendDisabled={sendDisabled || dictationActive}");
  });

  it("holds alternate PAIGE actions without clearing their state while dictation finalizes", () => {
    const paigeAiChat = read("src/components/dashboard/PaigeAIChat.tsx");
    const paigeLiveConversation = read("src/components/paige/live/PaigeLiveConversation.tsx");
    const composerTextarea = paigeAiChat.slice(
      paigeAiChat.indexOf("const composerTextarea"),
      paigeAiChat.indexOf("const attachButton"),
    );
    const liveConversation = paigeAiChat.slice(
      paigeAiChat.indexOf("<PaigeLiveConversation"),
      paigeAiChat.indexOf("/>\n  ) : null", paigeAiChat.indexOf("<PaigeLiveConversation")),
    );
    expect(paigeAiChat).toContain("if (dictationActive || !composerScope.writable) return;\n    if (chip.autoSend)");
    expect(paigeAiChat).toContain("&& composerScope.writable\n    && !dictationActive;");
    expect(paigeAiChat).toContain("const pickCommand = (c: QuickChip) => {\n    if (dictationActive || !composerScope.writable) return;");
    expect(composerTextarea).toContain("disabled={composerBlocked}");
    expect(liveConversation).toContain("disabled={composerBlocked || dictationActive || isLoading || interactiveAuthorityPending}");
    expect(paigeLiveConversation).toContain("disabled={working || Boolean(disabled)}");
    expect(paigeAiChat).toContain("disabled={composerSendBlocked}");
    expect(paigeAiChat).toContain("disabled={!composerScope.writable || dictationActive}");
  });

  it("binds the conversations epoch to tenant, selected thread, and edited-draft identity", () => {
    const page = read("src/pages/admin/ClientsConversations.tsx");
    expect(page).toContain('dictationScopeEpoch: `${activeTenantId ?? "resolving"}|${selected.key}|${editingDraftId ?? "new-reply"}`');
    expect(page).toContain("setScheduledFor(null); setEditingDraftId(null);");
  });
});
