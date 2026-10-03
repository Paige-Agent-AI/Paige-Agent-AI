// Replaces only the signed-in owner's profile read. A fictional owner (§63).
export function useSoloOwner() {
  return { owner: { name: "Jordan Reyes", email: null, avatarUrl: null, website: null }, loading: false, error: null, refresh: () => {}, save: async () => ({ ok: true }) };
}
