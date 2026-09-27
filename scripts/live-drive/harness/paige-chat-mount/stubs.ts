// One stub module for every data hook the portal chat reads. Each export mirrors the real hook's
// return shape; nothing here reaches a network. The document-summary hook records what the chat asks
// it to keep, on `window.__documentSummaries`, so a drive can read it back.
declare global {
  interface Window { __documentSummaries: Array<{ fileName: string; summary: string }> }
}
window.__documentSummaries = [];
const params = new URLSearchParams(window.location.search);

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: "harness-token", user: { id: "harness-client" } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getUser: async () => ({ data: { user: { id: "harness-client" } }, error: null }),
  },
  functions: { invoke: async () => ({ data: null, error: null }) },
  from: () => {
    const chain: any = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }), then: (r: any) => r({ data: [], error: null }) };
    return chain;
  },
  rpc: async () => ({ data: null, error: null }),
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => undefined,
};

export function usePaigeMemory() {
  return {
    extractDocumentSummary: (summary: string, fileName: string) => {
      window.__documentSummaries.push({ fileName, summary });
      return { fileName, summary };
    },
    getSessionDocumentContext: () => undefined,
    trackActivity: () => undefined,
    generateSessionSummary: async () => undefined,
    resetSession: () => undefined,
  };
}

const HARNESS_DOC = params.get("doc") === "1" ? { name: "intake.pdf", base64: "JVBERi0xLjQK" } : null;
export function useChatDocumentUpload() {
  return {
    attachedDoc: HARNESS_DOC, isProcessingFile: false, isDragOver: false, fileInputRef: { current: null },
    handleFileSelect: () => undefined, handleDragOver: () => undefined, handleDragLeave: () => undefined,
    handleDrop: () => undefined, removeAttachment: () => undefined, openFilePicker: () => undefined, setAttachedDoc: () => undefined,
  };
}

export function useClientChatContext() { return { contextBlock: "", isLoading: false, hasCreditData: false }; }
export function useProfileSnapshot() { return { snapshot: {}, refresh: () => undefined }; }
export function useClientPortalBrandState() { return { brand: null, loading: false }; }
export function useClientPortalBrand() { return null; }
export function trackEvent() { return Promise.resolve(); }
export function useBeforeUnloadGuard() { return undefined; }
export function usePlaybook() {
  return { persona: { greeting: "Hi Jordan, I'm Paige.", name: "Paige", role: "your assistant at Northside Fitness" }, quickActions: [] };
}
