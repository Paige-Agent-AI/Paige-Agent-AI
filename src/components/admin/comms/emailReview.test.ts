import { describe, expect, it } from "vitest";
import { renderEmailReviewHtml } from "./mergeVars";

describe("the original Comms inert email review projection", () => {
  it("keeps readable structure and exposes a misleading link's destination without navigation", () => {
    const host = document.createElement("div");
    host.innerHTML = renderEmailReviewHtml('<p><strong>Welcome</strong></p><ul><li>First</li></ul><a href="https://other.example/path">Your bank</a>');
    expect(host.querySelector("strong")?.textContent).toBe("Welcome");
    expect(host.querySelector("li")?.textContent).toBe("First");
    expect(host.textContent).toContain("Your bank (https://other.example/path)");
    expect(host.querySelector("a,[href]")).toBeNull();
  });
  it.each([
    '<script>window.SECRET=true</script><p onclick="alert(1)">Words</p>',
    '<img src="https://tracking.example/pixel" onerror="alert(1)"><video poster="https://tracking.example/poster"></video>',
    '<style>@import "https://tracking.example/css";</style><div style="background:url(https://tracking.example/css)">Words</div>',
    '<svg><image href="https://tracking.example/svg"/></svg><math><mtext><img src=x onerror=alert(1)></mtext></math>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe><object data="https://tracking.example/object"></object>',
    '<form action="https://tracking.example/form"><input autofocus onfocus="alert(1)"><button formaction="https://tracking.example/button">Send</button></form>',
    '<meta http-equiv="refresh" content="0;url=https://tracking.example"><base href="https://tracking.example">',
    '<a href="javascript:alert(1)">Words</a><a href="data:text/html,secret">More</a>',
  ])("renders hostile content without an active element or attribute: %s", html => {
    const host = document.createElement("div");host.innerHTML = renderEmailReviewHtml(html);
    expect(host.querySelector("script,style,img,video,audio,svg,math,iframe,object,embed,form,input,button,meta,base,link")).toBeNull();
    for (const el of host.querySelectorAll("*")) expect(el.attributes.length).toBe(0);
  });
  it("leaves merge-looking customer text unchanged rather than resolving signature variables again", () => {
    expect(renderEmailReviewHtml('<p>{{customer.name}} &amp; team</p>')).toContain("{{customer.name}} &amp; team");
  });
});
