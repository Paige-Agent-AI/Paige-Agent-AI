/** Authenticate before any privileged connection read, token access, or sync. */
export async function authorizeQuickBooksSync(
  authorization: string | null,
  serviceKey: string,
  bulk: boolean,
  resolveUser: () => Promise<string | null>,
): Promise<
  | { allowed: false; status: 401 | 403 }
  | { allowed: true; actor: "service" }
  | { allowed: true; actor: "person"; userId: string }
> {
  if (!authorization?.startsWith("Bearer ") || !authorization.slice(7).trim()) {
    return { allowed: false, status: 401 };
  }
  if (serviceKey && authorization === `Bearer ${serviceKey}`) {
    return { allowed: true, actor: "service" };
  }
  try {
    const userId = await resolveUser();
    if (!userId) return { allowed: false, status: 401 };
    if (bulk) return { allowed: false, status: 403 };
    return { allowed: true, actor: "person", userId };
  } catch {
    return { allowed: false, status: 401 };
  }
}
