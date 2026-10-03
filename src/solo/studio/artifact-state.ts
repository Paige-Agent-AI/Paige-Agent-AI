// What the stage is showing, loaded from the saved work, and the two facts the top bar needs about
// it: is it live, and does it have saved changes visitors don't see yet.
import type { GrowthPageTheme } from "@/lib/growth";
import type { BuildStep } from "./useStudioChat";
import {
  loadForm, loadFunnel, loadImage, loadPage,
  type ArtifactRef, type StudioForm, type StudioFunnel, type StudioImage, type StudioPage,
} from "./studio-data";

export type Device = "desktop" | "phone";

export interface Brand { floor: GrowthPageTheme; name: string | null; logoUrl: string | null }

export type LoadedArtifact =
  | { kind: "form"; form: StudioForm }
  | { kind: "page"; page: StudioPage }
  | { kind: "funnel"; funnel: StudioFunnel }
  | { kind: "content"; image: StudioImage };

export async function loadArtifact(ref: ArtifactRef): Promise<LoadedArtifact> {
  switch (ref.kind) {
    case "form": return { kind: "form", form: await loadForm(ref.id) };
    case "page": return { kind: "page", page: await loadPage(ref.id) };
    case "funnel": return { kind: "funnel", funnel: await loadFunnel(ref.id) };
    default: return { kind: "content", image: await loadImage(ref.id) };
  }
}

export function artifactId(a: LoadedArtifact): string {
  return a.kind === "form" ? a.form.id : a.kind === "page" ? a.page.id : a.kind === "funnel" ? a.funnel.id : a.image.id;
}

export function isLive(a: LoadedArtifact): boolean {
  return a.kind === "form" ? a.form.live : a.kind === "page" ? a.page.live : a.kind === "funnel" ? a.funnel.live : a.image.live;
}
export function hasPendingChanges(a: LoadedArtifact): boolean {
  return a.kind === "form" ? a.form.changesPending : a.kind === "page" ? a.page.changesPending : false;
}

export type BuildShape = "sheet" | "page" | "form" | "funnel" | "image";

export function shapeFromSteps(steps: BuildStep[]): BuildShape {
  for (let i = steps.length - 1; i >= 0; i--) {
    const l = steps[i].label.toLowerCase();
    if (l.includes("funnel")) return "funnel";
    if (l.includes("landing page") || l.includes("page")) return "page";
    if (l.includes("form")) return "form";
    if (l.includes("image")) return "image";
  }
  return "sheet";
}

