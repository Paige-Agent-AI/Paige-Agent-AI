import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PlatformUpdateBannerView } from "./PlatformUpdateBanner";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";

function Work({ active }: { active: boolean }) {
  useBeforeUnloadGuard(active);
  return null;
}

const banner = <PlatformUpdateBannerView updateAvailable customerUpdate={null} recentRelease={null}
  reload={() => true} dismiss={() => undefined} />;

describe("PlatformUpdateBannerView registered work protection", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  let editorRoot: Root | null = null;
  let editorHost: HTMLDivElement | null = null;
  const notice = () => host?.querySelector('[aria-label="Paige update"]');
  const mount = () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  };
  afterEach(() => {
    act(() => { root?.unmount(); editorRoot?.unmount(); });
    host?.remove();
    editorHost?.remove();
    root = editorRoot = null;
    host = editorHost = null;
  });

  it("keeps Send reachable after a draft loses editing focus", () => {
    mount();
    act(() => root?.render(<><Work active /><textarea aria-label="Message Cura" />
      <button type="button">Send</button>{banner}</>));
    const input = host!.querySelector("textarea")!;
    const send = host!.querySelector("button")!;
    act(() => input.focus());
    act(() => { input.blur(); send.focus(); });
    expect(document.activeElement).toBe(send);
    expect(notice()).toBeNull();
  });

  it("reacts to work registered after the notice is already mounted", () => {
    mount();
    editorHost = document.createElement("div");
    document.body.append(editorHost);
    editorRoot = createRoot(editorHost);
    act(() => root?.render(banner));
    expect(notice()).not.toBeNull();
    act(() => editorRoot?.render(<Work active />));
    expect(notice()).toBeNull();
    act(() => editorRoot?.render(<Work active={false} />));
    expect(notice()).not.toBeNull();
  });

  it("defers on its first render when another editor already has work", () => {
    editorHost = document.createElement("div");
    document.body.append(editorHost);
    editorRoot = createRoot(editorHost);
    act(() => editorRoot?.render(<Work active />));
    mount();
    act(() => root?.render(banner));
    expect(notice()).toBeNull();
  });

  it("waits for the last editor to clear, including StrictMode cleanup", () => {
    mount();
    const render = (first: boolean, second: boolean) => act(() => root?.render(<React.StrictMode>
      <Work active={first} /><Work active={second} />{banner}
    </React.StrictMode>));
    render(true, true);
    expect(notice()).toBeNull();
    render(false, true);
    expect(notice()).toBeNull();
    render(false, false);
    expect(notice()).not.toBeNull();
    render(true, false);
    expect(notice()).toBeNull();
  });
});

describe("PlatformUpdateBannerView typing protection", () => {
  it("defers the banner while an editable control has focus", () => {
    const input = document.createElement("input");
    const host = document.createElement("div");
    document.body.append(input, host);
    const root = createRoot(host);
    act(() => root.render(
      <PlatformUpdateBannerView
        updateAvailable
        customerUpdate={null}
        recentRelease={null}
        reload={() => true}
        dismiss={() => undefined}
      />,
    ));
    expect(host.querySelector('[aria-label="Paige update"]')).not.toBeNull();
    act(() => input.focus());
    expect(host.querySelector('[aria-label="Paige update"]')).toBeNull();
    act(() => root.unmount());
    input.remove();
    host.remove();
  });
});
