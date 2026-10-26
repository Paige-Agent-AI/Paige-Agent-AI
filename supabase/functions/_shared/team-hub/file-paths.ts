// EXP08 Team Hub files: the one rule for which storage objects a service-role caller may remove.
// Shared by team-hub-file (a person's own upload) and team-hub-file-sweep (the scheduled sweep), so
// both remove exactly the canonical <tenant>/team-hub/<file> names the database returned, and nothing else.

// The only object names a Team Hub function will ever ask the service role to remove.
export const TEAM_HUB_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/team-hub\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** The stale-sweep result may arrive as text[], {paths}, or rows; keep only canonical Team Hub paths. */
export function stalePaths(value: unknown): string[] {
  const list = Array.isArray(value) ? value : (record(value)?.paths as unknown);
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => typeof item === "string" ? item : record(item)?.path ?? record(item)?.storage_path)
    .filter((path): path is string => typeof path === "string" && TEAM_HUB_PATH.test(path));
}
