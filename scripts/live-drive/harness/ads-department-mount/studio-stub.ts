// The one library upload seam (studio.ts uploadToLibrary) as the harness answers it: the file is
// "stored" as a fixed fixture picture and filed into the fixture library, so the drive can watch an
// upload land in the showroom. The real seam's storage and RPC contract are its own tests' business.
import { media } from "./ads-fixtures";

export async function uploadToLibrary(_tenantId: string, file: File) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const id = `7c1d0000-0000-4000-8000-${String(Date.now()).slice(-12).padStart(12, "0")}`;
  const title = (file.name || "Upload").replace(/\.[^.]+$/, "").slice(0, 80) || "Upload";
  media.push({ id, kind: "image", title, image_url: "/media/upload-proof.svg", updated_at: new Date().toISOString(), meta: {} });
  return { id: `lib-${id}`, kind: "image", artifactId: id, title, thumbnailUrl: "/media/upload-proof.svg", note: null, tags: [], savedAt: new Date().toISOString() };
}
