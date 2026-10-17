// Address hints only. Existing Chat/checkpoint RPCs independently authorize the
// current actor, selected tenant and private thread; a URL never grants access.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function interviewThreadFromSearch(search: string): string | null {
  const values = new URLSearchParams(search).getAll("interviewThread");
  return values.length === 1 && UUID.test(values[0]) ? values[0] : null;
}

export function interviewSetupPath(account: string | number, threadId: string | null): string {
  const path = `/solo/${encodeURIComponent(String(account))}/settings/setup/business-profile`;
  return threadId && UUID.test(threadId) ? `${path}?interviewThread=${encodeURIComponent(threadId)}` : path;
}

// Existing Settings destinations only; this address conveys no connection,
// credential, ownership or thread authority. Each destination re-resolves scope.
export function interviewConnectionPath(account: string | number, destination: "integrations" | "connections" | "vault", threadId: string | null): string {
  const path = `/solo/${encodeURIComponent(String(account))}/settings/${destination}`;
  return threadId && UUID.test(threadId) ? `${path}?interviewThread=${encodeURIComponent(threadId)}` : path;
}

export function interviewReturnPath(account: string | number, search: string): string | null {
  const threadId = interviewThreadFromSearch(search);
  return threadId ? `/solo/${encodeURIComponent(String(account))}/paige/chat?interviewThread=${encodeURIComponent(threadId)}` : null;
}
