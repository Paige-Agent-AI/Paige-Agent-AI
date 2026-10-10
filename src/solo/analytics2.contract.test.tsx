import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const analyticsSource = readFileSync(resolve(process.cwd(), "src/solo/analytics2.tsx"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "src/solo/SoloApp.tsx"), "utf8");
const analyticsCss = readFileSync(resolve(process.cwd(), "src/solo/analytics2.css"), "utf8");
const salesSource = readFileSync(resolve(process.cwd(), "src/solo/SalesWorkspace.tsx"), "utf8");
const settingsSource = readFileSync(resolve(process.cwd(), "src/solo/settings.tsx"), "utf8");

describe("Solo Analytics approved workspace contract", () => {
  it("keeps the production truth-recovery prohibitions", () => {
    for (const forbidden of [
      "./analytics-data",
      "AskPop",
      "AN_ANS",
      "Approve fix",
      "You against comparable businesses",
      "Run the dunning sequence",
      "fixture records",
      "sample metric",
      "benchmark",
      "window.open",
    ]) expect(analyticsSource.toLowerCase()).not.toContain(forbidden.toLowerCase());

    expect(analyticsSource).not.toMatch(/\$[\d,.]+/);
  });

  it("ports the six approved operating workspaces and structural absence visuals", () => {
    for (const label of [
      "Brief",
      "Sales funnel",
      "Revenue & profit",
      "Retention",
      "Acquisition",
      "Decisions",
    ]) expect(analyticsSource).toContain(label);

    for (const structuralClass of [
      "anr-evidence-wheel",
      "anr-cylinder-funnel",
      "anr-radial-stack",
      "anr-cohort-grid",
      "anr-source-map",
      "anr-decision-frame",
    ]) expect(analyticsSource).toContain(structuralClass);
  });

  it("keeps evidence state, range, source, freshness, and caveats attached", () => {
    for (const label of [
      "Metric identity",
      "Definition",
      "Formula / version",
      "Exact requested range",
      "Source references",
      "Contributing records",
      "Completeness / coverage",
      "Exclusions",
      "Freshness / queried at",
      "Truth state",
    ]) expect(analyticsSource).toContain(label);

    for (const forbiddenRailField of [
      "get_client_rail",
      "paige_client_events",
      "record_rail_event",
      "rail.title",
      "rail.summary",
      "rail.payload",
    ]) expect(analyticsSource).not.toContain(forbiddenRailField);
  });

  it("removes the redundant visible title while retaining a semantic heading", () => {
    expect(analyticsSource).toContain('<h1 id="analytics-title" className="anr-sr-only">Analytics</h1>');
    expect(analyticsSource).not.toContain("anr-title-group");
  });

  it("keeps one shell-owned PAIGE workspace and no local analysis authority", () => {
    expect(appSource).not.toContain("analytics:<Analytics2");
    expect(appSource).toContain("settings:<SoloSettings openPaige={openPaige}/>");
    expect(appSource).toContain("soloPaigeWorkspace={<SoloPaigeWorkspace");
    expect(salesSource).toContain('<SalesPerformanceWorkspace epoch={accountEpoch} onNavigate={destination => open(destination.tab, destination.query)}/>');
    expect(salesSource).not.toContain('<Analytics2');
    expect(settingsSource).toContain('tab === "analytics" ? <SoloSettingsAnalytics/>');
    expect(analyticsSource).toContain("openPaige");
    expect(analyticsSource).toContain("Open PAIGE workspace");
    expect(analyticsSource).not.toContain("SoloPaigeWorkspace");
    expect(analyticsSource).not.toContain("openPaige(evidence");
    expect(analyticsSource).not.toContain("setTimeout");
  });

  it("retires the top-level Analytics host while preserving the embedded Sales lens geometry", () => {
    expect(appSource).not.toContain("route==='analytics'");
    expect(appSource).toContain("overflow:full?'hidden':'auto'");
    expect(appSource).toContain("route==='market'");
    expect(analyticsCss).toContain("height:100%;min-height:0;overflow:hidden");
    expect(analyticsCss).toContain(".anr-pane-scroll");
    expect(analyticsCss).toContain("overflow:auto");
    expect(analyticsCss).toContain("@container solo-analytics (max-width:900px)");
    expect(analyticsCss).toContain("@media(prefers-reduced-motion:reduce)");
    expect(analyticsCss).toContain("outline:2px solid var(--pg-gold-core)");
  });
});
