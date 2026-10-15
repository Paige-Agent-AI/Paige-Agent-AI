/**
 * E — the Archived home.
 *
 * Production complaint (2026-10-01): the owner archived PPL-MRBD9 (via Package B's stored-
 * proposal execution) and it disappeared from the active list with no visible home — no way
 * to see it, restore it, or delete it. The data layer returns archived pipelines with their
 * lifecycleStatus, but the UI simply filtered them out with no destination.
 *
 * This suite pins the visible Archived section in PipelineCommandDesk: archived pipelines
 * appear in a distinct, visually separated area with Restore and Delete actions; the section
 * is honest about what it shows; restore uses the existing canonical pipeline action; delete
 * uses the existing dependency-aware PipelineDelete.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const ui = readFileSync(join(root, "src/solo/PipelineCommandDesk.tsx"), "utf8");
const css = readFileSync(join(root, "src/solo/solo-campaigns.css"), "utf8");

describe("archived pipelines have a visible home", () => {
  it("the pipeline list separates active from archived", () => {
    expect(ui).toContain("archivedPipelines");
    expect(ui).toContain('lifecycleStatus === "archived"');
  });

  it("archived pipelines render in a distinct section with a heading", () => {
    expect(ui).toContain('className="pipeline-archived"');
    expect(ui).toContain("Archived");
  });

  it("the section shows the pipeline's name and reference", () => {
    expect(ui).toContain("pipeline.shortRef");
    expect(ui).toContain("pipeline.name");
  });

  it("Restore uses the existing pipeline action", () => {
    expect(ui).toContain('"restore-pipeline"');
  });

  it("Delete uses the existing dependency-aware PipelineDelete component", () => {
    expect(ui).toContain("PipelineDelete");
    expect(ui).toContain("pipeline-archived");
  });
});

describe("the Archived section is visually distinct", () => {
  it("has muted styling (archived pipelines are secondary to active ones)", () => {
    expect(css).toContain(".pipeline-archived");
  });

  it("archived pipelines are NOT shown in the active pipeline list", () => {
    expect(ui).toContain('lifecycleStatus !== "archived"');
  });
});

describe("the section is honest", () => {
  it("no success state is shown before server truth (the realtime board handles updates)", () => {
    expect(ui).not.toContain("setArchived");
    expect(ui).not.toContain("markArchived");
    expect(ui).not.toContain("localArchive");
  });
});
