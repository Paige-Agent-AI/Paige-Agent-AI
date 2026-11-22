export type StudioSavedMediaHandoff = {
  source: "marketing_content";
  id: string;
  kind: "image" | "video";
  expectedTenantId: string;
};

export type StudioSavedMediaLaunch = {
  returnFocus: HTMLButtonElement;
  asset: StudioSavedMediaHandoff;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseStudioSavedMediaHandoff(input: unknown): StudioSavedMediaHandoff | null {
  if (!input || typeof input !== "object") return null;
  const asset = input as Partial<StudioSavedMediaHandoff>;
  if (asset.source !== "marketing_content" || (asset.kind !== "image" && asset.kind !== "video")
    || typeof asset.id !== "string" || !UUID.test(asset.id)
    || typeof asset.expectedTenantId !== "string" || !UUID.test(asset.expectedTenantId)) return null;
  return { source: asset.source, id: asset.id, kind: asset.kind, expectedTenantId: asset.expectedTenantId };
}
